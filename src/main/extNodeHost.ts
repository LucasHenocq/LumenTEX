import { pathToFileURL } from 'url'

// Processus de la partie Node.js d'une extension (utilityProcess) : charge son module et lui donne un objet lumen
// pour répondre aux appels de sa partie fenêtre (lumen.node.call) et lui envoyer des événements (lumen.node.on).
// Messages sur le port : { t: 'call', id, method, args } → { t: 'result', id, value } ou { t: 'error', id, message } ;
// { t: 'event', name, data } ; { t: 'log', level, args }.

type Port = Electron.MessagePortMain
type Handler = (...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()
let port: Port | null = null
const queue: unknown[] = []
const post = (msg: unknown): void => {
  if (port) port.postMessage(msg)
  else queue.push(msg)
}

const text = (args: unknown[]): string[] => args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? (a.stack ?? a.message) : JSON.stringify(a)))
for (const level of ['log', 'info', 'warn', 'error'] as const) console[level] = (...args: unknown[]) => post({ t: 'log', level, args: text(args) })

const lumen = {
  version: process.env.npm_package_version ?? '',
  /** Répond aux appels lumen.node.call(name, ...args) de la partie fenêtre */
  handle: (name: string, fn: Handler): void => void handlers.set(name, fn),
  /** Événement reçu par lumen.node.on(name, ...) dans la partie fenêtre */
  send: (name: string, data?: unknown): void => post({ t: 'event', name, data }),
  log: (...args: unknown[]): void => post({ t: 'log', level: 'log', args: text(args) })
}

process.parentPort.once('message', (e) => {
  port = e.ports[0]
  port.on('message', async ({ data }) => {
    const m = data as { t: string; id: number; method: string; args: unknown[] }
    if (m.t !== 'call') return
    const fn = handlers.get(m.method)
    try {
      if (!fn) throw new Error(`La partie Node.js ne répond pas à « ${m.method} »`)
      post({ t: 'result', id: m.id, value: await fn(...(m.args ?? [])) })
    } catch (err) {
      post({ t: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) })
    }
  })
  port.start()
  for (const msg of queue.splice(0)) port.postMessage(msg)
})

process.on('uncaughtException', (err) => post({ t: 'log', level: 'error', args: text([err]) }))
process.on('unhandledRejection', (err) => post({ t: 'log', level: 'error', args: text([err]) }))

const file = process.argv[process.argv.length - 1]
import(pathToFileURL(file).href)
  .then(async (mod: { activate?: (l: typeof lumen) => unknown }) => {
    await mod.activate?.(lumen)
  })
  .catch((err) => post({ t: 'log', level: 'error', args: text([err]) }))
