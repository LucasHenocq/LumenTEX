import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { frameOf } from '../lib/extHost'
import { useApp, type ExtWindow } from '../store'

// Fenêtres flottantes des extensions (lumen.ui.openWindow) : déplaçables par leur titre, redimensionnables par le coin,
// au-dessus de l'espace de travail mais sous les fenêtres de dialogue. Place et taille retrouvées à la réouverture.

type Rect = { x: number; y: number; w: number; h: number }
const saved = (key: string): Rect | null => {
  try {
    return JSON.parse(localStorage.getItem(`lumen.extwin.${key}`) ?? 'null')
  } catch {
    return null
  }
}
const save = (key: string, r: Rect): void => {
  try {
    localStorage.setItem(`lumen.extwin.${key}`, JSON.stringify(r))
  } catch {
    /* pas de stockage : place par défaut la prochaine fois */
  }
}
/** Gardée visible quand la fenêtre de Lumen TeX a rétréci */
const clamp = (r: Rect): Rect => ({
  w: Math.min(r.w, window.innerWidth - 16),
  h: Math.min(r.h, window.innerHeight - 16),
  x: Math.min(Math.max(0, r.x), window.innerWidth - 80),
  y: Math.min(Math.max(0, r.y), window.innerHeight - 40)
})

function Win({ w, z, front }: { w: ExtWindow; z: number; front: () => void }): React.JSX.Element {
  const [rect, setRect] = useState<Rect>(() =>
    clamp(saved(w.key) ?? { w: w.width, h: w.height, x: (window.innerWidth - w.width) / 2, y: Math.max(40, (window.innerHeight - w.height) / 3) })
  )
  const box = useRef<HTMLDivElement>(null)
  const zone = useRef<HTMLDivElement>(null)
  const last = useRef(rect)
  last.current = rect

  // Taille changée par le coin (resize CSS) ; gardée pour la prochaine ouverture
  useEffect(() => {
    const el = box.current!
    const ro = new ResizeObserver(() => setRect((r) => (r.w === el.offsetWidth && r.h === el.offsetHeight ? r : { ...r, w: el.offsetWidth, h: el.offsetHeight })))
    ro.observe(el)
    return () => {
      ro.disconnect()
      save(w.key, last.current)
    }
  }, [w.key])

  // Contenu : élément de l'extension, ou son cadre isolé posé au-dessus de la zone
  useEffect(() => {
    const el = zone.current!
    if (w.el) {
      el.appendChild(w.el)
      return () => w.el?.remove()
    }
    const frame = frameOf(w.extId)
    if (!frame) return
    const place = (): void => {
      // Bande libre en bas : le coin de redimensionnement reste accessible
      const r = el.getBoundingClientRect()
      Object.assign(frame.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height - 12}px`, zIndex: String(z + 1) })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
      Object.assign(frame.style, { display: 'none', zIndex: '' })
    }
  }, [w.el, w.extId, z, rect.x, rect.y])

  const onDrag = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest('button')) return
    const dx = e.clientX - rect.x
    const dy = e.clientY - rect.y
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent): void => setRect((r) => clamp({ ...r, x: ev.clientX - dx, y: ev.clientY - dy }))
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  return (
    <div ref={box} className="ext-window" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: z }} onPointerDown={front}>
      <div className="ext-window-head" onPointerDown={onDrag}>
        <span className="ext-window-title">{w.title}</span>
        <button className="icon-btn subtle" title="Fermer" onClick={w.close}>
          <X size={15} />
        </button>
      </div>
      <div className="ext-window-body" ref={zone} />
    </div>
  )
}

export default function ExtWindows(): React.JSX.Element {
  const windows = useApp((s) => s.extUi.windows)
  // Ordre d'empilement : la dernière fenêtre touchée devant (sans déplacer les éléments, qui rechargeraient leurs cadres)
  const [order, setOrder] = useState<string[]>([])
  const rank = (key: string): number => {
    const i = order.indexOf(key)
    return i < 0 ? order.length + windows.findIndex((w) => w.key === key) : i
  }
  // Ouverte, ou ramenée devant par openWindow : au premier plan
  const raised = windows.reduce<ExtWindow | null>((a, w) => (!a || w.raised > a.raised ? w : a), null)
  useEffect(() => {
    if (raised) setOrder((o) => [...o.filter((k) => k !== raised.key && windows.some((w) => w.key === k)), raised.key])
  }, [raised?.key, raised?.raised])
  return (
    <>
      {windows.map((w) => (
        <Win key={w.key} w={w} z={50 + 2 * rank(w.key)} front={() => setOrder((o) => (o[o.length - 1] === w.key ? o : [...o.filter((k) => k !== w.key), w.key]))} />
      ))}
    </>
  )
}
