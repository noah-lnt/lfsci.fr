# Cadre français — gestion patrimoniale et locative avec Odoo

Recherche documentaire au 19 septembre 2026. Ces notes servent à écrire les exigences du produit, pas à qualifier définitivement la SCI. L'instance retenue est Odoo Online : les traitements comptables doivent être réalisables avec les fonctions et API réellement disponibles sur l'abonnement.

## 1. Fiscalité, comptabilité et facturation électronique

### Takeaway
Le libellé initial « SCI à l'IS non assujettie à la TVA » reste une hypothèse métier à faire confirmer par l'expert-comptable. Absence de TVA facturée, exonération, franchise et absence d'assujettissement sont des situations différentes ; elles ne permettent pas de conclure aux mêmes obligations de facturation électronique.

### Cited Findings
- La fiche SCI DGFiP précise que les SCI exonérées n'ont pas d'obligation d'émission pour les opérations exonérées, mais doivent recevoir les factures électroniques si leur caractère d'assujetti est reconnu ; pour une SCI assujettie, la réception est obligatoire depuis le 1er septembre 2026 via une plateforme agréée. La qualification dépend des circonstances de fait. Certaines locations (stationnement non accessoire, locaux aménagés professionnels, prestations assimilées à l'hôtellerie) peuvent changer l'analyse. — [DGFiP, fiche SCI, janvier 2026](https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/fiches_reforme/fiche-sci.pdf)
- La FAQ DGFiP distingue explicitement l'exonération d'émission des opérations visées aux articles 261 à 261 E et l'obligation de réception des achats professionnels concernés. — [DGFiP, facturation sans TVA](https://www.impots.gouv.fr/professionnel/questions/je-nemets-pas-de-facture-ou-je-facture-sans-tva-suis-je-concerne-par-la)
- Le coût d'une immobilisation produite comprend les matières consommées et les coûts effectivement engagés rattachables à sa production (PCG art. 213-15). L'entretien courant reste une charge ; certains remplacements de composants créent un actif séparé et impliquent la sortie de la VNC du composant remplacé (213-19/20). Les composants aux utilisations différentes peuvent avoir leurs propres plans d'amortissement (214-9). — [ANC, PCG au 1er janvier 2026](https://www.anc.gouv.fr/files/anc/files/1_Normes_fran%C3%A7aises/Reglements/Recueils/PCG_janvier2026/PCG--1er-janvier-2026.pdf)
- Le terrain n'est pas amortissable ; pour un prix global d'immeuble, seule la part construction l'est et la ventilation dépend des circonstances propres au bien. Aucune quote-part forfaitaire universelle de terrain ne doit être imposée. — [BOFiP, éléments amortissables, section S](https://bofip.impots.gouv.fr/bofip/4590-PGP.html/identifiant=BOI-BIC-AMT-10-20-20220608)
- Le compte courant d'associé est un prêt à la société, distinct du capital ; une personne physique peut renoncer à sa rémunération. Convention, taux, intérêts et conditions de déductibilité doivent être distingués. — [Service Public Entreprendre, compte courant d'associé](https://entreprendre.service-public.gouv.fr/vosdroits/F32966)
- La référence publique de conservation des entreprises donne dix ans depuis la clôture pour livres et pièces comptables. — [Service Public Entreprendre, conservation](https://www.service-public.gouv.fr/entreprendre/vosdroits/F10029?profil=tout)

### Inferences
- Exigences proposées : référentiel fiscal daté par entité ET activité ; champs assujettissement, exonération, régime, déductibilité TVA, preuve de validation et date d'effet. Prévoir coûts TTC/non récupérables selon la configuration validée, sans hardcoder zéro TVA pour toute activité future.
- Ne jamais transformer les heures gratuites du propriétaire en facture, charge fiscale ou immobilisation fictive. Les suivre dans une analyse distincte « temps passé / coût économique simulé », sans écriture Odoo. Une éventuelle rémunération réelle relève d'un circuit validé.
- Achats personnels pour la SCI : justificatif, bénéficiaire réel, payeur, affectation et validation avant dette envers l'associé/remboursement ; ce remboursement ne doit pas enregistrer une deuxième charge. Le total dépensé pour travaux ne suffit pas à décider charge versus immobilisation.
- L'échéance de prêt doit distinguer dette remboursée, intérêts, assurance et frais ; les projections ne sont pas les écritures officielles. VNC et amortissements officiels viennent d'Odoo ; valeurs de marché et projections sont des vues du SaaS identifiées comme telles.
- Choisir UNE chaîne de réception des factures électroniques (plateforme agréée → Odoo ou connecteur validé), puis remonter au SaaS avec identifiants communs. Scanner un PDF et l'envoyer par email ne constitue pas à lui seul la réforme.

### Gaps
- Statut réel TVA de la SCI, choix d'immobilisation, frais d'acquisition, durées et composants, politique CCA et conditions para-hôtelières à faire valider avant automatisation ; la recherche n'a pas examiné ses statuts, contrats ni comptes.
- Le délai comptable de dix ans est une base de conception prudente, pas une politique universelle pour tous les documents d'une SCI ; valider une matrice documentaire selon leur nature et les obligations applicables.

## 2. Baux, quittances, charges, sorties et locations touristiques

### Takeaway
Le produit doit porter des règles juridiques versionnées selon le régime de bail, la date, le territoire et les caractéristiques de la société/du logement. Les décisions engageantes sont proposées à validation humaine avec calcul, pièces et règle applicables.

### Cited Findings
- Une quittance atteste le paiement intégral du loyer et des charges ; en cas de paiement partiel, fournir un reçu. — [Service Public, quittance](https://www.service-public.gouv.fr/particuliers/vosdroits/F35247)
- La révision IRL dépend de la clause et de l'indice du bail ; le calcul porte sur le rapport des indices annuels du même trimestre. Des restrictions s'appliquent aux logements F/G et aux dates de signature/renouvellement/reconduction (en métropole depuis le 24 août 2022). La révision tardive n'a pas un effet rétroactif automatique. — [Service Public, révision du loyer](https://www.service-public.gouv.fr/particuliers/vosdroits/F1311)
- En métropole, décence énergétique : exclusion des G à compter de 2025, F à compter de 2028, E à compter de 2034, selon les dates de signature, renouvellement ou reconduction ; calendrier distinct outre-mer. — [Ministère de la Transition écologique, décence et gel des loyers](https://www.ecologie.gouv.fr/politiques-publiques/location-gel-loyers-passoires-energetiques)
- Le forfait de charges ne donne pas lieu à régularisation complémentaire. Les provisions se régularisent annuellement sur dépenses justifiées ; décompte et répartition doivent être communiqués un mois avant, justificatifs disponibles six mois. La récupérabilité dépend de la liste réglementaire. — [Service Public, charges récupérables](https://www.service-public.gouv.fr/particuliers/vosdroits/F947)
- Dépôt maximum usuel : un mois hors charges en location nue, deux en meublé ; interdit en bail mobilité. Restitution selon conformité des états des lieux : un ou deux mois à compter de la remise des clés, retenues justifiées. — [Service Public, dépôt de garantie](https://www.service-public.gouv.fr/particuliers/vosdroits/F31269)
- L'état des lieux doit décrire pièces et équipements, clés, index pertinents, date et parties ; photos possibles et signature des parties. Un état des lieux établi ensemble par propriétaire et locataire n'engendre pas de frais à imputer au locataire. — [Service Public, état des lieux d'entrée](https://www.service-public.gouv.fr/particuliers/vosdroits/F31270)
- La durée du bail nu dépend notamment de la qualité du bailleur : règle générale de trois ans pour personne physique, six pour personne morale. — [Service Public, bail nu](https://www.service-public.gouv.fr/particuliers/vosdroits/F35109/0_0)
- La location touristique implique des règles de commune, de copropriété et parfois de changement d'usage ; une fiche pratique officielle renvoie à la mairie pour les formalités locales. — [Service Public, location touristique](https://www.service-public.gouv.fr/particuliers/vosdroits/F2043)

### Inferences
- Quittance uniquement après règlement intégral confirmé et affectation validée au terme : un virement reçu ou un match IA probable n'est pas une preuve d'acquittement de n'importe quelle période.
- Bloquer une révision automatique si clause, indice, DPE ou règle territoriale manque. Conserver calcul exact, règle datée et historique. Les règles de décence ne doivent jamais déclencher automatiquement l'arrêt des appels de loyer ou l'expulsion.
- Dépôt de garantie, revenus, taxes de séjour et avances ne sont pas interchangeables. Prévoir leurs soldes, mouvements et justificatifs distincts.
- Ne jamais appliquer automatiquement un plafond de résidence principale touristique à un bien de SCI : qualifier l'usage et les règles de la commune. Conserver autorisation, enregistrement, validité, limites éventuelles et statut de contrôle.

### Gaps
- Certaines pages officielles consultées ne sont pas parfaitement alignées sur le déploiement 2026 de l'enregistrement touristique national : l'actualité [évolution 2026](https://www.service-public.gouv.fr/particuliers/actualites/A18880) et la fiche pratique ci-dessus doivent être revalidées avec la commune au moment de l'activation. Ne pas promettre un connecteur national ni coder une procédure unique sans vérifier le service opérationnel.
- Les exceptions de SCI familiale, les congés, baux spéciaux, plafonds locaux et obligations propres à chaque adresse nécessitent qualification juridique ; ne pas présumer le bail de trois ans parce que le gérant est une personne physique.

## 3. RGPD, conservation et IA

### Takeaway
La mémoire IA et les timelines ne justifient pas une conservation illimitée des données personnelles. L'IA doit aider au tri et à la préparation ; les décisions juridiques sensibles sur les locataires restent réellement contrôlées par une personne habilitée.

### Cited Findings
- Le référentiel CNIL prévoit une conservation adaptée à chaque finalité, distingue base active et archive intermédiaire, et propose notamment trois mois en base active pour l'appréciation de solvabilité des candidatures ; les dossiers locataires sont conservés pendant le contrat jusqu'à clôture des comptes, puis selon prescriptions pertinentes. Les transferts hors UE exigent un encadrement. — [CNIL, référentiel gestion locative](https://www.cnil.fr/sites/default/files/atoms/files/referentiel_relatif_aux_traitements_de_donnees_personnelles_mis_en_oeuvre_dans_le_cadre_de_la_gestion_locative.pdf)
- Les justificatifs de candidature et de caution sont limités par le décret de 2015, avec information sur les traitements. — [CNIL, justificatifs de location](https://www.cnil.fr/fr/location-dun-bien-immobilier-quels-justificatifs)
- La CNIL recommande un contrat de sous-traitance pour l'IA externe, une clarification des accès/responsabilités/transferts, une vigilance sur les données transmises, les réutilisations et les résultats produits. — [CNIL, questions-réponses IA générative](https://www.cnil.fr/fr/les-questions-reponses-de-la-cnil-sur-lutilisation-dun-systeme-dia-generative)
- L'article 22 encadre les décisions exclusivement automatisées produisant des effets juridiques ou significatifs. — [CNIL, profilage et décisions automatisées](https://www.cnil.fr/fr/profilage-et-decision-entierement-automatisee)

### Inferences
- Exiger une matrice de conservation validée ; suppression/pseudonymisation propagée aux OCR, miniatures, index, embeddings, caches et exports gérés. Les archives légalement requises sont isolées, à accès restreint et non dans le RAG courant. Les sauvegardes expirent selon une politique bornée et les suppressions sont rejouées après restauration.
- Séparer responsable de traitement (SCI pour la gestion locative) et sous-traitant SaaS selon le contrat réel ; tenir registre, finalités/bases légales, notices, sous-traitants et mécanisme d'exercice des droits.
- Interdire par défaut la réutilisation des données clients pour entraîner les modèles ; minimiser et pseudonymiser les données envoyées aux fournisseurs. Pas de scoring opaque de solvabilité, refus automatique de candidature, congé, sanction ou retenue automatique sur dépôt.
- Une validation humaine doit présenter pièces, motifs et alternative ; le simple clic systématique sur une proposition ne constitue pas une supervision satisfaisante.
- Les instructions contenues dans emails, notes, OCR/PDF et contenu récupéré sont des données non fiables ; elles ne peuvent modifier les permissions ou les validations requises ni commander seules une action externe.

### Gaps
- Une analyse de risques/AIPD est à évaluer selon les traitements et leur échelle réelle. Hébergement européen ne suffit pas, à lui seul, à prouver l'absence de transfert ou la conformité RGPD.
