import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { store, useApp } from '../store'

export default function Toasts(): React.JSX.Element {
  const toasts = useApp((s) => s.toasts)
  return (
    <div className="toasts">
      {toasts.map((t) => {
        const I = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? AlertCircle : Info
        return (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => store.set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }))}>
            <I size={16} />
            <span>{t.text}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={(e) => {
                  e.stopPropagation()
                  t.action!.run()
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
