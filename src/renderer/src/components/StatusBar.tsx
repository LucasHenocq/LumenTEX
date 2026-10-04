import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2, Lock } from 'lucide-react'
import { store, useApp } from '../store'
import { kb } from '../lib/keys'
import { collabMessage } from './modals/CollabModal'
import { useUnreadChat } from './ActivityBar'
import { canWrite, openChat } from '../lib/collab'

/** macOS : téléchargement de la mise à jour */
function UpdateProgress(): React.JSX.Element | null {
  const p = useApp((s) => s.updateProgress)
  return p === null ? null : <span className="sb-item">Mise à jour : {p} %</span>
}

/** Session partagée : fichier affiché non modifiable */
function ReadOnly(): React.JSX.Element | null {
  const active = useApp((s) => s.active)
  useApp((s) => s.collab.rules)
  return active && !canWrite(active) ? (
    <span className="sb-item" title="Le chef de session ne permet pas de modifier ce fichier">
      <Lock size={12} /> Lecture seule
    </span>
  ) : null
}

/** Session partagée : pastille cliquable (connectés, recherche, hors ligne) */
function CollabIndicator(): React.JSX.Element | null {
  const c = useApp((s) => s.collab)
  const unread = useUnreadChat()
  if (!c.active || c.joining) return null
  const m = collabMessage(c)
  const label = m.tone === 'warn' ? (c.net.state === 'network' ? 'Hors ligne · fusion au retour' : 'Partage indisponible') : m.tone === 'ok' ? m.title : 'Partagé'
  return (
    <button className={`sb-btn sb-collab ${m.tone}`} title={m.title} onClick={() => store.set({ modal: { type: 'collab' } })}>
      <span className={`collab-dot ${m.tone}`} /> {label}
      {unread > 0 && (
        <span
          className="sb-chat-unread"
          title="Messages non lus"
          onClick={(e) => {
            e.stopPropagation()
            openChat()
          }}
        >
          · 💬 {unread}
        </span>
      )}
    </button>
  )
}

export default function StatusBar(): React.JSX.Element {
  const status = useApp((s) => s.compileStatus)
  const progress = useApp((s) => s.compileProgress)
  const result = useApp((s) => s.result)
  const diagnostics = useApp((s) => s.diagnostics)
  const cursor = useApp((s) => s.cursor)
  const words = useApp((s) => s.wordCount)
  const active = useApp((s) => s.active)
  const tectonic = useApp((s) => s.tectonic)
  const vim = useApp((s) => s.settings.vimMode)
  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length
  const badboxes = diagnostics.filter((d) => d.kind === 'badbox').length

  const openLog = (): void => store.set({ logOpen: !store.get().logOpen })

  let statusEl: React.JSX.Element
  if (status === 'running') {
    statusEl = (
      <span className="sb-status running">
        <Loader2 size={13} className="spin" /> {progress || 'Compilation…'}
      </span>
    )
  } else if (status === 'idle') {
    statusEl = <span className="sb-status">Prêt</span>
  } else {
    const secs = result ? (result.durationMs / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : ''
    statusEl = (
      <span className={`sb-status ${status}`}>
        {status === 'success' && <CheckCircle2 size={13} />}
        {status === 'warning' && <CheckCircle2 size={13} />}
        {status === 'error' && <AlertCircle size={13} />}
        {status === 'error' ? (result?.pdfPath ? 'Compilé avec erreurs' : 'Échec de la compilation') : 'Compilé'}
        {secs && <span className="muted"> · {secs} s</span>}
      </span>
    )
  }

  const kind = active?.split('.').pop()?.toLowerCase()
  const lang = kind === 'tex' ? 'LaTeX' : kind === 'bib' ? 'BibTeX' : kind === 'sty' || kind === 'cls' ? 'LaTeX (paquet)' : kind?.toUpperCase()

  return (
    <footer className="statusbar">
      <div className="sb-left">
        <button className="sb-btn" onClick={openLog} title={kb('Journal et erreurs (⌘J)')}>
          {statusEl}
        </button>
        <button className="sb-btn" onClick={openLog} title="Problèmes">
          <span className={`sb-count${errors ? ' err' : ''}`}>
            <AlertCircle size={13} /> {errors}
          </span>
          <span className={`sb-count${warnings ? ' warn' : ''}`}>
            <AlertTriangle size={13} /> {warnings}
          </span>
          {badboxes > 0 && (
            <span className="sb-count">
              <Info size={13} /> {badboxes}
            </span>
          )}
        </button>
      </div>
      <div className="sb-right">
        <ReadOnly />
        <UpdateProgress />
        <CollabIndicator />
        {vim && <span className="sb-item sb-vim">VIM</span>}
        {active && (
          <>
            <span className="sb-item">
              Ln {cursor.line}, Col {cursor.col}
              {cursor.sel > 0 && ` (${cursor.sel} sél.)`}
            </span>
            {kind === 'tex' && <span className="sb-item">{words.toLocaleString('fr-FR')} mots</span>}
            <span className="sb-item">{lang}</span>
            <span className="sb-item">UTF-8</span>
          </>
        )}
        {tectonic?.found && <span className="sb-item muted">Tectonic {tectonic.version}</span>}
      </div>
    </footer>
  )
}
