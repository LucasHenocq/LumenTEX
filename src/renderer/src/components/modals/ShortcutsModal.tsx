import { ModalFrame } from '../Modals'
import { kb } from '../../lib/keys'

const GROUPS: [string, [string, string][]][] = [
  [
    'Général',
    [
      ['⌘↵', 'Compiler'],
      ['⌘S', 'Enregistrer'],
      ['⌘E', 'Exporter en PDF'],
      ['⌘P', 'Ouverture rapide'],
      ['⇧⌘P', 'Palette de commandes'],
      ['⌘J', 'Journal et erreurs'],
      ['F8', 'Erreur suivante'],
      ['⌘,', 'Réglages']
    ]
  ],
  [
    'Édition',
    [
      ['⌘B / ⌘I', 'Gras / italique'],
      ['⌘U', 'Souligné'],
      ['⇧⌘E', '\\emph'],
      ['⌘M', 'Formule en ligne $…$'],
      ['⌘/', 'Commenter la ligne'],
      ['⌘D', 'Sélectionner l’occurrence suivante'],
      ['⌥ + clic', 'Curseurs multiples'],
      ['⌃Espace', 'Suggestions'],
      ['⇥', 'Champ suivant d’un modèle'],
      ['⌘F', 'Rechercher / remplacer'],
      ['⌥⌘G', 'Aller à la ligne']
    ]
  ],
  [
    'Aperçu PDF',
    [
      ['⌘ + clic', 'Montrer la ligne dans le PDF'],
      ['⌥⌘J', 'Montrer le curseur dans le PDF'],
      ['Double-clic', 'Aller à la source depuis le PDF'],
      ['⌘ + molette', 'Zoom'],
      ['⌘0', 'Pleine largeur']
    ]
  ],
  [
    'Insertion',
    [
      ['⌥⌘T', 'Tableau'],
      ['⌥⌘M', 'Matrice'],
      ['⌥⌘F', 'Figure'],
      ['⌥⌘E', 'Équation'],
      ['⌥⌘Y', 'Symboles'],
      ['⌥⌘L', 'Image ou PDF → LaTeX']
    ]
  ]
]

export default function ShortcutsModal(): React.JSX.Element {
  return (
    <ModalFrame title="Raccourcis clavier" width={720}>
      <div className="shortcuts">
        {GROUPS.map(([name, list]) => (
          <section key={name}>
            <div className="section-label">{name}</div>
            {list.map(([k, l]) => (
              <div key={l} className="shortcut-row">
                <span>{l}</span>
                <kbd>{kb(k)}</kbd>
              </div>
            ))}
          </section>
        ))}
      </div>
    </ModalFrame>
  )
}
