import { useEffect, useMemo, useRef, useState } from 'react'
import { openFile } from '../../lib/actions'
import { COMMAND_LIST, runCommand } from '../../lib/commands'
import { store, useApp } from '../../store'
import FileIcon from '../FileIcon'
import { closeModal } from '../Modals'
import { kb } from '../../lib/keys'

/** Correspondance approximative : renvoie un score (plus petit = meilleur) ou -1 */
function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (!q) return 0
  const idx = t.indexOf(q)
  if (idx >= 0) return idx
  let ti = 0
  let gaps = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return -1
    gaps += found - ti
    ti = found + 1
  }
  return 100 + gaps
}

interface Item {
  key: string
  label: string
  hint?: string
  file?: string
  run: () => void
}

export default function CommandPalette({ mode: initialMode }: { mode: 'commands' | 'files' }): React.JSX.Element {
  const [query, setQuery] = useState(initialMode === 'commands' ? '>' : '')
  const [sel, setSel] = useState(0)
  const files = useApp((s) => s.files)
  const root = useApp((s) => s.root)
  const listRef = useRef<HTMLDivElement>(null)

  const isCommands = query.startsWith('>')
  const q = isCommands ? query.slice(1).trim() : query.trim()

  const items = useMemo<Item[]>(() => {
    if (isCommands || !root) {
      return COMMAND_LIST.filter((c) => !c.needsProject || root)
        .map((c) => ({ c, score: fuzzy(q, c.label) }))
        .filter((x) => x.score >= 0)
        .sort((a, b) => a.score - b.score)
        .map(({ c }) => ({ key: c.id, label: c.label, hint: c.shortcut && kb(c.shortcut), run: () => runCommand(c.id) }))
    }
    return files
      .filter((f) => !f.isDir)
      .map((f) => ({ f, score: Math.min(fuzzy(q, f.path.split('/').pop()!), fuzzy(q, f.path) + 50) }))
      .filter((x) => x.score >= 0 && x.score !== -1)
      .sort((a, b) => a.score - b.score || a.f.path.length - b.f.path.length)
      .slice(0, 60)
      .map(({ f }) => ({ key: f.path, label: f.path.split('/').pop()!, hint: f.path, file: f.path, run: () => void openFile(f.path) }))
  }, [q, isCommands, files, root])

  useEffect(() => setSel(0), [query])
  useEffect(() => {
    listRef.current?.querySelector('.pal-item.sel')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const choose = (item: Item | undefined): void => {
    if (!item) return
    store.set({ modal: null })
    setTimeout(item.run, 0)
  }

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      <div className="palette">
        <input
          className="palette-input"
          autoFocus
          value={query}
          placeholder={isCommands ? 'Tapez une commande…' : 'Rechercher un fichier… (tapez > pour les commandes)'}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((s) => Math.min(items.length - 1, s + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((s) => Math.max(0, s - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              choose(items[sel])
            }
          }}
        />
        <div className="palette-list" ref={listRef}>
          {items.map((it, i) => (
            <div key={it.key} className={`pal-item${i === sel ? ' sel' : ''}`} onMouseMove={() => setSel(i)} onClick={() => choose(it)}>
              {it.file && <FileIcon name={it.file} size={14} />}
              <span className="pal-label">{it.label}</span>
              {it.hint && (it.file ? <span className="pal-path">{it.hint}</span> : <kbd>{it.hint}</kbd>)}
            </div>
          ))}
          {!items.length && <div className="pal-empty">Aucun résultat</div>}
        </div>
      </div>
    </div>
  )
}
