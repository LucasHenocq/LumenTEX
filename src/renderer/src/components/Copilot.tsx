import { ArrowUp, ChevronDown, ChevronUp, CornerDownLeft, Download, FileText, KeyRound, LogIn, Paperclip, Play, Sparkles, Square, Trash2, Wrench, X } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { CONVERTIBLE } from '../../../shared/convert'
import type { AiEngine, AiStatus } from '../../../shared/types'
import { getActivePath, getView, textOf } from '../editor/setup'
import { insertText, saveAll } from '../lib/actions'
import { on } from '../lib/bus'
import { highlightTex } from '../lib/texHighlight'
import { contents } from '../lib/projectIndex'
import { store, updateSettings, useApp } from '../store'
import { withDisplayMath, withInlineMath } from '../lib/mathText'

type Msg = { role: 'user' | 'assistant'; content: string }

const MIN_H = 160

/** Fichier joint : chemin relatif au projet, ou absolu (external) pour un fichier hors projet */
type Attached = { path: string; external: boolean }
const MAX_ATTACHED = 20000
const TEXT_FILE = /\.(tex|bib|sty|cls|ltx|txt|md|csv|dat|tikz|bst)$/i

async function attachedText(a: Attached): Promise<string> {
  const root = store.get().root
  const text = a.external
    ? await window.api.readExternal(a.path)
    : (textOf(a.path) ?? contents.get(a.path) ?? (root ? await window.api.read(root, a.path) : ''))
  return text.length > MAX_ATTACHED ? text.slice(0, MAX_ATTACHED) + '\n[… tronqué]' : text
}

async function attachedBlocks(files: Attached[]): Promise<string> {
  const blocks = await Promise.all(
    files.map(async (a) => {
      try {
        return `\nFichier joint : ${a.path}\n\`\`\`\n${await attachedText(a)}\n\`\`\``
      } catch {
        return `\nFichier joint illisible : ${a.path}`
      }
    })
  )
  return blocks.join('\n')
}

// ponytail: fichier ouvert tronqué à 40 000 caractères, n'envoyer que les sections utiles si les gros documents posent problème
const MAX_FILE = 40000

/** Contexte complet pour Ollama, qui ne lit pas les fichiers lui-même : fichier ouvert, sélection, erreurs, pièces jointes */
async function ollamaContext(files: Attached[]): Promise<string> {
  const path = getActivePath()
  const text = path ? (textOf(path) ?? '') : ''
  const view = getView()
  const sel = view ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) : ''
  const errors = store
    .get()
    .diagnostics.filter((d) => d.severity !== 'info')
    .slice(0, 15)
    .map((d) => `- ${d.severity === 'error' ? 'Erreur' : 'Avertissement'} ${d.file ?? ''}${d.line ? ':' + d.line : ''} : ${d.message}`)
  return [
    'Tu es un assistant LaTeX intégré à un éditeur (compilation Tectonic / XeLaTeX : pas de fontenc/inputenc, pas de biber).',
    'Réponds en français, de façon concise. Mets tout code LaTeX à insérer dans un bloc ```latex.',
    path ? `\nFichier ouvert : ${path}\n\`\`\`latex\n${text.slice(0, MAX_FILE)}\n\`\`\`` : '\nAucun fichier ouvert.',
    sel ? `\nSélection de l’utilisateur :\n\`\`\`latex\n${sel}\n\`\`\`` : '',
    errors.length ? `\nProblèmes de la dernière compilation :\n${errors.join('\n')}` : '',
    await attachedBlocks(files)
  ].join('\n')
}

/** Contexte léger pour l'agent : il lit lui-même les fichiers du projet (joints hors projet : contenu inclus) */
async function agentPrompt(question: string, files: Attached[]): Promise<string> {
  const inProject = files.filter((a) => !a.external).map((a) => a.path)
  const path = getActivePath()
  const view = getView()
  const sel = view ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) : ''
  const line = view ? view.state.doc.lineAt(view.state.selection.main.head).number : 0
  const errors = store
    .get()
    .diagnostics.filter((d) => d.severity !== 'info')
    .slice(0, 15)
    .map((d) => `- ${d.severity === 'error' ? 'Erreur' : 'Avertissement'} ${d.file ?? ''}${d.line ? ':' + d.line : ''} : ${d.message}`)
  return [
    path ? `[Fichier ouvert : ${path}, curseur ligne ${line}]` : '',
    sel ? `[Sélection :\n${sel}\n]` : '',
    errors.length ? `[Problèmes de la dernière compilation :\n${errors.join('\n')}\n]` : '',
    inProject.length ? `[Fichiers joints par l’utilisateur, à lire : ${inProject.join(', ')}]` : '',
    await attachedBlocks(files.filter((a) => a.external)),
    question
  ]
    .filter(Boolean)
    .join('\n')
}

type Usage = { fiveHour?: number; fiveHourResetsAt?: number; sevenDay?: number }

/** Heure de réinitialisation : « 00:20 », ou « dim. 00:20 » si ce n'est pas aujourd'hui */
function resetLabel(ts?: number): string {
  if (!ts) return '?'
  const d = new Date(ts * 1000)
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('fr-FR', { weekday: 'short' })} ${time}`
}

/** Utilisation du forfait Claude : cliquer l'actualise (sans consommer de quota) */
function UsageBadge({ u, loading, onRefresh }: { u: Usage; loading: boolean; onRefresh: () => void }): React.JSX.Element {
  const week = u.sevenDay !== undefined ? ` · semaine : ${Math.round(u.sevenDay * 100)} %` : ''
  const title =
    u.fiveHour === undefined
      ? 'Utilisation de ta session de 5 h de Claude · cliquer pour actualiser'
      : `Session de 5 h de Claude : réinitialisée à ${resetLabel(u.fiveHourResetsAt)}${week} · cliquer pour actualiser`
  return (
    <button className={`copilot-usage${loading ? ' loading' : ''}`} title={title} disabled={loading} onClick={onRefresh}>
      5h : {u.fiveHour === undefined ? '—' : `${Math.round(u.fiveHour * 100)} %`}
    </button>
  )
}

/** **gras** et *italique* */
function emphasis(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/).map((s, i) =>
    s.length > 4 && s.startsWith('**') ? (
      <strong key={i}>{inline(s.slice(2, -2))}</strong>
    ) : s.length > 2 && s.startsWith('*') ? (
      <em key={i}>{s.slice(1, -1)}</em>
    ) : (
      s
    )
  )
}

/** Mise en forme en ligne : `code` (jamais interprété), formules LaTeX rendues, **gras**, *italique* */
export function inline(text: string): React.ReactNode[] {
  return text.split(/(`[^`\n]+`)/).map((s, i) =>
    i % 2 ? (
      <code key={i}>{highlightTex(s.slice(1, -1))}</code>
    ) : (
      <Fragment key={i}>{withInlineMath(s, (part, k) => <Fragment key={k}>{emphasis(part)}</Fragment>)}</Fragment>
    )
  )
}

/** Lignes d'un texte, avec les formules centrées ($$…$$, \[…\]) rendues à part, même sur plusieurs lignes */
export function linesWithMath(text: string, line: (l: string, i: number) => React.ReactNode): React.ReactNode[] {
  return withDisplayMath(text, (part, k) => {
    const lines = part.replace(/^\n|\n$/g, '').split('\n')
    return part.trim() ? <Fragment key={k}>{lines.map(line)}</Fragment> : null
  })
}

/** Une ligne de Markdown : titre, puce, liste numérotée ou texte */
function mdLine(line: string, key: number): React.ReactNode {
  const h = /^(#{1,4})\s+(.*)$/.exec(line)
  if (h) return <div key={key} className={`md-h md-h${h[1].length}`}>{inline(h[2])}</div>
  const li = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(line)
  if (li)
    return (
      <div key={key} className="md-li" style={{ paddingLeft: 4 + li[1].length * 6 }}>
        <span className="md-bullet">{/\d/.test(li[2]) ? li[2] : '•'}</span>
        <span>{inline(li[3])}</span>
      </div>
    )
  if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) return <hr key={key} className="md-hr" />
  return <div key={key}>{line ? inline(line) : ' '}</div>
}

/** Texte hors code : lignes « 🔧 Outil » en pastilles, le reste en paragraphes */
function textBlocks(text: string, key: number): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let para: string[] = []
  const flush = (): void => {
    const t = para.join('\n').trim()
    if (t) out.push(<div key={`${key}-${out.length}`} className="copilot-text">{linesWithMath(t, mdLine)}</div>)
    para = []
  }
  for (const line of text.split('\n')) {
    if (line.startsWith('🔧')) {
      flush()
      out.push(
        <div key={`${key}-${out.length}`} className="copilot-tool">
          <Wrench size={11} /> {line.replace(/^🔧\s*|…$/g, '')}
        </div>
      )
    } else para.push(line)
  }
  flush()
  return out
}

function Message({ m }: { m: Msg }): React.JSX.Element {
  if (m.role === 'user') return <div className="copilot-msg user">{m.content}</div>
  // Alternance texte / bloc de code : les indices impairs sont du code
  return (
    <div className="copilot-msg">
      {m.content.split(/```[a-zA-Z]*\n?/).map((p, i) => {
        if (!(i % 2)) return textBlocks(p, i)
        const code = p.replace(/\n$/, '')
        return (
          <div key={i} className="copilot-code">
            <div className="copilot-code-bar">
              <span>latex</span>
              <button title="Insérer au curseur (remplace la sélection)" onClick={() => insertText(code)}>
                <CornerDownLeft size={11} /> Insérer
              </button>
            </div>
            <pre>{highlightTex(code)}</pre>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Moteurs du copilot : nom affiché, réglage du modèle, classe de couleur et modèles proposés.
 * Claude et Gemini : alias de la CLI (toujours la dernière version) ; Copilot : liste lue dans la CLI installée.
 */
export const ENGINES: Record<
  AiEngine,
  { name: string; setting: 'ollamaModel' | 'claudeModel' | 'copilotModel' | 'geminiModel'; install: string; cls: string; models?: string[] }
> = {
  // Ollama : modèles installés localement, lus dans le statut
  ollama: { name: 'Ollama', setting: 'ollamaModel', install: '', cls: 'ollama' },
  claude: { name: 'Claude Code', setting: 'claudeModel', install: 'Cliquez pour l’installer', cls: '', models: ['fable', 'opus', 'sonnet', 'haiku'] },
  copilot: { name: 'GitHub Copilot', setting: 'copilotModel', install: 'Cliquez pour l’installer (≈ 160 Mo)', cls: 'gh' },
  gemini: { name: 'Gemini', setting: 'geminiModel', install: 'Cliquez pour l’installer (≈ 100 Mo)', cls: 'gemini', models: ['auto', 'pro', 'flash', 'flash-lite'] }
}
const ALIASES = new Set([...(ENGINES.claude.models ?? []), ...(ENGINES.gemini.models ?? [])])
export const modelLabel = (m: string): string => (!m ? 'Par défaut' : ALIASES.has(m) ? m[0].toUpperCase() + m.slice(1) : m)

export const cleanError = (e: unknown): string => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Gemini : Google refuse la connexion « compte Google » de la CLI pour les comptes personnels, on passe par une clé d'API */
function GeminiKeyForm({ onStatus }: { onStatus: (s: AiStatus) => void }): React.JSX.Element {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      onStatus(await window.api.aiGeminiKey(key))
    } catch (e) {
      setError(cleanError(e))
    }
    setBusy(false)
  }
  return (
    <form
      className="copilot-gate"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <KeyRound size={20} />
      <strong>Gemini a besoin d’une clé d’API</strong>
      <span>Gratuite, elle se crée en un clic avec votre compte Google.</span>
      <button type="button" className="link-btn" onClick={() => void window.api.openExternal('https://aistudio.google.com/apikey')}>
        Obtenir une clé sur Google AI Studio
      </button>
      <div className="copilot-gate-code">
        <input
          className="input"
          type="password"
          placeholder="Collez la clé (AIza…)"
          value={key}
          autoFocus
          onChange={(e) => setKey(e.target.value)}
        />
        <button className="btn" type="submit" disabled={!key.trim() || busy}>
          {busy ? 'Vérification…' : 'Valider'}
        </button>
      </div>
      <small className="cv-muted">
        Chiffrée par {window.api.platform === 'darwin' ? 'le trousseau macOS' : 'Windows'}, jamais envoyée ailleurs qu’à Google.
      </small>
      {error && <span className="copilot-gate-error">⚠ {error}</span>}
    </form>
  )
}

/** Ollama : lien de téléchargement s'il n'est pas installé, puis lancement du serveur et téléchargement d'un modèle */
function OllamaGate({ status, onStatus }: { status: AiStatus; onStatus: (s: AiStatus) => void }): React.JSX.Element {
  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  useEffect(() => window.api.onAiInstallProgress(setProgress), [])

  const run = async (action: () => Promise<AiStatus>): Promise<void> => {
    setWorking(true)
    setError('')
    setProgress('')
    try {
      onStatus(await action())
    } catch (e) {
      setError(cleanError(e))
    }
    setWorking(false)
  }

  if (working)
    return (
      <div className="copilot-gate working">
        <span className="copilot-dots" />
        <strong>{status.running ? 'Téléchargement du modèle…' : 'Lancement d’Ollama…'}</strong>
        <span>{progress || 'Préparation…'}</span>
      </div>
    )

  if (!status.installed)
    return (
      <div className="copilot-gate">
        <Download size={20} />
        <strong>Ollama n’est pas installé</strong>
        <span>Ollama fait tourner des modèles d’IA sur votre ordinateur : gratuit, privé, et sans connexion Internet.</span>
        <button className="btn primary" onClick={() => void window.api.openExternal('https://ollama.com/download')}>
          Télécharger Ollama
        </button>
        <button className="link-btn" onClick={() => void window.api.aiStatus('ollama').then(onStatus)}>
          C’est installé ? Vérifier
        </button>
      </div>
    )

  if (!status.running)
    return (
      <button className="copilot-gate" onClick={() => void run(() => window.api.aiLogin('ollama'))}>
        <Play size={20} />
        <strong>Ollama n’est pas lancé</strong>
        <span>Cliquez pour le démarrer</span>
        {error && <span className="copilot-gate-error">⚠ {error}</span>}
      </button>
    )

  return (
    <div className="copilot-gate">
      <Download size={20} />
      <strong>Aucun modèle installé</strong>
      <span>Choisissez un modèle Gemma de Google à télécharger (une seule fois) :</span>
      <button className="btn primary" onClick={() => void run(() => window.api.aiOllamaPull('gemma4'))}>
        Gemma 4 · recommandé (≈ 9,6 Go)
      </button>
      <button className="btn" onClick={() => void run(() => window.api.aiOllamaPull('gemma3:4b'))}>
        Gemma 3 4B · léger (≈ 3,3 Go)
      </button>
      {error && <span className="copilot-gate-error">⚠ {error}</span>}
    </div>
  )
}

/** Au centre du panneau quand le moteur n'est pas prêt */
export function Gate(props: { engine: AiEngine; status: AiStatus; onStatus: (s: AiStatus) => void }): React.JSX.Element {
  return props.engine === 'ollama' ? <OllamaGate status={props.status} onStatus={props.onStatus} /> : <CliGate {...props} />
}

/** Agents en ligne de commande non installés ou non connectés : un clic lance l'installation ou la connexion */
function CliGate({ engine, status, onStatus }: { engine: AiEngine; status: AiStatus; onStatus: (s: AiStatus) => void }): React.JSX.Element {
  const name = ENGINES[engine].name
  const [phase, setPhase] = useState<'idle' | 'working'>('idle')
  const [progress, setProgress] = useState('')
  const [url, setUrl] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const installing = !status.installed

  useEffect(() => window.api.onAiLoginUrl(setUrl), [])
  useEffect(() => window.api.onAiInstallProgress(setProgress), [])
  // Changement de moteur pendant une connexion : on l'abandonne
  useEffect(() => () => void window.api.aiLoginCancel(), [engine])

  const start = async (): Promise<void> => {
    setPhase('working')
    setError('')
    setUrl('')
    setProgress('')
    try {
      onStatus(await (installing ? window.api.aiInstall(engine) : window.api.aiLogin(engine)))
    } catch (e) {
      const msg = cleanError(e)
      if (!/annulée/.test(msg)) setError(msg)
    }
    setPhase('idle')
  }

  if (phase === 'working')
    return (
      <div className="copilot-gate working">
        <span className="copilot-dots" />
        {installing ? (
          <>
            <strong>Installation de {name}…</strong>
            <span>{progress || 'Préparation…'}</span>
          </>
        ) : (
          <>
            <strong>Connexion à {name}…</strong>
            <span>Terminez la connexion dans le navigateur qui vient de s’ouvrir.</span>
            {url && (
              <button className="link-btn" onClick={() => void window.api.openExternal(url)}>
                Le navigateur ne s’est pas ouvert ? Ouvrir la page de connexion
              </button>
            )}
            {engine === 'claude' && url && (
              <form
                className="copilot-gate-code"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (code.trim()) void window.api.aiLoginCode(code)
                  setCode('')
                }}
              >
                <input className="input" placeholder="Code affiché par la page (si demandé)" value={code} onChange={(e) => setCode(e.target.value)} />
                <button className="btn" type="submit" disabled={!code.trim()}>
                  Valider
                </button>
              </form>
            )}
            <button className="btn" onClick={() => void window.api.aiLoginCancel()}>
              Annuler
            </button>
          </>
        )}
      </div>
    )

  if (engine === 'gemini' && !installing) return <GeminiKeyForm onStatus={onStatus} />

  return (
    <button className="copilot-gate" onClick={() => void start()}>
      {installing ? <Download size={20} /> : <LogIn size={20} />}
      <strong>{installing ? `${name} n’est pas installé` : `${name} n’est pas connecté`}</strong>
      <span>{installing ? ENGINES[engine].install : 'Cliquez pour vous connecter'}</span>
      {error && <span className="copilot-gate-error">⚠ {error}</span>}
    </button>
  )
}

export default function Copilot(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const active = useApp((s) => s.active)
  const root = useApp((s) => s.root)
  const [height, setHeight] = useState(settings.copilotHeight)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [usage, setUsage] = useState<Usage>({})
  const [attached, setAttached] = useState<Attached[]>([])
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [ghModels, setGhModels] = useState<string[]>([])
  const files = useApp((s) => s.files)
  const engine = settings.aiEngine
  const { name, setting } = ENGINES[engine]
  const model = settings[setting]
  const models = ENGINES[engine].models ?? (engine === 'ollama' ? (status?.models ?? []) : ghModels)
  const ready = !!status?.installed && status.loggedIn
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => setAttached([]), [root])

  const refresh = async (): Promise<void> => {
    const e = store.get().settings.aiEngine
    const s = await window.api.aiStatus(e)
    if (store.get().settings.aiEngine === e) setStatus(s)
  }
  // Ollama : modèle choisi absent (supprimé, ou ancien réglage) → premier modèle installé
  useEffect(() => {
    const list = engine === 'ollama' ? status?.models : undefined
    if (list?.length && !list.some((m) => m === model || m === `${model}:latest`)) void updateSettings({ ollamaModel: list[0] })
  }, [engine, status, model])
  useEffect(() => {
    setStatus(null)
    void refresh()
  }, [engine])
  // Connexion faite ailleurs (terminal) : revérifier au retour dans l'app
  useEffect(() => {
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
  useEffect(() => {
    if (engine === 'copilot' && status?.installed) void window.api.aiCopilotModels().then(setGhModels)
  }, [engine, status?.installed])

  const attach = async (): Promise<void> => {
    const taken = new Set(attached.map((a) => a.path))
    const candidates = files
      .filter((f) => !f.isDir && TEXT_FILE.test(f.path) && !taken.has(f.path) && f.path !== active)
      .slice(0, 40)
    const choice = await window.api.popupMenu([
      ...candidates.map((f) => ({ id: f.path, label: f.path })),
      ...(candidates.length ? [{ type: 'separator' as const }] : []),
      { id: '@browse', label: 'Autre fichier…' },
      { type: 'separator' as const },
      { id: '@convert', label: 'Convertir une image ou un PDF en LaTeX…' }
    ])
    if (!choice) return
    if (choice === '@convert') return store.set({ modal: { type: 'convert' } })
    if (choice !== '@browse') return setAttached((as) => [...as, { path: choice, external: false }])
    const p = await window.api.openFileDialog({ title: 'Joindre un fichier au contexte de l’IA' })
    if (!p) return
    // Fichier choisi dans le projet : on le garde en relatif
    const norm = p.replace(/\\/g, '/')
    const rel = root && norm.toLowerCase().startsWith(root.toLowerCase() + '/') ? norm.slice(root.length + 1) : null
    const a = rel ? { path: rel, external: false } : { path: p, external: true }
    if (!taken.has(a.path)) setAttached((as) => [...as, a])
  }

  useEffect(
    () =>
      window.api.onAiChunk((t) =>
        setMsgs((ms) => [...ms.slice(0, -1), { role: 'assistant', content: ms[ms.length - 1].content + t }])
      ),
    []
  )
  useEffect(() => window.api.onAiUsage(setUsage), [])
  const [usageLoading, setUsageLoading] = useState(false)
  const refreshUsage = async (): Promise<void> => {
    setUsageLoading(true)
    const u = await window.api.aiClaudeUsage().catch(() => null)
    if (u) setUsage(u)
    setUsageLoading(false)
  }
  // Affiché dès que Claude est prêt, sans attendre une première question
  useEffect(() => {
    if (engine === 'claude' && ready) void refreshUsage()
  }, [engine, ready])
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [msgs])

  const ask = async (q: string): Promise<void> => {
    if (!q || busy || !root || !ready) return
    setMsgs((ms) => [...ms, { role: 'user', content: q }, { role: 'assistant', content: '' }])
    setBusy(true)
    try {
      if (engine === 'ollama') {
        // Pas d'agent : tout le contexte part dans le prompt, avec l'historique de la conversation
        const history = msgs.filter((m) => m.content && !m.content.startsWith('⚠'))
        await window.api.aiOllama([{ role: 'system', content: await ollamaContext(attached) }, ...history, { role: 'user', content: q }])
      } else {
        await saveAll() // l'agent lit les fichiers sur le disque
        const prompt = await agentPrompt(q, attached)
        const askEngine = { claude: window.api.aiClaude, copilot: window.api.aiCopilot, gemini: window.api.aiGemini }[engine]
        await askEngine(root, prompt)
      }
    } catch (e) {
      setMsgs((ms) => [...ms.slice(0, -1), { role: 'assistant', content: '⚠ ' + cleanError(e) }])
      void refresh() // une erreur de connexion fait réapparaître l'écran de connexion
    } finally {
      setBusy(false)
    }
  }
  const send = (): Promise<void> => {
    const q = input.trim()
    if (q && !busy && root && ready) setInput('')
    return ask(q)
  }
  const askRef = useRef(ask)
  askRef.current = ask
  useEffect(
    () =>
      on('copilot:ask', (q) => {
        setHeight((h) => h || 280)
        void askRef.current(q)
      }),
    []
  )
  useEffect(() => on('copilot:show', () => setHeight((h) => h || 280)), [])

  const resetChat = (): void => {
    setMsgs([])
    // Ollama : l'historique n'existe que dans le panneau
    if (root && engine !== 'ollama')
      void { claude: window.api.aiClaudeReset, copilot: window.api.aiCopilotReset, gemini: window.api.aiGeminiReset }[engine](root)
  }

  const resize = (h: number): void => {
    setHeight(h)
    void updateSettings({ copilotHeight: h })
  }

  const onResize = (e: React.PointerEvent): void => {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const startY = e.clientY
    const startH = height
    let h = startH
    document.body.classList.add('resizing')
    const move = (ev: PointerEvent): void => {
      const raw = startH + startY - ev.clientY
      // Rétréci sous le minimum : le panneau se replie
      h = raw < MIN_H - 50 ? 0 : Math.min(window.innerHeight - 200, Math.max(MIN_H, raw))
      setHeight(h)
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
      resize(h)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const cls = `copilot ${ENGINES[engine].cls}`.trim()

  if (!height)
    return (
      <div className={`${cls} collapsed`}>
        <div className="copilot-resize" onPointerDown={onResize} />
        <button className="copilot-open" title="Afficher l’assistant IA" onClick={() => resize(280)}>
          <Sparkles size={12} className="copilot-spark" />{' '}
          <span>
            IA · {name}
            {model ? ` · ${modelLabel(model)}` : ''}
            {status && !ready ? ' · non connecté' : ''}
          </span>
          {busy && <span className="copilot-dots" />}
          <ChevronUp size={14} />
        </button>
      </div>
    )

  return (
    <div
      className={cls}
      style={{ height }}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        // Image ou PDF déposé sur le panneau : ouverture de la conversion en LaTeX
        const f = [...e.dataTransfer.files].find((x) => CONVERTIBLE.test(x.name))
        const p = f && window.api.pathForFile(f)
        if (!p) return
        e.preventDefault()
        store.set({ modal: { type: 'convert', file: p } })
      }}
    >
      <div className="copilot-resize" onPointerDown={onResize} />
      <div className="copilot-header">
        <Sparkles size={13} className="copilot-spark" />
        <select
          className="copilot-engine"
          value={engine}
          disabled={busy}
          title="Moteur de l’assistant"
          onChange={(e) => {
            resetChat()
            void updateSettings({ aiEngine: e.target.value as AiEngine })
          }}
        >
          <option value="ollama">Ollama (local)</option>
          <option value="claude">Claude Code</option>
          <option value="copilot">GitHub Copilot</option>
          <option value="gemini">Gemini</option>
        </select>
        {ready && (
          <select
            className="copilot-engine copilot-model"
            value={model}
            disabled={busy}
            title={`Modèle de ${name} (Par défaut = celui de la CLI)`}
            onChange={(e) => void updateSettings({ [setting]: e.target.value })}
          >
            {engine !== 'ollama' && <option value="">Par défaut</option>}
            {models.map((m) => (
              <option key={m} value={m}>
                {modelLabel(m)}
              </option>
            ))}
            {model && !models.includes(model) && <option value={model}>{modelLabel(model)}</option>}
          </select>
        )}
        <span className="copilot-spacer" />
        {engine === 'claude' && ready && <UsageBadge u={usage} loading={usageLoading} onRefresh={() => void refreshUsage()} />}
        <button className="icon-btn subtle" title="Nouvelle conversation" disabled={busy} onClick={resetChat}>
          <Trash2 size={13} />
        </button>
        <button className="icon-btn subtle" title="Replier" onClick={() => resize(0)}>
          <ChevronDown size={14} />
        </button>
      </div>
      <div className="copilot-msgs">
        {!status && <span className="copilot-dots copilot-checking" />}
        {status && !ready && <Gate key={engine} engine={engine} status={status} onStatus={setStatus} />}
        {ready && !msgs.length && (
          <div className="copilot-empty">
            {engine === 'ollama'
              ? 'Le modèle local voit le fichier ouvert et les fichiers joints (📎), sans les modifier. Sélectionnez du texte pour cibler une zone.'
              : `${name} lit et modifie directement les fichiers du projet. Sélectionnez du texte pour cibler une zone.`}
          </div>
        )}
        {ready &&
          msgs.map((m, i) => (
            <Message key={i} m={m} />
          ))}
        {ready && busy && !msgs[msgs.length - 1]?.content && <span className="copilot-dots" />}
        <div ref={bottom} />
      </div>
      <div className="copilot-composer">
        {attached.length > 0 && (
          <div className="copilot-chips">
            {attached.map((a) => (
              <span key={a.path} className="copilot-chip" title={a.path}>
                <FileText size={11} />
                <span>{a.path.split(/[\\/]/).pop()}</span>
                <button title="Retirer du contexte" onClick={() => setAttached((as) => as.filter((x) => x !== a))}>
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          placeholder={ready ? `Demander à ${name}…` : `${name} n’est pas disponible`}
          disabled={!ready}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <div className="copilot-composer-bar">
          <button className="copilot-attach" title="Joindre des fichiers au contexte" onClick={() => void attach()}>
            <Paperclip size={13} />
          </button>
          <span className="copilot-ctx">{active ? active : 'Aucun fichier ouvert'}</span>
          {busy ? (
            <button className="copilot-send" title="Arrêter" onClick={() => void window.api.aiStop()}>
              <Square size={11} fill="currentColor" />
            </button>
          ) : (
            <button className="copilot-send" title="Envoyer (Entrée)" onClick={() => void send()} disabled={!input.trim() || !ready}>
              <ArrowUp size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
