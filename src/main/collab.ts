import { app } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { CollabNetStatus } from '../shared/types'
import { BUILD_DIR } from './compiler'

// Édition à plusieurs en pair-à-pair, sans serveur : les participants se trouvent sur le DHT de Hyperswarm à partir
// d'un sujet dérivé du code de session, puis chacun prouve qu'il connaît le code avant le moindre échange.
// Ce processus ne fait que transporter des octets ; la fusion des modifications (Yjs) se fait dans l'interface.

// Sans 0/O ni 1/I/L : code lisible à voix haute ou recopié à la main
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const CODE_LENGTH = 16
const MSG_AUTH = 0
const MSG_DATA = 1
/** Morceau d'un message plus gros que PART (le canal chiffré limite la taille d'un message) */
const MSG_PART = 2
const PART = 1024 * 1024
/** Signe de vie : un pair muet trop longtemps (coupure brutale) est considéré parti sans attendre le réseau */
const MSG_PING = 3
const PING_EVERY = 2000
const SILENT_MAX = 7000

/** Connexion Hyperswarm (flux chiffré Noise, découpé en messages) */
interface Conn {
  remotePublicKey: Buffer
  handshakeHash: Buffer
  isInitiator: boolean
  write(data: Buffer): boolean
  destroy(err?: Error): void
  on(event: 'data', cb: (d: Buffer) => void): void
  on(event: 'close', cb: () => void): void
  on(event: 'error', cb: (e: Error) => void): void
}

type Emit = (channel: string, ...args: unknown[]) => void

let swarm: {
  join(topic: Buffer, o: object): { flushed(): Promise<void>; refresh(): Promise<void> }
  on(e: 'connection', cb: (c: Conn) => void): void
  destroy(): Promise<void>
  dht?: { table?: { size: number } }
} | null = null
let watchdog: NodeJS.Timeout | undefined
let pinger: NodeJS.Timeout | undefined
/** Dernier message reçu de chaque pair qui envoie des signes de vie (les versions avant 1.2.2 n'en envoient pas) */
const lastSeen = new Map<Conn, number>()
let generation = 0
const peers = new Map<string, Conn>()
let status: CollabNetStatus = { state: 'off', peers: 0 }
let emit: Emit = () => {}

// --- Journal technique (jamais affiché : utile pour comprendre une panne) ---
const logFile = (): string => path.join(app.getPath('userData'), 'collab.log')
function log(...parts: unknown[]): void {
  try {
    const f = logFile()
    if (fs.existsSync(f) && fs.statSync(f).size > 1_000_000) fs.renameSync(f, f + '.old')
    fs.appendFileSync(f, `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? p.stack : String(p))).join(' ')}\n`)
  } catch {
    /* journal indisponible : sans importance */
  }
}

function setStatus(patch: Partial<CollabNetStatus>): void {
  status = { ...status, ...patch, peers: peers.size }
  emit('collab:status', status)
}

export const collabStatus = (): CollabNetStatus => status

export function newCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('')
}

/** Code tel que saisi (minuscules, tirets, espaces, préfixe) → 16 caractères, ou null s'il est invalide */
export function normalizeCode(input: string): string | null {
  const c = input.toUpperCase().replace(/^LUMEN/, '').replace(/[^0-9A-Z]/g, '')
  return c.length === CODE_LENGTH && [...c].every((ch) => ALPHABET.includes(ch)) ? c : null
}

/**
 * Sujet DHT et clé de preuve, dérivés du code par scrypt : le sujet est visible sur le réseau,
 * scrypt rend impraticable de retrouver le code à partir de lui
 */
function deriveKeys(code: string): { topic: Buffer; auth: Buffer } {
  const k = crypto.scryptSync(code, 'lumen-tex/collab/v1', 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  return { topic: k.subarray(0, 32), auth: k.subarray(32) }
}

/** Preuve liée au canal chiffré (handshakeHash) : inutilisable sur une autre connexion */
const proof = (auth: Buffer, conn: Conn, initiator: boolean): Buffer =>
  crypto.createHmac('sha256', auth).update(conn.handshakeHash).update(initiator ? 'initiator' : 'responder').digest()

export async function startCollab(code: string, emitter: Emit): Promise<void> {
  await stopCollab()
  emit = emitter
  const gen = ++generation
  setStatus({ state: 'starting' })
  const { topic, auth } = deriveKeys(code)

  let Hyperswarm: new (opts?: object) => NonNullable<typeof swarm>
  try {
    Hyperswarm = (await import('hyperswarm')).default as unknown as typeof Hyperswarm
  } catch (e) {
    log('module hyperswarm indisponible', e)
    setStatus({ state: 'unavailable' })
    return
  }
  // Pour les tests : réseau de démarrage alternatif (ex. « 127.0.0.1:1 » pour simuler un réseau injoignable)
  const bootstrap = process.env.LUMEN_DHT_BOOTSTRAP?.split(',').filter(Boolean)
  try {
    // Plus de tentatives simultanées (3 par défaut) : après un plantage, des annonces périmées de l'instance
    // disparue restent un moment sur le réseau et ne doivent pas monopoliser les essais au détriment des vrais pairs
    swarm = new Hyperswarm({ maxParallel: 10, ...(bootstrap ? { bootstrap } : {}) })
  } catch (e) {
    log('création du swarm impossible', e)
    setStatus({ state: 'unavailable' })
    return
  }
  const s = swarm

  s.on('connection', (conn) => {
    const id = conn.remotePublicKey.toString('hex').slice(0, 16)
    let authed = false
    conn.on('error', (e) => log('connexion', id, e.message))
    conn.on('close', () => {
      lastSeen.delete(conn)
      if (authed && peers.get(id) === conn) {
        peers.delete(id)
        log('départ', id)
        emit('collab:peer', id, false)
        setStatus({})
      }
    })
    const timer = setTimeout(() => !authed && conn.destroy(new Error('preuve absente')), 15000)
    let parts: Buffer[] = []
    conn.on('data', (d) => {
      if (!authed) {
        const expected = proof(auth, conn, !conn.isInitiator)
        const got = d.subarray(1)
        if (d[0] !== MSG_AUTH || got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {
          log('preuve refusée', id)
          conn.destroy(new Error('preuve refusée'))
          return
        }
        // Pour les tests : nombre maximal de pairs (simule deux participants qui ne peuvent pas se joindre)
        if (peers.size >= (Number(process.env.LUMEN_COLLAB_MAX_PEERS) || Infinity) && !peers.has(id)) {
          conn.destroy()
          return
        }
        authed = true
        clearTimeout(timer)
        peers.get(id)?.destroy()
        peers.set(id, conn)
        log('arrivée', id)
        emit('collab:peer', id, true)
        setStatus({ state: 'online' })
        return
      }
      if (lastSeen.has(conn) || d[0] === MSG_PING) lastSeen.set(conn, Date.now())
      if (d[0] === MSG_DATA) emit('collab:data', id, new Uint8Array(d.subarray(1)))
      else if (d[0] === MSG_PART) {
        // Les morceaux arrivent dans l'ordre (flux ordonné) ; le dernier est marqué
        parts.push(d.subarray(2))
        if (d[1] === 1) {
          emit('collab:data', id, new Uint8Array(Buffer.concat(parts)))
          parts = []
        }
      }
    })
    conn.write(Buffer.concat([Buffer.from([MSG_AUTH]), proof(auth, conn, conn.isInitiator)]))
  })

  pinger = setInterval(() => {
    for (const conn of peers.values()) {
      const seen = lastSeen.get(conn)
      if (seen && Date.now() - seen > SILENT_MAX) {
        log('muet, déconnecté', conn.remotePublicKey.toString('hex').slice(0, 16))
        conn.destroy()
      } else conn.write(Buffer.from([MSG_PING]))
    }
  }, PING_EVERY)

  setStatus({ state: 'searching' })
  log('recherche', topic.toString('hex').slice(0, 12))
  const discovery = s.join(topic, { server: true, client: true })
  const flushed = discovery.flushed()
  // Aucun nœud du réseau connu : hors ligne, pare-feu ou UDP bloqué (l'annonce « réussit » alors à vide).
  // Vérifié régulièrement : l'état revient de lui-même quand le réseau répond à nouveau
  const reachable = (): boolean => (s.dht?.table?.size ?? 1) > 0
  let announced = false
  const check = (): void => {
    if (gen !== generation || peers.size) return
    if (!reachable()) status.state !== 'network' && setStatus({ state: 'network' })
    else if (announced && status.state !== 'online') setStatus({ state: 'online' })
  }
  let ticks = 0
  watchdog = setInterval(() => {
    check()
    // Seul : nouvelle recherche toutes les 30 s (Hyperswarm n'en refait qu'au bout de 10 min ; deux participants
    // arrivés en même temps se manquent sinon, chacun ayant cherché avant l'annonce de l'autre)
    if (++ticks % 6 === 0 && announced && !peers.size && gen === generation) discovery.refresh().catch((e) => log('recherche', e))
    // Diagnostic (LUMEN_COLLAB_DEBUG) : pairs découverts sur le réseau, connexions en cours, nœuds connus
    const sw = s as unknown as { peers?: Map<unknown, unknown>; connecting?: number; connections?: Set<unknown> }
    if (process.env.LUMEN_COLLAB_DEBUG) log('diag', `decouverts=${sw.peers?.size} en_cours=${sw.connecting} connexions=${sw.connections?.size} noeuds=${s.dht?.table?.size}`)
  }, 5000)
  // Réseau muet : l'annonce peut aussi ne jamais aboutir ; Hyperswarm continue d'essayer
  const slow = setTimeout(() => gen === generation && status.state === 'searching' && setStatus({ state: 'network' }), 20000)
  flushed
    .then(() => {
      announced = true
      if (gen !== generation) return
      if (!reachable()) log('annonce sans aucun nœud du réseau')
      setStatus({ state: reachable() ? 'online' : 'network' })
    })
    .catch((e) => {
      log('annonce', e)
      if (gen === generation) setStatus({ state: 'network' })
    })
    .finally(() => clearTimeout(slow))
}

/** to : un seul pair ; except : tous sauf celui-ci (retransmission de ce qu'il a envoyé) */
export function sendCollab(data: Uint8Array, to?: string, except?: string): void {
  const buf = Buffer.from(data)
  const msgs: Buffer[] = []
  if (buf.length <= PART) msgs.push(Buffer.concat([Buffer.from([MSG_DATA]), buf]))
  else
    for (let at = 0; at < buf.length; at += PART) {
      const last = at + PART >= buf.length ? 1 : 0
      msgs.push(Buffer.concat([Buffer.from([MSG_PART, last]), buf.subarray(at, at + PART)]))
    }
  for (const [id, conn] of peers) if ((!to || to === id) && id !== except) for (const m of msgs) conn.write(m)
}

export async function stopCollab(): Promise<void> {
  generation++
  clearInterval(watchdog)
  clearInterval(pinger)
  lastSeen.clear()
  const s = swarm
  swarm = null
  peers.clear()
  if (status.state !== 'off') setStatus({ state: 'off' })
  if (s) await s.destroy().catch((e) => log('arrêt', e))
}

// --- Copie de travail des invités ---
// Rangée dans les données de l'app sous un nom illisible, et toujours effacée à la fin de la session
// (départ, fermeture du projet ou de l'app ; au lancement suivant après un plantage)

const guestsRoot = (): string => path.join(app.getPath('userData'), 'sessions')

export function isGuestDir(p: string): boolean {
  const r = path.relative(guestsRoot(), path.resolve(p))
  return !!r && !r.startsWith('..') && !path.isAbsolute(r)
}

/** Dossier vide pour le projet d'une session : <sessions>/<empreinte du code>/<nom du projet> */
export function guestDir(code: string, name: string): string {
  const hash = crypto.createHash('sha256').update(code).digest('hex').slice(0, 16)
  const dir = path.join(guestsRoot(), hash, name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Projet partagé')
  fs.rmSync(path.dirname(dir), { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir.split(path.sep).join('/')
}

/** Efface la copie de travail d'un invité (root), ou toutes */
export function dropGuestDirs(root?: string): void {
  if (root && !isGuestDir(root)) return
  try {
    fs.rmSync(root ? path.dirname(path.resolve(root)) : guestsRoot(), { recursive: true, force: true, maxRetries: 3 })
  } catch (e) {
    log('effacement de la copie de travail', e)
  }
}

/** « Garder une copie » : copie indépendante dans Documents/Lumen TeX partagés (« nom-2 »… si déjà pris) */
export function keepGuestCopy(root: string): string {
  const parent = path.join(app.getPath('documents'), 'Lumen TeX partagés')
  const name = path.basename(root)
  let dest = path.join(parent, name)
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(parent, `${name}-${i}`)
  // Sans l'état de la session (.lumentex/collab) : la copie n'en fait plus partie
  const state = path.join(path.resolve(root), BUILD_DIR, 'collab')
  fs.cpSync(root, dest, { recursive: true, filter: (src) => path.resolve(src) !== state })
  return dest
}
