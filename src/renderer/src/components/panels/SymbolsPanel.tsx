import katex from 'katex'
import { useMemo, useState } from 'react'
import { ABBREV, LEAN_SYMBOL_GROUPS } from '../../editor/lean'
import { SYMBOL_GROUPS } from '../../latex/symbols'
import { insertText } from '../../lib/actions'
import { extensions } from '../../lib/extensions'
import { isLean } from '../../lib/lean'
import { languageOf } from '../../lib/languages'
import { useApp } from '../../store'

const renderCache = new Map<string, string>()

function render(tex: string): string {
  let html = renderCache.get(tex)
  if (!html) {
    html = katex.renderToString(tex, { throwOnError: false, displayMode: false, strict: false })
    renderCache.set(tex, html)
  }
  return html
}

/** Un symbole : affiché (KaTeX pour LaTeX, caractère pour Lean), inséré tel quel ou comme gabarit (snippet) */
type Item = { key: string; title: string; insert: string; snippet: boolean; html?: string; text?: string }

/**
 * Selon le langage du fichier actif. LaTeX (et aucun fichier) : commandes rendues par KaTeX ; Lean : caractères Unicode,
 * avec leur abréviation \… ; autre langage : groupes des extensions pour ce langage (« caractère nom », caractère inséré).
 */
function groupsFor(lang: string): { name: string; items: Item[] }[] {
  const extGroups = extensions().flatMap((e) => e.symbols.filter((g) => g.language === lang))
  if (lang === 'lean')
    return LEAN_SYMBOL_GROUPS.map((g) => ({
      name: g.name,
      items: g.items.map((a) => ({ key: a, title: `\\${a}`, insert: ABBREV[a], snippet: false, text: ABBREV[a] }))
    }))
  if (lang !== 'latex')
    return extGroups.map((g) => ({
      name: g.name,
      items: g.items.map((i) => {
        const [text, ...name] = i.split(/\s+/)
        return { key: name.join(' ') || text, title: name.join(' ') || text, insert: text, snippet: false, text }
      })
    }))
  return [...SYMBOL_GROUPS, ...extGroups.map((g) => ({ name: g.name, items: g.items.map((i): [string] => [i]) }))].map((g) => ({
    name: g.name,
    items: g.items.map(([cmd, tpl]) => ({
      key: cmd,
      title: cmd,
      insert: tpl ?? cmd + (/[a-zA-Z]$/.test(cmd) ? ' ' : ''),
      snippet: !!tpl,
      html: render(cmd)
    }))
  }))
}

export default function SymbolsPanel(): React.JSX.Element {
  // Langage du fichier actif (LaTeX s'il n'y en a pas, ou si son langage n'a pas de symboles propres)
  useApp((s) => s.compilersVersion)
  const active = useApp((s) => s.active)
  const language = languageOf(active)
  const lang = isLean(active) ? 'lean' : !active || !language || language.id === 'bibtex' ? 'latex' : language.id
  const lean = lang === 'lean'
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<string | null>(null)
  const exts = useApp((s) => s.extensions)
  const all = useMemo(() => groupsFor(lang), [lang, exts])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\\/, '')
    return all
      .filter((g) => !group || g.name === group)
      .map((g) => ({ ...g, items: q ? g.items.filter((i) => i.key.toLowerCase().includes(q) || i.text === q) : g.items }))
      .filter((g) => g.items.length)
  }, [all, query, group])

  return (
    <div className="panel">
      <div className="panel-header column">
        <input
          className="input small"
          placeholder={lean ? 'Filtrer (ex. forall, R, alpha…)' : 'Filtrer (ex. arrow, alpha…)'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="chips">
          <button className={`chip${!group ? ' on' : ''}`} onClick={() => setGroup(null)}>
            Tous
          </button>
          {all.map((g) => (
            <button key={g.name} className={`chip${group === g.name ? ' on' : ''}`} onClick={() => setGroup(group === g.name ? null : g.name)}>
              {g.name}
            </button>
          ))}
        </div>
        {lean && <div className="symbols-hint">Symboles Lean : cliquez, ou tapez l’abréviation (survol) suivie d’une espace.</div>}
      </div>
      <div className="panel-body symbols">
        {groups.map((g) => (
          <section key={g.name}>
            <div className="section-label">{g.name}</div>
            <div className={`symbol-grid${['Structures', 'Délimiteurs', 'Grands opérateurs'].includes(g.name) ? ' wide' : ''}`}>
              {g.items.map((i) => (
                <button
                  key={i.key}
                  className={`symbol${i.text ? ' lean-symbol' : ''}`}
                  title={i.title}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertText(i.insert, i.snippet)}
                  {...(i.html ? { dangerouslySetInnerHTML: { __html: i.html } } : { children: i.text })}
                />
              ))}
            </div>
          </section>
        ))}
        {!groups.length && (
          <div className="panel-empty">{all.length ? 'Aucun symbole' : `Pas de symboles pour les fichiers ${language?.name ?? ''}`}</div>
        )}
      </div>
    </div>
  )
}
