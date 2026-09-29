import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { CompileResult } from '../shared/types'
import { parseDiagnostics } from './logparser'
import { getSettings } from './store'
import { findTectonic } from './tectonic'

export const BUILD_DIR = '.lumentex'

let current: ChildProcess | null = null

export function buildPaths(root: string, mainRel: string): { outDir: string; pdf: string; synctex: string; log: string } {
  const outDir = path.join(root, BUILD_DIR)
  const base = path.basename(mainRel).replace(/\.tex$/i, '')
  return {
    outDir,
    pdf: path.join(outDir, base + '.pdf'),
    synctex: path.join(outDir, base + '.synctex.gz'),
    log: path.join(outDir, base + '.log')
  }
}

export function cancelCompile(): void {
  current?.kill('SIGTERM')
}

export async function compile(
  root: string,
  mainRel: string,
  onProgress: (line: string) => void
): Promise<CompileResult> {
  const started = Date.now()
  const settings = getSettings()
  const tectonic = await findTectonic()
  if (!tectonic.found || !tectonic.path) {
    return {
      ok: false,
      pdfPath: null,
      diagnostics: [],
      log: '',
      output: '',
      durationMs: 0,
      error: 'Tectonic est introuvable. Installez-le depuis l’écran d’accueil ou les réglages.'
    }
  }

  const mainAbs = path.join(root, mainRel)
  const mainDir = path.dirname(mainAbs)
  const paths = buildPaths(root, mainRel)
  fs.mkdirSync(paths.outDir, { recursive: true })

  const args = ['-X', 'compile', '-Z', 'continue-on-errors', '--synctex', '--keep-logs', '--outdir', paths.outDir]
  if (settings.shellEscape) args.push('-Z', 'shell-escape')
  args.push(path.basename(mainAbs))

  const env = { ...process.env }
  if (settings.tectonicCacheDir.trim()) env.TECTONIC_CACHE_DIR = settings.tectonicCacheDir.trim()

  let pdfBefore = 0
  try {
    pdfBefore = fs.statSync(paths.pdf).mtimeMs
  } catch {
    /* pas encore de PDF */
  }

  cancelCompile()
  const output: string[] = []
  const code = await new Promise<number | null>((resolve) => {
    const child = spawn(tectonic.path!, args, { cwd: mainDir, env })
    current = child
    let pending = ''
    const onData = (chunk: Buffer): void => {
      pending += chunk.toString('utf8')
      const parts = pending.split('\n')
      pending = parts.pop() ?? ''
      for (const l of parts) {
        output.push(l)
        const m = /^note: (downloading .*|Running .*|Rerunning .*|generating format .*)$/.exec(l)
        if (m) onProgress(m[1])
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (err) => {
      output.push('error: ' + err.message)
      resolve(-1)
    })
    child.on('close', (c) => {
      if (pending) output.push(pending)
      if (current === child) current = null
      resolve(c)
    })
  })

  const outputText = output.join('\n')
  let log = ''
  try {
    log = fs.readFileSync(paths.log, 'utf8')
  } catch {
    /* pas de log */
  }

  let pdfOk = false
  try {
    pdfOk = fs.statSync(paths.pdf).mtimeMs > pdfBefore
  } catch {
    pdfOk = false
  }

  const diagnostics = parseDiagnostics(log, outputText, root, mainDir)
  return {
    ok: pdfOk && code === 0,
    pdfPath: fs.existsSync(paths.pdf) ? paths.pdf : null,
    diagnostics,
    log,
    output: outputText,
    durationMs: Date.now() - started,
    error: code === null ? 'Compilation interrompue' : undefined
  }
}
