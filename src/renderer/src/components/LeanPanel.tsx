import { CheckCircle2, CircleAlert, FileText, LoaderCircle, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { applyLeanLint } from '../lib/lean'
import { openFile } from '../lib/actions'
import { emit } from '../lib/bus'
import { loadProofs, proofOfLeanFile, updateMarkFromLean } from '../lib/proofs'
import { useApp } from '../store'
import LeanSetup from './LeanSetup'

const SORRY = /declaration uses ['`]sorry['`]/

/** À la place de l'aperçu PDF pour un fichier .lean : état de la vérification, buts au curseur, messages de Lean */
export default function LeanPanel({ path }: { path: string }): React.JSX.Element {
  const ready = useApp((s) => s.lean.status.ready)
  const diags = useApp((s) => s.lean.diags[path])
  const busy = useApp((s) => !!s.lean.busy[path])
  const goals = useApp((s) => s.lean.goals)

  useEffect(() => applyLeanLint(), [path, diags])
  // Fichier de preuve ouvert en premier (avant tout document LaTeX) : vérifications à lire pour le relier à sa preuve
  const [, setLoaded] = useState(0)
  useEffect(() => void loadProofs().then(() => setLoaded((n) => n + 1)), [path])

  if (!ready)
    return (
      <div className="lean-pane">
        <div className="pdf-toolbar lean-bar">
          <span className="lean-title">Lean</span>
        </div>
        <div className="lean-body">
          <LeanSetup />
        </div>
      </div>
    )

  const list = diags ?? []
  const errors = list.filter((d) => d.severity === 'error').length
  const sorry = list.some((d) => SORRY.test(d.message))
  const proof = path.startsWith('.lumentex/lean/') ? proofOfLeanFile(path) : null

  return (
    <div className="lean-pane">
      <div className="pdf-toolbar lean-bar">
        <span className="lean-title">Lean</span>
        <span className={`lean-state${busy || !diags ? '' : errors ? ' bad' : sorry ? ' warn' : ' good'}`}>
          {busy || !diags ? (
            <>
              <LoaderCircle size={13} className="spin" /> Vérification…
            </>
          ) : errors ? (
            <>
              <CircleAlert size={13} /> {errors} erreur{errors > 1 ? 's' : ''}
            </>
          ) : sorry ? (
            <>
              <CircleAlert size={13} /> Preuve incomplète (sorry)
            </>
          ) : (
            <>
              <CheckCircle2 size={13} /> Aucune erreur
            </>
          )}
        </span>
      </div>
      {proof && (
        <div className="lean-proof">
          <button className="link-btn" title="Revenir à la preuve LaTeX" onClick={() => void openFile(proof.file)}>
            <FileText size={12} /> Preuve de {proof.proof?.title || proof.proof?.env || 'l’énoncé'} · {proof.file}
          </button>
          <button className="btn small" disabled={busy || !diags} onClick={() => void updateMarkFromLean(path)}>
            Mettre à jour la coche
          </button>
        </div>
      )}
      <div className="lean-body">
        <div className="lean-section">Buts</div>
        {goals === null ? (
          <div className="lean-muted">Placez le curseur dans une preuve pour voir ce qu’il reste à démontrer.</div>
        ) : goals.length === 0 ? (
          <div className="lean-muted">Aucun but à cet endroit : tout est démontré ✓</div>
        ) : (
          goals.map((g, i) => (
            <pre key={i} className="lean-goal">
              {g}
            </pre>
          ))
        )}
        <div className="lean-section">
          Messages
          {errors > 0 && (
            <button className="link-btn" onClick={() => emit('copilot:ask', `Corrige les erreurs Lean du fichier ${path}.`)}>
              <Sparkles size={11} /> Corriger avec l’IA
            </button>
          )}
        </div>
        {list.length === 0 && <div className="lean-muted">{diags ? 'Aucun message.' : 'Lean lit le fichier…'}</div>}
        {list.map((d, i) => (
          <button key={i} className={`lean-msg ${d.severity}`} onClick={() => emit('editor:goto', { file: path, line: d.line, col: d.col })}>
            <span className="lean-msg-line">ligne {d.line}</span>
            <pre>{d.message}</pre>
          </button>
        ))}
      </div>
    </div>
  )
}
