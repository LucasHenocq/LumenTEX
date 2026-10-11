import type { LeanDiag } from '../../../shared/types'
import { docs, getView, replaceContent, textOf } from '../editor/setup'
import { findProofs, proofHooks, refreshProofs, type Proof, type ProofMark } from '../editor/proofs'
import { store, toast } from '../store'
import { emit } from './bus'
import { openFile, saveAll } from './actions'
import { contents } from './projectIndex'
import { leanReplaced } from './lean'

// Coches des preuves : chaque preuve vérifiée a son fichier Lean dans .lumentex/lean (le .tex reste intact).
// Vérifiée = Lean accepte le fichier, sans « sorry » ni axiome ajouté, et l'énoncé Lean a été validé par un humain.

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
}

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
}

proofHooks.mark = (file, p): ProofMark => {
  if (loadedFor !== store.get().root) void loadProofs()
  const id = idOf(file, p)
  if (running === id) return 'running'
  const r = records[id]
  if (!r) return 'none'
  if (r.hash !== p.hash) return 'stale'
  return r.ok ? 'ok' : 'fail'
}

proofHooks.click = (file, p) => void clicked(file, p)

async function clicked(file: string, p: Proof): Promise<void> {
  if (running) return toast('Une vérification est déjà en cours', 'info')
  const id = idOf(file, p)
  const r = records[id]
  const mark = proofHooks.mark(file, p)
  const choice = await api.popupMenu(
    !r
      ? [
          { id: 'ai', label: 'Vérifier avec l’IA' },
          { id: 'manual', label: 'Écrire la preuve en Lean moi-même' }
        ]
      : [
          ...(mark === 'stale'
            ? [
                { id: 'ai', label: 'Refaire avec l’IA (preuve modifiée)' },
                { id: 'open', label: 'Ouvrir le fichier Lean pour l’adapter' },
                { id: 'check', label: 'Le Lean est toujours juste : revérifier' }
              ]
            : [
                { id: 'check', label: 'Revérifier avec Lean' },
                { id: 'open', label: 'Ouvrir le fichier Lean' },
                { id: 'ai', label: 'Refaire avec l’IA' }
              ]),
          { type: 'separator' as const },
          { id: 'forget', label: 'Oublier cette vérification' }
        ]
  )
  if (choice === 'ai') await withAi(file, p)
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
  records[idOf(file, p)] = { lean, hash: p.hash, ok: false }
  await save()
  refresh()
  await openFile(lean)
  toast('Écrivez l’énoncé et la preuve en Lean, puis « Mettre à jour la coche » dans le panneau Lean', 'info', undefined, 7000)
}

/** Vérifie un fichier de preuve : accepté par Lean, sans sorry, avec le théorème attendu et sans axiome ajouté */
async function checkProofFile(lean: string, name: string): Promise<{ ok: boolean; problems: string[]; axioms: string[] }> {
  const root = store.get().root!
  const text = textOf(lean) ?? (await api.read(root, lean))
  const probe = `${DIR}/.verification.lean`
  await api.write(root, probe, `${text}\n\n#print axioms ${name}\n`)
  const r = await api.leanCheck(abs(probe))
  // Erreurs et preuves laissées en sorry (les autres avertissements, style ou variable inutilisée, ne comptent pas)
  const problems = r.messages
    .filter((m) => m.severity === 'error' || /declaration uses ['`]sorry['`]/.test(m.message))
    .map((m: LeanDiag) => `ligne ${m.line} : ${m.message.slice(0, 600)}`)
  const axioms = r.messages.find((m) => /depends on axioms/.test(m.message))?.message
  const used = axioms ? (/\[([^\]]*)\]/.exec(axioms)?.[1] ?? '').split(',').map((a) => a.trim()) : []
  // sorryAx : preuve incomplète (signalée à part) ; les autres : axiomes ajoutés, native_decide…
  const extra = used.filter((a) => a && !AXIOMS.has(a) && a !== 'sorryAx')
  if (used.includes('sorryAx') && !problems.length) problems.push('La preuve contient encore sorry.')
  if (extra.length) problems.push(`La preuve repose sur des axiomes non admis : ${extra.join(', ')}. Elle doit se passer de sorry, d'axiomes ajoutés et de native_decide.`)
  if (!r.messages.some((m) => /depends on axioms|does not depend on any axioms/.test(m.message)) && !problems.length)
    problems.push(`Le théorème doit s'appeler ${name}.`)
  return { ok: r.ok && !problems.length, problems, axioms: extra }
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

/** Panneau Lean : « Mettre à jour la coche » après avoir écrit la preuve soi-même */
export async function updateMarkFromLean(lean: string): Promise<void> {
  const info = proofOfLeanFile(lean)
  if (!info?.proof) return toast('La preuve LaTeX correspondante est introuvable (énoncé modifié ?)', 'error')
  if (running) return toast('Une vérification est déjà en cours', 'info')
  await recheck(idOf(info.file, info.proof), info.proof)
}

/** Question à l'assistant IA (panneau du copilot) ; null s'il n'est pas disponible ou déjà occupé */
const askAi = (q: string): Promise<string | null> => new Promise((done) => emit('copilot:run', { q, done }))

function firstPrompt(p: Proof): string {
  return [
    'Vérification d’une preuve avec Lean 4 et Mathlib.',
    `\nÉnoncé (${p.env}${p.title ? ` : ${p.title}` : ''}) en LaTeX :\n${p.statement}`,
    `\nPreuve en LaTeX :\n${p.proof}`,
    `\nÉcris un fichier Lean 4 complet, commençant par \`import Mathlib\`, avec un théorème nommé \`${leanName(p)}\` :`,
    '- son énoncé traduit fidèlement l’énoncé LaTeX (mêmes hypothèses, même conclusion, ni affaibli ni renforcé) ;',
    '- sa preuve suit si possible les étapes de la preuve LaTeX ;',
    '- ni `sorry`, ni `axiom`, ni `native_decide`.',
    'Commence ta réponse par une phrase en français qui dit ce qu’affirme l’énoncé Lean, puis donne le fichier dans un unique bloc ```lean.',
    'Ne modifie aucun fichier du projet et ne lance pas Lean : l’éditeur vérifie le fichier lui-même et te renverra les erreurs.'
  ].join('\n')
}

async function withAi(file: string, p: Proof): Promise<void> {
  const id = idOf(file, p)
  const root = store.get().root!
  const lean = leanPath(file, p)
  running = id
  refresh()
  try {
    let q = firstPrompt(p)
    let ok = false
    let explanation = ''
    let code = ''
    for (let round = 0; round < ROUNDS && !ok; round++) {
      const answer = await askAi(q)
      if (answer === null) {
        toast('L’assistant IA n’est pas disponible (occupé, ou pas encore connecté)', 'error')
        return
      }
      const blocks = [...answer.matchAll(/```lean4?[^\n]*\n([\s\S]*?)```/g)]
      if (!blocks.length) {
        q = 'Il manque le fichier : renvoie-le en entier dans un unique bloc ```lean.'
        continue
      }
      code = blocks[blocks.length - 1][1]
      explanation = answer.slice(0, answer.indexOf('```')).trim() || explanation
      await api.write(root, lean, code)
      if (docs.has(lean)) {
        replaceContent(lean, code)
        leanReplaced(lean)
      }
      const res = await checkProofFile(lean, leanName(p))
      ok = res.ok
      if (!ok)
        q = `Lean refuse le fichier :\n${res.problems.slice(0, 15).join('\n')}\n\nCorrige-le sans changer le sens de l’énoncé, et renvoie le fichier complet dans un unique bloc \`\`\`lean.`
    }
    records[id] = { lean, hash: p.hash, ok: false }
    if (ok) {
      // L'IA a pu mal traduire l'énoncé : un humain le valide
      const statement = new RegExp(`theorem\\s+${leanName(p)}[\\s\\S]*?:=`).exec(code)?.[0].replace(/\s*:=$/, '') ?? code.slice(0, 600)
      const approved = await api.confirm(
        'Lean a validé la preuve. Est-ce bien votre énoncé ?',
        `${p.env}${p.title ? ` (${p.title})` : ''} en LaTeX :\n${p.statement.slice(0, 500)}\n\nÉnoncé vérifié par Lean :\n${statement}${explanation ? `\n\nSelon l’IA : ${explanation.slice(0, 400)}` : ''}`,
        'Oui, c’est mon énoncé',
        'Non, à revoir'
      )
      records[id].ok = approved
      if (approved) toast('Preuve vérifiée par Lean ✓', 'success')
      else {
        await openFile(lean)
        toast('Corrigez l’énoncé en Lean, puis « Mettre à jour la coche » dans le panneau Lean', 'info', undefined, 7000)
      }
    } else
      toast('L’IA n’a pas réussi à faire valider la preuve par Lean', 'error', { label: 'Ouvrir le Lean', run: () => void openFile(lean) }, 8000)
    await save()
  } finally {
    running = null
    refresh()
  }
}
