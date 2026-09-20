#import "common.typ": entete, euro, page_base, pied

#let data = json(sys.inputs.at("data", default: "data.json"))

#set page(..page_base)
#set text(size: 11pt, lang: "fr")

#entete(data)

#align(center)[
  #text(size: 16pt, weight: "bold")[DÉCOMPTE INDIVIDUEL DE CHARGES]\
  #text(size: 11pt)[Exercice #data.exercice — période du #data.periode.debut au #data.periode.fin]
]

#v(18pt)

Logement loué : #data.lot.designation, #data.lot.adresse.

Occupation retenue : du #data.occupation.debut au #data.occupation.fin, soit
#data.occupation.jours jours sur #data.occupation.joursPeriode jours de période.

#v(12pt)

#table(
  columns: (2fr, auto, auto, auto),
  align: (left, right, right, right),
  stroke: 0.5pt + luma(180),
  [*Poste de charge*], [*Dépense récupérable*], [*Clé de répartition*], [*Quote-part*],
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
  [Provisions appelées sur la période], euro(data.provisionsAppelees),
  [Provisions effectivement réglées], euro(data.provisionsPayees),
  [*#data.libelleSolde*], [*#euro(data.solde)*],
)

#v(12pt)

Le solde ci-dessus compare les charges récupérables réelles aux provisions
*appelées*, indépendamment de leur règlement.

#if data.provisionsImpayees != "0.00" [
  Provisions appelées et non réglées à ce jour : *#euro(data.provisionsImpayees)*. Cette
  somme reste due au titre des appels déjà émis ; elle n'est pas refacturée par le
  présent décompte et figure séparément à votre compte.
]

#v(12pt)

Les pièces justificatives des dépenses sont tenues à votre disposition pendant six mois
à compter de l'envoi de ce décompte.

#pied(data)
