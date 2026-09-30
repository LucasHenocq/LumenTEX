import { HighlightStyle, LanguageSupport, StreamLanguage, type StreamParser, type StringStream } from '@codemirror/language'
import { tags as t, Tag } from '@lezer/highlight'

/** Environnements dont le contenu est en mode mathématique */
export const MATH_ENVS = new Set([
  'equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*', 'gather', 'gather*', 'multline', 'multline*',
  'flalign', 'flalign*', 'eqnarray', 'eqnarray*', 'displaymath', 'math', 'dmath', 'dmath*', 'split', 'aligned',
  'gathered', 'cases', 'matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix', 'Bmatrix', 'smallmatrix'
])

const SECTION_CMDS = new Set(['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph', 'title', 'caption', 'frametitle', 'framesubtitle', 'subtitle'])
const KEY_CMDS = /^(label|ref|eqref|pageref|autoref|cref|Cref|vref|nameref|cite[a-zA-Z]*|[a-z]*cite[a-z]*|nocite|bibitem|hyperref)$/
const FILE_CMDS = new Set(['input', 'include', 'includegraphics', 'bibliography', 'addbibresource', 'includeonly', 'subfile', 'includepdf', 'lstinputlisting', 'inputminted', 'graphicspath', 'bibliographystyle'])
const PKG_CMDS = new Set(['usepackage', 'documentclass', 'RequirePackage', 'usetheme', 'usecolortheme', 'usetikzlibrary', 'LoadClass'])
const STRUCT_CMDS = new Set(['begin', 'end', 'documentclass', 'usepackage', 'newcommand', 'renewcommand', 'providecommand', 'newenvironment', 'renewenvironment', 'DeclareMathOperator', 'def', 'let', 'item', 'maketitle', 'tableofcontents', 'newtheorem', 'RequirePackage', 'input', 'include', 'bibliography', 'addbibresource', 'printbibliography', 'appendix', 'frontmatter', 'mainmatter', 'backmatter'])
const BOLD_CMDS = new Set(['textbf', 'mathbf', 'bm', 'boldsymbol'])
const ITALIC_CMDS = new Set(['textit', 'emph', 'textsl'])

type ArgKind = 'envBegin' | 'envEnd' | 'heading' | 'key' | 'file' | 'pkg' | 'bold' | 'italic' | 'plain'

interface Arg {
  kind: ArgKind
  depth: number
  text: string
}

interface LatexState {
  math: string[] // pile des délimiteurs mathématiques ouverts : '$', '$$', '\\)', '\\]', 'env:<nom>'
  pending: ArgKind | null
  pendingOpt: boolean
  args: Arg[]
}

const argStyle: Record<ArgKind, string | null> = {
  envBegin: 'envName',
  envEnd: 'envName',
  heading: 'heading',
  key: 'labelName',
  file: 'fileName',
  pkg: 'pkgName',
  bold: 'strong',
  italic: 'emphasis',
  plain: null
}

function inMath(s: LatexState): boolean {
  return s.math.length > 0
}

const parser: StreamParser<LatexState> = {
  name: 'latex',
  startState: () => ({ math: [], pending: null, pendingOpt: false, args: [] }),
  copyState: (s) => ({
    math: [...s.math],
    pending: s.pending,
    pendingOpt: s.pendingOpt,
    args: s.args.map((a) => ({ ...a }))
  }),
  token(stream: StringStream, state: LatexState): string | null {
    const ch = stream.peek()

    // Commentaire
    if (ch === '%') {
      stream.skipToEnd()
      return 'comment'
    }

    // Argument attendu après une commande
    if (state.pending) {
      if (stream.eatSpace()) return null
      if (ch === '*' && stream.string[stream.pos - 1] !== ' ') {
        stream.next()
        return 'command'
      }
      if (ch === '[') {
        // argument optionnel
        let depth = 0
        while (!stream.eol()) {
          const c = stream.next()
          if (c === '[') depth++
          else if (c === ']' && --depth === 0) break
          else if (c === '{' && stream.skipTo('}')) stream.next()
        }
        return 'optArg'
      }
      if (ch === '{') {
        stream.next()
        state.args.push({ kind: state.pending, depth: 1, text: '' })
        state.pending = null
        return 'brace'
      }
      state.pending = null
    }

    const arg = state.args[state.args.length - 1]

    if (ch === '\\') {
      stream.next()
      if (stream.match(/^[a-zA-Z@]+/)) {
        const name = stream.current().slice(1)
        const math = inMath(state)
        if (name === 'begin') state.pending = 'envBegin'
        else if (name === 'end') state.pending = 'envEnd'
        else if (SECTION_CMDS.has(name)) state.pending = 'heading'
        else if (KEY_CMDS.test(name)) state.pending = 'key'
        else if (FILE_CMDS.has(name)) state.pending = 'file'
        else if (PKG_CMDS.has(name)) state.pending = 'pkg'
        else if (BOLD_CMDS.has(name) && !math) state.pending = 'bold'
        else if (ITALIC_CMDS.has(name) && !math) state.pending = 'italic'
        if (SECTION_CMDS.has(name)) return 'sectionCmd'
        if (STRUCT_CMDS.has(name)) return 'keyword'
        return math ? 'mathCmd' : 'command'
      }
      // Symbole échappé ou délimiteur mathématique
      const c = stream.next()
      if (c === '(') {
        state.math.push('\\)')
        return 'mathDelim'
      }
      if (c === '[') {
        state.math.push('\\]')
        return 'mathDelim'
      }
      if ((c === ')' || c === ']') && state.math[state.math.length - 1] === '\\' + c) {
        state.math.pop()
        return 'mathDelim'
      }
      if (c === '\\') return 'escape'
      return 'escape'
    }

    if (ch === '$') {
      stream.next()
      const top = state.math[state.math.length - 1]
      if (stream.peek() === '$') {
        stream.next()
        if (top === '$$') state.math.pop()
        else state.math.push('$$')
        return 'mathDelim'
      }
      if (top === '$') state.math.pop()
      else state.math.push('$')
      return 'mathDelim'
    }

    if (ch === '{') {
      stream.next()
      if (arg) arg.depth++
      return 'brace'
    }
    if (ch === '}') {
      stream.next()
      if (arg && --arg.depth === 0) {
        state.args.pop()
        const env = arg.text.trim()
        if (arg.kind === 'envBegin' && MATH_ENVS.has(env) && !['split', 'aligned', 'gathered', 'cases', 'matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix', 'Bmatrix', 'smallmatrix'].includes(env)) {
          state.math.push('env:' + env)
        } else if (arg.kind === 'envEnd' && state.math[state.math.length - 1] === 'env:' + env) {
          state.math.pop()
        }
      }
      return 'brace'
    }

    if (ch === '&') {
      stream.next()
      return 'alignment'
    }

    if (inMath(state)) {
      if (ch === '^' || ch === '_') {
        stream.next()
        return 'mathOp'
      }
      if (stream.match(/^[0-9]+(\.[0-9]+)?/)) return 'mathNumber'
      stream.match(/^[^\\${}%^_&0-9]+/) || stream.next()
      return 'math'
    }

    if (arg) {
      const start = stream.pos
      stream.match(/^[^\\${}%&]+/) || stream.next()
      if (arg.kind === 'envBegin' || arg.kind === 'envEnd') arg.text += stream.string.slice(start, stream.pos)
      return argStyle[arg.kind]
    }

    if (ch === '~') {
      stream.next()
      return 'escape'
    }
    stream.match(/^[^\\${}%&~]+/) || stream.next()
    return null
  },
  languageData: {
    commentTokens: { line: '%' },
    closeBrackets: { brackets: ['(', '[', '{', '$'] },
    wordChars: '\\@'
  },
  tokenTable: {
    command: t.function(t.variableName),
    keyword: t.keyword,
    sectionCmd: t.keyword,
    heading: t.heading,
    envName: t.className,
    labelName: t.labelName,
    fileName: t.string,
    pkgName: t.string,
    strong: t.strong,
    emphasis: t.emphasis,
    optArg: t.attributeValue,
    brace: t.brace,
    comment: t.lineComment,
    escape: t.escape,
    mathDelim: t.special(t.bracket),
    math: t.special(t.string),
    mathCmd: t.operatorKeyword,
    mathOp: t.operator,
    mathNumber: t.number,
    alignment: t.separator
  } as Record<string, Tag>
}

export const latexLanguage = StreamLanguage.define(parser)

export const latexHighlight = HighlightStyle.define([
  { tag: t.function(t.variableName), color: 'var(--syn-command)' },
  { tag: t.keyword, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: t.heading, color: 'var(--syn-heading)', fontWeight: '700' },
  { tag: t.className, color: 'var(--syn-env)' },
  { tag: t.labelName, color: 'var(--syn-label)' },
  { tag: t.string, color: 'var(--syn-string)' },
  { tag: t.strong, fontWeight: '700', color: 'var(--text)' },
  { tag: t.emphasis, fontStyle: 'italic', color: 'var(--text)' },
  { tag: t.attributeValue, color: 'var(--syn-opt)' },
  { tag: t.brace, color: 'var(--syn-brace)' },
  { tag: t.lineComment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.escape, color: 'var(--syn-escape)' },
  { tag: t.special(t.bracket), color: 'var(--syn-math-delim)', fontWeight: '600' },
  { tag: t.special(t.string), color: 'var(--syn-math)' },
  { tag: t.operatorKeyword, color: 'var(--syn-math-cmd)' },
  { tag: t.operator, color: 'var(--syn-math-delim)' },
  { tag: t.number, color: 'var(--syn-number)' },
  { tag: t.separator, color: 'var(--syn-keyword)', fontWeight: '700' }
])

/** Langage BibTeX minimal */
const bibParser: StreamParser<{ inEntry: boolean }> = {
  name: 'bibtex',
  startState: () => ({ inEntry: false }),
  token(stream) {
    if (stream.match(/^%.*/)) return 'comment'
    if (stream.match(/^@[a-zA-Z]+/)) return 'keyword'
    if (stream.match(/^[a-zA-Z_-]+(?=\s*=)/)) return 'property'
    if (stream.match(/^\{[^,{}]+,/)) return 'labelName'
    if (stream.match(/^"[^"]*"/)) return 'string'
    if (stream.match(/^\d+/)) return 'number'
    if (stream.match(/^[{}]/)) return 'brace'
    if (stream.match(/^\\[a-zA-Z]+/)) return 'command'
    stream.next()
    return null
  },
  languageData: { commentTokens: { line: '%' }, closeBrackets: { brackets: ['{', '"', '('] } },
  tokenTable: {
    comment: t.lineComment,
    keyword: t.keyword,
    property: t.propertyName,
    labelName: t.labelName,
    command: t.function(t.variableName),
    brace: t.brace
  } as Record<string, Tag>
}

export const bibLanguage = StreamLanguage.define(bibParser)

export const bibHighlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: t.propertyName, color: 'var(--syn-env)' },
  { tag: t.labelName, color: 'var(--syn-label)', fontWeight: '600' },
  { tag: t.string, color: 'var(--syn-string)' },
  { tag: t.number, color: 'var(--syn-number)' },
  { tag: t.lineComment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.brace, color: 'var(--syn-brace)' },
  { tag: t.function(t.variableName), color: 'var(--syn-command)' }
])

export function latex(): LanguageSupport {
  return new LanguageSupport(latexLanguage)
}
