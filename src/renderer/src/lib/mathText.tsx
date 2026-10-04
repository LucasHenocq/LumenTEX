import { renderMathOrNull } from '../editor/features'

// Formules LaTeX dans un texte (réponses de l'IA, discussion) : rendues avec KaTeX, ou laissées en texte brut
// si KaTeX ne sait pas les afficher. Les montants (« 5 $ et 10 $ ») ne sont pas pris pour des formules.

/** Formules centrées, éventuellement sur plusieurs lignes : $$…$$ et \[…\] */
const DISPLAY = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\])/
/** Formules dans le texte : $…$ (sans espace juste après l'ouverture ni avant la fermeture) et \(…\) */
const INLINE = /(\$\$[^\n]+?\$\$|\\\[[^\n]+?\\\]|\\\([^\n]+?\\\)|\$[^\s$](?:[^$\n]*?[^\s\\$])?\$)/

function strip(raw: string): { tex: string; display: boolean } {
  if (raw.startsWith('$$')) return { tex: raw.slice(2, -2), display: true }
  if (raw.startsWith('\\[')) return { tex: raw.slice(2, -2), display: true }
  if (raw.startsWith('\\(')) return { tex: raw.slice(2, -2), display: false }
  return { tex: raw.slice(1, -1), display: false }
}

function MathSpan({ raw, k }: { raw: string; k: string }): React.JSX.Element {
  const { tex, display } = strip(raw)
  const html = renderMathOrNull(tex.trim(), display)
  if (html === null) return <span key={k}>{raw}</span>
  return <span key={k} className={display ? 'math-block' : 'math-inline'} dangerouslySetInnerHTML={{ __html: html }} />
}

/** Texte d'une ligne : formules rendues, le reste confié à plain (gras, italique…) */
export function withInlineMath(text: string, plain: (s: string, key: string) => React.ReactNode): React.ReactNode[] {
  return text.split(INLINE).map((part, i) => (i % 2 ? <MathSpan key={i} raw={part} k={String(i)} /> : plain(part, String(i))))
}

/** Bloc de texte : formules centrées (même sur plusieurs lignes) à part, le reste confié à lines */
export function withDisplayMath(text: string, lines: (s: string, key: string) => React.ReactNode): React.ReactNode[] {
  return text.split(DISPLAY).map((part, i) =>
    i % 2 ? (
      <div key={i} className="math-display">
        <MathSpan raw={part} k={String(i)} />
      </div>
    ) : (
      lines(part, String(i))
    )
  )
}
