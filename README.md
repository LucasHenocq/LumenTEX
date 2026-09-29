# Lumen TeX

Éditeur LaTeX de bureau pour Windows et macOS, avec aperçu PDF en direct. Electron, React, CodeMirror 6, pdf.js et le moteur [Tectonic](https://tectonic-typesetting.github.io/).

## Fonctionnalités

- **Compilation live** : recompilation automatique pendant la saisie, avec enregistrement automatique. Le PDF se recharge sans scintillement et garde la position de lecture.
- **PDF malgré les erreurs** (comme Overleaf) : les erreurs sont analysées, soulignées dans l'éditeur, cliquables et accompagnées d'explications en français.
- **SyncTeX** : `⌘`+clic ou `⌥⌘J` pour aller du source vers le PDF, double-clic dans le PDF pour revenir au source.
- **Autocomplétion** : commandes (avec champs à remplir), environnements (`\begin` → `\end` automatique), `\ref` depuis tous les `\label` du projet, `\cite` depuis les fichiers `.bib`, chemins de fichiers, paquets, classes, commandes définies par l'utilisateur.
- **Aperçu des formules au survol** (KaTeX, y compris les macros `\newcommand` du projet).
- **Plan du document** (suit les `\input` et `\include`), liste des étiquettes, **palette de symboles**, **recherche dans le projet**.
- **Assistants** : tableaux (booktabs, grille), matrices, figures (glisser-déposer d'images), équations.
- **Modèles** : article, rapport ou mémoire multi-fichiers, Beamer, devoir de maths, CV, lettre.
- **Éditeur** : repliage des environnements et sections, curseurs multiples, rechercher/remplacer, correcteur orthographique natif, mode Vim, thèmes clair et sombre, mode sombre du PDF.
- **Export PDF**, ouverture dans Aperçu, palette de commandes (`⇧⌘P`), ouverture rapide (`⌘P`).
- **Tectonic** : installé en un clic si absent. Les paquets LaTeX sont téléchargés à la demande.

## Développement

```bash
npm install
npm run dev        # lancement avec rechargement à chaud
npm run typecheck
npm run pack       # macOS : génère dist/mac-arm64/Lumen TeX.app
npm run dist       # macOS : génère un .dmg et un .zip
npm run pack:win   # Windows : génère dist/win-unpacked/Lumen TeX.exe (sans installation)
npm run dist:win   # Windows : génère l'installeur release/Lumen-TeX-Setup-<version>.exe
npm run release:win # Windows : génère l'installeur et le publie dans une release GitHub (GH_TOKEN requis)
```

## Télécharger

Dernière version pour Windows : **[Releases](https://github.com/LucasHenocq/LumenTEX/releases/latest)** → `Lumen-TeX-Setup-<version>.exe`.
