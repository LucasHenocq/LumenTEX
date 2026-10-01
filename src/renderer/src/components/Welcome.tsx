import { Clock, FilePlus2, FolderOpen, FileText, X } from 'lucide-react'
import { openFolderDialog, openProject, openTexFileDialog } from '../lib/actions'
import { store, useApp } from '../store'
import Logo from './Logo'
import TectonicSetup from './TectonicSetup'
import { kb } from '../lib/keys'

function timeAgo(ts: number): string {
  const d = (Date.now() - ts) / 1000
  if (d < 60) return 'à l’instant'
  if (d < 3600) return `il y a ${Math.floor(d / 60)} min`
  if (d < 86400) return `il y a ${Math.floor(d / 3600)} h`
  if (d < 86400 * 30) return `il y a ${Math.floor(d / 86400)} j`
  return new Date(ts).toLocaleDateString('fr-FR')
}

export default function Welcome(): React.JSX.Element {
  const recent = useApp((s) => s.settings.recentProjects)
  const tectonic = useApp((s) => s.tectonic)

  const remove = async (e: React.MouseEvent, p: string): Promise<void> => {
    e.stopPropagation()
    const settings = await window.api.removeRecent(p)
    store.set({ settings })
  }

  return (
    <div className="welcome">
      <div className="welcome-drag" />
      <div className="welcome-inner">
        <div className="welcome-hero">
          <Logo size={64} />
          <h1>Lumen TeX</h1>
          <p>Un éditeur LaTeX moderne, avec aperçu PDF en direct.</p>
        </div>

        {tectonic && !tectonic.found && <TectonicSetup />}

        <div className="welcome-actions">
          <button className="welcome-card primary" onClick={() => store.set({ modal: { type: 'new-project' } })}>
            <FilePlus2 size={22} />
            <span className="wc-title">Nouveau projet</span>
            <span className="wc-sub">À partir d’un modèle</span>
            <kbd>{kb('⇧⌘N')}</kbd>
          </button>
          <button className="welcome-card" onClick={() => void openFolderDialog()}>
            <FolderOpen size={22} />
            <span className="wc-title">Ouvrir un dossier</span>
            <span className="wc-sub">Projet existant</span>
            <kbd>{kb('⌘O')}</kbd>
          </button>
          <button className="welcome-card" onClick={() => void openTexFileDialog()}>
            <FileText size={22} />
            <span className="wc-title">Ouvrir un fichier</span>
            <span className="wc-sub">Document .tex</span>
            <kbd>{kb('⇧⌘O')}</kbd>
          </button>
        </div>

        {recent.length > 0 && (
          <div className="welcome-recent">
            <div className="section-label">
              <Clock size={13} /> Récents
            </div>
            <ul>
              {recent.map((r) => (
                <li key={r.path} onClick={() => void openProject(r.path)} title={r.path}>
                  <div className="recent-icon">{r.name.slice(0, 1).toUpperCase()}</div>
                  <div className="recent-text">
                    <span className="recent-name">{r.name}</span>
                    <span className="recent-path">{r.path.replace(/^\/Users\/[^/]+/, '~')}</span>
                  </div>
                  <span className="recent-time">{timeAgo(r.openedAt)}</span>
                  <button className="icon-btn subtle recent-remove" title="Retirer de la liste" onClick={(e) => void remove(e, r.path)}>
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="welcome-footer">
          Lumen TeX {__APP_VERSION__}
          {tectonic?.found && (
            <>
              {' '}
              · Moteur : Tectonic {tectonic.version} · <span className="muted">{tectonic.path}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
