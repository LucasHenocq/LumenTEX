/** Analyse statique des sources : labels, bibliographie, plan, commandes utilisateur. */

export interface LabelInfo {
  name: string
  file: string
  line: number
  context: string
}

export interface BibEntry {
  key: string
  type: string
  title: string
  author: string
  year: string
  file: string
  line: number
}

export interface UserCommand {
  name: string
  args: number
  file: string
}

export interface OutlineItem {
  level: number
  kind: string
  title: string
  file: string
  line: number
}

export const SECTION_LEVELS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
  frametitle: 3
}

/** Retire les commentaires en conservant la longueur des lignes */
export function stripComments(line: string): string {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') {
      i++
      continue
    }
    if (line[i] === '%') return line.slice(0, i)
  }
  return line
}

/** Lit un argument entre accolades à partir de `start` (qui doit pointer sur « { ») */
export function readGroup(text: string, start: number): { value: string; end: number } | null {
  if (text[start] !== '{') return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return { value: text.slice(start + 1, i), end: i + 1 }
  }
  return null
}

export function cleanTitle(s: string): string {
  return s
    .replace(/\\(textbf|textit|emph|texttt|textsc|mathbf|text|mbox|underline)\{([^{}]*)\}/g, '$2')
    .replace(/\\label\{[^}]*\}/g, '')
    .replace(/\\(LaTeX|TeX)\b\{?\}?/g, '$1')
    .replace(/~/g, ' ')
    .replace(/\\\\/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractLabels(file: string, text: string): LabelInfo[] {
  const out: LabelInfo[] = []
  const lines = text.split('\n')
  const re = /\\label\{([^}]+)\}/g
  for (let i = 0; i < lines.length; i++) {
    const l = stripComments(lines[i])
    if (!l.includes('\\label')) continue
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(l))) {
      out.push({ name: m[1].trim(), file, line: i + 1, context: labelContext(lines, i) })
    }
  }
  return out
}

function labelContext(lines: string[], idx: number): string {
  for (let j = idx; j >= Math.max(0, idx - 8); j--) {
    const l = lines[j]
    const sec = /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\{([^}]*)\}/.exec(l)
    if (sec) return `${sec[1]} : ${cleanTitle(sec[2])}`
    const cap = /\\caption\{([^}]*)\}/.exec(l)
    if (cap) return cleanTitle(cap[1])
    const env = /\\begin\{(equation|align|figure|table|theorem|lemma|definition|proposition|gather)\*?\}/.exec(l)
    if (env) return env[1]
  }
  return cleanTitle(lines[idx]).slice(0, 80)
}

export function parseBib(file: string, text: string): BibEntry[] {
  const out: BibEntry[] = []
  const re = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const type = m[1].toLowerCase()
    if (type === 'comment' || type === 'string' || type === 'preamble') continue
    const start = re.lastIndex
    const next = text.indexOf('\n@', start)
    const body = text.slice(start, next < 0 ? undefined : next)
    const field = (name: string): string => {
      const fm = new RegExp(`\\b${name}\\s*=\\s*(?:\\{((?:[^{}]|\\{[^{}]*\\})*)\\}|"([^"]*)"|(\\d+))`, 'i').exec(body)
      return fm ? (fm[1] ?? fm[2] ?? fm[3] ?? '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim() : ''
    }
    out.push({
      key: m[2],
      type,
      title: field('title'),
      author: field('author'),
      year: field('year') || field('date').slice(0, 4),
      file,
      line: text.slice(0, m.index).split('\n').length
    })
  }
  return out
}

export function extractCommands(file: string, text: string): UserCommand[] {
  const out: UserCommand[] = []
  const re = /\\(?:newcommand|renewcommand|providecommand|DeclareMathOperator)\*?\s*\{?\\([a-zA-Z@]+)\}?(?:\[(\d)\])?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push({ name: m[1], args: m[2] ? Number(m[2]) : 0, file })
  const re2 = /\\def\\([a-zA-Z@]+)/g
  while ((m = re2.exec(text))) out.push({ name: m[1], args: 0, file })
  return out
}

export function extractEnvironments(text: string): string[] {
  const out = new Set<string>()
  const re = /\\(?:newenvironment|newtheorem|renewenvironment|newtcolorbox)\*?\s*\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.add(m[1])
  return [...out]
}

export function extractOutline(file: string, text: string): OutlineItem[] {
  const out: OutlineItem[] = []
  const lines = text.split('\n')
  const re = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph|frametitle)\*?\s*(?:\[[^\]]*\])?\s*\{/g
  for (let i = 0; i < lines.length; i++) {
    const l = stripComments(lines[i])
    if (!l.includes('\\')) continue
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(l))) {
      // l'argument peut se poursuivre sur les lignes suivantes
      const rest = l.slice(m.index + m[0].length - 1) + '\n' + lines.slice(i + 1, i + 4).join('\n')
      const g = readGroup(rest, 0)
      const title = cleanTitle(g ? g.value : rest.slice(1, 60))
      out.push({ level: SECTION_LEVELS[m[1]], kind: m[1], title: title || '(sans titre)', file, line: i + 1 })
    }
    const fr = /\\begin\{frame\}(?:<[^>]*>)?(?:\[[^\]]*\])?\{([^}]*)\}/.exec(l)
    if (fr) out.push({ level: 3, kind: 'frametitle', title: cleanTitle(fr[1]) || 'Diapositive', file, line: i + 1 })
  }
  return out
}

/** Fichiers inclus par \input / \include / \subfile */
export function extractIncludes(text: string): string[] {
  const out: string[] = []
  const re = /\\(?:input|include|subfile)\s*\{([^}]+)\}/g
  for (const line of text.split('\n')) {
    const l = stripComments(line)
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(l))) out.push(m[1].trim())
  }
  return out
}

export function resolveTexPath(name: string, fromFile: string, files: Set<string>): string | null {
  const dir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : ''
  const candidates = [name, name + '.tex']
  for (const c of candidates) {
    const norm = normalize(c)
    if (files.has(norm)) return norm
    const rel = normalize(dir ? `${dir}/${c}` : c)
    if (files.has(rel)) return rel
  }
  return null
}

export function normalize(p: string): string {
  const parts: string[] = []
  for (const seg of p.replace(/^\.\//, '').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

/** Ordre des fichiers à partir du fichier principal (parcours des inclusions) */
export function documentFiles(main: string, contents: Map<string, string>): string[] {
  const files = new Set(contents.keys())
  const order: string[] = []
  const visit = (f: string): void => {
    if (order.includes(f)) return
    order.push(f)
    const text = contents.get(f)
    if (!text) return
    for (const inc of extractIncludes(text)) {
      const r = resolveTexPath(inc, f, files)
      if (r) visit(r)
    }
  }
  visit(main)
  return order
}

/** Plan complet en suivant les inclusions, dans l'ordre du document */
export function buildOutline(main: string, contents: Map<string, string>): OutlineItem[] {
  const files = new Set(contents.keys())
  const out: OutlineItem[] = []
  const seen = new Set<string>()
  const visit = (f: string): void => {
    if (seen.has(f)) return
    seen.add(f)
    const text = contents.get(f)
    if (!text) return
    const items = extractOutline(f, text)
    // entrelacer sections et inclusions selon les numéros de ligne
    const lines = text.split('\n')
    const incs: { line: number; target: string }[] = []
    const re = /\\(?:input|include|subfile)\s*\{([^}]+)\}/g
    lines.forEach((line, i) => {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      const l = stripComments(line)
      while ((m = re.exec(l))) {
        const r = resolveTexPath(m[1].trim(), f, files)
        if (r) incs.push({ line: i + 1, target: r })
      }
    })
    let k = 0
    for (const item of items) {
      while (k < incs.length && incs[k].line < item.line) visit(incs[k++].target)
      out.push(item)
    }
    while (k < incs.length) visit(incs[k++].target)
  }
  visit(main)
  return out
}

/** Décompte approximatif des mots du texte (hors commandes, maths et commentaires) */
export function countWords(text: string): number {
  const body = text.includes('\\begin{document}') ? text.slice(text.indexOf('\\begin{document}')) : text
  const cleaned = body
    .split('\n')
    .map(stripComments)
    .join('\n')
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, ' ')
    .replace(/\\begin\{(equation|align|gather|multline|tikzpicture|verbatim|lstlisting)\*?\}[\s\S]*?\\end\{\1\*?\}/g, ' ')
    .replace(/\\(label|ref|eqref|cite\w*|includegraphics|usepackage|documentclass|begin|end|input|include|bibliography\w*|url|href)\*?(\[[^\]]*\])?\{[^}]*\}/g, ' ')
    .replace(/\\[a-zA-Z@]+\*?/g, ' ')
    .replace(/[{}[\]\\&~^_#]/g, ' ')
  const words = cleaned.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)
  return words ? words.length : 0
}

/** Trouve la ligne contenant \documentclass pour détecter un fichier principal */
export function isRootDocument(text: string): boolean {
  return /^\s*\\documentclass/m.test(text.split('\n').map(stripComments).join('\n'))
}
