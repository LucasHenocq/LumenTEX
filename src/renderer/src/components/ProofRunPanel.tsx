import { AlertTriangle, CheckCircle2, CircleX, FileCode2, LoaderCircle, Square, X } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { openFile } from '../lib/actions'
import { cancelProofRun, closeProofRun } from '../lib/proofs'
import { store, useApp, type LeanVerdict } from '../store'
import { inline, linesWithMath } from './Copilot'

/** Mise en forme simple du texte LaTeX hors formules (les formules sont rendues par KaTeX) */
const plainTex = (s: string): string =>
  s
    .replace(/\\(emph|textbf|textit|text|mathrm)\{([^{}]*)\}/g, '$2')
    .replace(/~/g, ' ')
    .replace(/\\\\\s*/g, '\n')

const tex = (s: string): React.ReactNode => linesWithMath(plainTex(s), (l, i) => <div key={i}>{l ? inline(l) : ' '}</div>)

/** Réponse de l'IA : texte (formules rendues), outils utilisés en petit, fichier Lean replié */
function AiText({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {text.split(/```([a-zA-Z0-9]*)\n?/).map((part, i, parts) => {
        if (i % 3 === 1) return null
        if (i % 3 === 2)
          return (
            <details key={i} className="proofrun-code">
              <summary>Fichier {parts[i - 1] || 'Lean'} ({part.split('\n').length} lignes)</summary>
              <pre>{part.replace(/\n$/, '')}</pre>
            </details>
          )
        return (
          <Fragment key={i}>
            {part
              .split('\n')
              .reduce<string[][]>((acc, l) => {
                // Paragraphes, et lignes d'outils (« 🔧 Read… ») à part
                const tool = l.startsWith('🔧')
                const last = acc[acc.length - 1]
                if (tool) acc.push([l], [])
                else if (last) last.push(l)
                else acc.push([l])
                return acc
              }, [])
              .map((block, k) =>
                block[0]?.startsWith('🔧') ? (
                  <div key={k} className="proofrun-tool">
                    {block[0].replace(/^🔧\s*|…$/g, '')}
                  </div>
                ) : block.join('\n').trim() ? (
                  <div key={k} className="proofrun-text">
                    {linesWithMath(block.join('\n').trim(), (l, j) => <div key={j}>{l ? inline(l) : ' '}</div>)}
                  </div>
                ) : null
              )}
          </Fragment>
        )
      })}
    </>
  )
}

/** Énoncé, étapes et boutons de fin (acceptée : valider ou non ; refusée : voir le Lean) */
function Verdict({ v }: { v: LeanVerdict }): React.JSX.Element {
  const bad = v.steps?.filter((s) => s.problem) ?? []
  return (
    <div className="proofrun-verdict">
      <div className={`proofrun-verdict-title ${v.refused ? 'bad' : 'good'}`}>
        {v.refused ? <CircleX size={16} /> : <CheckCircle2 size={16} />}
        {v.refused
          ? `La preuve ne passe pas ${bad.length > 1 ? `aux étapes ${bad.map((s) => s.n).join(', ')}` : `à l’étape ${bad[0]?.n ?? '?'}`}`
          : v.steps
            ? 'Lean a validé la preuve, étape par étape'
            : 'Lean a validé l’énoncé'}
      </div>
      <p className="lean-confirm-intro">
        {v.refused
          ? 'Lean n’a pas pu valider tout le raisonnement : l’étape en rouge est fausse, ou ne découle pas des précédentes. Les autres étapes sont justes.'
          : v.steps
            ? 'Lean a vérifié chaque étape de votre preuve. Vérifiez que l’énoncé et les étapes en Lean disent bien la même chose que les vôtres.'
            : 'Seul l’énoncé a été vérifié (l’IA a pu le prouver à sa façon). Vérifiez que l’énoncé Lean est bien le même que le vôtre.'}
      </p>
      <div className="lean-confirm-label">
        Votre énoncé · {v.env}
        {v.title ? ` (${v.title})` : ''}
      </div>
      <div className="lean-confirm-tex">{tex(v.statement)}</div>
      <div className="lean-confirm-label">Énoncé en Lean</div>
      <pre className="lean-goal">{v.lean}</pre>
      {v.steps && (
        <>
          <div className="lean-confirm-label">Étapes de la preuve</div>
          <ol className="lean-steps">
            {v.steps.map((s) => (
              <li key={s.n} className={s.problem ? 'bad' : s.unused ? 'warn' : 'good'}>
                <span className="lean-step-icon">
                  {s.problem ? <CircleX size={15} /> : s.unused ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
                </span>
                <div className="lean-step-body">
                  <div className="lean-step-quote">
                    <strong>Étape {s.n}</strong> · {tex(s.quote)}
                  </div>
                  {s.claim && <pre className="lean-step-claim">{s.claim}</pre>}
                  {s.problem && <div className="lean-step-problem">{tex(s.problem)}</div>}
                  {s.unused && !s.problem && (
                    <div className="lean-step-unused">
                      Lean a conclu sans utiliser cette étape : la preuve Lean prend un autre chemin que la vôtre. Vérifiez qu’elle suit bien votre
                      raisonnement.
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      {v.explanation && (
        <>
          <div className="lean-confirm-label">Selon l’IA</div>
          <div className="lean-confirm-tex">
            <AiText text={v.explanation} />
          </div>
        </>
      )}
      <div className="proofrun-actions">
        {v.refused ? (
          <>
            <button className="btn" onClick={() => v.resolve(true)}>
              <FileCode2 size={14} /> Voir le fichier Lean
            </button>
            <button className="btn primary" onClick={() => v.resolve(false)}>
              Fermer
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => v.resolve(false)}>
              Non, à revoir
            </button>
            <button className="btn primary" onClick={() => v.resolve(true)}>
              <CheckCircle2 size={14} /> {v.steps ? 'Oui, ce sont mon énoncé et mes étapes' : 'Oui, c’est mon énoncé'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/** Position de la fenêtre, conservée quand elle est fermée puis rouverte */
let position: { x: number; y: number } | null = null

/** Première ouverture : au milieu de l'écran (taille par défaut : 580 × 640, ou moins sur un petit écran) */
const centered = (): React.CSSProperties => {
  const h = Math.min(640, window.innerHeight - 120)
  return { left: Math.max(8, (window.innerWidth - 580) / 2), top: Math.max(8, (window.innerHeight - h) / 2) }
}

/** Fenêtre flottante d'une vérification par l'IA : déplaçable, redimensionnable, fermée sans arrêter la vérification */
export default function ProofRunPanel(): React.JSX.Element | null {
  const run = useApp((s) => s.proofRun)
  const [pos, setPos] = useState(position)
  const body = useRef<HTMLDivElement>(null)
  const follow = useRef(true)

  // Suit la fin du texte, sauf si l'utilisateur est remonté le lire
  useEffect(() => {
    const el = body.current
    if (el && follow.current) el.scrollTop = el.scrollHeight
  }, [run?.rounds, run?.verdict, run?.failure])

  if (!run?.open) return null

  const onDrag = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest('button')) return
    const panel = (e.currentTarget as HTMLElement).parentElement!
    const r = panel.getBoundingClientRect()
    const dx = e.clientX - r.left
    const dy = e.clientY - r.top
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent): void => {
      const p = {
        x: Math.min(window.innerWidth - 80, Math.max(0, ev.clientX - dx)),
        y: Math.min(window.innerHeight - 40, Math.max(0, ev.clientY - dy))
      }
      position = p
      setPos(p)
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  return (
    <div className="proofrun" style={pos ? { left: pos.x, top: pos.y } : centered()}>
      <div className="proofrun-head" onPointerDown={onDrag}>
        {run.done ? null : <LoaderCircle size={14} className="spin" />}
        <div className="proofrun-title">
          <strong>Vérification Lean</strong>
          <span>{run.title}</span>
        </div>
        {!run.done && (
          <button className="btn small" title="Arrêter la vérification" onClick={() => void cancelProofRun()}>
            <Square size={10} fill="currentColor" /> Arrêter
          </button>
        )}
        <button
          className="icon-btn subtle"
          title={run.done ? 'Fermer' : 'Masquer (la vérification continue ; cliquez sur « … » dans la marge pour rouvrir)'}
          onClick={() => (run.done && !run.verdict ? closeProofRun() : store.set({ proofRun: { ...run, open: false } }))}
        >
          <X size={15} />
        </button>
      </div>
      <div
        className="proofrun-body"
        ref={body}
        onScroll={(e) => {
          const el = e.currentTarget
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {run.rounds.map((r, i) => (
          <section key={i} className="proofrun-round">
            <div className="proofrun-round-label">Tour {i + 1}</div>
            {r.ai ? <AiText text={r.ai} /> : <span className="copilot-dots" />}
            {r.lean && <div className={`proofrun-lean${r.ok === true ? ' good' : r.ok === false ? ' bad' : ''}`}>{r.lean}</div>}
          </section>
        ))}
        {run.verdict && <Verdict v={run.verdict} />}
        {run.failure && (
          <div className="proofrun-failure">
            <CircleX size={15} /> {run.failure.text}
            {run.failure.lean && (
              <button className="btn small" onClick={() => void openFile(run.failure!.lean!)}>
                <FileCode2 size={13} /> Ouvrir le Lean
              </button>
            )}
          </div>
        )}
      </div>
      <div className="proofrun-phase">{run.phase}</div>
    </div>
  )
}
