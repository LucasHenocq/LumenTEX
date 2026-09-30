import type { TemplateFile } from '../../../shared/types'

export interface Template {
  id: string
  name: string
  description: string
  accent: string
  files: (title: string, author: string) => TemplateFile[]
}

const PREAMBLE_FR = `\\usepackage[french]{babel}
\\usepackage{amsmath, amssymb, amsthm}
\\usepackage{graphicx}
\\usepackage[a4paper, margin=2.5cm]{geometry}
\\usepackage{xcolor}
\\usepackage[hidelinks]{hyperref}`

const BIB = `@book{knuth1984,
  author    = {Donald E. Knuth},
  title     = {The {\\TeX}book},
  publisher = {Addison-Wesley},
  year      = {1984}
}

@article{lamport1994,
  author  = {Leslie Lamport},
  title   = {{\\LaTeX}: A Document Preparation System},
  journal = {Addison-Wesley},
  year    = {1994}
}
`

export const TEMPLATES: Template[] = [
  {
    id: 'blank',
    name: 'Vide',
    description: 'Un document minimal pour partir de zéro',
    accent: '#8b8d98',
    files: (title) => [
      {
        path: 'main.tex',
        content: `\\documentclass[11pt]{article}
\\usepackage[french]{babel}
\\usepackage{amsmath, amssymb}

\\title{${title}}

\\begin{document}

\\maketitle

Bonjour !

\\end{document}
`
      }
    ]
  },
  {
    id: 'article',
    name: 'Article',
    description: 'Article scientifique avec sections, équations et bibliographie',
    accent: '#7c5cff',
    files: (title, author) => [
      {
        path: 'main.tex',
        content: `\\documentclass[11pt]{article}
${PREAMBLE_FR}
\\usepackage{booktabs}

\\newtheorem{theoreme}{Théorème}
\\newcommand{\\R}{\\mathbb{R}}

\\title{${title}}
\\author{${author}}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
  Ce document présente un exemple d’article rédigé avec \\LaTeX.
\\end{abstract}

\\section{Introduction}
\\label{sec:intro}

Le célèbre ouvrage de Knuth~\\cite{knuth1984} a posé les bases de \\TeX.
Nous rappelons l’identité d’Euler dans l’équation~\\eqref{eq:euler}.

\\begin{equation}
  e^{i\\pi} + 1 = 0
  \\label{eq:euler}
\\end{equation}

\\section{Résultats}
\\label{sec:resultats}

\\begin{theoreme}
  Pour tout $x \\in \\R$, on a $\\displaystyle \\int_{-\\infty}^{+\\infty} e^{-t^2}\\,\\mathrm{d}t = \\sqrt{\\pi}$.
\\end{theoreme}

\\begin{table}[htbp]
  \\centering
  \\caption{Un tableau avec booktabs}
  \\label{tab:exemple}
  \\begin{tabular}{lcr}
    \\toprule
    Méthode & Précision & Temps (s) \\\\
    \\midrule
    A & 0,92 & 1,3 \\\\
    B & 0,95 & 2,1 \\\\
    \\bottomrule
  \\end{tabular}
\\end{table}

\\section{Conclusion}

Voir la section~\\ref{sec:intro} et le tableau~\\ref{tab:exemple}.

\\bibliographystyle{plain}
\\bibliography{references}

\\end{document}
`
      },
      { path: 'references.bib', content: BIB }
    ]
  },
  {
    id: 'report',
    name: 'Rapport / Mémoire',
    description: 'Document long en chapitres séparés, table des matières',
    accent: '#2f9e8f',
    files: (title, author) => [
      {
        path: 'main.tex',
        content: `\\documentclass[11pt, a4paper]{report}
${PREAMBLE_FR}
\\usepackage{booktabs}

\\title{${title}}
\\author{${author}}
\\date{\\today}

\\begin{document}

\\maketitle
\\tableofcontents

\\include{chapitres/introduction}
\\include{chapitres/developpement}
\\include{chapitres/conclusion}

\\appendix
\\chapter{Annexe}
Contenu de l’annexe.

\\bibliographystyle{plain}
\\bibliography{references}

\\end{document}
`
      },
      {
        path: 'chapitres/introduction.tex',
        content: `\\chapter{Introduction}
\\label{chap:intro}

Présentation du contexte et de la problématique.

\\section{Contexte}

Voir~\\cite{lamport1994}.

\\section{Objectifs}

\\begin{itemize}
  \\item Premier objectif ;
  \\item Deuxième objectif.
\\end{itemize}
`
      },
      {
        path: 'chapitres/developpement.tex',
        content: `\\chapter{Développement}
\\label{chap:dev}

\\section{Méthode}

\\begin{equation}
  f(x) = \\sum_{n=0}^{\\infty} \\frac{f^{(n)}(a)}{n!} (x-a)^n
  \\label{eq:taylor}
\\end{equation}

\\section{Résultats}

Les résultats découlent de l’équation~\\eqref{eq:taylor}.
`
      },
      {
        path: 'chapitres/conclusion.tex',
        content: `\\chapter{Conclusion}

Synthèse du travail (voir chapitre~\\ref{chap:intro}).
`
      },
      { path: 'references.bib', content: BIB }
    ]
  },
  {
    id: 'beamer',
    name: 'Présentation',
    description: 'Diaporama Beamer avec thème moderne',
    accent: '#e8590c',
    files: (title, author) => [
      {
        path: 'main.tex',
        content: `\\documentclass[aspectratio=169]{beamer}
\\usepackage[french]{babel}
\\usepackage{amsmath, amssymb}
\\usepackage{graphicx}

\\usetheme{Madrid}
\\usecolortheme{beaver}
\\setbeamertemplate{navigation symbols}{}

\\title{${title}}
\\author{${author}}
\\date{\\today}

\\begin{document}

\\begin{frame}
  \\titlepage
\\end{frame}

\\begin{frame}{Plan}
  \\tableofcontents
\\end{frame}

\\section{Introduction}

\\begin{frame}{Introduction}
  \\begin{itemize}
    \\item<1-> Premier point
    \\item<2-> Deuxième point
    \\item<3-> Troisième point
  \\end{itemize}
\\end{frame}

\\section{Contenu}

\\begin{frame}{Une formule}
  \\begin{block}{Théorème de Pythagore}
    Dans un triangle rectangle : $a^2 + b^2 = c^2$.
  \\end{block}
  \\begin{columns}
    \\column{0.5\\textwidth}
    Colonne gauche
    \\column{0.5\\textwidth}
    Colonne droite
  \\end{columns}
\\end{frame}

\\begin{frame}
  \\centering\\Huge Merci !
\\end{frame}

\\end{document}
`
      }
    ]
  },
  {
    id: 'math',
    name: 'Devoir de maths',
    description: 'Exercices, théorèmes et démonstrations',
    accent: '#1971c2',
    files: (title, author) => [
      {
        path: 'main.tex',
        content: `\\documentclass[11pt]{article}
${PREAMBLE_FR}
\\usepackage{enumitem}

\\theoremstyle{definition}
\\newtheorem{exercice}{Exercice}
\\newtheorem*{solution}{Solution}
\\theoremstyle{plain}
\\newtheorem{theoreme}{Théorème}
\\newtheorem{lemme}[theoreme]{Lemme}

\\newcommand{\\N}{\\mathbb{N}}
\\newcommand{\\R}{\\mathbb{R}}
\\newcommand{\\abs}[1]{\\left\\lvert #1 \\right\\rvert}

\\title{${title}}
\\author{${author}}
\\date{\\today}

\\begin{document}
\\maketitle

\\begin{exercice}
  Montrer que pour tout $n \\in \\N$ :
  \\[
    \\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}.
  \\]
\\end{exercice}

\\begin{proof}
  Par récurrence sur $n$. Pour $n = 0$ la somme est vide et vaut $0$.
  Supposons la propriété vraie au rang $n$ ; alors
  \\begin{align*}
    \\sum_{k=1}^{n+1} k &= \\frac{n(n+1)}{2} + (n+1) \\\\
                       &= \\frac{(n+1)(n+2)}{2}.
  \\end{align*}
\\end{proof}

\\begin{exercice}
  Soit $f : \\R \\to \\R$ définie par $f(x) = \\abs{x}$.
  \\begin{enumerate}[label=\\alph*)]
    \\item $f$ est-elle continue ?
    \\item $f$ est-elle dérivable en $0$ ?
  \\end{enumerate}
\\end{exercice}

\\end{document}
`
      }
    ]
  },
  {
    id: 'cv',
    name: 'CV',
    description: 'Curriculum vitæ sobre et élégant',
    accent: '#c2255c',
    files: (_title, author) => [
      {
        path: 'main.tex',
        content: `\\documentclass[10pt]{article}
\\usepackage[french]{babel}
\\usepackage[a4paper, margin=1.8cm]{geometry}
\\usepackage{xcolor}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage[hidelinks]{hyperref}

\\definecolor{accent}{HTML}{C2255C}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\titleformat{\\section}{\\large\\bfseries\\color{accent}}{}{0pt}{}[\\titlerule]
\\titlespacing*{\\section}{0pt}{12pt}{6pt}
\\setlist[itemize]{leftmargin=*, nosep}

\\newcommand{\\entree}[4]{%
  \\textbf{#1} \\hfill #2 \\\\
  \\textit{#3} \\\\[2pt]
  #4 \\par\\medskip}

\\begin{document}

{\\Huge\\bfseries ${author || 'Prénom Nom'}} \\\\[4pt]
{\\large Poste recherché} \\\\[6pt]
\\href{mailto:email@exemple.fr}{email@exemple.fr} \\quad·\\quad 06 00 00 00 00 \\quad·\\quad Paris

\\section{Expérience}
\\entree{Ingénieur logiciel}{2022 -- aujourd’hui}{Entreprise, Ville}{%
  \\begin{itemize}
    \\item Réalisation marquante n°1
    \\item Réalisation marquante n°2
  \\end{itemize}}
\\entree{Stagiaire}{2021}{Entreprise, Ville}{Description du stage.}

\\section{Formation}
\\entree{Master Informatique}{2020 -- 2022}{Université, Ville}{Mention bien.}

\\section{Compétences}
\\begin{itemize}
  \\item \\textbf{Langages :} Python, TypeScript, C++
  \\item \\textbf{Outils :} Git, Docker, \\LaTeX
  \\item \\textbf{Langues :} Français (natif), Anglais (C1)
\\end{itemize}

\\end{document}
`
      }
    ]
  },
  {
    id: 'letter',
    name: 'Lettre',
    description: 'Lettre formelle à la française',
    accent: '#5c940d',
    files: (_title, author) => [
      {
        path: 'main.tex',
        content: `\\documentclass[11pt]{article}
\\usepackage[french]{babel}
\\usepackage[a4paper, margin=2.5cm]{geometry}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0.8em}

\\begin{document}

\\begin{minipage}[t]{0.5\\textwidth}
  \\textbf{${author || 'Prénom Nom'}} \\\\
  1 rue de l’Exemple \\\\
  75000 Paris
\\end{minipage}
\\hfill
\\begin{minipage}[t]{0.4\\textwidth}
  \\vspace{3cm}
  Destinataire \\\\
  Adresse \\\\
  Code postal Ville
\\end{minipage}

\\vspace{1cm}
\\hfill Paris, le \\today

\\textbf{Objet :} objet de la lettre

Madame, Monsieur,

Corps de la lettre.

Je vous prie d’agréer, Madame, Monsieur, l’expression de mes salutations distinguées.

\\vspace{1cm}
\\hfill ${author || 'Prénom Nom'}

\\end{document}
`
      }
    ]
  }
]
