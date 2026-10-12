import type { LeanDiag } from '../../../shared/types'
import { docs, getView, replaceContent, textOf } from '../editor/setup'
import { findProofs, proofHooks, refreshProofs, type Proof, type ProofMark } from '../editor/proofs'
import { store, toast, type ProofRun } from '../store'
import { compile, compileHooks, openFile, saveAll } from './actions'
import { contents } from './projectIndex'
import { leanReplaced } from './lean'
import { parseSteps, withoutSteps, type LeanStep } from './leanSteps'

// Coches des preuves : chaque preuve vérifiée a son fichier Lean dans .lumentex/lean (le .tex reste intact).
// Vérifiée = Lean accepte le fichier, sans « sorry » ni axiome ajouté, et l'énoncé Lean a été validé par un humain.
// Deux façons avec l'IA : la preuve LaTeX étape par étape (chaque affirmation devient une étape Lean), ou l'énoncé seul.

const api = window.api
const DIR = '.lumentex/lean'
const INDEX = `${DIR}/proofs.json`
/** Axiomes de base de Lean et Mathlib ; tout autre (sorryAx, axiome inventé, native_decide…) invalide la preuve */
const AXIOMS = new Set(['propext', 'Classical.choice', 'Quot.sound'])
const ROUNDS = 6

interface Rec {
  /** Fichier Lean (relatif au projet) */
  lean: string
  /** Empreinte de l'énoncé et de la preuve LaTeX au moment de la vérification */
  hash: string
  ok: boolean
  /** proof : preuve LaTeX suivie étape par étape ; statement : énoncé seul ; manual : Lean écrit à la main (absent : avant la 1.3.2, énoncé seul) */
  mode?: 'proof' | 'statement' | 'manual'
  /** Preuve refusée étape par étape : étape en cause (pour l'IA du copilot) */
  problem?: string
}

type Mode = 'proof' | 'statement'

let records: Record<string, Rec> = {}
let loadedFor: string | null = null
let running: string | null = null

const idOf = (file: string, p: Proof): string => `${file}#${p.key}`
const refresh = (): void => getView()?.dispatch({ effects: refreshProofs.of(null) })
const abs = (rel: string): string => `${store.get().root}/${rel}`
/** Nom du théorème en Lean */
const leanName = (p: Proof): string => 'preuve_' + p.key.replace(/[^A-Za-z0-9_]/g, '_')
const slug = (s: string): string => s.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'preuve'

/** Vérifications du projet, lues une fois par projet */
let loading: Promise<void> = Promise.resolve()
export function loadProofs(): Promise<void> {
  const root = store.get().root
  if (!root || loadedFor === root) return loading
  loadedFor = root
  loading = (async () => {
    try {
      records = (JSON.parse(await api.read(root, INDEX)) as { proofs: Record<string, Rec> }).proofs ?? {}
    } catch {
      records = {}
    }
    refresh()
  })()
  return loading
}

async function save(): Promise<void> {
  const root = store.get().root
  if (root) await api.write(root, INDEX, JSON.stringify({ proofs: records }, null, 2))
  // « LEAN » dans le PDF : à jour dès qu'une preuve est vérifiée ou oubliée
  if (root && store.get().settings.leanQedMark) void compile({ auto: true })
}

proofHooks.mark = (file, p): ProofMark => {
  if (loadedFor !== store.get().root) void loadProofs()
  const id = idOf(file, p)
  if (running === id) return 'running'
  const r = records[id]
  if (!r) return 'none'
  if (r.hash !== p.hash) return 'stale'
  if (!r.ok) return 'fail'
  return (r.mode ?? 'statement') === 'statement' ? 'statement' : 'ok'
}

proofHooks.click = (file, p) => void clicked(file, p)

async function clicked(file: string, p: Proof): Promise<void> {
  // Vérification en cours : rouvrir sa fenêtre
  const run = store.get().proofRun
  if (running && run) return setRun({ open: true })
  if (running) return toast('Une vérification est déjà en cours', 'info')
  const id = idOf(file, p)
  const r = records[id]
  const mark = proofHooks.mark(file, p)
  const choice = await api.popupMenu(
    !r
      ? [
          { id: 'ai', label: 'Vérifier la preuve avec l’IA (étape par étape)' },
          { id: 'ai-statement', label: 'Vérifier seulement l’énoncé avec l’IA' },
          { id: 'manual', label: 'Écrire la preuve en Lean moi-même' }
        ]
      : [
          ...(mark === 'stale'
            ? [
                { id: 'ai', label: 'Refaire avec l’IA (preuve modifiée)' },
                { id: 'ai-statement', label: 'Refaire avec l’IA (énoncé seulement)' },
                { id: 'open', label: 'Ouvrir le fichier Lean pour l’adapter' },
                { id: 'check', label: 'Le Lean est toujours juste : revérifier' }
              ]
            : [
                { id: 'check', label: 'Revérifier avec Lean' },
                { id: 'open', label: 'Ouvrir le fichier Lean' },
                { id: 'ai', label: 'Refaire avec l’IA (étape par étape)' },
                { id: 'ai-statement', label: 'Refaire avec l’IA (énoncé seulement)' }
              ]),
          { type: 'separator' as const },
          { id: 'forget', label: 'Oublier cette vérification' }
        ]
  )
  if (choice) await proofAction(file, p, choice)
}

/** Action du menu d'une coche (séparée du menu natif : utilisable par les tests) */
export async function proofAction(file: string, p: Proof, choice: string): Promise<void> {
  const id = idOf(file, p)
  const r = records[id]
  if (choice === 'ai' || choice === 'ai-statement') await withAi(file, p, choice === 'ai' ? 'proof' : 'statement')
  else if (choice === 'manual') await manual(file, p)
  else if (choice === 'open' && r) await openFile(r.lean)
  else if (choice === 'check' && r) await recheck(id, p)
  else if (choice === 'forget' && r) {
    delete records[id]
    await save()
    await api.trash(store.get().root!, r.lean).catch(() => {})
    refresh()
  }
}

/** Fichier Lean d'une preuve : main-thm-pythagore.lean */
function leanPath(file: string, p: Proof): string {
  return `${DIR}/${slug(file.replace(/\.tex$/i, ''))}-${slug(p.key)}.lean`
}

// « -/ » dans le LaTeX fermerait le commentaire Lean trop tôt
const latexComment = (p: Proof): string =>
  `/-\n${`${p.env}${p.title ? ` (${p.title})` : ''} en LaTeX :\n${p.statement}\n\nPreuve en LaTeX :\n${p.proof}`.replace(/-\//g, '- /')}\n-/`

async function manual(file: string, p: Proof): Promise<void> {
  const root = store.get().root!
  const lean = leanPath(file, p)
  if (!(await api.stat(abs(lean))).exists)
    await api.write(root, lean, `import Mathlib\n\n${latexComment(p)}\n\ntheorem ${leanName(p)} : True := by\n  sorry\n`)
  records[idOf(file, p)] = { lean, hash: p.hash, ok: false, mode: 'manual' }
  await save()
  refresh()
  await openFile(lean)
  toast('Écrivez l’énoncé et la preuve en Lean, puis « Mettre à jour la coche » dans le panneau Lean', 'info', undefined, 7000)
}

interface Check {
  ok: boolean
  /** Messages à renvoyer à l'IA */
  problems: string[]
  /** Erreurs de Lean (hors sorry) */
  errors: number
  /** sorry quelque part */
  sorry: boolean
  /** Axiomes ajoutés (hors sorry) */
  axioms: string[]
}

/** Vérifie un fichier de preuve : accepté par Lean, sans sorry, avec le théorème attendu et sans axiome ajouté */
async function checkProofFile(lean: string, name: string): Promise<Check> {
  const root = store.get().root!
  const text = textOf(lean) ?? (await api.read(root, lean))
  const probe = `${DIR}/.verification.lean`
  await api.write(root, probe, `${text}\n\n#print axioms ${name}\n`)
  const r = await api.leanCheck(abs(probe))
  const sorryMsg = (m: LeanDiag): boolean => /declaration uses ['`]sorry['`]/.test(m.message)
  // Erreurs et preuves laissées en sorry (les autres avertissements, style ou variable inutilisée, ne comptent pas)
  const problems = r.messages.filter((m) => m.severity === 'error' || sorryMsg(m)).map((m) => `ligne ${m.line} : ${m.message.slice(0, 600)}`)
  const errors = r.messages.filter((m) => m.severity === 'error').length
  const axioms = r.messages.find((m) => /depends on axioms/.test(m.message))?.message
  const used = axioms ? (/\[([^\]]*)\]/.exec(axioms)?.[1] ?? '').split(',').map((a) => a.trim()) : []
  // sorryAx : preuve incomplète (signalée à part) ; les autres : axiomes ajoutés, native_decide…
  const extra = used.filter((a) => a && !AXIOMS.has(a) && a !== 'sorryAx')
  const sorry = used.includes('sorryAx') || r.messages.some(sorryMsg)
  if (sorry && !problems.length) problems.push('La preuve contient encore sorry.')
  if (extra.length) problems.push(`La preuve repose sur des axiomes non admis : ${extra.join(', ')}. Elle doit se passer de sorry, d'axiomes ajoutés et de native_decide.`)
  if (!r.messages.some((m) => /depends on axioms|does not depend on any axioms/.test(m.message)) && !problems.length)
    problems.push(`Le théorème doit s'appeler ${name}.`)
  return { ok: r.ok && !problems.length, problems, errors, sorry, axioms: extra }
}

/** Étapes dont Lean n'a pas besoin : chaque variante privée d'une étape et acceptée la désigne */
async function unusedSteps(code: string, name: string, steps: LeanStep[]): Promise<number[]> {
  const v = withoutSteps(code, name, steps)
  if (!v) return []
  const probe = `${DIR}/.etapes.lean`
  await api.write(store.get().root!, probe, v.text)
  const r = await api.leanCheck(abs(probe))
  const errors = r.messages.filter((m) => m.severity === 'error').map((m) => m.line)
  return v.variants.filter((x) => !errors.some((l) => l >= x.from && l <= x.to)).map((x) => x.n)
}

async function recheck(id: string, p: Proof): Promise<void> {
  const r = records[id]
  running = id
  refresh()
  try {
    await saveAll()
    const res = await checkProofFile(r.lean, leanName(p))
    records[id] = { ...r, hash: p.hash, ok: res.ok }
    await save()
    if (res.ok) toast('Preuve vérifiée par Lean ✓', 'success')
    else
      toast(
        res.axioms.length
          ? `Refusée : la preuve repose sur un axiome ajouté (${res.axioms.join(', ')}), pas sur une démonstration`
          : 'Lean n’accepte pas encore cette preuve (erreur, sorry, ou théorème mal nommé)',
        'error',
        { label: 'Ouvrir le Lean', run: () => void openFile(r.lean) },
        7000
      )
  } finally {
    running = null
    refresh()
  }
}

/** Fichier de preuve ouvert dans le panneau Lean : la preuve LaTeX qu'il vérifie */
export function proofOfLeanFile(lean: string): { file: string; proof: Proof | null } | null {
  const id = Object.keys(records).find((k) => records[k].lean === lean)
  if (!id) return null
  const file = id.slice(0, id.lastIndexOf('#'))
  const key = id.slice(id.lastIndexOf('#') + 1)
  const text = textOf(file) ?? contents.get(file) ?? ''
  return { file, proof: findProofs(text).find((p) => p.key === key) ?? null }
}

/** Position dans un commentaire LaTeX (% non échappé plus tôt sur la ligne) */
function inComment(text: string, at: number): boolean {
  const line = text.slice(text.lastIndexOf('\n', at - 1) + 1, at)
  return /(^|[^\\])%/.test(line)
}

/** Fichier d'un \input ou \include, relatif au dossier du fichier principal (comme TeX), .tex par défaut */
function inputPath(main: string, name: string): string {
  const parts = [...main.split('/').slice(0, -1), ...name.trim().split('/')]
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p && p !== '.') out.push(p)
  }
  const file = out.join('/')
  return /\.\w+$/.test(file) ? file : `${file}.tex`
}

/**
 * Numéros, dans l'ordre du document compilé (en suivant les \input et \include), des preuves vérifiées par Lean
 * étape par étape : la compilation leur ajoute « LEAN » à côté du carré de fin. Même décompte que côté TeX
 */
compileHooks.leanQed = async (main: string): Promise<number[]> => {
  if (!store.get().settings.leanQedMark || !store.get().lean.status.ready) return []
  await loadProofs()
  const out: number[] = []
  const seen = new Set<string>()
  let n = 0
  const walk = (file: string): void => {
    const text = textOf(file) ?? contents.get(file)
    if (text == null || seen.has(file)) return
    seen.add(file)
    const proofs = findProofs(text)
    for (const m of text.matchAll(/\\(?:input|include)\{([^}]+)\}|\\begin\{(proof|preuve|demo|dem|demonstration|pf)\}/g)) {
      if (inComment(text, m.index)) continue
      if (m[1]) walk(inputPath(main, m[1]))
      else {
        n++
        const p = proofs.find((x) => x.proofFrom === m.index)
        if (p && proofHooks.mark(file, p) === 'ok') out.push(n)
      }
    }
  }
  walk(main)
  return out
}

const SUMMARY: Record<ProofMark, string> = {
  ok: 'preuve vérifiée par Lean, étape par étape',
  statement: 'énoncé vérifié par Lean (la preuve LaTeX n’a pas été suivie)',
  fail: 'refusée par Lean',
  stale: 'modifiée depuis la vérification, à revérifier',
  running: 'vérification en cours',
  none: 'jamais vérifiée'
}

/** État des preuves d'un document LaTeX, pour l'IA du copilot (vide si Lean n'est pas installé ou sans preuve) */
export function proofSummary(file: string): string[] {
  if (!store.get().lean.status.ready) return []
  const text = textOf(file) ?? contents.get(file) ?? ''
  return findProofs(text)
    .slice(0, 20)
    .map((p) => {
      const line = text.slice(0, p.from).split('\n').length
      const r = records[idOf(file, p)]
      const mark = proofHooks.mark(file, p)
      return `- ${p.env}${p.title ? ` (${p.title})` : ''}, ligne ${line} : ${SUMMARY[mark]}${mark === 'fail' && r?.problem ? `, ${r.problem}` : ''}`
    })
}

/** Panneau Lean : « Mettre à jour la coche » après avoir écrit la preuve soi-même */
export async function updateMarkFromLean(lean: string): Promise<void> {
  const info = proofOfLeanFile(lean)
  if (!info?.proof) return toast('La preuve LaTeX correspondante est introuvable (énoncé modifié ?)', 'error')
  if (running) return toast('Une vérification est déjà en cours', 'info')
  await recheck(idOf(info.file, info.proof), info.proof)
}

// --- Vérification par l'IA : conversation à part (couloir « lean »), suivie dans la fenêtre flottante ---

const setRun = (patch: Partial<ProofRun>): void => {
  const run = store.get().proofRun
  if (run) store.set({ proofRun: { ...run, ...patch } })
}
const setRound = (patch: Partial<ProofRun['rounds'][number]>): void => {
  const run = store.get().proofRun
  if (run) setRun({ rounds: [...run.rounds.slice(0, -1), { ...run.rounds[run.rounds.length - 1], ...patch }] })
}

let cancelled = false
/** Ollama ne garde pas la conversation : historique tenu ici */
let history: { role: string; content: string }[] = []

/** Bouton « Arrêter » de la fenêtre : la vérification s'arrête, la coche reste comme avant */
export async function cancelProofRun(): Promise<void> {
  cancelled = true
  await api.aiLeanStop()
}

/** Fermer la fenêtre d'une vérification terminée */
export function closeProofRun(): void {
  store.get().proofRun?.verdict?.resolve(false)
  store.set({ proofRun: null })
}

/** Question à l'IA choisie dans le copilot, réponse affichée au fil de l'eau ; null si arrêtée ou en erreur */
async function askAi(q: string): Promise<string | null> {
  const { settings, root } = store.get()
  const engine = settings.aiEngine
  setRun({ rounds: [...(store.get().proofRun?.rounds ?? []), { ai: '', lean: null, ok: null }], phase: 'L’IA écrit le Lean…' })
  let answer = ''
  const off = api.onAiLeanChunk((t) => {
    answer += t
    setRound({ ai: answer })
  })
  try {
    if (engine === 'ollama') history.push({ role: 'user', content: q })
    else await saveAll() // les agents lisent le projet sur le disque
    await api.aiLean(engine, root!, q, history)
    if (engine === 'ollama') history.push({ role: 'assistant', content: answer })
    return cancelled ? null : answer
  } catch (e) {
    if (!cancelled) setRun({ failure: { text: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), lean: null } })
    return null
  } finally {
    off()
  }
}

function firstPrompt(p: Proof, mode: Mode): string {
  const head = [
    mode === 'proof'
      ? 'Vérification d’une preuve avec Lean 4 et Mathlib : il faut vérifier la preuve LaTeX elle-même, étape par étape, et pas seulement l’énoncé.'
      : 'Vérification d’un énoncé avec Lean 4 et Mathlib.',
    `\nÉnoncé (${p.env}${p.title ? ` : ${p.title}` : ''}) en LaTeX :\n${p.statement}`,
    `\nPreuve en LaTeX :\n${p.proof}`,
    `\nÉcris un fichier Lean 4 complet, commençant par \`import Mathlib\`, avec un théorème nommé \`${leanName(p)}\` :`,
    '- son énoncé traduit fidèlement l’énoncé LaTeX (mêmes hypothèses, même conclusion, ni affaibli ni renforcé), même si l’énoncé est faux ;'
  ]
  const body =
    mode === 'proof'
      ? [
          '- sa preuve suit la preuve LaTeX : chaque affirmation de la preuve LaTeX devient une étape Lean, dans le même ordre, annoncée par un commentaire qui la cite :',
          '    -- Étape 1 : « citation exacte de la phrase LaTeX, formules entre $…$ »',
          '    have etape1 : <affirmation> := by <justification>',
          '- une justification peut compléter les détails que la preuve LaTeX laisse au lecteur (calculs, lemmes de Mathlib), mais ne doit ni changer de méthode, ni ajouter un argument absent de la preuve LaTeX, ni démontrer directement le théorème ;',
          '- chaque étape sert à la suite, comme dans la preuve LaTeX : une étape se déduit des précédentes, pas d’un calcul nouveau (l’éditeur vérifie que la preuve Lean utilise chaque étape) ;',
          '- la conclusion finale découle des étapes ;',
          '- ni `axiom`, ni `native_decide`.',
          'Si une étape de la preuve LaTeX est fausse, ou ne découle pas des étapes précédentes, ne la remplace pas et ne prouve pas autre chose : garde-la, justifie-la par `sorry`, et écris juste au-dessus de son `have` le commentaire `-- ÉTAPE FAUSSE : <raison, contre-exemple>` ou `-- ÉTAPE NON JUSTIFIÉE : <ce qui manque>`. N’utilise `sorry` nulle part ailleurs.'
        ]
      : ['- sa preuve suit si possible les étapes de la preuve LaTeX ;', '- ni `sorry`, ni `axiom`, ni `native_decide`.']
  return [
    ...head,
    ...body,
    'Commence ta réponse par une phrase en français qui dit ce qu’affirme l’énoncé Lean, puis donne le fichier dans un unique bloc ```lean.',
    'Ne modifie aucun fichier du projet et ne lance pas Lean : l’éditeur vérifie le fichier lui-même et te renverra les erreurs.'
  ].join('\n')
}

const AGAIN =
  'Commence ta réponse, comme la première fois, par une phrase en français qui dit ce qu’affirme l’énoncé Lean (pas ce que tu as corrigé), puis renvoie le fichier complet dans un unique bloc ```lean.'

/** Énoncé du théorème dans le fichier Lean (jusqu'au « := ») */
const leanStatement = (code: string, p: Proof): string =>
  new RegExp(`theorem\\s+${leanName(p)}[\\s\\S]*?:=`).exec(code)?.[0].replace(/\s*:=$/, '') ?? code.slice(0, 600)

/** Résumé de ce que dit Lean d'un tour, pour la fenêtre */
const leanSummary = (problems: string[]): string =>
  `Lean refuse ce fichier (${problems.length} problème${problems.length > 1 ? 's' : ''}) : l’IA corrige.\n${problems
    .slice(0, 3)
    .map((p) => `• ${p.split('\n')[0].slice(0, 160)}`)
    .join('\n')}`

async function withAi(file: string, p: Proof, mode: Mode): Promise<void> {
  const id = idOf(file, p)
  const { root, settings } = store.get()
  const lean = leanPath(file, p)
  const engine = settings.aiEngine
  // Une vérification à la fois (sa fenêtre suit une seule conversation)
  if (running) return toast('Une vérification est déjà en cours', 'info')
  running = id
  const status = await api.aiStatus(engine)
  if (!status.installed || !status.loggedIn) {
    running = null
    return toast('L’assistant IA n’est pas prêt : choisissez et connectez une IA dans le panneau du copilot', 'error', undefined, 6000)
  }
  cancelled = false
  history = [{ role: 'system', content: 'Tu es un expert de Lean 4 et de Mathlib, intégré à un éditeur LaTeX. Réponds en français.' }]
  await api.aiLeanReset(root!)
  const line = (textOf(file) ?? contents.get(file) ?? '').slice(0, p.from).split('\n').length
  store.set({
    proofRun: {
      title: `${p.env}${p.title ? ` (${p.title})` : ''} · ${file}, ligne ${line}`,
      open: true,
      phase: 'L’IA écrit le Lean…',
      rounds: [],
      verdict: null,
      failure: null,
      done: false
    }
  })
  refresh()
  try {
    let q = firstPrompt(p, mode)
    /** accepted : Lean valide tout ; refused : une étape de la preuve LaTeX est fausse ou non justifiée */
    let verdict: 'accepted' | 'refused' | null = null
    let explanation = ''
    let code = ''
    let steps: LeanStep[] = []
    for (let round = 0; round < ROUNDS && !verdict; round++) {
      const answer = await askAi(q)
      if (answer === null) {
        if (cancelled) setRun({ phase: 'Vérification arrêtée', done: true, open: false })
        else setRun({ phase: 'L’IA n’a pas répondu', done: true, open: true })
        if (cancelled) store.set({ proofRun: null })
        return
      }
      const blocks = [...answer.matchAll(/```lean4?[^\n]*\n([\s\S]*?)```/g)]
      if (!blocks.length) {
        setRound({ lean: 'Pas de fichier Lean dans la réponse : l’IA le renvoie.', ok: false })
        q = 'Il manque le fichier : renvoie-le en entier dans un unique bloc ```lean.'
        continue
      }
      code = blocks[blocks.length - 1][1]
      explanation = answer.slice(0, answer.indexOf('```')).trim() || explanation
      await api.write(root!, lean, code)
      if (docs.has(lean)) {
        replaceContent(lean, code)
        leanReplaced(lean)
      }
      setRun({ phase: 'Lean vérifie le fichier…' })
      const res = await checkProofFile(lean, leanName(p))
      if (cancelled) break
      steps = mode === 'proof' ? parseSteps(code) : []
      const unflagged = steps.some((s) => s.problem?.startsWith('Étape laissée'))
      if (mode === 'proof' && !steps.length) {
        setRound({ lean: 'La preuve n’est pas découpée en étapes : l’IA recommence.', ok: false })
        q = `La preuve n’est pas découpée en étapes. Chaque affirmation de la preuve LaTeX doit devenir une étape annoncée par « -- Étape n : « citation » » puis un \`have\`. ${AGAIN}`
      } else if (res.ok && mode === 'proof') {
        // Lean accepte : vérifier que la preuve Lean s'appuie sur chaque étape (sinon, elle a pris un autre chemin)
        setRound({ lean: 'Lean accepte le fichier. Vérification que chaque étape sert…', ok: true })
        setRun({ phase: 'Lean vérifie que chaque étape sert…' })
        const unused = await unusedSteps(code, leanName(p), steps)
        if (cancelled) break
        for (const s of steps) s.unused = unused.includes(s.n)
        if (!unused.length || round === ROUNDS - 1) {
          verdict = 'accepted'
          setRound({ lean: unused.length ? `Lean accepte, mais l’étape ${unused.join(', ')} ne sert pas.` : 'Lean accepte chaque étape ✓', ok: !unused.length })
        } else {
          setRound({ lean: `Lean accepte, mais la preuve Lean conclut sans l’étape ${unused.join(', ')} : l’IA doit suivre votre preuve.`, ok: false })
          q = `Lean accepte le fichier, mais la preuve Lean conclut sans utiliser ${unused.map((n) => `l’étape ${n} (« ${steps.find((s) => s.n === n)?.quote} »)`).join(', ')} : elle suit un autre chemin que la preuve LaTeX, par exemple un argument ou un calcul qui n’y figure pas. Chaque étape doit servir à la suite, comme dans la preuve LaTeX. Si une étape ne découle pas des précédentes sans argument nouveau, marque-la « -- ÉTAPE NON JUSTIFIÉE : … » et justifie-la par sorry. ${AGAIN}`
        }
      } else if (res.ok) {
        verdict = 'accepted'
        setRound({ lean: 'Lean accepte ✓', ok: true })
      }
      // Seules les étapes signalées fausses ou non justifiées sont en sorry : la preuve LaTeX est en cause, pas la traduction
      else if (mode === 'proof' && !res.errors && !res.axioms.length && steps.some((s) => s.problem) && !unflagged) {
        verdict = 'refused'
        setRound({ lean: `Une étape de votre preuve ne passe pas : ${steps.filter((s) => s.problem).map((s) => `étape ${s.n}`).join(', ')}.`, ok: false })
      } else {
        setRound({ lean: leanSummary(res.problems), ok: false })
        q = `Lean refuse le fichier :\n${res.problems.slice(0, 15).join('\n')}${
          unflagged ? '\nUne étape est laissée en sorry sans être signalée : justifie-la, ou marque-la « -- ÉTAPE FAUSSE : … » ou « -- ÉTAPE NON JUSTIFIÉE : … ».' : ''
        }\n\nCorrige-le sans changer le sens de l’énoncé${mode === 'proof' ? ' ni les étapes de la preuve' : ''}. ${AGAIN}`
      }
    }
    if (cancelled) {
      store.set({ proofRun: null })
      return toast('Vérification arrêtée', 'info')
    }
    records[id] = { lean, hash: p.hash, ok: false, mode }
    if (verdict) {
      // Acceptée : l'IA a pu mal traduire l'énoncé ou les étapes, un humain valide. Refusée : étapes en cause.
      // La fenêtre se rouvre si elle avait été fermée
      const answer = await new Promise<boolean>((resolve) =>
        setRun({
          open: true,
          done: true,
          phase: verdict === 'refused' ? 'Une étape ne passe pas' : 'À vous de valider',
          verdict: {
            env: p.env,
            title: p.title,
            statement: p.statement,
            lean: leanStatement(code, p),
            explanation,
            steps: mode === 'proof' ? steps : undefined,
            refused: verdict === 'refused',
            resolve
          }
        })
      )
      store.set({ proofRun: null })
      if (verdict === 'refused') {
        records[id].problem = steps
          .filter((s) => s.problem)
          .map((s) => `étape ${s.n} (« ${s.quote} ») : ${s.problem}`)
          .join(' ; ')
        if (answer) await openFile(lean)
      } else {
        records[id].ok = answer
        if (answer) toast(mode === 'proof' ? 'Preuve vérifiée par Lean, étape par étape ✓' : 'Énoncé vérifié par Lean ✓', 'success')
        else {
          await openFile(lean)
          toast('Corrigez le Lean, puis « Mettre à jour la coche » dans le panneau Lean', 'info', undefined, 7000)
        }
      }
    } else
      setRun({
        open: true,
        done: true,
        phase: 'Sans résultat',
        failure: { text: `L’IA n’a pas réussi à faire valider la preuve par Lean en ${ROUNDS} tours.`, lean }
      })
    await save()
  } finally {
    running = null
    refresh()
  }
}
