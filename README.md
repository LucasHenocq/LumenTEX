# Lumen TeX

**Un éditeur LaTeX moderne, gratuit et autonome, avec l'aperçu PDF en direct.**

Écrivez à gauche, le PDF se met à jour à droite pendant que vous tapez. Pas de compte, pas d'abonnement, pas de serveur : tout fonctionne sur votre ordinateur, pour Windows, macOS et Linux.

## Télécharger

Dernière version : **[page des téléchargements](https://github.com/LucasHenocq/LumenTEX/releases/latest)**.

| Système | Fichier |
| --- | --- |
| Windows | `Lumen-TeX-Setup-<version>.exe` |
| macOS, Mac Apple (M1 et suivants) | `Lumen-TeX-<version>-arm64.dmg` |
| macOS, Mac Intel | `Lumen-TeX-<version>-x64.dmg` |
| Linux (Ubuntu, Debian) | `Lumen-TeX-<version>-amd64.deb` |
| Linux (toutes distributions) | `Lumen-TeX-<version>-x86_64.AppImage` |

- **macOS** : glissez Lumen TeX dans Applications. Au premier lancement, ouvrez Réglages Système → Confidentialité et sécurité, puis « Ouvrir quand même » (l'application n'est pas signée par Apple).
- **Linux, AppImage** : rendez le fichier exécutable avant de l'ouvrir.

Au premier lancement, Lumen TeX installe en un clic de quoi compiler ([Tectonic](https://tectonic-typesetting.github.io/)) : pas besoin d'installer LaTeX à part. Les paquets LaTeX se téléchargent ensuite d'eux-mêmes, quand un document en a besoin. Les mises à jour de Lumen TeX sont signalées dans l'application, et Réglages → « Rechercher une mise à jour » vérifie à la demande.

## Écrire

- **Autocomplétion** : commandes avec champs à remplir, `\begin{…}` fermé tout seul, `\ref` à partir de toutes les étiquettes du projet, `\cite` à partir des fichiers `.bib`, noms de fichiers, paquets, et vos propres commandes.
- **Aperçu des formules** au survol, avec les macros de votre projet.
- **Plan du document** (y compris les fichiers inclus), liste des étiquettes, recherche dans tout le projet.
- **Panneau de symboles**, assistants pour les tableaux, matrices, figures (glissez une image dans le texte) et équations.
- **Modèles** pour démarrer : article, rapport ou mémoire en plusieurs fichiers, présentation Beamer, devoir de maths, CV, lettre.
- **Conversion** d'une image ou d'un PDF en LaTeX (avec un assistant IA).
- **Historique des versions** : Lumen TeX garde des versions de votre projet au fil du travail. Enregistrez-en une avec un nom (« Version envoyée au directeur »), comparez un fichier avec une version précédente, et restaurez-le si besoin.
- Correcteur orthographique, repliage des sections, curseurs multiples, mode Vim, thème clair ou sombre.

## Compiler et lire le PDF

- **Compilation en direct** pendant la saisie, avec enregistrement automatique. Le PDF se recharge sans clignoter et garde votre position de lecture.
- **Un PDF même avec des erreurs** : elles sont soulignées dans le texte, expliquées en français, et un clic y mène.
- **Aller du texte au PDF et retour** : Ctrl+clic (⌘+clic sur Mac) dans le texte, double-clic dans le PDF.
- Mode sombre pour le PDF, export, ouverture dans votre lecteur habituel.

## Travailler à plusieurs

Partagez un projet avec un code : chacun voit le texte et le curseur des autres, et compile le PDF chez lui. Les ordinateurs se connectent directement entre eux, sans serveur ni compte ; ce qui est modifié hors ligne se fusionne au retour.

- Le chef de session choisit qui peut modifier, qui ne fait que lire, et quels fichiers restent privés.
- Une discussion intégrée, avec un lien vers l'endroit du texte dont on parle.
- Ceux qui rejoignent n'ont pas de copie du projet à gérer : elle est effacée à la fin de la session, sauf si le chef permet de la garder.

## Assistant IA

Un assistant dans la barre latérale explique les erreurs, corrige, rédige ou complète votre document. Il fonctionne avec le service de votre choix : **Claude Code**, **GitHub Copilot**, **Gemini**, ou **Ollama**, qui tourne entièrement sur votre ordinateur. Vous utilisez votre propre compte ; Lumen TeX ne passe par aucun service à lui.

## Vérifier ses démonstrations avec Lean

Une coche dans la marge, à côté d'un théorème suivi de sa preuve, la fait vérifier par l'assistant de preuve [Lean](https://lean-lang.org/) :

- l'IA traduit votre preuve en Lean, étape par étape, et Lean vérifie chacune ;
- si une étape est fausse ou ne découle pas des précédentes, Lumen TeX vous montre laquelle, souvent avec un contre-exemple ;
- vous validez vous-même que l'énoncé et les étapes traduits sont bien les vôtres ;
- dans le PDF, « LEAN » s'affiche à côté du carré de fin des preuves vérifiées (désactivable).

Lean et sa bibliothèque mathématique (Mathlib, environ 10 Go) s'installent à la demande, en un clic.

## Extensions

Réglages → Extensions, ou l'icône de pièce de puzzle dans la barre de gauche, donnent accès au [catalogue officiel](https://github.com/LucasHenocq/LumenTEX-extensions) :

- **Typst** : écrivez en Typst, avec coloration, autocomplétion, compilation et symboles ;
- **LaTeX classique** : compilez avec pdfLaTeX, XeLaTeX, LuaLaTeX ou Latexmk, si TeX Live ou MiKTeX est installé, bibliographie biber ou BibTeX comprise ;
- **LanguageTool** : fautes d'orthographe, de grammaire et de style soulignées, sans toucher aux commandes ni aux formules ;
- **TikZ et pgfplots** : figures, repères, courbes et graphes de fonctions tout prêts ;
- **Thèmes Nord et Solarized**, en clair et en sombre.

Les extensions du catalogue sont relues avant d'y entrer. Vous pouvez aussi écrire la vôtre : le [mode d'emploi](https://github.com/LucasHenocq/LumenTEX-extensions) explique comment.

## Gratuit et autonome

Lumen TeX ne dépend d'aucun serveur qui lui appartienne : pas de compte, pas d'abonnement, et vos documents restent sur votre ordinateur. Le code est publié sous licence MIT.
