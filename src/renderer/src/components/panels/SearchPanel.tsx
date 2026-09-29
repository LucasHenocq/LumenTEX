import { CaseSensitive, Regex } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SearchMatch } from '../../../../shared/types'
import { openFile, saveAll } from '../../lib/actions'
import { useApp } from '../../store'
import FileIcon from '../FileIcon'

export default function SearchPanel(): React.JSX.Element {
  const root = useApp((s) => s.root)
  const [query, setQuery] = useState('')
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCase] = useState(false)
  const [results, setResults] = useState<SearchMatch[]>([])
  const [busy, setBusy] = useState(false)
  const token = useRef(0)

  useEffect(() => {
    const t = ++token.current
    if (!query.trim() || !root) {
      setResults([])
      return
    }
    const timer = setTimeout(async () => {
      setBusy(true)
      await saveAll()
      const r = await window.api.search(root, query, { regex, caseSensitive })
      if (t === token.current) {
        setResults(r)
        setBusy(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [query, regex, caseSensitive, root])

  const grouped = useMemo(() => {
    const m = new Map<string, SearchMatch[]>()
    for (const r of results) {
      if (!m.has(r.file)) m.set(r.file, [])
      m.get(r.file)!.push(r)
    }
    return [...m.entries()]
  }, [results])

  const highlight = (text: string): React.ReactNode => {
    let re: RegExp
    try {
      re = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? '' : 'i')
    } catch {
      return text
    }
    const m = re.exec(text)
    if (!m) return text
    const start = Math.max(0, m.index - 30)
    return (
      <>
        {start > 0 && '…'}
        {text.slice(start, m.index)}
        <mark>{m[0]}</mark>
        {text.slice(m.index + m[0].length, m.index + m[0].length + 120)}
      </>
    )
  }

  return (
    <div className="panel">
      <div className="panel-header column">
        <div className="search-box">
          <input
            className="input small search-input"
            placeholder="Rechercher dans le projet"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <button className={`toggle-btn${caseSensitive ? ' on' : ''}`} title="Respecter la casse" onClick={() => setCase(!caseSensitive)}>
            <CaseSensitive size={15} />
          </button>
          <button className={`toggle-btn${regex ? ' on' : ''}`} title="Expression régulière" onClick={() => setRegex(!regex)}>
            <Regex size={14} />
          </button>
        </div>
        {query && (
          <div className="search-summary">
            {busy ? 'Recherche…' : `${results.length}${results.length >= 1000 ? '+' : ''} résultat(s) dans ${grouped.length} fichier(s)`}
          </div>
        )}
      </div>
      <div className="panel-body">
        {grouped.map(([file, matches]) => (
          <div key={file} className="search-group">
            <div className="search-file">
              <FileIcon name={file} size={13} />
              <span>{file}</span>
              <span className="count">{matches.length}</span>
            </div>
            {matches.map((m) => (
              <div key={`${m.line}:${m.col}`} className="search-hit" onClick={() => void openFile(file, { line: m.line, col: m.col })}>
                <span className="hit-line">{m.line}</span>
                <span className="hit-text">{highlight(m.text.trim())}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
