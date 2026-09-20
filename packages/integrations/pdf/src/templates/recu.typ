#import "common.typ": entete, euro, page_base, pied

#let data = json(sys.inputs.at("data", default: "data.json"))

#set page(..page_base)
#set text(size: 11pt, lang: "fr")

#entete(data)

#align(center)[
  #text(size: 16pt, weight: "bold")[REÇU DE PAIEMENT PARTIEL]\
  #text(size: 11pt)[Période du #data.periode.debut au #data.periode.fin]
]

#v(18pt)

Logement loué : #data.lot.designation, #data.lot.adresse.

#v(12pt)

#table(
  columns: (1fr, auto),
  align: (left, right),
  stroke: 0.5pt + luma(180),
  [*Désignation*], [*Montant*],
  [Somme due pour la période], euro(data.total),
  [Somme reçue le #data.datePaiement (#data.modePaiement)], euro(data.montantRecu),
  [*Reste dû*], [*#euro(data.resteDu)*],
)

#v(12pt)

Ce document est un reçu de paiement partiel : il ne vaut pas quittance. Une quittance
sera établie lorsque le solde de la période aura été intégralement réglé.

#pied(data)
