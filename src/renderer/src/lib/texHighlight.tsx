/** Coloration LaTeX légère pour les blocs de code, avec les couleurs de l'éditeur */
const TEX_TOKENS = /(%.*)|(\\(?:begin|end))(\{[^}]*\})?|(\\[a-zA-Z@]+\*?|\\.)|(\$\$?[^$]*\$\$?)|(\[[^\]\n]*\])|([{}])/g

export function highlightTex(code: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  for (const m of code.matchAll(TEX_TOKENS)) {
    if (m.index > last) out.push(code.slice(last, m.index))
    const k = out.length
    if (m[1]) out.push(<span key={k} className="tx-comment">{m[1]}</span>)
    else if (m[2])
      out.push(
        <span key={k}>
          <span className="tx-keyword">{m[2]}</span>
          {m[3] && <span className="tx-env">{m[3]}</span>}
        </span>
      )
    else if (m[4]) out.push(<span key={k} className="tx-command">{m[4]}</span>)
    else if (m[5]) out.push(<span key={k} className="tx-math">{m[5]}</span>)
    else if (m[6]) out.push(<span key={k} className="tx-opt">{m[6]}</span>)
    else out.push(<span key={k} className="tx-brace">{m[7]}</span>)
    last = m.index + m[0].length
  }
  out.push(code.slice(last))
  return out
}
