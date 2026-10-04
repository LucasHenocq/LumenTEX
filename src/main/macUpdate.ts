import { app, dialog, net, shell, type BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'

// Mises à jour sur macOS : sans signature Apple, l'installation automatique est impossible. L'app vérifie la dernière
// release GitHub, puis, sur demande, télécharge le .dmg de son processeur et l'ouvre : la fenêtre « glisser dans
// Applications » apparaît. Un fichier téléchargé par l'app elle-même n'est pas mis en quarantaine par macOS.

const REPO = 'LucasHenocq/LumenTEX'

export interface MacUpdate {
  version: string
  dmg: string
  page: string
}

/** a plus récente que b (versions « x.y.z ») */
function isNewer(a: string, b: string): boolean {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

/** Dernière release, si elle est plus récente et contient déjà le .dmg de ce Mac (ajouté quelques minutes après) */
export async function checkMacUpdate(): Promise<MacUpdate | null> {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return null
    const r = (await res.json()) as { tag_name: string; html_url: string; assets: { name: string; browser_download_url: string }[] }
    const version = r.tag_name.replace(/^v/, '')
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const dmg = r.assets.find((a) => a.name.endsWith(`-${arch}.dmg`))?.browser_download_url
    return dmg && isNewer(version, app.getVersion()) ? { version, dmg, page: r.html_url } : null
  } catch {
    return null
  }
}

/** Télécharge le .dmg dans Téléchargements, l'ouvre et propose de quitter ; en cas d'échec, ouvre la page de la release */
export async function installMacUpdate(u: MacUpdate, win: BrowserWindow | null, onProgress: (percent: number) => void): Promise<void> {
  const file = path.join(app.getPath('downloads'), `Lumen-TeX-${u.version}.dmg`)
  try {
    const res = await net.fetch(u.dmg)
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length')) || 0
    const out = fs.createWriteStream(file)
    const reader = res.body.getReader()
    let received = 0
    let last = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r))
      if (total && Date.now() - last > 300) {
        last = Date.now()
        onProgress(Math.round((received / total) * 100))
      }
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
    const err = await shell.openPath(file)
    if (err) throw new Error(err)
  } catch {
    fs.rmSync(file, { force: true })
    await shell.openExternal(u.page)
    return
  }
  const opts = {
    type: 'info' as const,
    message: `Lumen TeX ${u.version} est prêt à être installé`,
    detail: 'Dans la fenêtre qui vient de s’ouvrir, glisse Lumen TeX dans le dossier Applications et choisis « Remplacer ». Rouvre ensuite Lumen TeX.',
    buttons: ['Quitter Lumen TeX', 'Plus tard'],
    defaultId: 0,
    cancelId: 1
  }
  const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  if (response === 0) app.quit()
}
