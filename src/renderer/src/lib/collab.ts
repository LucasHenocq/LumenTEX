import { EditorState, Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { yCollab, ySyncAnnotation, yUndoManagerKeymap } from 'y-codemirror.next'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { docs, getActivePath, hooks, markSaved, reconfigureCollab } from '../editor/setup'
import type { ChatMessage, FileRight, UserRight } from '../../../shared/types'
import { NO_RULES, store, toast, updateSettings, type CollabState } from '../store'
import { closeProject, closeTab, followMove, isOwnWrite, openProject, refreshFiles, saveAll, TEXT_FILE, writeFromSession } from './actions'

// Édition à plusieurs en pair-à-pair. Un document Yjs partagé contient tous les fichiers du projet :
// textes (Y.Text, fusion caractère par caractère) et autres fichiers (octets, le dernier gagne).
// Chaque participant garde une vraie copie sur son disque : les changements reçus y sont écrits, et les
// changements du disque (autre éditeur, agents IA) entrent dans la session. L'état Yjs est conservé dans
// .lumentex/collab : des modifications faites hors ligne se fusionnent au retour, sans doublon.

const api = window.api
const MSG_SYNC = 0
const MSG_AWARENESS = 1
/**
 * Origines des transactions : reçu d'un autre participant ({ peer }), lu sur le disque, état initial.
 * Tout ce qui est reçu est retransmis aux autres participants (sauf à l'expéditeur) : si deux personnes
 * ne peuvent pas se joindre directement, elles se reçoivent par l'intermédiaire d'une troisième
 */
type Remote = { peer: string }
const remotePeer = (origin: unknown): string | null =>
  origin && typeof origin === 'object' && 'peer' in origin ? (origin as Remote).peer : null
/** Retrait local de la présence d'un pair parti (à ne pas retransmettre) */
const FORGET = 'forget'
const DISK = 'disk'
const INIT = 'init'
/** Fichier rendu invisible par le chef : retiré de la session, mais pas de son disque */
const HIDE = 'hide'
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
  /** Renommages reçus, à appliquer sur le disque (destination → origine) */
  renames: Map<string, string>
  /** Indications de renommage partagées (destination → origine) */
  moves: Y.Map<string>
  /** Dernier contenu binaire écrit par la session (pour ignorer l'écho du disque) */
  binWrites: Map<string, Uint8Array>
  /** Texte partagé auquel chaque document ouvert est lié */
  bound: Map<string, Y.Text>
  /** Pas d'état local fiable : attendre un autre participant avant d'importer le disque */
  awaitSync: boolean
  timers: { write?: number; save?: number; typing?: number; read?: number }
  offs: (() => void)[]
  /** Début de session : l'historique reçu à l'arrivée ne déclenche ni notification ni « a rejoint » */
  startedAt: number
  /** Invité : copie de travail temporaire, effacée à la fin de la session */
  guest: boolean
  /** Droits fixés par le chef (voir « Droits ») */
  rules: Y.Map<unknown>
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
  const ext: Extension[] = [yCollab(t, s.awareness), Prec.high(keymap.of(yUndoManagerKeymap))]
  // Lecture seule : ni frappe, ni insertion (copilot, commandes) ; seules les modifications reçues passent
  if (!canWrite(path))
    ext.push(
      EditorState.readOnly.of(true),
      EditorState.transactionFilter.of((tr) => (tr.docChanged && !tr.annotation(ySyncAnnotation) ? [] : tr))
    )
  return ext
}

/** Relie (ou délie) les documents ouverts dont le texte partagé a changé (création, renommage, suppression) */
function syncBindings(): void {
  if (!s) return
  const stale = [...docs.keys()].filter((p) => (s!.bound.get(p) ?? null) !== textAt(p))
  if (stale.length) reconfigureCollab((p) => stale.includes(p))
}

// ---------------------------------------------------------------------------
// Droits
// ---------------------------------------------------------------------------
// Map partagée « rules », écrite par le seul chef de session : host (son identifiant), copies (les invités peuvent
// garder une copie), u:<identifiant> (droit d'une personne), f:<chemin> (fichier en lecture seule). Les fichiers
// invisibles ne sont jamais envoyés : leur liste reste chez le chef (réglages du projet).
// Chaque app applique les droits de son utilisateur (éditeur verrouillé, modifications du disque annulées) : une
// protection entre amis. Refuser une modification reçue ne serait pas plus sûr : Yjs bloquerait alors toutes les
// suivantes de son auteur, et la session divergerait.

const hostId = (): string | null => (s?.rules.get('host') as string | undefined) ?? null
export const amHost = (): boolean => !!s && hostId() === myUid()

function myRight(): UserRight {
  if (!s) return 'add'
  const h = hostId()
  // Session sans chef (créée avant la 1.2.2) : tout le monde modifie
  if (!h || h === myUid()) return 'add'
  return (s.rules.get(`u:${myUid()}`) as UserRight | undefined) ?? 'ro'
}

/** Ce fichier peut être modifié (la restriction de la personne l'emporte toujours sur celle du fichier) */
export function canWrite(path: string): boolean {
  if (!s?.root) return true
  return myRight() !== 'ro' && (amHost() || s.rules.get(`f:${path}`) !== 'ro')
}

export const canAdd = (): boolean => !s?.root || myRight() === 'add'

/** Chef de session : fichier invisible pour les autres */
const isHidden = (path: string): boolean => !!s?.root && !!store.get().settings.projects[s.root]?.collabHidden?.includes(path)

let lastRefusal = 0
function refused(): void {
  if (Date.now() - lastRefusal < 5000) return
  lastRefusal = Date.now()
  toast(
    myRight() === 'ro'
      ? 'Tu es en lecture seule dans cette session : la modification a été annulée.'
      : 'Le chef de session ne permet pas cette modification : elle a été annulée.',
    'info',
    undefined,
    6000
  )
}

/** Action sur les fichiers (création, import, renommage, suppression) permise par les droits ; sinon prévient */
export function collabAllows(kind: 'add' | 'write', path = ''): boolean {
  if (!s?.root) return true
  const sess = s
  const ok = kind === 'add' ? canAdd() : [...sess.files.keys()].filter((k) => k === path || k.startsWith(path + '/')).every(canWrite)
  if (!ok) {
    lastRefusal = 0
    toast(
      myRight() === 'ro'
        ? 'Tu es en lecture seule dans cette session.'
        : kind === 'add'
          ? 'Le chef de session ne t’a pas permis d’ajouter des fichiers.'
          : 'Ce fichier est en lecture seule dans cette session.',
      'info'
    )
  }
  return ok
}

/** Copie des droits pour l'interface ; les éditeurs ouverts sont verrouillés ou déverrouillés en conséquence */
function publishRules(): void {
  if (!s) return
  const rules: CollabState['rules'] = { host: hostId(), copies: s.rules.get('copies') !== false, users: {}, files: {} }
  s.rules.forEach((v, k) => {
    if (k.startsWith('u:')) rules.users[k.slice(2)] = v as UserRight
    else if (k.startsWith('f:') && v === 'ro') rules.files[k.slice(2)] = 'ro'
  })
  setCollab({ rules })
  reconfigureCollab()
}

/** Chef : droit d'une personne, mémorisé pour ses prochaines sessions */
export function setUserRight(uid: string, right: UserRight): void {
  if (!s || !amHost()) return
  s.rules.set(`u:${uid}`, right)
  void updateSettings({ collabKnown: { ...store.get().settings.collabKnown, [uid]: right } })
}

/** Chef : droit d'un fichier. Invisible : retiré de la session (chez les autres), gardé sur son disque */
export async function setFileRight(path: string, right: FileRight): Promise<void> {
  if (!s?.root || !amHost()) return
  const sess = s
  const root = sess.root!
  const wasHidden = isHidden(path)
  await setHidden(root, path, right === 'hidden')
  sess.doc.transact(() => {
    if (right === 'ro') sess.rules.set(`f:${path}`, 'ro')
    else sess.rules.delete(`f:${path}`)
    if (right === 'hidden') sess.files.delete(path)
  }, HIDE)
  if (wasHidden && right !== 'hidden') await importAll()
}

export function setCopies(on: boolean): void {
  if (s && amHost()) s.rules.set('copies', on)
}

/** Fichiers invisibles d'un projet (réglages locaux du chef) */
async function setHidden(root: string, path: string, on: boolean): Promise<void> {
  const projects = store.get().settings.projects
  const cur = projects[root]?.collabHidden ?? []
  const next = on ? [...new Set([...cur, path])] : cur.filter((p) => p !== path)
  await updateSettings({ projects: { ...projects, [root]: { ...projects[root], collabHidden: next } } })
}

/** Session d'avant la 1.2.2 (sans chef) : on en devient le chef */
export function becomeHost(): void {
  if (!s?.root || hostId()) return
  s.rules.set('host', myUid())
}

/** Chef : une personne arrive ; si elle a déjà reçu un droit dans une autre session, elle le retrouve (sinon lecture seule) */
function welcome(uids: string[]): void {
  if (!s || !amHost()) return
  const known = store.get().settings.collabKnown
  for (const uid of uids) if (!s.rules.has(`u:${uid}`) && known[uid] && known[uid] !== 'ro') s.rules.set(`u:${uid}`, known[uid])
}

// ---------------------------------------------------------------------------
// Protocole (messages Yjs sur le réseau pair-à-pair)
// ---------------------------------------------------------------------------

function send(enc: encoding.Encoder, to?: string, except?: string | null): void {
  api.collabSend(encoding.toUint8Array(enc), to, except ?? undefined)
}

function greet(peer: string): void {
  if (!s) return
  const sync = encoding.createEncoder()
  encoding.writeVarUint(sync, MSG_SYNC)
  syncProtocol.writeSyncStep1(sync, s.doc)
  send(sync, peer)
  const aw = encoding.createEncoder()
  encoding.writeVarUint(aw, MSG_AWARENESS)
  // Toutes les présences connues (y compris celles relayées) : le nouveau venu voit tout le monde tout de suite
  encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(s.awareness, [...s.awareness.getStates().keys()]))
  send(aw, peer)
}

function forget(peer: string): void {
  if (!s) return
  const ids = s.peerClients.get(peer)
  s.peerClients.delete(peer)
  // Présences encore annoncées par un autre pair (participant joint aussi par un autre chemin) : conservées
  const still = new Set([...s.peerClients.values()].flatMap((set) => [...set]))
  const gone = [...(ids ?? [])].filter((id) => !still.has(id))
  if (gone.length) awarenessProtocol.removeAwarenessStates(s.awareness, gone, FORGET)
}

function receive(peer: string, data: Uint8Array): void {
  if (!s) return
  try {
    const dec = decoding.createDecoder(data)
    const type = decoding.readVarUint(dec)
    if (type === MSG_SYNC) {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      const kind = syncProtocol.readSyncMessage(dec, enc, s.doc, { peer } satisfies Remote)
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
      awarenessProtocol.applyAwarenessUpdate(s.awareness, update, { peer } satisfies Remote)
    }
  } catch {
    /* message illisible (version différente de l'app) : ignoré */
  }
}

function refreshPeople(): void {
  if (!s) return
  const people = [...s.awareness.getStates()]
    .filter(([id, st]) => id !== s!.doc.clientID && st.user)
    .map(([id, st]) => ({
      id,
      uid: String(st.user.uid ?? ''),
      name: String(st.user.name),
      color: String(st.user.color),
      file: (st.file as string | null) ?? null,
      typing: !!st.typing
    }))
  // Arrivées et départs, affichés dans la discussion (pas pour ceux déjà là à notre arrivée)
  const before = store.get().collab.people
  const events = [...store.get().collab.events]
  if (Date.now() - s.startedAt > 4000) {
    for (const p of people) if (!before.some((b) => b.id === p.id)) events.push({ ts: Date.now(), text: `${p.name} a rejoint la session` })
    for (const b of before) if (!people.some((p) => p.id === b.id)) events.push({ ts: Date.now(), text: `${b.name} a quitté la session` })
  }
  setCollab({ people, events })
  welcome(people.map((p) => p.uid).filter(Boolean))
}

// ---------------------------------------------------------------------------
// Discussion
// ---------------------------------------------------------------------------

const chatOf = (doc: Y.Doc): Y.Array<ChatMessage> => doc.getArray<ChatMessage>('chat')

function myUid(): string {
  let uid = store.get().settings.collabUserId
  if (!uid) {
    uid = crypto.randomUUID()
    void updateSettings({ collabUserId: uid })
  }
  return uid
}

export const isMine = (m: ChatMessage): boolean => m.uid === store.get().settings.collabUserId

export function sendChat(text: string, ref?: ChatMessage['ref']): void {
  if (!s?.root || (!text.trim() && !ref)) return
  const user = s.awareness.getLocalState()?.user as { name: string; color: string }
  const msg: ChatMessage = { id: crypto.randomUUID(), uid: myUid(), name: user.name, color: user.color, text: text.trim().slice(0, 2000), ts: Date.now() }
  if (ref) msg.ref = ref
  chatOf(s.doc).push([msg])
  setTyping(false)
}

/** « … écrit » : signalé aux autres via la présence (éphémère), retiré 3 s après la dernière frappe */
export function setTyping(on: boolean): void {
  if (!s) return
  clearTimeout(s.timers.typing)
  if (!!s.awareness.getLocalState()?.typing !== on) s.awareness.setLocalStateField('typing', on)
  if (on) s.timers.typing = window.setTimeout(() => setTyping(false), 3000)
}

export const chatVisible = (): boolean => {
  const st = store.get()
  return st.panel === 'chat' && st.settings.sidebarVisible && document.hasFocus()
}

/** Discussion lue (affichée, fenêtre au premier plan) : mémorisé par projet */
export function markChatRead(): void {
  if (!s?.root) return
  const root = s.root
  const count = store.get().collab.chat.length
  const sessions = store.get().settings.collabSessions
  if (!sessions[root] || sessions[root].chatRead === count) return
  clearTimeout(s.timers.read)
  s.timers.read = window.setTimeout(() => {
    const cur = store.get().settings.collabSessions
    if (cur[root]) void updateSettings({ collabSessions: { ...cur, [root]: { ...cur[root], chatRead: count } } })
  }, 300)
}

export function openChat(): void {
  store.set({ panel: 'chat' })
  if (!store.get().settings.sidebarVisible) void updateSettings({ sidebarVisible: true })
}

/** Nouveau message d'un autre participant : bulle dans l'app, ou notification du système si l'app est en arrière-plan */
function notifyMessage(m: ChatMessage): void {
  if (chatVisible()) return
  const body = m.text || (m.ref ? `📍 ${m.ref.file} : ${m.ref.line}` : '')
  if (!document.hasFocus()) {
    if (!store.get().settings.collabNotify) return
    const n = new Notification(`${m.name} · Lumen TeX`, { body: body.slice(0, 160), silent: true })
    n.onclick = () => {
      api.focusWindow()
      openChat()
    }
  } else toast(`${m.name} : ${body.slice(0, 90)}`, 'info', { label: 'Ouvrir', run: openChat }, 6000)
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
  if (!s?.root || tr.origin === DISK || tr.origin === INIT || tr.origin === HIDE) return
  for (const e of events) {
    if (e.target === s.files) e.changes.keys.forEach((_c, key) => s!.pending.add(key))
    else if (e.path.length) s.pending.add(String(e.path[0]))
  }
  clearTimeout(s.timers.write)
  s.timers.write = window.setTimeout(() => void flushWrites(), 250)
}

/** Renommages faits par un autre participant (destination → origine) : déplacés sur le disque, l'onglet suit */
function onMoves(e: Y.YMapEvent<string>, tr: Y.Transaction): void {
  if (!s?.root || tr.origin === DISK || tr.origin === INIT) return
  e.changes.keys.forEach((c, to) => {
    const from = c.action !== 'delete' ? e.target.get(to) : undefined
    if (from) s!.renames.set(to, from)
  })
}

async function flushWrites(): Promise<void> {
  if (!s?.root) return
  const sess = s
  const root = sess.root!
  let keys = [...sess.pending]
  sess.pending.clear()
  // L'état d'abord : si l'app s'arrête ici, la reprise ne réimporte pas ces changements comme les siens
  await persist()
  // Renommages : déplacer le fichier plutôt que le supprimer et le recréer ; les onglets ouverts suivent
  const renames = [...sess.renames].filter(([to, from]) => sess.files.get(to) !== undefined && sess.files.get(from) === undefined)
  sess.renames.clear()
  const followed: string[] = []
  for (const [to, from] of renames) {
    try {
      if ((await api.stat(`${root}/${from}`)).exists && !(await api.stat(`${root}/${to}`)).exists) await api.rename(root, from, to)
      if (store.get().tabs.includes(from)) {
        await followMove(from, to)
        followed.push(to)
      }
      keys = keys.filter((k) => k !== from)
    } catch {
      /* déplacement impossible : suppression et recréation ci-dessous */
    }
  }
  // Onglet déplacé : il reprend le texte partagé de sa nouvelle place (modifications faites pendant le renommage)
  if (followed.length) reconfigureCollab((p) => followed.includes(p))
  let removed = false
  for (const key of keys) {
    const v = sess.files.get(key)
    // Chef : un fichier reçu au chemin d'un de ses fichiers invisibles ne l'écrase pas
    if (isHidden(key)) continue
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
  // Dossiers vidés par ces déplacements et suppressions : retirés (seulement s'ils sont vides), du plus profond au plus haut
  const emptied = new Set<string>()
  for (const p of [...renames.map(([, from]) => from), ...keys.filter((k) => sess.files.get(k) === undefined)])
    for (let d = p; d.includes('/'); ) emptied.add((d = d.slice(0, d.lastIndexOf('/'))))
  for (const d of [...emptied].sort((a, b) => b.split('/').length - a.split('/').length)) await api.removeEmptyDir(root, d)
  if (removed || renames.length || emptied.size || keys.some((k) => !store.get().files.some((f) => f.path === k))) await refreshFiles()
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

/** Fichiers trop volumineux pour la session : restent sur l'ordinateur, la personne qui les a en est prévenue */
const mb = (n: number): string => `${Math.max(1, Math.round(n / 1e6))} Mo`
function setTooBig(path: string, size: number | null, announce = true): void {
  const list = store.get().collab.tooBig
  const known = list.some((f) => f.path === path)
  if (size === null) {
    if (known) setCollab({ tooBig: list.filter((f) => f.path !== path) })
    return
  }
  if (known) return
  setCollab({ tooBig: [...list, { path, size }] })
  if (announce)
    toast(`« ${path.split('/').pop()} » (${mb(size)}) n’est pas partagé : les fichiers de plus de 15 Mo restent sur ton ordinateur.`, 'info', undefined, 8000)
}

const sameBytes = (x: Uint8Array, y: Uint8Array): boolean => x.length === y.length && x.every((v, i) => v === y[i])

type Change = { path: string; text?: string; bin?: Uint8Array }

/** Fichier du disque à reporter dans la session, ou null s'il n'a pas changé (ou est trop volumineux) */
async function readChange(path: string): Promise<Change | null> {
  if (!s?.root || isHidden(path)) return null
  const sess = s
  if (TEXT_FILE.test(path)) {
    const text = await api.read(sess.root!, path)
    // Écho de nos propres écritures (éventuellement déjà dépassées par la frappe) : ignoré
    if (isOwnWrite(path, text)) return null
    const cur = sess.files.get(path)
    return cur instanceof Y.Text && cur.toString() === text ? null : { path, text }
  }
  const bin = await api.readBinary(sess.root!, path)
  if (bin.length > MAX_BINARY) {
    setTooBig(path, bin.length)
    return null
  }
  setTooBig(path, null)
  const own = sess.binWrites.get(path)
  if (own && sameBytes(own, bin)) return null
  const cur = sess.files.get(path)
  return cur instanceof Uint8Array && sameBytes(cur, bin) ? null : { path, bin }
}

/**
 * Un lot de changements du disque en une seule opération (reçue d'un bloc par les autres).
 * Fichier nouveau au contenu identique à un fichier disparu du même lot : renommage, signalé aux autres
 */
function applyDiskBatch(removed: string[], changes: Change[]): void {
  if (!s || (!removed.length && !changes.length)) return
  const sess = s
  // Interdit par les droits : le disque reprend le contenu de la session (fichier nouveau : retiré)
  const undo: string[] = []
  removed = removed.filter((k) => canWrite(k) || !undo.push(k))
  changes = changes.filter((c) => (sess.files.has(c.path) ? canWrite(c.path) : canAdd()) || !undo.push(c.path))
  if (undo.length) {
    undo.forEach((k) => sess.pending.add(k))
    clearTimeout(sess.timers.write)
    sess.timers.write = window.setTimeout(() => void flushWrites(), 250)
    refused()
  }
  if (!removed.length && !changes.length) return
  const { doc, files, moves } = s
  const gone = new Set(removed)
  const renamed: [string, string][] = []
  for (const c of changes) {
    if (files.has(c.path)) continue
    for (const r of gone) {
      const old = files.get(r)
      const same =
        c.text !== undefined ? old instanceof Y.Text && old.toString() === c.text : old instanceof Uint8Array && !!c.bin && sameBytes(old, c.bin)
      if (same) {
        renamed.push([c.path, r])
        gone.delete(r)
        break
      }
    }
  }
  doc.transact(() => {
    for (const k of new Set(removed)) files.delete(k)
    for (const c of changes) {
      const cur = files.get(c.path)
      if (c.text !== undefined) {
        if (cur instanceof Y.Text) applyDiff(cur, c.text)
        else files.set(c.path, new Y.Text(c.text))
      } else if (c.bin) files.set(c.path, c.bin)
    }
    for (const [to, from] of renamed) moves.set(to, from)
  }, DISK)
}

/** Fichiers modifiés sur le disque (surveillance du dossier) → session */
export async function collabDiskChanged(paths: string[]): Promise<void> {
  if (!s?.root || s.awaitSync) return
  const sess = s
  const root = sess.root!
  const removed: string[] = []
  const changes: Change[] = []
  for (const p of paths) {
    try {
      const st = await api.stat(`${root}/${p}`)
      if (!st.exists) {
        store.get().collab.tooBig.filter((f) => f.path === p || f.path.startsWith(p + '/')).forEach((f) => setTooBig(f.path, null))
        removed.push(...[...sess.files.keys()].filter((k) => k === p || k.startsWith(p + '/')))
      } else if (st.isDir) {
        for (const f of await api.list(root)) {
          if (f.isDir || !f.path.startsWith(p + '/')) continue
          const c = await readChange(f.path)
          if (c) changes.push(c)
        }
      } else {
        const c = await readChange(p)
        if (c) changes.push(c)
      }
    } catch {
      /* fichier en cours d'écriture : le prochain événement le reprendra */
    }
  }
  if (s !== sess) return
  applyDiskBatch(removed, changes)
  syncBindings()
}

/** Tout le dossier → session : fichiers nouveaux, modifiés, renommés ou supprimés hors session */
async function importAll(): Promise<void> {
  if (!s?.root) return
  const sess = s
  const onDisk = (await api.list(sess.root!)).filter((f) => !f.isDir).map((f) => f.path)
  const changes: Change[] = []
  for (const p of onDisk) {
    const c = await readChange(p).catch(() => null)
    if (c) changes.push(c)
  }
  if (s !== sess) return
  applyDiskBatch(
    [...sess.files.keys()].filter((k) => !onDisk.includes(k)),
    changes
  )
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
  awareness.setLocalStateField('user', { name, color, colorLight: color + '33', uid: myUid() })
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
    renames: new Map(),
    moves: doc.getMap<string>('moves'),
    binWrites: new Map(),
    bound: new Map(),
    awaitSync,
    timers: {},
    offs: [],
    startedAt: Date.now(),
    guest: role === 'guest',
    rules: doc.getMap<unknown>('rules')
  }
  s = sess

  // Modifications locales et reçues : envoyées à tous les pairs, sauf celui dont elles viennent.
  // Une modification déjà connue ne produit pas de nouvel événement : la retransmission s'arrête d'elle-même
  const onUpdate = (update: Uint8Array, origin: unknown): void => {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_SYNC)
    syncProtocol.writeUpdate(enc, update)
    send(enc, undefined, remotePeer(origin))
    schedulePersist()
  }
  const onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown): void => {
    if (origin !== FORGET) {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_AWARENESS)
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]))
      send(enc, undefined, remotePeer(origin))
    }
    refreshPeople()
  }
  const chat = chatOf(doc)
  const onChat = (e: Y.YArrayEvent<ChatMessage>, tr: Y.Transaction): void => {
    setCollab({ chat: chat.toArray() })
    if (!remotePeer(tr.origin)) return
    for (const d of e.changes.delta)
      for (const m of (d.insert as ChatMessage[] | undefined) ?? []) if (!isMine(m) && m.ts > sess.startedAt - 5000) notifyMessage(m)
  }
  const onRules = (): void => publishRules()
  sess.rules.observe(onRules)
  sess.offs.push(() => sess.rules.unobserve(onRules))
  doc.on('update', onUpdate)
  awareness.on('update', onAwareness)
  sess.files.observeDeep(onFilesChanged)
  sess.moves.observe(onMoves)
  chat.observe(onChat)
  let lastActive = getActivePath()
  sess.offs.push(
    () => doc.off('update', onUpdate),
    () => awareness.off('update', onAwareness),
    () => sess.files.unobserveDeep(onFilesChanged),
    () => sess.moves.unobserve(onMoves),
    () => chat.unobserve(onChat),
    api.onCollabPeer((id, joined) => (joined ? greet(id) : forget(id))),
    api.onCollabData(receive),
    api.onCollabStatus((net) => setCollab({ net })),
    // Fichier ouvert : visible des autres participants
    store.subscribe(() => {
      const a = store.get().active
      if (a !== lastActive) awareness.setLocalStateField('file', (lastActive = a))
    })
  )
  setCollab({ active: true, code, role, joining: !root, people: [], chat: chat.toArray(), events: [], tooBig: [], net: { state: 'starting', peers: 0 } })
  publishRules()
  await api.collabStart(code)
}

/** Première synchronisation reçue : arrivée d'un invité, ou reprise sans état local */
async function onFirstSync(): Promise<void> {
  if (!s) return
  const sess = s
  if (!sess.root) {
    const name = sess.meta.get('name')
    if (!name) return
    const folder = await api.collabGuestDir(sess.code, name)
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

/** Partage le projet ouvert : son contenu devient l'état initial de la session, avec les droits choisis avant */
export async function shareProject(opts: { copies: boolean; files: Record<string, FileRight> }): Promise<void> {
  const { root, projectName } = store.get()
  if (!root || s) return
  const hidden = Object.keys(opts.files).filter((p) => opts.files[p] === 'hidden')
  const projects = store.get().settings.projects
  await updateSettings({ projects: { ...projects, [root]: { ...projects[root], collabHidden: hidden } } })
  await saveAll()
  const code = await api.collabNewCode()
  const doc = new Y.Doc()
  const entries: [string, Entry][] = []
  const tooBig: { path: string; size: number }[] = []
  for (const f of await api.list(root)) {
    if (f.isDir || hidden.includes(f.path)) continue
    try {
      if (TEXT_FILE.test(f.path)) entries.push([f.path, new Y.Text(await api.read(root, f.path))])
      else {
        const bin = await api.readBinary(root, f.path)
        if (bin.length <= MAX_BINARY) entries.push([f.path, bin])
        else tooBig.push({ path: f.path, size: bin.length })
      }
    } catch {
      /* illisible : non partagé */
    }
  }
  doc.transact(() => {
    const files = doc.getMap<Entry>('files')
    for (const [p, v] of entries) files.set(p, v)
    doc.getMap<string>('meta').set('name', projectName)
    const rules = doc.getMap<unknown>('rules')
    rules.set('host', myUid())
    rules.set('copies', opts.copies)
    for (const [p, r] of Object.entries(opts.files)) if (r === 'ro') rules.set(`f:${p}`, 'ro')
  }, INIT)
  await updateSettings({ collabSessions: { ...store.get().settings.collabSessions, [root]: { code } } })
  await begin(code, root, doc, 'host', false)
  await persist()
  reconfigureCollab()
  if (tooBig.length) {
    setCollab({ tooBig })
    toast(
      tooBig.length === 1
        ? `« ${tooBig[0].path.split('/').pop()} » (${mb(tooBig[0].size)}) n’est pas partagé : les fichiers de plus de 15 Mo restent sur ton ordinateur.`
        : `${tooBig.length} fichiers de plus de 15 Mo ne sont pas partagés (liste dans la fenêtre de partage).`,
      'info',
      undefined,
      8000
    )
  }
}

/** Rejoint une session : le projet arrivera dans une copie de travail temporaire */
export async function joinSession(rawCode: string): Promise<boolean> {
  const code = await api.collabNormalizeCode(rawCode)
  if (!code) return false
  if (s) await stopSession({ forget: false })
  if (store.get().root) await closeProject()
  await begin(code, null, new Y.Doc(), 'guest', false)
  return true
}

/** Invité : copie indépendante du projet dans Documents/Lumen TeX partagés (si le chef le permet) */
export async function keepCopy(): Promise<string | null> {
  if (!s?.root || !s.guest || s.rules.get('copies') === false) return null
  if (s.pending.size) await flushWrites()
  await saveAll()
  return api.collabKeepCopy(s.root)
}

export const isGuestSession = (): boolean => !!s?.guest

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
  clearTimeout(sess.timers.typing)
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
  setCollab({ active: false, code: '', joining: false, people: [], chat: [], events: [], tooBig: [], rules: NO_RULES, net: { state: 'off', peers: 0 } })
  if (store.get().panel === 'chat') store.set({ panel: 'files' })
}
