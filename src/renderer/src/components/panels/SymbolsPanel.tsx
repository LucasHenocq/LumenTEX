import katex from 'katex'
import { useMemo, useState } from 'react'
import { SYMBOL_GROUPS } from '../../latex/symbols'
import { insertText } from '../../lib/actions'

const renderCache = new Map<string, string>()

function render(tex: string): string {
  let html = renderCache.get(tex)
  if (!html) {
    html = katex.renderToString(tex, { throwOnError: false, displayMode: false, strict: false })
    renderCache.set(tex, html)
  }
  return html
}

export default function SymbolsPanel(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<string | null>(null)

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\\/, '')
    return SYMBOL_GROUPS.filter((g) => !group || g.name === group)
      .map((g) => ({ ...g, items: q ? g.items.filter(([c]) => c.toLowerCase().includes(q)) : g.items }))
      .filter((g) => g.items.length)
  }, [query, group])

  return (
    <div className="panel">
      <div className="panel-header column">
        <input className="input small" placeholder="Filtrer (ex. arrow, alpha…)" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="chips">
          <button className={`chip${!group ? ' on' : ''}`} onClick={() => setGroup(null)}>
            Tous
          </button>
          {SYMBOL_GROUPS.map((g) => (
            <button key={g.name} className={`chip${group === g.name ? ' on' : ''}`} onClick={() => setGroup(group === g.name ? null : g.name)}>
              {g.name}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-body symbols">
        {groups.map((g) => (
          <section key={g.name}>
            <div className="section-label">{g.name}</div>
            <div className={`symbol-grid${['Structures', 'Délimiteurs', 'Grands opérateurs'].includes(g.name) ? ' wide' : ''}`}>
              {g.items.map(([cmd, tpl]) => (
                <button
                  key={cmd}
                  className="symbol"
                  title={cmd}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertText(tpl ?? cmd + (/[a-zA-Z]$/.test(cmd) ? ' ' : ''), !!tpl)}
                  dangerouslySetInnerHTML={{ __html: render(cmd) }}
                />
              ))}
            </div>
          </section>
        ))}
        {!groups.length && <div className="panel-empty">Aucun symbole</div>}
      </div>
    </div>
  )
}
