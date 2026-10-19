import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { AiEngine } from '../shared/types'
import { runClaude } from './claude'
import { runCopilot } from './ghcopilot'
import { runGemini } from './gemini'
import { chat, stopOllama } from './ollama'

// IA demandée par une extension (lumen.ai.ask) : une question, une réponse. L'agent tourne dans un dossier vide, sans
// outils (Claude), en lecture seule (Gemini) ou sans écriture ni commandes (Copilot) : il ne voit ni ne modifie le
// projet et ne lance rien. L'accord de l'utilisateur est demandé par la fenêtre avant l'appel.

const DEFAULT_SYSTEM = 'Tu es l’assistant d’une extension de Lumen TeX, un éditeur de documents scientifiques. Réponds directement, sans préambule.'

/** Requêtes en cours : identifiant → extension et arrêt */
const running = new Map<number, { extId: string; stop: () => void }>()

/** Dossier vide propre à la requête (effacé ensuite) */
function emptyDir(reqId: number): string {
  const dir = path.join(app.getPath('temp'), 'lumen-ext-ia', `${process.pid}-${reqId}`)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export async function extensionAsk(
  reqId: number,
  extId: string,
  engine: AiEngine,
  prompt: string,
  system: string,
  onText: (t: string) => void
): Promise<void> {
  const sys = system.trim() || DEFAULT_SYSTEM
  if (engine === 'ollama') {
    const lane = `ext:${reqId}`
    running.set(reqId, { extId, stop: () => stopOllama(lane) })
    try {
      return await chat([{ role: 'system', content: sys }, { role: 'user', content: prompt }], onText, lane)
    } finally {
      running.delete(reqId)
    }
  }
  const cwd = emptyDir(reqId)
  const run =
    engine === 'claude'
      ? runClaude(cwd, ['--tools', '', '--no-session-persistence', '--system-prompt', sys], prompt, { onText })
      : engine === 'gemini'
        ? runGemini(cwd, ['-p', `${sys}\n\n${prompt}`, '--approval-mode', 'plan'], { onText })
        : runCopilot(cwd, ['-p', `${sys}\n\n${prompt}`, '--deny-tool', 'shell', '--deny-tool', 'write'], onText)
  running.set(reqId, { extId, stop: () => run.child?.kill() })
  try {
    await run.done
  } finally {
    running.delete(reqId)
    fs.rm(cwd, { recursive: true, force: true }, () => undefined)
  }
}

/** Arrête les requêtes d'une extension */
export function extensionAiStop(extId: string): void {
  for (const r of running.values()) if (r.extId === extId) r.stop()
}
