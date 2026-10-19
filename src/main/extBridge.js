// Pont d'une extension isolée (cadre à origine opaque, servi par lumen-ext://sb-<id>/__bridge.js) : construit l'objet
// lumen, dont chaque appel devient un message à la fenêtre de Lumen TeX, puis charge le code de l'extension.
// Les fonctions passées en argument (commandes, fournisseurs…) restent ici : la fenêtre reçoit un numéro, et les
// appelle par message ({ t: 'cb' }). La page de l'extension sert aussi de panneau (lumen.ui.addPanel).

const host = window.parent
let seq = 0
const pending = new Map()
const callbacks = new Map()

const post = (msg) => host.postMessage(msg, '*')

/** Fonctions remplacées par un numéro (aussi dans les objets et tableaux) */
function marshal(v) {
  if (typeof v === 'function') {
    const n = ++seq
    callbacks.set(n, v)
    return { __lumenCb: n }
  }
  if (Array.isArray(v)) return v.map(marshal)
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out = {}
    for (const k of Object.keys(v)) out[k] = marshal(v[k])
    return out
  }
  return v
}

function call(path, args) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    post({ t: 'call', id, path, args: marshal(args) })
  })
}

/** Espace de noms : lumen.editor.getText(…) → call('editor.getText', […]) */
const ns = (prefix) =>
  new Proxy(
    {},
    {
      get: (_, k) => (typeof k === 'string' && k !== 'then' ? (...args) => call(`${prefix}.${k}`, args) : undefined)
    }
  )

const text = (args) => args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? (a.stack ?? a.message) : safeJson(a)))
function safeJson(a) {
  try {
    return JSON.stringify(a)
  } catch {
    return String(a)
  }
}
for (const level of ['log', 'info', 'warn', 'error']) console[level] = (...args) => post({ t: 'log', level, args: text(args) })
window.addEventListener('error', (e) => post({ t: 'log', level: 'error', args: text([e.error ?? e.message]) }))
window.addEventListener('unhandledrejection', (e) => post({ t: 'log', level: 'error', args: text([e.reason]) }))

const reserved = () => Promise.reject(new Error('Réservé aux extensions vérifiées (ou au mode développeur)'))

function makeLumen(init) {
  const lumen = {
    version: init.version,
    extension: init.ext,
    trusted: false,
    commands: ns('commands'),
    editor: ns('editor'),
    completion: ns('completion'),
    diagnostics: ns('diagnostics'),
    project: ns('project'),
    compile: ns('compile'),
    compilers: ns('compilers'),
    languages: ns('languages'),
    session: ns('session'),
    settings: ns('settings'),
    storage: ns('storage'),
    ai: ns('ai'),
    log: (...args) => post({ t: 'log', level: 'log', args: text(args) }),
    /** Internet, limité aux sites déclarés dans le manifeste */
    fetch: async (url, init = {}) => {
      const r = await call('fetch', [String(url), init])
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        headers: r.headers,
        bytes: () => r.body,
        text: () => new TextDecoder().decode(r.body),
        json: () => JSON.parse(new TextDecoder().decode(r.body))
      }
    },
    node: { call: reserved, on: () => reserved() },
    codemirror: null
  }
  const ui = ns('ui')
  lumen.ui = new Proxy(
    {},
    {
      get: (_, k) =>
        k === 'addPanel'
          ? // Le panneau d'une extension isolée est sa propre page
            (def, render) => {
              const p = call('ui.addPanel', [{ ...def }])
              render?.(document.body)
              return p
            }
          : k === 'openWindow'
            ? // Sa fenêtre aussi : la page y est posée (pas en même temps que le panneau)
              (def, render) => {
                const p = call('ui.openWindow', [{ ...def }])
                render?.(document.body)
                return p
              }
            : ui[k]
    }
  )
  return lumen
}

window.addEventListener('message', async (e) => {
  if (e.source !== host) return
  const m = e.data
  if (!m || typeof m !== 'object') return
  if (m.t === 'result' || m.t === 'error') {
    const p = pending.get(m.id)
    pending.delete(m.id)
    if (m.t === 'result') p?.resolve(m.value)
    else p?.reject(new Error(m.message))
  } else if (m.t === 'cb') {
    const fn = callbacks.get(m.cb)
    try {
      if (!fn) throw new Error('Fonction inconnue')
      post({ t: 'cb-result', id: m.id, value: marshal(await fn(...(m.args ?? []))) })
    } catch (err) {
      post({ t: 'cb-result', id: m.id, error: err instanceof Error ? err.message : String(err) })
    }
  } else if (m.t === 'theme') {
    const root = document.documentElement
    root.dataset.theme = m.dark ? 'dark' : 'light'
    for (const [k, v] of Object.entries(m.vars)) root.style.setProperty(k, v)
  } else if (m.t === 'init') {
    const lumen = makeLumen(m)
    try {
      const mod = await import(`./${m.ext.main}?t=${Date.now()}`)
      await mod.activate?.(lumen)
      post({ t: 'ready' })
    } catch (err) {
      post({ t: 'log', level: 'error', args: text([err]) })
      post({ t: 'ready', failed: true })
    }
  }
})

post({ t: 'hello' })
