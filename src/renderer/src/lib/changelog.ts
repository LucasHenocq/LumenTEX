import { store, updateSettings } from '../store'

/**
 * Nouveautés de chaque version, de la plus récente à la plus ancienne, affichées après une mise à jour.
 * À compléter à chaque version publiée (texte pour les utilisateurs, pas pour les développeurs).
 */
export const CHANGELOG: { version: string; date: string; items: string[] }[] = [
  {
    version: '1.2.2',
    date: '2026-10-05',
    items: [
      'Partage : le chef de session choisit les droits. Chaque personne est en lecture seule, en modification, ou en modification avec ajout de fichiers ; ceux qui rejoignent arrivent en lecture seule, sauf ceux à qui il l’a déjà permis.',
      'Partage : chaque fichier peut être modifiable, en lecture seule (cadenas dans l’arbre) ou invisible (il reste sur l’ordinateur du chef).',
      'Partage : comme dans Live Share, le projet ne s’installe plus chez ceux qui rejoignent ; il est effacé à la fin de la session. Si le chef le permet, « Garder une copie » l’enregistre dans Documents.',
      'Rejoindre une session ne crée plus de dossier en double.',
      'Le départ brutal d’un participant (coupure, plantage) est vu deux fois plus vite.'
    ]
  },
  {
    version: '1.2.1',
    date: '2026-10-04',
    items: [
      'Version macOS (Mac Apple et Intel) : une notification annonce chaque mise à jour, que Lumen TeX télécharge et ouvre, prête à glisser dans Applications.',
      'Les formules écrites par l’IA (et dans la discussion de session) s’affichent mises en forme, et plus en caractères LaTeX bruts.',
      'Claude : un clic sur « 5h : … % » actualise l’utilisation, qui manquait parfois ou datait.',
      'L’icône de Lumen TeX s’affiche correctement dans la barre des tâches.'
    ]
  },
  {
    version: '1.2.0',
    date: '2026-10-03',
    items: [
      'Discussion de session : un onglet 💬 dans la barre de gauche pendant le travail à plusieurs, avec le nom et la couleur de chacun, « … écrit » et l’historique conservé dans le projet.',
      '« Ma position » joint au message le fichier, la ligne et la sélection : un clic sur la carte y emmène.',
      'Notifications Windows des nouveaux messages quand Lumen TeX est en arrière-plan (cloche pour les couper).',
      'Partage plus robuste : si deux personnes ne peuvent pas se joindre directement, elles se reçoivent par l’intermédiaire d’une troisième.',
      'Lumen TeX réduit ou caché reste bien présent pour les autres participants.',
      'Partage : quand quelqu’un renomme ou déplace un fichier ou un dossier, il est déplacé chez chacun (plus de passage par la Corbeille) et l’onglet ouvert suit.',
      'Partage : les fichiers de plus de 15 Mo ne sont plus ignorés en silence (message et liste « Non partagés » dans la fenêtre de partage).',
      'Partage : connexion plus rapide quand plusieurs personnes ouvrent le projet en même temps, ou après un plantage.',
      'La fenêtre ne s’ouvre plus sur un écran débranché : elle revient sur l’écran principal.',
      'Les mises à jour sont aussi recherchées quand Lumen TeX reste ouvert longtemps (toutes les 4 heures).'
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
