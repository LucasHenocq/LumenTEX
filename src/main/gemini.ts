import { app, net, safeStorage } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { AiStatus } from '../shared/types'
import { tar } from './tar'
import { getSettings } from './store'

// Moteur « Gemini » du copilot : CLI Gemini de Google (paquet npm @google/gemini-cli, un script Node).
// Elle tourne avec le Node intégré à l'app (ELECTRON_RUN_AS_NODE) : rien d'autre à installer sur le Mac.
// Authentification par clé d'API (Google AI Studio) : Google refuse désormais la connexion « compte Google »
// de la CLI pour les comptes personnels (IneligibleTierError UNSUPPORTED_CLIENT).
// La CLI a son propre dossier de configuration dans userData, séparé de ~/.gemini.
// La conversation continue grâce à un identifiant de session fixé par l'éditeur (--session-id puis --resume).

const SYSTEM = [
  'Tu es l’assistant LaTeX intégré à l’éditeur Lumen TeX. Réponds en français, de façon concise.',
  'Le projet est compilé par Tectonic (XeLaTeX) : pas de fontenc/inputenc, pas de biber (BibTeX/natbib).',
  'Tu peux lire et modifier directement les fichiers du projet ; l’éditeur recharge les fichiers modifiés.',
  'Quand tu proposes du code sans l’appliquer, mets-le dans un bloc ```latex.'
].join(' ')

const AUTH_ERROR = /API key not valid|API_KEY_INVALID|auth method|GEMINI_API_KEY|unauthenticated|\b401\b/i

let child: ChildProcess | null = null
const sessions = new Map<string, string>()
const baseDir = (): string => path.join(app.getPath('userData'), 'gemini')
const installedEntry = (): string => path.join(baseDir(), 'package', 'bundle', 'gemini.js')
const cliHome = (): string => path.join(baseDir(), 'home')
const keyFile = (): string => path.join(baseDir(), 'api-key.bin')

/** Clé d'API : variable d'environnement si présente, sinon celle enregistrée (chiffrée par le système : trousseau macOS, DPAPI Windows) */
function apiKey(): string | null {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY
  try {
    return safeStorage.decryptString(fs.readFileSync(keyFile()))
  } catch {
    return null
  }
}

/** Script JS de la CLI : version installée par l'app, sinon une installation npm/Homebrew existante */
function geminiEntry(): string | null {
  if (fs.existsSync(installedEntry())) return installedEntry()
  // npm install -g sous Windows : gemini.cmd n'est pas un lien, le script est dans node_modules
  const npmWin = process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js')
  if (npmWin && fs.existsSync(npmWin)) return npmWin
  const dirs = [path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH ?? '').split(path.delimiter)]
  for (const d of dirs.filter(Boolean)) {
    try {
      const real = fs.realpathSync(path.join(d, 'gemini'))
      if (real.endsWith('.js')) return real
    } catch {
      /* absent */
    }
  }
  return null
}

/**
 * Lanceur : sous Electron, yargs croit être dans une app empaquetée et lit mal les arguments ;
 * process.defaultApp = true lui fait lire process.argv comme sous Node.
 */
function launcher(): string {
  const file = path.join(baseDir(), 'launch.mjs')
  const code = [
    '// Écrit par Lumen TeX : lance la CLI Gemini avec le Node intégré à l’app',
    "import { pathToFileURL } from 'node:url'",
    'process.defaultApp = true',
    'await import(pathToFileURL(process.env.LUMEN_GEMINI_ENTRY).href)',
    ''
  ].join('\n')
  fs.mkdirSync(baseDir(), { recursive: true })
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== code) fs.writeFileSync(file, code)
  return file
}

/**
 * Environnement de la CLI : Node intégré à l'app, et pas de relance dans un sous-processus
 * (sinon l'arrêt ou l'annulation ne tuent que le parent et la CLI continue en arrière-plan).
 */
const geminiEnv = (entry: string): NodeJS.ProcessEnv => ({
  ...process.env,
  GEMINI_API_KEY: apiKey() ?? '',
  GEMINI_CLI_HOME: cliHome(),
  ELECTRON_RUN_AS_NODE: '1',
  GEMINI_CLI_NO_RELAUNCH: 'true',
  LUMEN_GEMINI_ENTRY: entry,
  NO_COLOR: '1'
})

function spawnGemini(entry: string, args: string[], cwd: string): ChildProcess {
  return spawn(process.execPath, [launcher(), ...args], { cwd, env: geminiEnv(entry) })
}

export async function geminiStatus(): Promise<AiStatus> {
  if (!geminiEntry()) return { installed: false, loggedIn: false }
  const key = apiKey()
  return { installed: true, loggedIn: !!key, account: key ? `clé …${key.slice(-4)}` : undefined }
}

/** Vérifie la clé auprès de l'API Gemini puis l'enregistre chiffrée */
export async function setGeminiKey(key: string): Promise<AiStatus> {
  key = key.trim()
  if (!key) throw new Error('Clé vide')
  const res = await net.fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`)
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(`Clé refusée par Google : ${j.error?.message ?? `HTTP ${res.status}`}`)
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Chiffrement du système indisponible : impossible d’enregistrer la clé')
  fs.mkdirSync(baseDir(), { recursive: true })
  fs.writeFileSync(keyFile(), safeStorage.encryptString(key))
  return geminiStatus()
}

/** Paquet npm @google/gemini-cli (script autonome, sans dépendance obligatoire) extrait dans userData/gemini */
export async function installGemini(onProgress: (msg: string) => void): Promise<AiStatus> {
  onProgress('Recherche de la dernière version…')
  const meta = await net.fetch('https://registry.npmjs.org/@google/gemini-cli/latest')
  if (!meta.ok) throw new Error(`Registre npm injoignable (HTTP ${meta.status})`)
  const { version, dist } = (await meta.json()) as { version: string; dist: { tarball: string } }

  const dir = baseDir()
  fs.mkdirSync(dir, { recursive: true })
  const archive = path.join(dir, 'gemini-cli.tgz')
  try {
    const res = await net.fetch(dist.tarball)
    if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (HTTP ${res.status})`)
    const total = Number(res.headers.get('content-length')) || 0
    const out = fs.createWriteStream(archive)
    const reader = res.body.getReader()
    let received = 0
    let lastEmit = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r))
      if (Date.now() - lastEmit > 150) {
        lastEmit = Date.now()
        const mb = (n: number): string => (n / 1e6).toFixed(0)
        onProgress(`Téléchargement de Gemini CLI ${version} : ${mb(received)}${total ? ` / ${mb(total)}` : ''} Mo`)
      }
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
    onProgress('Extraction…')
    fs.rmSync(path.join(dir, 'package'), { recursive: true, force: true })
    await tar(['xzf', archive, '-C', dir])
  } finally {
    fs.rmSync(archive, { force: true })
  }
  return geminiStatus()
}

export function resetGemini(root: string): void {
  sessions.delete(root)
}

export function stopGemini(): void {
  child?.kill()
}

export function askGemini(root: string, prompt: string, onText: (t: string) => void): Promise<void> {
  stopGemini()
  const session = sessions.get(root)
  const id = session ?? randomUUID()
  const run = runGemini(
    root,
    [
      '-p', session ? prompt : `${SYSTEM}\n\n${prompt}`,
      ...(session ? ['--resume', id] : ['--session-id', id]),
      // Peut éditer les fichiers ; les commandes, qui demandent une validation, sont refusées en mode non interactif
      '--approval-mode', 'auto_edit'
    ],
    { onText, onTool: (name) => onText(`\n🔧 ${name}…\n`) }
  )
  child = run.child
  return run.done
    .then(() => void sessions.set(root, id))
    .finally(() => {
      if (child === run.child) child = null
    })
}

/** Lance la CLI en mode non interactif (événements JSON streamés) ; le modèle choisi dans les réglages est appliqué */
export function runGemini(
  cwd: string,
  extraArgs: string[],
  h: { onText: (t: string) => void; onTool?: (name: string) => void }
): { child: ChildProcess | null; done: Promise<void> } {
  const entry = geminiEntry()
  if (!entry) return { child: null, done: Promise.reject(new Error('La CLI Gemini n’est pas installée')) }
  const args = ['-o', 'stream-json', '--skip-trust', ...extraArgs]
  const model = getSettings().geminiModel.trim()
  if (model) args.push('-m', model)

  const c = spawnGemini(entry, args, cwd)
  const done = new Promise<void>((resolve, reject) => {
    let buf = ''
    let err = ''
    let failed = ''
    // Connexion expirée : la CLI demande d'ouvrir le navigateur et attendrait une réponse indéfiniment
    const needsLogin = (t: string): void => {
      if (!/authentication page|\[Y\/n\]/i.test(t)) return
      failed = 'Gemini n’est pas connecté.'
      c.kill()
    }
    c.stdout?.on('data', (d: Buffer) => {
      needsLogin(d.toString('utf8'))
      buf += d.toString('utf8')
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const l of lines) {
        if (!l.trim()) continue
        let j: Record<string, any>
        try {
          j = JSON.parse(l)
        } catch {
          continue
        }
        if (j.type === 'message' && j.role === 'assistant' && typeof j.content === 'string') h.onText(j.content)
        else if (j.type === 'tool_use') h.onTool?.(String(j.tool_name))
        else if (j.type === 'error') failed = String(j.message ?? 'erreur')
        else if (j.type === 'result' && j.status === 'error') failed = String(j.error?.message ?? failed ?? 'erreur')
      }
    })
    c.stderr?.on('data', (d: Buffer) => {
      needsLogin(d.toString('utf8'))
      err += d.toString('utf8')
    })
    c.on('error', (e) => reject(new Error(`Gemini introuvable (${e.message})`)))
    c.on('close', (code, signal) => {
      if (signal && !failed) return resolve() // arrêté par l'utilisateur
      if (failed || code) {
        const msg = failed || err.trim().split('\n').slice(-3).join('\n') || `code ${code}`
        if (AUTH_ERROR.test(msg)) {
          // Clé révoquée ou invalide : on l'oublie pour réafficher l'écran de saisie
          fs.rmSync(keyFile(), { force: true })
          return reject(new Error('Gemini n’est pas connecté : clé d’API refusée.'))
        }
        return reject(new Error(msg))
      }
      resolve()
    })
    c.stdin?.end()
  })
  return { child: c, done }
}
