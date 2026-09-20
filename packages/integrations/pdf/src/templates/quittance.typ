#import "common.typ": entete, euro, page_base, pied

#let data = json(sys.inputs.at("data", default: "data.json"))

#set page(..page_base)
#set text(size: 11pt, lang: "fr")

#entete(data)

#align(center)[
  #text(size: 16pt, weight: "bold")[QUITTANCE DE LOYER]\
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
  [Loyer hors charges], euro(data.loyer),
  [Provisions sur charges], euro(data.provisions),
  [*Total réglé*], [*#euro(data.total)*],
)

#v(12pt)

Je soussigné·e #data.signataire, agissant pour le compte de #data.sci.nom, déclare
avoir reçu de #data.locataire.nom la somme de #euro(data.total) au titre du loyer et
des charges de la période indiquée, et lui en donne quittance, sous réserve de tous
mes droits.

#v(6pt)

*Cette quittance annule tous les reçus qui auraient pu être établis en cas de paiement partiel
pour la même période.* Paiement reçu le #data.datePaiement : *acquitté*.

#pied(data)
