import { app, net } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { ExtensionInfo, ExtensionSetting, TemplateFile } from '../shared/types'
import { isNewer } from './macUpdate'
import { tar } from './tar'

// Extensions : un dossier avec un manifeste lumen-extension.json (bouts de LaTeX, environnements, symboles, modèles de
// projet, thèmes de couleurs, et code), installé dans <données de l'app>/extensions/<id>.
// Confiance : une extension installée depuis le catalogue est « vérifiée » (relue avant d'y entrer) tant que ses fichiers
// gardent l'empreinte notée à l'installation (.verified.json, recalculée à chaque lecture) ; depuis un dossier, elle ne
// l'est pas. Mode développeur : une extension peut être reliée à son dossier (fichier .lumen-link) au lieu d'être copiée.
// Catalogue officiel : le dépôt GitHub LumenTEX-extensions, une extension par dossier extensions/<id>. L'app télécharge
// l'archive du dépôt (codeload, sans l'API GitHub et sa limite de requêtes) : pas de serveur, pas de liste à tenir à jour.
// LUMEN_CATALOG : autre adresse de l'archive (tests)

const CATALOG = process.env.LUMEN_CATALOG || 'https://codeload.github.com/LucasHenocq/LumenTEX-extensions/tar.gz/main'
const MANIFEST = 'lumen-extension.json'
const ID = /^[a-z0-9][a-z0-9-]{0,40}$/

const extDir = (): string => path.join(app.getPath('userData'), 'extensions')

const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.slice(0, max) : '')
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/**
 * Gabarit au format des snippets de VS Code ($1, ${1:texte}, ${1|a,b|}, $0, \$) vers celui de CodeMirror (${1:texte}) :
 * les fichiers de snippets LaTeX de VS Code servent tels quels. Variables ($TM_SELECTED_TEXT…) : leur valeur par défaut.
 */
export function vscodeToCm(body: string): string {
  let out = ''
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '\\' && '$}\\'.includes(body[i + 1] ?? '-')) {
      out += body[++i]
      continue
    }
    if (c !== '$') {
      out += c
      continue
    }
    const rest = body.slice(i)
    let m = /^\$(\d+)/.exec(rest)
    if (m) {
      out += `\${${m[1]}}`
      i += m[0].length - 1
      continue
    }
    m = /^\$\{(\d+)(?::([^{}]*)|\|([^|]*)\|)?\}/.exec(rest)
    if (m) {
      const def = m[2] ?? m[3]?.split(',')[0]
      out += def ? `\${${m[1]}:${def}}` : `\${${m[1]}}`
      i += m[0].length - 1
      continue
    }
    m = /^\$(?:[A-Z_]+|\{[A-Z_]+(?::([^{}]*))?\})/.exec(rest)
    if (m) {
      out += m[1] ?? ''
      i += m[0].length - 1
      continue
    }
    out += c
  }
  return out
}

/** Fichiers d'un modèle (liens symboliques ignorés) ; binaires (octet nul) en base64 */
function templateFiles(root: string): TemplateFile[] {
  const files: TemplateFile[] = []
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name)
      const st = fs.lstatSync(abs)
      if (st.isSymbolicLink() || files.length >= 200) continue
      if (st.isDirectory()) walk(abs)
      else if (st.size <= 5 * 1024 * 1024) {
        const buf = fs.readFileSync(abs)
        const binary = buf.includes(0)
        files.push({ path: path.relative(root, abs).split(path.sep).join('/'), content: buf.toString(binary ? 'base64' : 'utf8'), base64: binary || undefined })
      }
    }
  }
  walk(root)
  return files
}

/** Lit et vérifie le manifeste d'une extension ; message clair si elle n'est pas valable */
export function readExtension(folder: string): ExtensionInfo {
  const file = path.join(folder, MANIFEST)
  if (!fs.existsSync(file)) throw new Error(`Ce dossier ne contient pas de fichier ${MANIFEST}.`)
  let m: Record<string, unknown>
  try {
    m = obj(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch (e) {
    throw new Error(`${MANIFEST} n’est pas un JSON valable : ${(e as Error).message}`)
  }
  const id = str(m.id)
  if (!ID.test(id)) throw new Error(`Identifiant « ${id} » invalide dans ${MANIFEST} : minuscules, chiffres et tirets seulement.`)
  const lumen = str(m.lumen, 20)
  const inside = (rel: string): string => {
    const abs = path.resolve(folder, rel)
    if (!abs.startsWith(path.resolve(folder) + path.sep)) throw new Error(`Chemin « ${rel} » en dehors de l’extension.`)
    return abs
  }

  // Bouts de LaTeX : objet au format VS Code ({ nom: { prefix, body, description } }), ou nom d'un tel fichier
  let snippets = m.snippets
  if (typeof snippets === 'string') snippets = JSON.parse(fs.readFileSync(inside(snippets), 'utf8'))
  const snip = (s: Record<string, unknown>, name: string): ExtensionInfo['snippets'] =>
    arr(s.prefix).concat(typeof s.prefix === 'string' ? [s.prefix] : []).map((p) => ({
      prefix: str(p, 100),
      body: vscodeToCm(Array.isArray(s.body) ? s.body.map((l) => str(l)).join('\n') : str(s.body, 20000)),
      description: str(s.description) || name
    }))

  return {
    id,
    name: str(m.name, 100) || id,
    version: str(m.version, 20) || '0.0.0',
    author: str(m.author, 100),
    description: str(m.description),
    lumen,
    compatible: !lumen || !isNewer(lumen, app.getVersion()),
    snippets: Object.entries(obj(snippets))
      .flatMap(([name, s]) => snip(obj(s), name))
      .filter((s) => s.prefix && s.body),
    environments: arr(m.environments)
      .map(obj)
      .map((e) => ({ name: str(e.name, 100), body: vscodeToCm(str(e.body, 20000)) || '${}', description: str(e.description) }))
      .filter((e) => /^[a-zA-Z*]+$/.test(e.name)),
    symbols: arr(m.symbols)
      .map(obj)
      .map((g) => ({
        name: str(g.name, 100),
        items: (typeof g.items === 'string' ? g.items.trim().split(/\s+/) : arr(g.items).map((i) => str(i, 200))).filter(Boolean)
      }))
      .filter((g) => g.name && g.items.length),
    templates: arr(m.templates)
      .map(obj)
      .map((t) => ({ name: str(t.name, 100), description: str(t.description), files: str(t.folder) ? templateFiles(inside(str(t.folder))) : [] }))
      .filter((t) => t.name && t.files.length),
    // Variables CSS seulement (--nom: valeur), sans rien qui sorte de la déclaration ni charge une ressource
    themes: arr(m.themes)
      .map(obj)
      .map((t) => {
        const vars = (v: unknown): Record<string, string> =>
          Object.fromEntries(
            Object.entries(obj(v))
              .map(([k, val]) => [k, str(val, 200)])
              .filter(([k, val]) => /^--[a-zA-Z0-9-]+$/.test(k) && val && !/[;{}<>\\]|url\(|@import/i.test(val))
          )
        return { name: str(t.name, 100), light: vars(t.light), dark: vars(t.dark) }
      })
      .filter((t) => t.name && (Object.keys(t.light).length || Object.keys(t.dark).length)),
    main: codeFile(m.main, inside),
    node: codeFile(m.node, inside),
    permissions: (() => {
      const p = obj(m.permissions)
      return {
        network: arr(p.network)
          .map((d) => str(d, 200).toLowerCase())
          .filter((d) => /^[a-z0-9.-]+$/.test(d)),
        microphone: p.microphone === true,
        camera: p.camera === true,
        session: p.session === true
      }
    })(),
    settings: arr(m.settings)
      .map(obj)
      .map((s): ExtensionSetting => {
        const type = (['toggle', 'text', 'number', 'select'] as const).find((t) => t === s.type) ?? 'text'
        const options = arr(s.options).map((o) => str(o, 200))
        const fallback = type === 'toggle' ? false : type === 'number' ? 0 : type === 'select' ? (options[0] ?? '') : ''
        const def = typeof s.default === typeof fallback ? (s.default as string | number | boolean) : fallback
        return { id: str(s.id, 60), label: str(s.label, 200) || str(s.id, 60), type, options, default: def, description: str(s.description) }
      })
      .filter((s) => /^[\w-]+$/.test(s.id)),
    languages: arr(m.languages)
      .map(obj)
      .map((l) => ({
        id: str(l.id, 40),
        name: str(l.name, 100) || str(l.id, 40),
        extensions: arr(l.extensions)
          .map((e) => str(e, 20).toLowerCase())
          .filter((e) => /^\.[a-z0-9]+$/.test(e))
      }))
      .filter((l) => /^[a-z0-9-]+$/.test(l.id) && l.extensions.length),
    // Icône SVG en data URL : affichée comme image, elle ne peut pas exécuter de script
    icon: (() => {
      const rel = str(m.icon)
      if (!rel || !/\.svg$/i.test(rel)) return ''
      const file = inside(rel)
      return fs.existsSync(file) && fs.statSync(file).size < 100_000 ? 'data:image/svg+xml;base64,' + fs.readFileSync(file).toString('base64') : ''
    })(),
    trust: 'unverified',
    linked: ''
  }
}

/** Fichier de code déclaré dans le manifeste (module JavaScript), qui doit exister dans l'extension */
function codeFile(v: unknown, inside: (rel: string) => string): string {
  const rel = str(v, 200).replace(/^\.\//, '')
  if (!rel) return ''
  if (!/\.m?js$/i.test(rel)) throw new Error(`Le code « ${rel} » doit être un fichier .js ou .mjs.`)
  if (!fs.existsSync(inside(rel))) throw new Error(`Le fichier « ${rel} » déclaré dans ${MANIFEST} est introuvable.`)
  return rel
}

/** Empreinte de tous les fichiers d'une extension (chemins et contenus) */
function hashFolder(root: string): string {
  const h = crypto.createHash('sha256')
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name)
      const st = fs.lstatSync(abs)
      if (st.isSymbolicLink() || name === '.git') continue
      if (st.isDirectory()) walk(abs)
      else {
        h.update(path.relative(root, abs).split(path.sep).join('/') + '\0')
        h.update(fs.readFileSync(abs))
        h.update('\0')
      }
    }
  }
  walk(root)
  return h.digest('hex')
}

const verifiedFile = (): string => path.join(extDir(), '.verified.json')
function verifiedHashes(): Record<string, string> {
  try {
    return obj(JSON.parse(fs.readFileSync(verifiedFile(), 'utf8'))) as Record<string, string>
  } catch {
    return {}
  }
}
function setVerified(id: string, hash: string | null): void {
  const all = verifiedHashes()
  if (hash) all[id] = hash
  else delete all[id]
  fs.mkdirSync(extDir(), { recursive: true })
  fs.writeFileSync(verifiedFile(), JSON.stringify(all, null, 2))
}

/** Dossier réel d'une extension installée (celui de l'auteur, si elle y est reliée) */
function realFolder(dir: string): string {
  const link = path.join(dir, '.lumen-link')
  return fs.existsSync(link) ? fs.readFileSync(link, 'utf8').trim() : dir
}

/** Extensions dans un dossier (une par sous-dossier) ; celles qui ne sont pas valables sont ignorées */
function listIn(root: string): { ext: ExtensionInfo; folder: string }[] {
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      try {
        const folder = realFolder(path.join(root, d.name))
        return [{ ext: readExtension(folder), folder }]
      } catch {
        return []
      }
    })
    .sort((a, b) => a.ext.name.localeCompare(b.ext.name))
}

// Extensions installées, avec leur dossier : relu à chaque liste demandée par la fenêtre (démarrage, installation)
let installed = new Map<string, { ext: ExtensionInfo; folder: string }>()

export function installedExtensions(): ExtensionInfo[] {
  const hashes = verifiedHashes()
  const list = listIn(extDir()).map(({ ext, folder }) => {
    const linked = fs.existsSync(path.join(extDir(), ext.id, '.lumen-link')) ? folder : ''
    const known = hashes[ext.id]
    const trust: ExtensionInfo['trust'] = linked || !known ? 'unverified' : hashFolder(folder) === known ? 'verified' : 'modified'
    return { ext: { ...ext, trust, linked }, folder }
  })
  installed = new Map(list.map((e) => [e.ext.id, e]))
  return list.map((e) => e.ext)
}

/** Extension installée et son dossier (code, fichiers servis à la fenêtre) */
export const installedExtension = (id: string): { ext: ExtensionInfo; folder: string } | undefined => installed.get(id)

/** Copie une extension dans le dossier des extensions (remplace l'ancienne version) ; du catalogue : notée vérifiée */
function install(folder: string, verified: boolean): ExtensionInfo {
  const ext = readExtension(folder)
  const dest = path.join(extDir(), ext.id)
  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(folder, dest, { recursive: true, filter: (src) => path.basename(src) !== '.git' && !fs.lstatSync(src).isSymbolicLink() })
  setVerified(ext.id, verified ? hashFolder(dest) : null)
  return ext
}

export const installExtensionFolder = (folder: string): ExtensionInfo => install(folder, false)

/** Mode développeur : extension reliée à son dossier, sans copie (ses modifications sont prises au rechargement) */
export function linkExtensionFolder(folder: string): ExtensionInfo {
  const ext = readExtension(folder)
  const dest = path.join(extDir(), ext.id)
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  fs.writeFileSync(path.join(dest, '.lumen-link'), path.resolve(folder))
  setVerified(ext.id, null)
  return ext
}

export function uninstallExtension(id: string): void {
  if (!ID.test(id)) return
  fs.rmSync(path.join(extDir(), id), { recursive: true, force: true })
  setVerified(id, null)
}

// Dernier catalogue téléchargé : dossier temporaire de chaque extension, pour l'installer ensuite
let catalog: { tmp: string; folders: Map<string, string> } | null = null

/** Télécharge et lit le catalogue officiel ; rejette si GitHub est injoignable */
export async function fetchCatalog(): Promise<ExtensionInfo[]> {
  const res = await net.fetch(CATALOG)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-catalogue-'))
  try {
    const archive = path.join(tmp, 'catalogue.tar.gz')
    fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()))
    await tar(['-xzf', archive, '-C', tmp])
    const top = fs.readdirSync(tmp, { withFileTypes: true }).find((d) => d.isDirectory())
    const list = top ? listIn(path.join(tmp, top.name, 'extensions')) : []
    if (catalog) fs.rmSync(catalog.tmp, { recursive: true, force: true })
    catalog = { tmp, folders: new Map(list.map((e) => [e.ext.id, e.folder])) }
    return list.map((e) => ({ ...e.ext, trust: 'verified' as const }))
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true })
    throw e
  }
}

export function installFromCatalog(id: string): ExtensionInfo {
  const folder = catalog?.folders.get(id)
  if (!folder) throw new Error('Cette extension n’est plus dans le catalogue. Rouvrez la liste pour la recharger.')
  return install(folder, true)
}

/** Fermeture de l'app : efface le catalogue temporaire */
export function cleanCatalog(): void {
  if (catalog) fs.rmSync(catalog.tmp, { recursive: true, force: true })
}
