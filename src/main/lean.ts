import { app, net } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import type { LeanDiag, LeanProgress, LeanStatus } from '../shared/types'
import { tar } from './tar'

// Lean 4 + Mathlib : installés à la demande (plusieurs Go, jamais dans l'installeur de l'app).
// elan (gestionnaire de versions de Lean) dans ~/.elan, partagé avec une éventuelle installation existante ;
// un projet Lake avec Mathlib précompilé dans les données de l'app, qui sert à vérifier tous les fichiers .lean.

const WIN = process.platform === 'win32'
const EXE = WIN ? '.exe' : ''
const elanHome = (): string => process.env.ELAN_HOME || path.join(os.homedir(), '.elan')
const lake = (): string => path.join(elanHome(), 'bin', 'lake' + EXE)
// Dans le dossier de l'app même avec des données séparées (LUMEN_USER_DATA, tests) : plusieurs Go, installés une seule fois
const leanDir = (): string => path.join(app.getPath('appData'), 'Lumen TeX', 'lean')
const workspace = (): string => path.join(leanDir(), 'mathlib')
/** Écrit une fois l'installation vérifiée : « Lean 4.x · Mathlib 4.x » */
const readyFile = (): string => path.join(workspace(), '.lumen-ready')
/** Git portable (Windows sans Git) : Lake en a besoin pour récupérer Mathlib */
const gitDir = (): string => path.join(leanDir(), 'git')

function env(): NodeJS.ProcessEnv {
  const e = { ...process.env }
  // Windows : la variable s'appelle « Path », en ajouter une seconde « PATH » serait ambigu
  const key = Object.keys(e).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  e[key] = [path.join(elanHome(), 'bin'), path.join(gitDir(), 'cmd'), e[key]].join(path.delimiter)
  return e
}

export function leanStatus(): LeanStatus {
  try {
    return { ready: true, version: fs.readFileSync(readyFile(), 'utf8').trim() }
  } catch {
    return { ready: false }
  }
}

async function download(url: string, dest: string, onBytes?: (received: number, total: number) => void): Promise<void> {
  const res = await net.fetch(url)
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (HTTP ${res.status})`)
  const total = Number(res.headers.get('content-length')) || 0
  const out = fs.createWriteStream(dest)
  const reader = res.body.getReader()
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r))
    onBytes?.(received, total)
  }
  await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
}

async function json<T>(url: string): Promise<T> {
  const res = await net.fetch(url, { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`GitHub ne répond pas (HTTP ${res.status})`)
  return (await res.json()) as T
}

/** Lance une commande ; chaque ligne affichée (y compris les barres de progression en \r) est remontée */
function run(cmd: string, args: string[], cwd: string, onLine: (l: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { cwd, env: env() })
    let tail = ''
    const read = (d: Buffer): void => {
      for (const l of d.toString('utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/[\r\n]+/)) {
        if (!l.trim()) continue
        tail = (tail + '\n' + l).slice(-2000)
        onLine(l.trim().slice(0, 140))
      }
    }
    c.stdout.on('data', read)
    c.stderr.on('data', read)
    c.on('error', reject)
    c.on('close', (code) => (code ? reject(new Error(tail.trim().split('\n').slice(-3).join(' ') || `code ${code}`)) : resolve()))
  })
}

function hasGit(): Promise<boolean> {
  return new Promise((resolve) => {
    const c = spawn('git', ['--version'], { env: env() })
    c.on('error', () => resolve(false))
    c.on('close', (code) => resolve(code === 0))
  })
}

export async function installLean(onProgress: (p: LeanProgress) => void): Promise<LeanStatus> {
  const STEPS = 4
  let current = ''
  const step = (n: number, text: string) => (detail?: string) => {
    current = text
    onProgress({ step: n, of: STEPS, text, detail })
  }
  fs.mkdirSync(leanDir(), { recursive: true })
  const tmp = fs.mkdtempSync(path.join(leanDir(), 'tmp-'))
  try {
    // 1. elan, sauf s'il est déjà là
    const s1 = step(1, 'Installation d’elan, le gestionnaire de Lean')
    s1()
    if (!fs.existsSync(lake())) {
      const target = WIN
        ? 'x86_64-pc-windows-msvc.zip'
        : `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-${process.platform === 'darwin' ? 'apple-darwin' : 'unknown-linux-gnu'}.tar.gz`
      const archive = path.join(tmp, `elan-${target}`)
      await download(`https://github.com/leanprover/elan/releases/latest/download/elan-${target}`, archive, (r, t) =>
        s1(t ? `${Math.round((r / t) * 100)} %` : `${(r / 1e6).toFixed(1)} Mo`)
      )
      await tar(['xf', archive, '-C', tmp])
      const init = path.join(tmp, 'elan-init' + EXE)
      fs.chmodSync(init, 0o755)
      await run(init, ['-y', '--default-toolchain', 'none', '--no-modify-path'], tmp, s1)
    }

    // 2. Git (Lake s'en sert pour récupérer Mathlib) : version portable sous Windows s'il manque
    const s2 = step(2, 'Vérification de Git')
    s2()
    if (!(await hasGit())) {
      if (!WIN) throw new Error('Git est nécessaire. Sur Mac : lancez « xcode-select --install » dans le Terminal ; sur Linux : installez le paquet git.')
      const rel = await json<{ assets: { name: string; browser_download_url: string }[] }>('https://api.github.com/repos/git-for-windows/git/releases/latest')
      const asset = rel.assets.find((a) => new RegExp(`^MinGit-[\\d.]+-${process.arch === 'arm64' ? 'arm64' : '64-bit'}\\.zip$`).test(a.name))
      if (!asset) throw new Error('Git portable introuvable')
      const zip = path.join(tmp, asset.name)
      await download(asset.browser_download_url, zip, (r, t) => s2(`Téléchargement de Git : ${t ? Math.round((r / t) * 100) + ' %' : (r / 1e6).toFixed(1) + ' Mo'}`))
      fs.rmSync(gitDir(), { recursive: true, force: true })
      fs.mkdirSync(gitDir(), { recursive: true })
      await tar(['xf', zip, '-C', gitDir()])
    }

    // 3. Projet Mathlib : dernière version stable (avec sa version de Lean), récupérée par Lake
    const s3 = step(3, 'Téléchargement de Lean et de Mathlib')
    s3()
    const refs = await json<{ ref: string }[]>('https://api.github.com/repos/leanprover-community/mathlib4/git/matching-refs/tags/v4.')
    const num = (v: string): number[] => v.slice(1).split('.').map(Number)
    const newer = (a: string, b: string): boolean => {
      const [x, y] = [num(a), num(b)]
      for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) > (y[i] ?? 0)
      return false
    }
    const tag = refs
      .map((r) => r.ref.replace('refs/tags/', ''))
      .filter((t) => /^v4\.\d+\.\d+$/.test(t))
      .reduce((a, b) => (newer(b, a) ? b : a), 'v4.0.0')
    const res = await net.fetch(`https://raw.githubusercontent.com/leanprover-community/mathlib4/${tag}/lean-toolchain`)
    if (!res.ok) throw new Error('Version de Lean de Mathlib introuvable')
    const toolchain = (await res.text()).trim()
    const ws = workspace()
    fs.mkdirSync(ws, { recursive: true })
    fs.rmSync(readyFile(), { force: true })
    fs.writeFileSync(path.join(ws, 'lean-toolchain'), toolchain + '\n')
    fs.writeFileSync(
      path.join(ws, 'lakefile.toml'),
      `name = "lumen"\n\n[[require]]\nname = "mathlib"\ngit = "https://github.com/leanprover-community/mathlib4"\nrev = "${tag}"\n`
    )
    await run(lake(), ['update'], ws, s3)

    // 4. Mathlib déjà compilé (sinon des heures de compilation), puis essai réel
    const s4 = step(4, 'Téléchargement de Mathlib compilé')
    s4()
    await run(lake(), ['exe', 'cache', 'get'], ws, s4)
    s4('Vérification…')
    const test = path.join(tmp, 'Test.lean')
    fs.writeFileSync(test, 'import Mathlib\n\nexample (n : ℕ) : n + 0 = n := by simp\n')
    const r = await checkLean(test)
    if (!r.ok) throw new Error(r.messages.find((m) => m.severity === 'error')?.message ?? 'Lean ne fonctionne pas')
    fs.writeFileSync(readyFile(), `Lean ${toolchain.split(':').pop()?.replace(/^v/, '')} · Mathlib ${tag.slice(1)}`)
    onProgress({ step: STEPS, of: STEPS, text: 'Terminé', done: true })
    return leanStatus()
  } catch (e) {
    // Détail technique dans le journal ; message compréhensible à l'écran
    const msg = (e as Error).message
    fs.appendFileSync(path.join(leanDir(), 'install.log'), `${new Date().toISOString()} ${current} : ${msg}\n`)
    const text = /Git est nécessaire/.test(msg)
      ? msg
      : /net::|HTTP|fetch|ENOTFOUND|ECONNRESET|ETIMEDOUT|Could not resolve|unable to access/i.test(msg)
        ? 'le téléchargement a échoué. Vérifiez la connexion à Internet, puis réessayez : ce qui est déjà téléchargé est conservé.'
        : /ENOSPC|No space/i.test(msg)
          ? 'il n’y a plus assez de place sur le disque (environ 10 Go nécessaires).'
          : `l’étape « ${current} » a échoué. Réessayez ; le détail est dans le fichier install.log du dossier Lean de l’app.`
    onProgress({ step: 0, of: STEPS, text, error: true })
    throw e
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// --- Vérification d'un fichier (une fois, hors éditeur) ---

/** Fichier entier vérifié par Lean : ok si aucune erreur et aucune preuve laissée en « sorry » */
export function checkLean(file: string): Promise<{ ok: boolean; messages: LeanDiag[] }> {
  return new Promise((resolve) => {
    const c = spawn(lake(), ['env', 'lean', '--json', file], { cwd: workspace(), env: env() })
    let out = ''
    let err = ''
    const timer = setTimeout(() => c.kill(), 5 * 60_000)
    c.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')))
    c.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')))
    c.on('error', (e) => resolve({ ok: false, messages: [{ severity: 'error', line: 1, col: 0, message: e.message }] }))
    c.on('close', (code) => {
      clearTimeout(timer)
      const messages: LeanDiag[] = []
      for (const l of out.split('\n')) {
        try {
          const m = JSON.parse(l) as { severity: string; pos?: { line: number; column: number }; endPos?: { line: number; column: number }; data: string }
          messages.push({
            severity: m.severity === 'error' ? 'error' : m.severity === 'warning' ? 'warning' : 'info',
            line: m.pos?.line ?? 1,
            col: m.pos?.column ?? 0,
            endLine: m.endPos?.line,
            endCol: m.endPos?.column,
            message: m.data
          })
        } catch {
          /* ligne hors JSON */
        }
      }
      if (code && !messages.some((m) => m.severity === 'error'))
        messages.push({ severity: 'error', line: 1, col: 0, message: err.trim() || out.trim() || `Lean s’est arrêté (code ${code})` })
      resolve({ ok: !code && isComplete(messages), messages })
    })
  })
}

/** Aucune erreur, et aucune déclaration laissée en « sorry » */
export const isComplete = (messages: LeanDiag[]): boolean =>
  !messages.some((m) => m.severity === 'error' || /declaration uses ['`]sorry['`]/.test(m.message))

// --- Serveur Lean (LSP) pour l'éditeur : erreurs en direct, buts à la position du curseur ---

let server: ChildProcess | null = null
let ready: Promise<void> | null = null
let nextId = 0
const waiting = new Map<number, (result: unknown) => void>()
/** Documents ouverts : URI envoyée au serveur → chemin, et version */
const opened = new Map<string, { file: string; version: number }>()

type Events = { diagnostics: (file: string, d: LeanDiag[]) => void; busy: (file: string, busy: boolean) => void }
let events: Events = { diagnostics: () => {}, busy: () => {} }
export const onLeanEvents = (e: Events): void => void (events = e)

function send(msg: object): void {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...msg }), 'utf8')
  server?.stdin?.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]))
}

function request<T>(method: string, params: object): Promise<T> {
  const id = ++nextId
  send({ id, method, params })
  return new Promise((resolve) => waiting.set(id, resolve as (r: unknown) => void))
}

type LspDiag = { range: { start: { line: number; character: number }; end: { line: number; character: number } }; severity?: number; message: string }

function onMessage(m: { id?: number; method?: string; params?: any; result?: unknown }): void {
  // Requête du serveur vers l'éditeur (configuration…) : réponse vide pour ne pas le bloquer
  if (m.method && m.id !== undefined) return send({ id: m.id, result: null })
  if (m.id !== undefined) {
    waiting.get(m.id)?.(m.result ?? null)
    waiting.delete(m.id)
    return
  }
  const doc = opened.get(m.params?.uri ?? m.params?.textDocument?.uri)
  if (!doc) return
  if (m.method === 'textDocument/publishDiagnostics')
    events.diagnostics(
      doc.file,
      (m.params.diagnostics as LspDiag[]).map((d) => ({
        severity: d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info',
        line: d.range.start.line + 1,
        col: d.range.start.character,
        endLine: d.range.end.line + 1,
        endCol: d.range.end.character,
        message: d.message
      }))
    )
  else if (m.method === '$/lean/fileProgress') events.busy(doc.file, (m.params.processing as unknown[]).length > 0)
}

function startServer(): Promise<void> {
  if (ready) return ready
  const c = spawn(lake(), ['serve'], { cwd: workspace(), env: env() })
  server = c
  let buf = Buffer.alloc(0)
  c.stdout!.on('data', (d: Buffer) => {
    buf = Buffer.concat([buf, d])
    for (;;) {
      const sep = buf.indexOf('\r\n\r\n')
      if (sep < 0) return
      const len = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, sep).toString())?.[1])
      if (buf.length < sep + 4 + len) return
      const body = buf.subarray(sep + 4, sep + 4 + len).toString('utf8')
      buf = buf.subarray(sep + 4 + len)
      try {
        onMessage(JSON.parse(body))
      } catch {
        /* message illisible */
      }
    }
  })
  c.stderr!.on('data', () => {})
  const reset = (): void => {
    if (server !== c) return
    server = null
    ready = null
    for (const r of waiting.values()) r(null)
    waiting.clear()
    // Arrêt inattendu : les documents seront rouverts à la prochaine modification
    for (const d of opened.values()) events.busy(d.file, false)
    opened.clear()
  }
  c.on('error', reset)
  c.on('close', reset)
  ready = request('initialize', { processId: process.pid, rootUri: pathToFileURL(workspace()).href, capabilities: {} }).then(() =>
    send({ method: 'initialized', params: {} })
  )
  return ready
}

const uriOf = (file: string): string => pathToFileURL(file).href

/** Contenu d'un fichier .lean ouvert dans l'éditeur (ouverture ou modification) */
export async function leanSync(file: string, text: string): Promise<void> {
  if (!leanStatus().ready) return
  await startServer()
  const uri = uriOf(file)
  const doc = opened.get(uri)
  if (!doc) {
    opened.set(uri, { file, version: 1 })
    send({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'lean4', version: 1, text } } })
  } else {
    doc.version++
    send({ method: 'textDocument/didChange', params: { textDocument: { uri, version: doc.version }, contentChanges: [{ text }] } })
  }
}

export function leanClose(file: string): void {
  const uri = uriOf(file)
  if (!opened.delete(uri)) return
  send({ method: 'textDocument/didClose', params: { textDocument: { uri } } })
}

/** Buts de la preuve à une position (ligne et colonne à partir de 0) ; null hors d'une preuve */
export async function leanGoal(file: string, line: number, character: number): Promise<string[] | null> {
  const uri = uriOf(file)
  if (!opened.has(uri)) return null
  const r = await request<{ goals?: string[] } | null>('$/lean/plainGoal', { textDocument: { uri }, position: { line, character } })
  return r?.goals ?? null
}

export function stopLeanServer(): void {
  server?.kill()
}
