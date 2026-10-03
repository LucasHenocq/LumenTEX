import { ArrowUp, Bell, BellOff, FileText, MapPin, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage } from '../../../../shared/types'
import { getActivePath, getView } from '../../editor/setup'
import { openFile } from '../../lib/actions'
import { chatVisible, isMine, markChatRead, sendChat, setTyping } from '../../lib/collab'
import { highlightTex } from '../../lib/texHighlight'
import { updateSettings, useApp } from '../../store'
import { inline } from '../Copilot'

const GROUP_MS = 3 * 60 * 1000
const URL = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"»])/

const time = (ts: number): string => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(Date.now() - 864e5)
  if (d.toDateString() === today.toDateString()) return 'Aujourd’hui'
  if (d.toDateString() === yesterday.toDateString()) return 'Hier'
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

/** Texte d'un message : liens cliquables, `code` et **gras** */
function richText(text: string): React.ReactNode[] {
  return text.split('\n').map((line, i) => (
    <div key={i}>
      {line
        ? line.split(URL).map((part, j) =>
            j % 2 ? (
              <a key={j} href={part} onClick={(e) => (e.preventDefault(), void window.api.openExternal(part))}>
                {part}
              </a>
            ) : (
              <span key={j}>{inline(part)}</span>
            )
          )
        : ' '}
    </div>
  ))
}

function RefCard({ r }: { r: NonNullable<ChatMessage['ref']> }): React.JSX.Element {
  return (
    <button className="chat-ref" title="Ouvrir à cette ligne" onClick={() => void openFile(r.file, { line: r.line })}>
      <span className="chat-ref-head">
        <FileText size={12} /> {r.file} : {r.line}
      </span>
      {r.quote && <pre>{highlightTex(r.quote)}</pre>}
    </button>
  )
}

/** Position courante : fichier, ligne et sélection (citée, tronquée) */
function currentRef(): ChatMessage['ref'] | null {
  const file = getActivePath()
  const view = getView()
  if (!file || !view) return null
  const sel = view.state.selection.main
  const quote = view.state.sliceDoc(sel.from, sel.to).trim()
  return { file, line: view.state.doc.lineAt(sel.head).number, ...(quote ? { quote: quote.slice(0, 400) } : {}) }
}

type Item = { kind: 'day'; label: string } | { kind: 'event'; text: string } | { kind: 'msg'; m: ChatMessage; head: boolean }

export default function ChatPanel(): React.JSX.Element {
  const c = useApp((s) => s.collab)
  const notify = useApp((s) => s.settings.collabNotify)
  const active = useApp((s) => s.active)
  const [text, setText] = useState('')
  const [ref, setRef] = useState<ChatMessage['ref'] | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  // Messages (ordre partagé) et événements locaux intercalés selon l'heure ; séparateurs de jour ; regroupement
  const items = useMemo(() => {
    const out: Item[] = []
    const events = [...c.events]
    let lastDay = ''
    let prev: ChatMessage | null = null
    const day = (ts: number): void => {
      const label = dayLabel(ts)
      if (label !== lastDay) {
        out.push({ kind: 'day', label })
        lastDay = label
        prev = null
      }
    }
    for (const m of c.chat) {
      while (events.length && events[0].ts <= m.ts) {
        const e = events.shift()!
        day(e.ts)
        out.push({ kind: 'event', text: e.text })
        prev = null
      }
      day(m.ts)
      const p = prev as ChatMessage | null
      out.push({ kind: 'msg', m, head: !p || p.uid !== m.uid || m.ts - p.ts > GROUP_MS })
      prev = m
    }
    for (const e of events) {
      day(e.ts)
      out.push({ kind: 'event', text: e.text })
    }
    return out
  }, [c.chat, c.events])

  // Défilement en bas à l'arrivée d'un message, sauf si l'on remonte l'historique
  useEffect(() => {
    if (atBottom.current && list.current) list.current.scrollTop = list.current.scrollHeight
  }, [items])

  // Lu dès que la discussion est visible et l'app au premier plan
  useEffect(() => {
    if (chatVisible()) markChatRead()
    const onFocus = (): void => markChatRead()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [c.chat.length])

  const send = (): void => {
    if (!text.trim() && !ref) return
    sendChat(text, ref ?? undefined)
    setText('')
    setRef(null)
    atBottom.current = true
  }

  const typing = c.people.filter((p) => p.typing).map((p) => p.name)
  const connected = c.people.length

  return (
    <div className="panel chat-panel">
      <div className="panel-header">
        <span className="panel-title">
          Discussion · {connected ? `${connected} connecté${connected > 1 ? 's' : ''}` : 'personne d’autre'}
        </span>
        <div className="panel-actions">
          <button
            className="icon-btn subtle"
            title={notify ? 'Notifications Windows activées (Lumen TeX en arrière-plan)' : 'Notifications Windows désactivées'}
            onClick={() => void updateSettings({ collabNotify: !notify })}
          >
            {notify ? <Bell size={14} /> : <BellOff size={14} />}
          </button>
        </div>
      </div>
      <div
        ref={list}
        className="chat-list"
        onScroll={(e) => {
          const el = e.currentTarget
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {!items.length && (
          <div className="chat-empty">
            Discute avec les participants de la session. Les messages restent dans le projet : ceux qui arrivent plus tard les voient aussi.
          </div>
        )}
        {items.map((it, i) =>
          it.kind === 'day' ? (
            <div key={i} className="chat-day">
              {it.label}
            </div>
          ) : it.kind === 'event' ? (
            <div key={i} className="chat-event">
              {it.text}
            </div>
          ) : (
            <div key={it.m.id} className={`chat-msg${isMine(it.m) ? ' mine' : ''}${it.head ? ' head' : ''}`}>
              {it.head && (
                <div className="chat-meta">
                  {!isMine(it.m) && (
                    <>
                      <span className="chat-dot" style={{ background: it.m.color }} />
                      <span className="chat-name">{it.m.name}</span>
                    </>
                  )}
                  <span className="chat-time">{time(it.m.ts)}</span>
                </div>
              )}
              <div className="chat-bubble">
                {it.m.text && richText(it.m.text)}
                {it.m.ref && <RefCard r={it.m.ref} />}
              </div>
            </div>
          )
        )}
      </div>
      <div className="chat-typing">{typing.length ? `${typing.join(', ')} ${typing.length > 1 ? 'écrivent' : 'écrit'}…` : ''}</div>
      <div className="chat-composer">
        {ref && (
          <div className="chat-ref-chip">
            <MapPin size={12} />
            <span>
              {ref.file} : {ref.line}
              {ref.quote ? ' (sélection)' : ''}
            </span>
            <button title="Retirer la position" onClick={() => setRef(null)}>
              <X size={11} />
            </button>
          </div>
        )}
        <textarea
          placeholder="Écrire un message…"
          value={text}
          maxLength={2000}
          onChange={(e) => {
            setText(e.target.value)
            setTyping(!!e.target.value.trim())
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="chat-composer-bar">
          <button
            className="chat-pos"
            title="Joindre ta position dans le fichier ouvert (et ta sélection)"
            disabled={!active}
            onClick={() => setRef(ref ? null : currentRef())}
          >
            <MapPin size={13} /> Ma position
          </button>
          <button className="copilot-send chat-send" title="Envoyer (Entrée)" disabled={!text.trim() && !ref} onClick={send}>
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
