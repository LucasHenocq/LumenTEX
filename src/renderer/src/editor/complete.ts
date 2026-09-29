import {
  snippet,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { CLASSES, COMMANDS, ENVIRONMENTS, PACKAGES } from '../latex/data'
import { index } from '../lib/projectIndex'
import { store } from '../store'

let commandOptions: Completion[] | null = null

function baseCommandOptions(): Completion[] {
  if (commandOptions) return commandOptions
  const opts: Completion[] = []
  for (const [name, tpl, info, math] of COMMANDS) {
    const label = '\\' + name
    const detail = math ? 'maths' : undefined
    if (tpl) opts.push(snippetCompletion('\\' + tpl, { label, info, detail, type: math ? 'function' : 'keyword' }))
    else opts.push({ label, info, detail, type: math ? 'constant' : 'keyword', apply: label })
  }
  // Raccourcis \begin{env} complets
  for (const [env, body, info, arg] of ENVIRONMENTS) {
    opts.push(
      snippetCompletion(`\\begin{${env}}${arg ?? ''}\n\t${body}\n\\end{${env}}`, {
        label: `\\begin{${env}}`,
        info,
        detail: 'environnement',
        type: 'class',
        boost: -1
      })
    )
  }
  commandOptions = opts
  return opts
}

function userCommandOptions(): Completion[] {
  const seen = new Set(COMMANDS.map((c) => c[0]))
  const out: Completion[] = []
  for (const c of index.commands) {
    if (seen.has(c.name)) continue
    seen.add(c.name)
    const args = Array.from({ length: c.args }, (_, i) => `{\${${i + 1}:#${i + 1}}}`).join('')
    out.push(
      c.args
        ? snippetCompletion(`\\${c.name}${args}`, { label: '\\' + c.name, detail: 'projet', info: c.file, type: 'variable', boost: 2 })
        : { label: '\\' + c.name, detail: 'projet', info: c.file, type: 'variable', boost: 2 }
    )
  }
  return out
}

function commandSource(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/\\[a-zA-Z@]*\*?/)
  if (!word) return null
  if (word.from === word.to && !ctx.explicit) return null
  // Ne pas compléter après « \\ » (retour à la ligne)
  if (ctx.state.sliceDoc(word.from - 1, word.from) === '\\') return null
  return {
    from: word.from,
    options: [...userCommandOptions(), ...baseCommandOptions()],
    validFor: /^\\[a-zA-Z@]*\*?$/
  }
}

function withClosingBrace(template: string) {
  return (view: EditorView, completion: Completion, from: number, to: number): void => {
    const next = view.state.sliceDoc(to, to + 1)
    snippet(template)(view, completion, from, next === '}' ? to + 1 : to)
  }
}

function environmentSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/\\begin\{[a-zA-Z*]*/)
  if (!m) return null
  const from = m.from + '\\begin{'.length
  const known = new Set(ENVIRONMENTS.map((e) => e[0]))
  const options: Completion[] = ENVIRONMENTS.map(([env, body, info, arg]) => ({
    label: env,
    info,
    type: 'class',
    apply: withClosingBrace(`${env}}${arg ?? ''}\n\t${body}\n\\end{${env}}`)
  }))
  for (const env of index.envs) {
    if (known.has(env)) continue
    options.push({ label: env, detail: 'projet', type: 'class', boost: 1, apply: withClosingBrace(`${env}}\n\t\${}\n\\end{${env}}`) })
  }
  return { from, options, validFor: /^[a-zA-Z*]*$/ }
}

function endSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/\\end\{[a-zA-Z*]*/)
  if (!m) return null
  const before = ctx.state.sliceDoc(Math.max(0, m.from - 200000), m.from)
  const stack: string[] = []
  const re = /\\(begin|end)\{([^}]+)\}/g
  let r: RegExpExecArray | null
  while ((r = re.exec(before))) {
    if (r[1] === 'begin') stack.push(r[2])
    else {
      const i = stack.lastIndexOf(r[2])
      if (i >= 0) stack.splice(i)
    }
  }
  const open = stack.reverse()
  if (!open.length) return null
  return {
    from: m.from + 5,
    options: open.map((env, i) => ({
      label: env,
      type: 'class',
      boost: 10 - i,
      detail: i === 0 ? 'à fermer' : undefined,
      apply: (view: EditorView, _c: Completion, from: number, to: number) => {
        const next = view.state.sliceDoc(to, to + 1)
        const end = next === '}' ? to + 1 : to
        view.dispatch({ changes: { from, to: end, insert: env + '}' }, selection: { anchor: from + env.length + 1 } })
      }
    })),
    validFor: /^[a-zA-Z*]*$/
  }
}

/** Liste d'arguments séparés par des virgules : on complète l'élément courant */
function listArgument(ctx: CompletionContext, re: RegExp): number | null {
  const m = ctx.matchBefore(re)
  if (!m) return null
  const text = m.text
  const brace = text.lastIndexOf('{')
  const comma = text.lastIndexOf(',')
  let from = m.from + Math.max(brace, comma) + 1
  while (ctx.state.sliceDoc(from, from + 1) === ' ') from++
  return from
}

function refSource(ctx: CompletionContext): CompletionResult | null {
  const from = listArgument(ctx, /\\(?:[a-zA-Z]*ref|[cC]ref|autoref|eqref|pageref|nameref|vref|hyperref\[)\*?\{?[^}\]]*$/)
  if (from === null) return null
  const seen = new Set<string>()
  const options: Completion[] = []
  for (const l of index.labels) {
    if (seen.has(l.name)) continue
    seen.add(l.name)
    options.push({ label: l.name, detail: `${l.file}:${l.line}`, info: l.context, type: 'constant' })
  }
  return { from, options, validFor: /^[^,}\s]*$/ }
}

function citeSource(ctx: CompletionContext): CompletionResult | null {
  const from = listArgument(ctx, /\\(?:[a-zA-Z]*cite[a-zA-Z]*|nocite)\*?(?:\[[^\]]*\])*\{[^}]*$/)
  if (from === null) return null
  const options: Completion[] = index.bib.map((b) => ({
    label: b.key,
    detail: [b.author.split(/ and /)[0]?.split(',')[0], b.year].filter(Boolean).join(', '),
    info: b.title ? `${b.title}\n${b.author}` : b.type,
    type: 'text'
  }))
  return { from, options, validFor: /^[^,}\s]*$/ }
}

function fileSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/\\(input|include|subfile|includegraphics|bibliography|addbibresource|includepdf|lstinputlisting)(?:\[[^\]]*\])?\{[^}]*$/)
  if (!m) return null
  const cmd = /\\(\w+)/.exec(m.text)![1]
  const from = m.from + m.text.lastIndexOf('{') + 1
  let filter: RegExp
  let strip: RegExp | null = null
  switch (cmd) {
    case 'includegraphics':
      filter = /\.(png|jpe?g|pdf|eps|svg|gif|bmp|tiff?)$/i
      break
    case 'bibliography':
      filter = /\.bib$/i
      strip = /\.bib$/i
      break
    case 'addbibresource':
      filter = /\.bib$/i
      break
    case 'includepdf':
      filter = /\.pdf$/i
      break
    case 'lstinputlisting':
      filter = /\.\w+$/
      break
    default:
      filter = /\.tex$/i
      strip = /\.tex$/i
  }
  const main = store.get().mainFile ?? ''
  const baseDir = main.includes('/') ? main.slice(0, main.lastIndexOf('/') + 1) : ''
  const options: Completion[] = index.files
    .filter((f) => filter.test(f) && f !== main && !f.startsWith('.'))
    .map((f) => {
      let label = baseDir && f.startsWith(baseDir) ? f.slice(baseDir.length) : f
      if (strip) label = label.replace(strip, '')
      return { label, type: 'text', detail: cmd === 'includegraphics' ? 'image' : undefined }
    })
  return { from, options, validFor: /^[^}]*$/ }
}

function packageSource(ctx: CompletionContext): CompletionResult | null {
  const from = listArgument(ctx, /\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{[^}]*$/)
  if (from !== null) {
    return { from, options: PACKAGES.map(([p, info]) => ({ label: p, info, type: 'namespace' })), validFor: /^[\w-]*$/ }
  }
  const m = ctx.matchBefore(/\\documentclass(?:\[[^\]]*\])?\{[^}]*$/)
  if (m) {
    return {
      from: m.from + m.text.lastIndexOf('{') + 1,
      options: CLASSES.map(([c, info]) => ({ label: c, info, type: 'namespace' })),
      validFor: /^[\w-]*$/
    }
  }
  return null
}

export const latexCompletionSources = [environmentSource, endSource, refSource, citeSource, fileSource, packageSource, commandSource]
