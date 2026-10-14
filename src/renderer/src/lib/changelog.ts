import { store, updateSettings } from '../store'

/**
 * Nouveautés de chaque version, de la plus récente à la plus ancienne, affichées après une mise à jour.
 * À compléter à chaque version publiée (texte pour les utilisateurs, pas pour les développeurs).
 */
export const CHANGELOG: { version: string; date: string; items: string[] }[] = [
  {
    version: '1.5.0',
    date: '2026-10-14',
    items: [
      'Les extensions peuvent contenir du code : commandes, panneaux, autocomplétion, erreurs signalées dans l’éditeur, nouveaux compilateurs et nouveaux langages, échanges entre les participants d’une session.',
      'Celles du catalogue sont relues avant d’y entrer et marquées « Vérifiée ». Celles installées depuis un dossier fonctionnent isolées : elles ne voient que le projet ouvert, n’accèdent qu’aux sites qu’elles déclarent, et sont arrêtées pendant les sessions partagées. Avant d’installer une extension avec code, Lumen TeX montre ce qu’elle pourra faire.',
      'Chaque extension a son interrupteur et ses réglages dans le panneau Extensions ; ses messages et ses erreurs apparaissent dans un onglet « Extensions » du journal.',
      'Compilateurs : quand une extension en ajoute un pour le langage du document, un menu à côté de « Compiler » permet de choisir. Réglages → Compilation les liste tous, avec la raison quand l’un d’eux n’est pas disponible.',
      'Mode développeur (Réglages → Extensions) : pour écrire et tester une extension, toutes fonctionnent comme si elles étaient vérifiées. Dans une session partagée, les autres participants en sont prévenus et peuvent quitter la session ; le chef peut aussi mettre la personne en lecture seule.'
    ]
  },
  {
    version: '1.4.1',
    date: '2026-10-14',
    items: [
      'Les extensions ont leur onglet dans la barre de gauche (icône de pièce de puzzle).',
      'La barre latérale (fichiers, assistant IA) prend bien les couleurs du thème choisi. Elle avait gardé un fond gris venu de l’aperçu PDF, aussi avec le thème de base.'
    ]
  },
  {
    version: '1.4.0',
    date: '2026-10-14',
    items: [
      'Extensions : Réglages → Extensions présente le catalogue officiel. Une extension s’installe en un clic et ajoute des bouts de LaTeX à l’autocomplétion, des environnements, des symboles au panneau Σ, des modèles de projet ou des thèmes de couleurs.',
      'Premières extensions : « TikZ et pgfplots » (figures, repères, courbes, graphes de fonctions) et « Thèmes Nord et Solarized ». Le thème se choisit dans Réglages → Apparence.',
      'Une extension se met à jour depuis Réglages → Extensions quand une nouvelle version est publiée. Elle peut aussi s’installer depuis un dossier, pour essayer la sienne avant de la proposer au catalogue.'
    ]
  },
  {
    version: '1.3.4',
    date: '2026-10-14',
    items: [
      'Réglages : « Rechercher une mise à jour », sous le numéro de version, vérifie tout de suite s’il existe une nouvelle version et la télécharge, sans attendre la vérification automatique.'
    ]
  },
  {
    version: '1.3.3',
    date: '2026-10-12',
    items: [
      'L’assistant IA voit en même temps les erreurs LaTeX, les messages de Lean et l’état des preuves vérifiées du document (par exemple : « refusée à l’étape 2 »), quel que soit le fichier ouvert.',
      'Lean vérifie que la preuve suit bien la vôtre : si l’IA conclut sans utiliser une de vos étapes, elle doit recommencer ; sinon l’étape est signalée ⚠ dans la fenêtre de validation.',
      'Un fichier .lean modifié pendant que son onglet est fermé (par l’IA, par exemple) se rouvre bien avec son nouveau contenu.',
      'La vérification par l’IA se suit dans une fenêtre à part, qu’on peut déplacer, agrandir, masquer et rouvrir en cliquant sur « … » dans la marge ; elle se rouvre d’elle-même à la fin. Le copilot reste libre pendant ce temps, et « Arrêter » interrompt la vérification.',
      'Dans le PDF, « LEAN » s’inscrit à côté du carré de fin des preuves vérifiées étape par étape (désactivable dans Réglages → Lean). Le fichier .tex n’est pas modifié.',
      'Fichiers .lean : le panneau Σ propose les symboles Lean (∀, ∃, ℝ, →…, avec leur abréviation), et ces fichiers ont leur propre icône.',
      'Claude peut faire des recherches sur Internet (documentation, noms de lemmes de Mathlib). Gemini aussi ; s’il a épuisé son quota gratuit, un message le dit au lieu d’une réponse vide.'
    ]
  },
  {
    version: '1.3.2',
    date: '2026-10-12',
    items: [
      'Lean vérifie maintenant votre preuve, et plus seulement l’énoncé : chaque étape de la preuve LaTeX devient une étape Lean. Si une étape est fausse ou ne découle pas des précédentes, Lumen TeX vous montre laquelle, avec la raison (souvent un contre-exemple).',
      '« Vérifier seulement l’énoncé » reste possible : la coche est alors plus claire, pour la distinguer d’une preuve vérifiée étape par étape.',
      'La validation se fait dans une fenêtre de Lumen TeX : votre énoncé et vos étapes s’affichent en formules, à côté de leur version Lean.'
    ]
  },
  {
    version: '1.3.1',
    date: '2026-10-12',
    items: [
      'Lean : une preuve séparée de son théorème par un titre ou du texte (« \\section{Démonstration} »…) a maintenant sa coche, sur la ligne du théorème.'
    ]
  },
  {
    version: '1.3.0',
    date: '2026-10-12',
    items: [
      'Lean : vérifiez vos démonstrations. Une coche dans la marge, à côté de chaque énoncé suivi d’une preuve, la fait vérifier par Lean, avec l’IA ou en écrivant le Lean vous-même. ✓ vérifiée, ✗ refusée, ↻ modifiée depuis. La coche n’apparaît jamais dans le PDF.',
      'Avec l’IA, Lumen TeX lui fait traduire la preuve en Lean et la corriger jusqu’à ce que Lean l’accepte, puis vous montre l’énoncé traduit à valider : c’est le seul point à vérifier vous-même.',
      'Fichiers .lean : écrivez du Lean comme du LaTeX. Le panneau Lean remplace l’aperçu PDF et montre ce qu’il reste à démontrer à l’endroit du curseur, ainsi que les erreurs, que l’IA peut corriger.',
      'Les symboles se tapent comme dans VS Code : \\to puis espace donne →, \\forall donne ∀, \\R donne ℝ…',
      'Lean et Mathlib (≈ 10 Go) s’installent à la demande, en un clic, depuis le panneau Lean ou les réglages.'
    ]
  },
  {
    version: '1.2.2',
    date: '2026-10-04',
    items: [
      'Partage : le chef de session choisit les droits. Chaque personne est en lecture seule, en modification, ou en modification avec ajout de fichiers ; ceux qui rejoignent arrivent en lecture seule, sauf ceux à qui il l’a déjà permis.',
      'Partage : chaque fichier peut être modifiable, en lecture seule (cadenas dans l’arbre) ou invisible (il reste sur l’ordinateur du chef).',
      'Partage : comme dans Live Share, le projet ne s’installe plus chez ceux qui rejoignent ; il est effacé à la fin de la session. Si le chef le permet, « Garder une copie » l’enregistre dans Documents.',
      'Rejoindre une session ne crée plus de dossier en double.',
      'Le départ brutal d’un participant (coupure, plantage) est vu deux fois plus vite.',
      'Partage : sur un même Wi-Fi, les participants se connectent directement, même quand le réseau (école, entreprise) bloque le partage par Internet.'
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
