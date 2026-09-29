import { ChevronDown, ChevronUp, Crosshair, ExternalLink, Maximize2, Moon, Sun, ZoomIn, ZoomOut, MoveHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { openPdfExternal, syncForward } from '../lib/actions'
import { emit } from '../lib/bus'
import { updateSettings, useApp } from '../store'
import { kb } from '../lib/keys'

const ZOOMS = ['0.5', '0.75', '1', '1.25', '1.5', '2', '3']

export default function PdfToolbar(): React.JSX.Element {
  const page = useApp((s) => s.pdfPage)
  const pages = useApp((s) => s.pdfPages)
  const scale = useApp((s) => s.pdfScale)
  const dark = useApp((s) => s.settings.pdfDarkMode)
  const hasPdf = useApp((s) => !!s.pdf)
  const [pageInput, setPageInput] = useState(String(page))

  useEffect(() => setPageInput(String(page)), [page])

  return (
    <div className="pdf-toolbar">
      <div className="pt-group">
        <button className="icon-btn subtle" title="Page précédente" disabled={!hasPdf} onClick={() => emit('pdf:command', 'prev-page')}>
          <ChevronUp size={16} />
        </button>
        <button className="icon-btn subtle" title="Page suivante" disabled={!hasPdf} onClick={() => emit('pdf:command', 'next-page')}>
          <ChevronDown size={16} />
        </button>
        <input
          className="page-input"
          value={pageInput}
          disabled={!hasPdf}
          onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && emit('pdf:command', `page:${pageInput}`)}
          onBlur={() => setPageInput(String(page))}
        />
        <span className="page-total">/ {pages || '–'}</span>
      </div>
      <div className="pt-group">
        <button className="icon-btn subtle" title="Zoom arrière" disabled={!hasPdf} onClick={() => emit('pdf:command', 'zoom-out')}>
          <ZoomOut size={15} />
        </button>
        <select
          className="zoom-select"
          disabled={!hasPdf}
          value=""
          onChange={(e) => e.target.value && emit('pdf:command', e.target.value)}
        >
          <option value="" hidden>
            {Math.round(scale * 100)} %
          </option>
          <option value="fit-width">Pleine largeur</option>
          <option value="fit-page">Page entière</option>
          {ZOOMS.map((z) => (
            <option key={z} value={`scale:${z}`}>
              {Math.round(Number(z) * 100)} %
            </option>
          ))}
        </select>
        <button className="icon-btn subtle" title="Zoom avant" disabled={!hasPdf} onClick={() => emit('pdf:command', 'zoom-in')}>
          <ZoomIn size={15} />
        </button>
        <button className="icon-btn subtle" title={kb('Pleine largeur (⌘0)')} disabled={!hasPdf} onClick={() => emit('pdf:command', 'fit-width')}>
          <MoveHorizontal size={15} />
        </button>
        <button className="icon-btn subtle" title="Page entière" disabled={!hasPdf} onClick={() => emit('pdf:command', 'fit-page')}>
          <Maximize2 size={14} />
        </button>
      </div>
      <div className="pt-group">
        <button className="icon-btn subtle" title={kb('Aller à la position du curseur (⌥⌘J) — double-cliquez dans le PDF pour l’inverse')} disabled={!hasPdf} onClick={() => void syncForward()}>
          <Crosshair size={15} />
        </button>
        <button className={`icon-btn subtle${dark ? ' toggled' : ''}`} title="Mode sombre du PDF" onClick={() => void updateSettings({ pdfDarkMode: !dark })}>
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button className="icon-btn subtle" title={window.api.platform === 'darwin' ? 'Ouvrir dans Aperçu' : 'Ouvrir dans le lecteur PDF'} disabled={!hasPdf} onClick={openPdfExternal}>
          <ExternalLink size={15} />
        </button>
      </div>
    </div>
  )
}
