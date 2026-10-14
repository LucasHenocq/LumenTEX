import { store } from '../store'

/** Fenêtre de question au style de l'app : plusieurs boutons, champ de saisie facultatif */
export interface DialogRequest {
  title: string
  message: string
  detail?: string
  input?: { value: string; placeholder?: string }
  /** Boutons de gauche à droite ; le dernier est le bouton principal */
  buttons: string[]
}

export interface DialogAnswer {
  /** Bouton choisi, -1 si la fenêtre est fermée (Échap) */
  button: number
  value: string
}

let queue: Promise<unknown> = Promise.resolve()

/** Une question à la fois : les suivantes attendent leur tour */
export function ask(req: DialogRequest): Promise<DialogAnswer> {
  const next = queue.then(
    () =>
      new Promise<DialogAnswer>((resolve) => {
        // Fenêtre déjà ouverte (réglages…) : retrouvée après la réponse
        const prev = store.get().modal
        store.set({
          modal: {
            type: 'dialog',
            req,
            resolve: (a) => {
              resolve(a)
              setTimeout(() => store.get().modal === null && prev?.type !== 'dialog' && store.set({ modal: prev }), 0)
            }
          }
        })
      })
  )
  queue = next.catch(() => undefined)
  return next
}
