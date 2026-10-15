import { useMemo } from 'react'
import { diffLines, hunks } from '../../lib/diff'
import { closeModal, ModalFrame } from '../Modals'

/** Différences entre une version de l'historique et l'état actuel d'un fichier */
export default function DiffModal(p: { title: string; before: string; after: string; beforeLabel: string; afterLabel: string }): React.JSX.Element {
  const lines = useMemo(() => diffLines(p.before, p.after), [p.before, p.after])
  const shown = useMemo(() => hunks(lines), [lines])
  const added = lines.filter((l) => l.type === 'add').length
  const removed = lines.filter((l) => l.type === 'del').length
  return (
    <ModalFrame
      title={p.title}
      width={860}
      footer={
        <button className="btn primary" onClick={closeModal}>
          Fermer
        </button>
      }
    >
      <div className="diff-legend">
        <span className="diff-del-label">− {p.beforeLabel}</span>
        <span className="diff-add-label">+ {p.afterLabel}</span>
        <span className="diff-stats">
          {added || removed ? `${removed} ligne${removed > 1 ? 's' : ''} en moins, ${added} en plus` : 'Aucune différence'}
        </span>
      </div>
      <div className="diff-body">
        {shown.map((l, i) =>
          l === null ? (
            <div key={i} className="diff-gap">
              ⋯
            </div>
          ) : (
            <div key={i} className={`diff-line ${l.type}`}>
              <span className="diff-num">{l.a ?? ''}</span>
              <span className="diff-num">{l.b ?? ''}</span>
              <span className="diff-sign">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
              <span className="diff-text">{l.text || ' '}</span>
            </div>
          )
        )}
      </div>
    </ModalFrame>
  )
}
