import { AlertTriangle, CheckCircle2, Download } from 'lucide-react'
import { leanInstalled } from '../lib/lean'
import { store, toast, useApp } from '../store'

/** Installation de Lean et Mathlib (à la demande : plusieurs Go) */
export default function LeanSetup(): React.JSX.Element {
  const progress = useApp((s) => s.lean.install)
  const busy = !!progress && !progress.done && !progress.error

  const install = async (): Promise<void> => {
    store.set((s) => ({ lean: { ...s.lean, install: { step: 0, of: 4, text: 'Préparation…' } } }))
    try {
      const status = await window.api.installLean()
      store.set((s) => ({ lean: { ...s.lean, status } }))
      leanInstalled()
      toast(`${status.version} installés : les preuves peuvent être vérifiées`, 'success', undefined, 6000)
    } catch {
      // Message affiché dans la carte (dernière étape en erreur)
    }
  }

  return (
    <div className="tectonic-card">
      <div className="tc-icon">{progress?.done ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}</div>
      <div className="tc-body">
        <div className="tc-title">Lean n’est pas installé</div>
        <div className="tc-text">
          <strong>Lean</strong> vérifie les démonstrations mathématiques, avec <strong>Mathlib</strong>, sa bibliothèque de mathématiques.
          L’installation occupe environ 10 Go et prend de 5 minutes à une demi-heure selon la connexion. Elle ne se fait qu’une fois.
        </div>
        {busy && (
          <div className="tc-progress lean-progress">
            <div className="progress">
              <div className="progress-bar" style={{ width: `${Math.max(4, ((progress.step - 0.5) / progress.of) * 100)}%` }} />
            </div>
            <span>
              Étape {Math.max(1, progress.step)}/{progress.of} · {progress.text}
            </span>
            {progress.detail && <span className="lean-progress-detail">{progress.detail}</span>}
          </div>
        )}
        {progress?.error && <div className="lean-error">⚠ L’installation n’a pas abouti : {progress.text}</div>}
        <div className="tc-actions">
          <button className="btn primary" disabled={busy} onClick={() => void install()}>
            <Download size={15} /> {busy ? 'Installation…' : progress?.error ? 'Réessayer' : 'Installer Lean et Mathlib'}
          </button>
        </div>
      </div>
    </div>
  )
}
