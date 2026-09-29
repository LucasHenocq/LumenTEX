import { store, updateSettings } from '../store'
import {
  cancelCompile,
  cleanBuild,
  closeProject,
  closeTab,
  compile,
  editorCommand,
  exportPdf,
  insertBlock,
  insertFigure,
  openFile,
  openFolderDialog,
  openPdfExternal,
  openTexFileDialog,
  saveAll,
  saveFile,
  syncForward
} from './actions'
import { emit } from './bus'
import { getView } from '../editor/setup'

export interface Command {
  id: string
  label: string
  shortcut?: string
  needsProject?: boolean
  run: () => void | Promise<void>
}

const s = () => store.get()

function nextError(): void {
  const diags = s().diagnostics.filter((d) => d.severity === 'error' && d.file && d.line)
  if (!diags.length) {
    const any = s().diagnostics.find((d) => d.file && d.line)
    if (!any) return
    void openFile(any.file!, { line: any.line })
    return
  }
  const { active, cursor } = s()
  const after = diags.find((d) => d.file === active && d.line! > cursor.line) ?? diags.find((d) => d.file !== active) ?? diags[0]
  void openFile(after.file!, { line: after.line })
}

export const COMMAND_LIST: Command[] = [
  { id: 'compile', label: 'Compiler le document', shortcut: '⌘↵', needsProject: true, run: () => compile() },
  { id: 'cancel-compile', label: 'Arrêter la compilation', shortcut: '⌘.', needsProject: true, run: () => cancelCompile() },
  {
    id: 'toggle-autocompile',
    label: 'Activer/désactiver la compilation automatique',
    run: () => updateSettings({ autoCompile: !s().settings.autoCompile })
  },
  { id: 'sync-forward', label: 'Afficher la position du curseur dans le PDF', shortcut: '⌥⌘J', needsProject: true, run: () => syncForward() },
  { id: 'export-pdf', label: 'Exporter en PDF…', shortcut: '⌘E', needsProject: true, run: () => exportPdf() },
  { id: 'open-pdf-external', label: window.api.platform === 'darwin' ? 'Ouvrir le PDF dans Aperçu' : 'Ouvrir le PDF dans le lecteur par défaut', needsProject: true, run: () => openPdfExternal() },
  { id: 'new-project', label: 'Nouveau projet…', shortcut: '⇧⌘N', run: () => store.set({ modal: { type: 'new-project' } }) },
  {
    id: 'new-file',
    label: 'Nouveau fichier',
    shortcut: '⌘N',
    needsProject: true,
    run: () => {
      store.set({ panel: 'files' })
      if (!s().settings.sidebarVisible) void updateSettings({ sidebarVisible: true })
      emit('editor:command', 'tree:new-file')
    }
  },
  { id: 'open-folder', label: 'Ouvrir un dossier…', shortcut: '⌘O', run: () => openFolderDialog() },
  { id: 'open-file', label: 'Ouvrir un fichier .tex…', shortcut: '⇧⌘O', run: () => openTexFileDialog() },
  { id: 'save', label: 'Enregistrer', shortcut: '⌘S', needsProject: true, run: () => saveCurrent() },
  { id: 'save-all', label: 'Tout enregistrer', shortcut: '⌥⌘S', needsProject: true, run: () => saveAll() },
  {
    id: 'close-tab',
    label: 'Fermer l’onglet',
    shortcut: '⌘W',
    run: () => {
      const a = s().active
      if (a) void closeTab(a)
      else if (s().modal) store.set({ modal: null })
    }
  },
  { id: 'close-project', label: 'Fermer le projet', needsProject: true, run: () => closeProject() },
  { id: 'find', label: 'Rechercher dans le fichier', shortcut: '⌘F', needsProject: true, run: () => editorCommand('find') },
  { id: 'search-project', label: 'Rechercher dans le projet', shortcut: '⇧⌘F', needsProject: true, run: () => showPanel('search') },
  { id: 'bold', label: 'Gras', shortcut: '⌘B', needsProject: true, run: () => editorCommand('bold') },
  { id: 'italic', label: 'Italique', shortcut: '⌘I', needsProject: true, run: () => editorCommand('italic') },
  { id: 'toggle-comment', label: 'Commenter / décommenter', shortcut: '⌘/', needsProject: true, run: () => editorCommand('toggle-comment') },
  { id: 'insert-table', label: 'Insérer un tableau…', shortcut: '⌥⌘T', needsProject: true, run: () => store.set({ modal: { type: 'table' } }) },
  { id: 'insert-matrix', label: 'Insérer une matrice…', shortcut: '⌥⌘M', needsProject: true, run: () => store.set({ modal: { type: 'table', matrix: true } }) },
  { id: 'insert-figure', label: 'Insérer une figure…', shortcut: '⌥⌘F', needsProject: true, run: () => insertFigure() },
  {
    id: 'convert-to-latex',
    label: 'Convertir une image ou un PDF en LaTeX…',
    shortcut: '⌥⌘L',
    needsProject: true,
    run: () => store.set({ modal: { type: 'convert' } })
  },
  {
    id: 'insert-equation',
    label: 'Insérer une équation',
    shortcut: '⌥⌘E',
    needsProject: true,
    run: () => insertBlock('\\begin{equation}\n\t${}\n\t\\label{eq:${clé}}\n\\end{equation}\n')
  },
  { id: 'insert-itemize', label: 'Insérer une liste à puces', needsProject: true, run: () => insertBlock('\\begin{itemize}\n\t\\item ${}\n\\end{itemize}\n') },
  { id: 'insert-enumerate', label: 'Insérer une liste numérotée', needsProject: true, run: () => insertBlock('\\begin{enumerate}\n\t\\item ${}\n\\end{enumerate}\n') },
  { id: 'show-symbols', label: 'Palette de symboles', shortcut: '⌥⌘Y', needsProject: true, run: () => showPanel('symbols') },
  { id: 'toggle-log', label: 'Afficher/masquer le journal et les erreurs', shortcut: '⌘J', needsProject: true, run: () => store.set({ logOpen: !s().logOpen }) },
  { id: 'next-error', label: 'Aller à l’erreur suivante', shortcut: 'F8', needsProject: true, run: nextError },
  { id: 'clean-build', label: 'Nettoyer les fichiers de compilation', needsProject: true, run: () => cleanBuild() },
  { id: 'command-palette', label: 'Palette de commandes', shortcut: '⇧⌘P', run: () => store.set({ modal: { type: 'palette', mode: 'commands' } }) },
  { id: 'quick-open', label: 'Ouverture rapide d’un fichier', shortcut: '⌘P', needsProject: true, run: () => store.set({ modal: { type: 'palette', mode: 'files' } }) },
  { id: 'toggle-sidebar', label: 'Afficher/masquer la barre latérale', shortcut: '⌥⌘B', run: () => updateSettings({ sidebarVisible: !s().settings.sidebarVisible }) },
  { id: 'toggle-pdf', label: 'Afficher/masquer l’aperçu PDF', shortcut: '⇧⌘V', run: () => updateSettings({ pdfVisible: !s().settings.pdfVisible }) },
  { id: 'panel-files', label: 'Panneau : fichiers', shortcut: '⌘1', run: () => showPanel('files') },
  { id: 'panel-outline', label: 'Panneau : plan du document', shortcut: '⌘2', run: () => showPanel('outline') },
  { id: 'panel-symbols', label: 'Panneau : symboles', shortcut: '⌘3', run: () => showPanel('symbols') },
  { id: 'panel-search', label: 'Panneau : recherche', shortcut: '⌘4', run: () => showPanel('search') },
  { id: 'font-bigger', label: 'Agrandir le texte de l’éditeur', shortcut: '⌘=', run: () => updateSettings({ editorFontSize: Math.min(28, s().settings.editorFontSize + 1) }) },
  { id: 'font-smaller', label: 'Réduire le texte de l’éditeur', shortcut: '⌘−', run: () => updateSettings({ editorFontSize: Math.max(9, s().settings.editorFontSize - 1) }) },
  { id: 'pdf-zoom-in', label: 'PDF : zoom avant', shortcut: '⇧⌘=', run: () => emit('pdf:command', 'zoom-in') },
  { id: 'pdf-zoom-out', label: 'PDF : zoom arrière', shortcut: '⇧⌘−', run: () => emit('pdf:command', 'zoom-out') },
  { id: 'pdf-fit', label: 'PDF : pleine largeur', shortcut: '⌘0', run: () => emit('pdf:command', 'fit-width') },
  { id: 'pdf-dark', label: 'PDF : mode sombre', run: () => updateSettings({ pdfDarkMode: !s().settings.pdfDarkMode }) },
  { id: 'toggle-vim', label: 'Activer/désactiver le mode Vim', run: () => updateSettings({ vimMode: !s().settings.vimMode }) },
  { id: 'toggle-wrap', label: 'Activer/désactiver le retour à la ligne', run: () => updateSettings({ lineWrapping: !s().settings.lineWrapping }) },
  {
    id: 'theme',
    label: 'Basculer le thème clair/sombre',
    run: () => updateSettings({ theme: s().resolvedDark ? 'light' : 'dark' })
  },
  { id: 'settings', label: 'Réglages…', shortcut: '⌘,', run: () => store.set({ modal: { type: 'settings' } }) },
  { id: 'shortcuts', label: 'Raccourcis clavier', run: () => store.set({ modal: { type: 'shortcuts' } }) }
]

function showPanel(panel: 'files' | 'outline' | 'symbols' | 'search'): void {
  store.set({ panel })
  if (!s().settings.sidebarVisible) void updateSettings({ sidebarVisible: true })
  if (panel === 'search') setTimeout(() => document.querySelector<HTMLInputElement>('.search-input')?.focus(), 30)
}

async function saveCurrent(): Promise<void> {
  const a = s().active
  if (!a) return
  await saveFile(a)
  if (s().settings.compileOnSave && !s().settings.autoCompile) void compile()
}

export function runCommand(id: string): void {
  const c = COMMAND_LIST.find((c) => c.id === id)
  if (!c) return
  if (c.needsProject && !s().root) return
  // Ne pas intercepter la saisie dans les champs de texte pour les commandes d'édition
  void c.run()
  if (['bold', 'italic', 'toggle-comment'].includes(id)) getView()?.focus()
}
