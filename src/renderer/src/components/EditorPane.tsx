import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { attachView, detachView, getActivePath, getView, showDoc } from '../editor/setup'
import { closeTab, IMAGE_FILE, openFile } from '../lib/actions'
import { on } from '../lib/bus'
import { store, useApp } from '../store'
import FileIcon from './FileIcon'
import { kb } from '../lib/keys'

function Tabs(): React.JSX.Element {
  const tabs = useApp((s) => s.tabs)
  const active = useApp((s) => s.active)
  const dirty = useApp((s) => s.dirty)
  const [dragged, setDragged] = useState<string | null>(null)

  const names = tabs.map((t) => t.split('/').pop()!)
  const label = (t: string, i: number): string => {
    const n = names[i]
    if (names.filter((x) => x === n).length > 1) {
      const parts = t.split('/')
      return parts.length > 1 ? `${n} — ${parts[parts.length - 2]}` : n
    }
    return n
  }

  const onDrop = (target: string): void => {
    if (!dragged || dragged === target) return
    const next = tabs.filter((t) => t !== dragged)
    next.splice(next.indexOf(target), 0, dragged)
    store.set({ tabs: next })
    setDragged(null)
  }

  return (
    <div className="tabs">
      {tabs.map((t, i) => (
        <div
          key={t}
          className={`tab${t === active ? ' active' : ''}${dirty[t] ? ' dirty' : ''}`}
          onClick={() => void openFile(t)}
          onAuxClick={(e) => e.button === 1 && void closeTab(t)}
          title={t}
          draggable
          onDragStart={() => setDragged(t)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => onDrop(t)}
        >
          <FileIcon name={t} size={14} />
          <span className="tab-label">{label(t, i)}</span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation()
              void closeTab(t)
            }}
          >
            <span className="tab-dot" />
            <X size={13} />
          </button>
        </div>
      ))}
      <div className="tabs-fill" />
    </div>
  )
}

function ImagePreview({ path }: { path: string }): React.JSX.Element {
  const root = useApp((s) => s.root)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let u: string | null = null
    void window.api.readBinary(root!, path).then((bytes) => {
      const ext = path.split('.').pop()!.toLowerCase()
      const type = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      u = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
      setUrl(u)
    })
    return () => {
      if (u) URL.revokeObjectURL(u)
    }
  }, [path, root])
  return (
    <div className="image-preview">
      {url && <img src={url} alt={path} />}
      <div className="image-caption">{path}</div>
    </div>
  )
}

export default function EditorPane(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const active = useApp((s) => s.active)
  const tabs = useApp((s) => s.tabs)

  useEffect(() => {
    attachView(hostRef.current!)
    const a = store.get().active
    if (a) showDoc(a)
    const offGoto = on('editor:goto', ({ file, line, col }) => {
      const view = getView()
      if (!view || getActivePath() !== file) return
      const ln = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines))
      const pos = Math.min(ln.to, ln.from + (col ?? 0))
      view.dispatch({
        selection: EditorSelection.cursor(pos),
        effects: EditorView.scrollIntoView(pos, { y: 'center' })
      })
      view.focus()
      // Flash sur la ligne
      requestAnimationFrame(() => {
        const dom = view.domAtPos(ln.from).node
        const el = (dom.nodeType === 3 ? dom.parentElement : (dom as HTMLElement))?.closest('.cm-line')
        if (el) {
          el.classList.remove('flash-line')
          void (el as HTMLElement).offsetWidth
          el.classList.add('flash-line')
          setTimeout(() => el.classList.remove('flash-line'), 1400)
        }
      })
    })
    const offFocus = on('editor:focus', () => getView()?.focus())
    return () => {
      offGoto()
      offFocus()
      detachView()
    }
  }, [])

  const isImage = !!active && IMAGE_FILE.test(active)

  return (
    <div className="editor-pane">
      {tabs.length > 0 && <Tabs />}
      <div className="editor-body">
        <div ref={hostRef} className="editor-host" style={{ visibility: active && !isImage ? 'visible' : 'hidden' }} />
        {isImage && <ImagePreview path={active!} />}
        {!active && (
          <div className="editor-empty">
            <div className="ee-title">Aucun fichier ouvert</div>
            <div className="ee-keys">
              <span>Ouverture rapide</span>
              <kbd>{kb('⌘P')}</kbd>
              <span>Palette de commandes</span>
              <kbd>{kb('⇧⌘P')}</kbd>
              <span>Nouveau fichier</span>
              <kbd>{kb('⌘N')}</kbd>
              <span>Compiler</span>
              <kbd>{kb('⌘↵')}</kbd>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
