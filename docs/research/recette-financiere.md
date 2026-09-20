# Recette financière — jeux d’essai synthétiques

Les chiffres suivants sont fictifs. Les qualifications fiscales, comptes, dates, règles de récupération et durées d’amortissement sont des **paramètres du jeu d’essai**, à faire approuver avant utilisation réelle. Ils ne constituent pas des règles fiscales universelles. Montants en euros, calcul décimal exact, hypothèse sans TVA récupérable. Les soldes officiels sont vérifiés dans Odoo Online puis dans leur projection SaaS.

## F01 — Crédit : capital, intérêts et assurance

**Données.** Dette avant échéance : 100 000. Prélèvement : 1 000, dont capital 700, intérêts 250 et assurance 50 ; les deux charges appartiennent à la période.

**Attendu.** Dette après : 99 300 ; trésorerie : −1 000 ; charges : 300 ; résultat : −300. Les trois composantes totalisent exactement le prélèvement. Une seconde importation du même échéancier ou de la même transaction bancaire ne change aucun solde. Le capital ne figure jamais dans les charges ni dans la rentabilité opérationnelle.

## F02 — Achat payé personnellement et compte courant d’associé

**Données.** Ticket de matériel de 120, classé en charge pour ce test, payé par l’associé. Remboursement par la SCI : 80. Intervention personnelle : 4 heures ; tarif économique hypothétique : 50/h.

**Attendu.** Charge comptable : 120 ; dette initiale envers l’associé : 120, puis solde créditeur dû à l’associé : 40 ; trésorerie SCI : −80. Le remboursement ne recrée pas une charge de 80. Les 200 de temps personnel sont visibles seulement dans une simulation économique identifiée ; résultat comptable inchangé par ces heures. Si l’indicateur économique inclut ce temps, coût économique total de l’intervention : 320, dont coût comptable 120 et temps valorisé 200.

## F03 — Loyer partiel, paiement complet et trop-perçu

**Données.** Appel mensuel : loyer 800 + provision sur charges 100 = 900. Encaissements successifs : 400 puis 500, puis versement accidentel de 100 remboursé.

**Attendu.** Après 400 : restant dû 500 et reçu de paiement partiel, aucune quittance de règlement intégral. Après 500 : restant dû 0 et une seule quittance de 900. Le versement supplémentaire crée un trop-perçu de 100, pas un nouveau loyer. Son remboursement solde le trop-perçu ; encaissement net final 900, restant dû 0, quittance de 900 conservée. Une annulation bancaire ultérieure doit rouvrir le solde correspondant et signaler le document déjà émis pour traitement contrôlé.

## F04 — Airbnb : recettes brutes, taxes, remboursement et virement groupé

**Données.** Réservation A : hébergement 1 000 + ménage facturé 100 ; taxe de séjour collectée pour compte de tiers 30 ; commission justifiée 33 ; remboursement de prestations 110 ; taxe reversée/retenue par la plateforme 30. Réservation B : hébergement 600 + ménage 60 ; taxe 18 ; commission 19,80 ; taxe reversée 18. Un seul virement plateforme règle A et B. Les commissions fournies sont celles du jeu d’essai, sans présumer un taux Airbnb réel.

**Attendu.** Prestations brutes : 1 760 ; remboursements : 110 ; recettes nettes de remboursements : 1 650 ; commissions : 52,80 ; flux de taxes : +48 −48 = 0 ; virement bancaire : **1 597,20**, ventilé A = 957 et B = 640,20. Une seule ligne bancaire peut solder plusieurs réservations. Le virement net n’est pas comptabilisé comme chiffre d’affaires de 1 597,20 en plus des prestations. Les taxes pour compte de tiers ne deviennent pas un revenu de la SCI dans ce scénario.

## F05 — Charges communes, occupation et vacance

**Données.** Charge de 1 200 entièrement qualifiée récupérable pour le test. Clés contractuelles fixes : A 50 %, B 30 %, C 20 %. A occupé toute la période ; B occupé exactement la moitié des jours ; C vacant. A a versé 500 de provisions, B 200.

**Attendu.** Coûts affectés aux lots : A 600, B 360, C 240. Charges locataires : A 600, B 180, C 0. Reste propriétaire : 420. Régularisation : A doit 100, B reçoit un crédit/remboursement de 20 ; net à recevoir : 80. Les 420 ne sont pas redistribués automatiquement aux seuls locataires présents. À chaque niveau, récupérable facturé + part propriétaire = coût de 1 200. La règle de prorata est versionnée et justifiée.

## F06 — Répartition et arrondi au centime

**Données.** Dépense de 100 répartie à parts égales entre trois lots, avec méthode du plus fort reste et ordre stable des identifiants en cas d’égalité.

**Attendu.** 33,34 + 33,33 + 33,33 = 100,00. Le même lot reçoit le centime résiduel à chaque rejeu du même calcul. Les pourcentages affichés arrondis ne deviennent pas la source du calcul. Les agrégats immeuble et SCI reprennent les montants affectés une seule fois, sans total de 99,99 ni 100,01.

## F07 — Immobilisation, amortissement, VNC et valeur de marché

**Données.** Acquisition de 100 000 : terrain 20 000 et bâtiment 80 000. Financement : dette bancaire 60 000 et fonds propres 40 000. Dans ce jeu, seul le bâtiment s’amortit, pour 2 000 sur la période. Aucun autre mouvement. Estimation de marché à la date de clôture : 120 000.

**Attendu.** Emplois d’acquisition = ressources = 100 000. VNC : terrain 20 000 + bâtiment 78 000 = 98 000 ; amortissement 2 000 ; dette 60 000 ; capitaux propres comptables 38 000. La dotation diminue le résultat de 2 000 mais ne décaisse rien à sa date. Valeur nette économique simplifiée : 120 000 −60 000 = 60 000 **avant frais de cession et fiscalité latente**, explicitement distincte de 38 000. Une modification de l’estimation de marché ne modifie pas automatiquement les écritures ni la VNC.

## F08 — Passage résultat → trésorerie

**Données.** Produits acquis 12 000, dont 10 800 encaissés ; charges d’exploitation 4 000, dont 3 500 payés ; intérêts 1 000 entièrement payés ; amortissements 2 000 ; nouvel investissement immobilisé payé 5 000 ; remboursement de capital 3 000 ; nouvel emprunt encaissé 4 000 ; nouvel apport en compte courant 1 000. Banque initiale : 2 000 ; aucune autre opération ni variation initiale de créances/dettes.

**Attendu.** Résultat = 12 000 −4 000 −1 000 −2 000 = **5 000**. Flux bancaire net = 10 800 −3 500 −1 000 −5 000 −3 000 +4 000 +1 000 = **3 300** ; banque finale : **5 300**. Pont explicatif : résultat 5 000 + amortissements 2 000 − créances clients 1 200 + dettes fournisseurs 500 − investissement 5 000 − capital remboursé 3 000 + nouvel emprunt 4 000 + CCA 1 000 = 3 300. Les apports et emprunts ne deviennent pas des revenus locatifs.

## F09 — Virement entre banques et frais

**Données.** Banque A : 5 000 ; banque B : 1 000. Transfert de 1 000 de A vers B et frais bancaires séparés de 2 prélevés sur A. Pendant une journée, la sortie A est connue avant l’arrivée B.

**Attendu.** Après dénouement : A 3 998, B 2 000, trésorerie SCI 5 998 ; variation consolidée −2 et charge 2. Le transfert de 1 000 ne génère ni produit ni charge. Pendant le transit, afficher un rapprochement en cours avec contrepartie attendue ; ne pas inventer un revenu ou une anomalie définitive. Vérifier dates, compte de transit et absence de doublon avant de comparer les soldes consolidés.

## F10 — Dépôt de garantie et compensation autorisée

**Données.** Dépôt reçu : 900. À la sortie, une créance locataire distincte de 150 a déjà été établie et comptabilisée sur justificatif, avec retenue autorisée selon la règle validée du scénario. Restitution : 750.

**Attendu.** À réception : banque +900 et dette de dépôt +900, aucun revenu locatif. Au règlement de sortie : banque −750 ; dette de dépôt −900 ; créance locataire −150. L’application de la retenue ne crée pas une seconde recette de 150 puisque la créance était déjà comptabilisée. Dépôt restant 0 et créance restante 0. Sans justificatif/validation, le système propose une exception et ne compense pas automatiquement.

## Contrôles transversaux obligatoires

- Exécuter chaque scénario par le SaaS, contrôler Odoo, puis contrôler le retour SaaS et les agrégats lot/immeuble/SCI. Une interface correcte seule n’est pas une preuve comptable.
- Rejouer les mêmes imports et commandes : variation additionnelle attendue **0,00**. Forcer un résultat réseau inconnu : aucune création répétée tant que la première exécution n’est pas résolue.
- Vérifier total débit = total crédit, ventilation au centime, devise, société, période et référence source. Un total nul issu d’une lecture échouée est une erreur, jamais une validation.
- Tester la correction d’un brouillon et une correction autorisée après validation, en conservant la piste d’audit ; refus sur période fermée et absence de décalage automatique silencieux de date comptable.
- Les fixtures ne valident pas la fiscalité du propriétaire : comptes, règles de charges, nature des compensations et amortissements sont approuvés séparément. La liasse IS et sa télétransmission restent distinctes de la tenue comptable et du FEC.
