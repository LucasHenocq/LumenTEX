import { spawn, type ChildProcess } from 'child_process'

// Connexion d'une CLI (Claude Code, GitHub Copilot) : la CLI ouvre le navigateur et attend le retour OAuth.
// L'URL affichée est remontée à l'interface pour pouvoir rouvrir la page si le navigateur ne s'est pas ouvert.

let current: ChildProcess | null = null

export function runLogin(
  bin: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  onUrl: (url: string) => void,
  opts: { cwd?: string; input?: string } = {}
): Promise<void> {
  cancelLogin()
  return new Promise((resolve, reject) => {
    const c = spawn(bin, args, { env, cwd: opts.cwd })
    current = c
    // Réponse automatique à une question de la CLI (ex. « ouvrir le navigateur ? »)
    if (opts.input) c.stdin.write(opts.input)
    let out = ''
    let sentUrl = false
    const read = (d: Buffer): void => {
      out += d.toString('utf8')
      const url = /https:\/\/\S+/.exec(out)?.[0]
      if (url && !sentUrl) {
        sentUrl = true
        onUrl(url)
      }
    }
    c.stdout.on('data', read)
    c.stderr.on('data', read)
    c.on('error', (e) => reject(e))
    c.on('close', (code, signal) => {
      if (current === c) current = null
      if (signal) return reject(new Error('Connexion annulée'))
      if (code) return reject(new Error(out.replace(/https:\/\/\S+/g, '').trim().split('\n').pop() || `code ${code}`))
      resolve()
    })
  })
}

/** Code collé par l'utilisateur quand le retour automatique du navigateur n'a pas fonctionné */
export function sendLoginCode(code: string): void {
  current?.stdin?.write(code.trim() + '\n')
}

export function cancelLogin(): void {
  current?.kill()
  current = null
}
