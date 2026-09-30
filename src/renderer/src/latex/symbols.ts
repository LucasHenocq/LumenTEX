/** Palette de symboles : [code affiché (rendu KaTeX), gabarit d'insertion (snippet) facultatif] */
export interface SymbolGroup {
  name: string
  items: [string, string?][]
}

const s = (list: string): [string][] => list.trim().split(/\s+/).map((c) => [c])

export const SYMBOL_GROUPS: SymbolGroup[] = [
  {
    name: 'Grec',
    items: s(String.raw`\alpha \beta \gamma \delta \epsilon \varepsilon \zeta \eta \theta \vartheta \iota \kappa \lambda \mu \nu \xi \pi \varpi \rho \varrho \sigma \varsigma \tau \upsilon \phi \varphi \chi \psi \omega \Gamma \Delta \Theta \Lambda \Xi \Pi \Sigma \Upsilon \Phi \Psi \Omega`)
  },
  {
    name: 'Opérateurs',
    items: s(String.raw`+ - \pm \mp \times \div \cdot \ast \star \circ \bullet \oplus \ominus \otimes \oslash \odot \cap \cup \sqcap \sqcup \wedge \vee \setminus \wr \diamond \bigtriangleup \bigtriangledown \triangleleft \triangleright \dagger \ddagger \amalg`)
  },
  {
    name: 'Relations',
    items: s(String.raw`= \neq \leq \geq \leqslant \geqslant \ll \gg \prec \succ \preceq \succeq \sim \simeq \approx \cong \equiv \propto \doteq \in \notin \ni \subset \supset \subseteq \supseteq \subsetneq \sqsubseteq \perp \parallel \mid \nmid \models \vdash \dashv \asymp \bowtie`)
  },
  {
    name: 'Flèches',
    items: s(String.raw`\to \gets \leftrightarrow \Rightarrow \Leftarrow \Leftrightarrow \implies \impliedby \iff \mapsto \longrightarrow \longleftarrow \longmapsto \Longrightarrow \Longleftrightarrow \uparrow \downarrow \updownarrow \Uparrow \Downarrow \nearrow \searrow \swarrow \nwarrow \hookrightarrow \hookleftarrow \rightharpoonup \rightleftharpoons \leadsto \twoheadrightarrow \rightrightarrows \circlearrowleft`)
  },
  {
    name: 'Grands opérateurs',
    items: [
      ['\\sum_{i=1}^{n}'], ['\\prod_{i=1}^{n}'], ['\\coprod'], ['\\int_{a}^{b}'], ['\\iint'], ['\\iiint'], ['\\oint'],
      ['\\bigcup_{i}'], ['\\bigcap_{i}'], ['\\bigoplus'], ['\\bigotimes'], ['\\bigvee'], ['\\bigwedge'], ['\\bigsqcup'],
      ['\\lim_{x \\to \\infty}'], ['\\limsup'], ['\\liminf'], ['\\sup'], ['\\inf'], ['\\max'], ['\\min'], ['\\arg\\max']
    ]
  },
  {
    name: 'Structures',
    items: [
      ['\\frac{a}{b}', '\\frac{${a}}{${b}}'], ['\\dfrac{a}{b}', '\\dfrac{${a}}{${b}}'], ['\\sqrt{x}', '\\sqrt{${x}}'],
      ['\\sqrt[n]{x}', '\\sqrt[${n}]{${x}}'], ['x^{n}', '^{${n}}'], ['x_{i}', '_{${i}}'], ['x_{i}^{n}', '_{${i}}^{${n}}'],
      ['\\binom{n}{k}', '\\binom{${n}}{${k}}'], ['\\hat{x}', '\\hat{${x}}'], ['\\widehat{xy}', '\\widehat{${xy}}'],
      ['\\bar{x}', '\\bar{${x}}'], ['\\overline{xy}', '\\overline{${xy}}'], ['\\vec{v}', '\\vec{${v}}'],
      ['\\overrightarrow{AB}', '\\overrightarrow{${AB}}'], ['\\dot{x}', '\\dot{${x}}'], ['\\ddot{x}', '\\ddot{${x}}'],
      ['\\tilde{x}', '\\tilde{${x}}'], ['\\widetilde{xy}', '\\widetilde{${xy}}'], ['\\underline{x}', '\\underline{${x}}'],
      ['\\underbrace{x+y}_{n}', '\\underbrace{${x}}_{${texte}}'], ['\\overbrace{x+y}^{n}', '\\overbrace{${x}}^{${texte}}'],
      ['\\overset{a}{b}', '\\overset{${a}}{${b}}'], ['\\underset{a}{b}', '\\underset{${a}}{${b}}'],
      ['\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', '\\begin{pmatrix}\n\t${a} & ${b} \\\\\n\t${c} & ${d}\n\\end{pmatrix}'],
      ['\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}', '\\begin{bmatrix}\n\t${a} & ${b} \\\\\n\t${c} & ${d}\n\\end{bmatrix}'],
      ['\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}', '\\begin{vmatrix}\n\t${a} & ${b} \\\\\n\t${c} & ${d}\n\\end{vmatrix}'],
      ['\\begin{cases} a & x>0 \\\\ b & x\\le 0 \\end{cases}', '\\begin{cases}\n\t${a} & ${condition} \\\\\n\t${b} & \\text{sinon}\n\\end{cases}']
    ]
  },
  {
    name: 'Délimiteurs',
    items: [
      ['\\left( x \\right)', '\\left( ${} \\right)'], ['\\left[ x \\right]', '\\left[ ${} \\right]'],
      ['\\left\\{ x \\right\\}', '\\left\\\\{ ${} \\right\\\\}'], ['\\left| x \\right|', '\\left| ${} \\right|'],
      ['\\left\\| x \\right\\|', '\\left\\| ${} \\right\\|'], ['\\langle x \\rangle', '\\langle ${} \\rangle'],
      ['\\lceil x \\rceil', '\\lceil ${} \\rceil'], ['\\lfloor x \\rfloor', '\\lfloor ${} \\rfloor']
    ]
  },
  {
    name: 'Ensembles et logique',
    items: s(String.raw`\mathbb{N} \mathbb{Z} \mathbb{Q} \mathbb{R} \mathbb{C} \mathbb{K} \emptyset \varnothing \forall \exists \nexists \neg \land \lor \top \bot \therefore \because \infty \aleph_0 \wp \Re \Im`)
  },
  {
    name: 'Divers',
    items: s(String.raw`\partial \nabla \Delta \hbar \ell \imath \jmath \prime \degree \angle \measuredangle \triangle \square \blacksquare \clubsuit \diamondsuit \heartsuit \spadesuit \flat \natural \sharp \checkmark \ldots \cdots \vdots \ddots \dagger \S \P \copyright \pounds \mathcal{L} \mathcal{F} \mathscr{C} \mathfrak{g}`)
  },
  {
    name: 'Polices',
    items: [
      ['\\mathbf{A}'], ['\\mathit{A}'], ['\\mathrm{A}'], ['\\mathsf{A}'], ['\\mathtt{A}'], ['\\mathcal{A}'],
      ['\\mathscr{A}'], ['\\mathfrak{A}'], ['\\mathbb{A}'], ['\\boldsymbol{\\alpha}'], ['\\text{texte}', '\\text{${texte}}'],
      ['\\operatorname{op}', '\\operatorname{${op}}']
    ]
  }
]
