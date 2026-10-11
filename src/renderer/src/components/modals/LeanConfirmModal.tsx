import { CheckCircle2, CircleX, FileCode2 } from 'lucide-react'
import { useEffect } from 'react'
import type { LeanStep } from '../../lib/leanSteps'
import { inline, linesWithMath } from '../Copilot'
import { closeModal, ModalFrame } from '../Modals'

/** Mise en forme simple du texte LaTeX hors formules (les formules sont rendues par KaTeX) */
const plainTex = (s: string): string =>
  s
    .replace(/\\(emph|textbf|textit|text|mathrm)\{([^{}]*)\}/g, '$2')
    .replace(/~/g, ' ')
    .replace(/\\\\\s*/g, '\n')

const tex = (s: string): React.ReactNode => linesWithMath(plainTex(s), (l, i) => <div key={i}>{l ? inline(l) : ' '}</div>)

/**
 * Fin d'une vérification par l'IA. Acceptée par Lean : l'utilisateur vérifie que l'énoncé (et les étapes) Lean sont
 * bien les siens. Refusée (refused) : étapes de la preuve LaTeX que Lean n'a pas pu valider
 */
export default function LeanConfirmModal(props: {
  env: string
  title: string
  statement: string
  lean: string
  explanation: string
  steps?: LeanStep[]
  refused?: boolean
  resolve: (ok: boolean) => void
}): React.JSX.Element {
  // Fermée autrement (Échap, clic à côté) : non validée
  useEffect(() => () => props.resolve(false), [])
  const answer = (ok: boolean): void => {
    props.resolve(ok)
    closeModal()
  }
  const bad = props.steps?.filter((s) => s.problem) ?? []
  return (
    <ModalFrame
      title={
        props.refused
          ? `La preuve ne passe pas ${bad.length > 1 ? `aux étapes ${bad.map((s) => s.n).join(', ')}` : `à l’étape ${bad[0]?.n ?? '?'}`}`
          : props.steps
            ? 'Lean a validé la preuve, étape par étape'
            : 'Lean a validé l’énoncé'
      }
      width={680}
      className="lean-confirm-modal"
      footer={
        props.refused ? (
          <>
            <button className="btn" onClick={() => answer(true)}>
              <FileCode2 size={14} /> Voir le fichier Lean
            </button>
            <button className="btn primary" onClick={() => answer(false)}>
              Fermer
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => answer(false)}>
              Non, à revoir
            </button>
            <button className="btn primary" onClick={() => answer(true)}>
              <CheckCircle2 size={14} /> {props.steps ? 'Oui, ce sont mon énoncé et mes étapes' : 'Oui, c’est mon énoncé'}
            </button>
          </>
        )
      }
    >
      <p className="lean-confirm-intro">
        {props.refused
          ? 'Lean n’a pas pu valider tout le raisonnement : l’étape en rouge est fausse, ou ne découle pas des précédentes. Les autres étapes sont justes.'
          : props.steps
            ? 'Lean a vérifié chaque étape de votre preuve. Vérifiez que l’énoncé et les étapes en Lean disent bien la même chose que les vôtres.'
            : 'Seul l’énoncé a été vérifié (l’IA a pu le prouver à sa façon). Vérifiez que l’énoncé Lean est bien le même que le vôtre.'}
      </p>
      <div className="lean-confirm-label">
        Votre énoncé · {props.env}
        {props.title ? ` (${props.title})` : ''}
      </div>
      <div className="lean-confirm-tex">{tex(props.statement)}</div>
      <div className="lean-confirm-label">Énoncé en Lean</div>
      <pre className="lean-goal">{props.lean}</pre>
      {props.steps && (
        <>
          <div className="lean-confirm-label">Étapes de la preuve</div>
          <ol className="lean-steps">
            {props.steps.map((s) => (
              <li key={s.n} className={s.problem ? 'bad' : 'good'}>
                <span className="lean-step-icon">{s.problem ? <CircleX size={15} /> : <CheckCircle2 size={15} />}</span>
                <div className="lean-step-body">
                  <div className="lean-step-quote">
                    <strong>Étape {s.n}</strong> · {tex(s.quote)}
                  </div>
                  {s.claim && <pre className="lean-step-claim">{s.claim}</pre>}
                  {s.problem && <div className="lean-step-problem">{tex(s.problem)}</div>}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      {props.explanation && (
        <>
          <div className="lean-confirm-label">Selon l’IA</div>
          <div className="lean-confirm-tex">{linesWithMath(props.explanation, (l, i) => <div key={i}>{l ? inline(l) : ' '}</div>)}</div>
        </>
      )}
    </ModalFrame>
  )
}
