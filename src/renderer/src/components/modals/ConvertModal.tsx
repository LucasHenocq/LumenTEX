import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Copy, CornerDownLeft, FilePlus, FileUp, RotateCcw, ScanText, Square } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CONVERTIBLE } from '../../../../shared/convert'
import type { AiStatus, ConvertSource } from '../../../../shared/types'
import { getActivePath, textOf } from '../../editor/setup'
import { createFileWith, insertText } from '../../lib/actions'
import { contents } from '../../lib/projectIndex'
import { highlightTex } from '../../lib/texHighlight'
import { store, toast, useApp } from '../../store'
import { cleanError, ENGINES, Gate, modelLabel } from '../Copilot'
import { closeModal, ModalFrame } from '../Modals'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const MAX_PAGES = 12
const EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'heic', 'heif', 'tif', 'tiff', 'bmp']

/** Le bloc ```latex de la réponse (en cours d'écriture ou terminé) */
function extractLatex(text: string, finished: boolean): string | null {
  const m = /```(?:latex|tex)?[^\n]*\n([\s\S]*?)(?:\n?```|$)/.exec(text)
  if (m) return m[1]
  return finished && text.trim() ? text.trim() : null
}

/** Paquets du fichier principal, pour que le fragment n'utilise que ce qui est déjà chargé */
function documentPackages(): string {
  const main = store.get().mainFile
  const text = main ? (textOf(main) ?? contents.get(main) ?? '') : ''
  const names = [...text.matchAll(/^[^%\n]*\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/gm)].flatMap((m) => m[1].split(',').map((p) => p.trim()))
  return [...new Set(names)].filter(Boolean).join(', ')
}

/** Ollama ne lit que des images : pages du PDF rendues en PNG (base64), dans la limite de MAX_PAGES */
async function pdfToPngs(data: Uint8Array): Promise<string[]> {
  const task = pdfjsLib.getDocument({ data: data.slice() })
  const doc = await task.promise
  const out: string[] = []
  for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES); i++) {
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvas, viewport }).promise
    out.push(canvas.toDataURL('image/png').split(',')[1])
  }
  void task.destroy()
  return out
}

function PdfPages({ data }: { data: Uint8Array }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState(0)
  useEffect(() => {
    let cancelled = false
    // pdf.js s'approprie le tampon : on lui passe une copie
    const task = pdfjsLib.getDocument({ data: data.slice() })
    void task.promise
      .then(async (doc) => {
        if (cancelled || !box.current) return
        setPages(doc.numPages)
        box.current.replaceChildren()
        const width = box.current.clientWidth
        for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES) && !cancelled; i++) {
          const page = await doc.getPage(i)
          const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * devicePixelRatio })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          box.current?.appendChild(canvas)
          await page.render({ canvas, viewport }).promise
        }
      })
      .catch(() => !cancelled && setPages(-1))
    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [data])
  return (
    <>
      <div ref={box} className="cv-pages" />
      {pages === -1 && <div className="cv-note">Aperçu impossible, la conversion reste possible.</div>}
      {pages > MAX_PAGES && <div className="cv-note">… et {pages - MAX_PAGES} autres pages (converties aussi)</div>}
    </>
  )
}

export default function ConvertModal({ file }: { file?: string }): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const active = useApp((s) => s.active)
  const engine = settings.aiEngine
  const { name, setting } = ENGINES[engine]
  const model = settings[setting]
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [source, setSource] = useState<ConvertSource | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [mode, setMode] = useState<'fragment' | 'document'>(active ? 'fragment' : 'document')
  const [notes, setNotes] = useState('')
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [output, setOutput] = useState('')
  const [step, setStep] = useState('')
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const sourceId = useRef<string | null>(null)
  const running = useRef(false)
  const stopped = useRef(false)
  const outBox = useRef<HTMLPreElement>(null)
  const ready = !!status?.installed && status.loggedIn

  useEffect(() => {
    void window.api.aiStatus(engine).then(setStatus)
  }, [engine])

  // Nettoyage : arrêt de la conversion et suppression du dossier de travail
  useEffect(
    () => () => {
      if (running.current) void window.api.convertStop()
      if (sourceId.current) void window.api.convertDiscard(sourceId.current)
    },
    []
  )

  useEffect(
    () =>
      window.api.onConvertEvent((e) => {
        if (e.type === 'text') setOutput((o) => o + e.text)
        else setStep(e.name === 'Read' || e.name === 'Lecture' ? 'Lecture du fichier…' : `${e.name}…`)
      }),
    []
  )

  useEffect(() => {
    if (phase !== 'running') return
    const start = Date.now()
    setElapsed(0)
    const t = window.setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000)
    return () => window.clearInterval(t)
  }, [phase])

  const load = async (prepare: () => Promise<ConvertSource>): Promise<void> => {
    if (running.current) return
    setLoading(true)
    try {
      const s = await prepare()
      if (sourceId.current) void window.api.convertDiscard(sourceId.current)
      sourceId.current = s.id
      setSource(s)
      setOutput('')
      setError('')
      setPhase('idle')
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setLoading(false)
    }
  }
  const loadPath = (p: string): Promise<void> => load(() => window.api.convertPrepareFile(p))
  const loadFile = async (f: File): Promise<void> => {
    const p = window.api.pathForFile(f)
    if (p) return loadPath(p)
    // Capture collée : pas de chemin, on transmet les octets
    const ext = f.type === 'application/pdf' ? 'pdf' : (f.type.split('/')[1] ?? 'png')
    const data = new Uint8Array(await f.arrayBuffer())
    return load(() => window.api.convertPrepareData(f.name && CONVERTIBLE.test(f.name) ? f.name : `capture.${ext}`, data))
  }

  useEffect(() => {
    if (file) void loadPath(file)
  }, [file])

  // ⌘V / Ctrl+V : capture d'écran ou fichier copié
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/') || x.type === 'application/pdf')
      if (!f) return
      e.preventDefault()
      void loadFile(f)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  const imageUrl = useMemo(
    () => (source?.kind === 'image' ? URL.createObjectURL(new Blob([source.data.slice()], { type: source.mime })) : null),
    [source]
  )
  useEffect(() => () => void (imageUrl && URL.revokeObjectURL(imageUrl)), [imageUrl])

  const code = extractLatex(output, phase === 'done')
  useEffect(() => {
    if (phase === 'running' && outBox.current) outBox.current.scrollTop = outBox.current.scrollHeight
  }, [output, phase])

  const choose = async (): Promise<void> => {
    const p = await window.api.openFileDialog({ title: 'Image ou PDF à convertir en LaTeX', extensions: EXTENSIONS })
    if (p) void loadPath(p)
  }

  const convert = async (): Promise<void> => {
    if (!source || running.current) return
    running.current = true
    stopped.current = false
    setPhase('running')
    setOutput('')
    setError('')
    setStep(`Envoi à ${name}…`)
    try {
      if (engine === 'ollama' && source.kind === 'pdf') setStep('Rendu des pages du PDF…')
      const pages = engine === 'ollama' && source.kind === 'pdf' ? await pdfToPngs(source.data) : undefined
      await window.api.convertRun(source.id, engine, { mode, notes, packages: mode === 'fragment' ? documentPackages() : undefined, pages })
      setPhase(stopped.current ? 'idle' : 'done')
    } catch (e) {
      setError(cleanError(e))
      setPhase('error')
      void window.api.aiStatus(engine).then(setStatus)
    } finally {
      running.current = false
    }
  }

  const stop = (): void => {
    stopped.current = true
    void window.api.convertStop()
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    const f = [...e.dataTransfer.files].find((x) => CONVERTIBLE.test(x.name))
    if (f) void loadFile(f)
    else if (e.dataTransfer.files.length) toast('Déposez une image ou un PDF', 'error')
  }

  const baseName = (source?.name ?? 'conversion').replace(/\.[^.]+$/, '')
  const finished = phase === 'done' && !!code

  const footer =
    ready && source ? (
      <>
        <span className="cv-engine">
          via {name}
          {model ? ` · ${modelLabel(model)}` : ''}
        </span>
        <button className="btn" disabled={!finished} onClick={() => void navigator.clipboard.writeText(code!).then(() => toast('LaTeX copié', 'success'))}>
          <Copy size={14} /> Copier
        </button>
        <button
          className="btn"
          disabled={!finished}
          onClick={async () => {
            if (await createFileWith(baseName, '.tex', code! + '\n')) closeModal()
          }}
        >
          <FilePlus size={14} /> Nouveau fichier
        </button>
        <button
          className="btn primary"
          disabled={!finished || !active}
          title={active ? `Insérer dans ${active}` : 'Ouvrez un fichier pour insérer'}
          onClick={() => {
            closeModal()
            // Après la fermeture : l'éditeur reprend le focus et la sélection
            setTimeout(() => getActivePath() && insertText(code! + '\n'), 30)
          }}
        >
          <CornerDownLeft size={14} /> Insérer au curseur
        </button>
      </>
    ) : undefined

  return (
    <ModalFrame title="Image ou PDF → LaTeX" width={1080} className="convert-modal" footer={footer}>
      <div
        className={`cv ${ENGINES[engine].cls}${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
        onDrop={onDrop}
      >
        {!status && <span className="copilot-dots cv-center" />}
        {status && !ready && (
          <div className="cv-center">
            <Gate engine={engine} status={status} onStatus={setStatus} />
          </div>
        )}
        {ready && !source && (
          <button className="cv-drop" onClick={() => void choose()} disabled={loading}>
            {loading ? <span className="copilot-dots" /> : <FileUp size={30} />}
            <strong>Déposez une image ou un PDF</strong>
            <span>
              ou collez une capture d’écran (<kbd>{window.api.platform === 'darwin' ? '⌘' : 'Ctrl'}</kbd> <kbd>V</kbd>), ou cliquez pour choisir un fichier
            </span>
            <small>
              Photo d’un cours, scan d’exercice, formule, tableau, notes manuscrites… {name} les réécrit en LaTeX.
            </small>
          </button>
        )}
        {ready && source && (
          <div className="cv-grid">
            <section className="cv-source">
              <div className="cv-bar">
                <span className="cv-name" title={source.name}>
                  {source.name}
                </span>
                <button className="btn small ghost" disabled={phase === 'running'} onClick={() => void choose()}>
                  Changer…
                </button>
              </div>
              <div className="cv-preview">
                {imageUrl ? <img src={imageUrl} alt={source.name} /> : <PdfPages data={source.data} />}
              </div>
            </section>
            <section className="cv-result">
              <div className="cv-options">
                <div className="segmented" title="Forme du résultat">
                  <button className={mode === 'fragment' ? 'on' : ''} disabled={phase === 'running'} onClick={() => setMode('fragment')}>
                    Contenu à insérer
                  </button>
                  <button className={mode === 'document' ? 'on' : ''} disabled={phase === 'running'} onClick={() => setMode('document')}>
                    Document complet
                  </button>
                </div>
                <input
                  className="input"
                  placeholder="Consignes (facultatif) : seulement l’exercice 2, garder la numérotation…"
                  value={notes}
                  disabled={phase === 'running'}
                  onChange={(e) => setNotes(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void convert()}
                />
                {phase === 'running' ? (
                  <button className="btn" onClick={stop}>
                    <Square size={11} fill="currentColor" /> Arrêter
                  </button>
                ) : (
                  <button className="btn primary" onClick={() => void convert()}>
                    {phase === 'idle' ? <ScanText size={14} /> : <RotateCcw size={14} />} {phase === 'idle' ? 'Convertir' : 'Relancer'}
                  </button>
                )}
              </div>
              <div className="cv-output">
                {phase === 'idle' && !output && (
                  <div className="cv-placeholder">
                    Le LaTeX apparaîtra ici.
                    <br />
                    {mode === 'fragment'
                      ? 'Contenu seul, à insérer dans le document ouvert (paquets du document pris en compte).'
                      : 'Document complet et compilable, à créer comme nouveau fichier.'}
                  </div>
                )}
                {phase === 'running' && code === null && (
                  <div className="cv-placeholder">
                    <span className="copilot-dots" /> {step} {elapsed > 2 && <span className="cv-muted">{elapsed} s</span>}
                  </div>
                )}
                {code !== null && (
                  <pre ref={outBox} className="cv-code">
                    {highlightTex(code)}
                  </pre>
                )}
                {phase === 'error' && <div className="cv-error">⚠ {error}</div>}
              </div>
              {phase === 'running' && code !== null && (
                <div className="cv-status">
                  <span className="copilot-dots" /> Écriture du LaTeX… <span className="cv-muted">{elapsed} s</span>
                </div>
              )}
              {phase === 'done' && (
                <div className="cv-status">Vérifiez le résultat : les formules et l’écriture manuscrite peuvent contenir des erreurs de lecture.</div>
              )}
            </section>
          </div>
        )}
      </div>
    </ModalFrame>
  )
}
