import path from 'path'

/** Environnements de preuve comptés (même liste que la détection des preuves, côté interface) */
const PROOF_ENVS = ['proof', 'preuve', 'demo', 'dem', 'demonstration', 'pf']

/**
 * Document compilé à travers un fichier caché de .lumentex (même nom, donc mêmes noms de sortie) : il ajoute « LEAN »
 * avant le carré de fin des preuves vérifiées (n°, dans l'ordre du document) puis charge le vrai fichier principal.
 * Le .tex de l'utilisateur n'est jamais modifié
 */
export function leanWrapper(mainAbs: string, verified: number[]): string {
  const hooks = PROOF_ENVS.map((e) => String.raw`\AddToHook{env/${e}/begin}{\lumen@mark}`).join('\n')
  return String.raw`\makeatletter
\newcount\lumen@proof
\def\lumen@verified{,${verified.join(',')},}
\def\lumen@leanmark{\hbox{\sffamily\fontsize{5}{6}\selectfont LEAN}\,}
\def\lumen@mark{%
  \global\advance\lumen@proof\@ne
  \edef\lumen@test{\noexpand\in@{,\the\lumen@proof,}{\lumen@verified}}\lumen@test
  \ifin@\ifdefined\qedsymbol
    \let\lumen@oldqed\qedsymbol
    \def\qedsymbol{\lumen@leanmark\lumen@oldqed}%
  \fi\fi}
\ifdefined\AddToHook
${hooks}
\fi
\makeatother
\input{"${mainAbs.split(path.sep).join('/')}"}
`
}
