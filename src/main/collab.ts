import { app } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { CollabNetStatus } from '../shared/types'

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
  join(topic: Buffer, o: object): { flushed(): Promise<void> }
  on(e: 'connection', cb: (c: Conn) => void): void
  destroy(): Promise<void>
  dht?: { table?: { size: number } }
} | null = null
let watchdog: NodeJS.Timeout | undefined
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
    swarm = new Hyperswarm(bootstrap ? { bootstrap } : {})
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
        authed = true
        clearTimeout(timer)
        peers.get(id)?.destroy()
        peers.set(id, conn)
        log('arrivée', id)
        emit('collab:peer', id, true)
        setStatus({ state: 'online' })
        return
      }
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

  setStatus({ state: 'searching' })
  log('recherche', topic.toString('hex').slice(0, 12))
  const flushed = s.join(topic, { server: true, client: true }).flushed()
  // Aucun nœud du réseau connu : hors ligne, pare-feu ou UDP bloqué (l'annonce « réussit » alors à vide).
  // Vérifié régulièrement : l'état revient de lui-même quand le réseau répond à nouveau
  const reachable = (): boolean => (s.dht?.table?.size ?? 1) > 0
  let announced = false
  const check = (): void => {
    if (gen !== generation || peers.size) return
    if (!reachable()) status.state !== 'network' && setStatus({ state: 'network' })
    else if (announced && status.state !== 'online') setStatus({ state: 'online' })
  }
  watchdog = setInterval(check, 5000)
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

export function sendCollab(data: Uint8Array, to?: string): void {
  const buf = Buffer.from(data)
  const msgs: Buffer[] = []
  if (buf.length <= PART) msgs.push(Buffer.concat([Buffer.from([MSG_DATA]), buf]))
  else
    for (let at = 0; at < buf.length; at += PART) {
      const last = at + PART >= buf.length ? 1 : 0
      msgs.push(Buffer.concat([Buffer.from([MSG_PART, last]), buf.subarray(at, at + PART)]))
    }
  for (const [id, conn] of peers) if (!to || to === id) for (const m of msgs) conn.write(m)
}

export async function stopCollab(): Promise<void> {
  generation++
  clearInterval(watchdog)
  const s = swarm
  swarm = null
  peers.clear()
  if (status.state !== 'off') setStatus({ state: 'off' })
  if (s) await s.destroy().catch((e) => log('arrêt', e))
}
