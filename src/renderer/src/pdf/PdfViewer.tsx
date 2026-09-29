import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
import { useEffect, useRef, useState } from 'react'
import { on } from '../lib/bus'
import { syncReverse } from '../lib/actions'
import { store, useApp } from '../store'
import { kb } from '../lib/keys'

;(globalThis as unknown as { pdfjsLib: typeof pdfjsLib }).pdfjsLib = pdfjsLib
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

type ViewerModule = typeof import('pdfjs-dist/web/pdf_viewer.mjs')
let viewerModule: Promise<ViewerModule> | null = null
const loadViewerModule = (): Promise<ViewerModule> => (viewerModule ??= import('pdfjs-dist/web/pdf_viewer.mjs'))

interface Slot {
  container: HTMLDivElement
  viewer: InstanceType<ViewerModule['PDFViewer']>
  eventBus: InstanceType<ViewerModule['EventBus']>
  link: InstanceType<ViewerModule['PDFLinkService']>
  doc: pdfjsLib.PDFDocumentProxy | null
}

function once(bus: Slot['eventBus'], name: string, timeout = 4000): Promise<void> {
  return new Promise((resolve) => {
    const handler = (): void => {
      bus.off(name, handler)
      resolve()
    }
    bus.on(name, handler)
    setTimeout(() => {
      bus.off(name, handler)
      resolve()
    }, timeout)
  })
}

/** Défilement animé ; la position finale est garantie même si l'animation est suspendue */
function animateScroll(el: HTMLElement, to: number, ms = 280): void {
  const from = el.scrollTop
  const start = performance.now()
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / ms)
    el.scrollTop = from + (to - from) * (1 - Math.pow(1 - t, 3))
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
  setTimeout(() => {
    if (Math.abs(el.scrollTop - to) > 2) el.scrollTop = to
  }, ms + 120)
}

export default function PdfViewer(): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const refA = useRef<HTMLDivElement>(null)
  const refB = useRef<HTMLDivElement>(null)
  const slots = useRef<Slot[]>([])
  const active = useRef(0)
  const loadToken = useRef(0)
  const [ready, setReady] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [shown, setShown] = useState(0)
  const pdf = useApp((s) => s.pdf)
  const dark = useApp((s) => s.settings.pdfDarkMode)

  // Création des deux visionneuses (double tampon pour des rechargements sans scintillement)
  useEffect(() => {
    let disposed = false
    void loadViewerModule().then((mod) => {
      if (disposed) return
      slots.current = [refA.current!, refB.current!].map((container, i) => {
        const eventBus = new mod.EventBus()
        const link = new mod.PDFLinkService({ eventBus, externalLinkTarget: mod.LinkTarget.BLANK })
        const viewer = new mod.PDFViewer({
          container,
          viewer: container.querySelector(".pdfViewer") as HTMLDivElement,
          eventBus,
          linkService: link,
          textLayerMode: 1,
          annotationMode: pdfjsLib.AnnotationMode.ENABLE,
          removePageBorders: false,
          maxCanvasPixels: 2 ** 25
        })
        link.setViewer(viewer)
        eventBus.on('pagechanging', (e: { pageNumber: number }) => {
          if (active.current === i) store.set({ pdfPage: e.pageNumber })
        })
        eventBus.on('scalechanging', (e: { scale: number }) => {
          if (active.current === i) store.set({ pdfScale: e.scale })
        })
        return { container, viewer, eventBus, link, doc: null }
      })
      setReady(true)
    })
    return () => {
      disposed = true
      for (const s of slots.current) void s.doc?.loadingTask.destroy()
    }
  }, [])

  // Chargement d'un nouveau PDF
  useEffect(() => {
    if (!ready) return
    const token = ++loadToken.current
    if (!pdf) {
      for (const s of slots.current) {
        s.viewer.setDocument(null as never)
        void s.doc?.loadingTask.destroy()
        s.doc = null
      }
      setLoaded(false)
      return
    }
    void (async () => {
      const bytes = await window.api.readPdf(pdf.path)
      if (!bytes || token !== loadToken.current) return
      let doc: pdfjsLib.PDFDocumentProxy
      try {
        doc = await pdfjsLib.getDocument({ data: bytes }).promise
      } catch {
        return
      }
      if (token !== loadToken.current) {
        void doc.loadingTask.destroy()
        return
      }
      const prev = slots.current[active.current]
      const nextIndex = prev.doc ? 1 - active.current : active.current
      const next = slots.current[nextIndex]
      const restore = prev.doc
        ? { scale: prev.viewer.currentScaleValue, top: prev.container.scrollTop, left: prev.container.scrollLeft }
        : { scale: 'page-width', top: 0, left: 0 }

      const init = once(next.eventBus, 'pagesinit')
      next.viewer.setDocument(doc)
      next.link.setDocument(doc)
      await init
      if (token !== loadToken.current) return
      next.viewer.currentScaleValue = restore.scale || 'page-width'
      next.container.scrollTop = restore.top
      next.container.scrollLeft = restore.left
      if (nextIndex !== active.current) await once(next.eventBus, 'pagerendered', 1500)
      if (token !== loadToken.current) return

      const old = next === prev ? null : prev
      active.current = nextIndex
      setShown(nextIndex)
      store.set({ pdfPages: doc.numPages, pdfPage: next.viewer.currentPageNumber, pdfScale: next.viewer.currentScale })
      next.doc = doc
      setLoaded(true)
      if (old) {
        setTimeout(() => {
          const d = old.doc
          old.doc = null
          old.viewer.setDocument(null as never)
          old.link.setDocument(null as never)
          void d?.loadingTask.destroy()
        }, 60)
      }
    })()
  }, [pdf, ready])

  // Commandes (zoom, pages) et surbrillance SyncTeX
  useEffect(() => {
    const current = (): Slot | undefined => slots.current[active.current]
    const offCmd = on('pdf:command', (cmd) => {
      const s = current()
      if (!s?.doc) return
      if (cmd === 'zoom-in') s.viewer.increaseScale()
      else if (cmd === 'zoom-out') s.viewer.decreaseScale()
      else if (cmd === 'fit-width') s.viewer.currentScaleValue = 'page-width'
      else if (cmd === 'fit-page') s.viewer.currentScaleValue = 'page-fit'
      else if (cmd.startsWith('scale:')) s.viewer.currentScaleValue = cmd.slice(6)
      else if (cmd.startsWith('page:')) {
        const n = Number(cmd.slice(5))
        if (n >= 1 && n <= s.doc.numPages) s.viewer.currentPageNumber = n
      } else if (cmd === 'next-page') s.viewer.nextPage()
      else if (cmd === 'prev-page') s.viewer.previousPage()
    })
    const offHl = on('pdf:highlight', ({ page, rects }) => {
      const s = current()
      if (!s?.doc) return
      const pv = s.viewer.getPageView(page - 1)
      if (!pv) return
      const vp = pv.viewport
      const H = vp.viewBox[3]
      const div: HTMLDivElement = pv.div
      // Couche posée sur le conteneur des pages : pdf.js vide les pages lors de leur rendu
      const layer = s.container.querySelector(".pdfViewer") as HTMLDivElement
      layer.querySelectorAll('.synctex-hl').forEach((e) => e.remove())
      let minTop = Infinity
      for (const r of rects) {
        const [x1, y1] = vp.convertToViewportPoint(r.x, H - r.y - r.h)
        const [x2, y2] = vp.convertToViewportPoint(r.x + r.w, H - r.y)
        const el = document.createElement('div')
        el.className = 'synctex-hl'
        const left = div.offsetLeft + div.clientLeft + Math.min(x1, x2)
        const top = Math.min(y1, y2)
        el.style.cssText = `left:${left - 3}px;top:${div.offsetTop + div.clientTop + top - 2}px;width:${Math.abs(x2 - x1) + 6}px;height:${Math.abs(y2 - y1) + 4}px`
        layer.appendChild(el)
        minTop = Math.min(minTop, top)
        setTimeout(() => el.remove(), 2600)
      }
      const c = s.container
      const pageTop = div.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop
      const target = pageTop + minTop - c.clientHeight / 3
      const visible = pageTop + minTop > c.scrollTop + 20 && pageTop + minTop < c.scrollTop + c.clientHeight - 40
      if (!visible) animateScroll(c, Math.max(0, target))
    })
    return () => {
      offCmd()
      offHl()
    }
  }, [])

  // Zoom au pincement / Cmd+molette
  useEffect(() => {
    const stage = stageRef.current!
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const s = slots.current[active.current]
      if (!s?.doc) return
      const factor = Math.exp(-e.deltaY / (e.ctrlKey && !e.metaKey ? 100 : 300))
      s.viewer.updateScale({ scaleFactor: factor, origin: [e.clientX, e.clientY], drawingDelay: 250 })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [])

  // Double-clic : recherche inverse SyncTeX (écouteur natif en capture : la couche texte de pdf.js intercepte l'événement)
  useEffect(() => {
    const stage = stageRef.current!
    const onDoubleClick = (e: MouseEvent): void => {
      const pageEl = (e.target as HTMLElement).closest('.page') as HTMLElement | null
      const s = slots.current[active.current]
      if (!pageEl || !s?.doc) return
      const n = Number(pageEl.dataset.pageNumber)
      const pv = s.viewer.getPageView(n - 1)
      if (!pv) return
      const rect = (pv.div as HTMLDivElement).getBoundingClientRect()
      const [px, py] = pv.viewport.convertToPdfPoint(e.clientX - rect.left, e.clientY - rect.top)
      window.getSelection()?.removeAllRanges()
      void syncReverse(n, px, pv.viewport.viewBox[3] - py)
    }
    stage.addEventListener('dblclick', onDoubleClick, true)
    return () => stage.removeEventListener('dblclick', onDoubleClick, true)
  }, [])

  return (
    <div ref={stageRef} className={`pdf-stage${dark ? ' pdf-dark' : ''}`}>
      <div ref={refA} className={`pdf-container${shown === 0 ? ' shown' : ''}`}>
        <div className="pdfViewer" />
      </div>
      <div ref={refB} className={`pdf-container${shown === 1 ? ' shown' : ''}`}>
        <div className="pdfViewer" />
      </div>
      {!loaded && <PdfEmpty />}
    </div>
  )
}

function PdfEmpty(): React.JSX.Element {
  const status = useApp((s) => s.compileStatus)
  const progress = useApp((s) => s.compileProgress)
  const tectonic = useApp((s) => s.tectonic)
  return (
    <div className="pdf-empty">
      {status === 'running' ? (
        <>
          <div className="spinner large" />
          <div className="pdf-empty-title">Compilation en cours…</div>
          <div className="pdf-empty-sub">{progress || 'La première compilation télécharge les paquets nécessaires.'}</div>
        </>
      ) : (
        <>
          <div className="pdf-empty-icon">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6M8 13h8M8 17h5" />
            </svg>
          </div>
          <div className="pdf-empty-title">Aucun aperçu</div>
          <div className="pdf-empty-sub">
            {tectonic && !tectonic.found ? 'Installez Tectonic pour compiler vos documents.' : kb('Compilez avec ⌘↵ pour afficher le PDF.')}
          </div>
        </>
      )}
    </div>
  )
}
