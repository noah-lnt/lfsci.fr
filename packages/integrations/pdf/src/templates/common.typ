#let euro(amount) = [#amount €]

#let entete(data) = [
  #grid(
    columns: (1fr, 1fr),
    gutter: 12pt,
    [
      *#data.sci.nom*
      #if "adresse" in data.sci [\ #data.sci.adresse]
      #if "siret" in data.sci [\ SIRET #data.sci.siret]
    ],
    align(right)[
      *#data.locataire.nom*
      #if "adresse" in data.locataire [\ #data.locataire.adresse]
    ],
  )
  #v(18pt)
]

#let pied(data) = [
  #v(24pt)
  Fait à #data.lieu, le #data.dateEdition.
  #v(36pt)
  #align(right)[
    #data.signataire\
    _Signature_
  ]
]

#let page_base = (paper: "a4", margin: 2cm)
