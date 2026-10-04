import { app, net } from 'electron'
import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { InstallProgress, TectonicStatus } from '../shared/types'
import { tar } from './tar'
import { getSettings } from './store'

const TECTONIC_VERSION = '0.17.0'

export const bundledDir = (): string => path.join(app.getPath('userData'), 'bin')
const WIN = process.platform === 'win32'
const EXE = WIN ? 'tectonic.exe' : 'tectonic'
const bundledPath = (): string => path.join(bundledDir(), EXE)

function isExecutable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK)
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function version(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: 8000 }, (err, stdout) => {
      if (err) return resolve(null)
      resolve(stdout.trim().replace(/^Tectonic\s*/i, '') || '?')
    })
  })
}

function candidates(): { path: string; source: TectonicStatus['source'] }[] {
  const list: { path: string; source: TectonicStatus['source'] }[] = []
  const custom = getSettings().tectonicPath.trim()
  if (custom) list.push({ path: custom, source: 'custom' })
  list.push({ path: bundledPath(), source: 'bundled' })
  list.push({ path: '/opt/homebrew/bin/tectonic', source: 'homebrew' })
  list.push({ path: '/usr/local/bin/tectonic', source: 'homebrew' })
  list.push({ path: path.join(os.homedir(), '.cargo', 'bin', EXE), source: 'path' })
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir) list.push({ path: path.join(dir, EXE), source: 'path' })
  }
  return list
}

let cached: TectonicStatus | null = null

export async function findTectonic(force = false): Promise<TectonicStatus> {
  if (cached && !force) return cached
  const seen = new Set<string>()
  for (const c of candidates()) {
    if (seen.has(c.path)) continue
    seen.add(c.path)
    if (!isExecutable(c.path)) continue
    const v = await version(c.path)
    if (v) {
      cached = { found: true, path: c.path, version: v, source: c.source }
      return cached
    }
  }
  cached = { found: false }
  return cached
}

export async function installTectonic(onProgress: (p: InstallProgress) => void): Promise<TectonicStatus> {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  // Windows : seule une version x86_64 existe (tourne aussi en émulation sur ARM).
  const file = WIN
    ? `tectonic-${TECTONIC_VERSION}-x86_64-pc-windows-msvc.zip`
    : process.platform === 'linux'
      ? `tectonic-${TECTONIC_VERSION}-${arch}-unknown-linux-musl.tar.gz`
      : `tectonic-${TECTONIC_VERSION}-${arch}-apple-darwin.tar.gz`
  const url = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/${file}`
  const dir = bundledDir()
  fs.mkdirSync(dir, { recursive: true })
  const archive = path.join(dir, file)

  try {
    const res = await net.fetch(url)
    if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (HTTP ${res.status})`)
    const total = Number(res.headers.get('content-length')) || 0
    const out = fs.createWriteStream(archive)
    const reader = res.body.getReader()
    let received = 0
    let lastEmit = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r))
      if (Date.now() - lastEmit > 100) {
        lastEmit = Date.now()
        onProgress({ phase: 'download', received, total })
      }
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))

    onProgress({ phase: 'extract' })
    await tar(['xf', archive, '-C', dir])
    fs.chmodSync(bundledPath(), 0o755)
    fs.rmSync(archive, { force: true })

    const status = await findTectonic(true)
    if (!status.found) throw new Error('Le binaire installé ne fonctionne pas')
    onProgress({ phase: 'done' })
    return status
  } catch (e) {
    fs.rmSync(archive, { force: true })
    onProgress({ phase: 'error', message: (e as Error).message })
    throw e
  }
}
