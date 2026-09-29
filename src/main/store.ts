import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { Settings } from '../shared/types'

export const defaultSettings: Settings = {
  theme: 'system',
  editorFontSize: 14,
  editorFontFamily: '"SF Mono", "JetBrains Mono", Menlo, Monaco, monospace',
  lineWrapping: true,
  vimMode: false,
  spellcheck: true,
  mathPreview: true,
  autoCompile: true,
  compileDelay: 1200,
  compileOnSave: true,
  shellEscape: false,
  tectonicPath: '',
  tectonicCacheDir: '',
  ollamaModel: 'gemma3:4b',
  claudeModel: '',
  aiEngine: 'claude',
  copilotModel: '',
  geminiModel: '',
  copilotLoggedIn: null,
  copilotHeight: 280,
  pdfDarkMode: false,
  sidebarWidth: 260,
  pdfRatio: 0.5,
  sidebarVisible: true,
  pdfVisible: true,
  recentProjects: [],
  projects: {},
  lastProject: null
}

let cache: Settings | null = null
let writeTimer: NodeJS.Timeout | null = null

const settingsFile = (): string => path.join(app.getPath('userData'), 'settings.json')

export function getSettings(): Settings {
  if (!cache) {
    try {
      cache = { ...defaultSettings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }
    } catch {
      cache = { ...defaultSettings }
    }
    const old = cache as Settings & { aiModel?: string }
    // Ancien réglage « aiModel » (modèle Ollama)
    if (old.aiModel) {
      cache!.ollamaModel = old.aiModel
      delete old.aiModel
    }
    if (!['ollama', 'claude', 'copilot', 'gemini'].includes(cache!.aiEngine)) cache!.aiEngine = 'claude'
  }
  return cache!
}

export function setSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch }
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(flushSettings, 300)
  return cache
}

export function flushSettings(): void {
  if (!cache) return
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = null
  const file = settingsFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2))
  fs.renameSync(tmp, file)
}

export function addRecent(projectPath: string): Settings {
  const s = getSettings()
  const recent = s.recentProjects.filter((r) => r.path !== projectPath)
  recent.unshift({ path: projectPath, name: path.basename(projectPath), openedAt: Date.now() })
  return setSettings({ recentProjects: recent.slice(0, 12), lastProject: projectPath })
}
