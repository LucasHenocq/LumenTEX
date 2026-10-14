import type { CompletionSource } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import type { CompileResult, Diagnostic, SyncForwardResult, SyncReverseResult } from '../../../shared/types'
import { store } from '../store'

// Langages et compilateurs : ceux de Lumen TeX (LaTeX et Tectonic…) s'enregistrent ici exactement comme ceux des
// extensions. Le langage d'un fichier se lit à son extension ; le fichier principal est compilé par le compilateur
// choisi pour son langage (Réglages → Compilation, ou menu à côté de « Compiler » s'il y en a plusieurs disponibles).

export interface Language {
  id: string
  name: string
  /** Extensions de fichier, avec le point (« .tex ») */
  extensions: string[]
  /** Coloration et outils de l'éditeur (CodeMirror) */
  editor?: Extension
  /** Autocomplétion propre au langage */
  completion?: CompletionSource[]
  /** Ce texte peut être un fichier principal (LaTeX : \documentclass) ; absent = tout fichier du langage */
  isMain?: (text: string) => boolean
  /** Modifier un fichier de ce langage relance la compilation automatique (par défaut : oui) */
  autoCompile?: boolean
  /** Icône des fichiers (SVG en data URL) ; absente : celle de Lumen TeX selon l'extension du fichier */
  icon?: string
  /** « lumen », ou l'identifiant de l'extension */
  owner: string
}

/** Ce que reçoit un compilateur */
export interface CompileContext {
  /** Dossier du projet (absolu) et fichier principal (relatif au projet) */
  root: string
  mainFile: string
  /** Dossier de sortie, relatif au projet (fichiers cachés de Lumen TeX) */
  outDir: string
  /** Ligne de progression affichée dans la barre d'état */
  onProgress: (text: string) => void
}

/** Ce que rend un compilateur d'extension (un CompileResult complet est aussi accepté) */
export interface CompileOutput {
  ok?: boolean
  /** PDF : octets, ou chemin (relatif au projet, ou absolu) */
  pdf?: Uint8Array | string | null
  log?: string
  diagnostics?: Diagnostic[]
  /** Message d'échec affiché à l'utilisateur */
  error?: string
}

export interface Availability {
  ok: boolean
  version?: string
  /** Pourquoi il n'est pas disponible (« MiKTeX introuvable… ») */
  reason?: string
}

export interface Compiler {
  id: string
  name: string
  /** Identifiant du langage compilé */
  language: string
  owner: string
  /** Disponible sur cet ordinateur ? Absent : considéré comme disponible */
  check?: () => Promise<Availability>
  compile: (ctx: CompileContext) => Promise<CompileResult | CompileOutput>
  cancel?: () => unknown
  /** Aller du texte au PDF et inversement */
  sync?: {
    forward?: (file: string, line: number) => Promise<SyncForwardResult | null>
    reverse?: (page: number, x: number, y: number) => Promise<SyncReverseResult | null>
  }
}

const languages: Language[] = []
const compilers: Compiler[] = []
const availability = new Map<string, Availability>()

/** Les changements de langages, de compilateurs (ou de leur disponibilité) redessinent icônes et menus */
const changed = (): void => store.set((s) => ({ compilersVersion: s.compilersVersion + 1 }))

/** Même identifiant : le nouveau remplace l'ancien (le code d'une extension complète le langage de son manifeste) */
export function registerLanguage(l: Language): () => void {
  const i = languages.findIndex((x) => x.id === l.id)
  const previous = i >= 0 ? languages[i] : null
  // L'icône du manifeste reste si le code n'en donne pas
  if (previous && !l.icon) l = { ...l, icon: previous.icon }
  if (previous) languages[i] = l
  else languages.push(l)
  changed()
  return () => {
    const j = languages.indexOf(l)
    if (j < 0) return
    if (previous) languages[j] = previous
    else languages.splice(j, 1)
    changed()
  }
}

export function registerCompiler(c: Compiler): () => void {
  // Même identifiant : le nouveau remplace l'ancien (extension rechargée)
  const old = compilers.findIndex((x) => x.id === c.id)
  if (old >= 0) compilers.splice(old, 1)
  compilers.push(c)
  availability.delete(c.id)
  changed()
  void checkCompiler(c)
  return () => {
    const i = compilers.indexOf(c)
    if (i >= 0) compilers.splice(i, 1)
    changed()
  }
}

/** Le premier langage déclaré pour une extension de fichier l'emporte (ceux de Lumen TeX d'abord) */
export const languageOf = (path: string | null | undefined): Language | undefined => {
  if (!path) return undefined
  const p = path.toLowerCase()
  return languages.find((l) => l.extensions.some((e) => p.endsWith(e)))
}

export const allLanguages = (): Language[] => [...languages]
export const compilersFor = (language: string): Compiler[] => compilers.filter((c) => c.language === language)

/** Disponibilité connue (vérifiée à l'enregistrement, puis sur demande) */
export const availabilityOf = (c: Compiler): Availability | undefined => availability.get(c.id)

export async function checkCompiler(c: Compiler): Promise<Availability> {
  let a: Availability
  try {
    a = c.check ? await c.check() : { ok: true }
  } catch (e) {
    a = { ok: false, reason: (e as Error).message }
  }
  availability.set(c.id, a)
  changed()
  return a
}

export const recheckCompilers = (): Promise<Availability[]> => Promise.all(compilers.map(checkCompiler))

/** Compilateurs disponibles d'un langage (sans vérification encore faite : comptés comme disponibles) */
export const availableFor = (language: string): Compiler[] => compilersFor(language).filter((c) => availability.get(c.id)?.ok !== false)

/** Compilateur à utiliser : celui choisi s'il est disponible, sinon le premier disponible */
export function compilerFor(language: string): Compiler | undefined {
  const chosen = store.get().settings.compilers?.[language]
  const list = availableFor(language)
  return list.find((c) => c.id === chosen) ?? list[0]
}

/** Ce fichier peut être compilé (fichier principal possible) */
export function canBeMain(path: string, text?: string): boolean {
  const l = languageOf(path)
  if (!l || !compilersFor(l.id).length) return false
  return !l.isMain || text === undefined || l.isMain(text)
}
