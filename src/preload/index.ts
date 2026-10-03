import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AiEngine,
  AiStatus,
  CollabNetStatus,
  ConvertEvent,
  ConvertOptions,
  ConvertSource,
  CompileResult,
  ContextMenuItem,
  FileEntry,
  InstallProgress,
  SearchMatch,
  Settings,
  SyncForwardResult,
  SyncReverseResult,
  TectonicStatus,
  TemplateFile
} from '../shared/types'

const invoke = ipcRenderer.invoke.bind(ipcRenderer)

function on<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  platform: process.platform,
  getSettings: (): Promise<Settings> => invoke('settings:get'),
  setSettings: (patch: Partial<Settings>): Promise<Settings> => invoke('settings:set', patch),
  addRecent: (p: string): Promise<Settings> => invoke('recent:add', p),
  removeRecent: (p: string): Promise<Settings> => invoke('recent:remove', p),

  openFolderDialog: (): Promise<string | null> => invoke('dialog:openFolder'),
  openFileDialog: (opts?: { title?: string; extensions?: string[]; defaultPath?: string }): Promise<string | null> =>
    invoke('dialog:openFile', opts),
  chooseDir: (defaultPath?: string): Promise<string | null> => invoke('dialog:chooseDir', defaultPath),
  confirm: (message: string, detail?: string, okLabel?: string): Promise<boolean> =>
    invoke('dialog:confirm', message, detail, okLabel),

  paths: (): Promise<{ documents: string; home: string }> => invoke('app:paths'),
  setDirty: (dirty: boolean): void => ipcRenderer.send('app:dirty', dirty),
  closeNow: (): void => ipcRenderer.send('app:close-now'),
  onUpdateReady: (cb: (version: string) => void) => on<[string]>('app:update-ready', cb),
  installUpdate: (): Promise<void> => invoke('app:install-update'),
  focusWindow: (): void => ipcRenderer.send('app:focus'),
  pendingOpen: (): Promise<string | null> => invoke('app:pending-open'),

  stat: (p: string): Promise<{ exists: boolean; isDir: boolean }> => invoke('fs:stat', p),
  list: (root: string): Promise<FileEntry[]> => invoke('fs:list', root),
  watch: (root: string | null): Promise<void> => invoke('fs:watch', root),
  read: (root: string, rel: string): Promise<string> => invoke('fs:read', root, rel),
  readBinary: (root: string, rel: string): Promise<Uint8Array> => invoke('fs:readBinary', root, rel),
  readAllText: (root: string): Promise<Record<string, string>> => invoke('fs:readAllText', root),
  removeEmptyDir: (root: string, rel: string): Promise<boolean> => invoke('fs:remove-empty-dir', root, rel),
  writeBinary: (root: string, rel: string, data: Uint8Array): Promise<boolean> => invoke('fs:write-binary', root, rel, data),
  write: (root: string, rel: string, content: string): Promise<boolean> => invoke('fs:write', root, rel, content),
  create: (root: string, rel: string, isDir: boolean, content?: string): Promise<boolean> =>
    invoke('fs:create', root, rel, isDir, content),
  rename: (root: string, from: string, to: string): Promise<boolean> => invoke('fs:rename', root, from, to),
  trash: (root: string, rel: string): Promise<boolean> => invoke('fs:trash', root, rel),
  importFile: (root: string, src: string, destDir: string): Promise<string> => invoke('fs:import', root, src, destDir),
  reveal: (p: string): Promise<void> => invoke('fs:reveal', p),
  openExternal: (p: string): Promise<string> => invoke('fs:openExternal', p),
  search: (root: string, query: string, opts: { regex?: boolean; caseSensitive?: boolean }): Promise<SearchMatch[]> =>
    invoke('fs:search', root, query, opts),
  createProject: (dir: string, files: TemplateFile[]): Promise<string> => invoke('project:create', dir, files),

  popupMenu: (items: ContextMenuItem[]): Promise<string | null> => invoke('menu:popup', items),

  compile: (root: string, main: string): Promise<CompileResult> => invoke('compile:run', root, main),
  cancelCompile: (): Promise<void> => invoke('compile:cancel'),
  buildPaths: (root: string, main: string): Promise<{ outDir: string; pdf: string; synctex: string; log: string }> =>
    invoke('compile:paths', root, main),
  cleanBuild: (root: string): Promise<boolean> => invoke('compile:clean', root),
  aiClaude: (root: string, prompt: string): Promise<void> => invoke('ai:claude', root, prompt),
  aiClaudeReset: (root: string): Promise<void> => invoke('ai:claude-reset', root),
  onAiUsage: (cb: (u: { fiveHour?: number; fiveHourResetsAt?: number; sevenDay?: number }) => void) =>
    on<[{ fiveHour?: number; fiveHourResetsAt?: number; sevenDay?: number }]>('ai:usage', cb),
  aiStatus: (engine: AiEngine): Promise<AiStatus> => invoke('ai:status', engine),
  aiLogin: (engine: AiEngine): Promise<AiStatus> => invoke('ai:login', engine),
  aiLoginCode: (code: string): Promise<void> => invoke('ai:login-code', code),
  aiLoginCancel: (): Promise<void> => invoke('ai:login-cancel'),
  onAiLoginUrl: (cb: (url: string) => void) => on<[string]>('ai:login-url', cb),
  aiInstall: (engine: AiEngine): Promise<AiStatus> => invoke('ai:install', engine),
  onAiInstallProgress: (cb: (msg: string) => void) => on<[string]>('ai:install-progress', cb),
  aiOllamaPull: (model: string): Promise<AiStatus> => invoke('ai:ollama-pull', model),
  aiOllama: (messages: { role: string; content: string }[]): Promise<void> => invoke('ai:ollama', messages),
  docsStatus: (): Promise<{ chunks: number; dir: string }> => invoke('docs:status'),
  buildDocs: (): Promise<number> => invoke('docs:build'),
  openDocsDir: (): Promise<string> => invoke('docs:open-dir'),
  onDocsProgress: (cb: (msg: string) => void) => on<[string]>('docs:progress', cb),
  aiCopilot: (root: string, prompt: string): Promise<void> => invoke('ai:copilot', root, prompt),
  aiCopilotReset: (root: string): Promise<void> => invoke('ai:copilot-reset', root),
  aiCopilotModels: (): Promise<string[]> => invoke('ai:copilot-models'),
  aiGemini: (root: string, prompt: string): Promise<void> => invoke('ai:gemini', root, prompt),
  aiGeminiKey: (key: string): Promise<AiStatus> => invoke('ai:gemini-key', key),
  aiGeminiReset: (root: string): Promise<void> => invoke('ai:gemini-reset', root),
  convertPrepareFile: (src: string): Promise<ConvertSource> => invoke('convert:prepare-file', src),
  convertPrepareData: (name: string, data: Uint8Array): Promise<ConvertSource> => invoke('convert:prepare-data', name, data),
  convertRun: (id: string, engine: AiEngine, opts: ConvertOptions): Promise<void> => invoke('convert:run', id, engine, opts),
  convertStop: (): Promise<void> => invoke('convert:stop'),
  convertDiscard: (id: string): Promise<void> => invoke('convert:discard', id),
  onConvertEvent: (cb: (e: ConvertEvent) => void) => on<[ConvertEvent]>('convert:event', cb),
  readExternal: (p: string): Promise<string> => invoke('fs:read-external', p),
  collabNewCode: (): Promise<string> => invoke('collab:new-code'),
  collabNormalizeCode: (code: string): Promise<string | null> => invoke('collab:normalize-code', code),
  collabStart: (code: string): Promise<void> => invoke('collab:start', code),
  collabStop: (): Promise<void> => invoke('collab:stop'),
  collabStatus: (): Promise<CollabNetStatus> => invoke('collab:status'),
  collabSend: (data: Uint8Array, to?: string, except?: string): void => ipcRenderer.send('collab:send', data, to, except),
  collabLoadState: (root: string): Promise<Uint8Array | null> => invoke('collab:load-state', root),
  collabSaveState: (root: string, data: Uint8Array): Promise<void> => invoke('collab:save-state', root, data),
  collabClearState: (root: string): Promise<void> => invoke('collab:clear-state', root),
  onCollabStatus: (cb: (s: CollabNetStatus) => void) => on<[CollabNetStatus]>('collab:status', cb),
  onCollabPeer: (cb: (id: string, joined: boolean) => void) => on<[string, boolean]>('collab:peer', cb),
  onCollabData: (cb: (id: string, data: Uint8Array) => void) => on<[string, Uint8Array]>('collab:data', cb),
  userName: (): Promise<string> => invoke('app:user-name'),
  aiStop: (): Promise<void> => invoke('ai:stop'),
  onAiChunk: (cb: (text: string) => void) => on<[string]>('ai:chunk', cb),
  readPdf: (p: string): Promise<Uint8Array | null> => invoke('pdf:read', p),
  exportPdf: (src: string, name: string): Promise<string | null> => invoke('pdf:export', src, name),

  syncForward: (root: string, main: string, file: string, line: number): Promise<SyncForwardResult | null> =>
    invoke('synctex:forward', root, main, file, line),
  syncReverse: (root: string, main: string, page: number, x: number, y: number): Promise<SyncReverseResult | null> =>
    invoke('synctex:reverse', root, main, page, x, y),

  tectonicStatus: (force?: boolean): Promise<TectonicStatus> => invoke('tectonic:status', force),
  installTectonic: (): Promise<TectonicStatus> => invoke('tectonic:install'),

  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  onMenu: (cb: (id: string) => void) => on<[string]>('menu:command', cb),
  onOpenPath: (cb: (p: string) => void) => on<[string]>('open-path', cb),
  onFsChanged: (cb: (paths: string[]) => void) => on<[string[]]>('fs:changed', cb),
  onCompileProgress: (cb: (line: string) => void) => on<[string]>('compile:progress', cb),
  onTectonicProgress: (cb: (p: InstallProgress) => void) => on<[InstallProgress]>('tectonic:progress', cb),
  onSaveBeforeClose: (cb: () => void) => on<[]>('app:save-before-close', cb)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
