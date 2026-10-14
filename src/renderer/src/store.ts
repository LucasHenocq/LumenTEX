import { useSyncExternalStore } from 'react'
import type { LeanStep } from './lib/leanSteps'
import type { ChatMessage, CollabNetStatus, CompileResult, Diagnostic, ExtensionInfo, FileEntry, LeanDiag, LeanProgress, LeanStatus, Settings, TectonicStatus, UserRight } from '../../shared/types'

export type SidebarPanel = 'files' | 'outline' | 'symbols' | 'search' | 'chat' | 'extensions' | `ext:${string}`

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
  /** Question au style de l'app (extensions, session) */
  | { type: 'dialog'; req: import('./lib/dialog').DialogRequest; resolve: (a: import('./lib/dialog').DialogAnswer) => void }
  | null

/** Fin d'une vérification par l'IA : énoncé et étapes à valider (acceptée par Lean), ou étapes en cause (refused) */
export interface LeanVerdict {
  env: string
  title: string
  statement: string
  lean: string
  explanation: string
  steps?: LeanStep[]
  refused?: boolean
  resolve: (ok: boolean) => void
}

/** Vérification d'une preuve par l'IA, suivie dans la fenêtre flottante (qui peut être fermée puis rouverte) */
export interface ProofRun {
  /** Énoncé vérifié, pour le titre de la fenêtre */
  title: string
  open: boolean
  /** Ce qui se passe : « L'IA écrit le Lean… », « Lean vérifie… » */
  phase: string
  /** Un tour : réponse de l'IA (au fil de l'eau), puis ce qu'en dit Lean */
  rounds: { ai: string; lean: string | null; ok: boolean | null }[]
  verdict: LeanVerdict | null
  /** L'IA n'a pas abouti : message, et fichier Lean à ouvrir */
  failure: { text: string; lean: string | null } | null
  done: boolean
}

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
  action?: { label: string; run: () => void }
}

/** Session partagée (pair-à-pair) vue par l'interface */
export const NO_RULES: CollabState['rules'] = { host: null, copies: true, users: {}, files: {} }

export interface CollabState {
  active: boolean
  code: string
  role: 'host' | 'guest'
  net: CollabNetStatus
  /** Invité en attente du contenu de la session (avant la création du dossier) */
  joining: boolean
  /** Autres participants, d'après leur présence (nom, couleur, fichier ouvert, en train d'écrire) */
  people: { id: number; uid: string; name: string; color: string; file: string | null; typing: boolean; dev: { name: string; version: string }[] }[]
  /** Discussion de la session (ordre partagé par tous) */
  chat: ChatMessage[]
  /** Arrivées et départs, affichés localement dans la discussion (non conservés) */
  events: { ts: number; text: string }[]
  /** Fichiers de ce projet trop volumineux pour être partagés (restent sur l'ordinateur) */
  tooBig: { path: string; size: number }[]
  /** Droits fixés par le chef (host : son identifiant, null pour une session d'avant la 1.2.2) */
  rules: { host: string | null; copies: boolean; users: Record<string, UserRight>; files: Record<string, 'ro'> }
}

/** Lean : installation, et fichiers .lean ouverts (messages, vérification en cours, buts au curseur) */
export interface LeanState {
  status: LeanStatus
  /** Installation en cours (étape affichée), ou terminée en erreur */
  install: LeanProgress | null
  diags: Record<string, LeanDiag[]>
  busy: Record<string, boolean>
  /** Buts au curseur du fichier actif ; null hors d'une preuve */
  goals: string[] | null
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
  lean: LeanState
  proofRun: ProofRun | null
  /** Extensions installées */
  extensions: ExtensionInfo[]
  /** Compilateurs enregistrés, ou leur disponibilité, ont changé (menus à redessiner) */
  compilersVersion: number
  /** Apports des extensions avec code : panneaux, éléments de la barre d'état, commandes */
  extUi: { panels: ExtPanel[]; status: ExtStatusItem[]; commands: ExtCommand[] }
  /** Journal des extensions (messages et erreurs) */
  extLogs: ExtLog[]
}

export interface ExtPanel {
  key: `ext:${string}`
  extId: string
  title: string
  /** Icône SVG (data URL), vide = pièce de puzzle */
  icon: string
  /** Extension de confiance : élément dessiné par elle ; isolée : son cadre est le panneau */
  el: HTMLElement | null
}
export interface ExtStatusItem {
  key: string
  extId: string
  text: string
  tooltip: string
  onClick: (() => void) | null
}
export interface ExtCommand {
  id: string
  extId: string
  label: string
  shortcut: string
  run: () => unknown
}
export interface ExtLog {
  ts: number
  extId: string
  level: 'log' | 'info' | 'warn' | 'error'
  text: string
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
  lean: { status: { ready: false }, install: null, diags: {}, busy: {}, goals: null },
  proofRun: null,
  extensions: [],
  compilersVersion: 0,
  extUi: { panels: [], status: [], commands: [] },
  extLogs: [],
  collab: { active: false, code: '', role: 'host', net: { state: 'off', peers: 0 }, joining: false, people: [], chat: [], events: [], tooBig: [], rules: NO_RULES }
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
