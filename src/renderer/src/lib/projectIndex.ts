import {
  extractCommands,
  extractEnvironments,
  extractLabels,
  parseBib,
  type BibEntry,
  type LabelInfo,
  type UserCommand
} from '../latex/analysis'
import { store } from '../store'

/** Contenu texte connu de chaque fichier (.tex/.bib) du projet */
export const contents = new Map<string, string>()

interface FileIndex {
  labels: LabelInfo[]
  bib: BibEntry[]
  commands: UserCommand[]
  envs: string[]
}

const perFile = new Map<string, FileIndex>()

export const index = {
  labels: [] as LabelInfo[],
  bib: [] as BibEntry[],
  commands: [] as UserCommand[],
  envs: [] as string[],
  files: [] as string[]
}

function rebuild(): void {
  const all = [...perFile.values()]
  index.labels = all.flatMap((f) => f.labels)
  index.bib = all.flatMap((f) => f.bib)
  index.commands = all.flatMap((f) => f.commands)
  index.envs = [...new Set(all.flatMap((f) => f.envs))]
  store.set((s) => ({ indexVersion: s.indexVersion + 1 }))
}

function analyse(file: string, text: string): FileIndex {
  if (/\.bib$/i.test(file)) return { labels: [], bib: parseBib(file, text), commands: [], envs: [] }
  return { labels: extractLabels(file, text), bib: [], commands: extractCommands(file, text), envs: extractEnvironments(text) }
}

export function setAllContents(all: Record<string, string>): void {
  contents.clear()
  perFile.clear()
  for (const [f, t] of Object.entries(all)) {
    contents.set(f, t)
    perFile.set(f, analyse(f, t))
  }
  rebuild()
}

export function updateContent(file: string, text: string): void {
  if (!/\.(tex|bib|sty|cls|ltx)$/i.test(file)) return
  if (contents.get(file) === text) return
  contents.set(file, text)
  perFile.set(file, analyse(file, text))
  rebuild()
}

export function removeContent(file: string): void {
  contents.delete(file)
  perFile.delete(file)
  rebuild()
}

export function setFileList(files: string[]): void {
  index.files = files
}
