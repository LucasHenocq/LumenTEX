export type ThemeMode = 'system' | 'light' | 'dark'

/** Moteur du copilot */
export type AiEngine = 'ollama' | 'claude' | 'copilot' | 'gemini'

export interface AiStatus {
  installed: boolean
  loggedIn: boolean
  account?: string
  /** Ollama : serveur lancé, et modèles installés */
  running?: boolean
  models?: string[]
}

export interface ProjectPrefs {
  mainFile?: string
  openTabs?: string[]
  active?: string | null
  /** Session partagée dont on est le chef : fichiers invisibles (jamais envoyés aux autres) */
  collabHidden?: string[]
}

/** Droit d'une personne dans une session : lecture seule, modification, modification et ajout de fichiers */
export type UserRight = 'ro' | 'rw' | 'add'
/** Droit sur un fichier : modifiable (selon la personne), lecture seule, invisible pour les autres */
export type FileRight = 'rw' | 'ro' | 'hidden'

export interface RecentProject {
  path: string
  name: string
  openedAt: number
}

export interface Settings {
  theme: ThemeMode
  /** Thème de couleurs d'une extension (« id/nom »), vide = celui de Lumen TeX */
  colorTheme: string
  /** Mode développeur : toutes les extensions fonctionnent comme si elles étaient vérifiées */
  extDevMode: boolean
  /** Extensions désactivées (identifiants) */
  extDisabled: string[]
  /** Valeurs des réglages de chaque extension */
  extSettings: Record<string, Record<string, unknown>>
  /** Micro et caméra : réponse de l'utilisateur pour chaque extension non vérifiée */
  extMedia: Record<string, boolean>
  /** IA : extensions qui l'ont demandée ; true = sans demander, false = demander à chaque requête */
  extAi: Record<string, boolean>
  /** Compilateur choisi pour chaque langage (identifiant du langage → du compilateur) */
  compilers: Record<string, string>
  /** Historique : une version gardée automatiquement toutes les 10 minutes au plus, quand le projet change */
  historyAuto: boolean
  editorFontSize: number
  editorFontFamily: string
  lineWrapping: boolean
  vimMode: boolean
  spellcheck: boolean
  mathPreview: boolean
  autoCompile: boolean
  compileDelay: number
  compileOnSave: boolean
  shellEscape: boolean
  tectonicPath: string
  tectonicCacheDir: string
  /** Modèle Ollama (local) */
  ollamaModel: string
  /** Modèle de Claude Code (alias ou nom complet), vide = celui par défaut de la CLI */
  claudeModel: string
  aiEngine: AiEngine
  /** Modèle de GitHub Copilot, vide = celui par défaut de la CLI */
  copilotModel: string
  /** Modèle de Gemini (auto, pro, flash…), vide = celui par défaut de la CLI */
  geminiModel: string
  /** Dernier état de connexion connu de GitHub Copilot (null = inconnu) */
  copilotLoggedIn: boolean | null
  copilotHeight: number
  /** Nom affiché aux autres participants d'une session partagée (vide = nom de la session Windows) */
  collabName: string
  /** Sessions partagées par dossier de projet : reprises automatiquement à l'ouverture du projet ; chatRead : messages lus */
  collabSessions: Record<string, { code: string; chatRead?: number }>
  /** Identifiant stable de l'utilisateur dans les sessions (reconnaître ses propres messages) */
  collabUserId: string
  /** Notifications du système des messages quand Lumen TeX est en arrière-plan */
  collabNotify: boolean
  /** Preuves vérifiées par Lean, étape par étape : « LEAN » à côté du carré de fin de preuve dans le PDF */
  leanQedMark: boolean
  /** Chef de session : dernier droit donné à chaque personne (identifiant), retrouvé dans ses autres sessions */
  collabKnown: Record<string, UserRight>
  /** Dernière version dont les nouveautés ont été présentées (vide : jamais) */
  lastSeenVersion: string
  pdfDarkMode: boolean
  sidebarWidth: number
  pdfRatio: number
  sidebarVisible: boolean
  pdfVisible: boolean
  recentProjects: RecentProject[]
  projects: Record<string, ProjectPrefs>
  lastProject: string | null
  windowBounds?: { x: number; y: number; width: number; height: number }
}

/**
 * Réseau du partage en pair-à-pair :
 * starting : lancement ; searching : annonce sur le réseau en cours ; online : annoncé, en attente ou connecté ;
 * network : le réseau ne répond pas (hors ligne, pare-feu) ; unavailable : module réseau inutilisable ; off : arrêté
 */
export interface CollabNetStatus {
  state: 'off' | 'starting' | 'searching' | 'online' | 'network' | 'unavailable'
  /** Participants connectés et authentifiés */
  peers: number
}

/** Message de la discussion d'une session partagée (conservé dans le projet, avec les fichiers) */
export interface ChatMessage {
  id: string
  /** Auteur : identifiant stable, nom et couleur au moment de l'envoi */
  uid: string
  name: string
  color: string
  text: string
  ts: number
  /** Position dans le projet jointe au message (ligne, et sélection citée) */
  ref?: { file: string; line: number; quote?: string }
}

/** Fichier image ou PDF préparé pour la conversion en LaTeX */
export interface ConvertSource {
  id: string
  name: string
  kind: 'image' | 'pdf'
  mime: string
  data: Uint8Array
}

export interface ConvertOptions {
  /** fragment : contenu à insérer dans le document ouvert ; document : fichier complet et compilable */
  mode: 'fragment' | 'document'
  notes: string
  /** Paquets chargés par le document (mode fragment) */
  packages?: string
  /** Ollama et PDF : pages rendues en PNG (base64) par l'interface, le modèle ne lisant que des images */
  pages?: string[]
}

export type ConvertEvent = { type: 'text'; text: string } | { type: 'tool'; name: string }

export interface FileEntry {
  /** Chemin relatif à la racine du projet, séparateur « / » */
  path: string
  isDir: boolean
}

export type Severity = 'error' | 'warning' | 'info'

export interface Diagnostic {
  severity: Severity
  message: string
  /** Chemin relatif au projet si le fichier est dans le projet */
  file?: string
  /** Nom brut tel que rapporté par TeX (pour les fichiers hors projet) */
  rawFile?: string
  line?: number
  context?: string
  kind?: 'badbox' | 'reference' | 'citation' | 'general'
  /** Extension qui l'a signalé (absent : compilation) */
  source?: string
  /** Position exacte dans le fichier (extensions), sinon la ligne entière */
  from?: number
  to?: number
}

export interface CompileResult {
  ok: boolean
  pdfPath: string | null
  diagnostics: Diagnostic[]
  log: string
  output: string
  durationMs: number
  error?: string
}

export interface SyncRect {
  x: number
  y: number
  w: number
  h: number
}

export interface SyncForwardResult {
  page: number
  rects: SyncRect[]
}

export interface SyncReverseResult {
  file: string
  line: number
}

/** Résultat du bouton « Rechercher une mise à jour » : version prête (ou disponible sur Mac), à jour ({}), échec, ou copie de développement */
export interface UpdateCheck {
  version?: string
  error?: boolean
  dev?: boolean
}

export interface TectonicStatus {
  found: boolean
  path?: string
  version?: string
  source?: 'custom' | 'bundled' | 'homebrew' | 'path'
}

/** Lean 4 + Mathlib (installés à la demande) */
export interface LeanStatus {
  ready: boolean
  /** « Lean 4.x · Mathlib 4.x » */
  version?: string
}

export interface LeanProgress {
  step: number
  of: number
  text: string
  detail?: string
  done?: boolean
  error?: boolean
}

/** Message de Lean sur un fichier (lignes à partir de 1, colonnes à partir de 0) */
export interface LeanDiag {
  severity: 'error' | 'warning' | 'info'
  line: number
  col: number
  endLine?: number
  endCol?: number
  message: string
}

export interface InstallProgress {
  phase: 'download' | 'extract' | 'done' | 'error'
  received?: number
  total?: number
  message?: string
}

export interface ContextMenuItem {
  id?: string
  label?: string
  type?: 'separator'
  enabled?: boolean
  accelerator?: string
}

export interface TemplateFile {
  path: string
  content: string
  /** Fichier binaire (image d'un modèle d'extension) : content en base64 */
  base64?: boolean
}

/** Extension (sans code), telle que l'app l'utilise : manifeste lumen-extension.json lu et vérifié */
export interface ExtensionInfo {
  id: string
  name: string
  version: string
  author: string
  description: string
  /** Version de Lumen TeX nécessaire ; compatible = false si celle-ci est plus ancienne (extension ignorée) */
  lumen: string
  compatible: boolean
  /** Bouts de LaTeX proposés par l'autocomplétion (gabarit au format CodeMirror) */
  snippets: { prefix: string; body: string; description: string }[]
  /** Environnements proposés après \begin{ */
  environments: { name: string; body: string; description: string }[]
  /** Groupes du panneau Σ. LaTeX : commandes (rendues par KaTeX) ; autre langage : « caractère nom » (inséré tel quel) */
  symbols: { name: string; items: string[]; language: string }[]
  /** Modèles de projet ; {{titre}} et {{auteur}} remplacés à la création */
  templates: { name: string; description: string; files: TemplateFile[] }[]
  /** Thèmes de couleurs : variables CSS du thème clair et/ou sombre */
  themes: { name: string; light: Record<string, string>; dark: Record<string, string> }[]
  /** Code (module JavaScript) : chargé dans la fenêtre si l'extension est vérifiée, isolé sinon ; vide = sans code */
  main: string
  /** Partie Node.js (processus séparé) : extensions vérifiées, ou mode développeur */
  node: string
  /** Ce que l'extension déclare utiliser (affiché à l'installation) */
  permissions: ExtensionPermissions
  /** Réglages de l'extension : formulaire affiché par Lumen TeX */
  settings: ExtensionSetting[]
  /** Langages (fichiers reconnus, pouvant être compilés par un compilateur d'extension) */
  languages: { id: string; name: string; extensions: string[]; icon: string }[]
  /** Icône SVG (data URL), vide = pièce de puzzle */
  icon: string
  /** verified : du catalogue et inchangée ; modified : changée depuis son installation ; unverified : depuis un dossier */
  trust: 'verified' | 'modified' | 'unverified'
  /** Dossier relié (mode développeur : installée sans copie), vide sinon */
  linked: string
}

export interface ExtensionPermissions {
  /** Sites joignables (domaines) ; une extension vérifiée n'est pas limitée */
  network: string[]
  microphone: boolean
  camera: boolean
  /** Échanges avec les autres participants d'une session */
  session: boolean
}

export interface ExtensionSetting {
  id: string
  label: string
  type: 'toggle' | 'text' | 'number' | 'select'
  options: string[]
  default: string | number | boolean
  description: string
}

/** Une version gardée dans l'historique d'un projet */
export interface HistoryVersion {
  id: string
  date: number
  /** Nom donné par l'utilisateur (« Version envoyée au directeur ») ; absent : version automatique */
  name?: string
  /** Automatique : éclaircie avec le temps ; nommée : gardée jusqu'à sa suppression */
  auto: boolean
  /** Fichier (relatif au projet) → empreinte de son contenu */
  files: Record<string, string>
}

/** Réponse d'une requête Internet faite pour une extension */
export interface ExtensionFetchResult {
  status: number
  headers: Record<string, string>
  body: Uint8Array
}

export interface SearchMatch {
  file: string
  line: number
  col: number
  text: string
}
