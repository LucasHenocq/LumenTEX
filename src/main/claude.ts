import { execFile, spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { AiStatus } from '../shared/types'
import { runLogin } from './login'
import { getSettings } from './store'

// Moteur « Claude Code » du copilot : lance la CLI installée en mode headless dans le dossier du projet.
// Utilise le compte déjà connecté dans Claude Code ; la conversation continue via --resume.

export type ClaudeUsage = { fiveHour?: number; fiveHourResetsAt?: number; sevenDay?: number }

const SYSTEM = [
  'Tu es l’assistant LaTeX intégré à l’éditeur Lumen TeX. Réponds en français, de façon concise.',
  'Le projet est compilé par Tectonic (XeLaTeX) : pas de fontenc/inputenc, pas de biber (BibTeX/natbib).',
  'Tu peux lire et modifier directement les fichiers du projet ; l’éditeur recharge les fichiers modifiés.',
  'Quand tu proposes du code sans l’appliquer, mets-le dans un bloc ```latex.'
].join(' ')

let child: ChildProcess | null = null
const sessions = new Map<string, string>()

function claudeBin(): string {
  // Lancée depuis le Finder ou le bureau, l'app n'a pas forcément le PATH du terminal : on cherche aux emplacements habituels
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const dirs = [path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
  return dirs.map((d) => path.join(d, exe)).find((p) => fs.existsSync(p)) ?? 'claude'
}

export function claudeStatus(): Promise<AiStatus> {
  return new Promise((resolve) => {
    // « auth status » sort avec le code 1 si non connecté, mais écrit quand même le JSON
    execFile(claudeBin(), ['auth', 'status', '--json'], { timeout: 15000 }, (err, stdout) => {
      if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return resolve({ installed: false, loggedIn: false })
      try {
        const j = JSON.parse(stdout) as { loggedIn?: boolean; email?: string }
        resolve({ installed: true, loggedIn: !!j.loggedIn, account: j.email })
      } catch {
        resolve({ installed: true, loggedIn: false })
      }
    })
  })
}

export async function loginClaude(onUrl: (url: string) => void): Promise<AiStatus> {
  await runLogin(claudeBin(), ['auth', 'login'], process.env, onUrl)
  return claudeStatus()
}

/** Installeur officiel : place le binaire dans ~/.local/bin (script PowerShell sous Windows, shell ailleurs) */
export function installClaude(onProgress: (msg: string) => void): Promise<AiStatus> {
  return new Promise((resolve, reject) => {
    const c =
      process.platform === 'win32'
        ? spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'], { env: process.env })
        : spawn('/bin/bash', ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'], { env: process.env })
    let out = ''
    const read = (d: Buffer): void => {
      out += d.toString('utf8')
      const last = out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim().split('\n').pop()
      if (last) onProgress(last.slice(0, 120))
    }
    c.stdout.on('data', read)
    c.stderr.on('data', read)
    c.on('error', reject)
    c.on('close', (code) => (code ? reject(new Error(`Installation échouée (code ${code})`)) : resolve(claudeStatus())))
  })
}

export function resetClaude(root: string): void {
  sessions.delete(root)
}

export function stopClaude(): void {
  child?.kill()
}

export function askClaude(
  root: string,
  prompt: string,
  onText: (t: string) => void,
  onUsage: (u: ClaudeUsage) => void
): Promise<void> {
  stopClaude()
  const args = [
    // Peut éditer les fichiers, mais pas lancer de commandes (aucune fenêtre pour valider)
    '--permission-mode', 'acceptEdits',
    '--append-system-prompt', SYSTEM
  ]
  const session = sessions.get(root)
  if (session) args.push('--resume', session)
  const run = runClaude(root, args, prompt, {
    onText,
    onTool: (name) => onText(`\n🔧 ${name}…\n`),
    onUsage,
    onSession: (id) => sessions.set(root, id)
  })
  child = run.child
  return run.done.finally(() => {
    if (child === run.child) child = null
  })
}

export type ClaudeHandlers = {
  onText: (t: string) => void
  onTool?: (name: string) => void
  onUsage?: (u: ClaudeUsage) => void
  onSession?: (id: string) => void
}

/** Lance la CLI en mode headless (sortie JSON streamée) ; le modèle choisi dans les réglages est appliqué */
export function runClaude(cwd: string, extraArgs: string[], prompt: string, h: ClaudeHandlers): { child: ChildProcess; done: Promise<void> } {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    // Pas de hooks/plugins perso de l'utilisateur dans l'éditeur ; le compte reste celui de la CLI
    '--setting-sources', 'project',
    ...extraArgs
  ]
  const model = getSettings().claudeModel.trim()
  if (model) args.push('--model', model)

  const c = spawn(claudeBin(), args, { cwd, env: process.env })
  const done = new Promise<void>((resolve, reject) => {
    let buf = ''
    let err = ''
    let failed = ''
    c.stdout.on('data', (d: Buffer) => {
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
        if (j.session_id) h.onSession?.(j.session_id)
        if (j.type === 'stream_event' && j.event?.type === 'content_block_delta' && j.event.delta?.type === 'text_delta') {
          h.onText(j.event.delta.text)
        } else if (j.type === 'stream_event' && j.event?.type === 'content_block_start' && j.event.content_block?.type === 'tool_use') {
          h.onTool?.(j.event.content_block.name)
        } else if (j.type === 'rate_limit_event') {
          const w = j.rate_limit_info?.unifiedWindows
          h.onUsage?.({ fiveHour: w?.five_hour?.utilization, fiveHourResetsAt: w?.five_hour?.resetsAt, sevenDay: w?.seven_day?.utilization })
        } else if (j.type === 'result' && j.is_error) {
          failed = String(j.result ?? j.subtype ?? 'erreur')
        }
      }
    })
    c.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')))
    c.on('error', (e) =>
      reject(new Error(`Claude Code introuvable (${e.message}). Installez-le : https://claude.com/claude-code`))
    )
    c.on('close', (code, signal) => {
      if (signal) return resolve() // arrêté par l'utilisateur
      if (failed || code) {
        const msg = failed || err.trim() || `code ${code}`
        return reject(new Error(/login|auth|credential/i.test(msg) ? `Claude Code n’est pas connecté. (${msg})` : msg))
      }
      resolve()
    })
    c.stdin.end(prompt)
  })
  return { child: c, done }
}
