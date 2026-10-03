import { Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { docs, getActivePath, hooks, markSaved, reconfigureCollab } from '../editor/setup'
import { store, updateSettings, type CollabState } from '../store'
import { closeProject, closeTab, isOwnWrite, openProject, refreshFiles, saveAll, TEXT_FILE, writeFromSession } from './actions'

// Édition à plusieurs en pair-à-pair. Un document Yjs partagé contient tous les fichiers du projet :
// textes (Y.Text, fusion caractère par caractère) et autres fichiers (octets, le dernier gagne).
// Chaque participant garde une vraie copie sur son disque : les changements reçus y sont écrits, et les
// changements du disque (autre éditeur, agents IA) entrent dans la session. L'état Yjs est conservé dans
// .lumentex/collab : des modifications faites hors ligne se fusionnent au retour, sans doublon.

const api = window.api
const MSG_SYNC = 0
const MSG_AWARENESS = 1
/** Origines des transactions : reçu d'un autre participant, lu sur le disque, état initial */
const REMOTE = 'remote'
const DISK = 'disk'
const INIT = 'init'
const MAX_BINARY = 15 * 1024 * 1024
const COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#c2255c', '#7048e8', '#0c8599', '#e67700', '#5c940d']

type Entry = Y.Text | Uint8Array

interface Session {
  /** Dossier local ; null pour un invité tant que le contenu de la session n'est pas arrivé */
  root: string | null
  code: string
  doc: Y.Doc
  files: Y.Map<Entry>
  meta: Y.Map<string>
  awareness: awarenessProtocol.Awareness
  /** Pair réseau → identifiants de présence annoncés par lui */
  peerClients: Map<string, Set<number>>
  /** Fichiers modifiés par la session, à écrire sur le disque */
  pending: Set<string>
  /** Dernier contenu binaire écrit par la session (pour ignorer l'écho du disque) */
  binWrites: Map<string, Uint8Array>
  /** Texte partagé auquel chaque document ouvert est lié */
  bound: Map<string, Y.Text>
  /** Pas d'état local fiable : attendre un autre participant avant d'importer le disque */
  awaitSync: boolean
  parentDir: string
  timers: { write?: number; save?: number }
  offs: (() => void)[]
}

let s: Session | null = null

const setCollab = (patch: Partial<CollabState>): void => store.set((st) => ({ collab: { ...st.collab, ...patch } }))
export const collabActive = (): boolean => !!s?.root

export function formatCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code
}

// ---------------------------------------------------------------------------
// Liens avec l'éditeur
// ---------------------------------------------------------------------------

const textAt = (path: string): Y.Text | null => {
  const v = s?.root ? s.files.get(path) : undefined
  return v instanceof Y.Text ? v : null
}

hooks.collabText = (path) => textAt(path)?.toString() ?? null
hooks.collabExtension = (path): Extension => {
  const t = textAt(path)
  if (!s || !t) {
    s?.bound.delete(path)
    return []
  }
  s.bound.set(path, t)
  return [yCollab(t, s.awareness), Prec.high(keymap.of(yUndoManagerKeymap))]
}

/** Relie (ou délie) les documents ouverts dont le texte partagé a changé (création, renommage, suppression) */
function syncBindings(): void {
  if (!s) return
  const stale = [...docs.keys()].filter((p) => (s!.bound.get(p) ?? null) !== textAt(p))
  if (stale.length) reconfigureCollab((p) => stale.includes(p))
}

// ---------------------------------------------------------------------------
// Protocole (messages Yjs sur le réseau pair-à-pair)
// ---------------------------------------------------------------------------

function send(enc: encoding.Encoder, to?: string): void {
  api.collabSend(encoding.toUint8Array(enc), to)
}

function greet(peer: string): void {
  if (!s) return
  const sync = encoding.createEncoder()
  encoding.writeVarUint(sync, MSG_SYNC)
  syncProtocol.writeSyncStep1(sync, s.doc)
  send(sync, peer)
  const aw = encoding.createEncoder()
  encoding.writeVarUint(aw, MSG_AWARENESS)
  encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(s.awareness, [s.doc.clientID]))
  send(aw, peer)
}

function forget(peer: string): void {
  if (!s) return
  const ids = s.peerClients.get(peer)
  if (ids?.size) awarenessProtocol.removeAwarenessStates(s.awareness, [...ids], REMOTE)
  s.peerClients.delete(peer)
}

function receive(peer: string, data: Uint8Array): void {
  if (!s) return
  try {
    const dec = decoding.createDecoder(data)
    const type = decoding.readVarUint(dec)
    if (type === MSG_SYNC) {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      const kind = syncProtocol.readSyncMessage(dec, enc, s.doc, REMOTE)
      if (encoding.length(enc) > 1) send(enc, peer)
      if (kind === syncProtocol.messageYjsSyncStep2) void onFirstSync()
    } else if (type === MSG_AWARENESS) {
      const update = decoding.readVarUint8Array(dec)
      // Identifiants de présence de ce pair, pour les retirer à son départ
      const d = decoding.createDecoder(update)
      const ids = s.peerClients.get(peer) ?? new Set<number>()
      for (let n = decoding.readVarUint(d); n > 0; n--) {
        ids.add(decoding.readVarUint(d))
        decoding.readVarUint(d)
        decoding.readVarString(d)
      }
      s.peerClients.set(peer, ids)
      awarenessProtocol.applyAwarenessUpdate(s.awareness, update, REMOTE)
    }
  } catch {
    /* message illisible (version différente de l'app) : ignoré */
  }
}

function refreshPeople(): void {
  if (!s) return
  const people = [...s.awareness.getStates()]
    .filter(([id, st]) => id !== s!.doc.clientID && st.user)
    .map(([id, st]) => ({ id, name: String(st.user.name), color: String(st.user.color), file: (st.file as string | null) ?? null }))
  setCollab({ people })
}

// ---------------------------------------------------------------------------
// Disque ↔ session
// ---------------------------------------------------------------------------

function schedulePersist(): void {
  if (!s?.root) return
  clearTimeout(s.timers.save)
  s.timers.save = window.setTimeout(() => void persist(), 1000)
}

async function persist(): Promise<void> {
  if (s?.root) await api.collabSaveState(s.root, Y.encodeStateAsUpdate(s.doc))
}

/** Changements de la session (autres participants, éditeur) à écrire sur le disque */
function onFilesChanged(events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction): void {
  if (!s?.root || tr.origin === DISK || tr.origin === INIT) return
  for (const e of events) {
    if (e.target === s.files) e.changes.keys.forEach((_c, key) => s!.pending.add(key))
    else if (e.path.length) s.pending.add(String(e.path[0]))
  }
  clearTimeout(s.timers.write)
  s.timers.write = window.setTimeout(() => void flushWrites(), 250)
}

async function flushWrites(): Promise<void> {
  if (!s?.root) return
  const sess = s
  const root = sess.root!
  const keys = [...sess.pending]
  sess.pending.clear()
  // L'état d'abord : si l'app s'arrête ici, la reprise ne réimporte pas ces changements comme les siens
  await persist()
  let removed = false
  for (const key of keys) {
    const v = sess.files.get(key)
    try {
      if (v === undefined) {
        if (store.get().tabs.includes(key)) {
          markSaved(key)
          await closeTab(key)
        }
        if ((await api.stat(`${root}/${key}`)).exists) await api.trash(root, key)
        removed = true
      } else if (v instanceof Y.Text) await writeFromSession(root, key, v.toString())
      else {
        sess.binWrites.set(key, v)
        await api.writeBinary(root, key, v)
      }
    } catch {
      /* fichier verrouillé ou chemin invalide : réessayé au prochain changement */
    }
  }
  if (removed || keys.some((k) => !store.get().files.some((f) => f.path === k))) await refreshFiles()
  syncBindings()
}

/** Remplace le texte partagé par celui du disque en ne touchant que la partie modifiée */
function applyDiff(t: Y.Text, next: string): void {
  const cur = t.toString()
  let a = 0
  while (a < cur.length && a < next.length && cur[a] === next[a]) a++
  let b = 0
  while (b < cur.length - a && b < next.length - a && cur[cur.length - 1 - b] === next[next.length - 1 - b]) b++
  if (cur.length - a - b > 0) t.delete(a, cur.length - a - b)
  if (next.length - a - b > 0) t.insert(a, next.slice(a, next.length - b))
}

const sameBytes = (x: Uint8Array, y: Uint8Array): boolean => x.length === y.length && x.every((v, i) => v === y[i])

/** Lit un fichier du disque et le reporte dans la session s'il diffère */
async function importFile(path: string): Promise<void> {
  if (!s?.root) return
  const sess = s
  const root = sess.root!
  if (TEXT_FILE.test(path)) {
    const text = await api.read(root, path)
    // Écho de nos propres écritures (éventuellement déjà dépassées par la frappe) : ignoré
    if (isOwnWrite(path, text)) return
    const cur = sess.files.get(path)
    if (cur instanceof Y.Text) {
      if (cur.toString() !== text) sess.doc.transact(() => applyDiff(cur, text), DISK)
    } else sess.doc.transact(() => sess.files.set(path, new Y.Text(text)), DISK)
  } else {
    const bin = await api.readBinary(root, path)
    if (bin.length > MAX_BINARY) return
    const own = sess.binWrites.get(path)
    if (own && sameBytes(own, bin)) return
    const cur = sess.files.get(path)
    if (!(cur instanceof Uint8Array) || !sameBytes(cur, bin)) sess.doc.transact(() => sess.files.set(path, bin), DISK)
  }
}

/** Fichiers modifiés sur le disque (surveillance du dossier) → session */
export async function collabDiskChanged(paths: string[]): Promise<void> {
  if (!s?.root || s.awaitSync) return
  const sess = s
  const root = sess.root!
  for (const p of paths) {
    try {
      const st = await api.stat(`${root}/${p}`)
      if (!st.exists) {
        const gone = [...sess.files.keys()].filter((k) => k === p || k.startsWith(p + '/'))
        if (gone.length) sess.doc.transact(() => gone.forEach((k) => sess.files.delete(k)), DISK)
      } else if (st.isDir) {
        for (const f of await api.list(root)) if (!f.isDir && f.path.startsWith(p + '/')) await importFile(f.path)
      } else await importFile(p)
    } catch {
      /* fichier en cours d'écriture : le prochain événement le reprendra */
    }
  }
  syncBindings()
}

/** Tout le dossier → session : fichiers nouveaux, modifiés ou supprimés hors session */
async function importAll(): Promise<void> {
  if (!s?.root) return
  const sess = s
  const onDisk = (await api.list(sess.root!)).filter((f) => !f.isDir).map((f) => f.path)
  for (const p of onDisk) await importFile(p).catch(() => {})
  const missing = [...sess.files.keys()].filter((k) => !onDisk.includes(k))
  if (missing.length) sess.doc.transact(() => missing.forEach((k) => sess.files.delete(k)), DISK)
  syncBindings()
}

/** Session → tout le dossier (arrivée d'un invité) */
async function writeAll(): Promise<void> {
  if (!s?.root) return
  for (const [key, v] of s.files) {
    if (v instanceof Y.Text) await writeFromSession(s.root, key, v.toString())
    else {
      s.binWrites.set(key, v)
      await api.writeBinary(s.root, key, v)
    }
  }
}

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

async function begin(code: string, root: string | null, doc: Y.Doc, role: CollabState['role'], awaitSync: boolean): Promise<void> {
  const name = store.get().settings.collabName.trim() || (await api.userName()) || 'Anonyme'
  const awareness = new awarenessProtocol.Awareness(doc)
  const color = COLORS[doc.clientID % COLORS.length]
  awareness.setLocalStateField('user', { name, color, colorLight: color + '33' })
  awareness.setLocalStateField('file', getActivePath())
  const sess: Session = {
    root,
    code,
    doc,
    files: doc.getMap<Entry>('files'),
    meta: doc.getMap<string>('meta'),
    awareness,
    peerClients: new Map(),
    pending: new Set(),
    binWrites: new Map(),
    bound: new Map(),
    awaitSync,
    parentDir: '',
    timers: {},
    offs: []
  }
  s = sess

  const onUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin !== REMOTE) {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      syncProtocol.writeUpdate(enc, update)
      send(enc)
    }
    schedulePersist()
  }
  const onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown): void => {
    if (origin !== REMOTE) {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_AWARENESS)
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]))
      send(enc)
    }
    refreshPeople()
  }
  doc.on('update', onUpdate)
  awareness.on('update', onAwareness)
  sess.files.observeDeep(onFilesChanged)
  let lastActive = getActivePath()
  sess.offs.push(
    () => doc.off('update', onUpdate),
    () => awareness.off('update', onAwareness),
    () => sess.files.unobserveDeep(onFilesChanged),
    api.onCollabPeer((id, joined) => (joined ? greet(id) : forget(id))),
    api.onCollabData(receive),
    api.onCollabStatus((net) => setCollab({ net })),
    // Fichier ouvert : visible des autres participants
    store.subscribe(() => {
      const a = store.get().active
      if (a !== lastActive) awareness.setLocalStateField('file', (lastActive = a))
    })
  )
  setCollab({ active: true, code, role, joining: !root, people: [], net: { state: 'starting', peers: 0 } })
  await api.collabStart(code)
}

/** Première synchronisation reçue : arrivée d'un invité, ou reprise sans état local */
async function onFirstSync(): Promise<void> {
  if (!s) return
  const sess = s
  if (!sess.root) {
    const name = sess.meta.get('name')
    if (!name) return
    const folder = await chooseFolder(sess.parentDir, name, sess.code)
    if (s !== sess) return
    sess.root = folder
    await writeAll()
    await persist()
    await updateSettings({ collabSessions: { ...store.get().settings.collabSessions, [folder]: { code: sess.code } } })
    setCollab({ joining: false })
    await openProject(folder)
    return
  }
  if (sess.awaitSync) {
    sess.awaitSync = false
    await importAll()
  }
}

/** Dossier du projet reçu : réutilisé s'il appartient déjà à cette session, sinon « nom-2 », « nom-3 »… */
async function chooseFolder(parent: string, name: string, code: string): Promise<string> {
  const safe = name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Projet partagé'
  const sessions = store.get().settings.collabSessions
  for (let i = 1; ; i++) {
    const folder = `${parent}/${i === 1 ? safe : `${safe}-${i}`}`
    if (sessions[folder]?.code === code || !(await api.stat(folder)).exists) return folder
  }
}

/** Partage le projet ouvert : son contenu devient l'état initial de la session */
export async function shareProject(): Promise<void> {
  const { root, projectName } = store.get()
  if (!root || s) return
  await saveAll()
  const code = await api.collabNewCode()
  const doc = new Y.Doc()
  const entries: [string, Entry][] = []
  for (const f of await api.list(root)) {
    if (f.isDir) continue
    try {
      if (TEXT_FILE.test(f.path)) entries.push([f.path, new Y.Text(await api.read(root, f.path))])
      else {
        const bin = await api.readBinary(root, f.path)
        if (bin.length <= MAX_BINARY) entries.push([f.path, bin])
      }
    } catch {
      /* illisible : non partagé */
    }
  }
  doc.transact(() => {
    const files = doc.getMap<Entry>('files')
    for (const [p, v] of entries) files.set(p, v)
    doc.getMap<string>('meta').set('name', projectName)
  }, INIT)
  await updateSettings({ collabSessions: { ...store.get().settings.collabSessions, [root]: { code } } })
  await begin(code, root, doc, 'host', false)
  await persist()
  reconfigureCollab()
}

/** Rejoint une session : le projet sera créé dans parentDir à l'arrivée de son contenu */
export async function joinSession(rawCode: string, parentDir: string): Promise<boolean> {
  const code = await api.collabNormalizeCode(rawCode)
  if (!code) return false
  if (s) await stopSession({ forget: false })
  if (store.get().root) await closeProject()
  await begin(code, null, new Y.Doc(), 'guest', false)
  if (s) (s as Session).parentDir = parentDir
  return true
}

/** Projet ouvert : reprend sa session partagée s'il en a une */
export async function onProjectOpened(root: string): Promise<void> {
  if (s) {
    if (s.root === root) reconfigureCollab()
    return
  }
  const saved = store.get().settings.collabSessions[root]
  if (!saved) return
  const doc = new Y.Doc()
  const state = await api.collabLoadState(root)
  if (state) Y.applyUpdate(doc, state, INIT)
  // Sans état local, importer le disque maintenant dupliquerait le texte : on attend un autre participant
  await begin(saved.code, root, doc, 'host', !state)
  if (state) await importAll()
  reconfigureCollab()
}

/** Arrête la session (fermeture du projet) ; forget : oublie aussi la session pour ce dossier */
export async function stopSession({ forget }: { forget: boolean }): Promise<void> {
  if (!s) return
  const sess = s
  clearTimeout(sess.timers.write)
  clearTimeout(sess.timers.save)
  if (sess.pending.size) await flushWrites()
  await persist()
  awarenessProtocol.removeAwarenessStates(sess.awareness, [sess.doc.clientID], 'leave')
  sess.offs.forEach((off) => off())
  await api.collabStop()
  s = null
  reconfigureCollab()
  sess.doc.destroy()
  if (forget && sess.root) {
    const sessions = { ...store.get().settings.collabSessions }
    delete sessions[sess.root]
    await updateSettings({ collabSessions: sessions })
    await api.collabClearState(sess.root)
  }
  setCollab({ active: false, code: '', joining: false, people: [], net: { state: 'off', peers: 0 } })
}
