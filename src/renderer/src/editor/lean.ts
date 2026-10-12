import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { tags as t } from '@lezer/highlight'

// Fichiers Lean 4 : coloration simple et saisie des symboles comme dans VS Code (\to + espace → →)

const KEYWORDS = new Set(
  (
    'theorem lemma def example abbrev instance structure class inductive where extends deriving namespace section end open ' +
    'import variable universe noncomputable private protected set_option attribute local scoped mutual ' +
    'fun λ let have show from by at with match if then else do return calc suffices obtain intro intros exact apply refine rw ' +
    'rwa simp simp_all norm_num ring linarith nlinarith positivity omega decide constructor cases rcases induction use exists ' +
    'contradiction exfalso unfold field_simp push_neg by_contra by_cases specialize aesop gcongr congr ext funext tauto trivial rfl ' +
    'left right refine\' exact? apply? first try repeat all_goals any_goals case next'
  ).split(' ')
)

type State = { comment: number }

const parser: StreamParser<State> = {
  name: 'lean',
  startState: () => ({ comment: 0 }),
  copyState: (s) => ({ ...s }),
  token(stream, state) {
    // Commentaires imbriqués /- … -/
    if (state.comment || stream.match('/-')) {
      if (!state.comment) state.comment = 1
      while (!stream.eol()) {
        if (stream.match('/-')) state.comment++
        else if (stream.match('-/')) {
          if (--state.comment === 0) break
        } else stream.next()
      }
      return 'comment'
    }
    if (stream.match('--')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.eatSpace()) return null
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string'
    if (stream.match(/^\d+(\.\d+)?/)) return 'number'
    if (stream.match(/^sorry\b/)) return 'invalid'
    const word = stream.match(/^[A-Za-z_À-῿][\w'!?.À-῿]*/) as RegExpMatchArray | null
    if (word) {
      if (KEYWORDS.has(word[0])) return 'keyword'
      return /^[A-Z]/.test(word[0]) ? 'typeName' : null
    }
    if (stream.match(/^[⊢→←↔∀∃λ∧∨¬=≠≤≥<>+*/^∣∘×∈∉⊆∪∩:]+/)) return 'operator'
    stream.next()
    return null
  },
  languageData: { commentTokens: { line: '--', block: { open: '/-', close: '-/' } } }
}

const leanHighlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.string, color: 'var(--syn-string)' },
  { tag: t.number, color: 'var(--syn-number)' },
  { tag: t.typeName, color: 'var(--syn-env)' },
  { tag: t.operator, color: 'var(--syn-math-cmd)' },
  { tag: t.invalid, color: 'var(--danger)', fontWeight: '700' }
])

/** Abréviations de l'extension Lean de VS Code (les plus courantes) */
export const ABBREV: Record<string, string> = {
  to: '→', r: '→', '->': '→', l: '←', '<-': '←', lr: '↔', iff: '↔', '<->': '↔', and: '∧', or: '∨', not: '¬', neg: '¬',
  forall: '∀', all: '∀', exists: '∃', ex: '∃', fun: 'λ', lam: 'λ', in: '∈', notin: '∉', sub: '⊆', subset: '⊆', ssub: '⊂',
  sup: '⊇', supset: '⊇', cap: '∩', inter: '∩', cup: '∪', union: '∪', empty: '∅', emptyset: '∅', le: '≤', '<=': '≤', ge: '≥',
  '>=': '≥', ne: '≠', neq: '≠', '=n': '≠', comp: '∘', circ: '∘', o: '∘', times: '×', x: '×', cdot: '·', '.': '·', sum: '∑',
  prod: '∏', infty: '∞', top: '⊤', bot: '⊥', inf: '⊓', sup2: '⊔', dvd: '∣', mid: '∣', '|': '∣', equiv: '≡', simeq: '≃',
  iso: '≅', '<': '⟨', '>': '⟩', langle: '⟨', rangle: '⟩', '|-': '⊢', vdash: '⊢', norm: '‖', sqrt: '√', inv: '⁻¹', '-1': '⁻¹',
  N: 'ℕ', Z: 'ℤ', Q: 'ℚ', R: 'ℝ', C: 'ℂ', nat: 'ℕ', int: 'ℤ', rat: 'ℚ', real: 'ℝ', complex: 'ℂ',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', eps: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ',
  omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  _0: '₀', _1: '₁', _2: '₂', _3: '₃', _4: '₄', _5: '₅', _6: '₆', _7: '₇', _8: '₈', _9: '₉', _n: 'ₙ', _i: 'ᵢ',
  '^2': '²', '^3': '³', '^n': 'ⁿ'
}

/** Panneau des symboles pour un fichier .lean : abréviations par groupe (le caractère est ABBREV[abréviation]) */
export const LEAN_SYMBOL_GROUPS: { name: string; items: string[] }[] = [
  { name: 'Logique', items: ['forall', 'exists', 'not', 'and', 'or', 'to', 'iff', 'l', '|-', 'top', 'bot', 'fun'] },
  { name: 'Ensembles', items: ['in', 'notin', 'sub', 'ssub', 'sup', 'cap', 'cup', 'empty', 'times', 'inf', 'sup2'] },
  { name: 'Relations', items: ['le', 'ge', 'ne', 'equiv', 'simeq', 'iso', 'dvd'] },
  { name: 'Nombres', items: ['N', 'Z', 'Q', 'R', 'C', 'infty', 'sqrt', 'sum', 'prod'] },
  { name: 'Opérations', items: ['comp', 'cdot', 'inv', 'norm', '<', '>'] },
  {
    name: 'Grec',
    items: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'phi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega']
  },
  { name: 'Indices et exposants', items: ['_0', '_1', '_2', '_3', '_4', '_5', '_6', '_7', '_8', '_9', '_n', '_i', '^2', '^3', '^n'] }
]

/** « \to » suivi d'une espace, d'une tabulation ou d'une ponctuation devient « → » */
const abbreviations = EditorView.inputHandler.of((view, from, to, text) => {
  if (!/^[\s(),:\]}]$/.test(text) || from !== to) return false
  const line = view.state.doc.lineAt(from)
  const m = /\\([^\s\\]+)$/.exec(line.text.slice(0, from - line.from))
  const sym = m && ABBREV[m[1]]
  if (!sym) return false
  view.dispatch({
    changes: { from: from - m[0].length, to, insert: sym + (text === ' ' ? ' ' : text) },
    userEvent: 'input.type'
  })
  return true
})

export const leanLanguage: Extension = [StreamLanguage.define(parser), syntaxHighlighting(leanHighlight), abbreviations]
