#import "common.typ": entete, euro, page_base, pied

#let data = json(sys.inputs.at("data", default: "data.json"))

#set page(..page_base)
#set text(size: 11pt, lang: "fr")

#entete(data)

#align(center)[
  #text(size: 16pt, weight: "bold")[RÉVISION ANNUELLE DU LOYER]\
  #text(size: 11pt)[Notification au locataire]
]

#v(18pt)

Logement loué : #data.lot.designation, #data.lot.adresse.

#v(12pt)

Conformément à la clause de révision du bail (#data.clause), le loyer est révisé
selon l'indice #data.indice du #data.trimestreReference, publié par #data.source.

#v(12pt)

#table(
  columns: (1fr, auto),
  align: (left, right),
  stroke: 0.5pt + luma(180),
  [*Élément*], [*Valeur*],
  [Indice du trimestre de référence (ancien)], [#data.ancienIndice],
  [Indice du même trimestre (nouveau)], [#data.nouvelIndice],
  [Loyer hors charges actuel], euro(data.loyerActuel),
  [Loyer révisé calculé], [#data.loyerReviseNonArrondi],
  [*Loyer hors charges révisé*], [*#euro(data.loyerRevise)*],
  [Variation], euro(data.variation),
  [Provisions sur charges inchangées], euro(data.chargesProvision),
)

#v(12pt)

Le loyer révisé s'applique à compter du #data.dateEffet. La révision prend effet
pour l'avenir : elle n'est pas rétroactive et ne donne lieu à aucun rappel sur les
termes déjà appelés.

#pied(data)
