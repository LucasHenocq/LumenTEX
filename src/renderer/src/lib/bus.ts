/** Petit bus d'événements pour les appels impératifs entre composants. */
type Handler = (payload: any) => void // eslint-disable-line @typescript-eslint/no-explicit-any

const handlers = new Map<string, Set<Handler>>()

export interface BusEvents {
  'editor:goto': { file: string; line: number; col?: number; select?: boolean }
  'editor:insert': { text: string; snippet?: boolean }
  'editor:command': string
  'editor:focus': void
  'pdf:highlight': { page: number; rects: { x: number; y: number; w: number; h: number }[] }
  'pdf:command': string
  /** Question envoyée au copilot (ex. bouton ✨ d'une erreur) */
  'copilot:ask': string
  /** Déplie le panneau du copilot (ex. depuis les réglages, pour se connecter) */
  'copilot:show': void
}

export function on<K extends keyof BusEvents>(event: K, handler: (p: BusEvents[K]) => void): () => void {
  if (!handlers.has(event)) handlers.set(event, new Set())
  handlers.get(event)!.add(handler)
  return () => handlers.get(event)!.delete(handler)
}

export function emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
  handlers.get(event)?.forEach((h) => h(payload))
}
