#import "common.typ": entete, euro, page_base, pied

#let data = json(sys.inputs.at("data", default: "data.json"))

#set page(..page_base)
#set text(size: 11pt, lang: "fr")

#entete(data)

#align(center)[
  #text(size: 16pt, weight: "bold")[DÉCOMPTE DE CHARGES]\
  #text(size: 11pt)[Exercice #data.exercice — période du #data.periode.debut au #data.periode.fin]
]

#v(18pt)

Logement loué : #data.lot.designation, #data.lot.adresse.

#v(12pt)

#table(
  columns: (2fr, auto, auto, auto),
  align: (left, right, right, right),
  stroke: 0.5pt + luma(180),
  [*Poste de charge*], [*Dépense immeuble*], [*Clé*], [*Quote-part*],
  ..data.lignes.map(ligne => (
    [#ligne.libelle],
    euro(ligne.montantTotal),
    [#ligne.cle],
    euro(ligne.quotePart),
  )).flatten(),
  [*Total des charges récupérables*], [], [], [*#euro(data.totalCharges)*],
)

#v(12pt)

#table(
  columns: (1fr, auto),
  align: (left, right),
  stroke: none,
  [Provisions versées sur la période], euro(data.provisionsVersees),
  [*#data.libelleSolde*], [*#euro(data.solde)*],
)

#v(12pt)

Les pièces justificatives des dépenses sont tenues à votre disposition pendant six mois
à compter de l'envoi de ce décompte.

#pied(data)
