import { setDiagnostics, type Diagnostic } from '@codemirror/lint'
import type { EditorState } from '@codemirror/state'
import type { LeanDiag } from '../../../shared/types'
import { getActivePath, getView, reconfigureAll, textOf } from '../editor/setup'
import { store, type LeanState } from '../store'

// Fichiers .lean ouverts dans l'éditeur : envoyés au serveur Lean (seulement le fichier actif et ceux déjà vus),
// messages soulignés dans l'éditeur, buts à la position du curseur pour le panneau Lean

const api = window.api
export const isLean = (p: string | null | undefined): p is string => !!p && /\.lean$/i.test(p)
const abs = (rel: string): string => `${store.get().root}/${rel}`
const relOf = (file: string): string | null => {
  const root = store.get().root
  return root && file.startsWith(root + '/') ? file.slice(root.length + 1) : null
}
const setLean = (patch: Partial<LeanState>): void => store.set((s) => ({ lean: { ...s.lean, ...patch } }))

/** Fichiers déjà envoyés au serveur (ouverts), modifications en attente */
const synced = new Set<string>()
const timers = new Map<string, number>()

export function initLean(): () => void {
  const offs = [
    api.onLeanProgress((p) => setLean({ install: p })),
    api.onLeanDiagnostics((file, d) => {
      const rel = relOf(file)
      if (!rel) return
      setLean({ diags: { ...store.get().lean.diags, [rel]: d } })
      if (rel === getActivePath()) applyLeanLint()
    }),
    api.onLeanBusy((file, busy) => {
      const rel = relOf(file)
      if (!rel) return
      setLean({ busy: { ...store.get().lean.busy, [rel]: busy } })
      if (!busy) refreshGoals()
    })
  ]
  return () => offs.forEach((off) => off())
}

/** Lean installé : coches des preuves dans les documents, fichier .lean actif envoyé au serveur */
export function leanInstalled(): void {
  reconfigureAll()
  leanShown(getActivePath())
}

/** Fichier affiché : ouvert dans le serveur Lean la première fois */
export function leanShown(path: string | null): void {
  if (!isLean(path) || synced.has(path) || !store.get().lean.status.ready) return
  const text = textOf(path)
  if (text === null) return
  synced.add(path)
  void api.leanSync(abs(path), text)
  refreshGoals()
}

export function leanChanged(path: string, state: EditorState): void {
  if (!synced.has(path)) return leanShown(path)
  clearTimeout(timers.get(path))
  timers.set(
    path,
    window.setTimeout(() => {
      timers.delete(path)
      void api.leanSync(abs(path), state.doc.toString())
    }, 250)
  )
}

export function leanClosed(path: string): void {
  if (!synced.delete(path)) return
  clearTimeout(timers.get(path))
  timers.delete(path)
  void api.leanClose(abs(path))
  const { diags, busy } = store.get().lean
  const d = { ...diags }
  const b = { ...busy }
  delete d[path]
  delete b[path]
  setLean({ diags: d, busy: b })
}

/** Fichier remplacé hors de l'éditeur (par l'app) : le serveur reçoit le nouveau contenu */
export function leanReplaced(path: string): void {
  const text = textOf(path)
  if (synced.has(path) && text !== null) void api.leanSync(abs(path), text)
}

let goalTimer: number | undefined
let goalSeq = 0

/** Buts à la position du curseur dans le fichier .lean actif */
export function refreshGoals(): void {
  clearTimeout(goalTimer)
  goalTimer = window.setTimeout(() => {
    const path = getActivePath()
    const view = getView()
    if (!isLean(path) || !view || !synced.has(path)) return setLean({ goals: null })
    const head = view.state.selection.main.head
    const line = view.state.doc.lineAt(head)
    const seq = ++goalSeq
    void api.leanGoal(abs(path), line.number - 1, head - line.from).then((goals) => {
      if (seq === goalSeq) setLean({ goals })
    })
  }, 150)
}

/** Position dans le document d'un message de Lean (bornée au document actuel) */
function pos(state: EditorState, line: number, col: number): number {
  const l = state.doc.line(Math.min(Math.max(1, line), state.doc.lines))
  return Math.min(l.to, l.from + col)
}

/** Messages de Lean soulignés dans l'éditeur (fichier actif) */
export function applyLeanLint(): void {
  const path = getActivePath()
  const view = getView()
  if (!isLean(path) || !view) return
  const list: Diagnostic[] = (store.get().lean.diags[path] ?? []).map((d: LeanDiag) => {
    const from = pos(view.state, d.line, d.col)
    const to = d.endLine ? Math.max(from, pos(view.state, d.endLine, d.endCol ?? 0)) : from
    return { from, to, severity: d.severity, message: d.message }
  })
  view.dispatch(setDiagnostics(view.state, list))
}

/** Problèmes d'un fichier .lean, pour l'assistant IA */
export function leanProblems(path: string): string[] {
  return (store.get().lean.diags[path] ?? [])
    .filter((d) => d.severity !== 'info')
    .slice(0, 15)
    .map((d) => `- ${d.severity === 'error' ? 'Erreur' : 'Avertissement'} ${path}:${d.line} : ${d.message.slice(0, 600)}`)
}
