import fs from 'fs'
import path from 'path'
import type { Diagnostic } from '../shared/types'

const TEX_EXTS = /\.(tex|sty|cls|def|cfg|fd|clo|ldf|aux|bbl|toc|lof|lot|out|ind|ltx|dtx|bib|code\.tex)$/i

interface Resolver {
  (name: string): { file?: string; rawFile: string } | null
}

/** Construit une fonction qui résout un nom de fichier rapporté par TeX en chemin relatif au projet. */
function makeResolver(root: string, mainDir: string): Resolver {
  const cache = new Map<string, { file?: string; rawFile: string } | null>()
  return (name) => {
    if (cache.has(name)) return cache.get(name)!
    let result: { file?: string; rawFile: string } | null = null
    const clean = name.replace(/^"|"$/g, '')
    for (const cand of [clean, clean + '.tex']) {
      const abs = path.isAbsolute(cand) ? cand : path.resolve(mainDir, cand)
      try {
        if (fs.statSync(abs).isFile()) {
          const rel = path.relative(root, abs)
          result =
            !rel.startsWith('..') && !path.isAbsolute(rel)
              ? { file: rel.split(path.sep).join('/'), rawFile: clean }
              : { rawFile: clean }
          break
        }
      } catch {
        /* inexistant */
      }
    }
    if (!result && TEX_EXTS.test(clean)) result = { rawFile: clean }
    cache.set(name, result)
    return result
  }
}

/** Recolle les lignes coupées à 79 caractères par TeX. */
function unwrap(log: string): string[] {
  const raw = log.split(/\r?\n/)
  const out: string[] = []
  let buf = ''
  for (const line of raw) {
    buf += line
    if (line.length !== 79) {
      out.push(buf)
      buf = ''
    }
  }
  if (buf) out.push(buf)
  return out
}

function key(d: Diagnostic): string {
  return `${d.severity === 'error' ? 'E' : 'W'}|${d.file ?? d.rawFile ?? ''}|${d.line ?? ''}|${d.message
    .slice(0, 48)
    .toLowerCase()}`
}

export function parseDiagnostics(log: string, output: string, root: string, mainDir: string): Diagnostic[] {
  const resolve = makeResolver(root, mainDir)
  const diags: Diagnostic[] = []
  const seen = new Map<string, Diagnostic>()

  const push = (d: Diagnostic): void => {
    if (/^(Overfull|Underfull)/.test(d.message)) {
      d.kind = 'badbox'
      d.severity = 'info'
    }
    const k = key(d)
    const prev = seen.get(k)
    if (prev) {
      if (!prev.context && d.context) prev.context = d.context
      return
    }
    seen.set(k, d)
    diags.push(d)
  }

  // --- 1. Journal TeX (.log) ---------------------------------------------
  const lines = unwrap(log)
  const stack: ({ file?: string; rawFile: string } | null)[] = []
  const current = (): { file?: string; rawFile: string } | undefined => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i]) return stack[i]!
    return undefined
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('! ')) {
      let message = line.slice(2).trim()
      let lineNo: number | undefined
      let context: string | undefined
      for (let j = i + 1; j < Math.min(lines.length, i + 14); j++) {
        const m = /^l\.(\d+)\s?(.*)$/.exec(lines[j])
        if (m) {
          lineNo = Number(m[1])
          const next = lines[j + 1] ?? ''
          context = (m[2] + (next.trim() ? ' ' + next.trim() : '')).trim()
          break
        }
        if (j === i + 1 && lines[j] && !lines[j].startsWith('<') && !/^\s/.test(lines[j]) && !lines[j].startsWith('l.')) {
          // Messages d'erreur sur plusieurs lignes (LaTeX Error)
          if (!/^(See the|Type\s+H|\.\.\.)/.test(lines[j])) message += ' ' + lines[j].trim()
        }
      }
      message = message.replace(/^LaTeX Error:\s*/, '').replace(/\.$/, '')
      const f = current()
      push({ severity: 'error', message, file: f?.file, rawFile: f?.rawFile, line: lineNo, context, kind: 'general' })
      continue
    }

    let m = /^(LaTeX|Package (\S+)|Class (\S+)|pdfTeX|XeTeX)( Font)? Warning: (.*)$/.exec(line)
    if (m) {
      const pkg = m[2] ?? m[3]
      let message = m[5]
      // lignes de continuation : « (paquet) … » ou lignes indentées
      let j = i + 1
      while (j < lines.length && lines[j].trim() !== '') {
        const cont = lines[j]
        if (pkg && cont.startsWith(`(${pkg})`)) message += ' ' + cont.slice(pkg.length + 2).trim()
        else if (/^\s+\S/.test(cont)) message += ' ' + cont.trim()
        else break
        j++
      }
      const lm = /on input line (\d+)/.exec(message)
      const lineNo = lm ? Number(lm[1]) : undefined
      message = message.replace(/\s*on input line \d+\.?/, '').replace(/\s+/g, ' ').trim()
      const f = current()
      const isFont = !!m[4]
      let kind: Diagnostic['kind'] = 'general'
      if (/^Reference|undefined references/.test(message)) kind = 'reference'
      if (/^Citation|undefined citations/.test(message)) kind = 'citation'
      push({
        severity: isFont ? 'info' : 'warning',
        message: pkg ? `[${pkg}] ${message}` : message,
        file: f?.file,
        rawFile: f?.rawFile,
        line: lineNo,
        kind
      })
    }

    m = /^(Overfull|Underfull) \\[hv]box \((.*?)\) (?:in paragraph at lines (\d+)--(\d+)|detected at line (\d+)|in alignment at lines (\d+)--(\d+)|has occurred while \\output is active)/.exec(
      line
    )
    if (m) {
      const f = current()
      const lineNo = Number(m[3] ?? m[5] ?? m[6]) || undefined
      push({
        severity: 'info',
        message: line.replace(/\s*\[\]\s*$/, ''),
        file: f?.file,
        rawFile: f?.rawFile,
        line: lineNo,
        kind: 'badbox'
      })
    }

    // Suivi de la pile des fichiers ouverts via les parenthèses
    for (let c = 0; c < line.length; c++) {
      const ch = line[c]
      if (ch === '(') {
        const rest = line.slice(c + 1)
        const fm = /^("[^"]+"|[^\s(){}[\]]+)/.exec(rest)
        const name = fm?.[1]
        const entry = name && !/^\d/.test(name) ? resolve(name) : null
        stack.push(entry)
        if (fm && entry) c += fm[1].length
      } else if (ch === ')') {
        stack.pop()
      }
    }
  }

  // --- 2. Sortie de Tectonic (stderr) : « error: fichier:ligne: message » ---
  let genericError: string | null = null
  for (const raw of output.split(/\r?\n/)) {
    const m = /^(error|warning): (.+?):(\d+): (.*)$/.exec(raw)
    if (m) {
      const f = resolve(m[2]) ?? { rawFile: m[2] }
      push({
        severity: m[1] === 'error' ? 'error' : 'warning',
        message: m[4].trim().replace(/\.$/, ''),
        file: f.file,
        rawFile: f.rawFile,
        line: Number(m[3]),
        kind: 'general'
      })
      continue
    }
    const g = /^error: (.*)$/.exec(raw)
    if (g && !/something bad happened|unrecoverable error|^halted/.test(g[1]) && !genericError) genericError = g[1]
  }

  if (genericError && !diags.some((d) => d.severity === 'error')) {
    diags.push({ severity: 'error', message: genericError, kind: 'general' })
  }

  // Fusionner les erreurs issues de stderr et du log (même ligne, même fichier)
  const errors = diags.filter((d) => d.severity === 'error')
  for (const e of errors) {
    if (e.context) continue
    const twin = errors.find((o) => o !== e && o.context && o.line === e.line && (o.file ?? o.rawFile) === (e.file ?? e.rawFile))
    if (twin) e.context = twin.context
  }

  const rank = { error: 0, warning: 1, info: 2 }
  const unique: Diagnostic[] = []
  const seenErr = new Set<string>()
  for (const d of diags) {
    if (d.severity === 'error') {
      const k = `${d.file ?? d.rawFile}|${d.line}`
      if (d.line && seenErr.has(k)) continue
      seenErr.add(k)
    }
    unique.push(d)
  }
  return unique.sort((a, b) => rank[a.severity] - rank[b.severity])
}
