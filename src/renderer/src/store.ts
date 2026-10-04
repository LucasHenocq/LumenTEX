import { useSyncExternalStore } from 'react'
import type { ChatMessage, CollabNetStatus, CompileResult, Diagnostic, FileEntry, Settings, TectonicStatus } from '../../shared/types'

export type SidebarPanel = 'files' | 'outline' | 'symbols' | 'search' | 'chat'

export type Modal =
  | { type: 'new-project' }
  | { type: 'settings' }
  | { type: 'table'; matrix?: boolean }
  | { type: 'palette'; mode: 'commands' | 'files' }
  | { type: 'shortcuts' }
  /** file : chemin absolu d'une image ou d'un PDF à charger d'emblée */
  | { type: 'convert'; file?: string }
  /** join : ouvre directement « Rejoindre une session » */
  | { type: 'collab'; join?: boolean }
  /** since : nouveautés installées depuis cette version ; absent : historique complet */
  | { type: 'whats-new'; since?: string }
  | null

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
  action?: { label: string; run: () => void }
}

/** Session partagée (pair-à-pair) vue par l'interface */
export interface CollabState {
  active: boolean
  code: string
  role: 'host' | 'guest'
  net: CollabNetStatus
  /** Invité en attente du contenu de la session (avant la création du dossier) */
  joining: boolean
  /** Autres participants, d'après leur présence (nom, couleur, fichier ouvert, en train d'écrire) */
  people: { id: number; name: string; color: string; file: string | null; typing: boolean }[]
  /** Discussion de la session (ordre partagé par tous) */
  chat: ChatMessage[]
  /** Arrivées et départs, affichés localement dans la discussion (non conservés) */
  events: { ts: number; text: string }[]
  /** Fichiers de ce projet trop volumineux pour être partagés (restent sur l'ordinateur) */
  tooBig: { path: string; size: number }[]
}

export type CompileStatus = 'idle' | 'running' | 'success' | 'warning' | 'error'

export interface AppState {
  ready: boolean
  settings: Settings
  root: string | null
  projectName: string
  mainFile: string | null
  files: FileEntry[]
  tabs: string[]
  active: string | null
  dirty: Record<string, boolean>
  compileStatus: CompileStatus
  compileProgress: string
  result: CompileResult | null
  diagnostics: Diagnostic[]
  pdf: { path: string; version: number } | null
  panel: SidebarPanel
  logOpen: boolean
  modal: Modal
  tectonic: TectonicStatus | null
  toasts: Toast[]
  cursor: { line: number; col: number; sel: number }
  indexVersion: number
  wordCount: number
  pdfPage: number
  pdfPages: number
  pdfScale: number
  resolvedDark: boolean
  collab: CollabState
  /** macOS : téléchargement de la mise à jour en cours (pourcentage) */
  updateProgress: number | null
}

type Listener = () => void

function createStore<T extends object>(initial: T) {
  let state = initial
  const listeners = new Set<Listener>()
  const get = (): T => state
  const set = (patch: Partial<T> | ((s: T) => Partial<T>)): void => {
    const next = typeof patch === 'function' ? patch(state) : patch
    let changed = false
    for (const k in next) {
      if (!Object.is(next[k], state[k])) {
        changed = true
        break
      }
    }
    if (!changed) return
    state = { ...state, ...next }
    listeners.forEach((l) => l())
  }
  const subscribe = (l: Listener): (() => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }
  function use<S>(selector: (s: T) => S): S {
    return useSyncExternalStore(subscribe, () => selector(state))
  }
  return { get, set, subscribe, use }
}

export const store = createStore<AppState>({
  ready: false,
  settings: {} as Settings,
  root: null,
  projectName: '',
  mainFile: null,
  files: [],
  tabs: [],
  active: null,
  dirty: {},
  compileStatus: 'idle',
  compileProgress: '',
  result: null,
  diagnostics: [],
  pdf: null,
  panel: 'files',
  logOpen: false,
  modal: null,
  tectonic: null,
  toasts: [],
  cursor: { line: 1, col: 1, sel: 0 },
  indexVersion: 0,
  wordCount: 0,
  pdfPage: 1,
  pdfPages: 0,
  pdfScale: 1,
  resolvedDark: false,
  updateProgress: null,
  collab: { active: false, code: '', role: 'host', net: { state: 'off', peers: 0 }, joining: false, people: [], chat: [], events: [], tooBig: [] }
})

export const useApp = store.use

let toastId = 0
export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action'], ms = 3800): void {
  const id = ++toastId
  store.set((s) => ({ toasts: [...s.toasts, { id, kind, text, action }] }))
  setTimeout(() => store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms)
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  store.set((s) => ({ settings: { ...s.settings, ...patch } }))
  await window.api.setSettings(patch)
}
