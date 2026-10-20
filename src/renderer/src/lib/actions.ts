import { snippet } from '@codemirror/autocomplete'
import { toggleComment } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { CompileResult, Diagnostic, FileEntry, TemplateFile } from '../../../shared/types'
import { countWords, isRootDocument } from '../latex/analysis'
import {
  closeDoc,
  docs,
  getActivePath,
  getView,
  hooks,
  isDirty,
  markSaved,
  openDoc,
  reconfigureAll,
  renameDoc,
  replaceContent,
  showDoc,
  stateOf,
  textOf
} from '../editor/setup'
import { refreshLint, wrapSelection } from '../editor/features'
import { store, toast, updateSettings } from '../store'
import { emit } from './bus'
import { contents, removeContent, setAllContents, setFileList, updateContent } from './projectIndex'
import { collabActive, collabAllows, collabDiskChanged, onProjectOpened, stopSession } from './collab'
import { isLean, leanChanged, leanClosed, leanShown, refreshGoals } from './lean'
import { availabilityOf, canBeMain, checkCompiler, compilerFor, compilersFor, languageOf, recheckCompilers, registerCompiler, type Compiler, type CompileOutput } from './languages'

const api = window.api

/** Renseigné par proofs.ts : numéros (dans l'ordre du document) des preuves vérifiées par Lean à marquer dans le PDF */
export const compileHooks = { leanQed: async (_main: string): Promise<number[]> => [] }

export const TEXT_FILE = /\.(tex|bib|sty|cls|bst|txt|md|ltx|dtx|ins|cfg|def|clo|bbx|cbx|lbx|tikz|pgf|csv|dat|json|ya?ml|latexmkrc|log|lean)$/i
/** Fichier texte : extensions connues, ou langage enregistré (ceux des extensions compris) */
export const isTextFile = (path: string): boolean => TEXT_FILE.test(path) || !!languageOf(path)
export const IMAGE_FILE = /\.(png|jpe?g|gif|bmp|svg|webp|tiff?)$/i

const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
// Windows : l'interface raisonne en « / », Node les accepte aussi
const slashes = (p: string): string => p.replace(/\\/g, '/')
const dirname = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

// ---------------------------------------------------------------------------
// État « modifié »
// ---------------------------------------------------------------------------

function refreshDirty(path: string): void {
  const dirty = isDirty(path)
  const cur = store.get().dirty
  if (!!cur[path] === dirty) return
  const next = { ...cur }
  if (dirty) next[path] = true
  else delete next[path]
  store.set({ dirty: next })
  api.setDirty(Object.keys(next).length > 0)
}

// ---------------------------------------------------------------------------
// Crochets de l'éditeur
// ---------------------------------------------------------------------------

let indexTimer: number | undefined
let compileTimer: number | undefined
let wordTimer: number | undefined

hooks.onDocChanged = (path, state) => {
  refreshDirty(path)
  emit('doc:changed', path)
  if (isLean(path)) leanChanged(path, state)
  clearTimeout(indexTimer)
  indexTimer = window.setTimeout(() => updateContent(path, state.doc.toString()), 400)
  const s = store.get().settings
  if (s.autoCompile && (languageOf(path)?.autoCompile ?? !!languageOf(path))) {
    clearTimeout(compileTimer)
    compileTimer = window.setTimeout(() => void compile({ auto: true }), Math.max(300, s.compileDelay))
  }
  scheduleWordCount()
}

hooks.onSelection = (state) => {
  const sel = state.selection.main
  const line = state.doc.lineAt(sel.head)
  store.set({ cursor: { line: line.number, col: sel.head - line.from + 1, sel: Math.abs(sel.to - sel.from) } })
  if (isLean(getActivePath())) refreshGoals()
}

hooks.syncForward = (path, line) => void syncForward(path, line)

hooks.dropFiles = (files, view, pos) => void dropFiles(files, view, pos)

function scheduleWordCount(): void {
  clearTimeout(wordTimer)
  wordTimer = window.setTimeout(() => {
    const active = getActivePath()
    const text = active ? textOf(active) : null
    store.set({ wordCount: text && /\.tex$/i.test(active!) ? countWords(text) : 0 })
  }, 500)
}

// ---------------------------------------------------------------------------
// Projet
// ---------------------------------------------------------------------------

/** Fichier principal probable : un document complet (LaTeX : \documentclass) de préférence, main.* d'abord */
export function guessMainFile(files: FileEntry[], all: Record<string, string>): string | null {
  // Texte inconnu (non lu à l'ouverture) : retenu seulement si son langage n'exige rien du contenu
  const roots = files
    .filter((f) => !f.isDir && canBeMain(f.path, all[f.path]) && (all[f.path] !== undefined || !languageOf(f.path)?.isMain))
    .map((f) => f.path)
  const pick = (list: string[]): string | null =>
    list.find((f) => /^main\.[^./]+$/i.test(f)) ??
    list.find((f) => /^(these|thesis|memoire|rapport|report|article|document|cv)\.[^.]+$/i.test(basename(f))) ??
    list.sort((a, b) => a.split('/').length - b.split('/').length)[0] ??
    null
  return pick(roots)
}

export async function openProject(root: string, opts: { openFile?: string } = {}): Promise<void> {
  root = slashes(root)
  const stat = await api.stat(root)
  if (!stat.exists) {
    toast('Ce dossier n’existe plus', 'error')
    await api.removeRecent(root)
    store.set({ settings: await api.getSettings() })
    return
  }
  if (store.get().root) await closeProject()

  let files = await api.list(root)
  const all = await api.readAllText(root)
  // Fichier ouvert explicitement : toujours l'intégrer, même si le dossier n'est pas listable
  if (opts.openFile) {
    if (!files.some((f) => f.path === opts.openFile)) files = [...files, { path: opts.openFile, isDir: false }]
    if (all[opts.openFile] === undefined) {
      try {
        all[opts.openFile] = await api.read(root, opts.openFile)
      } catch {
        /* illisible */
      }
    }
  }
  setAllContents(all)
  setFileList(files.filter((f) => !f.isDir).map((f) => f.path))

  const settings = await api.addRecent(root)
  const prefs = settings.projects[root] ?? {}
  // Fichiers mémorisés (onglets, principal) absents du listage mais toujours présents sur le disque
  const listed = new Set(files.map((f) => f.path))
  for (const p of new Set([...(prefs.openTabs ?? []), ...(prefs.mainFile ? [prefs.mainFile] : [])])) {
    if (p.startsWith('.lumentex/')) continue
    if (listed.has(p) || !(await api.stat(`${root}/${p}`)).exists) continue
    files = [...files, { path: p, isDir: false }]
    if (/\.(tex|bib)$/i.test(p)) {
      try {
        all[p] = await api.read(root, p)
      } catch {
        /* illisible */
      }
    }
  }
  setAllContents(all)
  setFileList(files.filter((f) => !f.isDir).map((f) => f.path))
  const fileSet = new Set(files.filter((f) => !f.isDir).map((f) => f.path))
  let mainFile = prefs.mainFile && fileSet.has(prefs.mainFile) ? prefs.mainFile : guessMainFile(files, all)
  if (opts.openFile && all[opts.openFile] !== undefined && canBeMain(opts.openFile, all[opts.openFile])) mainFile = opts.openFile

  store.set({
    settings,
    root,
    projectName: basename(root),
    files,
    mainFile,
    tabs: [],
    active: null,
    dirty: {},
    diagnostics: [],
    result: null,
    pdf: null,
    compileStatus: 'idle',
    compileProgress: '',
    panel: 'files'
  })
  document.title = `${basename(root)} — Lumen TeX`
  await api.watch(root)

  // Restaurer les onglets
  const tabs = (prefs.openTabs ?? []).filter((t) => fileSet.has(t))
  if (!tabs.length && mainFile) tabs.push(mainFile)
  for (const t of tabs) await openFile(t, { background: true })
  const active = opts.openFile ?? (prefs.active && tabs.includes(prefs.active) ? prefs.active : tabs[0])
  if (active) await openFile(active)

  // Afficher un PDF déjà compilé, puis compiler
  if (mainFile) {
    const paths = await api.buildPaths(root, mainFile)
    const pdf = await api.stat(paths.pdf)
    if (pdf.exists) store.set({ pdf: { path: paths.pdf, version: Date.now() } })
    const tectonic = store.get().tectonic
    if (tectonic?.found) void compile()
  }
  await onProjectOpened(root)
}

export async function closeProject(): Promise<void> {
  const { root } = store.get()
  if (!root) return
  await saveAll()
  await stopSession({ forget: false })
  persistTabs()
  for (const p of [...docs.keys()]) {
    closeDoc(p)
    leanClosed(p)
  }
  showDoc(null)
  await api.watch(null)
  compileDiags = []
  extDiags = []
  store.set({ root: null, files: [], tabs: [], active: null, mainFile: null, pdf: null, diagnostics: [], result: null, dirty: {} })
  api.setDirty(false)
  document.title = 'Lumen TeX'
  // Copie de travail d'un invité : la session est finie pour lui, rien n'en reste
  await api.collabDropGuest(root)
  store.set({ settings: await api.getSettings() })
}

function persistTabs(): void {
  const { root, tabs, active, mainFile, settings } = store.get()
  if (!root) return
  const projects = { ...settings.projects, [root]: { ...settings.projects[root], mainFile: mainFile ?? undefined, openTabs: tabs, active } }
  void updateSettings({ projects })
}

/** Aucun fichier principal (langage d'une extension pas encore chargée à l'ouverture) : nouvel essai */
export function ensureMainFile(): void {
  const { root, mainFile, files } = store.get()
  if (!root || mainFile) return
  const guess = guessMainFile(files, Object.fromEntries(contents))
  if (guess) void setMainFile(guess)
}

export async function setMainFile(path: string): Promise<void> {
  store.set({ mainFile: path })
  persistTabs()
  toast(`Fichier principal : ${basename(path)}`, 'success')
  await compile()
}

export async function refreshFiles(): Promise<void> {
  const { root } = store.get()
  if (!root) return
  let files = await api.list(root)
  // Conserver les fichiers ouverts absents du listage (dossier protégé par macOS, par ex.)
  const listed = new Set(files.map((f) => f.path))
  // Sauf les fichiers internes ouverts en onglet (preuves Lean dans .lumentex), qui restent hors de l'arbre
  const missing = store.get().tabs.filter((t) => !listed.has(t) && !t.startsWith('.lumentex/'))
  if (missing.length) files = [...files, ...missing.map((path) => ({ path, isDir: false }))]
  store.set({ files })
  setFileList(files.filter((f) => !f.isDir).map((f) => f.path))
}

// ---------------------------------------------------------------------------
// Onglets et fichiers
// ---------------------------------------------------------------------------

export async function openFile(path: string, opts: { background?: boolean; line?: number; col?: number } = {}): Promise<void> {
  const { root, tabs } = store.get()
  if (!root) return
  if (!docs.has(path) && (isTextFile(path) || !/\.\w+$/.test(path))) {
    try {
      const text = contents.get(path) ?? (await api.read(root, path))
      openDoc(path, text)
    } catch (e) {
      toast(`Impossible d’ouvrir ${path} : ${(e as Error).message}`, 'error')
      return
    }
  } else if (!docs.has(path) && !IMAGE_FILE.test(path)) {
    void api.openExternal(`${root}/${path}`)
    return
  }
  if (!tabs.includes(path)) store.set({ tabs: [...store.get().tabs, path] })
  if (opts.background) return
  store.set({ active: path })
  showDoc(docs.has(path) ? path : null)
  leanShown(path)
  persistTabs()
  scheduleWordCount()
  if (opts.line) {
    setTimeout(() => emit('editor:goto', { file: path, line: opts.line!, col: opts.col }), 0)
  }
}

export async function closeTab(path: string): Promise<void> {
  if (isDirty(path)) await saveFile(path)
  const { tabs, active } = store.get()
  const idx = tabs.indexOf(path)
  const next = tabs.filter((t) => t !== path)
  closeDoc(path)
  leanClosed(path)
  let newActive = active
  if (active === path) newActive = next[Math.min(idx, next.length - 1)] ?? null
  store.set({ tabs: next, active: newActive })
  if (active === path) showDoc(newActive && docs.has(newActive) ? newActive : null)
  if (active === path) leanShown(newActive)
  refreshDirty(path)
  persistTabs()
}

export async function saveFile(path: string): Promise<void> {
  const { root } = store.get()
  const text = textOf(path)
  if (!root || text === null) return
  try {
    await api.write(root, path, text)
    lastWrites.set(path, text)
    markSaved(path)
    refreshDirty(path)
    updateContent(path, text)
    emit('file:saved', path)
  } catch (e) {
    toast(`Échec de l’enregistrement de ${path} : ${(e as Error).message}`, 'error')
  }
}

export async function saveAll(): Promise<void> {
  for (const p of [...docs.keys()]) if (isDirty(p)) await saveFile(p)
}

/** Installe la mise à jour trouvée : redémarrage (Windows, Linux) ou .dmg téléchargé puis ouvert (macOS) */
export function installUpdate(): void {
  if (api.platform !== 'darwin') {
    void saveAll().then(() => api.installUpdate())
    return
  }
  store.set({ updateProgress: 0 })
  void api.installMacUpdate().finally(() => store.set({ updateProgress: null }))
}

const lastWrites = new Map<string, string>()

/** Contenu identique au dernier écrit par l'app : écho de sa propre écriture sur le disque */
export const isOwnWrite = (path: string, text: string): boolean => lastWrites.get(path) === text

/** Session partagée : écrit un fichier modifié par la session (sans le recharger ensuite depuis le disque) */
export async function writeFromSession(root: string, path: string, text: string): Promise<void> {
  if (store.get().root === root && docs.has(path) && textOf(path) === text) return saveFile(path)
  await api.write(root, path, text)
  lastWrites.set(path, text)
  if (store.get().root === root) updateContent(path, text)
}

export async function handleFsChanged(paths: string[]): Promise<void> {
  const { root } = store.get()
  if (!root) return
  await refreshFiles()
  emit('fs:changed', paths)
  // Session partagée : le disque alimente la session, qui met à jour l'éditeur (pas de rechargement ici)
  if (collabActive()) {
    await collabDiskChanged(paths)
    return
  }
  const known = new Set(store.get().files.map((f) => f.path))
  for (const p of paths) {
    if (!known.has(p)) {
      if (contents.has(p)) removeContent(p)
      continue
    }
    // Fichiers ouverts, LaTeX, et tout fichier déjà lu (.lean modifié par l'IA, onglet fermé : sinon rouvert périmé)
    if (!/\.(tex|bib|sty|cls|ltx)$/i.test(p) && !docs.has(p) && !contents.has(p)) continue
    let text: string
    try {
      text = await api.read(root, p)
    } catch {
      continue
    }
    if (lastWrites.get(p) === text) continue
    updateContent(p, text)
    if (docs.has(p)) {
      const current = textOf(p)
      if (current === text) continue
      if (!isDirty(p)) {
        replaceContent(p, text)
        refreshDirty(p)
        toast(`${basename(p)} a été rechargé (modifié hors de l’éditeur)`)
      } else {
        toast(`${basename(p)} a été modifié sur le disque ; votre version non enregistrée est conservée`, 'error')
      }
    }
  }
}

function validName(name: string): boolean {
  return !!name && !/[\\:*?"<>|]/.test(name) && !name.split('/').some((s) => s === '..' || s === '')
}

export async function createEntry(dir: string, name: string, isDir: boolean): Promise<void> {
  const { root } = store.get()
  if (!collabAllows('add')) return
  if (!root || !validName(name)) {
    toast('Nom invalide', 'error')
    return
  }
  const rel = dir ? `${dir}/${name}` : name
  const content = isDir ? '' : /\.tex$/i.test(name) ? `% ${name}\n\n` : /\.lean$/i.test(name) ? 'import Mathlib\n\n' : ''
  try {
    await api.create(root, rel, isDir, content)
    await refreshFiles()
    if (!isDir) {
      updateContent(rel, content)
      await openFile(rel)
    }
  } catch (e) {
    toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error')
  }
}

/** Crée un fichier avec un nom libre dans le projet (« nom-2.tex » si déjà pris) et l'ouvre */
export async function createFileWith(baseName: string, ext: string, content: string): Promise<string | null> {
  const { root, files } = store.get()
  if (!root || !collabAllows('add')) return null
  const base = baseName.replace(/[\\/:*?"<>|]/g, '-').trim() || 'document'
  const taken = new Set(files.map((f) => f.path.toLowerCase()))
  let rel = `${base}${ext}`
  for (let i = 2; taken.has(rel.toLowerCase()); i++) rel = `${base}-${i}${ext}`
  try {
    await api.create(root, rel, false, content)
    await refreshFiles()
    updateContent(rel, content)
    await openFile(rel)
    return rel
  } catch (e) {
    toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error')
    return null
  }
}

export async function renameEntry(from: string, toName: string): Promise<void> {
  if (!validName(toName)) return
  await moveEntry(from, dirname(from) ? `${dirname(from)}/${toName}` : toName)
}

/** Renomme ou déplace un fichier ou dossier (chemins relatifs au projet), en suivant onglets, fichier principal et index */
export async function moveEntry(from: string, to: string): Promise<void> {
  const { root, tabs, mainFile, active } = store.get()
  if (!root || to === from || !collabAllows('add') || !collabAllows('write', from)) return
  if (to.startsWith(from + '/')) {
    toast('Impossible de déplacer un dossier dans lui-même', 'error')
    return
  }
  try {
    for (const t of tabs) if ((t === from || t.startsWith(from + '/')) && isDirty(t)) await saveFile(t)
    await api.rename(root, from, to)
    await followMove(from, to)
  } catch (e) {
    toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error')
  }
}

/** Fichier ou dossier déplacé (ici ou par un autre participant) : onglets, fichier principal et index suivent */
export async function followMove(from: string, to: string): Promise<void> {
  const { tabs, mainFile, active } = store.get()
  const mapPath = (p: string): string => (p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p)
  for (const t of tabs) if (t !== mapPath(t)) renameDoc(t, mapPath(t))
  for (const [p, text] of [...contents]) {
    if (p !== mapPath(p)) {
      removeContent(p)
      updateContent(mapPath(p), text)
    }
  }
  store.set({ tabs: tabs.map(mapPath), mainFile: mainFile ? mapPath(mainFile) : null, active: active ? mapPath(active) : null })
  await refreshFiles()
  persistTabs()
}

export async function deleteEntry(path: string, isDir: boolean): Promise<void> {
  const { root } = store.get()
  if (!root || !collabAllows('write', path)) return
  const ok = await api.confirm(
    `Placer « ${basename(path)} » dans la corbeille ?`,
    isDir ? 'Le dossier et tout son contenu seront déplacés dans la corbeille.' : 'Vous pourrez le récupérer depuis la corbeille.',
    'Mettre à la corbeille'
  )
  if (!ok) return
  for (const t of store.get().tabs) {
    if (t === path || t.startsWith(path + '/')) {
      markSaved(t)
      await closeTab(t)
    }
  }
  await api.trash(root, path)
  for (const p of [...contents.keys()]) if (p === path || p.startsWith(path + '/')) removeContent(p)
  await refreshFiles()
}

export async function importFiles(paths: string[], destDir: string): Promise<string[]> {
  const { root } = store.get()
  if (!root || !collabAllows('add')) return []
  const out: string[] = []
  for (const p of paths) {
    try {
      out.push(await api.importFile(root, p, destDir))
    } catch (e) {
      toast(`Import impossible : ${(e as Error).message}`, 'error')
    }
  }
  await refreshFiles()
  return out
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

let compiling = false
let pending = false

// Tectonic : compilateur de LaTeX de Lumen TeX, enregistré comme ceux des extensions
registerCompiler({
  id: 'tectonic',
  name: 'Tectonic',
  language: 'latex',
  owner: 'lumen',
  check: async () => {
    const t = store.get().tectonic ?? (await api.tectonicStatus())
    return t.found ? { ok: true, version: t.version } : { ok: false, reason: 'Tectonic n’est pas installé. Installez-le depuis l’écran d’accueil.' }
  },
  compile: async ({ root, mainFile }) => api.compile(root, mainFile, await compileHooks.leanQed(mainFile)),
  cancel: () => api.cancelCompile(),
  sync: {
    forward: (file, line) => api.syncForward(store.get().root!, store.get().mainFile!, file, line),
    reverse: (page, x, y) => api.syncReverse(store.get().root!, store.get().mainFile!, page, x, y)
  }
})

// Diagnostics affichés : ceux de la dernière compilation, puis ceux des extensions
let compileDiags: Diagnostic[] = []
let extDiags: Diagnostic[] = []
function publishDiagnostics(): void {
  store.set({ diagnostics: [...compileDiags, ...extDiags] })
  getView()?.dispatch({ effects: refreshLint.of(null) })
}
export function setExtensionDiagnostics(list: Diagnostic[]): void {
  extDiags = list
  publishDiagnostics()
}

const checkedAfterCompile = new Set<string>()

/** Compilateur de la dernière compilation (arrêt, aller du texte au PDF) */
let lastCompiler: Compiler | null = null
const currentCompiler = (): Compiler | undefined => {
  const lang = languageOf(store.get().mainFile)
  return lastCompiler && lastCompiler.language === lang?.id ? lastCompiler : lang && compilerFor(lang.id)
}

/** Résultat d'un compilateur d'extension, mis au format de Lumen TeX (PDF en octets écrit dans .lumentex) */
async function toResult(out: CompileResult | CompileOutput, root: string, mainFile: string, started: number): Promise<CompileResult> {
  if ('durationMs' in out) return out
  let pdfPath: string | null = null
  if (out.pdf instanceof Uint8Array) {
    const rel = `.lumentex/${basename(mainFile).replace(/\.[^.]+$/, '')}.pdf`
    await api.writeBinary(root, rel, out.pdf)
    pdfPath = `${root}/${rel}`
  } else if (typeof out.pdf === 'string' && out.pdf) {
    // Seulement un PDF : ce chemin peut être ouvert dans le lecteur du système (un .bat y serait lancé)
    if (!/\.pdf$/i.test(out.pdf)) throw new Error(`Le compilateur a rendu « ${out.pdf} », qui n’est pas un PDF`)
    pdfPath = /^([a-zA-Z]:|\/)/.test(out.pdf) ? out.pdf : `${root}/${out.pdf}`
  }
  return {
    ok: out.ok ?? (!!pdfPath && !out.error),
    pdfPath,
    diagnostics: out.diagnostics ?? [],
    log: out.log ?? '',
    output: '',
    durationMs: Date.now() - started,
    error: out.error
  }
}

export async function compile(opts: { auto?: boolean } = {}): Promise<void> {
  const { root, mainFile } = store.get()
  if (!root) return
  if (!mainFile) {
    if (!opts.auto) toast('Aucun fichier principal : faites un clic droit sur un fichier › « Définir comme fichier principal »', 'error', undefined, 6000)
    return
  }
  const lang = languageOf(mainFile)
  let compiler = lang && compilerFor(lang.id)
  // Disponibilité peut-être périmée (Tectonic installé depuis) : nouvelle vérification avant d'abandonner
  if (lang && !compiler && compilersFor(lang.id).length) {
    await recheckCompilers()
    compiler = compilerFor(lang.id)
  }
  if (!compiler) {
    if (!opts.auto) {
      const known = lang ? compilersFor(lang.id) : []
      const reason = known.length ? (availabilityOf(known[0])?.reason ?? `${known[0].name} n’est pas disponible.`) : null
      toast(
        reason ?? (lang ? `Aucun compilateur pour les fichiers ${lang.name}. Une extension peut en ajouter un.` : 'Ce fichier ne peut pas être compilé.'),
        'error',
        undefined,
        6000
      )
    }
    return
  }
  clearTimeout(compileTimer)
  if (compiling) {
    pending = true
    return
  }
  compiling = true
  await saveAll()
  store.set({ compileStatus: 'running', compileProgress: '' })
  try {
    const started = Date.now()
    lastCompiler = compiler
    emit('compile:start', { mainFile, compiler: compiler.id })
    const out = await compiler.compile({ root, mainFile, outDir: '.lumentex', onProgress: (text) => store.set({ compileProgress: text }) })
    const r = await toResult(out, root, mainFile, started)
    if (store.get().root !== root) return
    const errors = r.diagnostics.filter((d) => d.severity === 'error').length
    const warnings = r.diagnostics.filter((d) => d.severity === 'warning').length
    let status: 'success' | 'warning' | 'error' = errors || !r.pdfPath || r.error ? 'error' : warnings ? 'warning' : 'success'
    if (r.error && !r.pdfPath) status = 'error'
    compileDiags = r.diagnostics
    store.set({
      result: r,
      compileStatus: status,
      compileProgress: '',
      pdf: r.pdfPath ? { path: r.pdfPath, version: Date.now() } : store.get().pdf
    })
    publishDiagnostics()
    if (r.error && !r.diagnostics.length) toast(r.error, 'error', undefined, 6000)
    emit('compile:done', r)
    // Première compilation : le compilateur a pu s'installer entre-temps (version à jour dans la barre d'état)
    if (!checkedAfterCompile.has(compiler.id)) {
      checkedAfterCompile.add(compiler.id)
      void checkCompiler(compiler)
    }
  } catch (e) {
    store.set({ compileStatus: 'error', compileProgress: '' })
    toast(`Erreur de compilation : ${(e as Error).message}`, 'error')
  } finally {
    compiling = false
    if (pending) {
      pending = false
      void compile({ auto: true })
    }
  }
}

export async function cancelCompile(): Promise<void> {
  pending = false
  await currentCompiler()?.cancel?.()
}

export async function cleanBuild(): Promise<void> {
  const { root } = store.get()
  if (!root) return
  await api.cleanBuild(root)
  compileDiags = []
  store.set({ pdf: null, result: null })
  publishDiagnostics()
  toast('Fichiers de compilation supprimés', 'success')
}

export async function exportPdf(): Promise<void> {
  const { pdf, mainFile, projectName } = store.get()
  if (!pdf) {
    toast('Compilez d’abord le document', 'error')
    return
  }
  const name = (mainFile && basename(mainFile) !== 'main.tex' ? basename(mainFile).replace(/\.tex$/i, '') : projectName) + '.pdf'
  const target = await api.exportPdf(pdf.path, name)
  if (target) toast(`PDF exporté : ${basename(target)}`, 'success', { label: 'Afficher', run: () => void api.reveal(target) }, 6000)
}

export function openPdfExternal(): void {
  const { pdf } = store.get()
  if (pdf && /\.pdf$/i.test(pdf.path)) void api.openExternal(pdf.path)
}

// ---------------------------------------------------------------------------
// SyncTeX
// ---------------------------------------------------------------------------

export async function syncForward(path?: string, line?: number): Promise<void> {
  const { root, mainFile } = store.get()
  const file = path ?? getActivePath()
  if (!root || !mainFile || !file) return
  const state = stateOf(file)
  const ln = line ?? (state ? state.doc.lineAt(state.selection.main.head).number : 1)
  const forward = currentCompiler()?.sync?.forward
  if (!forward) {
    toast('Ce compilateur ne permet pas d’aller du texte au PDF')
    return
  }
  const r = await forward(file, ln)
  if (!r) {
    toast('Position introuvable dans le PDF (recompilez ?)')
    return
  }
  if (!store.get().settings.pdfVisible) await updateSettings({ pdfVisible: true })
  emit('pdf:highlight', r)
}

export async function syncReverse(page: number, x: number, y: number): Promise<void> {
  const { root, mainFile } = store.get()
  if (!root || !mainFile) return
  const r = await currentCompiler()?.sync?.reverse?.(page, x, y)
  if (!r) return
  await openFile(r.file, { line: r.line })
}

// ---------------------------------------------------------------------------
// Éditeur
// ---------------------------------------------------------------------------

export function insertText(text: string, asSnippet = false): void {
  const view = getView()
  if (!view || !getActivePath()) {
    toast('Ouvrez un fichier pour insérer du contenu')
    return
  }
  const { from, to } = view.state.selection.main
  if (asSnippet) {
    snippet(text)(view, null, from, to)
  } else {
    view.dispatch({ changes: { from, to, insert: text }, selection: EditorSelection.cursor(from + text.length), scrollIntoView: true })
  }
  view.focus()
}

export function insertBlock(text: string, asSnippet = true): void {
  const view = getView()
  if (!view) return
  const { from } = view.state.selection.main
  const line = view.state.doc.lineAt(from)
  const indent = /^\s*/.exec(line.text)![0]
  const needsNewline = line.text.trim().length > 0
  const prefix = needsNewline ? '\n' + indent : ''
  if (needsNewline) view.dispatch({ selection: EditorSelection.cursor(line.to) })
  insertText(prefix + text, asSnippet)
}

export function editorCommand(id: string): void {
  const view = getView()
  if (!view) return
  switch (id) {
    case 'bold':
      wrapSelection(view, '\\textbf{', '}')
      break
    case 'italic':
      wrapSelection(view, '\\textit{', '}')
      break
    case 'toggle-comment':
      toggleComment(view)
      view.focus()
      break
    case 'find':
      openSearchPanel(view)
      break
  }
}

async function dropFiles(files: File[], view: EditorView, pos: number): Promise<void> {
  const paths = files.map((f) => api.pathForFile(f)).filter(Boolean)
  const images = paths.filter((p) => /\.(png|jpe?g|pdf|eps|svg)$/i.test(p))
  if (!images.length) {
    const tex = paths.find((p) => /\.tex$/i.test(p))
    if (tex) toast('Pour ouvrir un projet, utilisez Fichier › Ouvrir un dossier')
    return
  }
  const imported = await importFiles(images, 'images')
  const main = store.get().mainFile ?? ''
  const base = dirname(main)
  const snippets = imported.map((rel) => {
    const p = base && rel.startsWith(base + '/') ? rel.slice(base.length + 1) : rel
    const name = basename(rel).replace(/\.\w+$/, '')
    return `\\begin{figure}[htbp]\n\t\\centering\n\t\\includegraphics[width=0.8\\linewidth]{${p}}\n\t\\caption{\${Légende}}\n\t\\label{fig:${name}}\n\\end{figure}\n`
  })
  view.dispatch({ selection: EditorSelection.cursor(pos) })
  insertBlock(snippets.join('\n'))
  toast(`${imported.length} image(s) importée(s) dans images/`, 'success')
}

export async function insertFigure(): Promise<void> {
  const { root } = store.get()
  if (!root) return
  const src = await api.openFileDialog({ title: 'Choisir une image', extensions: ['png', 'jpg', 'jpeg', 'pdf', 'eps', 'svg'] })
  if (!src) return
  const view = getView()
  if (!view) return
  const [rel] = await importFiles([src], 'images')
  if (!rel) return
  const base = dirname(store.get().mainFile ?? '')
  const p = base && rel.startsWith(base + '/') ? rel.slice(base.length + 1) : rel
  const name = basename(rel).replace(/\.\w+$/, '')
  insertBlock(`\\begin{figure}[htbp]\n\t\\centering\n\t\\includegraphics[width=\${0.8}\\linewidth]{${p}}\n\t\\caption{\${Légende}}\n\t\\label{fig:\${${name}}}\n\\end{figure}\n`)
}

// ---------------------------------------------------------------------------
// Création de projet
// ---------------------------------------------------------------------------

export async function createProject(dir: string, files: TemplateFile[]): Promise<void> {
  try {
    await api.createProject(dir, files)
    await openProject(dir)
    toast('Projet créé', 'success')
  } catch (e) {
    toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error', undefined, 6000)
  }
}

export async function openFolderDialog(): Promise<void> {
  const dir = await api.openFolderDialog()
  if (dir) await openProject(dir)
}

export async function openPath(p: string): Promise<void> {
  p = slashes(p)
  const st = await api.stat(p)
  if (!st.exists) return
  if (st.isDir) return openProject(p)
  const dir = p.slice(0, p.lastIndexOf('/'))
  const rel = p.slice(dir.length + 1)
  if (store.get().root && p.startsWith(store.get().root + '/')) {
    await openFile(p.slice(store.get().root!.length + 1))
    return
  }
  await openProject(dir, { openFile: rel })
}

export async function openTexFileDialog(): Promise<void> {
  const f = await api.openFileDialog({ title: 'Ouvrir un fichier LaTeX', extensions: ['tex'] })
  if (f) await openPath(f)
}

export function applySettingsToEditor(): void {
  reconfigureAll()
}
