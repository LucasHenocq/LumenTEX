import { useEffect, useRef } from 'react'
import { frameOf } from '../../lib/extHost'
import { useApp, type ExtPanel } from '../../store'

/**
 * Panneau d'une extension. De confiance : son élément (dessiné par elle, gardé d'une ouverture à l'autre) est placé ici.
 * Isolée : son cadre, qui vit en dehors de l'arbre React (le déplacer le rechargerait), est posé au-dessus de cette zone,
 * sauf s'il est dans une fenêtre de l'extension (un seul cadre, une seule place).
 */
export default function ExtPanelHost({ panel }: { panel: ExtPanel }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const inWindow = useApp((s) => !panel.el && s.extUi.windows.some((w) => w.extId === panel.extId))

  useEffect(() => {
    const zone = ref.current
    if (!zone) return
    if (inWindow) return
    if (panel.el) {
      zone.appendChild(panel.el)
      return () => panel.el?.remove()
    }
    const frame = frameOf(panel.extId)
    if (!frame) return
    const place = (): void => {
      const r = zone.getBoundingClientRect()
      Object.assign(frame.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(zone)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
      frame.style.display = 'none'
    }
  }, [panel, inWindow])

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">{panel.title}</span>
      </div>
      <div className="panel-body ext-panel-zone" ref={ref}>
        {inWindow && <div className="ext-panel-elsewhere">Ouvert dans une fenêtre</div>}
      </div>
    </div>
  )
}
