import { useEffect, useRef, useState } from 'react'
import type { DialogAnswer, DialogRequest } from '../../lib/dialog'
import { closeModal, ModalFrame } from '../Modals'

/** Question posée par lib/dialog (extensions, session) ; fermer sans répondre vaut le bouton -1 */
export default function DialogModal({ req, resolve }: { req: DialogRequest; resolve: (a: DialogAnswer) => void }): React.JSX.Element {
  const [value, setValue] = useState(req.input?.value ?? '')
  const answered = useRef(false)
  const answer = (button: number): void => {
    answered.current = true
    resolve({ button, value })
    closeModal()
  }
  useEffect(
    () => () => {
      if (!answered.current) resolve({ button: -1, value: '' })
    },
    [resolve]
  )
  return (
    <ModalFrame
      title={req.title}
      width={460}
      footer={
        <>
          {req.buttons.map((b, i) => (
            <button key={i} className={`btn${i === req.buttons.length - 1 ? ' primary' : ''}`} onClick={() => answer(i)}>
              {b}
            </button>
          ))}
        </>
      }
    >
      <div className="dialog-body">
        <p className="dialog-message">{req.message}</p>
        {req.detail && <p className="dialog-detail">{req.detail}</p>}
        {req.input && (
          <input
            className="input"
            autoFocus
            value={value}
            placeholder={req.input.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && answer(req.buttons.length - 1)}
          />
        )}
      </div>
    </ModalFrame>
  )
}
