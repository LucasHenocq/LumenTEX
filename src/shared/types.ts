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
}

export interface RecentProject {
  path: string
  name: string
  openedAt: number
}

export interface Settings {
  theme: ThemeMode
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
  /** Notifications Windows des messages quand Lumen TeX est en arrière-plan */
  collabNotify: boolean
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

export interface TectonicStatus {
  found: boolean
  path?: string
  version?: string
  source?: 'custom' | 'bundled' | 'homebrew' | 'path'
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
}

export interface SearchMatch {
  file: string
  line: number
  col: number
  text: string
}
