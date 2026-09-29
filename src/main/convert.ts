import { app } from 'electron'
import { execFile, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { CONVERTIBLE } from '../shared/convert'
import type { AiEngine, ConvertEvent, ConvertOptions, ConvertSource } from '../shared/types'
import { runClaude } from './claude'
import { runGemini } from './gemini'
import { convertOllama, stopOllama } from './ollama'
import { runCopilot } from './ghcopilot'

// Image / PDF → LaTeX : le fichier est copié dans un dossier de travail temporaire, lu par l'agent
// (outil Read de Claude Code, pièce jointe de GitHub Copilot, référence @fichier de Gemini) qui répond par un bloc ```latex.

/** Formats lus par le système mais pas par les modèles : convertis en PNG (sips sous macOS, WIC sous Windows) */
const TO_PNG = /\.(heic|heif|tiff?|bmp)$/i

const jobsDir = (): string => path.join(app.getPath('temp'), 'lumen-convert')
const jobs = new Map<string, string>() // id → chemin du fichier source dans le dossier de travail
let child: ChildProcess | null = null

function toPng(src: string, dest: string): Promise<void> {
  // Windows : décodeurs WIC via WPF (HEIC seulement si l'extension « HEIF » du Microsoft Store est installée)
  const q = (p: string): string => `'${p.replace(/'/g, "''")}'`
  const [bin, args] =
    process.platform === 'win32'
      ? [
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            `Add-Type -AssemblyName PresentationCore; ` +
              `$d = [System.Windows.Media.Imaging.BitmapDecoder]::Create([Uri]${q(src)}, 'None', 'OnLoad'); ` +
              `$e = New-Object System.Windows.Media.Imaging.PngBitmapEncoder; $e.Frames.Add($d.Frames[0]); ` +
              `$s = [IO.File]::Create(${q(dest)}); $e.Save($s); $s.Close()`
          ]
        ]
      : ['sips', ['-s', 'format', 'png', src, '--out', dest]]
  return new Promise((resolve, reject) =>
    execFile(bin, args, (err) => (err || !fs.existsSync(dest) ? reject(new Error('Format d’image non pris en charge')) : resolve()))
  )
}

async function prepare(name: string, write: (dest: string) => void): Promise<ConvertSource> {
  if (!CONVERTIBLE.test(name)) throw new Error('Formats acceptés : PNG, JPEG, GIF, WebP, HEIC, TIFF, BMP et PDF')
  const id = randomUUID()
  const dir = path.join(jobsDir(), id)
  fs.mkdirSync(dir, { recursive: true })
  // Nom simple : la CLI le lit sans souci d'échappement
  const ext = path.extname(name).toLowerCase()
  let file = path.join(dir, 'source' + ext)
  write(file)
  if (TO_PNG.test(ext)) {
    const png = path.join(dir, 'source.png')
    await toPng(file, png)
    fs.rmSync(file)
    file = png
  }
  jobs.set(id, file)
  return {
    id,
    name,
    kind: file.endsWith('.pdf') ? 'pdf' : 'image',
    mime: file.endsWith('.pdf') ? 'application/pdf' : `image/${path.extname(file).slice(1).replace('jpg', 'jpeg')}`,
    data: new Uint8Array(fs.readFileSync(file))
  }
}

export const prepareFile = (src: string): Promise<ConvertSource> => prepare(path.basename(src), (dest) => fs.copyFileSync(src, dest))
export const prepareData = (name: string, data: Uint8Array): Promise<ConvertSource> =>
  prepare(name, (dest) => fs.writeFileSync(dest, data))

export function discard(id: string): void {
  const file = jobs.get(id)
  if (file) fs.rmSync(path.dirname(file), { recursive: true, force: true })
  jobs.delete(id)
}

export function discardAll(): void {
  fs.rmSync(jobsDir(), { recursive: true, force: true })
  jobs.clear()
}

export function stopConvert(): void {
  child?.kill()
  child = null
  stopOllama()
}

function instructions(fileRef: string, pdf: boolean, o: ConvertOptions): string {
  return [
    `Convertis fidèlement en LaTeX le contenu de ${fileRef}${pdf ? ', toutes les pages' : ''}.`,
    '',
    'Règles :',
    '- Reproduis le texte mot pour mot, dans sa langue, avec la même structure : titres (\\section*, \\subsection*…), paragraphes, listes, énumérations numérotées comme dans l’original.',
    '- Formules mathématiques exactes avec amsmath/amssymb : $…$ en ligne, equation*/align* pour les formules centrées ; ne résous rien, ne corrige rien.',
    '- Tableaux en tabular (booktabs si le style s’y prête).',
    '- Compilation par Tectonic (XeLaTeX, UTF-8) : accents écrits directement, jamais fontenc ni inputenc.',
    '- Photos et images : un environnement figure avec \\includegraphics[width=0.6\\linewidth]{image} et un commentaire % TODO décrivant l’image. Schémas simples (axes, courbes, figures géométriques) : TikZ si tu peux les reproduire fidèlement, sinon comme une image.',
    '- Écriture manuscrite : transcris au mieux ; marque un passage illisible par \\textbf{[?]}.',
    o.mode === 'fragment'
      ? `- Donne uniquement le contenu à insérer dans un document existant : pas de \\documentclass, de préambule ni de \\begin{document}.${
          o.packages ? ` Paquets déjà chargés par le document : ${o.packages}.` : ''
        } Si un paquet supplémentaire est indispensable, indique-le dans un commentaire % en première ligne.`
      : '- Donne un document complet et compilable (\\documentclass{article} … \\end{document}), avec babel dans la langue du document.',
    o.notes.trim() ? `\nConsignes de l’utilisateur (prioritaires) : ${o.notes.trim()}` : '',
    '',
    'Réponds uniquement avec un seul bloc ```latex, sans aucune explication avant ou après.'
  ].join('\n')
}

export function runConvert(id: string, engine: AiEngine, o: ConvertOptions, emit: (e: ConvertEvent) => void): Promise<void> {
  const file = jobs.get(id)
  if (!file) return Promise.reject(new Error('Fichier source introuvable, rechargez-le'))
  stopConvert()
  const cwd = path.dirname(file)
  const name = path.basename(file)
  const pdf = file.endsWith('.pdf')
  const onText = (text: string): void => emit({ type: 'text', text })

  if (engine === 'ollama') {
    // Modèle local multimodal : l'image (ou les pages du PDF rendues par l'interface) est jointe au message
    const images = pdf ? (o.pages ?? []) : [fs.readFileSync(file).toString('base64')]
    if (!images.length) return Promise.reject(new Error('Aucune page à convertir'))
    emit({ type: 'tool', name: 'Lecture' })
    return convertOllama(instructions(pdf ? `ces ${images.length} pages (images jointes, dans l’ordre)` : 'l’image jointe', false, o), images, onText)
  }

  const run =
    engine === 'gemini'
      ? runGemini(
          cwd,
          // « @fichier » : la CLI joint l'image ou le PDF au message ; mode plan = lecture seule
          ['-p', instructions(`@${name} (fichier joint)`, pdf, o), '--approval-mode', 'plan'],
          { onText, onTool: (tool) => emit({ type: 'tool', name: tool }) }
        )
      : engine === 'copilot'
      ? runCopilot(
          cwd,
          [
            '-p', instructions('l’image ou du document joint', pdf, o),
            '--attachment', file,
            // Lecture seule : ni commandes ni écriture de fichiers
            '--allow-all-tools',
            '--deny-tool', 'shell',
            '--deny-tool', 'write'
          ],
          onText
        )
      : runClaude(
          cwd,
          // Seul l'outil de lecture (images et PDF) est disponible ; rien n'est gardé dans l'historique de Claude Code
          ['--tools', 'Read', '--no-session-persistence'],
          instructions(`« ${name} » (dans le dossier courant, à lire avec l’outil Read)`, pdf, o),
          { onText, onTool: (tool) => emit({ type: 'tool', name: tool }) }
        )
  child = run.child
  return run.done.finally(() => {
    if (child === run.child) child = null
  })
}
