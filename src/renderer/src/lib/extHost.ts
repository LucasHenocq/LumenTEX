import * as cmAutocomplete from '@codemirror/autocomplete'
import * as cmCommands from '@codemirror/commands'
import * as cmLanguage from '@codemirror/language'
import * as cmLint from '@codemirror/lint'
import * as cmSearch from '@codemirror/search'
import * as cmState from '@codemirror/state'
import * as cmView from '@codemirror/view'
import * as lezerHighlight from '@lezer/highlight'
import type { CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import type { Diagnostic, ExtensionInfo } from '../../../shared/types'
import { editorContributions, getActivePath, getView, reconfigureAll, textOf } from '../editor/setup'
import { ENGINES } from '../components/Copilot'
import { store, toast, updateSettings, type ExtCommand, type ExtLog, type ExtPanel, type ExtStatusItem, type ExtWindow } from '../store'
import { compile, ensureMainFile, IMAGE_FILE, insertText, isTextFile, openFile, saveAll, setExtensionDiagnostics } from './actions'
import { on } from './bus'
import { runCommand } from './commands'
import { collabMe, collabPeople, joinSession, onExtensionMessage, sendExtensionMessage, setDevExtensions } from './collab'
import { ask } from './dialog'
import { languageOf, registerCompiler, registerLanguage, type CompileContext } from './languages'

// Hôte des extensions avec code. Toutes reçoivent le même objet lumen, aux fonctions asynchrones :
//  - de confiance (vérifiées, ou toutes en mode développeur) : module chargé dans la fenêtre (lumen-ext://app/…),
//    avec en plus CodeMirror (lumen.codemirror, lumen.editor.addExtension) et la partie Node.js (lumen.node) ;
//  - isolées : cadre à origine opaque (lumen-ext://sb-<id>/…). Leurs appels arrivent par messages et passent par le
//    même objet lumen, construit ici : projet ouvert seulement (le processus principal refuse tout chemin qui en sort),
//    Internet limité aux sites déclarés (vérifié par le processus principal). Coupées pendant une session partagée.
// Tout ce qu'une extension ajoute (commandes, panneaux, compilateurs…) est retiré quand elle s'arrête.

type Fn = (...args: unknown[]) => unknown

interface Running {
  ext: ExtensionInfo
  trusted: boolean
  frame: HTMLIFrameElement | null
  /** Retraits de ses apports (commandes, panneaux…) */
  disposers: (() => void)[]
  /** Événements écoutés : nom → fonctions */
  listeners: Map<string, Set<Fn>>
  storage: Record<string, unknown>
  node: { port: MessagePort | null; seq: number; pending: Map<number, { resolve: Fn; reject: Fn }>; ready: Promise<void>; setReady: () => void } | null
  /** Cadre isolé : appels de ses fonctions en attente de réponse */
  cbPending: Map<number, { resolve: Fn; reject: Fn }>
  cbSeq: number
  diagnostics: Diagnostic[]
  completions: { languages: string[]; source: CompletionSource }[]
  editorExts: { languages: string[]; ext: Extension }[]
  /** Son objet lumen (les appels d'un cadre isolé y sont cherchés) */
  api: Record<string, unknown>
}

const running = new Map<string, Running>()
let started = false

const isTrusted = (e: ExtensionInfo): boolean => e.trust === 'verified' || store.get().settings.extDevMode
const enabled = (e: ExtensionInfo): boolean => e.compatible && !store.get().settings.extDisabled.includes(e.id)
const hasCode = (e: ExtensionInfo): boolean => !!(e.main || e.node)

// ---------------------------------------------------------------------------
// Journal et erreurs
// ---------------------------------------------------------------------------

const lastErrorToast = new Map<string, number>()

export function extLog(extId: string, level: ExtLog['level'], text: string): void {
  store.set((s) => ({ extLogs: [...s.extLogs.slice(-499), { ts: Date.now(), extId, level, text }] }))
  if (level !== 'error') return
  // Une notification par extension toutes les 30 s au plus
  if (Date.now() - (lastErrorToast.get(extId) ?? 0) < 30000) return
  lastErrorToast.set(extId, Date.now())
  const name = store.get().extensions.find((e) => e.id === extId)?.name ?? extId
  toast(`L’extension « ${name} » a rencontré une erreur`, 'error', { label: 'Voir', run: () => store.set({ logOpen: true }) }, 8000)
}

const errText = (e: unknown): string => (e instanceof Error ? (e.stack ?? e.message) : String(e))
/** Message d'erreur sans le préfixe technique d'Electron (« Error invoking remote method … ») */
const cleanMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Appel d'une fonction de l'extension : une erreur va au journal, jamais plus loin */
async function guard<T>(r: Running, fn: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (e) {
    extLog(r.ext.id, 'error', errText(e))
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Événements de l'app transmis aux extensions
// ---------------------------------------------------------------------------

function fire(name: string, ...args: unknown[]): void {
  for (const r of running.values()) for (const fn of r.listeners.get(name) ?? []) void guard(r, () => fn(...args))
}

function listen(r: Running, name: string, fn: Fn): void {
  if (!r.listeners.has(name)) r.listeners.set(name, new Set())
  r.listeners.get(name)!.add(fn)
}

let changeTimer: number | undefined
const changedPaths = new Set<string>()
on('doc:changed', (path) => {
  changedPaths.add(path)
  clearTimeout(changeTimer)
  changeTimer = window.setTimeout(() => {
    for (const p of changedPaths) fire('editor.change', p)
    changedPaths.clear()
  }, 300)
})
on('fs:changed', (paths) => fire('project.files', paths))
on('compile:start', (e) => fire('compile.start', e))
on('compile:done', (r) => fire('compile.done', r))

let lastActive: string | null = null
let lastRoot: string | null = null
let lastSession = false
let lastSettings: Record<string, Record<string, unknown>> = {}
let lastPeople = ""
store.subscribe(() => {
  const s = store.get()
  if (s.active !== lastActive) fire('editor.active', (lastActive = s.active))
  if (s.root !== lastRoot) fire('project.open', (lastRoot = s.root))
  if (s.collab.active !== lastSession) {
    lastSession = s.collab.active
    fire('session.active', lastSession)
    if (started) void onSessionChange()
  }
  // Seulement quand la liste change (une extension qui écrit au journal à chaque fois ferait sinon boucler)
  const people = s.collab.people.map((p) => `${p.uid}:${p.name}`).join(',')
  if (people !== lastPeople) {
    lastPeople = people
    if (s.collab.active) fire('session.people', collabPeople())
  }
  if (s.settings.extSettings !== lastSettings) {
    const before = lastSettings
    lastSettings = s.settings.extSettings
    for (const r of running.values()) {
      const now = lastSettings?.[r.ext.id] ?? {}
      const old = before?.[r.ext.id] ?? {}
      for (const k of new Set([...Object.keys(now), ...Object.keys(old)]))
        if (now[k] !== old[k]) for (const fn of r.listeners.get('settings.change') ?? []) void guard(r, () => fn(k, now[k]))
    }
  }
})

onExtensionMessage((extId, from, data) => {
  const r = running.get(extId)
  if (r) for (const fn of r.listeners.get('session.message') ?? []) void guard(r, () => fn(from, data))
})

// ---------------------------------------------------------------------------
// Apports à l'éditeur (autocomplétion, extensions CodeMirror), selon le langage du fichier
// ---------------------------------------------------------------------------

const languageMatch = (languages: string[], path: string): boolean => {
  if (!languages.length) return true
  const p = path.toLowerCase()
  return languages.some((l) => (l.startsWith('.') ? p.endsWith(l) : languageIdOf(p) === l))
}
const languageIdOf = (path: string): string | undefined => languageOf(path)?.id

editorContributions.completion = (path) =>
  [...running.values()].flatMap((r) => r.completions.filter((c) => languageMatch(c.languages, path)).map((c) => c.source))
editorContributions.extensions = (path) =>
  [...running.values()].flatMap((r) => r.editorExts.filter((c) => languageMatch(c.languages, path)).map((c) => c.ext))

// ---------------------------------------------------------------------------
// L'objet lumen
// ---------------------------------------------------------------------------

type ExtUi = { panels: ExtPanel[]; status: ExtStatusItem[]; commands: ExtCommand[]; windows: ExtWindow[] }
const setUi = (fn: (ui: ExtUi) => Partial<ExtUi>): void => store.set((s) => ({ extUi: { ...s.extUi, ...fn(s.extUi) } }))

function publishDiagnostics(): void {
  setExtensionDiagnostics([...running.values()].flatMap((r) => r.diagnostics))
}

/** Fichier du projet : chemin relatif, sans remontée (le processus principal le vérifie aussi) */
const rel = (p: unknown): string => {
  const s = String(p ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!s || s.split('/').includes('..')) throw new Error(`Chemin invalide : ${String(p)}`)
  return s
}
const needRoot = (): string => {
  const root = store.get().root
  if (!root) throw new Error('Aucun projet ouvert')
  return root
}

function makeApi(r: Running): Record<string, unknown> {
  const ext = r.ext
  const add = (dispose: () => void): void => void r.disposers.push(dispose)
  const needSession = (): void => {
    if (!ext.permissions.session) throw new Error('Cette extension n’a pas déclaré la permission « session » dans son manifeste.')
  }

  const commands = {
    register: (c: { id: string; label: string; shortcut?: string; run: Fn }) => {
      const id = `${ext.id}:${c.id}`
      const cmd: ExtCommand = { id, extId: ext.id, label: `${ext.name} : ${c.label}`, shortcut: String(c.shortcut ?? ''), run: () => guard(r, c.run) }
      setUi((ui) => ({ commands: [...ui.commands.filter((x) => x.id !== id), cmd] }))
      add(() => setUi((ui) => ({ commands: ui.commands.filter((x) => x !== cmd) })))
    },
    /** Commande de Lumen TeX (« compile »…) ou d'une extension (« id-extension:commande ») */
    execute: (id: string) => {
      const c = store.get().extUi.commands.find((x) => x.id === id)
      if (c) return c.run()
      runCommand(String(id))
    }
  }

  const ui = {
    addPanel: (def: { id: string; title: string; icon?: string }, render?: (el: HTMLElement) => void) => {
      const key = `ext:${ext.id}:${def.id}` as const
      let el: HTMLElement | null = null
      if (r.trusted) {
        el = document.createElement('div')
        el.className = 'ext-panel-root'
        if (render) void guard(r, () => render(el!))
      }
      const icon = typeof def.icon === 'string' && def.icon.startsWith('data:image/svg+xml') ? def.icon : ext.icon
      const panel: ExtPanel = { key, extId: ext.id, title: String(def.title ?? ext.name), icon, el }
      setUi((u) => ({ panels: [...u.panels.filter((p) => p.key !== key), panel] }))
      add(() => {
        setUi((u) => ({ panels: u.panels.filter((p) => p !== panel) }))
        if (store.get().panel === key) store.set({ panel: 'files' })
      })
    },
    openPanel: (id: string) => store.set({ panel: `ext:${ext.id}:${id}` }),
    /** Fenêtre flottante ; déjà ouverte : ramenée devant. Isolée : une seule, sa page y est posée */
    openWindow: (def: { id: string; title: string; width?: number; height?: number; onClose?: Fn }, render?: (el: HTMLElement) => void) => {
      const key = `${ext.id}:${def.id}`
      const open = store.get().extUi.windows
      if (open.some((w) => w.key === key)) return void setUi((u) => ({ windows: u.windows.map((w) => (w.key === key ? { ...w, raised: Date.now() } : w)) }))
      if (!r.trusted) for (const w of open.filter((x) => x.extId === ext.id)) w.close()
      let el: HTMLElement | null = null
      if (r.trusted) {
        el = document.createElement('div')
        el.className = 'ext-window-root'
        if (render) void guard(r, () => render(el!))
      }
      const size = (v: unknown, d: number): number => (typeof v === 'number' && v > 0 ? Math.min(v, 2000) : d)
      const win: ExtWindow = {
        key,
        extId: ext.id,
        title: String(def.title ?? ext.name),
        width: size(def.width, 480),
        height: size(def.height, 360),
        el,
        raised: Date.now(),
        close: () => {
          if (!store.get().extUi.windows.some((w) => w.key === key)) return
          setUi((u) => ({ windows: u.windows.filter((w) => w.key !== key) }))
          if (def.onClose) void guard(r, def.onClose)
        }
      }
      setUi((u) => ({ windows: [...u.windows, win] }))
      add(() => setUi((u) => ({ windows: u.windows.filter((w) => w.key !== key) })))
    },
    closeWindow: (id: string) => store.get().extUi.windows.find((w) => w.key === `${ext.id}:${id}`)?.close(),
    setStatus: (id: string, item: { text: string; tooltip?: string; onClick?: Fn }) => {
      const key = `${ext.id}:${id}`
      const s: ExtStatusItem = {
        key,
        extId: ext.id,
        text: String(item.text ?? ''),
        tooltip: String(item.tooltip ?? ext.name),
        onClick: item.onClick ? () => void guard(r, item.onClick!) : null
      }
      setUi((u) => ({ status: [...u.status.filter((x) => x.key !== key), s] }))
      add(() => setUi((u) => ({ status: u.status.filter((x) => x.key !== key) })))
    },
    removeStatus: (id: string) => setUi((u) => ({ status: u.status.filter((x) => x.key !== `${ext.id}:${id}`) })),
    notify: (text: string, kind: 'info' | 'success' | 'warning' | 'error' = 'info', action?: { label: string; run: Fn }) =>
      toast(
        String(text),
        kind === 'warning' ? 'error' : kind,
        action ? { label: String(action.label), run: () => void guard(r, action.run) } : undefined,
        action ? 10000 : 4500
      ),
    confirm: async (message: string, detail?: string, ok = 'Confirmer', cancel = 'Annuler') =>
      (await ask({ title: ext.name, message: String(message), detail: detail ? String(detail) : undefined, buttons: [String(cancel), String(ok)] })).button === 1,
    prompt: async (message: string, value = '', placeholder = '') => {
      const a = await ask({ title: ext.name, message: String(message), input: { value: String(value), placeholder: String(placeholder) }, buttons: ['Annuler', 'Valider'] })
      return a.button === 1 ? a.value : null
    }
  }

  const editor = {
    activeFile: () => getActivePath(),
    getText: async (path?: string) => {
      const p = path ? rel(path) : getActivePath()
      if (!p) return null
      return textOf(p) ?? window.api.read(needRoot(), p)
    },
    getSelection: () => {
      const v = getView()
      if (!v || !getActivePath()) return null
      const { from, to } = v.state.selection.main
      const line = v.state.doc.lineAt(from)
      return { file: getActivePath(), from, to, text: v.state.sliceDoc(from, to), line: line.number, column: from - line.from + 1 }
    },
    replaceSelection: (text: string) => insertText(String(text)),
    insert: (text: string, opts?: { snippet?: boolean }) => insertText(String(text), !!opts?.snippet),
    replaceRange: (from: number, to: number, text: string) => {
      const v = getView()
      if (!v) throw new Error('Aucun fichier ouvert')
      v.dispatch({ changes: { from: Number(from), to: Number(to), insert: String(text) } })
    },
    goto: (path: string, line?: number) => {
      const p = rel(path)
      // Ouvert dans Lumen TeX seulement : un autre fichier partirait vers son programme (un .bat y serait lancé)
      if (!isTextFile(p) && !IMAGE_FILE.test(p)) throw new Error(`${p} : seuls les fichiers texte et les images s’ouvrent dans l’éditeur`)
      return openFile(p, line ? { line: Number(line) } : undefined)
    },
    onChange: (fn: Fn) => listen(r, 'editor.change', fn),
    onActiveChange: (fn: Fn) => listen(r, 'editor.active', fn)
  }

  const completion = {
    /** Propositions : provide({ path, word, line, pos }) → [{ label, insert?, snippet?, detail?, info? }] */
    register: (c: { languages?: string[]; match?: string; provide: Fn }) => {
      const re = new RegExp(`(?:${typeof c.match === 'string' && c.match ? c.match : '[\\w@\\\\-]+'})$`)
      const source = async (ctx: CompletionContext): Promise<CompletionResult | null> => {
        const m = ctx.matchBefore(re)
        if (!m || (m.from === m.to && !ctx.explicit)) return null
        const line = ctx.state.doc.lineAt(ctx.pos)
        const items = (await guard(r, () => c.provide({ path: getActivePath(), word: m.text, line: line.text.slice(0, ctx.pos - line.from), pos: ctx.pos }))) as
          | { label: string; insert?: string; snippet?: string; detail?: string; info?: string }[]
          | undefined
        if (!Array.isArray(items) || !items.length) return null
        return {
          from: m.from,
          options: items.map((i) =>
            i.snippet
              ? cmAutocomplete.snippetCompletion(String(i.snippet), { label: String(i.label), detail: i.detail ?? ext.name, info: i.info })
              : { label: String(i.label), apply: i.insert ?? String(i.label), detail: i.detail ?? ext.name, info: i.info }
          )
        }
      }
      const entry = { languages: (c.languages ?? []).map(String), source }
      r.completions.push(entry)
      reconfigureAll()
      add(() => {
        r.completions = r.completions.filter((x) => x !== entry)
        reconfigureAll()
      })
    }
  }

  const diagnostics = {
    /** [{ file, line?, from?, to?, severity, message }] : panneau Problèmes, et soulignés dans l'éditeur */
    set: (items: Diagnostic[]) => {
      r.diagnostics = (Array.isArray(items) ? items : []).slice(0, 2000).map((d) => ({
        severity: d.severity === 'error' || d.severity === 'warning' ? d.severity : 'info',
        message: String(d.message ?? ''),
        file: d.file ? rel(d.file) : undefined,
        line: d.line ? Number(d.line) : undefined,
        from: typeof d.from === 'number' ? d.from : undefined,
        to: typeof d.to === 'number' ? d.to : undefined,
        source: ext.name
      }))
      publishDiagnostics()
    },
    clear: () => {
      r.diagnostics = []
      publishDiagnostics()
    }
  }

  const project = {
    root: () => store.get().root,
    mainFile: () => store.get().mainFile,
    list: () => store.get().files.filter((f) => !f.isDir).map((f) => f.path),
    read: (path: string) => window.api.read(needRoot(), rel(path)),
    readBinary: (path: string) => window.api.readBinary(needRoot(), rel(path)),
    write: (path: string, text: string) => window.api.write(needRoot(), rel(path), String(text)),
    writeBinary: (path: string, data: Uint8Array) => window.api.writeBinary(needRoot(), rel(path), data),
    onFilesChanged: (fn: Fn) => listen(r, 'project.files', fn),
    onOpen: (fn: Fn) => listen(r, 'project.open', fn)
  }

  const compileApi = {
    run: () => compile(),
    progress: (text: string) => store.set({ compileProgress: String(text) }),
    onStart: (fn: Fn) => listen(r, 'compile.start', fn),
    onDone: (fn: Fn) => listen(r, 'compile.done', fn)
  }

  const compilers = {
    register: (c: { id: string; name: string; language: string; check?: Fn; compile: Fn; cancel?: Fn; sync?: { forward?: Fn; reverse?: Fn } }) => {
      const dispose = registerCompiler({
        id: `${ext.id}/${c.id}`,
        name: String(c.name),
        language: String(c.language),
        owner: ext.id,
        check: c.check ? async () => ((await c.check!()) as { ok: boolean }) ?? { ok: false, reason: 'Vérification impossible' } : undefined,
        compile: async (ctx: CompileContext) => {
          const out = await c.compile({ root: ctx.root, mainFile: ctx.mainFile, outDir: ctx.outDir })
          return (out ?? { ok: false, error: `${c.name} n’a rien rendu` }) as never
        },
        cancel: c.cancel ? () => guard(r, c.cancel!) : undefined,
        sync: c.sync
          ? {
              forward: c.sync.forward ? async (file, line) => ((await guard(r, () => c.sync!.forward!(file, line))) as never) ?? null : undefined,
              reverse: c.sync.reverse ? async (page, x, y) => ((await guard(r, () => c.sync!.reverse!(page, x, y))) as never) ?? null : undefined
            }
          : undefined
      })
      add(dispose)
      ensureMainFile()
    }
  }

  const languages = {
    register: (l: { id: string; name: string; extensions: string[]; editor?: Extension; autoCompile?: boolean; icon?: string }) => {
      const dispose = registerLanguage({
        id: String(l.id),
        name: String(l.name),
        extensions: (l.extensions ?? []).map((e) => String(e).toLowerCase()),
        editor: r.trusted ? l.editor : undefined,
        autoCompile: l.autoCompile,
        icon: typeof l.icon === 'string' && l.icon.startsWith('data:image/svg+xml') ? l.icon : undefined,
        owner: ext.id
      })
      reconfigureAll()
      add(() => {
        dispose()
        reconfigureAll()
      })
    }
  }

  const session = {
    active: () => store.get().collab.active,
    me: () => collabMe(),
    people: () => collabPeople(),
    onActive: (fn: Fn) => listen(r, 'session.active', fn),
    onPeople: (fn: Fn) => listen(r, 'session.people', fn),
    send: (data: unknown, to?: string) => {
      needSession()
      sendExtensionMessage(ext.id, data, to ? String(to) : undefined)
    },
    onMessage: (fn: Fn) => {
      needSession()
      listen(r, 'session.message', fn)
    }
  }

  // IA de l'utilisateur : chaque requête passe par son accord (réglage tenu par Lumen TeX, hors de portée de l'extension)
  const ai = {
    available: async () => {
      const engine = store.get().settings.aiEngine
      const st = await window.api.aiStatus(engine)
      return { ready: st.installed && st.loggedIn, engine: ENGINES[engine].name }
    },
    ask: async (prompt: string, opts?: { system?: string; onText?: Fn }) => {
      const q = String(prompt ?? '')
      if (!q.trim()) throw new Error('Question vide')
      if (!(await ai.available()).ready) throw new Error('Aucune IA n’est prête : choisissez et connectez une IA dans le panneau de l’assistant.')
      await allowAi(r, q)
      const reqId = ++aiSeq
      let answer = ''
      const off = window.api.onExtAiChunk((id, t) => {
        if (id !== reqId) return
        answer += t
        if (opts?.onText) void guard(r, () => opts.onText!(t, answer))
      })
      try {
        await window.api.extAi(reqId, ext.id, q, String(opts?.system ?? ''))
      } finally {
        off()
      }
      return answer
    },
    stop: () => window.api.extAiStop(ext.id)
  }
  add(() => void window.api.extAiStop(ext.id))

  const settingValue = (key: string): unknown =>
    store.get().settings.extSettings?.[ext.id]?.[key] ?? ext.settings.find((s) => s.id === key)?.default
  const settings = {
    get: (key: string) => settingValue(String(key)),
    all: () => Object.fromEntries(ext.settings.map((s) => [s.id, settingValue(s.id)])),
    onChange: (fn: Fn) => listen(r, 'settings.change', fn)
  }

  const storage = {
    get: (key: string) => r.storage[String(key)],
    set: async (key: string, value: unknown) => {
      if (value === undefined) delete r.storage[String(key)]
      else r.storage[String(key)] = value
      await window.api.extStorageSet(ext.id, String(key), value)
    }
  }

  const rawFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }) =>
    window.api.extFetch(ext.id, String(url), init ?? {})

  const api: Record<string, unknown> = {
    version: __APP_VERSION__,
    extension: { id: ext.id, name: ext.name, version: ext.version },
    trusted: r.trusted,
    commands,
    ui,
    editor,
    completion,
    diagnostics,
    project,
    compile: compileApi,
    compilers,
    languages,
    session,
    settings,
    storage,
    ai,
    log: (...args: unknown[]) => extLog(ext.id, 'log', args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  }

  if (!r.trusted) {
    // Isolée : la réponse brute, mise en forme par son pont
    api.fetch = rawFetch
    return withCleanErrors(api)
  }

  api.fetch = async (url: string, init?: Parameters<typeof rawFetch>[1]) => {
    const res = await rawFetch(url, init)
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      headers: res.headers,
      bytes: () => res.body,
      text: () => new TextDecoder().decode(res.body),
      json: () => JSON.parse(new TextDecoder().decode(res.body))
    }
  }
  // Mêmes modules CodeMirror que l'éditeur (deux copies ne peuvent pas cohabiter)
  api.codemirror = {
    state: cmState,
    view: cmView,
    language: cmLanguage,
    autocomplete: cmAutocomplete,
    commands: cmCommands,
    lint: cmLint,
    search: cmSearch,
    highlight: lezerHighlight
  }
  ;(editor as Record<string, unknown>).view = () => getView()
  ;(editor as Record<string, unknown>).addExtension = (cmExt: Extension, opts?: { languages?: string[] }) => {
    const entry = { languages: (opts?.languages ?? []).map(String), ext: cmExt }
    r.editorExts.push(entry)
    reconfigureAll()
    add(() => {
      r.editorExts = r.editorExts.filter((x) => x !== entry)
      reconfigureAll()
    })
  }
  api.node = {
    call: (method: string, ...args: unknown[]) => nodeCall(r, String(method), args),
    on: (name: string, fn: Fn) => listen(r, `node.${name}`, fn)
  }
  return withCleanErrors(api)
}

let aiSeq = 0

/** Accord de l'utilisateur pour une requête à l'IA ; la case apparaît dans les réglages de l'extension dès la première */
async function allowAi(r: Running, question: string): Promise<void> {
  const all = store.get().settings.extAi ?? {}
  if (all[r.ext.id]) return
  if (!(r.ext.id in all)) await updateSettings({ extAi: { ...all, [r.ext.id]: false } })
  const engine = ENGINES[store.get().settings.aiEngine].name
  const a = await ask({
    title: r.ext.name,
    message: `L’extension « ${r.ext.name} » veut poser cette question à votre IA (${engine}) :`,
    detail: `${question.length > 700 ? `${question.slice(0, 700)}…` : question}\n\nVous pouvez la laisser faire sans demander dans les réglages de l’extension.`,
    buttons: ['Refuser', 'Toujours autoriser', 'Autoriser']
  })
  if (a.button === 1) await updateSettings({ extAi: { ...(store.get().settings.extAi ?? {}), [r.ext.id]: true } })
  else if (a.button !== 2) throw new Error('Requête à l’IA refusée par l’utilisateur')
}

/** Erreurs rendues aux extensions : messages lisibles, sans le préfixe d'Electron (CodeMirror laissé tel quel) */
function withCleanErrors(api: Record<string, unknown>): Record<string, unknown> {
  const wrap = (fn: Fn): Fn =>
    function (this: unknown, ...args: unknown[]) {
      try {
        const v = fn.apply(this, args)
        return v instanceof Promise ? v.catch((e: unknown) => Promise.reject(new Error(cleanMessage(e)))) : v
      } catch (e) {
        throw new Error(cleanMessage(e))
      }
    }
  for (const [k, v] of Object.entries(api)) {
    if (k === 'codemirror') continue
    if (typeof v === 'function') api[k] = wrap(v as Fn)
    else if (v && typeof v === 'object' && k !== 'extension')
      for (const [k2, v2] of Object.entries(v)) if (typeof v2 === 'function') (v as Record<string, unknown>)[k2] = wrap(v2 as Fn)
  }
  return api
}

// ---------------------------------------------------------------------------
// Partie Node.js
// ---------------------------------------------------------------------------

async function nodeCall(r: Running, method: string, args: unknown[]): Promise<unknown> {
  const n = r.node
  if (!n) throw new Error('Cette extension n’a pas de partie Node.js')
  // Port pas encore arrivé (démarrage) : attendu
  if (!n.port) await Promise.race([n.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('La partie Node.js ne répond pas')), 15000))])
  const id = ++n.seq
  return new Promise((resolve, reject) => {
    n.pending.set(id, { resolve, reject: reject as Fn })
    n.port!.postMessage({ t: 'call', id, method, args })
  })
}

function nodeLink(): NonNullable<Running['node']> {
  let setReady = (): void => {}
  const ready = new Promise<void>((resolve) => (setReady = resolve))
  return { port: null, seq: 0, pending: new Map(), ready, setReady }
}

function attachNodePort(r: Running, port: MessagePort): void {
  r.node ??= nodeLink()
  r.node.port = port
  r.node.setReady()
  port.onmessage = ({ data: m }) => {
    if (m.t === 'result' || m.t === 'error') {
      const p = r.node?.pending.get(m.id)
      r.node?.pending.delete(m.id)
      if (m.t === 'result') p?.resolve(m.value)
      else p?.reject(new Error(m.message))
    } else if (m.t === 'event') fire2(r, `node.${m.name}`, m.data)
    else if (m.t === 'log') extLog(r.ext.id, m.level, (m.args as string[]).join(' '))
  }
  port.start()
}

const fire2 = (r: Running, name: string, ...args: unknown[]): void => {
  for (const fn of r.listeners.get(name) ?? []) void guard(r, () => fn(...args))
}

// ---------------------------------------------------------------------------
// Cadres isolés : messages
// ---------------------------------------------------------------------------

/** Les fonctions d'un cadre isolé (numérotées par son pont) deviennent des fonctions qui lui écrivent */
function unmarshal(r: Running, v: unknown): unknown {
  if (v && typeof v === 'object') {
    if ('__lumenCb' in v) {
      const cb = (v as { __lumenCb: number }).__lumenCb
      return (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          const id = ++r.cbSeq
          r.cbPending.set(id, { resolve, reject: reject as Fn })
          r.frame?.contentWindow?.postMessage({ t: 'cb', id, cb, args }, '*')
        })
    }
    if (Array.isArray(v)) return v.map((x) => unmarshal(r, x))
    if (Object.getPrototypeOf(v) === Object.prototype)
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, unmarshal(r, x)]))
  }
  return v
}

async function onFrameMessage(r: Running, m: { t: string; id?: number; path?: string; args?: unknown[]; value?: unknown; error?: string; level?: string; failed?: boolean }): Promise<void> {
  const post = (msg: unknown): void => {
    try {
      r.frame?.contentWindow?.postMessage(msg, '*')
    } catch (e) {
      r.frame?.contentWindow?.postMessage({ t: 'error', id: m.id, message: `Réponse impossible à transmettre : ${(e as Error).message}` }, '*')
    }
  }
  if (m.t === 'hello') {
    post({ t: 'init', ext: r.ext, version: __APP_VERSION__ })
    postTheme(r)
  } else if (m.t === 'call') {
    try {
      const fn = (m.path ?? '').split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], r.api) as Fn | undefined
      if (typeof fn !== 'function') throw new Error(`lumen.${m.path} n’existe pas pour une extension isolée`)
      const value = await fn(...((unmarshal(r, m.args ?? []) as unknown[]) ?? []))
      post({ t: 'result', id: m.id, value })
    } catch (e) {
      post({ t: 'error', id: m.id, message: cleanMessage(e) })
    }
  } else if (m.t === 'cb-result') {
    const p = r.cbPending.get(m.id!)
    r.cbPending.delete(m.id!)
    if (m.error !== undefined) p?.reject(new Error(m.error))
    else p?.resolve(m.value)
  } else if (m.t === 'log') extLog(r.ext.id, (m.level as ExtLog['level']) ?? 'log', ((m.args as string[]) ?? []).join(' '))
  else if (m.t === 'ready' && m.failed) extLog(r.ext.id, 'error', 'L’extension n’a pas pu démarrer')
}

window.addEventListener('message', (e) => {
  // Port de la partie Node.js, transmis par le preload
  if (e.source === window && e.data && typeof e.data === 'object' && 'lumenNodePort' in e.data) {
    const r = running.get(String(e.data.lumenNodePort))
    if (r && e.ports[0]) attachNodePort(r, e.ports[0])
    return
  }
  for (const r of running.values()) if (r.frame && e.source === r.frame.contentWindow) return void onFrameMessage(r, e.data)
})

/** Couleurs de Lumen TeX (variables CSS) envoyées aux cadres isolés */
function themeVars(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement)
  const vars: Record<string, string> = {}
  for (let i = 0; i < cs.length; i++) {
    const k = cs[i]
    if (k.startsWith('--')) vars[k] = cs.getPropertyValue(k)
  }
  return vars
}
function postTheme(r: Running): void {
  r.frame?.contentWindow?.postMessage({ t: 'theme', vars: themeVars(), dark: store.get().resolvedDark }, '*')
}
let lastDark: boolean | null = null
let lastTheme = ''
store.subscribe(() => {
  const s = store.get()
  if (s.resolvedDark === lastDark && s.settings.colorTheme === lastTheme) return
  lastDark = s.resolvedDark
  lastTheme = s.settings.colorTheme
  // Après l'application du thème
  setTimeout(() => running.forEach(postTheme), 50)
})

function framesLayer(): HTMLElement {
  let el = document.getElementById('ext-frames')
  if (!el) {
    el = document.createElement('div')
    el.id = 'ext-frames'
    document.body.appendChild(el)
  }
  return el
}

/** Cadre d'une extension isolée (son panneau éventuel est placé au-dessus de la zone du panneau) */
export const frameOf = (extId: string): HTMLIFrameElement | null => running.get(extId)?.frame ?? null

// ---------------------------------------------------------------------------
// Démarrage et arrêt
// ---------------------------------------------------------------------------

async function startOne(ext: ExtensionInfo): Promise<void> {
  if (running.has(ext.id) || !enabled(ext) || !hasCode(ext)) return
  const trusted = isTrusted(ext)
  // Isolée : coupée pendant une session partagée ; partie Node.js réservée aux extensions de confiance
  if (!trusted && (store.get().collab.active || !ext.main)) return
  const r = {
    ext,
    trusted,
    frame: null,
    disposers: [],
    listeners: new Map(),
    storage: await window.api.extStorage(ext.id).catch(() => ({})),
    node: null,
    cbPending: new Map(),
    cbSeq: 0,
    diagnostics: [],
    completions: [],
    editorExts: []
  } as unknown as Running
  r.api = makeApi(r)
  running.set(ext.id, r)
  if (trusted) {
    if (ext.node) {
      r.node = nodeLink()
      await window.api.extNodeStart(ext.id).catch((e) => extLog(ext.id, 'error', `Partie Node.js : ${(e as Error).message}`))
    }
    if (ext.main) {
      await guard(r, async () => {
        // Adresse unique à chaque chargement : jamais l'ancien code d'une extension mise à jour
        const mod = (await import(/* @vite-ignore */ `lumen-ext://app/${ext.id}/${ext.main}?t=${Date.now()}`)) as { activate?: Fn; deactivate?: Fn }
        r.disposers.push(() => void guard(r, () => mod.deactivate?.()))
        await mod.activate?.(r.api)
      })
    }
  } else {
    const f = document.createElement('iframe')
    f.setAttribute('sandbox', 'allow-scripts')
    const allow = [ext.permissions.microphone ? 'microphone' : '', ext.permissions.camera ? 'camera' : ''].filter(Boolean).join('; ')
    if (allow) f.setAttribute('allow', allow)
    f.className = 'ext-frame'
    f.title = ext.name
    f.src = `lumen-ext://sb-${ext.id}/__host.html?t=${Date.now()}`
    framesLayer().appendChild(f)
    r.frame = f
  }
  updateDevPresence()
}

function stopOne(id: string): void {
  const r = running.get(id)
  if (!r) return
  running.delete(id)
  for (const d of r.disposers.reverse()) {
    try {
      d()
    } catch {
      /* déjà retiré */
    }
  }
  r.frame?.remove()
  if (r.ext.node) void window.api.extNodeStop(id)
  r.node?.port?.close()
  if (r.diagnostics.length) publishDiagnostics()
  if (r.completions.length || r.editorExts.length) reconfigureAll()
  updateDevPresence()
}

/** Démarre les extensions avec code installées (au lancement, après les extensions sans code) */
export async function startExtensions(): Promise<void> {
  started = true
  // Langages déclarés dans les manifestes (sans code nécessaire : un compilateur peut venir d'ailleurs)
  for (const ext of store.get().extensions.filter(enabled))
    for (const l of ext.languages) registerLanguage({ id: l.id, name: l.name, extensions: l.extensions, icon: l.icon || undefined, owner: ext.id })
  // Une extension lente à démarrer ne retarde pas l'ouverture du projet plus de 3 s
  await Promise.race([Promise.all(store.get().extensions.map((e) => startOne(e))), new Promise((r) => setTimeout(r, 3000))])
  ensureMainFile()
}

/** Une extension a été installée, mise à jour, activée ou désactivée */
export async function restartExtension(id: string): Promise<void> {
  const r = running.get(id)
  // Code de confiance déjà chargé dans la fenêtre : seul un rechargement le retire vraiment
  if (r?.trusted && r.ext.main) return reloadWindow()
  stopOne(id)
  const ext = store.get().extensions.find((e) => e.id === id)
  if (ext && isTrusted(ext) && ext.main && enabled(ext)) return reloadWindow()
  if (ext) await startOne(ext)
}

/**
 * Rechargement de la fenêtre (code de confiance à retirer ou à charger). Pendant une session partagée, Lumen TeX
 * redémarre complètement : la session reprend dans un nouveau processus, par le chef à la réouverture du projet, par
 * un invité grâce au code gardé ici.
 */
export async function reloadWindow(): Promise<void> {
  await saveAll()
  const c = store.get().collab
  if (!c.active) return location.reload()
  if (c.role === 'guest') localStorage.setItem('lumen.rejoin', c.code)
  await window.api.relaunch()
}

/** Après un redémarrage pendant une session : l'invité la rejoint */
export function resumeAfterReload(): void {
  const code = localStorage.getItem('lumen.rejoin')
  if (!code) return
  localStorage.removeItem('lumen.rejoin')
  void joinSession(code)
}

/** Session partagée : les extensions isolées s'arrêtent (sauf mode développeur), et repartent à la fin */
async function onSessionChange(): Promise<void> {
  if (store.get().collab.active) {
    const stopped = [...running.values()].filter((r) => !r.trusted).map((r) => r.ext.name)
    for (const r of [...running.values()]) if (!r.trusted) stopOne(r.ext.id)
    if (stopped.length)
      toast(`Extensions non vérifiées désactivées pendant la session : ${stopped.join(', ')}`, 'info', undefined, 7000)
  } else await Promise.all(store.get().extensions.map((e) => startOne(e)))
}

/** Mode développeur : les autres participants voient quelles extensions non vérifiées tournent */
function updateDevPresence(): void {
  const dev = store.get().settings.extDevMode
    ? [...running.values()].filter((r) => r.ext.trust !== 'verified').map((r) => ({ name: r.ext.name, version: r.ext.version }))
    : []
  setDevExtensions(dev)
}

// Raccourcis clavier des commandes d'extensions : « Mod-Shift-K » (Mod = Ctrl, ou ⌘ sur Mac)
window.addEventListener(
  'keydown',
  (e) => {
    const cmds = store.get().extUi.commands.filter((c) => c.shortcut)
    if (!cmds.length) return
    const mac = window.api.platform === 'darwin'
    for (const c of cmds) {
      const parts = c.shortcut.split('-')
      const key = parts.pop()!.toLowerCase()
      const mods = new Set(parts.map((p) => p.toLowerCase()))
      const mod = mac ? e.metaKey : e.ctrlKey
      if (
        e.key.toLowerCase() === key &&
        mods.has('mod') === mod &&
        mods.has('shift') === e.shiftKey &&
        mods.has('alt') === e.altKey &&
        (mac ? mods.has('ctrl') === e.ctrlKey : true)
      ) {
        e.preventDefault()
        void c.run()
        return
      }
    }
  },
  true
)

/** Raccourci au format de l'app (« ⇧⌘K »), traduit ensuite par kb() hors macOS */
export const shortcutLabel = (s: string): string =>
  s
    ? s
        .split('-')
        .map((p) => ({ mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃' })[p.toLowerCase()] ?? p.toUpperCase())
        .join('')
    : ''
