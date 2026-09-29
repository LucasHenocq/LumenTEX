import { execFile } from 'child_process'
import path from 'path'

// Sous Windows, le tar du système (bsdtar) : un tar GNU (Git, MSYS) placé avant dans le PATH lit « C: » comme un hôte distant
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'

export function tar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => execFile(TAR, args, (err) => (err ? reject(err) : resolve())))
}
