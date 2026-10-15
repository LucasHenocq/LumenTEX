import type { HistoryVersion } from '../../../shared/types'
import { store, toast } from '../store'
import { saveAll } from './actions'
import { ask } from './dialog'
import { allLanguages } from './languages'
import { on } from './bus'

// Historique des versions du projet ouvert (fichiers gardés par le processus principal, dans .lumentex/historique).
// Versions automatiques après un enregistrement (10 minutes au moins entre deux, et seulement si le projet a changé),
// et versions enregistrées avec un nom. Un invité de session partagée n'en garde pas (sa copie est temporaire).

const api = window.api

/** Extensions des fichiers des langages ajoutés par les extensions (Typst…), gardés aussi */
const extensions = (): string[] => allLanguages().flatMap((l) => l.extensions)

const canKeep = (): boolean => {
  const { root, collab } = store.get()
  return !!root && !(collab.active && collab.role === 'guest')
}

/** Prévient le panneau de l'historique qu'il doit se relire */
const changed = (): void => store.set((s) => ({ historyVersion: s.historyVersion + 1 }))

let pending: Promise<unknown> = Promise.resolve()

/** Après un enregistrement ou à l'ouverture du projet : nouvelle version automatique si c'est le moment */
export function autoSnapshot(): void {
  const { root, settings } = store.get()
  if (!root || !canKeep() || settings.historyAuto === false) return
  pending = pending.then(async () => {
    try {
      if (await api.historySnapshot(root, { auto: true, extensions: extensions() })) changed()
    } catch {
      /* dossier en lecture seule… : l'historique attendra */
    }
  })
}

/** « Enregistrer une version… » : un nom, puis la version (même si rien n'a changé depuis la précédente) */
export async function saveNamedVersion(): Promise<void> {
  const { root } = store.get()
  if (!root) return
  if (!canKeep()) {
    toast('Pendant une session, c’est le chef de session qui garde l’historique du projet.')
    return
  }
  const d = new Date()
  const a = await ask({
    title: 'Enregistrer une version',
    message: 'Donnez un nom à cette version, pour la retrouver facilement dans l’historique.',
    input: { value: '', placeholder: `Ex. Version envoyée le ${d.toLocaleDateString('fr-FR')}` },
    buttons: ['Annuler', 'Enregistrer']
  })
  if (a.button !== 1) return
  await saveAll()
  const name = a.value.trim() || `Version du ${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
  await api.historySnapshot(root, { name, auto: false, force: true, extensions: extensions() })
  changed()
  toast(`Version « ${name} » enregistrée`, 'success')
}

export const listVersions = (): Promise<HistoryVersion[]> => {
  const { root } = store.get()
  return root ? api.historyList(root) : Promise.resolve([])
}

export const readVersionFile = (id: string, rel: string): Promise<string> => api.historyRead(store.get().root!, id, rel)

export const dateLabel = (t: number): string => {
  const d = new Date(t)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400000)
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return `Aujourd’hui à ${time}`
  if (d.toDateString() === yesterday.toDateString()) return `Hier à ${time}`
  return `${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })} à ${time}`
}

/** Restaure un fichier, ou toute la version : l'état actuel est gardé d'abord dans l'historique */
export async function restore(v: HistoryVersion, paths?: string[]): Promise<void> {
  const { root, collab } = store.get()
  if (!root) return
  const what = paths?.length === 1 ? `« ${paths[0]} »` : 'tous les fichiers de cette version'
  const a = await ask({
    title: 'Restaurer',
    message: `Remettre ${what} tel${paths?.length === 1 ? '' : 's'} qu’${paths?.length === 1 ? 'il était' : 'ils étaient'} ${dateLabel(v.date).replace(/^A/, 'a').replace(/^H/, 'h')}${v.name ? ` (« ${v.name} »)` : ''} ?`,
    detail:
      'L’état actuel est d’abord gardé dans l’historique (« Avant la restauration ») : vous pourrez revenir en arrière.' +
      (collab.active ? ' Pendant la session, les autres participants reçoivent aussi les fichiers restaurés.' : '') +
      (paths ? '' : ' Les fichiers créés depuis cette version ne sont pas supprimés.'),
    buttons: ['Annuler', 'Restaurer']
  })
  if (a.button !== 1) return
  await saveAll()
  try {
    const done = await api.historyRestore(root, v.id, paths, extensions())
    changed()
    toast(done.length === 1 ? `« ${done[0]} » restauré` : `${done.length} fichiers restaurés`, 'success')
  } catch (e) {
    toast(`Restauration impossible : ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, 'error', undefined, 6000)
  }
}

export async function renameVersion(v: HistoryVersion): Promise<void> {
  const a = await ask({
    title: 'Renommer la version',
    message: 'Une version nommée est gardée jusqu’à ce que vous la supprimiez. Sans nom, elle redevient automatique.',
    input: { value: v.name ?? '' },
    buttons: ['Annuler', 'Renommer']
  })
  if (a.button !== 1) return
  await api.historyRename(store.get().root!, v.id, a.value)
  changed()
}

export async function deleteVersion(v: HistoryVersion): Promise<void> {
  const a = await ask({
    title: 'Supprimer la version',
    message: `Supprimer ${v.name ? `« ${v.name} »` : 'cette version'} (${dateLabel(v.date).toLowerCase()}) de l’historique ?`,
    buttons: ['Annuler', 'Supprimer']
  })
  if (a.button !== 1) return
  await api.historyDelete(store.get().root!, v.id)
  changed()
}

// Versions automatiques : après chaque enregistrement, et peu après l'ouverture d'un projet
on('file:saved', () => autoSnapshot())
let lastRoot: string | null = null
store.subscribe(() => {
  const root = store.get().root
  if (root === lastRoot) return
  lastRoot = root
  if (root) setTimeout(autoSnapshot, 3000)
})
