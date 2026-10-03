import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
  type MenuItemConstructorOptions
} from 'electron'
import { autoUpdater } from 'electron-updater'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { AiEngine, ContextMenuItem, ConvertOptions, FileEntry, SearchMatch, Settings, TemplateFile } from '../shared/types'
import { BUILD_DIR, buildPaths, cancelCompile, compile } from './compiler'
import { addRecent, flushSettings, getSettings, setSettings } from './store'
import { forwardSearch, reverseSearch } from './synctex'
import { findTectonic, installTectonic } from './tectonic'
import { askClaude, claudeStatus, installClaude, loginClaude, resetClaude, stopClaude } from './claude'
import { askCopilot, copilotModels, copilotStatus, installCopilot, loginCopilot, resetCopilot, stopCopilot } from './ghcopilot'
import { askGemini, geminiStatus, installGemini, resetGemini, setGeminiKey, stopGemini } from './gemini'
import { cancelLogin, sendLoginCode } from './login'
import { askOllama, ollamaStatus, pullOllamaModel, startOllama, stopOllama } from './ollama'
import { buildDocs, docsStatus, userDocsDir } from './docs'
import { collabStatus, newCode, normalizeCode, sendCollab, startCollab, stopCollab } from './collab'
import { discard, discardAll, prepareData, prepareFile, runConvert, stopConvert } from './convert'

app.setName('Lumen TeX')
if (process.env.LUMEN_USER_DATA) app.setPath('userData', process.env.LUMEN_USER_DATA)

let win: BrowserWindow | null = null
let rendererDirty = false
let allowClose = false
let pendingOpenPath: string | null = null
let watcher: fs.FSWatcher | null = null

const IGNORED = new Set(['.git', 'node_modules', BUILD_DIR, '.DS_Store', '__pycache__'])
const TEXT_EXT = /\.(tex|bib|sty|cls|bst|txt|md|ltx|dtx|ins|cfg|def|clo|bbx|cbx|lbx|tikz|pgf|csv|dat|json|yaml|yml|latexmkrc)$/i

function send(channel: string, ...args: unknown[]): void {
  win?.webContents.send(channel, ...args)
}

function inside(root: string, p: string): string {
  const abs = path.resolve(root, p)
  const rel = path.relative(root, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Chemin hors du projet : ' + p)
  return abs
}

function walk(root: string, limit = 8000): FileEntry[] {
  const out: FileEntry[] = []
  const visit = (dir: string, rel: string, depth = 0): void => {
    if (depth > 8) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (out.length >= limit) return
      if (IGNORED.has(e.name) || e.name.startsWith('.')) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        out.push({ path: r, isDir: true })
        visit(path.join(dir, e.name), r, depth + 1)
      } else if (e.isFile() || e.isSymbolicLink()) {
        out.push({ path: r, isDir: false })
      }
    }
  }
  visit(root, '')
  return out
}

function watchProject(root: string | null): void {
  watcher?.close()
  watcher = null
  if (!root) return
  const changed = new Set<string>()
  let timer: NodeJS.Timeout | null = null
  try {
    watcher = fs.watch(root, { recursive: true }, (_evt, filename) => {
      if (!filename) return
      const rel = filename.split(path.sep).join('/')
      const first = rel.split('/')[0]
      if (IGNORED.has(first) || rel.split('/').some((seg) => seg.startsWith('.'))) return
      changed.add(rel)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        send('fs:changed', [...changed])
        changed.clear()
      }, 200)
    })
  } catch {
    /* surveillance indisponible */
  }
}

// ---------------------------------------------------------------------------
// Fenêtre
// ---------------------------------------------------------------------------

function createWindow(): void {
  const bounds = getSettings().windowBounds
  win = new BrowserWindow({
    width: bounds?.width ?? 1480,
    height: bounds?.height ?? 920,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Lumen TeX',
    ...(process.platform === 'darwin' && { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 15 } }),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#15161b' : '#f6f6f8',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      spellcheck: true
    }
  })

  win.once('ready-to-show', () => win?.show())

  const saveBounds = (): void => {
    if (win && !win.isMinimized() && !win.isFullScreen()) setSettings({ windowBounds: win.getBounds() })
  }
  win.on('resized', saveBounds)
  win.on('moved', saveBounds)

  win.on('close', (e) => {
    if (rendererDirty && !allowClose) {
      e.preventDefault()
      send('app:save-before-close')
    }
  })
  win.on('closed', () => {
    win = null
    watchProject(null)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      e.preventDefault()
      void shell.openExternal(url)
    }
  })

  // Menu contextuel natif (orthographe, copier/coller)
  win.webContents.on('context-menu', (_e, params) => {
    const template: MenuItemConstructorOptions[] = []
    if (params.misspelledWord) {
      for (const s of params.dictionarySuggestions.slice(0, 6)) {
        template.push({ label: s, click: () => win?.webContents.replaceMisspelling(s) })
      }
      if (!params.dictionarySuggestions.length) template.push({ label: 'Aucune suggestion', enabled: false })
      template.push({
        label: `Ajouter « ${params.misspelledWord} » au dictionnaire`,
        click: () => win?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      })
      template.push({ type: 'separator' })
    }
    if (params.isEditable) {
      template.push(
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { type: 'separator' },
        { role: 'selectAll', label: 'Tout sélectionner' }
      )
    } else if (params.selectionText) {
      template.push({ role: 'copy', label: 'Copier' })
    }
    if (template.length) Menu.buildFromTemplate(template).popup({ window: win! })
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

// ---------------------------------------------------------------------------
// Menu de l'application
// ---------------------------------------------------------------------------

function cmd(id: string): () => void {
  return () => send('menu:command', id)
}

function buildMenu(): void {
  const recent = getSettings().recentProjects
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Lumen TeX',
      submenu: [
        { role: 'about', label: 'À propos de Lumen TeX' },
        { type: 'separator' },
        { label: 'Réglages…', accelerator: 'CmdOrCtrl+,', click: cmd('settings') },
        { type: 'separator' },
        { role: 'hide', label: 'Masquer Lumen TeX' },
        { role: 'hideOthers', label: 'Masquer les autres' },
        { role: 'unhide', label: 'Tout afficher' },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter Lumen TeX' }
      ]
    },
    {
      label: 'Fichier',
      submenu: [
        { label: 'Nouveau projet…', accelerator: 'CmdOrCtrl+Shift+N', click: cmd('new-project') },
        { label: 'Nouveau fichier', accelerator: 'CmdOrCtrl+N', click: cmd('new-file') },
        { type: 'separator' },
        { label: 'Ouvrir un dossier…', accelerator: 'CmdOrCtrl+O', click: cmd('open-folder') },
        { label: 'Ouvrir un fichier .tex…', accelerator: 'CmdOrCtrl+Shift+O', click: cmd('open-file') },
        {
          label: 'Projets récents',
          submenu: recent.length
            ? recent.map((r) => ({ label: r.name, sublabel: r.path, click: () => send('open-path', r.path) }))
            : [{ label: 'Aucun', enabled: false }]
        },
        { type: 'separator' },
        { label: 'Enregistrer', accelerator: 'CmdOrCtrl+S', click: cmd('save') },
        { label: 'Tout enregistrer', accelerator: 'CmdOrCtrl+Alt+S', click: cmd('save-all') },
        { type: 'separator' },
        { label: 'Exporter en PDF…', accelerator: 'CmdOrCtrl+E', click: cmd('export-pdf') },
        { label: process.platform === 'darwin' ? 'Ouvrir le PDF dans Aperçu' : 'Ouvrir le PDF dans le lecteur par défaut', click: cmd('open-pdf-external') },
        { type: 'separator' },
        { label: 'Fermer l’onglet', accelerator: 'CmdOrCtrl+W', click: cmd('close-tab') },
        { label: 'Fermer le projet', click: cmd('close-project') }
      ]
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'selectAll', label: 'Tout sélectionner' },
        { type: 'separator' },
        { label: 'Rechercher… (⌘F)', click: cmd('find') },
        { label: 'Rechercher dans le projet…', accelerator: 'CmdOrCtrl+Shift+F', click: cmd('search-project') },
        { type: 'separator' },
        { label: 'Gras (⌘B)', click: cmd('bold') },
        { label: 'Italique (⌘I)', click: cmd('italic') },
        { label: 'Commenter / décommenter (⌘/)', click: cmd('toggle-comment') }
      ]
    },
    {
      label: 'Insertion',
      submenu: [
        { label: 'Tableau…', accelerator: 'CmdOrCtrl+Alt+T', click: cmd('insert-table') },
        { label: 'Figure…', accelerator: 'CmdOrCtrl+Alt+F', click: cmd('insert-figure') },
        { label: 'Matrice…', accelerator: 'CmdOrCtrl+Alt+M', click: cmd('insert-matrix') },
        { label: 'Équation', accelerator: 'CmdOrCtrl+Alt+E', click: cmd('insert-equation') },
        { label: 'Liste à puces', click: cmd('insert-itemize') },
        { label: 'Liste numérotée', click: cmd('insert-enumerate') },
        { type: 'separator' },
        { label: 'Palette de symboles', accelerator: 'CmdOrCtrl+Alt+Y', click: cmd('show-symbols') },
        { type: 'separator' },
        { label: 'Image ou PDF → LaTeX…', accelerator: 'CmdOrCtrl+Alt+L', click: cmd('convert-to-latex') }
      ]
    },
    {
      label: 'Compilation',
      submenu: [
        { label: 'Compiler', accelerator: 'CmdOrCtrl+Enter', click: cmd('compile') },
        { label: 'Arrêter la compilation', accelerator: 'CmdOrCtrl+.', click: cmd('cancel-compile') },
        { label: 'Compilation automatique', type: 'checkbox', checked: getSettings().autoCompile, click: cmd('toggle-autocompile') },
        { type: 'separator' },
        { label: 'Afficher la position dans le PDF', accelerator: 'CmdOrCtrl+Alt+J', click: cmd('sync-forward') },
        { label: 'Journal et erreurs', accelerator: 'CmdOrCtrl+J', click: cmd('toggle-log') },
        { label: 'Erreur suivante', accelerator: 'F8', click: cmd('next-error') },
        { type: 'separator' },
        { label: 'Nettoyer les fichiers de compilation', click: cmd('clean-build') }
      ]
    },
    {
      label: 'Affichage',
      submenu: [
        { label: 'Palette de commandes…', accelerator: 'CmdOrCtrl+Shift+P', click: cmd('command-palette') },
        { label: 'Ouverture rapide…', accelerator: 'CmdOrCtrl+P', click: cmd('quick-open') },
        { type: 'separator' },
        { label: 'Barre latérale', accelerator: 'CmdOrCtrl+Alt+B', click: cmd('toggle-sidebar') },
        { label: 'Aperçu PDF', accelerator: 'CmdOrCtrl+Shift+V', click: cmd('toggle-pdf') },
        { label: 'Fichiers', accelerator: 'CmdOrCtrl+1', click: cmd('panel-files') },
        { label: 'Plan du document', accelerator: 'CmdOrCtrl+2', click: cmd('panel-outline') },
        { label: 'Symboles', accelerator: 'CmdOrCtrl+3', click: cmd('panel-symbols') },
        { label: 'Recherche', accelerator: 'CmdOrCtrl+4', click: cmd('panel-search') },
        { type: 'separator' },
        { label: 'Agrandir le texte', accelerator: 'CmdOrCtrl+=', click: cmd('font-bigger') },
        { label: 'Réduire le texte', accelerator: 'CmdOrCtrl+-', click: cmd('font-smaller') },
        { label: 'Zoom PDF +', accelerator: 'CmdOrCtrl+Shift+=', click: cmd('pdf-zoom-in') },
        { label: 'Zoom PDF −', accelerator: 'CmdOrCtrl+Shift+-', click: cmd('pdf-zoom-out') },
        { label: 'PDF : pleine largeur', accelerator: 'CmdOrCtrl+0', click: cmd('pdf-fit') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' },
        { role: 'toggleDevTools', label: 'Outils de développement' }
      ]
    },
    {
      label: 'Fenêtre',
      submenu: [
        { role: 'minimize', label: 'Réduire' },
        { role: 'zoom', label: 'Zoom' },
        { type: 'separator' },
        { role: 'front', label: 'Tout ramener au premier plan' }
      ]
    },
    {
      role: 'help',
      label: 'Aide',
      submenu: [
        { label: 'Raccourcis clavier', click: cmd('shortcuts') },
        { label: 'Documentation LaTeX (Wikibooks)', click: () => void shell.openExternal('https://en.wikibooks.org/wiki/LaTeX') },
        { label: 'Documentation Tectonic', click: () => void shell.openExternal('https://tectonic-typesetting.github.io/book/latest/') },
        { label: 'Référence des symboles (CTAN)', click: () => void shell.openExternal('https://ctan.org/pkg/comprehensive') }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const s = setSettings(patch)
    if ('autoCompile' in patch || 'recentProjects' in patch) buildMenu()
    if (patch.theme) nativeTheme.themeSource = patch.theme
    return s
  })
  ipcMain.handle('recent:add', (_e, p: string) => {
    const s = addRecent(p)
    buildMenu()
    return s
  })
  ipcMain.handle('recent:remove', (_e, p: string) => {
    const s = setSettings({ recentProjects: getSettings().recentProjects.filter((r) => r.path !== p) })
    buildMenu()
    return s
  })

  ipcMain.handle('dialog:openFolder', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Ouvrir un projet LaTeX',
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('dialog:openFile', async (_e, opts?: { title?: string; extensions?: string[]; defaultPath?: string }) => {
    const r = await dialog.showOpenDialog(win!, {
      title: opts?.title ?? 'Ouvrir un fichier',
      defaultPath: opts?.defaultPath,
      properties: ['openFile'],
      filters: opts?.extensions ? [{ name: 'Fichiers', extensions: opts.extensions }] : undefined
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('dialog:chooseDir', async (_e, defaultPath?: string) => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Choisir un emplacement',
      defaultPath,
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('dialog:confirm', async (_e, message: string, detail?: string, okLabel = 'Confirmer') => {
    const r = await dialog.showMessageBox(win!, {
      type: 'question',
      message,
      detail,
      buttons: [okLabel, 'Annuler'],
      defaultId: 0,
      cancelId: 1
    })
    return r.response === 0
  })

  ipcMain.handle('app:paths', () => ({ documents: app.getPath('documents'), home: app.getPath('home') }))
  ipcMain.on('app:dirty', (_e, dirty: boolean) => {
    rendererDirty = dirty
    win?.setDocumentEdited(dirty)
  })
  ipcMain.on('app:close-now', () => {
    allowClose = true
    win?.close()
  })
  // Installation silencieuse (sans l'assistant) puis relance de l'app
  ipcMain.handle('app:install-update', () => autoUpdater.quitAndInstall(true, true))
  ipcMain.handle('app:pending-open', () => {
    const p = pendingOpenPath
    pendingOpenPath = null
    return p
  })

  // --- Système de fichiers ---
  ipcMain.handle('fs:stat', (_e, p: string) => {
    try {
      const s = fs.statSync(p)
      return { exists: true, isDir: s.isDirectory() }
    } catch {
      return { exists: false, isDir: false }
    }
  })
  ipcMain.handle('fs:list', (_e, root: string) => walk(root))
  ipcMain.handle('fs:watch', (_e, root: string | null) => watchProject(root))
  ipcMain.handle('fs:read', (_e, root: string, rel: string) => fs.readFileSync(inside(root, rel), 'utf8'))
  // Fichier joint au contexte de l'IA, choisi par l'utilisateur hors du projet
  ipcMain.handle('fs:read-external', (_e, p: string) => {
    if (fs.statSync(p).size > 2_000_000) throw new Error('Fichier trop volumineux (> 2 Mo)')
    return fs.readFileSync(p, 'utf8')
  })
  ipcMain.handle('fs:readBinary', (_e, root: string, rel: string) => new Uint8Array(fs.readFileSync(inside(root, rel))))
  ipcMain.handle('fs:readAllText', (_e, root: string) => {
    const out: Record<string, string> = {}
    let total = 0
    for (const f of walk(root)) {
      if (f.isDir || !/\.(tex|bib|sty|cls|ltx)$/i.test(f.path)) continue
      try {
        const abs = path.join(root, f.path)
        if (fs.statSync(abs).size > 2_000_000) continue
        const text = fs.readFileSync(abs, 'utf8')
        total += text.length
        if (total > 40_000_000) break
        out[f.path] = text
      } catch {
        /* ignoré */
      }
    }
    return out
  })
  ipcMain.handle('fs:write-binary', (_e, root: string, rel: string, data: Uint8Array) => {
    const abs = inside(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, data)
    return true
  })
  ipcMain.handle('fs:write', (_e, root: string, rel: string, content: string) => {
    const abs = inside(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content, 'utf8')
    return true
  })
  ipcMain.handle('fs:create', (_e, root: string, rel: string, isDir: boolean, content = '') => {
    const abs = inside(root, rel)
    if (fs.existsSync(abs)) throw new Error('Un élément portant ce nom existe déjà')
    if (isDir) fs.mkdirSync(abs, { recursive: true })
    else {
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, content, 'utf8')
    }
    return true
  })
  ipcMain.handle('fs:rename', (_e, root: string, from: string, to: string) => {
    const a = inside(root, from)
    const b = inside(root, to)
    if (fs.existsSync(b)) throw new Error('Un élément portant ce nom existe déjà')
    fs.mkdirSync(path.dirname(b), { recursive: true })
    fs.renameSync(a, b)
    return true
  })
  ipcMain.handle('fs:trash', async (_e, root: string, rel: string) => {
    await shell.trashItem(inside(root, rel))
    return true
  })
  ipcMain.handle('fs:import', (_e, root: string, src: string, destDirRel: string) => {
    const destDir = inside(root, destDirRel || '.')
    fs.mkdirSync(destDir, { recursive: true })
    const srcAbs = path.resolve(src)
    const relToRoot = path.relative(root, srcAbs)
    if (!relToRoot.startsWith('..') && !path.isAbsolute(relToRoot)) return relToRoot.split(path.sep).join('/')
    const ext = path.extname(src)
    const base = path.basename(src, ext).replace(/[^\w.-]+/g, '-')
    let name = base + ext
    let i = 1
    while (fs.existsSync(path.join(destDir, name))) name = `${base}-${i++}${ext}`
    fs.cpSync(srcAbs, path.join(destDir, name), { recursive: true })
    return path.relative(root, path.join(destDir, name)).split(path.sep).join('/')
  })
  ipcMain.handle('fs:reveal', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('fs:openExternal', (_e, p: string) => shell.openPath(p))

  ipcMain.handle('fs:search', (_e, root: string, query: string, opts: { regex?: boolean; caseSensitive?: boolean }) => {
    const matches: SearchMatch[] = []
    if (!query) return matches
    let re: RegExp
    try {
      const src = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      re = new RegExp(src, opts.caseSensitive ? 'g' : 'gi')
    } catch {
      return matches
    }
    for (const f of walk(root)) {
      if (f.isDir || !TEXT_EXT.test(f.path)) continue
      let text: string
      try {
        text = fs.readFileSync(path.join(root, f.path), 'utf8')
      } catch {
        continue
      }
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0
        const m = re.exec(lines[i])
        if (m) {
          matches.push({ file: f.path, line: i + 1, col: m.index, text: lines[i].slice(0, 300) })
          if (matches.length >= 1000) return matches
        }
      }
    }
    return matches
  })

  ipcMain.handle('project:create', (_e, dir: string, files: TemplateFile[]) => {
    if (fs.existsSync(dir) && fs.readdirSync(dir).filter((n) => !n.startsWith('.')).length) {
      throw new Error('Le dossier existe déjà et n’est pas vide')
    }
    fs.mkdirSync(dir, { recursive: true })
    for (const f of files) {
      const abs = inside(dir, f.path)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, f.content, 'utf8')
    }
    return dir
  })

  // --- Menus contextuels natifs demandés par l'interface ---
  ipcMain.handle('menu:popup', (_e, items: ContextMenuItem[]) => {
    return new Promise<string | null>((resolve) => {
      let chosen: string | null = null
      const menu = Menu.buildFromTemplate(
        items.map((it) =>
          it.type === 'separator'
            ? { type: 'separator' as const }
            : {
                label: it.label,
                enabled: it.enabled !== false,
                // Raccourci affiché seulement (géré par l'interface)
                accelerator: it.accelerator,
                registerAccelerator: false,
                click: () => (chosen = it.id ?? null)
              }
        )
      )
      menu.popup({ window: win!, callback: () => setTimeout(() => resolve(chosen), 0) })
    })
  })

  // --- Compilation ---
  ipcMain.handle('compile:run', (_e, root: string, mainRel: string) =>
    compile(root, mainRel, (line) => send('compile:progress', line))
  )
  ipcMain.handle('compile:cancel', () => cancelCompile())
  ipcMain.handle('compile:paths', (_e, root: string, mainRel: string) => buildPaths(root, mainRel))
  ipcMain.handle('compile:clean', (_e, root: string) => {
    fs.rmSync(path.join(root, BUILD_DIR), { recursive: true, force: true })
    return true
  })
  ipcMain.handle('ai:stop', () => {
    stopOllama()
    stopClaude()
    stopCopilot()
    stopGemini()
  })
  const engines = {
    // Ollama : « connexion » = lancer le serveur, « installation » = télécharger le modèle par défaut
    // (Ollama lui-même s'installe depuis ollama.com, lien affiché par l'interface)
    ollama: { status: ollamaStatus, login: () => startOllama(), install: pullOllamaModel },
    claude: { status: claudeStatus, login: loginClaude, install: installClaude },
    copilot: { status: copilotStatus, login: loginCopilot, install: installCopilot },
    // Gemini : pas de connexion par navigateur, la clé d'API est saisie dans l'interface (ai:gemini-key)
    gemini: { status: geminiStatus, login: () => Promise.reject(new Error('Saisissez une clé d’API Gemini')), install: installGemini }
  }
  ipcMain.handle('ai:status', (_e, engine: AiEngine) => engines[engine].status())
  ipcMain.handle('ai:login', (_e, engine: AiEngine) => engines[engine].login((url) => send('ai:login-url', url)))
  ipcMain.handle('ai:login-code', (_e, code: string) => sendLoginCode(code))
  ipcMain.handle('ai:login-cancel', () => cancelLogin())
  ipcMain.handle('ai:install', (_e, engine: AiEngine) => engines[engine].install((msg) => send('ai:install-progress', msg)))
  ipcMain.handle('ai:ollama-pull', (_e, model: string) => pullOllamaModel((msg) => send('ai:install-progress', msg), model))
  ipcMain.handle('ai:ollama', (_e, messages: { role: string; content: string }[]) => askOllama(messages, (t) => send('ai:chunk', t)))
  ipcMain.handle('docs:status', () => docsStatus())
  ipcMain.handle('docs:build', () => buildDocs((msg) => send('docs:progress', msg)))
  ipcMain.handle('docs:open-dir', () => {
    fs.mkdirSync(userDocsDir(), { recursive: true })
    return shell.openPath(userDocsDir())
  })
  ipcMain.handle('ai:copilot', (_e, root: string, prompt: string) => askCopilot(root, prompt, (t) => send('ai:chunk', t)))
  ipcMain.handle('ai:copilot-reset', (_e, root: string) => resetCopilot(root))
  ipcMain.handle('ai:copilot-models', () => copilotModels())
  ipcMain.handle('ai:gemini', (_e, root: string, prompt: string) => askGemini(root, prompt, (t) => send('ai:chunk', t)))
  ipcMain.handle('ai:gemini-key', (_e, key: string) => setGeminiKey(key))
  ipcMain.handle('ai:gemini-reset', (_e, root: string) => resetGemini(root))

  // --- Image / PDF → LaTeX ---
  ipcMain.handle('convert:prepare-file', (_e, src: string) => prepareFile(src))
  ipcMain.handle('convert:prepare-data', (_e, name: string, data: Uint8Array) => prepareData(name, data))
  ipcMain.handle('convert:run', (_e, id: string, engine: AiEngine, opts: ConvertOptions) =>
    runConvert(id, engine, opts, (ev) => send('convert:event', ev))
  )
  ipcMain.handle('convert:stop', () => stopConvert())
  ipcMain.handle('convert:discard', (_e, id: string) => discard(id))
  ipcMain.handle('ai:claude', (_e, root: string, prompt: string) =>
    askClaude(root, prompt, (t) => send('ai:chunk', t), (u) => send('ai:usage', u))
  )
  ipcMain.handle('ai:claude-reset', (_e, root: string) => resetClaude(root))
  ipcMain.handle('pdf:read', (_e, p: string) => {
    try {
      return new Uint8Array(fs.readFileSync(p))
    } catch {
      return null
    }
  })
  ipcMain.handle('pdf:export', async (_e, src: string, suggestedName: string) => {
    const r = await dialog.showSaveDialog(win!, {
      title: 'Exporter en PDF',
      defaultPath: path.join(app.getPath('documents'), suggestedName),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (r.canceled || !r.filePath) return null
    fs.copyFileSync(src, r.filePath)
    return r.filePath
  })

  // --- SyncTeX ---
  ipcMain.handle('synctex:forward', (_e, root: string, mainRel: string, fileRel: string, line: number) => {
    const { synctex } = buildPaths(root, mainRel)
    return forwardSearch(synctex, path.join(root, fileRel), line)
  })
  ipcMain.handle('synctex:reverse', (_e, root: string, mainRel: string, page: number, x: number, y: number) => {
    const { synctex } = buildPaths(root, mainRel)
    const r = reverseSearch(synctex, page, x, y)
    if (!r) return null
    let realRoot = root
    try {
      realRoot = fs.realpathSync(root)
    } catch {
      /* ignoré */
    }
    let abs = r.file
    try {
      abs = fs.realpathSync(r.file)
    } catch {
      /* ignoré */
    }
    const rel = path.relative(realRoot, abs)
    if (rel.startsWith('..')) return null
    return { file: rel.split(path.sep).join('/'), line: r.line }
  })

  // --- Édition à plusieurs (pair-à-pair) ---
  const collabState = (root: string): string => path.join(root, BUILD_DIR, 'collab', 'state.bin')
  ipcMain.handle('collab:new-code', () => newCode())
  ipcMain.handle('collab:normalize-code', (_e, code: string) => normalizeCode(code))
  ipcMain.handle('collab:start', (_e, code: string) => startCollab(code, send))
  ipcMain.handle('collab:stop', () => stopCollab())
  ipcMain.handle('collab:status', () => collabStatus())
  ipcMain.on('collab:send', (_e, data: Uint8Array, to?: string) => sendCollab(data, to))
  ipcMain.handle('collab:load-state', (_e, root: string) => {
    try {
      return new Uint8Array(fs.readFileSync(collabState(root)))
    } catch {
      return null
    }
  })
  ipcMain.handle('collab:save-state', (_e, root: string, data: Uint8Array) => {
    fs.mkdirSync(path.dirname(collabState(root)), { recursive: true })
    // Écriture atomique : un état tronqué ferait perdre la fusion hors ligne
    fs.writeFileSync(collabState(root) + '.tmp', data)
    fs.renameSync(collabState(root) + '.tmp', collabState(root))
  })
  ipcMain.handle('collab:clear-state', (_e, root: string) => fs.rmSync(path.dirname(collabState(root)), { recursive: true, force: true }))
  ipcMain.handle('app:user-name', () => {
    try {
      return os.userInfo().username
    } catch {
      return ''
    }
  })

  // --- Tectonic ---
  ipcMain.handle('tectonic:status', (_e, force?: boolean) => findTectonic(!!force))
  ipcMain.handle('tectonic:install', () => installTectonic((p) => send('tectonic:progress', p)))
}

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

app.on('open-file', (e, p) => {
  e.preventDefault()
  if (win) send('open-path', p)
  else pendingOpenPath = p
})

// Windows : un fichier double-cliqué arrive en argument de la ligne de commande (pas d'événement « open-file »)
const fileArg = (argv: string[]): string | null => argv.find((a) => /\.(tex|bib)$/i.test(a) && fs.existsSync(a)) ?? null
pendingOpenPath ??= fileArg(process.argv)

// Une seule fenêtre : un deuxième lancement (double-clic sur un autre .tex) est transmis à l'instance ouverte
if (!app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', (_e, argv) => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
  const p = fileArg(argv)
  if (p) send('open-path', p)
})

void app.whenReady().then(() => {
  nativeTheme.themeSource = getSettings().theme
  registerIpc()
  buildMenu()
  createWindow()
  // Mises à jour depuis les releases GitHub (app installée seulement) : téléchargée en arrière-plan,
  // installée au prochain « Redémarrer » ou à la fermeture
  if (app.isPackaged) {
    autoUpdater.on('update-downloaded', (info) => send('app:update-ready', info.version))
    // Copie non installée (dossier win-unpacked), hors ligne, GitHub injoignable : pas de mise à jour, sans planter
    autoUpdater.on('error', () => {})
    autoUpdater.checkForUpdates().catch(() => {})
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      allowClose = false
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  flushSettings()
  app.quit()
})

app.on('before-quit', () => {
  void stopCollab()
  cancelCompile() // sinon Tectonic orphelin garde le cache verrouillé
  stopConvert()
  discardAll()
  flushSettings()
})
