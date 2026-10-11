import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView, gutter, GutterMarker } from '@codemirror/view'
import { fileFacet } from './features'

// Preuves d'un document LaTeX et leur coche Lean dans la marge (jamais dans le PDF : rien n'est écrit dans le .tex)

export interface Proof {
  /** Identifiant stable : \label de l'énoncé, sinon empreinte de l'énoncé */
  key: string
  /** Environnement de l'énoncé (theorem, prop…) et son titre éventuel */
  env: string
  title: string
  statement: string
  proof: string
  /** Empreinte de l'énoncé et de la preuve : différente après une modification → à revérifier */
  hash: string
  /** Position du \begin de l'énoncé (la coche est sur sa ligne) */
  from: number
}

const PROOF_ENV = /^(proof|preuve|demo|dem|demonstration|démonstration|pf)\*?$/i
/** Environnements qui ne sont pas des énoncés (une preuve qui les suit n'a pas d'énoncé) */
const NOT_STATEMENT = /^(equation|align|gather|multline|flalign|eqnarray|itemize|enumerate|description|figure|table|center|tabular|array|[pbvBV]?matrix|cases|tikzpicture|minipage|quote|quotation|verbatim|lstlisting|minted|displaymath|math|proof|preuve|demo|dem|demonstration|démonstration|pf)\*?$/i

/** Empreinte FNV-1a (espaces normalisés) */
export function hash(s: string): string {
  let h = 0x811c9dc5
  for (const c of s.replace(/\s+/g, ' ').trim()) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Énoncés suivis d'une preuve : \begin{X}…\end{X}, puis (espaces et commentaires seulement) \begin{proof}…\end{proof} */
export function findProofs(text: string): Proof[] {
  const out: Proof[] = []
  const begin = /\\begin\{([^}]+)\}/g
  for (let m; (m = begin.exec(text)); ) {
    if (!PROOF_ENV.test(m[1])) continue
    const env = m[1]
    const endIdx = text.indexOf(`\\end{${env}}`, begin.lastIndex)
    if (endIdx < 0) continue
    // Énoncé juste avant (seulement des espaces entre les deux)
    let i = m.index
    while (i > 0 && /\s/.test(text[i - 1])) i--
    if (text[i - 1] !== '}') continue
    const endAt = text.lastIndexOf('\\end{', i)
    const name = text.slice(endAt + 5, i - 1)
    if (endAt < 0 || name.includes('}') || NOT_STATEMENT.test(name)) continue
    const start = text.lastIndexOf(`\\begin{${name}}`, endAt)
    if (start < 0) continue
    let statement = text.slice(start + `\\begin{${name}}`.length, endAt)
    const title = /^\s*\[([^\]]*)\]/.exec(statement)
    if (title) statement = statement.slice(title[0].length)
    const proof = text.slice(begin.lastIndex, endIdx).replace(/^\s*\[[^\]]*\]/, '')
    const label = /\\label\{([^}]+)\}/.exec(statement)?.[1]
    out.push({
      key: label ?? `h${hash(statement)}`,
      env: name,
      title: title?.[1] ?? '',
      statement: statement.replace(/\\label\{[^}]*\}/g, '').trim(),
      proof: proof.trim(),
      hash: hash(statement + '\0' + proof),
      from: start
    })
    begin.lastIndex = endIdx
  }
  return out
}

/** État d'une coche : vérifiée, refusée, à revérifier, en cours, jamais vérifiée */
export type ProofMark = 'ok' | 'fail' | 'stale' | 'running' | 'none'

/** Renseignés par lib/proofs.ts */
export const proofHooks = {
  mark: (_file: string, _p: Proof): ProofMark => 'none',
  click: (_file: string, _p: Proof): void => {}
}

/** Redessine les coches (vérification terminée, nouvel état) */
export const refreshProofs = StateEffect.define<null>()

const proofsField = StateField.define<Proof[]>({
  create: (s) => findProofs(s.doc.toString()),
  update: (v, tr) => (tr.docChanged ? findProofs(tr.newDoc.toString()) : v)
})

const TITLES: Record<ProofMark, string> = {
  ok: 'Preuve vérifiée par Lean',
  fail: 'Lean n’a pas validé cette preuve · cliquer pour les options',
  stale: 'Modifiée depuis la vérification : à revérifier',
  running: 'Vérification en cours…',
  none: 'Vérifier cette preuve avec Lean'
}
const ICONS: Record<ProofMark, string> = { ok: '✓', fail: '✗', stale: '↻', running: '…', none: '○' }

class Mark extends GutterMarker {
  constructor(readonly state: ProofMark) {
    super()
  }
  eq(o: Mark): boolean {
    return o.state === this.state
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = `proof-mark ${this.state}`
    el.textContent = ICONS[this.state]
    el.title = TITLES[this.state]
    return el
  }
}

const proofAt = (view: EditorView, lineFrom: number, lineTo: number): Proof | undefined =>
  view.state.field(proofsField).find((p) => p.from >= lineFrom && p.from <= lineTo)

/** Colonne des coches (seulement quand Lean est installé) */
export const proofGutter: Extension = [
  proofsField,
  gutter({
    class: 'cm-proof-gutter',
    lineMarker(view, line) {
      const p = proofAt(view, line.from, line.to)
      return p ? new Mark(proofHooks.mark(view.state.facet(fileFacet), p)) : null
    },
    lineMarkerChange: (u) => u.docChanged || u.transactions.some((t) => t.effects.some((e) => e.is(refreshProofs))),
    domEventHandlers: {
      mousedown(view, line) {
        const p = proofAt(view, line.from, line.to)
        if (!p) return false
        proofHooks.click(view.state.facet(fileFacet), p)
        return true
      }
    }
  })
]
