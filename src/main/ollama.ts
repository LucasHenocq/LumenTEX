import { net } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { AiStatus } from '../shared/types'
import { searchDocs } from './docs'
import { getSettings, setSettings } from './store'

// Moteur « Ollama » du copilot : modèles locaux via l'API HTTP d'Ollama. Contrairement aux agents (Claude, Copilot,
// Gemini), il ne lit ni ne modifie les fichiers : le fichier ouvert, les pièces jointes et des extraits de documentation
// LaTeX (docs.ts) sont envoyés dans le prompt.

const OLLAMA = 'http://127.0.0.1:11434'
export const DEFAULT_OLLAMA_MODEL = 'gemma3:4b'
const NUM_CTX = 16384

let chatAbort: AbortController | null = null

function ollamaExe(): string | null {
  const exe = process.platform === 'win32' ? 'ollama.exe' : 'ollama'
  const dirs = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama') : '',
    '/Applications/Ollama.app/Contents/Resources',
    '/usr/local/bin',
    '/opt/homebrew/bin',
    ...(process.env.PATH ?? '').split(path.delimiter)
  ]
  return dirs.filter(Boolean).map((d) => path.join(d, exe)).find((p) => fs.existsSync(p)) ?? null
}

/** Modèles installés, ou null si le serveur Ollama ne répond pas */
async function installedModels(): Promise<string[] | null> {
  try {
    const res = await net.fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2000) })
    const j = (await res.json()) as { models: { name: string }[] }
    // Les modèles d'embedding ne savent pas discuter
    return j.models.map((m) => m.name).filter((n) => !/embed/i.test(n))
  } catch {
    return null
  }
}

export async function ollamaStatus(): Promise<AiStatus> {
  const models = await installedModels()
  if (models === null) return { installed: !!ollamaExe(), loggedIn: false, running: false }
  return { installed: true, running: true, loggedIn: models.length > 0, models }
}

/** Lance le serveur (l'application Ollama si présente, sinon « ollama serve ») et attend qu'il réponde */
export async function startOllama(): Promise<AiStatus> {
  const exe = ollamaExe()
  if (!exe) throw new Error('Ollama n’est pas installé')
  const app = path.join(path.dirname(exe), 'ollama app.exe')
  const c = fs.existsSync(app)
    ? spawn(app, [], { detached: true, stdio: 'ignore' })
    : spawn(exe, ['serve'], { detached: true, stdio: 'ignore', env: process.env })
  c.unref()
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if ((await installedModels()) !== null) return ollamaStatus()
  }
  throw new Error('Ollama ne répond pas après le lancement')
}

/** Télécharge un modèle (ollama pull) et le choisit pour le copilot */
export async function pullOllamaModel(onProgress: (msg: string) => void, model = DEFAULT_OLLAMA_MODEL): Promise<AiStatus> {
  await pullModel(model, onProgress)
  setSettings({ ollamaModel: model })
  return ollamaStatus()
}

/** ollama pull, avec progression */
export async function pullModel(model: string, onProgress: (msg: string) => void): Promise<void> {
  const res = await net.fetch(`${OLLAMA}/api/pull`, { method: 'POST', body: JSON.stringify({ model, stream: true }) })
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (HTTP ${res.status})`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const l of lines) {
      if (!l.trim()) continue
      const j = JSON.parse(l) as { status?: string; total?: number; completed?: number; error?: string }
      if (j.error) throw new Error(j.error)
      const gb = (n: number): string => (n / 1e9).toFixed(1)
      onProgress(j.total && j.completed ? `${model} : ${gb(j.completed)} / ${gb(j.total)} Go` : `${model} : ${j.status ?? '…'}`)
    }
  }
}

/** Passages de documentation pertinents, ajoutés au prompt (rien si pas d'index ou erreur) */
async function docsFor(query: string): Promise<string> {
  const found = await searchDocs(query).catch(() => [])
  if (!found.length) return ''
  return (
    '\n\nExtraits de documentation LaTeX (appuie-toi dessus en priorité, cite la source ; ne les invente pas s’ils ne répondent pas) :\n' +
    found.map((c) => `### ${c.title}\n${c.text}`).join('\n\n')
  )
}

type OllamaMessage = { role: string; content: string; images?: string[] }

/** Discussion streamée ; abort permet l'arrêt par l'utilisateur */
async function chat(messages: OllamaMessage[], onText: (t: string) => void): Promise<void> {
  chatAbort?.abort()
  const abort = (chatAbort = new AbortController())
  let res: Response
  try {
    res = await net.fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({ model: getSettings().ollamaModel, messages, options: { num_ctx: NUM_CTX } }),
      signal: abort.signal
    })
  } catch {
    throw new Error('Ollama injoignable : lancez Ollama')
  }
  if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Ollama : HTTP ${res.status}`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const l of lines) {
        if (!l.trim()) continue
        const j = JSON.parse(l) as { message?: { content: string }; error?: string }
        if (j.error) throw new Error(j.error)
        if (j.message?.content) onText(j.message.content)
      }
    }
  } catch (e) {
    if (!abort.signal.aborted) throw e
  } finally {
    if (chatAbort === abort) chatAbort = null
  }
}

/** Copilot : le premier message (system) reçoit en plus les extraits de documentation liés à la dernière question */
export async function askOllama(messages: OllamaMessage[], onText: (t: string) => void): Promise<void> {
  const question = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const withDocs = [{ ...messages[0], content: messages[0].content + (await docsFor(question)) }, ...messages.slice(1)]
  return chat(withDocs, onText)
}

/** Image → LaTeX : nécessite un modèle multimodal (gemma3 4b et plus, llava, qwen2.5vl…) */
export async function convertOllama(prompt: string, images: string[], onText: (t: string) => void): Promise<void> {
  const model = getSettings().ollamaModel
  const show = await net.fetch(`${OLLAMA}/api/show`, { method: 'POST', body: JSON.stringify({ model }) }).catch(() => null)
  const caps = show?.ok ? ((await show.json()) as { capabilities?: string[] }).capabilities : undefined
  if (caps && !caps.includes('vision'))
    throw new Error(`${model} ne lit pas les images : choisissez un modèle multimodal (gemma3:4b ou plus, llava, qwen2.5vl…)`)
  return chat([{ role: 'user', content: prompt, images }], onText)
}

export function stopOllama(): void {
  chatAbort?.abort()
}

