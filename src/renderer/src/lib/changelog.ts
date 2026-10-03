import { store, updateSettings } from '../store'

/**
 * Nouveautés de chaque version, de la plus récente à la plus ancienne, affichées après une mise à jour.
 * À compléter à chaque version publiée (texte pour les utilisateurs, pas pour les développeurs).
 */
export const CHANGELOG: { version: string; date: string; items: string[] }[] = [
  {
    version: '1.2.0',
    date: '2026-10-03',
    items: [
      'Discussion de session : un onglet 💬 dans la barre de gauche pendant le travail à plusieurs, avec le nom et la couleur de chacun, « … écrit » et l’historique conservé dans le projet.',
      '« Ma position » joint au message le fichier, la ligne et la sélection : un clic sur la carte y emmène.',
      'Notifications Windows des nouveaux messages quand Lumen TeX est en arrière-plan (cloche pour les couper).',
      'Partage plus robuste : si deux personnes ne peuvent pas se joindre directement, elles se reçoivent par l’intermédiaire d’une troisième.',
      'Lumen TeX réduit ou caché reste bien présent pour les autres participants.'
    ]
  },
  {
    version: '1.1.1',
    date: '2026-10-03',
    items: [
      'Après une mise à jour, cette fenêtre présente les nouveautés ; avec plusieurs mises à jour de retard, elle les montre toutes, version par version.',
      'L’historique complet reste accessible en cliquant sur le numéro de version, en bas des réglages.'
    ]
  },
  {
    version: '1.1.0',
    date: '2026-10-03',
    items: [
      'Travail à plusieurs en direct : partage un projet avec un code (bouton 👥 en haut à droite), chacun voit le texte et le curseur des autres et compile le PDF chez lui.',
      'Connexion directe entre ordinateurs, sans serveur ni compte ; les modifications faites hors ligne sont fusionnées au retour.',
      'Les mises à jour s’installent désormais sans fenêtre, puis Lumen TeX redémarre tout seul.'
    ]
  },
  {
    version: '1.0.1',
    date: '2026-10-01',
    items: [
      'Déplace fichiers et dossiers par glisser-déposer dans l’arbre des fichiers.',
      'Le numéro de version apparaît en bas de l’accueil et des réglages.'
    ]
  },
  {
    version: '1.0.0',
    date: '2026-09-29',
    items: [
      'Première version : éditeur LaTeX avec aperçu PDF en direct, assistant IA (Ollama, Claude Code, GitHub Copilot, Gemini), conversion d’images et de PDF en LaTeX, mises à jour automatiques.'
    ]
  }
]

/** Comparaison de numéros de version « x.y.z » (négatif si a < b) */
export function compareVersions(a: string, b: string): number {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

/** Versions installées depuis since (exclue) jusqu'à la version courante (incluse) ; toutes si since est absent */
export const entriesSince = (since?: string): typeof CHANGELOG =>
  CHANGELOG.filter((e) => (!since || compareVersions(e.version, since) > 0) && compareVersions(e.version, __APP_VERSION__) <= 0)

/** Au démarrage : nouveautés des versions installées depuis la dernière ouverture */
export function checkWhatsNew(): void {
  const current = __APP_VERSION__
  const { settings, modal } = store.get()
  if (!current || settings.lastSeenVersion === current) return
  // Les versions jusqu'à 1.1.0 ne notaient pas leur passage : un utilisateur existant venait (sauf rare exception) de la 1.1.0.
  // Nouvelle installation : rien à présenter, l'accueil s'en charge
  const existingUser = settings.recentProjects.length > 0 || !!settings.lastProject
  const since = settings.lastSeenVersion || (existingUser ? '1.1.0' : current)
  void updateSettings({ lastSeenVersion: current })
  if (!modal && entriesSince(since).length) store.set({ modal: { type: 'whats-new', since } })
}
