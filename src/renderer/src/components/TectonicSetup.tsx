import { AlertTriangle, CheckCircle2, Download, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { InstallProgress } from '../../../shared/types'
import { compile } from '../lib/actions'
import { store, toast } from '../store'

export default function TectonicSetup(): React.JSX.Element {
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => window.api.onTectonicProgress(setProgress), [])

  const install = async (): Promise<void> => {
    setBusy(true)
    try {
      const status = await window.api.installTectonic()
      store.set({ tectonic: status })
      toast(`Tectonic ${status.version} installé`, 'success')
      if (store.get().root) void compile()
    } catch (e) {
      toast(`Installation impossible : ${(e as Error).message}`, 'error', undefined, 7000)
    } finally {
      setBusy(false)
    }
  }

  const recheck = async (): Promise<void> => {
    const status = await window.api.tectonicStatus(true)
    store.set({ tectonic: status })
    if (status.found) toast(`Tectonic ${status.version} détecté`, 'success')
    else toast('Tectonic toujours introuvable', 'error')
  }

  const pct = progress?.total ? Math.round(((progress.received ?? 0) / progress.total) * 100) : null

  return (
    <div className="tectonic-card">
      <div className="tc-icon">
        {progress?.phase === 'done' ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
      </div>
      <div className="tc-body">
        <div className="tc-title">Moteur LaTeX requis</div>
        <div className="tc-text">
          Lumen TeX utilise <strong>Tectonic</strong>, un moteur LaTeX moderne et autonome (~22 Mo). Les paquets LaTeX sont
          téléchargés automatiquement à la demande lors des compilations.
        </div>
        {busy && (
          <div className="tc-progress">
            <div className="progress">
              <div
                className={`progress-bar${pct === null ? ' indeterminate' : ''}`}
                style={pct !== null ? { width: `${pct}%` } : undefined}
              />
            </div>
            <span>
              {progress?.phase === 'extract'
                ? 'Extraction…'
                : pct !== null
                  ? `${pct} % · ${((progress?.received ?? 0) / 1e6).toFixed(1)} Mo`
                  : 'Connexion…'}
            </span>
          </div>
        )}
        <div className="tc-actions">
          <button className="btn primary" disabled={busy} onClick={() => void install()}>
            <Download size={15} /> {busy ? 'Installation…' : 'Installer Tectonic'}
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => void recheck()}>
            <RefreshCw size={14} /> Revérifier
          </button>
        </div>
      </div>
    </div>
  )
}
