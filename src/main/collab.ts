import { app } from 'electron'
import crypto from 'crypto'
import dgram from 'dgram'
import fs from 'fs'
import net, { type AddressInfo } from 'net'
import os from 'os'
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
  keyPair: KeyPair
} | null = null
type KeyPair = { publicKey: Buffer; secretKey: Buffer }
/** Recherche sur le réseau local (même Wi-Fi) : annonces UDP et connexions TCP chiffrées */
let lan: { udp: dgram.Socket; tcp: net.Server; timer: NodeJS.Timeout } | null = null
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
  // Réseau Internet muet mais participants joints (réseau local) : connecté
  if (peers.size && patch.state === 'network') patch = { ...patch, state: 'online' }
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
  const myKey = s.keyPair.publicKey
  // Même personne jointe deux fois (Internet et réseau local, ou les deux sens) : les deux côtés gardent la même
  // connexion, celle ouverte par la plus petite clé (la plus récente si elles ont été ouvertes du même côté)
  const opener = (c: Conn): Buffer => (c.isInitiator ? myKey : c.remotePublicKey)
  const preferred = (cur: Conn, old: Conn): boolean => opener(cur).equals(opener(old)) || Buffer.compare(opener(cur), opener(old)) < 0

  const onConnection = (conn: Conn): void => {
    if (gen !== generation) return conn.destroy()
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
        const old = peers.get(id)
        if (old && !preferred(conn, old)) {
          clearTimeout(timer)
          conn.destroy()
          return
        }
        authed = true
        clearTimeout(timer)
        old?.destroy()
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
  }
  s.on('connection', onConnection)
  void startLan(topic, s.keyPair, onConnection, gen)

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

// --- Réseau local ---
// Quand Internet bloque les connexions directes (école, entreprise), les participants d'un même réseau se trouvent
// par des annonces UDP (diffusion) et se connectent en TCP, chiffré comme sur Internet (Noise, même clé).
// L'annonce ne contient qu'une empreinte du sujet, pas le code ; la preuve de connaissance du code reste exigée.

const LAN_PORT = 47219
const LAN_MAGIC = Buffer.from('LMTX1')
const LAN_EVERY = 3000

/** Adresses de diffusion de chaque réseau IPv4 de l'ordinateur */
function broadcasts(): string[] {
  const out = new Set(['255.255.255.255'])
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      const ip = a.address.split('.').map(Number)
      const mask = a.netmask.split('.').map(Number)
      out.add(ip.map((b, i) => (b | (~mask[i] & 255)) & 255).join('.'))
    }
  return [...out]
}

async function startLan(topic: Buffer, keyPair: KeyPair, onConnection: (c: Conn) => void, gen: number): Promise<void> {
  let SecretStream: new (initiator: boolean, raw: net.Socket, o: object) => Conn & { opened: Promise<boolean> }
  try {
    SecretStream = (await import('@hyperswarm/secret-stream')).default as unknown as typeof SecretStream
  } catch (e) {
    log('réseau local indisponible', e)
    return
  }
  if (gen !== generation) return
  const secure = (initiator: boolean, sock: net.Socket): void => {
    sock.on('error', () => {})
    const conn = new SecretStream(initiator, sock, { keyPair })
    conn.on('error', () => {})
    void conn.opened.then((ok) => (ok ? onConnection(conn) : conn.destroy()))
  }
  const lanTopic = crypto.createHash('sha256').update(topic).update('lumen-tex/lan').digest()
  const tcp = net.createServer((sock) => secure(false, sock))
  tcp.on('error', (e) => log('réseau local (tcp)', e))
  tcp.listen(0)
  const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  udp.on('error', (e) => log('réseau local (udp)', e))
  const dialing = new Set<string>()
  udp.on('message', (msg, from) => {
    if (msg.length !== 71 || !msg.subarray(0, 5).equals(LAN_MAGIC) || !msg.subarray(5, 37).equals(lanTopic)) return
    const key = msg.subarray(37, 69)
    const id = key.toString('hex').slice(0, 16)
    // Une seule des deux personnes appelle l'autre (la plus petite clé), si elles ne sont pas déjà connectées
    if (peers.has(id) || dialing.has(id) || Buffer.compare(keyPair.publicKey, key) >= 0) return
    dialing.add(id)
    log('réseau local : appel', id, from.address)
    const sock = net.connect(msg.readUInt16BE(69), from.address)
    sock.on('close', () => dialing.delete(id))
    secure(true, sock)
  })
  udp.bind(LAN_PORT, () => {
    try {
      udp.setBroadcast(true)
    } catch {
      /* diffusion refusée : on reçoit quand même les annonces des autres */
    }
  })
  const announce = (): void => {
    const port = (tcp.address() as AddressInfo | null)?.port
    if (!port) return
    const msg = Buffer.alloc(71)
    LAN_MAGIC.copy(msg, 0)
    lanTopic.copy(msg, 5)
    keyPair.publicKey.copy(msg, 37)
    msg.writeUInt16BE(port, 69)
    for (const b of broadcasts()) udp.send(msg, LAN_PORT, b, () => {})
  }
  lan = { udp, tcp, timer: setInterval(announce, LAN_EVERY) }
  setTimeout(announce, 300)
}

function stopLan(): void {
  if (!lan) return
  clearInterval(lan.timer)
  try {
    lan.udp.close()
  } catch {
    /* déjà fermé */
  }
  lan.tcp.close()
  lan = null
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
  stopLan()
  const s = swarm
  swarm = null
  // Connexions du réseau local (celles d'Internet sont fermées avec le swarm)
  for (const c of peers.values()) c.destroy()
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
