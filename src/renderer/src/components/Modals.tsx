import { useEffect } from 'react'
import { store, useApp } from '../store'
import CommandPalette from './modals/CommandPalette'
import NewProjectModal from './modals/NewProjectModal'
import SettingsModal from './modals/SettingsModal'
import ShortcutsModal from './modals/ShortcutsModal'
import TableModal from './modals/TableModal'
import ConvertModal from './modals/ConvertModal'
import CollabModal from './modals/CollabModal'
import WhatsNewModal from './modals/WhatsNewModal'
import { emit } from '../lib/bus'

export function ModalFrame({
  title,
  children,
  width = 560,
  footer,
  className = ''
}: {
  title?: string
  children: React.ReactNode
  width?: number
  footer?: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      <div className={`modal ${className}`} style={{ width }} role="dialog">
        {title && (
          <div className="modal-header">
            <h2>{title}</h2>
            <button className="icon-btn subtle" onClick={closeModal} aria-label="Fermer">
              ✕
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

export function closeModal(): void {
  store.set({ modal: null })
  setTimeout(() => emit('editor:focus', undefined), 0)
}

export default function Modals(): React.JSX.Element | null {
  const modal = useApp((s) => s.modal)

  useEffect(() => {
    if (!modal) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeModal()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal])

  if (!modal) return null
  switch (modal.type) {
    case 'new-project':
      return <NewProjectModal />
    case 'settings':
      return <SettingsModal />
    case 'table':
      return <TableModal matrix={!!modal.matrix} />
    case 'palette':
      return <CommandPalette mode={modal.mode} />
    case 'shortcuts':
      return <ShortcutsModal />
    case 'convert':
      return <ConvertModal file={modal.file} />
    case 'collab':
      return <CollabModal join={modal.join} />
    case 'whats-new':
      return <WhatsNewModal since={modal.since} />
  }
}
