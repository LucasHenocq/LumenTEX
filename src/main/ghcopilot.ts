import { app, net } from 'electron'
import { execFile, spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { AiStatus } from '../shared/types'
import { runLogin } from './login'
import { tar } from './tar'
import { getSettings, setSettings } from './store'

// Moteur « GitHub Copilot » du copilot : CLI `copilot` en mode non interactif (-p) dans le dossier du projet.
// La conversation continue grâce à un identifiant de session fixé par l'éditeur (--session-id).

const SYSTEM = [
  'Tu es l’assistant LaTeX intégré à l’éditeur Lumen TeX. Réponds en français, de façon concise.',
  'Le projet est compilé par Tectonic (XeLaTeX) : pas de fontenc/inputenc, pas de biber (BibTeX/natbib).',
  'Tu peux lire et modifier directement les fichiers du projet ; l’éditeur recharge les fichiers modifiés.',
  'Quand tu proposes du code sans l’appliquer, mets-le dans un bloc ```latex.'
].join(' ')

const AUTH_ERROR = /No authentication information found|not authenticated|authentication failed|\b401\b/i
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g

let child: ChildProcess | null = null
const sessions = new Map<string, string>()
const EXE = process.platform === 'win32' ? 'copilot.exe' : 'copilot'
const installedBin = (): string => path.join(app.getPath('userData'), 'bin', EXE)

function copilotBin(): string | null {
  const dirs = [path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH ?? '').split(path.delimiter)]
  return [installedBin(), ...dirs.filter(Boolean).map((d) => path.join(d, EXE))].find((p) => fs.existsSync(p)) ?? null
}

const copilotHome = (): string => process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot')

/**
 * La CLI n'a pas de commande « statut » : on retient le résultat de la dernière connexion ou requête,
 * sinon on devine d'après un jeton d'environnement ou un compte enregistré dans la config.
 */
function guessLoggedIn(): boolean {
  const known = getSettings().copilotLoggedIn
  if (known !== null) return known
  if (process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return true
  try {
    const cfg = fs.readFileSync(path.join(copilotHome(), 'config.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '')
    return Object.keys(JSON.parse(cfg) as object).some((k) => /user|login|auth|token/i.test(k))
  } catch {
    return false
  }
}

const remember = (loggedIn: boolean): void => void setSettings({ copilotLoggedIn: loggedIn })

export async function copilotStatus(): Promise<AiStatus> {
  if (!copilotBin()) return { installed: false, loggedIn: false }
  return { installed: true, loggedIn: guessLoggedIn() }
}

export async function loginCopilot(onUrl: (url: string) => void): Promise<AiStatus> {
  const bin = copilotBin()
  if (!bin) throw new Error('GitHub Copilot CLI n’est pas installé')
  await runLogin(bin, ['login'], process.env, onUrl)
  remember(true)
  return copilotStatus()
}

/** Binaire autonome publié sur npm (@github/copilot-<plateforme>-<arch>, ex. win32-x64), installé dans userData/bin */
export async function installCopilot(onProgress: (msg: string) => void): Promise<AiStatus> {
  const pkg = `@github/copilot-${process.platform}-${process.arch}`
  onProgress('Recherche de la dernière version…')
  const meta = await net.fetch(`https://registry.npmjs.org/${pkg}/latest`)
  if (!meta.ok) throw new Error(`Paquet introuvable pour cette machine (${pkg})`)
  const { version, dist } = (await meta.json()) as { version: string; dist: { tarball: string } }

  const dir = path.dirname(installedBin())
  fs.mkdirSync(dir, { recursive: true })
  const archive = path.join(dir, 'copilot.tgz')
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
        onProgress(`Téléchargement de Copilot ${version} : ${mb(received)}${total ? ` / ${mb(total)}` : ''} Mo`)
      }
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
    onProgress('Extraction…')
    await tar(['xzf', archive, '-C', dir, '--strip-components=1', `package/${EXE}`])
    fs.chmodSync(installedBin(), 0o755)
  } finally {
    fs.rmSync(archive, { force: true })
  }
  return copilotStatus()
}

let models: string[] | null = null

/** Modèles proposés par la CLI, lus dans son aide (liste à jour avec la version installée) */
export function copilotModels(): Promise<string[]> {
  const bin = copilotBin()
  if (models || !bin) return Promise.resolve(models ?? [])
  return new Promise((resolve) => {
    execFile(bin, ['help', 'config'], { timeout: 15000, env: { ...process.env, NO_COLOR: '1' } }, (_err, stdout) => {
      const section = /`model`:[^\n]*\n((?:\s+- "[^"]+"\n?)+)/.exec(stdout.replace(ANSI, ''))?.[1] ?? ''
      const list = [...section.matchAll(/- "([^"]+)"/g)].map((m) => m[1])
      if (list.length) models = list
      resolve(list)
    })
  })
}

export function resetCopilot(root: string): void {
  sessions.delete(root)
}

export function stopCopilot(): void {
  child?.kill()
}

export function askCopilot(root: string, prompt: string, onText: (t: string) => void): Promise<void> {
  stopCopilot()
  let session = sessions.get(root)
  const first = !session
  if (!session) sessions.set(root, (session = randomUUID()))
  const run = runCopilot(
    root,
    [
      '-p', first ? `${SYSTEM}\n\n${prompt}` : prompt,
      '--session-id', session,
      // Peut éditer les fichiers, mais pas lancer de commandes (aucune fenêtre pour valider)
      '--allow-all-tools',
      '--deny-tool', 'shell'
    ],
    onText
  )
  child = run.child
  return run.done
    .catch((e: Error) => {
      if (first || /pas connecté/.test(e.message)) sessions.delete(root)
      throw e
    })
    .finally(() => {
      if (child === run.child) child = null
    })
}

/** Lance la CLI en mode non interactif, sortie texte streamée ; le modèle choisi dans les réglages est appliqué */
export function runCopilot(cwd: string, extraArgs: string[], onText: (t: string) => void): { child: ChildProcess | null; done: Promise<void> } {
  const bin = copilotBin()
  if (!bin) return { child: null, done: Promise.reject(new Error('GitHub Copilot CLI n’est pas installé')) }
  const args = ['-s', '--stream', 'on', ...extraArgs]
  const model = getSettings().copilotModel.trim()
  if (model) args.push('--model', model)

  const c = spawn(bin, args, { cwd, env: { ...process.env, NO_COLOR: '1' } })
  const done = new Promise<void>((resolve, reject) => {
    let out = ''
    let err = ''
    c.stdout.on('data', (d: Buffer) => {
      const t = d.toString('utf8').replace(ANSI, '')
      out += t
      if (!AUTH_ERROR.test(out)) onText(t)
    })
    c.stderr.on('data', (d: Buffer) => (err += d.toString('utf8').replace(ANSI, '')))
    c.on('error', (e) => reject(new Error(`GitHub Copilot introuvable (${e.message})`)))
    c.on('close', (code, signal) => {
      if (signal) return resolve() // arrêté par l'utilisateur
      if (AUTH_ERROR.test(out + err)) {
        remember(false)
        return reject(new Error('GitHub Copilot n’est pas connecté.'))
      }
      if (code) return reject(new Error(err.trim() || out.trim() || `code ${code}`))
      remember(true)
      resolve()
    })
    c.stdin.end()
  })
  return { child: c, done }
}
