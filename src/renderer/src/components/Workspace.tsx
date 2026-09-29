import { useEffect, useRef, useState } from 'react'
import PdfViewer from '../pdf/PdfViewer'
import { updateSettings, useApp } from "../store"
import ActivityBar from './ActivityBar'
import EditorPane from './EditorPane'
import LogPanel from './LogPanel'
import PdfToolbar from './PdfToolbar'
import Sidebar from './Sidebar'
import StatusBar from './StatusBar'
import TitleBar from './TitleBar'

function Splitter({ onDrag, onEnd }: { onDrag: (dx: number) => void; onEnd: () => void }): React.JSX.Element {
  const [active, setActive] = useState(false)
  const onPointerDown = (e: React.PointerEvent): void => {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    let lastX = e.clientX
    setActive(true)
    document.body.classList.add('resizing')
    const move = (ev: PointerEvent): void => {
      onDrag(ev.clientX - lastX)
      lastX = ev.clientX
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setActive(false)
      document.body.classList.remove('resizing')
      onEnd()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  return <div className={`splitter${active ? ' active' : ''}`} onPointerDown={onPointerDown} />
}

export default function Workspace(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const logOpen = useApp((s) => s.logOpen)
  const mainRef = useRef<HTMLDivElement>(null)
  const [sidebarWidth, setSidebarWidth] = useState(settings.sidebarWidth)
  const [pdfRatio, setPdfRatio] = useState(settings.pdfRatio)

  useEffect(() => setSidebarWidth(settings.sidebarWidth), [settings.sidebarWidth])
  useEffect(() => setPdfRatio(settings.pdfRatio), [settings.pdfRatio])

  const widthRef = useRef({ sidebarWidth, pdfRatio })
  widthRef.current = { sidebarWidth, pdfRatio }

  const available = (): number => {
    const total = mainRef.current?.clientWidth ?? 1200
    return total - 48 - (settings.sidebarVisible ? sidebarWidth : 0)
  }

  return (
    <div className="workspace">
      <TitleBar />
      <div className="main" ref={mainRef}>
        <ActivityBar />
        {settings.sidebarVisible && (
          <>
            <div className="sidebar" style={{ width: sidebarWidth }}>
              <Sidebar />
            </div>
            <Splitter
              onDrag={(dx) => setSidebarWidth((w) => Math.min(520, Math.max(180, w + dx)))}
              onEnd={() => void updateSettings({ sidebarWidth: widthRef.current.sidebarWidth })}
            />
          </>
        )}
        <div className="center">
          <EditorPane />
          {logOpen && <LogPanel />}
        </div>
        {settings.pdfVisible && (
          <>
            <Splitter
              onDrag={(dx) => setPdfRatio((r) => Math.min(0.8, Math.max(0.2, r - dx / available())))}
              onEnd={() => void updateSettings({ pdfRatio: widthRef.current.pdfRatio })}
            />
            <div className="pdf-pane" style={{ width: `calc((100% - 48px - ${settings.sidebarVisible ? sidebarWidth : 0}px) * ${pdfRatio})` }}>
              <PdfToolbar />
              <PdfViewer />
            </div>
          </>
        )}
      </div>
      <StatusBar />
    </div>
  )
}

