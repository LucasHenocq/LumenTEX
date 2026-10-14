import { app, dialog, MessageChannelMain, net, protocol, session, utilityProcess, type BrowserWindow, type UtilityProcess } from 'electron'
import fs from 'fs'
import path from 'path'
import type { ExtensionFetchResult, ExtensionInfo } from '../shared/types'
import { installedExtension } from './extensions'
import { getSettings, setSettings } from './store'
import bridge from './extBridge.js?raw'
import sandboxCss from './extSandbox.css?raw'

// Exécution des extensions avec code.
// Fichiers servis par le protocole lumen-ext :
//   lumen-ext://app/<id>/<fichier> : extensions de confiance (vérifiées, ou toutes en mode développeur), chargées dans
//     la fenêtre de Lumen TeX ;
//   lumen-ext://sb-<id>/<fichier> : extensions isolées, chacune dans un cadre (iframe) à origine opaque, sans accès à
//     l'app : elle ne parle à Lumen TeX que par messages, que la fenêtre vérifie (projet ouvert seulement), et la règle
//     de sécurité de ses réponses (CSP) n'autorise que ses propres fichiers.
// Partie Node.js (extensions de confiance) : processus séparé (utilityProcess), relié à la fenêtre par un MessagePort.

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg'
}

/** Extension de confiance : vérifiée, ou mode développeur */
export const trusted = (ext: ExtensionInfo): boolean => ext.trust === 'verified' || getSettings().extDevMode

/** Avant que l'app soit prête : schéma lumen-ext traité comme une origine normale (modules, fetch, CORS) */
export function registerExtensionScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'lumen-ext', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
  ])
}

const notFound = (): Response => new Response('Introuvable', { status: 404 })

function serveFile(folder: string, rel: string, headers: Record<string, string>): Response {
  const abs = path.resolve(folder, decodeURIComponent(rel))
  if (!abs.startsWith(path.resolve(folder) + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return notFound()
  return new Response(fs.readFileSync(abs), {
    headers: { 'Content-Type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream', ...headers }
  })
}

/** Page d'une extension isolée : styles de Lumen TeX, puis le pont qui lui donne l'objet lumen et charge son code */
const sandboxPage = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="__lumen.css"></head><body><script type="module" src="__bridge.js"></script></body></html>`

export function handleExtensionProtocol(): void {
  protocol.handle('lumen-ext', (req) => {
    const url = new URL(req.url)
    const host = url.hostname
    const [, first, ...rest] = url.pathname.split('/')
    // Modules chargés par la fenêtre (autre origine) ou par un cadre à origine opaque : CORS ouvert. Jamais mis en
    // cache : après une mise à jour, le rechargement doit prendre le nouveau code
    const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }
    if (host === 'app') {
      const e = installedExtension(first)
      if (!e || !trusted(e.ext)) return notFound()
      return serveFile(e.folder, rest.join('/'), cors)
    }
    if (host.startsWith('sb-')) {
      const id = host.slice(3)
      const e = installedExtension(id)
      if (!e) return notFound()
      const self = `lumen-ext://${host}`
      const csp = [
        "default-src 'none'",
        `script-src ${self} 'wasm-unsafe-eval'`,
        `style-src ${self} 'unsafe-inline'`,
        `img-src ${self} data: blob:`,
        `font-src ${self} data:`,
        'media-src blob: mediastream:',
        `connect-src ${self}`,
        `worker-src ${self} blob:`
      ].join('; ')
      const headers = { ...cors, 'Content-Security-Policy': csp }
      const rel = [first, ...rest].join('/')
      if (rel === '__host.html') return new Response(sandboxPage, { headers: { 'Content-Type': 'text/html', ...headers } })
      if (rel === '__bridge.js') return new Response(bridge, { headers: { 'Content-Type': 'text/javascript', ...headers } })
      if (rel === '__lumen.css') return new Response(sandboxCss, { headers: { 'Content-Type': 'text/css', ...headers } })
      return serveFile(e.folder, rel, headers)
    }
    return notFound()
  })
}

// ---------------------------------------------------------------------------
// Internet : extension non vérifiée limitée aux sites déclarés
// ---------------------------------------------------------------------------

export async function extensionFetch(
  id: string,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }
): Promise<ExtensionFetchResult> {
  const e = installedExtension(id)
  if (!e) throw new Error('Extension inconnue')
  const u = new URL(url)
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`Adresse non autorisée : ${url}`)
  const host = u.hostname.toLowerCase()
  if (!trusted(e.ext) && !e.ext.permissions.network.some((d) => host === d || host.endsWith('.' + d)))
    throw new Error(`L’extension « ${e.ext.name} » n’a pas déclaré le site ${host} dans ses permissions.`)
  const res = await net.fetch(url, { method: init.method ?? 'GET', headers: init.headers, body: init.body as BodyInit | undefined })
  const body = new Uint8Array(await res.arrayBuffer())
  if (body.byteLength > 50 * 1024 * 1024) throw new Error('Réponse trop volumineuse (plus de 50 Mo)')
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body }
}

// ---------------------------------------------------------------------------
// Données gardées par chaque extension
// ---------------------------------------------------------------------------

const dataFile = (id: string): string => path.join(app.getPath('userData'), 'extension-data', `${id}.json`)

export function extensionStorage(id: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(dataFile(id), 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function setExtensionStorage(id: string, key: string, value: unknown): void {
  if (!installedExtension(id)) return
  const all = extensionStorage(id)
  if (value === undefined) delete all[key]
  else all[key] = value
  const text = JSON.stringify(all)
  if (text.length > 5 * 1024 * 1024) throw new Error('Données de l’extension trop volumineuses (plus de 5 Mo)')
  fs.mkdirSync(path.dirname(dataFile(id)), { recursive: true })
  fs.writeFileSync(dataFile(id), text)
}

export function dropExtensionStorage(id: string): void {
  fs.rmSync(dataFile(id), { force: true })
  fs.rmSync(path.join(app.getPath('userData'), 'extension-data', id), { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Partie Node.js
// ---------------------------------------------------------------------------

const nodeParts = new Map<string, UtilityProcess>()

/** Lance (ou relance) la partie Node.js d'une extension de confiance, reliée à la fenêtre par un MessagePort */
export async function startNodePart(id: string, win: BrowserWindow): Promise<void> {
  await stopNodePart(id)
  const e = installedExtension(id)
  if (!e?.ext.node || !trusted(e.ext)) throw new Error('Cette extension n’a pas de partie Node.js utilisable')
  // Dossier de données de l'extension (programmes téléchargés…) : hors de son dossier, dont l'empreinte doit rester
  const dataDir = path.join(app.getPath('userData'), 'extension-data', id)
  fs.mkdirSync(dataDir, { recursive: true })
  const child = utilityProcess.fork(path.join(__dirname, 'extNodeHost.js'), [path.join(e.folder, e.ext.node)], {
    serviceName: `Extension ${e.ext.name}`,
    // Pas son propre dossier : sous Windows, il serait verrouillé (mise à jour, désinstallation impossibles)
    cwd: dataDir,
    env: { ...process.env, LUMEN_EXT_DATA: dataDir, LUMEN_VERSION: app.getVersion() }
  })
  nodeParts.set(id, child)
  child.on('exit', () => nodeParts.get(id) === child && nodeParts.delete(id))
  const { port1, port2 } = new MessageChannelMain()
  child.postMessage('port', [port1])
  win.webContents.postMessage('ext:node-port', id, [port2])
}

/** Arrête la partie Node.js et attend la fin de son processus (3 s au plus) */
export function stopNodePart(id: string): Promise<void> {
  const child = nodeParts.get(id)
  nodeParts.delete(id)
  if (!child) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill()
  })
}

export function stopAllNodeParts(): void {
  for (const child of nodeParts.values()) child.kill()
  nodeParts.clear()
}

// ---------------------------------------------------------------------------
// Micro et caméra des extensions isolées : demandés une fois à l'utilisateur, réponse retenue
// ---------------------------------------------------------------------------

const sandboxId = (url: string): string | null => {
  try {
    const u = new URL(url)
    return u.protocol === 'lumen-ext:' && u.hostname.startsWith('sb-') ? u.hostname.slice(3) : null
  } catch {
    return null
  }
}

export function handleExtensionPermissions(getWin: () => BrowserWindow | null): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const id = sandboxId(details.requestingUrl)
    // Lumen TeX lui-même (et les extensions de confiance, dans sa fenêtre) : comportement par défaut d'Electron
    if (!id) return callback(true)
    const e = installedExtension(id)
    const media = permission === 'media' ? ((details as { mediaTypes?: string[] }).mediaTypes ?? []) : []
    const declared =
      !!e && media.length > 0 && media.every((m) => (m === 'audio' ? e.ext.permissions.microphone : m === 'video' ? e.ext.permissions.camera : false))
    if (!e || !declared) return callback(false)
    const known = getSettings().extMedia[id]
    if (known !== undefined) return callback(known)
    const what = media.includes('video') ? (media.includes('audio') ? 'votre micro et votre caméra' : 'votre caméra') : 'votre micro'
    const opts = {
      type: 'question' as const,
      message: `« ${e.ext.name} » veut utiliser ${what}`,
      detail: 'Votre réponse est retenue pour cette extension. Vous pourrez la changer dans ses réglages.',
      buttons: ['Autoriser', 'Refuser'],
      defaultId: 1,
      cancelId: 1
    }
    const win = getWin()
    void (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)).then(({ response }) => {
      const ok = response === 0
      setSettings({ extMedia: { ...getSettings().extMedia, [id]: ok } })
      callback(ok)
    })
  })
  ses.setPermissionCheckHandler((_wc, permission, origin) => {
    const id = sandboxId(origin)
    if (!id) return true
    return permission === 'media' && getSettings().extMedia[id] === true
  })
}
