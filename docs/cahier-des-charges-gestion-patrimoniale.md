# Cahier des charges de gestion patrimoniale et locative avec Odoo Online

**Spécification produit et technique — version 1.2 — 19 septembre 2026**

**Destinataire :** propriétaire-gérant, équipe produit et développement, expert-comptable et prestataires d’intégration.

**Statut :** spécification de référence pour le cadrage et la réalisation. Les objectifs de performance, règles proposées et capacités à démontrer sont explicitement distingués des faits vérifiés. Aucune validation sur l’instance Odoo du propriétaire n’a encore été effectuée.

**Dossier technique associé :** `docs/tech-pack.md` (v1) fixe les choix concrets que ce document laisse ouverts — pile logicielle, architecture, connecteur Odoo, fournisseurs d’IA et d’intégration, système d’interface, exploitation — et `docs/schema/lfsci.sql` porte le modèle physique de données dérivé du §14. En cas de divergence, le présent document prime sur le fond métier, le dossier technique sur la réalisation.

**Historique :** 1.0 — rédaction initiale ; 1.1 — ajout de l’assistant conversationnel (UX-06), des règles d’affectation proposées (IA-06), des variantes de bail (BAI-01) et des identifiants de compteurs (COM-01) ; 1.2 — référence au dossier technique et au modèle physique de données.

<!-- toc -->

## 1 Finalité et principes directeurs

Le produit est une surcouche SaaS de gestion patrimoniale et locative dont **le SaaS devient l’interface quotidienne principale et Odoo Online demeure le moteur comptable officiel**. Il doit permettre au propriétaire de gérer seul un patrimoine croissant, composé d’immeubles, de locations nues, de locations meublées et de locations touristiques commercialisées notamment sur Airbnb. L’organisation du travail part des exceptions et des décisions à prendre, plutôt que d’une succession de saisies administratives.

Le fonctionnement attendu est : collecter l’information, conserver sa source, identifier le contexte, appliquer les règles déterministes autorisées, vérifier le résultat, puis présenter uniquement les ambiguïtés, écarts et validations nécessaires. Une absence d’alerte ne signifie « tout est cohérent » que si tous les contrôles prévus ont effectivement pu s’exécuter sur des données suffisamment récentes.

La première entité est une SCI à l’IS. L’expression « non assujettie à la TVA » constitue l’hypothèse fournie par le propriétaire ; elle ne vaut pas qualification fiscale définitive. Le produit doit distinguer absence d’assujettissement, exonération, franchise et TVA non récupérable. La DGFiP précise qu’une SCI peut devoir recevoir des factures électroniques malgré l’exonération de ses opérations, selon sa qualification réelle. Cette qualification doit être validée avant paramétrage des automatismes. [DGFiP, fiche SCI](https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/fiches_reforme/fiche-sci.pdf)

### 1.1 Résultats attendus

Le propriétaire doit pouvoir répondre depuis le SaaS à cinq questions : « Que dois-je faire aujourd’hui ? », « Que s’est-il passé sur ce bien ? », « Quelles échéances arrivent ? », « Où va l’argent ? » et « Puis-je acquérir un nouveau bien sans déséquilibrer la SCI ? ». Chaque réponse financière doit distinguer données comptables officielles, données opérationnelles et simulations.

Les principes non négociables sont les suivants : une information canonique et plusieurs vues ; une seule autorité par champ ; aucune double génération de loyer ; aucune double importation bancaire ; aucune action sensible autorisée par la seule confiance d’un LLM ; aucune écriture comptable officielle réécrite silencieusement ; aucune disparition d’un original sous l’effet d’une extraction IA ; aucune confusion entre traitement réussi, traitement en attente et traitement impossible.

### 1.2 Indicateurs de réussite proposés

Ces cibles seront confirmées après mesure du fonctionnement initial. Elles ne constituent pas des résultats déjà obtenus.

| Indicateur | Définition et cible proposée | Conditions de mesure |
|---|---|---|
| Temps de gestion courant | Réduction d’au moins 50 % par lot actif à périmètre comparable après stabilisation | Comparaison sur huit semaines ; exclure acquisitions et gros travaux, mesurés séparément |
| Capture mobile | Médiane inférieure à 20 secondes pour enregistrer un ticket ou une note contextualisée | Inclure ouverture, capture et confirmation locale ; distinguer traitement serveur |
| Traitement sans intervention | Au moins 80 % des opérations explicitement éligibles traitées sans correction humaine | Dénominateur publié ; ne pas inclure les décisions légalement ou comptablement soumises à validation |
| Qualité financière | Aucun doublon d’effet comptable dans les scénarios de recette ; aucun écart inexpliqué à la mise en service | Contrôles exhaustifs des montants migrés et des flux critiques |
| Pertinence des alertes | Moins de 15 % d’alertes classées sans objet après analyse | Échantillon représentatif d’au moins 200 alertes ou totalité si volume inférieur |
| Passage à l’échelle | Le temps humain mensuel par lot diminue lorsque le portefeuille croît | Suivi du volume, de la complexité des locations et des exceptions, pas seulement du nombre de lots |

### 1.3 Périmètre et exclusions

Le périmètre couvre patrimoine, exploitation locative, locations touristiques, finance, travaux réalisés par le propriétaire, documents, communications, échéances, assistance IA, synchronisation et contrôle comptable. Les prestations occasionnelles d’un artisan restent enregistrables sans imposer un logiciel de gestion d’équipes.

Sont exclus du socle : paie, gestion d’agence pour compte de tiers, gestion complète de syndic, tenue d’une deuxième comptabilité officielle, dépôt automatique de déclarations fiscales, conseil fiscal autonome, décision automatisée d’acceptation d’un locataire, lancement autonome de paiements bancaires et accès non autorisé aux plateformes. Le FEC, la balance et le dossier de clôture ne sont pas assimilés à la production ou à la télétransmission de la liasse fiscale IS.

## 2 Cadre de réalisation et décisions structurantes

L’hébergement Odoo est **Odoo Online**, conformément au choix du propriétaire. La version exacte, le plan contractuel, les modules activés et les droits API restent à relever. Odoo documente JSON-2 à partir de la version 19 et réserve l’accès externe commercial au plan Custom. Les modèles, champs et méthodes disponibles dépendent de la base réelle. Odoo Online ne permet pas de déployer un module serveur Python spécifique classique. L’architecture doit donc fonctionner avec les API standard et, seulement si démontré utile, des champs ou automatisations Studio compatibles. [Odoo, API externe](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html) ; [Odoo Online, documentation officielle](https://raw.githubusercontent.com/odoo/documentation/19.0/content/administration/odoo_online.rst)

Le SaaS doit être multi-organisation dans son modèle de sécurité dès le départ, tout en proposant une interface initiale centrée sur une SCI. Une organisation technique héberge une ou plusieurs entités juridiques autorisées ; elle ne se confond pas avec une SCI, un immeuble ou un locataire. La consolidation de plusieurs SCI reste une évolution distincte et ne permet jamais de mélanger leurs écritures.

Les exigences marquées **MVP** sont nécessaires à une première exploitation réelle contrôlée ; **V2** enrichit les intégrations et l’automatisation ; **V3** industrialise l’autonomie et la croissance. Chaque exigence fonctionnelle doit devenir une ou plusieurs histoires de réalisation avec preuve de recette. « Automatique » signifie toujours « dans une politique autorisée et vérifiable ».

## 3 Utilisateurs, rôles et responsabilités

| Rôle | Autorisations principales | Restrictions |
|---|---|---|
| Propriétaire administrateur | Paramétrage, validation métier, gestion des biens, accès financier et délégation | Ne contourne pas les clôtures Odoo ni les règles de traçabilité |
| Gestionnaire délégué | Traitement opérationnel sur les biens attribués | Aucun accès implicite aux CCA, identités complètes ou autres SCI |
| Expert-comptable | Contrôle, proposition ou validation du paramétrage comptable, dossier de clôture | Accès aux communications privées limité à leur pertinence comptable |
| Associé lecteur | Indicateurs et documents expressément partagés, situation de son CCA | Aucun accès automatique aux dossiers détaillés des locataires |
| Locataire, portail V2 | Ses documents publiés, ses paiements, signalements et messages | Aucun accès au précédent occupant, aux notes internes ou aux autres cotitulaires hors périmètre autorisé |
| Prestataire ponctuel, V2 | Intervention attribuée et pièces nécessaires | Pas de lecture du dossier patrimonial complet |
| Compte technique | Connecteur ou traitement précisément identifié | Droits minimaux, pas de session interactive ni d’accès transversal par défaut |

**SEC-01 — MVP.** L’autorisation doit combiner rôle, organisation, SCI, bien et nature de donnée. Le contrôle s’applique aux API, exports, recherches, documents signés et traitements asynchrones. Recette : un utilisateur autorisé sur un immeuble ne retrouve aucun document d’un autre immeuble par identifiant deviné, recherche ou lien de téléchargement.

Une action peut être préparée par une personne et validée par une autre. Pour une exploitation individuelle, cette séparation n’exige pas artificiellement deux utilisateurs ; elle impose toutefois une confirmation explicite pour les opérations sensibles. Le produit doit pouvoir activer ultérieurement une double validation selon montant ou risque.

## 4 Répartition précise entre SaaS et Odoo

L’intégration est bidirectionnelle parce que le SaaS envoie des commandes métier et reçoit les états comptables ainsi que les corrections effectuées dans Odoo. Cela ne signifie pas que chaque champ est modifiable indistinctement des deux côtés.

| Objet ou champ | Autorité | Rôle de l’autre système et règle de conflit |
|---|---|---|
| SCI, régime fiscal validé, société comptable | Odoo pour société comptable et configuration fiscale ; SaaS pour paramètres patrimoniaux | Correspondance explicite ; changement fiscal soumis à validation et date d’effet |
| Immeuble, lot, caractéristiques, usage, équipements | SaaS | Références et dimensions analytiques vers Odoo ; aucune recréation depuis un libellé libre |
| Personne, coordonnées opérationnelles, liens locatifs | SaaS | Mise à jour contrôlée du tiers Odoo ; les coordonnées de facturation peuvent être gelées sur un document |
| Compte bancaire d’un tiers, identité de paiement | Validation humaine dédiée | Aucun email ni extraction IA ne modifie directement un IBAN autorisé |
| Bail, occupants, clauses, loyer contractuel, échéance | SaaS | Produit une demande comptable selon une règle approuvée ; pas de récurrence concurrente dans Odoo |
| Numéro officiel, journal, compte, taxe, statut d’écriture | Odoo | SaaS présente une copie datée ; correction par circuit Odoo et retour synchronisé |
| Appel de loyer opérationnel | SaaS | Référence une pièce Odoo quand comptabilisé ; les deux ne sont pas deux revenus |
| Encaissement, ligne bancaire, lettrage, rapprochement | Odoo | SaaS propose une affectation ; statut payé seulement après confirmation officielle |
| Quittance, reçu, message locataire | SaaS | Dérivé de données confirmées et versionnées ; correction amont ouvre une exception documentaire |
| Facture fournisseur et traitement comptable validé | Odoo | Capture, justificatif, affectation et proposition dans le SaaS ; numéro officiel conservé |
| Originaux opérationnels et preuve de capture | SaaS | Pièce jointe liée dans Odoo selon nécessité ; conserver également les originaux nés dans Odoo |
| Contrat et échéancier prévisionnel de crédit | SaaS | Comparaison à l’échéancier et aux écritures Odoo ; aucune prévision présentée comme dette comptabilisée |
| Solde officiel du crédit et du CCA | Odoo | Lecture datée ; contrats et décisions associés gérés par le SaaS |
| Actif, valeur brute, amortissements comptabilisés, VNC | Odoo | SaaS gère rattachements physiques, pièces et scénarios futurs séparés |
| Estimation de marché, scénario d’acquisition, projection | SaaS | Aucun mouvement Odoo tant qu’une opération réelle n’a pas été autorisée |
| Activity, Event, Deadline, inbox et règles IA | SaaS | Les changements Odoo génèrent des événements contextualisés |
| Clôture, verrouillage, états légaux, inaltérabilité | Odoo | SaaS respecte les restrictions et signale toute impossibilité d’exécution |

**AUT-01 — MVP.** Le contrat du connecteur doit préciser les champs accessibles en lecture et écriture, l’autorité, les règles de comparaison et les permissions. Un conflit de montant ne se résout jamais par « dernier arrivé gagne ». Une modification Odoo inattendue est conservée comme vérité comptable et soumise à réconciliation avec le contrat locatif.

**AUT-02 — MVP.** Une seule alimentation bancaire arrive dans Odoo, par connexion disponible ou import contrôlé. Le SaaS lit cette alimentation. Les comptes mentionnés dans le contexte initial, Indy et Banque Populaire, font l’objet d’une vérification de couverture réelle. Un import de secours utilise le même registre de déduplication et ne crée pas un deuxième flux.

## 5 Patrimoine, personnes et contrats

### 5.1 Structure patrimoniale

**PAT-01 — MVP, SaaS.** Gérer SCI → immeubles → lots avec identifiants stables, adresses, références cadastrales facultatives, surfaces, pièces, quote-parts, dates d’acquisition, régime d’exploitation, photos, documents et état d’occupation. Distinguer logements, annexes, stationnements, locaux techniques et parties communes. Un lot peut changer d’usage dans le temps sans perdre son historique. Recette : le passage d’un lot meublé longue durée à la location touristique conserve les anciens baux et évite tout chevauchement d’occupation non autorisé.

**PAT-02 — MVP, SaaS.** Conserver diagnostics, classe énergétique, dates de validité, assurances, règlements applicables et anomalies de complétude. Les contraintes dépendent de l’adresse, du régime de location et des dates. En métropole, le calendrier de décence énergétique distingue notamment G, F et E ; le logiciel doit versionner les règles et signaler leur effet au renouvellement ou à la mise en location, sans interrompre seul la facturation. [Ministère, décence et gel des loyers](https://www.ecologie.gouv.fr/politiques-publiques/location-gel-loyers-passoires-energetiques)

**PAT-03 — V2, SaaS.** Gérer division, réunion, cession et changement de périmètre d’un lot avec dates d’effet, correspondances historiques et allocation des actifs à valider. Un rapport historique doit retrouver la structure à la date considérée ; une vente ne supprime aucun dossier.

### 5.2 Locataires, cotitulaires et garants

**LOC-01 — MVP, SaaS.** Une personne dispose d’une identité canonique, de moyens de contact vérifiés séparément et de rôles datés. Un bail possède un ou plusieurs cotitulaires, des occupants éventuels et zéro à plusieurs engagements de garantie. L’engagement du garant précise bénéficiaire, signataire, dates, périmètre, plafond éventuel et document signé ; il ne constitue pas un simple booléen « garant présent ».

**LOC-02 — MVP, SaaS.** Enregistrer les changements de coordonnées, départs de cotitulaires, avenants, solidarité prévue et préférences de communication sans réécrire les documents signés. Aucune reconnaissance d’adresse email ou de numéro de téléphone ne prouve à elle seule l’identité juridique de l’expéditeur.

**LOC-03 — V2, SaaS.** Préparer les candidatures et contrôler la complétude des justificatifs autorisés, sans scoring opaque ni refus automatique. La liste des justificatifs demandés doit respecter les règles applicables ; les documents non nécessaires ne sont pas collectés. [CNIL, justificatifs locatifs](https://www.cnil.fr/fr/location-dun-bien-immobilier-quels-justificatifs)

### 5.3 Baux et vie du contrat

**BAI-01 — MVP, SaaS.** Couvrir bail nu, meublé et contrat touristique ; prévoir les variantes validées juridiquement (bail mobilité, stationnement ou garage loué isolément, local commercial ou professionnel) sans présumer qu’un même modèle convient partout. Le bail porte parties, lot principal et annexes, dates, durée, loyer hors charges, régime de charges, dépôt, modalités de paiement, clause de révision, indice de référence, garanties, pièces et signatures. Le moteur contrôle les pièces manquantes avant activation.

La durée du bail nu dépend de la qualité du bailleur, avec une règle générale différente pour les personnes physiques et morales. Les éventuelles exceptions d’une SCI familiale doivent être qualifiées ; le fait que le gérant soit une personne physique ne suffit pas. [Service Public, bail nu](https://www.service-public.gouv.fr/particuliers/vosdroits/F35109/0_0)

**BAI-02 — MVP, SaaS.** Préparer renouvellement, avenant, préavis, sortie, remise des clés et remise en location. Un email contenant une date de départ déclenche une proposition de traitement ; il ne valide ni la forme du congé ni son délai. Le propriétaire voit la source, la date de réception établie, la règle applicable et les conséquences avant validation.

**BAI-03 — MVP, SaaS.** Chaque version signée devient immuable ; toute modification prend la forme d’un avenant ou d’une nouvelle version explicitement liée. Un bail annulé ou terminé reste consultable selon les droits et la conservation applicable. Recette : un recalcul futur ne modifie pas un terme déjà comptabilisé.

## 6 Entrées, sorties, états des lieux et inventaires

**EDL-01 — MVP, SaaS.** Proposer une visite mobile pièce par pièce : état des surfaces, équipements, défauts, photos originales, annotations, numéros de série, index, clés et observations contradictoires. Chaque photo garde auteur, horodatage de capture et de réception ; les métadonnées éventuellement absentes sont signalées. L’état des lieux final comporte parties, logement, date, constats, annexes et preuve de signature. Les exigences documentaires doivent suivre les règles officielles. [Service Public, état des lieux](https://www.service-public.gouv.fr/particuliers/vosdroits/F31270)

Une demande de complément de l’état des lieux d’entrée est enregistrable dans le délai applicable de dix jours calendaires ; les éléments de chauffage peuvent être complétés pendant le premier mois de la période de chauffe. Le moteur crée les échéances correspondantes et conserve demande, réponse et avenant traçable, sans modifier le document signé original.

**EDL-02 — MVP, SaaS.** Gérer un inventaire meublé distinct de l’état des lieux : catégorie, quantité, état, valeur d’achat si connue, équipement lié, présence à l’entrée et à la sortie. Une pièce manquante ne devient pas automatiquement une retenue financière. Le document signé est exportable avec index des photos et empreintes des pièces.

**EDL-03 — MVP, SaaS.** Comparer entrée et sortie, préparer les écarts, rattacher justificatifs de réparation, vétusté et décision. Calculer la date limite de restitution selon le contexte validé et la remise des clés. Les règles usuelles de dépôt distinguent location nue, meublée et bail mobilité ; la restitution et les retenues sont encadrées. [Service Public, dépôt de garantie](https://www.service-public.gouv.fr/particuliers/vosdroits/F31269)

**EDL-04 — V2, SaaS.** L’IA peut proposer une description et rapprocher deux photos ; elle ne conclut pas seule à la responsabilité, à la vétusté ou à un montant dû. La signature électronique intégrée dépend du prestataire retenu ; au MVP, l’import d’un document signé avec preuve de remise doit rester possible.

Recette commune : réaliser une entrée avec absence de réseau, reprendre la synchronisation sans perdre ni dupliquer de photo, finaliser le document, puis préparer une sortie avec un défaut nouveau et un défaut déjà présent. Seul le défaut nouveau est proposé à examen, sans imputation automatique.

## 7 Loyers, encaissements, quittances et charges

### 7.1 Appels et règlements

**LOY-01 — MVP, SaaS vers Odoo.** Un moteur unique génère les termes depuis le bail : période, date d’exigibilité, loyer, provisions ou forfait, accessoires autorisés et règles de prorata explicitement configurées. L’identité unique de l’obligation associe bail, nature de terme et période, indépendamment de sa version. Une révision modifie le brouillon avant comptabilisation ; après comptabilisation, elle produit un ajustement ou un avoir lié, jamais un deuxième terme complet. Odoo ne doit pas exécuter une seconde récurrence sur le même périmètre.

**LOY-02 — MVP, Odoo.** Proposer le rapprochement d’un encaissement avec un ou plusieurs termes à partir du payeur, de la référence, du montant et de l’historique. Gérer paiements partiels, paiement de plusieurs mois, tiers payeur, aide au logement, trop-perçu, remboursement, rejet bancaire et affectation erronée. Une somme reçue non affectée reste une avance ou une somme à qualifier ; elle ne solde pas arbitrairement le plus ancien impayé.

**LOY-03 — MVP, SaaS.** Émettre une quittance seulement après confirmation du paiement intégral du loyer et des charges concernés ; pour un paiement partiel, produire un reçu. La quittance est gratuite. Sa remise électronique exige l’accord du locataire, conservé avec sa date et sa preuve ; une remise non numérique reste possible. Elle conserve période, ventilation, référence des paiements, version et preuve de remise. Une annulation de rapprochement ultérieure ouvre une anomalie et une procédure de correction ; elle ne remplace pas silencieusement un PDF déjà remis. [Service Public, quittance](https://www.service-public.gouv.fr/particuliers/vosdroits/F35247)

**LOY-04 — MVP, SaaS.** Détecter retards et impayés en distinguant exigible, reçu non affecté, paiement en transit, litige et incident de synchronisation. Préparer relances graduées selon modèles et délais approuvés. Suspendre l’automatisme si le paiement est ambigu, le dossier contesté ou la banque obsolète. Mise en demeure, action contre garant et contentieux exigent validation humaine.

### 7.2 Révisions et charges récupérables

**IRL-01 — MVP, SaaS.** Calculer une proposition de révision à partir du loyer révisable × nouvel indice / ancien indice, du même trimestre de référence, avec source officielle, clause, date de demande, règles territoriales et contrôle du DPE. Conserver valeurs exactes et arrondi monétaire. Une donnée manquante bloque la proposition exécutable. Pas de rétroactivité automatique ni d’application uniquement parce qu’un anniversaire est atteint. [Service Public, révision du loyer](https://www.service-public.gouv.fr/particuliers/vosdroits/F1311)

**CHA-01 — MVP, SaaS avec données Odoo.** Pour chaque dépense, distinguer compte comptable, nature de charge, récupérabilité totale ou partielle, période de service et clé de répartition. Les clés peuvent reposer sur tantièmes, surfaces, consommations ou autre règle justifiée. Elles sont versionnées et totalisent exactement 100 % du montant à répartir après traitement documenté des arrondis.

**CHA-02 — MVP, SaaS.** Produire une régularisation annuelle des provisions avec dépenses justifiées, provisions appelées et comptabilisées, occupants successifs, vacance, prorata et décompte individuel. Le calcul compare les charges récupérables réelles aux provisions appelées selon la politique comptable validée ; les paiements et impayés de provisions sont exposés séparément dans le compte locataire. Une provision déjà appelée mais impayée ne doit pas être facturée à nouveau dans la régularisation. Séparer provisions et forfait : un forfait ne génère pas une régularisation complémentaire. Prévoir le délai de communication du décompte et la consultation des justificatifs requis. [Service Public, charges récupérables](https://www.service-public.gouv.fr/particuliers/vosdroits/F947)

**CHA-03 — V2, SaaS.** Préparer une nouvelle provision sur dépenses constatées et hypothèses explicites ; comparer périodes sans masquer les changements de périmètre. Toute modification du contrat ou tout appel complémentaire nécessite validation du calcul et de sa base juridique.

Recette financière : un terme de 700 € de loyer et 80 € de provisions payé à hauteur de 500 € ne produit aucun document attestant 780 € acquittés. Le solde de 280 € payé et rapproché permet ensuite une quittance unique de 780 €. Un versement total de 800 € laisse 20 € identifiés séparément.

## 8 Compteurs équipements maintenance et travaux

**COM-01 — MVP, SaaS.** Référencer compteurs individuels, sous-compteurs et compteurs collectifs avec fluide (eau, électricité, gaz, chaleur, production photovoltaïque), unité, numéro, identifiants du point de livraison lorsqu’ils existent (PRM ou PDL, PCE), emplacement, lot desservi et périodes d’affectation. Un relevé conserve index, date réelle, photo, origine et validation. Gérer remplacement, remise à zéro, unité et coefficient multiplicateur. Un index inférieur au précédent ouvre une exception ; il ne produit pas une consommation négative sans explication. Le calcul de consommation garde les deux relevés et la règle utilisés.

**EQU-01 — MVP, SaaS.** Chaque équipement possède catégorie, marque, modèle, série, date d’achat et de mise en service, coût documenté, emplacement, notices, garantie, fournisseur et historique. Prévoir équipements communs et individuels, déplacement et remplacement. L’équipement physique et l’immobilisation comptable sont deux objets reliés, pas deux désignations interchangeables.

**MAI-01 — MVP, SaaS.** Traiter signalement, diagnostic, intervention, contrôle et clôture. Une intervention peut être réalisée par le propriétaire ou par un prestataire ponctuel. Enregistrer urgence, indisponibilité du lot, actions, fournitures, temps passé, photos avant/après, dépenses et prochaine vérification. La clôture nécessite le résultat observé ; une réponse du locataire peut confirmer le rétablissement sans être obligatoire dans tous les cas.

**MAI-02 — MVP, SaaS.** Le moteur crée les échéances d’entretien et de garantie à partir de règles datées. Un incident critique remonte immédiatement au tableau de bord selon la politique validée. L’assistant ne fournit pas d’instruction dangereuse ni ne présente une analyse photo comme un diagnostic certain ; il prépare le contexte pour une intervention appropriée.

**TRA-01 — MVP, SaaS.** Organiser les travaux en projet → zones ou postes → interventions → achats. Comparer budget engagé, facturé, payé et reste à engager. Distinguer entretien, réparation, amélioration et traitement comptable restant à déterminer. La catégorie métier « rénovation » ne suffit pas à choisir charge ou immobilisation.

**TRA-02 — MVP, SaaS et Odoo.** Les heures gratuites du propriétaire restent un suivi opérationnel. Une valorisation horaire facultative apparaît uniquement comme coût économique simulé. Elle ne devient ni facture, ni charge comptable, ni immobilisation fictive. Les coûts effectivement engagés et les remplacements de composants sont traités selon la politique comptable validée. [ANC, Plan comptable général 2026](https://www.anc.gouv.fr/files/anc/files/1_Normes_fran%C3%A7aises/Reglements/Recueils/PCG_janvier2026/PCG--1er-janvier-2026.pdf)

**TRA-03 — V2, SaaS.** Prévoir comparaisons de devis, calendrier de chantier, commandes, réception avec réserves et suivi des garanties. Le produit reste optimisé pour un propriétaire autonome : aucune saisie de planning salarié ou de feuille de paie n’est nécessaire à une réparation simple.

## 9 Dépenses crédits CCA et immobilisations

### 9.1 Factures tickets et dépenses

**DEP-01 — MVP, SaaS.** Accepter photo de ticket, facture PDF, document issu d’Odoo et facture électronique du circuit retenu. Préserver l’original ; extraire fournisseur, date, numéro, lignes, montants, taxes, devise et paiement annoncé. Le contrôle compare total des lignes, taxes et total payable ; une extraction incomplète n’est pas complétée par invention.

**DEP-02 — MVP, SaaS vers Odoo.** Proposer le bien, le projet, la catégorie, la récupérabilité, le payeur et le traitement comptable. Permettre une ventilation par ligne sur plusieurs lots et une part commune. La création d’un fournisseur, son identité de paiement, une nouvelle règle comptable ou un changement de régime exigent validation. La déduplication combine identifiant source, numéro fournisseur, empreinte de fichier et similarité ; un avoir reste distinct de la facture initiale.

**DEP-03 — MVP, Odoo.** Distinguer dépense engagée, facture reçue, comptabilisation, paiement et rapprochement. Un ticket photographié ne prouve pas un débit sur le compte de la SCI. Les notes de frais, achats payés personnellement, paiements fractionnés, remboursements fournisseurs et factures annulées suivent des états explicites.

**DEP-04 — MVP, intégration.** Définir une chaîne unique de facturation électronique selon la qualification de la SCI : plateforme agréée et fonctions Odoo ou connecteur compatibles à confirmer. Le SaaS récupère pièces et statuts à partir de cette chaîne ; l’envoi d’un PDF par email n’est pas présenté comme une conformité à lui seul. [DGFiP, opérations sans TVA](https://www.impots.gouv.fr/professionnel/questions/je-nemets-pas-de-facture-ou-je-facture-sans-tva-suis-je-concerne-par-la)

### 9.2 Crédits et échéanciers

**CRE-01 — MVP, SaaS.** Enregistrer prêteur, emprunteur juridique, biens financés, montant, date de déblocage, durée, taux, type de taux, garanties, frais, assurance, différé et échéancier contractuel importé. Une échéance contient séparément capital, intérêts, assurance et frais, avec leur somme attendue. Le capital restant dû prévisionnel est distingué du solde comptable.

**CRE-02 — MVP, Odoo.** Rapprocher chaque prélèvement avec les composantes attendues et les écritures confirmées. Le remboursement de capital diminue la dette ; il n’est pas une charge. Les fonctions natives de prêt Odoo sont privilégiées si disponibles et démontrées via API. L’assurance et les frais nécessitent un mapping explicite : ils ne sont pas supposés calculés par le module natif. [Odoo, prêts](https://www.odoo.com/documentation/19.0/applications/finance/accounting/bank/loans.html)

**CRE-03 — V2, SaaS.** Gérer nouveaux tableaux après renégociation, taux variable, remboursement anticipé ou modulation. La version précédente reste consultable. Le recalcul d’une prévision ne modifie pas les échéances déjà comptabilisées ; l’écart est expliqué et validé.

### 9.3 Comptes courants d’associés

**CCA-01 — MVP, SaaS et Odoo.** Relier un compte courant à un associé et à une SCI, avec convention, conditions, apports, dépenses payées personnellement, remboursements et intérêts éventuels. Le solde officiel provient d’Odoo. Le CCA est une dette de la SCI, distincte du capital social et du revenu locatif. [Service Public Entreprendre, CCA](https://entreprendre.service-public.gouv.fr/vosdroits/F32966)

**CCA-02 — MVP.** Un achat personnel pour la SCI exige justificatif, bénéficiaire, payeur et validation avant création de la dette envers l’associé. Le remboursement de cette dette ne crée pas une deuxième charge. Les mouvements atypiques et soldes débiteurs ouvrent une revue ; aucune règle de rémunération ou de déductibilité n’est déduite automatiquement par le LLM.

### 9.4 Immobilisations amortissements et VNC

**IMM-01 — MVP, Odoo.** Importer les actifs officiels avec valeur brute, terrain, construction, composants, mise en service, durée, méthode, amortissements cumulés, dotations et VNC. Rattacher chaque actif à ses biens et justificatifs. Les amortissements comptabilisés et les dotations prévisionnelles ont des statuts distincts. Odoo dispose de fonctions de gestion et de sortie des immobilisations dont l’accessibilité API doit être vérifiée. [Odoo, immobilisations](https://raw.githubusercontent.com/odoo/documentation/19.0/content/applications/finance/accounting/vendor_bills/assets.rst)

**IMM-02 — MVP.** Toute création, durée, ventilation terrain/construction, changement de composant et sortie d’actif repose sur une politique validée. Le terrain n’est pas amortissable et aucune proportion universelle terrain/construction ne doit être imposée. [BOFiP, éléments amortissables](https://bofip.impots.gouv.fr/bofip/4590-PGP.html/identifiant=BOI-BIC-AMT-10-20-20220608)

**IMM-03 — V2, SaaS.** Simuler dotations futures et cession selon hypothèses datées, avec rapprochement aux actifs officiels. Présenter séparément valeur de marché, VNC et effet fiscal estimé. La valeur de marché n’écrit pas automatiquement une réévaluation comptable.

## 10 Banque trésorerie acquisition et rentabilité

**BAN-01 — MVP.** Afficher comptes bancaires, soldes à date, mouvements, attente de rapprochement, transferts internes et disponibilité des sources. Conserver solde d’ouverture, date d’opération, date de valeur et devise. Une égalité de soldes ne prouve pas que tous les mouvements sont correctement affectés ; les contrôles portent aussi sur les lignes, contreparties et périodes. Odoo gère les transactions importées et leur rapprochement ; les formats réellement utilisés doivent être testés. [Odoo, transactions bancaires](https://www.odoo.com/documentation/19.0/applications/finance/accounting/bank/transactions.html)

**TRE-01 — MVP, SaaS.** Construire une prévision glissante à 30, 90 et 365 jours à partir des termes locatifs, échéances de prêts, charges, travaux engagés, fiscalité renseignée et remboursements autorisés. Afficher hypothèses d’impayé, vacance, délai de paiement et trésorerie minimale. Séparer prévu, engagé et réalisé. Un encaissement attendu ne devient jamais de la trésorerie disponible.

**ACQ-01 — MVP, SaaS.** Enregistrer une opportunité avec prix, frais estimés, travaux, financement, apport, loyers, charges et documents. Conserver les hypothèses et un scénario de base. La conversion après acquisition doit créer une seule fois les biens et liens nécessaires, puis préparer crédits, actifs et CCA à validation ; elle ne comptabilise pas automatiquement une promesse de vente.

**ACQ-02 — V2, SaaS.** Comparer scénarios de financement, travaux, vacance, loyers et revente ; mesurer l’effet sur toute la SCI. Prévoir hypothèse dégradée, sensibilité taux/occupation et besoin maximal de trésorerie. Le calcul fiscal est une estimation paramétrée et explicite, jamais une garantie de rendement net.

**FIN-01 — MVP, SaaS à partir d’Odoo.** Fournir tableaux par lot, immeuble et SCI avec période, source, date de synchronisation et couverture d’affectation. Les charges non affectées restent visibles dans une rubrique dédiée ; elles ne disparaissent pas des totaux. Les agrégats s’appuient sur un montant canonique réparti une seule fois, même lorsque plusieurs axes analytiques existent. [Odoo, analytique](https://www.odoo.com/documentation/19.0/applications/finance/accounting/reporting/analytic_accounting.html)

| Indicateur | Définition à afficher | Précaution |
|---|---|---|
| Résultat d’exploitation de gestion | Produits acquis de la période − charges d’exploitation de la période | Convention du rapport explicite ; avant financement et amortissements dans cette vue |
| Résultat comptable | Produits comptabilisés − charges comptabilisées, incluant intérêts et dotations applicables | Source Odoo ; distinguer période ouverte et clôturée |
| Flux de trésorerie | Encaissements réels − décaissements réels | Inclut investissement et capital remboursé ; exclut dotation non décaissée |
| Trésorerie finale | Trésorerie initiale + flux net | Transferts internes éliminés en consolidation |
| Rendement brut | Loyers hors charges annuels / coût complet d’acquisition | Par défaut : prix + frais d’acquisition + travaux initiaux ; exclure provisions, dépôts et taxes collectées pour tiers du numérateur |
| Rendement opérationnel | Résultat d’exploitation de gestion / coût complet d’acquisition | Même base par défaut ; toute base alternative est nommée ; avant financement |
| VNC | Valeur brute − amortissements et dépréciations comptabilisés applicables | Lecture officielle Odoo ; aucune estimation de marché |
| Valeur nette économique | Valeur estimée des actifs + autres actifs retenus − dettes retenues | Périmètre explicite, dont crédits et CCA ; avant ou après coûts/fiscalité de cession clairement indiqué |

Les rendements précisent si le numérateur est réalisé sur douze mois, annualisé sur une durée plus courte ou prévisionnel. Une période incomplète n’est pas présentée comme une année réellement encaissée.

**FIN-02 — V2.** Offrir un pont résultat → trésorerie, un suivi de patrimoine net, coût par intervention, taux d’occupation, revenu touristique par nuit disponible et analyse de vacance. Définir le dénominateur : nuits commercialisables ou calendaires, lots actifs ou tous lots. Les valeurs inconnues sont signalées ; elles ne valent pas zéro.

## 11 Location touristique et Airbnb

**AIR-01 — MVP, SaaS.** Gérer annonces, lots, réservations, voyageurs nécessaires au contrat, séjours, nuits bloquées, tarifs, frais de ménage, commissions, remboursements, dépôts éventuels, taxes de séjour et justificatifs. Une réservation, un séjour et un versement sont trois objets distincts. Les formalités locales, autorisations et enregistrements sont conservés avec dates et preuve de contrôle ; la règle de résidence principale n’est pas appliquée aveuglément à un logement détenu par la SCI. [Service Public, location touristique](https://www.service-public.gouv.fr/particuliers/vosdroits/F2043)

**AIR-02 — MVP, SaaS vers Odoo.** Importer des fichiers de réservations et de versements avec mapping versionné, aperçu, contrôle des totaux et déduplication par identifiants de plateforme. Un virement groupé peut régler plusieurs séjours et inclure corrections, remboursements ou retenues d’une autre période. Conserver la chaîne réservation → détail de versement → versement plateforme → banque → document comptable.

Le rapprochement doit reconstituer recettes brutes, remboursements, commissions, frais et flux de taxe selon la responsabilité réelle de collecte. Le net bancaire ne devient pas un revenu supplémentaire. Les taxes collectées pour compte de tiers restent distinctes des recettes dans les cas concernés.

**AIR-03 — MVP pour disponibilité, V2 pour API enrichie.** L’iCal est un outil de calendrier, sans valeur de preuve financière. Airbnb documente une actualisation automatique périodique de calendriers importés ; cette latence interdit de garantir une prévention instantanée des doubles réservations. Les API complètes dépendent d’un accès partenaire ou d’un channel manager contractuellement accessible. [Airbnb, calendriers](https://www.airbnb.com/help/article/99) ; [Airbnb, conditions API](https://www.airbnb.com/help/article/3418)

**AIR-04 — V2.** Ajouter automatisation des messages de séjour, préparation d’arrivée, contrôle départ, ménage réalisé par le propriétaire ou prestataire et consommables. Les messages externes utilisent le canal autorisé. Aucun scraping de session personnelle ni promesse d’accès aux messages Airbnb sans contrat ne figure dans la solution.

## 12 Documents assurances sinistres et communications

**DOC-01 — MVP, SaaS.** Une bibliothèque transversale classe documents par objet, nature, période, auteur, confidentialité et version. Chaque original possède empreinte, type détecté, taille, provenance et droits. OCR, transcription, miniature et résumé sont des dérivés. Recherche plein texte, téléchargement, aperçu, export dossier et documents manquants sont disponibles. Un document peut être relié à plusieurs objets sans stockage logique multiple.

**ASS-01 — MVP, SaaS.** Suivre assurances PNO, habitation, emprunteur et autres polices pertinentes : assuré, biens, garanties, exclusions renseignées, franchise, prime, assureur, contrat et échéances. Une attestation reçue est contrôlée sur identité, bien, couverture et dates avant clôture de l’alerte. Une extraction incertaine reste à vérifier.

**SIN-01 — MVP, SaaS.** Un sinistre regroupe faits, déclarations, photos, échanges, expertises, devis, interventions, dépenses, indemnités et délais. Conserver les responsabilités alléguées séparément de celles reconnues. Les indemnités et réparations sont rapprochées sans compensation automatique qui masquerait les montants bruts.

**MSG-01 — MVP, SaaS.** Préparer emails, SMS ou courriers avec destinataire, objet, modèle versionné, pièces et contexte. Conserver brouillon, validation, tentative, identifiant fournisseur, livraison connue ou inconnue et réponses. Une réception technique n’est pas une preuve de lecture. Les envois récurrents simples peuvent être autorisés par une politique précise ; les notifications juridiques, engagements, changements de coordonnées de paiement et relances contentieuses restent validés individuellement.

**MSG-02 — V2.** Proposer un portail sécurisé pour documents explicitement publiés, signalements et échanges. Les notes internes, données du garant et dossiers d’anciens occupants ne sont jamais publiés par héritage automatique des liens du lot.

## 13 Capture universelle inbox et moteur temporel

### 13.1 Collecter sans ralentir le propriétaire

**CAP-01 — MVP.** Un bouton « Ajouter » toujours accessible propose note, dictée, photo, facture, document, intervention, dépense et relevé de compteur. Le contexte du bien ouvert est prérempli et modifiable. Une capture peut être enregistrée sans choisir immédiatement le lot ; elle rejoint l’inbox avec statut « à rattacher ».

**CAP-02 — MVP.** Accepter transfert email vers une adresse dédiée, dépôt de fichier, copier-coller SMS, partage mobile quand disponible, note vocale et saisie texte. L’import silencieux de toute la boîte SMS personnelle iPhone/Android n’est pas promis : les capacités et permissions des plateformes sont limitées. Un numéro professionnel avec API constitue une intégration distincte. [Apple, composition SMS](https://developer.apple.com/documentation/messageui/mfmessagecomposeviewcontroller) ; [Google Play, permissions SMS](https://support.google.com/googleplay/android-developer/answer/10208820?hl=en-GB)

**CAP-03 — V2.** Ajouter connecteurs Gmail, Microsoft 365, numéro SMS professionnel et canaux autorisés avec OAuth ou authentification appropriée. Les permissions de lecture et d’envoi sont distinctes. Sélectionner les dossiers à ingérer ; révoquer un connecteur stoppe les accès futurs. WhatsApp personnel, enregistrement d’appels et transcription ne sont activés qu’après vérification de la faisabilité et du cadre applicable.

**INB-01 — MVP.** L’inbox présente pour chaque élément la source, l’original, les champs extraits, les rattachements proposés, l’action et le motif d’incertitude. Un traitement collectif exige homogénéité des actions et visibilité des exceptions. « Classé » ne signifie ni « comptabilisé » ni « envoyé ». Un élément reste récupérable après rattachement erroné.

### 13.2 Trois concepts distincts

**TMP-01 — MVP.** `Activity` représente une interaction ou une source : email, SMS, note, audio, photo, fichier, appel documenté, communication sortante ou observation système. Elle conserve contenu brut, canal, auteur déclaré, direction, identifiant externe, dates de capture et réception, pièces et liens. Le résumé IA est une interprétation versionnée, jamais le contenu original.

`Event` représente un fait métier établi : bail signé, paiement rapproché, intervention terminée, index confirmé, écriture Odoo modifiée. Il contient type, objet principal, date effective, date d’enregistrement, provenance, acteur, version et liens. Une activité peut produire plusieurs événements ; plusieurs activités peuvent documenter un seul événement.

`Deadline` représente une obligation ou action future : révision à examiner, attestation à renouveler, entretien à réaliser, échéance de crédit, rendez-vous ou contrôle. Elle contient date due, fenêtre de rappel, responsable, priorité, règle de génération, récurrence et état. Son achèvement référence un événement réel et ne transforme pas la date prévue en date d’exécution.

**TMP-02 — MVP.** Les vues locataire, lot, immeuble et SCI affichent le même événement canonique selon leurs relations. Un changement de locataire ne rattache pas les anciennes communications au nouvel occupant. Les liens portent dates d’effet et motif ; les rapports historiques utilisent le contexte de l’événement. La répétition visuelle d’un événement dans plusieurs vues ne multiplie aucun montant.

**TMP-03 — MVP.** Proposer filtres par type, bien, personne, source, période, importance et statut, avec séparation passé/aujourd’hui/futur. L’échéancier affiche horizons 7, 30, 90 et 365 jours, retard, report et assignation. Un report conserve date initiale, nouvelle date et raison. La récurrence précise son ancrage : date fixe contractuelle ou date réelle d’exécution. Un entretien prévu le 12 novembre réalisé le 10 ne décale l’année suivante que si la règle le prévoit.

**TMP-04 — MVP.** Distinguer rappel, notification et obligation. Les rappels multiples d’une même échéance ne créent pas plusieurs tâches. À la migration, les données historiques alimentent les timelines sans déclencher une avalanche de messages. L’annulation conserve motif et audit ; elle ne supprime pas un fait passé.

### 13.3 États minimaux

| Objet | Parcours nominal | Branches à traiter |
|---|---|---|
| Élément inbox | Reçu → analysé → rattaché → traité | Quarantaine, ambigu, doublon suspect, rejeté avec motif |
| Bail | Brouillon → prêt à signer → signé → actif → terminé → archivé | Annulé avant activation, avenant, contentieux |
| Terme | Prévu → autorisé → comptabilisé → partiellement réglé → réglé | Contesté, annulé par correction, paiement rejeté |
| Deadline | Planifiée → à traiter → accomplie | Reportée, bloquée, annulée ; retard calculé séparément |
| Intervention | Signalée → qualifiée → planifiée → en cours → terminée | En attente de pièce, réouverte, annulée |
| Commande externe | Préparée → autorisée → envoyée → confirmée | Rejetée, résultat inconnu, conflit, compensation requise |

## 14 Modèle de données conceptuel et invariants

Le modèle relationnel doit distinguer l’organisation technique, la personne juridique et l’objet immobilier. Les identifiants internes sont immuables ; les codes affichés et libellés restent modifiables. Tous les objets possèdent organisation, date de création, auteur, version et statut. Les montants utilisent un type décimal exact avec devise ; les calculs intermédiaires conservent leur précision avant arrondi. Les dates calendaires des contrats restent des dates locales ; les instants techniques sont enregistrés en UTC avec fuseau d’affichage.

| Ensemble | Entités et cardinalités structurantes | Invariants |
|---|---|---|
| Organisation et patrimoine | Organisation 1–N SCI ; SCI 1–N Immeuble ; Immeuble 1–N Lot ; Lot 1–N AffectationUsage | Un objet comptable relève d’une seule société ; usage et rattachement historique datés |
| Parties et contrats | Personne N–N Bail par ParticipationBail ; Bail 1–N LotContractuel ; Bail 1–N EngagementGarantie ; Personne 1–N Coordonnée et RôleDaté | Rôle, période et consentement explicites ; chevauchement d’occupation contrôlé |
| Exploitation | Bail 1–N Terme ; Terme N–N Paiement par AffectationPaiement ; Bail 0–1 CompteDépôt 1–N DépôtMouvement | Somme des affectations ≤ montant disponible ; solde dépôt dérivé des mouvements, distinct de la dette locative |
| Visites et équipements | Bail 1–N EDL ; EDL 1–N Constat ; Lot 1–N Inventaire ; Équipement 1–N AffectationÉquipement | Document signé immuable ; état constaté séparé du coût imputé |
| Compteurs | Compteur 1–N Relevé ; Compteur N–N Lot par DesserteDatée | Unité et succession contrôlées ; consommation traçable aux relevés |
| Dépenses et travaux | ProjetTravaux 1–N Intervention ; Dépense 1–N LigneDépense ; Ligne 1–N Ventilation vers lot, commun immeuble ou commun SCI | Ventilations + résiduel explicitement non affecté = montant de ligne ; aucune affectation fictive |
| Finance | Crédit 1–N VersionÉchéancier 1–N Échéance ; Associé 1–N CompteCourant ; Actif 1–N Composant ; TransfertInterne relie deux mouvements bancaires et son transit | Aucun double moteur de comptabilisation ; officiel et simulation séparés |
| Touristique | Annonce N–1 Lot ; Réservation 1–N MouvementRéservation ; Versement N–N Réservation par DétailVersement | Identifiants plateforme uniques dans leur espace ; brut/net et taxes conservés |
| Documents et temps | Document 1–N Version ; Activity N–N Objet ; Event N–N Objet ; Deadline N–N Objet | Une source canonique ; relations historisées ; accomplissement lié à un fait |
| Assurance et sinistre | Police N–N Bien ; Sinistre N–N Activity, Dépense, Intervention et Indemnité | Couverture et responsabilité ne se déduisent pas d’un simple mot-clé |
| Intégration et décision | Commande 1–N Tentative ; Commande 0–N Approbation ; Commande 1–N EntréeOutbox ; Objet 0–N CorrespondanceExterne ; Activity 0–N ÉlémentInbox | Clé d’idempotence + empreinte ; un résultat inconnu reste non confirmé ; audit indépendant des événements |

**MOD-01 — MVP.** Les relations génériques de timeline utilisent un registre d’objets typés et contrôlés, ou des tables de liens assurant l’intégrité ; aucune référence polymorphe libre ne doit permettre un lien vers une autre organisation. Une suppression fonctionnelle n’efface pas les relations nécessaires à l’audit. Les données personnelles peuvent être pseudonymisées ou supprimées selon la politique légale sans fabriquer un nouvel historique métier.

**MOD-02 — MVP.** Chaque valeur financière affichée garde montant, devise, période, source, référence Odoo éventuelle, date de lecture et statut officiel/prévisionnel. Chaque extraction IA garde champ proposé, élément de preuve, modèle/version et décision. La table de correspondance externe comprend organisation, base, société, modèle, identifiant externe et UUID interne avec contraintes d’unicité appropriées.

**MOD-03 — MVP.** Une obligation de loyer possède une identité unique indépendante de ses révisions. Une version corrigée avant comptabilisation remplace le brouillon autorisé ; après comptabilisation, elle exige un ajustement ou avoir lié, sans recréer un terme complet. Les verrous de concurrence s’appuient sur version attendue et contraintes de base, pas sur le seul état de l’interface.

## 15 Parcours métier de bout en bout

Les parcours suivants constituent les scénarios minimaux de démonstration. Le responsable métier peut toujours voir la source, l’action proposée et son résultat externe.

**WF-01 — Ticket après achat personnel.** Le propriétaire photographie un ticket et indique avoir payé personnellement. Le SaaS stocke l’original, détecte un doublon éventuel et propose le lot et la catégorie. Après validation du bénéficiaire et du traitement, la commande comptable enregistre l’achat et la dette envers l’associé. Le retour Odoo confirme le solde. Un remboursement ultérieur réduit le CCA sans recréer la charge. Un payeur inconnu bloque la comptabilisation proposée.

**WF-02 — Cycle mensuel de loyer.** Le moteur prépare les obligations des baux actifs et compare leur nombre au parc attendu. Les commandes autorisées produisent les pièces Odoo ; les échecs individuels restent identifiés. Les transactions bancaires arrivent par Odoo, les affectations proposées sont confirmées puis relues. Reçu partiel ou quittance intégrale est préparé selon le solde réel. Un terme absent, doublonné ou modifié directement dans Odoo ouvre une exception.

**WF-03 — Paiement ambigu ou rejeté.** Un virement correspond à deux baux possibles : aucune affectation automatique n’est faite. Le propriétaire choisit les termes ; le moteur contrôle montant et disponibilité. Si la banque annule ensuite l’encaissement, le solde est rouvert et les documents émis sont signalés. Les relances reprennent après examen, sans effacer le paiement annulé de la timeline.

**WF-04 — Préavis reçu par email.** Le message et sa pièce sont archivés ; l’IA propose locataire, bail, date annoncée et nature du document. Le propriétaire vérifie réception, forme et délai applicables. Après validation, le système crée les échéances de visite, compteurs, clés, dépôt et remise en location. Une date juridiquement non établie demeure « annoncée » et ne termine pas automatiquement le bail.

**WF-05 — Entrée puis sortie.** À l’entrée, contrôles des pièces, assurance, état des lieux, inventaire, index et dépôt précèdent activation complète. À la sortie, comparaison contradictoire, date des clés et décompte préparent restitution ou retenues justifiées. Le dépôt est une dette à solder ; une créance déjà comptabilisée n’est pas créée une seconde fois lors de sa compensation autorisée.

**WF-06 — Fuite et intervention personnelle.** Un SMS partagé crée une Activity reliée au bail, au lot et à l’incident proposé. Le propriétaire confirme le contexte, enregistre diagnostic puis réparation, temps et achat. Les photos et dépenses complètent la timeline. La clôture crée un Event et, si nécessaire, une Deadline de contrôle dont l’ancrage est explicite. La note seule ne prouve pas le paiement du ticket.

**WF-07 — Régularisation annuelle.** Les dépenses validées et règles de récupération sont gelées dans un calcul versionné. Le système répartit par lot, période d’occupation et clé, puis compare aux provisions appelées comptabilisées. Les impayés de provisions restent dans le compte locataire et ne sont pas refacturés comme nouvelle régularisation. Après validation et information requise, un ajustement est préparé vers Odoo ; tout document manquant est visible.

**WF-08 — Échéance de crédit.** L’échéancier annonce capital, intérêts et assurance. Le débit bancaire est rapproché de ces composantes puis des écritures Odoo. Un écart de taux, date ou montant ouvre une exception. La dette officielle ne diminue qu’après lecture du traitement comptable ; la prévision reste disponible séparément.

**WF-09 — Versement Airbnb groupé.** L’import rapproche les réservations et détails de règlement. Le système reconstitue brut, remboursement, commission et taxes, puis le net attendu. Une ligne bancaire peut solder plusieurs réservations. Une différence non expliquée bloque la confirmation finale ; iCal ne remplace ni justificatif ni détail de paiement.

**WF-10 — Acquisition.** Une opportunité conserve plusieurs scénarios ; le propriétaire marque l’acte signé avec ses pièces et données réelles. Une commande de conversion unique crée ou rattache immeuble, lots, financement et documents. Les actifs, frais et apports sont préparés à validation comptable. Rejouer la conversion retrouve le résultat existant ; annuler une acquisition enregistrée exige un processus de correction explicite.

**WF-11 — Attestation d’assurance.** Le PDF reçu est extrait puis comparé au contrat et à la période. Une correspondance complète sous politique autorisée rattache la pièce et clôt l’alerte ; un nom différent, une date illisible ou une couverture incertaine sollicite une revue. La précédente attestation reste accessible selon conservation.

**WF-12 — Correction comptable et clôture.** L’expert-comptable corrige une affectation ou verrouille une période dans Odoo. La synchronisation retour met à jour les vues et signale les conséquences locatives. Une commande en attente sur période fermée est refusée ; le SaaS ne décale pas silencieusement sa date. Le propriétaire dispose d’un dossier d’écarts et pièces à transmettre pour clôture.

## 16 Architecture API et synchronisation Odoo

### 16.1 Architecture recommandée

**ARC-01 — MVP.** Partir d’un monolithe modulaire avec API métier, traitements asynchrones séparés, base relationnelle PostgreSQL, stockage d’objets privé, file durable et moteur de règles versionnées. Les modules patrimoine, location, finance, documents, temporalité, intégration et IA ont des frontières explicites. Ce choix réduit les transactions distribuées internes ; une extraction en services ne se justifie ensuite que par un besoin mesuré.

Le navigateur et l’application mobile communiquent avec l’API SaaS. Les workers exécutent OCR, transcription, imports et synchronisation. Le connecteur Odoo est le seul composant disposant des secrets Odoo. La recherche dispose d’un index reconstruisible ; elle ne remplace jamais la base métier. Aucun fournisseur de LLM, d’OCR, de stockage ou de file n’est imposé : interfaces d’adaptation et tests de contrat doivent permettre son remplacement.

**ARC-02 — MVP.** Exposer des commandes métier validées, pas un accès générique aux modèles Odoo. Chaque commande contient organisation, acteur, objet, version attendue, identifiant d’opération, version de règle, payload, empreinte, portée d’autorisation et références de preuve. La réponse indique identifiant durable, état et liens de suivi ; un retour HTTP d’acceptation ne signifie pas que la comptabilité est validée.

Exemple de contrat propre au SaaS, à documenter en OpenAPI ; il ne représente pas une méthode native Odoo :

```json
{
  "operation_id": "uuid-unique",
  "command": "prepare_rent_accounting",
  "obligation_id": "uuid-obligation",
  "expected_version": 3,
  "rule_version": "rent-policy-validated",
  "amount": "900.00",
  "currency": "EUR",
  "approval_id": "uuid-approval"
}
```

Une clé réutilisée avec une charge utile différente est rejetée. Les erreurs sont typées : validation, droits, conflit de version, période fermée, fournisseur indisponible, quota, référence ambiguë et résultat inconnu. Les lectures sont paginées ; les exports volumineux sont asynchrones et privés. Les URLs d’environnements et de connecteurs proviennent de la configuration, les secrets d’un coffre, jamais du code client.

Le contrat de routes ci-dessous est une proposition pour le SaaS. `Idempotency-Key` est exigé pour les mutations rejouables ; s’il est également fourni comme `operation_id`, les deux doivent correspondre. L’organisation autorisée provient de la session et ne peut être imposée par le payload. Toutes les routes contrôlent authentification et droits, avec 401/403 en cas de refus.

| Route SaaS proposée | Entrées et résultat | Réponses principales |
|---|---|---|
| POST `/v1/commands` | Type de commande, objet, version attendue, payload et approbation ; retourne identifiant durable | 202 accepté ; 409 conflit/version/clé divergente ; 422 règle métier |
| GET `/v1/commands/{id}` | Identifiant autorisé ; état, étapes, référence externe et erreur éventuelle | 200 état connu ; 404 absent ou non divulguable |
| GET `/v1/timeline` | Périmètre autorisé, filtres, curseur opaque, limite ; éléments et curseur suivant | 200 page ; 422 filtre invalide |
| POST `/v1/documents/uploads` puis POST `/v1/documents/{id}/finalize` | Métadonnées, taille, empreinte ; autorisation temporaire puis vérification du fichier reçu | 201 session ; 202 analyse ; 409 empreinte incohérente ; 413 taille dépassée |
| POST `/v1/approvals` | Commande, empreinte, décision, version et portée ; preuve de validation | 201 décision ; 409 proposition changée ; 422 approbation non applicable |
| GET `/v1/integrations/{id}/health` | Connecteur autorisé ; dernier succès, fraîcheur, erreurs et état des files | 200 avec état sain/dégradé ; 404 absent ou non divulguable |

### 16.2 Garantie réaliste d’exécution

**SYN-01 — MVP.** Une transaction locale enregistre ensemble décision, autorisation, commande et outbox. Un consommateur logique par objet utilise verrou avec expiration, renouvellement et jeton de génération pour empêcher un ancien worker de reprendre la main. Le worker vérifie à nouveau droits, version, clôture, montants et validité de l’approbation juste avant l’envoi.

Les verrous SaaS et la lecture préalable ne verrouillent pas les modifications manuelles concurrentes dans Odoo. Ils ne garantissent aucun compare-and-swap atomique distant. L’adaptateur utilise les validations atomiques standard lorsqu’elles existent, évite tout écrasement aveugle et relit le résultat après l’action. Un changement distant concurrent ouvre une exception. Le PoC documente, opération par opération, la sérialisation possible et la politique de conflit.

**SYN-02 — MVP.** Les appels Odoo sont des transactions séparées. Créer un brouillon, joindre une pièce et valider peuvent former plusieurs étapes ; une erreur intermédiaire n’annule pas automatiquement les précédentes. La documentation JSON-2 précise cette limite. L’adaptateur conserve les étapes accomplies et reprend à partir de l’état relu. [Odoo, transactions API](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html)

**SYN-03 — MVP.** En cas de réponse perdue ou délai dépassé, marquer **résultat inconnu** et rechercher la référence stable effectivement persistée dans Odoo. Comparer société, tiers, période, montants, devise et état. Un résultat unique identique confirme l’opération ; plusieurs résultats ou un contenu différent ouvrent une exception. Une recherche vide alors que l’appel initial peut encore s’exécuter ne prouve pas son échec. Aucun `create`, rapprochement, paiement ou envoi n’est réémis aveuglément.

Sans contrainte atomique de déduplication démontrée côté Odoo, aucune garantie absolue « exactement une fois » ne doit être revendiquée. Un champ Studio ne constitue pas en soi une contrainte d’unicité. Le SaaS garantit prévention locale, traçabilité, détection et suspension des reprises dangereuses. Si l’ambiguïté persiste, une résolution humaine documentée est requise.

**SYN-04 — MVP.** La synchronisation retour utilise pagination stable, couple de progression tel que date de modification/identifiant lorsque disponible, fenêtre de recouvrement et déduplication. Le curseur avance seulement après persistance complète de la page. Un audit périodique des objets critiques détecte suppressions, archives et changements que le delta ne reflète pas. Un webhook éventuel accélère le flux sans devenir son unique mécanisme de fiabilité.

**SYN-05 — MVP.** Toute correction venant d’Odoo respecte la matrice d’autorité. Un écart contractuel ouvre un dossier : valeur attendue, valeur comptable, auteur si accessible, pièces, portée et actions possibles. Les écritures validées, sécurisées ou clôturées ne sont pas supprimées automatiquement ; les corrections suivent les procédures Odoo autorisées. [Odoo, inaltérabilité](https://raw.githubusercontent.com/odoo/documentation/19.0/content/applications/finance/accounting/reporting/data_inalterability.rst)

**SYN-06 — MVP.** L’interface affiche dernier succès, retard de synchronisation, opération en attente et éventuelle donnée obsolète. Si banque ou comptabilité dépassent le seuil autorisé, suspendre les automatismes dépendants : quittance, relance, contrôle de solde. Les lectures échouées ne retournent jamais un zéro supposé. Les retries techniques utilisent délai exponentiel avec dispersion ; seuls les échecs prouvant une indisponibilité du service déclenchent le coupe-circuit global.

### 16.3 Connecteurs et messagerie

**INT-01 — MVP/V2 selon canal.** Chaque webhook vérifie signature, intégrité du corps brut, horodatage et fenêtre anti-rejeu quand le fournisseur les offre, puis déduplique sur identifiant fournisseur. L’accusé technique suit une persistance durable. Un message invalide est mis en quarantaine sans exposer son contenu dans les journaux. Les schémas sont validés aux frontières et les URLs entrantes protégées contre les accès aux réseaux internes.

Les connecteurs Gmail doivent renouveler leur surveillance et disposer d’un rattrapage ; un historique expiré impose une resynchronisation. Microsoft Graph fournit des jetons delta opaques à conserver par dossier. Les adaptateurs gèrent ces mécanismes séparément plutôt qu’un faux curseur universel. [Google, notifications](https://developers.google.com/workspace/gmail/api/guides/push) ; [Google, synchronisation](https://developers.google.com/workspace/gmail/api/guides/sync) ; [Microsoft, delta messages](https://learn.microsoft.com/en-us/graph/delta-query-messages)

**INT-02 — MVP.** Les communications sortantes passent par une outbox avec trace de déduplication écrite avant l’effet externe. En cas d’état inconnu, interroger le fournisseur si possible avant toute reprise. Le connecteur SMS professionnel vérifie les signatures selon sa bibliothèque officielle et conserve l’identifiant du message. [Twilio, webhooks SMS](https://www.twilio.com/docs/messaging/guides/webhook-request)

## 17 IA autonomie contrôlée et mémoire

### 17.1 Niveaux de décision

| Niveau | Exemples | Autorisation |
|---|---|---|
| A — Observation | OCR, transcription, recherche, résumé, anomalie proposée | Automatique, sans effet métier engageant ; source et incertitude visibles |
| B — Action réversible | Classement, lien suggéré sous règle fiable, rappel interne, brouillon | Automatique dans un périmètre approuvé ; annulation et audit disponibles |
| C — Routine financière ou externe encadrée | Terme contractuel inchangé, correspondance bancaire déterministe, message simple approuvé | Activation progressive après recette, plafonds, preuves et suivi ; validation individuelle au démarrage |
| D — Décision sensible | Bail, congé, IRL, retenue, remboursement, IBAN, fournisseur nouveau, politique comptable, fiscalité, clôture, suppression | Validation humaine explicite ; certaines opérations demeurent exécutées dans le canal spécialisé |

**IA-01 — MVP.** Le LLM extrait et propose ; des fonctions déterministes calculent montants, échéances, éligibilité et droits. Il ne reçoit ni identifiants Odoo ni outil permettant SQL, code arbitraire ou invocation libre de méthodes comptables. Sa sortie est validée par schéma puis par règles métier. Une confiance élevée ne remplace ni autorisation ni preuve.

**IA-02 — MVP.** Emails, PDF, notes, OCR, transcriptions et résultats de recherche sont des contenus non fiables. Une phrase demandant d’ignorer les règles ou de changer un compte bancaire n’est jamais une instruction système. Le moteur sépare données et commande ; il refuse qu’une source externe choisisse seule destinataire, permission ou action.

**IA-03 — MVP.** Une approbation porte sur l’empreinte du payload exact, le périmètre, l’acteur, la règle et une expiration. Si un montant, un destinataire, une pièce essentielle, les droits ou l’état de l’objet change, l’approbation est invalidée. La revalidation immédiatement avant exécution évite d’appliquer une décision devenue obsolète. L’écran montre pièces, effet attendu, alternative et possibilité de refus motivé.

**IA-04 — MVP puis extension V2/V3.** Commencer en mode observation sans effet, puis validation systématique, puis activer des classes de routines limitées. Mesurer précision sur champs critiques, corrections, coût par document et taux d’exception par source. Évaluer un échantillon aléatoire stratifié incluant cas difficiles ; publier volume, période et taux de couverture. Une dégradation désactive la classe concernée. Un changement de modèle, prompt ou règle repasse la recette correspondante.

**IA-05 — MVP.** Pas de refus autonome de candidature, notation opaque de solvabilité, sanction, congé, mise en demeure, retenue sur dépôt ou décision affectant significativement une personne. Le contrôle humain doit être réel et informé. [CNIL, décisions automatisées](https://www.cnil.fr/fr/profilage-et-decision-entierement-automatisee)

**IA-06 — MVP pour la proposition, V2 pour l’activation.** Lorsque des affectations identiques sont confirmées de façon répétée pour une même origine (fournisseur, identifiant de compteur, libellé bancaire récurrent), le système propose une règle d’affectation explicite : condition, effet (lot ou partie commune, catégorie, récupérabilité, traitement comptable proposé), exemples à l’appui et périmètre. La règle n’est active qu’après validation (DEP-02) ; elle est versionnée, désactivable, et chaque affectation qu’elle produit la référence. Une correction humaine d’un résultat issu d’une règle suspend cette règle et ouvre sa révision ; le LLM ne crée, ne modifie ni n’active jamais une règle seul. Le taux de correction par règle alimente les mesures d’IA-04.

### 17.2 Recherche et mémoire explicables

**MEM-01 — MVP.** Rechercher mots, personnes, montants, dates et objets dans documents, activités, événements et interventions. Les droits s’appliquent **avant** la récupération et le classement sémantique, puis sont revérifiés sur les sources retournées. Une réponse sur un ancien incident cite les pièces ou événements et distingue fait observé, déclaration d’un tiers et interprétation.

**MEM-02 — MVP.** Chaque affirmation factuelle importante d’un résumé comporte un lien source et sa date. Les totaux financiers proviennent d’une requête métier déterministe, pas d’une addition libre de fragments par le modèle. Si le corpus est incomplet ou obsolète, la réponse le dit. « Aucun nouvel incident retrouvé » ne devient pas « aucun incident n’a eu lieu ».

**MEM-03 — V2.** Ajouter résumés de logement, recherche vocale et comparaisons temporelles. Les index et embeddings sont des dérivés supprimables et reconstruisibles ; ils respectent rétention, rectification et retrait des droits. Une archive intermédiaire légalement conservée n’alimente pas par défaut la mémoire IA courante.

## 18 Expérience desktop mobile et tableau de bord

**UX-01 — MVP.** L’accueil s’intitule « Ce qui nécessite mon intervention ». Il présente validations, anomalies, retards et échéances proches, triés par impact, urgence et dépendances. Chaque carte explique pourquoi elle apparaît, ce qui bloque, l’action proposée et l’effet attendu. Les alertes identiques sont regroupées ; une cause racine telle qu’une banque déconnectée ne doit pas produire cent alertes de loyers manquants.

Le bandeau de situation distingue « contrôles terminés », « contrôles partiels » et « sources indisponibles ». Un état vert global est interdit si un contrôle critique a échoué. Le tableau secondaire montre occupation, encaissements, trésorerie, dette, CCA, VNC et prochaine charge importante, avec accès aux lignes justificatives et à la date de fraîcheur.

**UX-02 — MVP.** La navigation desktop propose Patrimoine, Locations, Finance, Travaux, Inbox, Échéancier et Documents. Chaque fiche expose synthèse, timeline, documents, finances et actions. La recherche globale, l’assistant conversationnel (UX-06) et le bouton de capture restent accessibles. Les formulaires affichent progressivement les champs utiles au régime choisi ; les propriétés techniques de synchronisation se trouvent dans le détail, tandis que l’état « en attente de confirmation comptable » demeure visible.

**UX-03 — MVP.** Sur mobile, privilégier capture à une main, grands contrôles, dictée, reprise de brouillon et lecture des prochaines actions. Après enregistrement local, montrer « enregistré sur cet appareil » puis « synchronisé », jamais « sauvegardé » de façon ambiguë. Les photos et notes en attente sont conservées dans une file durable ; une perte de réseau ne doit pas les faire disparaître. L’utilisateur voit les éléments non téléversés avant déconnexion.

**UX-04 — MVP.** Les actions sensibles restent indisponibles hors ligne ; la capture locale ne vaut pas validation comptable. Le stockage local de pièces sensibles est minimisé, chiffré selon les capacités réellement démontrées et limité dans le temps. La déconnexion invalide les sessions et applique une procédure explicite aux captures non synchronisées. Si une application web ne permet pas un effacement ou une protection suffisante sur l’appareil cible, réduire son cache ou retenir une enveloppe mobile adaptée ; ne pas promettre une propriété non testée.

**UX-05 — V2.** Ajouter raccourcis par QR code d’équipement, partage natif enrichi, calendrier et portail. La reconnaissance automatique du numéro de compteur ou du logement reste confirmable. Une indication chiffrée de confiance ne remplace pas un motif compréhensible : « deux lots correspondent à cette adresse » est plus utile qu’un pourcentage isolé.

**UX-06 — MVP.** L’assistant conversationnel est une surface de commande de premier rang, accessible depuis chaque écran desktop et mobile. Il répond à des questions telles que « Que dois-je faire aujourd’hui ? », « Résume-moi ce lot » ou « Combien la SCI doit-elle à l’associé ? » à partir des requêtes métier déterministes et de la recherche autorisée (MEM-01, MEM-02), en citant ses sources et leur date de fraîcheur ; il peut expliquer un montant affiché ou une écriture Odoo en remontant à la matrice d’autorité du §4. Une demande d’action (« relance le locataire de ce lot », « prépare la révision de loyer ») devient une ou plusieurs commandes proposées au sens d’ARC-02, présentées avec objet, montant, pièces et effet attendu, puis soumises aux niveaux de décision du §17.1 : aucune exécution de niveau C ou D sans l’approbation d’IA-03. « Rien ne nécessite votre intervention » n’est affiché que si le bandeau de situation d’UX-01 indique des contrôles terminés ; sinon la réponse nomme les contrôles partiels ou les sources indisponibles.

## 19 Exigences non fonctionnelles et exploitation

Les objectifs suivants sont des **cibles proposées de recette**, à ajuster pendant le cadrage selon budget, volumétrie et contraintes Odoo. Ils ne constituent pas un engagement déjà mesuré.

| Référence | Cible proposée | Conditions et preuve |
|---|---|---|
| NFR-01 — Réactivité | p95 inférieur à 2 s pour fiche, timeline paginée et liste courante ; recherche structurée inférieure à 3 s | Mesure navigateur et API séparées, réseau de test documenté ; hors OCR/LLM et gros export |
| NFR-02 — Charge | 1 organisation de 1 000 lots, 10 000 baux historiques, 1 million d’événements, 100 000 documents ; 50 sessions simultanées | Jeu synthétique avec index, droits et pièces ; test du cycle de 1 000 termes et de 10 000 mouvements |
| NFR-03 — Traitements | Cycle de 1 000 termes préparés localement en moins de 15 min ; files sans famine d’une organisation | Exécution Odoo mesurée séparément selon quotas ; priorité aux échéances critiques |
| NFR-04 — Fraîcheur | Retour Odoo nominal p95 inférieur à 5 min ; alerte après 15 min sur flux critique | Objectif lorsque fournisseur disponible ; incidents externes visibles et exclus du budget interne, jamais cachés |
| NFR-05 — Disponibilité | 99,5 % mensuels pour le service SaaS de base au lancement | Mesure externe ; pannes de dépendances exposées séparément ; calendrier maintenance annoncé |
| NFR-06 — Capture | Aucun fichier perdu dans 100 essais d’interruption réseau et redémarrage documentés | iOS et Android cibles, quotas de stockage, appareil verrouillé et reprise testés |
| NFR-07 — Accessibilité | Parcours clés utilisables au clavier et lecteur d’écran ; cible WCAG 2.2 AA | Contrôles automatiques plus tests manuels ; statut jamais exprimé par couleur seule |
| NFR-08 — Maintenabilité | Contrats API versionnés, migrations réversibles ou procédure de retour démontrée | Environnement test isolé, revue de code, déploiement progressif et suivi des erreurs |

**SEC-02 — MVP.** Chiffrement des transports et stockages, MFA pour comptes privilégiés, sessions via cookies sécurisés et httpOnly, expiration et révocation, contrôle des téléchargements par liens temporaires. Les secrets sont hors dépôt, tournants et limités par environnement. Les requêtes utilisent des paramètres ; les entrées sont validées par schéma. Les fichiers sont contrôlés par taille et type réel, analysés et rendus dans un contexte isolé.

**SEC-03 — MVP.** Journal d’audit séparé de la timeline : acteur humain ou technique, organisation, objet, action, avant/après pertinent, motif, source, approbation, identifiant de corrélation et résultat. Le journal résiste aux modifications par les utilisateurs ordinaires. Il évite secrets et copie exhaustive de données sensibles. Consulter, exporter et modifier des droits sensibles est audité ; une Event métier n’est pas une preuve suffisante de tous les accès.

**OPS-01 — MVP.** Observer disponibilité, latence, erreurs, âge des files, commandes inconnues, retard de synchronisation, contrôles comptables, coût IA et échecs de notification. Les alertes techniques ont responsable, seuil, procédure et clôture. Les journaux structurés permettent de suivre une capture jusqu’à Odoo sans exposer le contenu d’un bail. Un tableau d’exploitation distingue rejet métier isolé et panne de ressource.

**OPS-02 — MVP.** Le moteur nocturne contrôle équilibre des écritures importées, correspondance des termes, paiements non affectés, justificatifs absents, ventilations incomplètes, échéances de crédit, soldes de CCA, actifs sans pièce et doublons potentiels. Les contrôles bancaires comparent dates, solde initial, transit et lignes. Le compte rendu publie contrôles attendus, exécutés, échoués et anomalies ; une exécution dont tous les appels échouent retourne un échec et n’avance aucun watermark.

**OPS-03 — MVP.** Configurer les échéances annuelles de clôture, dossier expert-comptable, déclarations et obligations fiscales à partir de dates validées par le professionnel compétent. L’IA peut rappeler et vérifier la complétude ; elle n’invente pas un calendrier juridique universel. La clôture fournit balance, justificatifs, réconciliation locative, crédits, CCA, actifs et liste des points ouverts, selon exports disponibles.

### 19.1 Sauvegardes et continuité

**BCP-01 — MVP.** Cible SaaS proposée : RPO de 1 heure et RTO de 8 heures pour un incident majeur, à démontrer avec sauvegardes chiffrées, restauration à un instant donné de la base et versionnage des originaux. Conserver une copie isolée du compte de production, suivre les échecs de sauvegarde et tester trimestriellement une restauration complète avec vérification des empreintes et des droits. Index et caches sont reconstruits, pas traités comme sources uniques.

**BCP-02 — MVP.** Odoo Online possède sa propre politique de sauvegarde et de restauration ; sa documentation décrit sauvegardes quotidiennes, téléchargement et duplication de test. Cela ne démontre pas le RPO/RTO contractuel nécessaire à cette SCI. Le cadrage vérifie accès, fréquence, restauration possible, coût et contact d’urgence. Le plan de continuité couvre séparément SaaS, Odoo et fournisseurs. [Odoo Online](https://raw.githubusercontent.com/odoo/documentation/19.0/content/administration/odoo_online.rst)

**BCP-03 — MVP.** Après restauration, suspendre les sorties vers Odoo et les communications jusqu’à rapprochement des références externes, commandes déjà exécutées et suppressions RGPD. Rejouer une ancienne outbox sans cette vérification est interdit. Le test de reprise prouve l’absence de double écriture et de double message après rétablissement.

## 20 Protection des données et RGPD

La SCI est en principe responsable des traitements locatifs qu’elle détermine ; le rôle exact du fournisseur SaaS et des sous-traitants est fixé contractuellement. Le registre décrit finalité, base légale, catégories de personnes, destinataires, conservation, sécurité et transferts. Le consentement n’est pas utilisé comme justification universelle de tous les traitements.

**RGPD-01 — MVP.** Informer locataires, candidats, garants et utilisateurs sur les traitements applicables. Limiter la collecte au nécessaire ; séparer justificatifs sensibles, données de paiement et communications ordinaires. Prévoir accès, rectification, limitation, opposition et effacement selon leur applicabilité, avec vérification proportionnée d’identité. Les demandes sont suivies jusqu’à réponse ; un droit à l’effacement ne supprime pas une pièce légalement conservée sans analyse.

**RGPD-02 — MVP.** Faire valider la matrice de conservation avant production. Le référentiel CNIL distingue base active et archivage intermédiaire, notamment pour candidatures et dossiers locatifs. Les pièces comptables disposent d’une référence générale de conservation de dix ans depuis la clôture, à qualifier selon le document et l’entité. [CNIL, gestion locative](https://www.cnil.fr/sites/default/files/atoms/files/referentiel_relatif_aux_traitements_de_donnees_personnelles_mis_en_oeuvre_dans_le_cadre_de_la_gestion_locative.pdf) ; [Service Public Entreprendre, conservation](https://www.service-public.gouv.fr/entreprendre/vosdroits/F10029?profil=tout)

| Données | Politique de conception proposée | Sortie de conservation |
|---|---|---|
| Candidature non retenue et solvabilité | Base active limitée selon référentiel CNIL, repère de trois mois à qualifier selon finalité ; aucun stockage durable par défaut | Suppression des pièces et dérivés à échéance, sauf justification distincte |
| Bail, compte locataire et garantie | Actifs pendant contrat et clôture des comptes ; archive restreinte selon obligations et prescriptions validées | Purge ou anonymisation à l’échéance propre à chaque catégorie |
| Factures, écritures et justificatifs comptables | Référence dix ans depuis clôture, avec validation du périmètre | Accès comptable restreint puis purge autorisée |
| Photos EDL, sinistres et litiges | Durée liée à la finalité et au risque juridique établi ; gel documenté si litige | Fin du gel contrôlée ; aucune conservation illimitée par défaut |
| Audio brut et transcriptions | Audio supprimé après transcription validée et délai court configurable, sauf besoin de preuve documenté | Suppression audio indépendante du texte utile conservé |
| Journaux techniques et audit de sécurité | Durée minimale justifiée par sécurité et preuve ; proposition initiale de 12 mois à valider | Agrégation/anonymisation ou purge ; aucune donnée métier intégrale inutile |
| Sauvegardes SaaS | Fenêtre glissante proposée de 35 jours, sous réserve du plan de continuité | Expiration automatique ; registre des suppressions rejoué après restauration |

**RGPD-03 — MVP.** Propager suppression et rectification aux OCR, miniatures, embeddings, index, caches et exports encore administrés. Les sauvegardes non modifiables expirent selon la politique ; une restauration réapplique les suppressions avant réouverture. Les archives intermédiaires sont isolées de l’usage courant et de la recherche IA.

**RGPD-04 — MVP.** Encadrer fournisseurs IA/OCR par contrat, minimisation des données, liste des sous-traitants, lieux de traitement et mécanismes de transfert appropriés. Interdire par défaut l’utilisation des données clients pour entraîner les modèles. L’hébergement européen seul ne prouve pas l’absence de transfert. Évaluer la nécessité d’une AIPD selon risques et échelle. [CNIL, IA générative](https://www.cnil.fr/fr/les-questions-reponses-de-la-cnil-sur-lutilisation-dun-systeme-dia-generative)

**RGPD-05 — MVP.** Disposer d’une procédure de violation : détection, confinement, conservation des preuves, qualification par responsable désigné, évaluation des personnes concernées et notifications requises dans les délais applicables. La procédure, les contacts et le registre d’incidents sont testés avant ouverture ; l’assistant ne décide pas seul de l’absence de risque.

## 21 Recette migration et conditions de mise en service

### 21.1 Phase zéro obligatoire sur Odoo Online

**POC-01.** Avant développement des automatismes financiers, utiliser une base de test autorisée et neutraliser les envois externes. Relever version, abonnement, applications, modèles, champs, méthodes, droits et quotas observés. Démontrer authentification et rotation, création de tiers, référence stable, brouillon, pièce jointe, validation, analytique, facture fournisseur, paiement partiel et multi-termes, rapprochement, avoir/correction, période fermée, actif, échéancier et isolation par société.

**POC-02.** Simuler réponse perdue, concurrence, changement manuel dans Odoo et reprise après interruption. Vérifier l’état réel par relecture et l’absence d’effet additionnel. Le livrable est un contrat d’intégration avec appels minimaux vérifiés, résultats, limites et solutions de repli. Une fonctionnalité visible dans Odoo n’est pas réputée disponible via API sans démonstration. Une impossibilité de rapprochement ou d’écriture fiable bloque l’automatisation correspondante, pas la restitution fidèle des données.

### 21.2 Matrice financière chiffrée

Les données ci-dessous sont **entièrement fictives**. Les politiques de récupération, amortissement et compensation sont des paramètres de test, à faire valider avant application réelle. L’arithmétique a été contrôlée lors de préparation de ce document ; l’exécution applicative et les écritures sur Odoo restent à tester.

| Test | Données | Résultat attendu |
|---|---|---|
| T-F01 Crédit | Dette 100 000 € ; débit 1 000 € = capital 700 + intérêts 250 + assurance 50 | Dette 99 300 € ; charges 300 € ; trésorerie −1 000 € |
| T-F02 CCA | Achat personnel 120 € classé charge ; remboursement 80 € ; travail gratuit 4 h valorisées fictivement 50 €/h | Charge 120 € ; CCA dû 40 € ; banque −80 € ; 200 € seulement en simulation économique |
| T-F03 Loyer | Terme 900 € ; paiements 400 puis 500 ; trop-perçu 100 remboursé | Reçu après 400 ; quittance unique 900 après solde ; net final encaissé 900 € |
| T-F04 Airbnb | Prestations 1 760 € ; remboursement 110 ; commissions 52,80 ; taxe +48/−48 | Net bancaire 1 597,20 € ; recettes après remboursements 1 650 € ; aucun revenu double |
| T-F05 Charges et vacance | Dépense 1 200 € ; clés 50/30/20 % ; A occupé, B à moitié, C vacant | Parts locataires 600/180/0 € ; propriétaire 420 € ; total 1 200 € |
| T-F06 Arrondi | 100 € à parts égales sur trois lots | 33,34 + 33,33 + 33,33 ; centime résiduel affecté selon règle stable |
| T-F07 VNC | Achat 100 000 € dont terrain 20 000 ; dotation bâtiment 2 000 ; dette 60 000 ; marché 120 000 | VNC 98 000 € ; capitaux propres 38 000 € dans ce seul scénario ; valeur nette de marché 60 000 € avant coûts/fiscalité |
| T-F08 Résultat et banque | Produits 12 000 dont encaissés 10 800 ; charges 4 000 dont payées 3 500 ; intérêts 1 000 ; dotation 2 000 ; investissement payé 5 000 ; capital payé 3 000 ; nouvel emprunt 4 000 ; apport CCA 1 000 | Résultat 5 000 € ; variation bancaire +3 300 € ; avec banque initiale 2 000, finale 5 300 € |
| T-F09 Transfert | A 5 000 €, B 1 000 € ; transfert A→B 1 000 et frais 2 | A 3 998 €, B 2 000 € ; variation consolidée −2 € ; aucun revenu sur transfert |
| T-F10 Dépôt | Dépôt 900 € ; créance distincte de 150 déjà comptabilisée ; retenue autorisée et restitution 750 | Dette dépôt et créance soldées ; aucune deuxième recette de 150 € |
| T-F11 Provisions impayées | Provisions appelées 1 200 €, payées 900 € ; charges récupérables réelles 1 300 € | Régularisation 100 € ; ancien impayé 300 € ; restant total 400 €, pas 700 € |

Pour chaque cas, exécuter depuis le SaaS, vérifier Odoo puis le retour SaaS et les agrégats. Rejouer imports et commandes : variation additionnelle attendue 0,00 €. Vérifier débit/crédit, société, devise, période, référence source et somme des ventilations. Forcer un résultat inconnu : aucune création répétée tant que la première n’est pas résolue.

### 21.3 Tests transversaux

**QA-01 — MVP.** Tests unitaires des calculs de prorata, arrondis, récurrences, changements d’heure, fins de mois et déduplication ; tests d’intégration du connecteur sur environnement réel autorisé ; tests de contrat sur formats importés et API. Les règles juridiques sont testées sur exemples validés, incluant données manquantes et restrictions, sans prétendre que le logiciel valide à lui seul leur interprétation.

**QA-02 — MVP.** Tests de parcours desktop/mobile sur capture, entrée, loyer partiel, régularisation, travaux, sinistre, acquisition et correction Odoo. Tester perte réseau, pièce illisible, fichier hostile, fournisseur indisponible, doublon, deux validations concurrentes, approbation expirée, ancien worker et annulation bancaire. La capture doit être démontrée sur appareils cibles, pas seulement dans un simulateur.

**QA-03 — MVP.** Tests de sécurité de chaque frontière d’organisation, escalade de droits, téléchargement, injection dans email/PDF, exfiltration par recherche, révocation et suppression des embeddings. Tester que l’IA ne peut autoriser un paiement ou contourner une approbation même si le document lui demande explicitement de le faire. Exécuter restauration et reprise d’outbox avec preuves de non-duplication.

### 21.4 Migration initiale

**MIG-01 — MVP.** Inventorier sources, période couverte et fraîcheur : Odoo, tableaux, baux, documents, relevés, crédits, CCA, actifs et exports Airbnb. Un import à blanc produit nombre d’objets, rejets, correspondances proposées et totaux par société. Les historiques sont marqués comme imports ; aucune notification ni relance n’est envoyée lors de la première population.

**MIG-02 — MVP.** Valider les soldes d’ouverture, dettes locataires, dépôts, crédits, CCA, banque et VNC contre Odoo à une date commune. Séparer ce qui est déjà comptabilisé de ce qui doit être créé. Faire un pilote limité et représentatif avant généralisation ; un ensemble de totaux nuls dû à une extraction défaillante bloque le passage. Préserver sauvegardes, identifiants de lots d’import et procédure de retour ; une écriture officielle n’est pas supprimée pour « annuler l’import ».

**MIG-03 — MVP.** Fixer une date de bascule, suspendre l’ancien générateur de loyers, terminer ou inventorier les opérations en vol, contrôler l’absence de double alimentation bancaire et surveiller un cycle complet. Le propriétaire signe le bilan d’écarts ; l’expert-comptable valide les rapprochements financiers. Les anomalies non bloquantes restent attribuées et visibles.

### 21.5 Définition de terminé

La mise en service exige zéro anomalie P0 ouverte : fuite inter-organisation, perte d’original, double effet financier, écriture non autorisée, résultat faux non signalé ou contournement d’une validation. Les scénarios financiers, de reprise et de droits doivent passer ; les écarts de migration doivent être expliqués ; sauvegarde et restauration doivent être démontrées. La documentation comprend procédures quotidiennes, matrice d’autorité, politique IA, mapping Odoo, conservation et exploitation. Une validation écrite du propriétaire et des responsables comptables/juridiques concernés clôt les décisions bloquantes ; un simple écran fonctionnel ne suffit pas.

## 22 Roadmap et couverture des exigences

Les phases sont des lots de capacité avec critères de sortie, pas des estimations calendaires fermes. La charge et le coût seront établis après preuve d’intégration, inventaire des données et validation des parcours.

| Phase | Périmètre livré | Critère de sortie |
|---|---|---|
| Phase 0 — Faisabilité et cadrage | POC-01/02, qualification fiscale, responsabilités, données initiales, mapping analytique, règles de validation et conservation | Écritures et lectures critiques démontrées sur Online ; inconnues bloquantes décidées |
| MVP — Exploitation complète contrôlée | Toutes exigences MVP : patrimoine, contrats, EDL, loyers/charges, maintenance, capture/inbox/timelines, documents, assurances, imports Airbnb, banque, crédits de base, CCA, actifs officiels, acquisition simple, dashboard, assistant conversationnel, IA assistée avec règles d’affectation proposées, sécurité et reprise | Migration réconciliée, cycle locatif complet, recette financière et P0 validées ; validation humaine conservée sur actions sensibles |
| V2 — Intégrations et productivité | PAT-03, LOC-03, EDL-04, CHA-03, TRA-03, CRE-03, IMM-03, ACQ-02, FIN-02, AIR-03 enrichi/AIR-04, MSG-02, CAP-03, MEM-03, UX-05, activation d’IA-06 | Connecteurs contractuellement disponibles ; portails cloisonnés ; simulations vérifiées et nouveaux parcours testés |
| V3 — Autonomie et croissance | Extension graduée IA-04 et niveau C, optimisation des exceptions, supervision multi-SCI, scénarios de portefeuille et capacité au-delà de la charge de référence | Qualité maintenue sur échantillon représentatif, temps humain par lot en baisse, retour immédiat au mode assisté démontré |

Les identifiants de sécurité, synchronisation, modèle, RGPD, qualité, migration et continuité s’appliquent à chaque phase ; ils ne sont pas différés parce que la fonctionnalité visible apparaît plus tard. Les exigences mixtes MVP/V2 conservent leur socle explicite : import Airbnb avant API partenaire, capture manuelle avant connexion de boîte, EDL signé importable avant signature intégrée.

La V3 ne supprime pas la validation des décisions juridiques, fiscales, bancaires ou personnelles sensibles. L’autonomie recherchée vient surtout de données fiables, de règles stables, de répétitions sûres et d’un traitement rapide des exceptions.

## 23 Registre des décisions avant réalisation

| Décision | Responsable proposé | Condition de résolution |
|---|---|---|
| Version Online, plan API, modules et droits | Propriétaire + intégrateur Odoo | Contrat et preuve sur base de test ; accès réel documenté |
| Qualification TVA et facturation électronique | Expert-comptable + propriétaire | Statut par activité et date, circuit de réception/émission applicable |
| Plan comptable, analytique et politique actifs/CCA | Expert-comptable | Comptes, modèles, terrain/composants, traitement frais et justificatifs validés |
| Règles des baux, charges, dépôts, IRL et congés | Propriétaire + conseil compétent | Régimes et territoires des biens, modèles et exceptions documentés |
| Règles touristiques par adresse | Propriétaire + conseil/commune selon besoin | Enregistrement, autorisations, contraintes et dates vérifiés |
| Couverture bancaire et origine des flux | Intégrateur + propriétaire | Indy/Banque Populaire testées, solde d’ouverture et secours import définis |
| Canaux mail/SMS/Airbnb et prestataires | Propriétaire + équipe produit | Accès contractuel, coûts, permissions, formats et solution de repli |
| Hébergement SaaS, région, LLM et sous-traitants | Responsable technique + responsable données | Analyse de risques, contrat, transferts et budget acceptés |
| Politique d’autonomie et plafonds | Propriétaire + expert-comptable | Classes d’actions, critères mesurables et règles de suspension signés |
| Volumétrie, objectifs de service et conservation | Responsable produit + technique + données | Mesures initiales, budget, tests et matrice de conservation approuvés |

Le contexte historique mentionne deux immeubles et une perspective d’acquisitions. Il ne constitue pas un inventaire vérifié des lots, des montants ni des contrats. Les exemples de ce document sont synthétiques et ne décrivent aucune personne, aucun locataire ni aucun bien réel.

## 24 Références et périmètre de vérification

Les sources officielles sont liées au plus près des règles concernées. Consultation documentaire : **19 septembre 2026**. Les pages versionnées Odoo 19 décrivent une capacité documentaire ; elles ne préjugent pas de la version Online effectivement utilisée. Les règles juridiques et fiscales doivent être revérifiées à leur date d’application et selon les caractéristiques réelles de chaque bien.

| Domaine | Références de travail principales |
|---|---|
| Odoo Online et API | [API externe](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html), [administration Online](https://raw.githubusercontent.com/odoo/documentation/19.0/content/administration/odoo_online.rst), [analytique](https://www.odoo.com/documentation/19.0/applications/finance/accounting/reporting/analytic_accounting.html) |
| Finance et actifs | [Prêts Odoo](https://www.odoo.com/documentation/19.0/applications/finance/accounting/bank/loans.html), [PCG 2026](https://www.anc.gouv.fr/files/anc/files/1_Normes_fran%C3%A7aises/Reglements/Recueils/PCG_janvier2026/PCG--1er-janvier-2026.pdf), [BOFiP amortissements](https://bofip.impots.gouv.fr/bofip/4590-PGP.html/identifiant=BOI-BIC-AMT-10-20-20220608) |
| SCI et facturation électronique | [Fiche SCI DGFiP](https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/fiches_reforme/fiche-sci.pdf) |
| Location | [Quittances](https://www.service-public.gouv.fr/particuliers/vosdroits/F35247), [IRL](https://www.service-public.gouv.fr/particuliers/vosdroits/F1311), [charges](https://www.service-public.gouv.fr/particuliers/vosdroits/F947), [dépôt](https://www.service-public.gouv.fr/particuliers/vosdroits/F31269), [états des lieux](https://www.service-public.gouv.fr/particuliers/vosdroits/F31270) |
| Touristique | [Calendriers Airbnb](https://www.airbnb.com/help/article/99), [conditions API Airbnb](https://www.airbnb.com/help/article/3418), [formalités touristiques](https://www.service-public.gouv.fr/particuliers/vosdroits/F2043) |
| Données et IA | [Référentiel CNIL gestion locative](https://www.cnil.fr/sites/default/files/atoms/files/referentiel_relatif_aux_traitements_de_donnees_personnelles_mis_en_oeuvre_dans_le_cadre_de_la_gestion_locative.pdf), [CNIL IA générative](https://www.cnil.fr/fr/les-questions-reponses-de-la-cnil-sur-lutilisation-dun-systeme-dia-generative) |

Le présent document constitue une spécification exploitable pour découper les travaux, construire les contrats d’API, préparer les jeux d’essai et organiser la recette. Il ne prétend ni avoir audité la comptabilité existante, ni avoir testé les connecteurs du propriétaire, ni avoir validé définitivement sa situation juridique ou fiscale.
