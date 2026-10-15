import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import type { HistoryVersion } from '../shared/types'

// Historique des versions d'un projet, dans <projet>/.lumentex/historique : il suit le projet (copie, cloud…).
//   objets/<empreinte>.gz : contenu d'un fichier, compressé, gardé une seule fois quel que soit le nombre de versions ;
//   index.json : les versions (date, nom, fichiers → empreinte).
// Les fichiers texte du projet sont gardés (pas les images ni les PDF). Versions automatiques espacées puis
// éclaircies avec le temps ; celles enregistrées avec un nom sont gardées jusqu'à ce qu'on les supprime.

const MAX_FILE = 5 * 1024 * 1024
const AUTO_EVERY = 10 * 60 * 1000

interface Index {
  versions: HistoryVersion[]
}

const dirOf = (root: string): string => path.join(root, '.lumentex', 'historique')
const indexFile = (root: string): string => path.join(dirOf(root), 'index.json')
const objectFile = (root: string, hash: string): string => path.join(dirOf(root), 'objets', `${hash}.gz`)

function readIndex(root: string): Index {
  try {
    const data = JSON.parse(fs.readFileSync(indexFile(root), 'utf8')) as Index
    return Array.isArray(data.versions) ? data : { versions: [] }
  } catch {
    return { versions: [] }
  }
}

/** Écrit l'index d'un coup (fichier temporaire puis renommage) : jamais à moitié écrit */
function writeIndex(root: string, index: Index): void {
  fs.mkdirSync(dirOf(root), { recursive: true })
  const tmp = indexFile(root) + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(index))
  fs.renameSync(tmp, indexFile(root))
}

/** Fichiers à garder : texte du projet (extensions connues, et celles des langages ajoutés par les extensions) */
function projectFiles(root: string, isText: (p: string) => boolean): string[] {
  const out: string[] = []
  const visit = (dir: string, rel: string, depth: number): void => {
    if (depth > 8 || out.length > 5000) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__') continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) visit(path.join(dir, e.name), r, depth + 1)
      else if (e.isFile() && isText(r)) out.push(r)
    }
  }
  visit(root, '', 0)
  return out.sort()
}

/** Garde le contenu (s'il ne l'est pas déjà) et renvoie son empreinte */
function store(root: string, data: Buffer): string {
  const hash = crypto.createHash('sha256').update(data).digest('hex')
  const file = objectFile(root, hash)
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file + '.tmp', zlib.gzipSync(data))
    fs.renameSync(file + '.tmp', file)
  }
  return hash
}

const sameFiles = (a: Record<string, string>, b: Record<string, string>): boolean => {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

/**
 * Nouvelle version. Automatique : seulement si le projet a changé depuis la précédente, et pas plus d'une toutes les
 * 10 minutes (sauf force). Renvoie la version, ou null si rien n'a été gardé.
 */
export function snapshot(
  root: string,
  opts: { name?: string; auto: boolean; force?: boolean; extensions: string[] }
): HistoryVersion | null {
  const index = readIndex(root)
  const last = index.versions[index.versions.length - 1]
  const lastAuto = [...index.versions].reverse().find((v) => v.auto)
  if (opts.auto && !opts.force && lastAuto && Date.now() - lastAuto.date < AUTO_EVERY) return null
  const exts = new Set(opts.extensions.map((e) => e.toLowerCase()))
  const TEXT = /\.(tex|bib|sty|cls|bst|bbx|cbx|lbx|txt|md|ltx|dtx|ins|cfg|def|tikz|pgf|csv|dat|json|ya?ml|lean|typ)$/i
  const files: Record<string, string> = {}
  for (const rel of projectFiles(root, (p) => TEXT.test(p) || exts.has(path.extname(p).toLowerCase()))) {
    try {
      const abs = path.join(root, rel)
      if (fs.statSync(abs).size > MAX_FILE) continue
      files[rel] = store(root, fs.readFileSync(abs))
    } catch {
      /* illisible : ignoré */
    }
  }
  if (opts.auto && last && sameFiles(last.files, files)) return null
  const version: HistoryVersion = {
    id: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    date: Date.now(),
    name: opts.name?.trim().slice(0, 200) || undefined,
    auto: opts.auto,
    files
  }
  index.versions.push(version)
  prune(index)
  writeIndex(root, index)
  removeOrphans(root, index)
  return version
}

/**
 * Éclaircit les versions automatiques : toutes celles du dernier jour, puis une par heure sur la semaine, une par jour
 * sur le mois, une par semaine au-delà. Les versions nommées ne sont jamais retirées.
 */
function prune(index: Index): void {
  const now = Date.now()
  const H = 3600_000
  const D = 24 * H
  const kept = new Set<string>()
  const seen = new Set<string>()
  // Des plus récentes aux plus anciennes : la première de chaque tranche est gardée
  for (const v of [...index.versions].reverse()) {
    const age = now - v.date
    if (!v.auto || age < D) {
      kept.add(v.id)
      continue
    }
    const slot = age < 7 * D ? `h${Math.floor(v.date / H)}` : age < 30 * D ? `d${Math.floor(v.date / D)}` : `w${Math.floor(v.date / (7 * D))}`
    if (!seen.has(slot)) {
      seen.add(slot)
      kept.add(v.id)
    }
  }
  index.versions = index.versions.filter((v) => kept.has(v.id))
}

/** Contenus que plus aucune version n'utilise : effacés */
function removeOrphans(root: string, index: Index): void {
  const used = new Set(index.versions.flatMap((v) => Object.values(v.files)))
  const dir = path.join(dirOf(root), 'objets')
  let names: string[] = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return
  }
  for (const n of names) if (!used.has(n.replace(/\.gz(\.tmp)?$/, ''))) fs.rmSync(path.join(dir, n), { force: true })
}

export const listVersions = (root: string): HistoryVersion[] => readIndex(root).versions.slice().reverse()

function versionOf(root: string, id: string): HistoryVersion {
  const v = readIndex(root).versions.find((x) => x.id === id)
  if (!v) throw new Error('Cette version n’existe plus.')
  return v
}

/** Contenu d'un fichier dans une version (texte) */
export function readVersionFile(root: string, id: string, rel: string): string {
  const hash = versionOf(root, id).files[rel]
  if (!hash) throw new Error(`« ${rel} » n’existe pas dans cette version.`)
  return zlib.gunzipSync(fs.readFileSync(objectFile(root, hash))).toString('utf8')
}

/** Restaure des fichiers d'une version (tous si paths est absent), après avoir gardé l'état actuel */
export function restoreVersion(root: string, id: string, paths: string[] | undefined, extensions: string[]): string[] {
  const v = versionOf(root, id)
  const list = paths ?? Object.keys(v.files)
  snapshot(root, { name: 'Avant la restauration', auto: true, force: true, extensions })
  const done: string[] = []
  for (const rel of list) {
    const hash = v.files[rel]
    if (!hash) continue
    const abs = path.resolve(root, rel)
    if (!abs.startsWith(path.resolve(root) + path.sep)) continue
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, zlib.gunzipSync(fs.readFileSync(objectFile(root, hash))))
    done.push(rel)
  }
  return done
}

export function renameVersion(root: string, id: string, name: string): void {
  const index = readIndex(root)
  const v = index.versions.find((x) => x.id === id)
  if (!v) return
  v.name = name.trim().slice(0, 200) || undefined
  // Nommée : gardée ; sans nom, elle redevient automatique (éclaircie avec le temps)
  v.auto = !v.name
  writeIndex(root, index)
}

export function deleteVersion(root: string, id: string): void {
  const index = readIndex(root)
  index.versions = index.versions.filter((v) => v.id !== id)
  writeIndex(root, index)
  removeOrphans(root, index)
}
