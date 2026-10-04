import { foldService } from '@codemirror/language'
import { type Diagnostic as CMDiagnostic, linter } from '@codemirror/lint'
import { EditorSelection, Facet, StateEffect, type EditorState } from '@codemirror/state'
import { EditorView, hoverTooltip, type Tooltip } from '@codemirror/view'
import katex from 'katex'
import { readGroup, SECTION_LEVELS, stripComments } from '../latex/analysis'
import { contents } from '../lib/projectIndex'
import { store } from '../store'

/** Chemin (relatif au projet) du fichier associé à un état d'éditeur */
export const fileFacet = Facet.define<string, string>({ combine: (v) => v[0] ?? '' })

// ---------------------------------------------------------------------------
// Diagnostics : erreurs de compilation + vérifications statiques
// ---------------------------------------------------------------------------

const VERBATIM = /^(verbatim|lstlisting|minted|comment|Verbatim)\*?$/

function staticLint(state: EditorState): CMDiagnostic[] {
  const out: CMDiagnostic[] = []
  const doc = state.doc
  const stack: { name: string; from: number; to: number }[] = []
  let verbatim: string | null = null
  const re = /\\(begin|end)\s*\{([^}]+)\}/g
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const text = verbatim ? line.text : stripComments(line.text)
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const name = m[2].trim()
      const from = line.from + m.index
      const to = from + m[0].length
      if (verbatim) {
        if (m[1] === 'end' && name === verbatim) verbatim = null
        continue
      }
      if (m[1] === 'begin') {
        stack.push({ name, from, to })
        if (VERBATIM.test(name)) {
          stack.pop()
          verbatim = name
        }
      } else {
        const top = stack[stack.length - 1]
        if (top && top.name === name) stack.pop()
        else if (stack.some((s) => s.name === name)) {
          out.push({ from, to, severity: 'error', message: `\\end{${name}} ferme un environnement alors que \\begin{${top?.name}} est encore ouvert`, source: 'Lumen' })
          while (stack.length && stack[stack.length - 1].name !== name) stack.pop()
          stack.pop()
        } else {
          out.push({ from, to, severity: 'error', message: `\\end{${name}} sans \\begin{${name}} correspondant`, source: 'Lumen' })
        }
      }
    }
    // Tectonic = XeLaTeX : fontenc T1 / inputenc cassent certains caractères (°, œ…)
    const enc = !verbatim && /\\usepackage(\[[^\]]*\])?\{(fontenc|inputenc)\}/.exec(text)
    if (enc && (enc[2] === 'inputenc' || /T1/.test(enc[1] ?? ''))) {
      const from = line.from + enc.index
      out.push({
        from,
        to: from + enc[0].length,
        severity: 'warning',
        message:
          enc[2] === 'fontenc'
            ? 'Tectonic compile avec XeLaTeX : \\usepackage[T1]{fontenc} peut mal afficher certains caractères (° devient ř, etc.). Retirez-le : XeLaTeX gère l’Unicode nativement.'
            : 'Inutile avec XeLaTeX (Tectonic), qui lit l’UTF-8 nativement.',
        source: 'Lumen',
        actions: [
          {
            name: 'Commenter la ligne',
            apply(view, _from, _to) {
              const l = view.state.doc.lineAt(from)
              view.dispatch({ changes: { from: l.from, insert: '% ' } })
            }
          }
        ]
      })
    }
    if (!verbatim && text.includes('$$')) {
      const idx = text.indexOf('$$')
      out.push({ from: line.from + idx, to: line.from + idx + 2, severity: 'info', message: 'Préférez \\[ … \\] à $$ … $$ en LaTeX', source: 'Lumen' })
    }
  }
  for (const s of stack) {
    out.push({ from: s.from, to: s.to, severity: 'warning', message: `\\begin{${s.name}} n’est jamais fermé`, source: 'Lumen' })
  }
  return out
}

function compileDiagnostics(state: EditorState): CMDiagnostic[] {
  const file = state.facet(fileFacet)
  const out: CMDiagnostic[] = []
  for (const d of store.get().diagnostics) {
    if (d.file !== file || !d.line || d.line > state.doc.lines) continue
    const line = state.doc.line(d.line)
    let from = line.from
    let to = line.to
    // Essayer de cibler précisément le contexte (ex. la commande indéfinie)
    if (d.context) {
      const cmd = /(\\[a-zA-Z@]+)\s*$/.exec(d.context.split(' ')[0] ?? '') ?? /(\\[a-zA-Z@]+)/.exec(d.context)
      if (cmd) {
        const idx = line.text.indexOf(cmd[1])
        if (idx >= 0) {
          from = line.from + idx
          to = from + cmd[1].length
        }
      }
    }
    if (from === to) to = Math.min(line.to, from + 1)
    out.push({
      from,
      to: Math.max(to, from),
      severity: d.severity === 'info' ? 'info' : d.severity,
      message: d.message + (d.context ? `\n${d.context}` : ''),
      source: 'TeX'
    })
  }
  return out
}

/** Effet signalant que les diagnostics de compilation ont changé */
export const refreshLint = StateEffect.define<null>()

export const latexLinter = linter((view) => [...compileDiagnostics(view.state), ...staticLint(view.state)], {
  delay: 600,
  needsRefresh: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLint)))
})

// ---------------------------------------------------------------------------
// Repliage : environnements et sections
// ---------------------------------------------------------------------------

export const latexFolding = foldService.of((state, lineStart, lineEnd) => {
  const line = state.doc.lineAt(lineStart)
  const text = stripComments(line.text)

  const begin = /\\begin\{([^}]+)\}/.exec(text)
  if (begin && !text.includes(`\\end{${begin[1]}}`)) {
    const name = begin[1]
    let depth = 0
    const max = Math.min(state.doc.lines, line.number + 20000)
    for (let i = line.number; i <= max; i++) {
      const l = stripComments(state.doc.line(i).text)
      const re = /\\(begin|end)\{([^}]+)\}/g
      let m: RegExpExecArray | null
      while ((m = re.exec(l))) {
        if (m[2] !== name) continue
        depth += m[1] === 'begin' ? 1 : -1
        if (depth === 0) {
          if (i === line.number) return null
          const endLine = state.doc.line(i - 1)
          return endLine.to > lineEnd ? { from: lineEnd, to: endLine.to } : null
        }
      }
    }
    return null
  }

  const sec = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph)\*?[[{]/.exec(text)
  if (sec) {
    const level = SECTION_LEVELS[sec[1]]
    const max = Math.min(state.doc.lines, line.number + 50000)
    let last = line.number
    for (let i = line.number + 1; i <= max; i++) {
      const l = state.doc.line(i).text
      const m = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph)\*?[[{]/.exec(l)
      if ((m && SECTION_LEVELS[m[1]] <= level) || /^\s*\\(end\{document\}|bibliography|printbibliography|appendix)/.test(l)) break
      last = i
    }
    // ne pas inclure les lignes vides finales
    while (last > line.number && !state.doc.line(last).text.trim()) last--
    if (last > line.number) return { from: lineEnd, to: state.doc.line(last).to }
  }
  return null
})

// ---------------------------------------------------------------------------
// Aperçu des formules au survol (KaTeX)
// ---------------------------------------------------------------------------

const KATEX_ENVS = new Set(['equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'alignat', 'alignat*', 'multline', 'multline*', 'flalign', 'flalign*', 'eqnarray', 'eqnarray*', 'displaymath'])

let macroCache: { version: number; macros: Record<string, string> } | null = null

function userMacros(): Record<string, string> {
  const version = store.get().indexVersion
  if (macroCache?.version === version) return macroCache.macros
  const macros: Record<string, string> = {}
  for (const text of contents.values()) {
    const re = /\\(newcommand|renewcommand|providecommand|DeclareMathOperator)\*?\s*\{?\\([a-zA-Z]+)\}?\s*(?:\[\d\])?\s*/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const g = readGroup(text, re.lastIndex)
      if (!g) continue
      macros['\\' + m[2]] = m[1] === 'DeclareMathOperator' ? `\\operatorname{${g.value}}` : g.value
    }
  }
  macroCache = { version, macros }
  return macros
}

interface MathRegion {
  from: number
  to: number
  tex: string
  display: boolean
}

function findMath(state: EditorState, pos: number): MathRegion | null {
  const doc = state.doc
  const winFrom = Math.max(0, pos - 6000)
  const winTo = Math.min(doc.length, pos + 6000)
  const text = doc.sliceString(winFrom, winTo)
  const rel = pos - winFrom

  // Environnements mathématiques
  const reBegin = /\\begin\{([a-zA-Z]+\*?)\}/g
  let m: RegExpExecArray | null
  let best: MathRegion | null = null
  while ((m = reBegin.exec(text)) && m.index <= rel) {
    const env = m[1]
    if (!KATEX_ENVS.has(env)) continue
    const endTag = `\\end{${env}}`
    const end = text.indexOf(endTag, reBegin.lastIndex)
    if (end < 0 || end + endTag.length < rel) continue
    let body = text.slice(reBegin.lastIndex, end)
    body = body.replace(/\\label\{[^}]*\}/g, '').replace(/\\(nonumber|notag)\b/g, '')
    let tex: string
    if (/^(align|flalign|eqnarray)/.test(env)) tex = `\\begin{aligned}${body}\\end{aligned}`
    else if (/^gather/.test(env)) tex = `\\begin{gathered}${body}\\end{gathered}`
    else if (/^multline/.test(env)) tex = `\\begin{gathered}${body}\\end{gathered}`
    else if (/^alignat/.test(env)) tex = `\\begin{alignedat}${body}\\end{alignedat}`
    else tex = body
    best = { from: winFrom + m.index, to: winFrom + end + endTag.length, tex, display: true }
  }
  if (best) return best

  // \[ … \]  et  \( … \)
  for (const [open, close, display] of [['\\[', '\\]', true], ['\\(', '\\)', false]] as const) {
    const o = text.lastIndexOf(open, rel)
    if (o >= 0) {
      const c = text.indexOf(close, o + 2)
      if (c >= 0 && c + 2 >= rel && text.lastIndexOf(close, rel - 1) < o) {
        return { from: winFrom + o, to: winFrom + c + 2, tex: text.slice(o + 2, c), display }
      }
    }
  }

  // $ … $ et $$ … $$ dans le paragraphe courant
  let pStart = text.lastIndexOf('\n\n', rel)
  pStart = pStart < 0 ? 0 : pStart + 2
  let pEnd = text.indexOf('\n\n', rel)
  pEnd = pEnd < 0 ? text.length : pEnd
  const para = text.slice(pStart, pEnd)
  const delims: { i: number; len: number }[] = []
  for (let i = 0; i < para.length; i++) {
    const c = para[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '%') {
      const nl = para.indexOf('\n', i)
      if (nl < 0) break
      i = nl
      continue
    }
    if (c === '$') {
      const dbl = para[i + 1] === '$'
      delims.push({ i, len: dbl ? 2 : 1 })
      if (dbl) i++
    }
  }
  for (let k = 0; k + 1 < delims.length; k += 2) {
    const a = delims[k]
    const b = delims[k + 1]
    const from = pStart + a.i
    const to = pStart + b.i + b.len
    if (rel >= from && rel <= to) {
      return { from: winFrom + from, to: winFrom + to, tex: para.slice(a.i + a.len, b.i), display: a.len === 2 }
    }
  }
  return null
}

export function renderMath(tex: string, display: boolean): string {
  return katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    strict: false,
    trust: false,
    macros: { ...userMacros() },
    errorColor: 'var(--danger)'
  })
}

/** Rendu KaTeX, ou null si la formule n'est pas valide (le texte brut est alors affiché) */
export function renderMathOrNull(tex: string, display: boolean): string | null {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: false, trust: false, macros: { ...userMacros() } })
  } catch {
    return null
  }
}

export const mathHover = hoverTooltip(
  (view, pos): Tooltip | null => {
    const region = findMath(view.state, pos)
    if (!region || !region.tex.trim()) return null
    return {
      pos: region.from,
      end: region.to,
      above: true,
      create() {
        const dom = document.createElement('div')
        dom.className = 'cm-math-preview'
        dom.innerHTML = renderMath(region.tex, true)
        return { dom }
      }
    }
  },
  { hoverTime: 250 }
)

// ---------------------------------------------------------------------------
// Commandes d'édition
// ---------------------------------------------------------------------------

export function wrapSelection(view: EditorView, before: string, after: string): boolean {
  const tr = view.state.changeByRange((range) => {
    if (range.empty) {
      return {
        changes: { from: range.from, insert: before + after },
        range: EditorSelection.cursor(range.from + before.length)
      }
    }
    const text = view.state.sliceDoc(range.from, range.to)
    // Retirer l'enrobage s'il est déjà présent
    const outerFrom = range.from - before.length
    if (outerFrom >= 0 && view.state.sliceDoc(outerFrom, range.from) === before && view.state.sliceDoc(range.to, range.to + after.length) === after) {
      return {
        changes: [
          { from: outerFrom, to: range.from, insert: '' },
          { from: range.to, to: range.to + after.length, insert: '' }
        ],
        range: EditorSelection.range(outerFrom, outerFrom + text.length)
      }
    }
    return {
      changes: [
        { from: range.from, insert: before },
        { from: range.to, insert: after }
      ],
      range: EditorSelection.range(range.from + before.length, range.to + before.length)
    }
  })
  view.dispatch(tr, { scrollIntoView: true, userEvent: 'input' })
  view.focus()
  return true
}

export const frenchPhrases: Record<string, string> = {
  Find: 'Rechercher',
  Replace: 'Remplacer',
  next: 'suivant',
  previous: 'précédent',
  all: 'tout',
  'match case': 'casse',
  'by word': 'mot entier',
  regexp: 'regex',
  replace: 'remplacer',
  'replace all': 'tout remplacer',
  close: 'fermer',
  'current match': 'occurrence courante',
  'replaced $ matches': '$ occurrences remplacées',
  'replaced match on line $': 'occurrence remplacée ligne $',
  'on line': 'ligne',
  'Go to line': 'Aller à la ligne',
  go: 'OK',
  'Folded lines': 'Lignes repliées',
  'Unfolded lines': 'Lignes dépliées',
  'Fold line': 'Replier',
  'Unfold line': 'Déplier',
  'folded code': 'code replié',
  unfold: 'déplier',
  'Control character': 'Caractère de contrôle',
  Diagnostics: 'Diagnostics',
  'No diagnostics': 'Aucun diagnostic',
  Completions: 'Suggestions'
}
