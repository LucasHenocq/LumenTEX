import {
  ChevronDown,
  Download,
  Loader2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Play,
  Settings2,
  Square,
  Users,
  Zap
} from 'lucide-react'
import { useMemo } from 'react'
import { availableFor, canBeMain, compilerFor, languageOf } from '../lib/languages'
import { cancelCompile, compile, exportPdf, setMainFile } from '../lib/actions'
import { contents } from '../lib/projectIndex'
import { store, updateSettings, useApp } from '../store'
import { kb } from '../lib/keys'
import { presentCount } from './modals/CollabModal'

/** Partager le projet / session en cours (avec le nombre de personnes connectées) */
function CollabButton(): React.JSX.Element {
  const c = useApp((s) => s.collab)
  const on = c.active && !c.joining
  return (
    <button
      className={`icon-btn collab-btn${on ? ' toggled' : ''}`}
      title={on ? 'Session partagée' : 'Travailler à plusieurs'}
      onClick={() => store.set({ modal: { type: 'collab' } })}
    >
      <Users size={16} />
      {on && presentCount(c) > 0 && <span className="collab-count">{presentCount(c)}</span>}
    </button>
  )
}

export default function TitleBar(): React.JSX.Element {
  const projectName = useApp((s) => s.projectName)
  const mainFile = useApp((s) => s.mainFile)
  const status = useApp((s) => s.compileStatus)
  const auto = useApp((s) => s.settings.autoCompile)
  const sidebar = useApp((s) => s.settings.sidebarVisible)
  const pdfVisible = useApp((s) => s.settings.pdfVisible)
  const logOpen = useApp((s) => s.logOpen)
  const indexVersion = useApp((s) => s.indexVersion)
  const hasPdf = useApp((s) => !!s.pdf)

  const files = useApp((s) => s.files)
  useApp((s) => s.compilersVersion)
  // Fichiers principaux possibles : ceux qu'un compilateur sait compiler (LaTeX : avec \documentclass)
  const roots = useMemo(() => {
    void indexVersion
    return files
      .filter((f) => !f.isDir && canBeMain(f.path, contents.get(f.path)))
      .map((f) => f.path)
      .sort()
  }, [indexVersion, files])
  const mainLang = languageOf(mainFile)
  const compilers = mainLang ? availableFor(mainLang.id) : []
  const compiler = mainLang && compilerFor(mainLang.id)

  const chooseCompiler = async (): Promise<void> => {
    if (!mainLang) return
    const id = await window.api.popupMenu(compilers.map((c) => ({ id: c.id, label: (c === compiler ? '✓ ' : '    ') + c.name })))
    if (id) void updateSettings({ compilers: { ...store.get().settings.compilers, [mainLang.id]: id } })
  }

  const chooseMain = async (): Promise<void> => {
    const candidates = roots
    const id = await window.api.popupMenu(
      candidates.length
        ? candidates.map((f) => ({ id: f, label: (f === mainFile ? '✓ ' : '    ') + f }))
        : [{ label: 'Aucun document à compiler', enabled: false }]
    )
    if (id) void setMainFile(id)
  }

  const running = status === 'running'

  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <div className="project-title">
          <span className="project-name">{projectName}</span>
          <button className="main-file-btn" onClick={() => void chooseMain()} title="Fichier principal compilé">
            {mainFile ?? 'Choisir le fichier principal'}
            <ChevronDown size={13} />
          </button>
        </div>
      </div>

      <div className="titlebar-center">
        <div className={`compile-group status-${status}`}>
          <button
            className="compile-btn"
            onClick={() => (running ? void cancelCompile() : void compile())}
            title={kb(running ? 'Arrêter la compilation (⌘.)' : 'Compiler (⌘↵)')}
          >
            {running ? (
              <>
                <Loader2 size={15} className="spin" />
                <span>Compilation…</span>
                <Square size={11} className="stop-icon" fill="currentColor" />
              </>
            ) : (
              <>
                <Play size={14} fill="currentColor" />
                <span>Compiler</span>
              </>
            )}
          </button>
          <button
            className={`auto-btn${auto ? ' on' : ''}`}
            onClick={() => void updateSettings({ autoCompile: !auto })}
            title={auto ? 'Compilation automatique activée' : 'Compilation automatique désactivée'}
          >
            <Zap size={14} fill={auto ? 'currentColor' : 'none'} />
            <span>Live</span>
          </button>
          {/* Plusieurs compilateurs disponibles pour ce langage : choix */}
          {compilers.length > 1 && compiler && (
            <button className="compiler-btn" onClick={() => void chooseCompiler()} title="Compilateur">
              <span>{compiler.name}</span>
              <ChevronDown size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="titlebar-right">
        <CollabButton />
        <button className="icon-btn" title={kb('Exporter en PDF (⌘E)')} disabled={!hasPdf} onClick={() => void exportPdf()}>
          <Download size={16} />
        </button>
        <div className="tb-sep" />
        <button
          className={`icon-btn${sidebar ? ' toggled' : ''}`}
          title={kb('Barre latérale (⌥⌘B)')}
          onClick={() => void updateSettings({ sidebarVisible: !sidebar })}
        >
          <PanelLeft size={16} />
        </button>
        <button className={`icon-btn${logOpen ? ' toggled' : ''}`} title={kb('Journal et erreurs (⌘J)')} onClick={() => store.set({ logOpen: !logOpen })}>
          <PanelBottom size={16} />
        </button>
        <button
          className={`icon-btn${pdfVisible ? ' toggled' : ''}`}
          title={kb('Aperçu PDF (⇧⌘V)')}
          onClick={() => void updateSettings({ pdfVisible: !pdfVisible })}
        >
          <PanelRight size={16} />
        </button>
        <div className="tb-sep" />
        <button className="icon-btn" title={kb('Réglages (⌘,)')} onClick={() => store.set({ modal: { type: 'settings' } })}>
          <Settings2 size={16} />
        </button>
      </div>
    </header>
  )
}
