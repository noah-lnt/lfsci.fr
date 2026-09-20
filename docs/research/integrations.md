# Intégrations Odoo Online, Airbnb et messageries

Recherche documentaire vérifiée le 19 septembre 2026. Hébergement Odoo Online fixé par le propriétaire. Les exigences proposées ci-dessous sont des décisions de conception, pas des garanties déjà démontrées sur sa base.

## 1. Comment intégrer Odoo Online sans fragiliser la comptabilité ?

### Takeaway
Odoo Online constitue une contrainte structurante : abonnement autorisant l’API, aucun module Python spécifique, méthodes réellement disponibles à tester sur la base cible. La transaction locale du SaaS et celle d’Odoo ne sont jamais une transaction distribuée unique.

### Cited Findings
- JSON-2 apparaît dans Odoo 19 ; accès commercial à l’API externe sur le plan Custom, pas Standard ni One App Free. Les modèles/champs/méthodes dépendent de chaque base ; sa page `/doc` aide à les vérifier. Authentification par clé API et droits de l’utilisateur ; compte robot dédié recommandé. Chaque appel JSON-2 s’exécute dans sa propre transaction SQL : succès validé, erreur annulée. Plusieurs appels ne constituent pas une transaction unique. La documentation recommande une méthode unique pour les opérations devant être atomiques. — [API officielle](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html).
- Odoo Online ne prend pas en charge les modules spécifiques classiques ni les modules Apps Store. Il permet la duplication de test avec actions externes désactivées par défaut et le téléchargement d’une sauvegarde ; la documentation indique des sauvegardes quotidiennes. — [Source officielle Odoo Online](https://raw.githubusercontent.com/odoo/documentation/19.0/content/administration/odoo_online.rst).
- Nuance : Odoo documente des modules de données XML et des personnalisations Studio, avec logique sandboxée limitée, pour les plateformes interdisant le Python arbitraire. Cela ne constitue pas une autorisation d’installer un addon serveur Python. — [Personnalisations importables](https://raw.githubusercontent.com/odoo/documentation/19.0/content/developer/tutorials/importable_modules.rst).
- Le plan analytique peut rendre une affectation obligatoire ; la distribution répartit les montants en pourcentages et des modèles appliquent automatiquement des règles. — [Analytique](https://www.odoo.com/documentation/19.0/applications/finance/accounting/reporting/analytic_accounting.html).
- Odoo importe les relevés CAMT.053, CSV, XLSX, OFX, QIF et CODA ; rapprochement possible avec les écritures. Les doublons peuvent être identifiés par montant/date/compte ou identifiant fournisseur. Il faut établir le solde d’ouverture. — [Transactions](https://www.odoo.com/documentation/19.0/applications/finance/accounting/bank/transactions.html).
- Une transaction bancaire porte une écriture avec compte d’attente jusqu’au rapprochement. Odoo propose des règles de correspondance et modèles de rapprochement. — [Source officielle rapprochement](https://github.com/odoo/documentation/blob/19.0/content/applications/finance/accounting/bank/reconciliation.rst).
- Les prêts disposent d’échéanciers importés, calculés ou manuels, dont les colonnes minimales sont date, capital et intérêts ; validation et échéances engendrent des écritures et reclassements. Le traitement natif documenté n’établit pas une ventilation autonome de l’assurance emprunteur. — [Prêts](https://www.odoo.com/documentation/19.0/applications/finance/accounting/bank/loans.html).
- Odoo gère fiches d’immobilisation, tableaux d’amortissement, écritures planifiées puis comptabilisées, modifications et sorties d’actifs. — [Immobilisations, source officielle](https://raw.githubusercontent.com/odoo/documentation/19.0/content/applications/finance/accounting/vendor_bills/assets.rst).
- Les écritures sécurisées par chaînage SHA-256 ne sont plus modifiables ; les journaux restreints et l’assistant de sécurisation disposent d’un rapport de contrôle. — [Inaltérabilité](https://raw.githubusercontent.com/odoo/documentation/19.0/content/applications/finance/accounting/reporting/data_inalterability.rst).
- Le code officiel applique des dates de verrouillage, y compris un verrouillage irréversible et des contrôles de cohérence. — [Verrous, code officiel](https://github.com/odoo/odoo/blob/19.0/addons/account/models/company.py).

### Inferences
- **Répartition recommandée** : SaaS maître du patrimoine, contrats, échéances locatives, interventions, documents originaux, inbox et décisions ; Odoo maître du plan comptable, journaux, écritures validées, lettrages/rapprochements officiels, amortissements comptables, clôtures et états légaux. Les soldes/résultats « officiels » du SaaS sont des projections en lecture d’Odoo, datées de leur dernière synchronisation. Les projections futures SaaS sont séparées des écritures réelles.
- **Banque** : choisir un point d’entrée unique, Odoo par défaut, puis reproduire ses transactions dans le SaaS. Un import alternatif dans le SaaS doit passer par le même registre de correspondance et ne jamais redoubler le flux Odoo.
- **Contrôle bancaire** : comparer les soldes à date identique après prise en compte des écritures en transit, des dates de valeur, du solde initial et des rapprochements. Une égalité brute de deux soldes n’établit pas que chaque mouvement a été correctement affecté.
- **Clôture et déclarations** : grand livre, balance et export FEC ne prouvent pas la production ni la télétransmission de la liasse fiscale IS. Prévoir un dossier de clôture et export vers l’expert-comptable ; tout dépôt fiscal automatisé demeure un périmètre séparé à contractualiser et vérifier.
- **Factures et loyers** : SaaS émet une commande métier avec pièces et ventilation ; Odoo conserve le document comptable et son numéro officiel. Ne pas générer simultanément le même appel de loyer par récurrence Odoo et par récurrence SaaS. Une correction Odoo revient dans la vue SaaS et peut invalider un document locatif dérivé.
- **Identifiants** : UUID SaaS immuable ; table de correspondance `(organisation, base Odoo, modèle, id Odoo, UUID SaaS)` ; clé d’opération métier `(organisation, type, objet, période, révision)` ; empreinte de charge utile. Réutilisation d’une clé avec contenu différent = rejet.
- **Commande durable** : transaction SaaS enregistre décision, preuve de validation, commande et outbox ensemble. États `préparée → autorisée → envoyée → confirmée` avec branches `rejetée`, `résultat inconnu`, `conflit`. Un seul consommateur logique par commande/objet et bail de verrouillage avec jeton de clôture préviennent les envois concurrents internes.
- **Résultat réseau inconnu** : ne jamais réémettre aveuglément un `create`, un paiement ou un rapprochement. Rechercher d’abord la référence stable réellement stockée dans un champ Odoo autorisé et interrogeable ; comparer société, tiers, période, devise, montants, empreinte et état. Un résultat identique confirme ; plusieurs résultats ou différence ouvrent une exception. Une recherche vide pendant qu’un appel peut encore s’exécuter ne prouve pas son échec. Suspendre l’opération jusqu’à résolution ou examen humain si le doute subsiste.
- **Limite essentielle** : un champ texte Studio indexé n’est pas automatiquement une contrainte d’unicité. Sans mécanisme atomique de déduplication vérifié côté Odoo, le SaaS ne promet pas une garantie absolue « exactly once ». Il garantit la traçabilité, la prévention locale, la détection et le blocage de reprise dangereuse. Pas d’addon custom proposé sur Odoo Online.
- **Atomicité métier** : chaque étape utilise une méthode standard disponible. Créer un brouillon, ajouter des pièces et valider sont potentiellement plusieurs transactions : piloter une machine à états, lire l’état entre étapes, ne publier aucune quittance avant preuve du paiement officiel. Une erreur se répare par reprise contrôlée ou écriture inverse autorisée, jamais suppression automatique d’une écriture validée.
- **Synchronisation retour** : interrogation incrémentale avec pagination stable `(write_date,id)`, fenêtre de recouvrement, déduplication, curseur avancé uniquement après persistance. Audit périodique complet des objets critiques pour retrouver suppressions et écarts non observables par delta. Webhooks Studio éventuels = accélération après PoC, pas unique mécanisme de livraison. Source d’autorité fixée par champ ; pas de « dernier arrivé gagne » sur les comptes et montants.
- **Prêts** : échéancier contractuel importé dans le SaaS et rapproché de la version Odoo ; distinguer échéance, décaissement et comptabilisation. Assurance et frais explicitement mappés ; ne pas supposer que le modèle natif les déduit.
- **Analytique** : affectation canonique au lot ou aux parties communes, regroupement immeuble/SCI dans les rapports ; clés de ventilation versionnées, date d’effet et justificatif. Éviter de compter deux fois un montant affecté à plusieurs plans analytiques.
- **Recette de faisabilité bloquante avant MVP** : sur une copie de test Online, prouver lecture des modèles/champs, clé d’authentification et rotation ; création d’un tiers et brouillon avec référence stable ; validation ; ventilation analytique ; pièces jointes ; facture fournisseur ; encaissement partiel et multi-loyers ; rapprochement bancaire ; annulation/avoir sans suppression ; immobilisation ; import échéancier ; refus sur période fermée ; changement manuel Odoo ; reprise après réponse perdue ; absence de doublon après relecture ; isolement société. Enregistrer méthodes, droits, payloads minimaux et résultats observés dans le contrat du connecteur. Ne pas recopier des noms de méthodes « de mémoire ».

### Gaps
- Version et release Online effectivement déployées, plan contractuel, modules natifs activés, quota réel, champs et droits du compte robot non inspectés.
- API publique exacte de rapprochement, paiements, immobilisations, prêts et comportement face aux modifications concurrentes à démontrer sur la base réelle ; la documentation fonctionnelle n’est pas une preuve d’accès API.
- Aucun accès établi à une garantie native générale d’idempotence serveur ni de compare-and-swap sur tous les objets. En l’absence de preuve, les opérations ambiguës restent soumises à résolution.
- Couverture bancaire de la banque du propriétaire, périmètre de localisation française et sauvegarde/restauration contractuelle à confirmer pendant le cadrage.

## 2. Quelles intégrations Airbnb peut-on promettre ?

### Takeaway
Prévoir un périmètre minimal fiable avec imports et calendrier ; toute API complète dépend d’un accès partenaire ou d’un channel manager disposant d’un contrat et d’une API adaptés.

### Cited Findings
- Airbnb permet import/export de calendriers iCal pour bloquer les nuits ; les calendriers importés dans Airbnb sont actualisés automatiquement toutes les trois heures. — [Synchronisation calendriers Airbnb](https://www.airbnb.com/help/article/99).
- Les programmes API sont soumis à des conditions spécifiques, accord de confidentialité, accords éventuels, revue de sécurité et implémentation de fonctionnalités obligatoires. — [Conditions API Airbnb](https://www.airbnb.com/help/article/3418).
- Airbnb présente des partenaires logiciels PMS/channel management évalués sur leur sécurité et qualité d’intégration API. — [Programme partenaires](https://news.airbnb.com/announcing-our-2025-preferred-software-partners).

### Inferences
- iCal alimente disponibilité/réservations calendaires ; il ne suffit pas pour les prix, commissions, voyageurs, messages, remboursements, justificatifs et règlements. N’en déduire aucun revenu comptable. Le délai documenté interdit une promesse de prévention instantanée des doubles réservations.
- MVP : import de rapports réservations/règlements et justificatifs, contrôle des montants bruts, commissions, frais, retenues, remboursements et virements groupés ; une réservation n’est pas égale à un paiement. Mapping réservation → lot → règlement plateforme → ligne bancaire → document Odoo.
- V2 : connecteur partenaire/channel manager si contrat, périmètre, sandbox et accès sont obtenus ; sinon maintien explicite du mode import. Aucun scraping ni lecture automatisée non autorisée de la session personnelle Airbnb.

### Gaps
- Aucun accord ni accès API Airbnb fourni ; fonctionnalités réellement accessibles et webhook guarantees inconnus. Le cahier des charges doit inclure une condition de faisabilité, pas vendre cette API comme acquise.

## 3. Comment ingérer emails et SMS sans promesse irréalisable ?

### Takeaway
Le transfert vers une inbox dédiée et le partage/coller mobile sont les socles universels. Les connecteurs enrichissent ces capacités après consentement OAuth ou activation d’un numéro professionnel.

### Cited Findings
- Gmail fournit `watch` via Pub/Sub et `history.list`. Le renouvellement de surveillance est requis au moins tous les sept jours ; Google recommande une fois par jour. Les notifications peuvent être perdues ou retardées ; interrogation périodique prévue. — [Gmail push](https://developers.google.com/workspace/gmail/api/guides/push).
- Un historique Gmail trop ancien produit une erreur 404 nécessitant une nouvelle synchronisation complète. — [Synchronisation Gmail](https://developers.google.com/workspace/gmail/api/guides/sync).
- Graph propose une synchronisation delta des messages par dossier, avec pagination puis conservation d’un deltaLink opaque. — [Microsoft Graph](https://learn.microsoft.com/en-us/graph/delta-query-messages).
- Apple documente un compositeur SMS/MMS avec intervention de l’utilisateur ; l’interface ne garantit pas la livraison. — [MessageUI](https://developer.apple.com/documentation/messageui/mfmessagecomposeviewcontroller).
- Google Play restreint les permissions SMS/journal d’appels ; les usages sont encadrés, en principe réservés aux gestionnaires par défaut, avec exceptions conditionnelles. — [Politique SMS](https://support.google.com/googleplay/android-developer/answer/10208820?hl=en-GB).
- Un fournisseur de numéro professionnel tel que Twilio envoie les messages entrants par webhook avec identifiant `MessageSid`, expéditeur, destinataire, contenu et médias ; validation de signature recommandée via SDK. — [Webhook SMS](https://www.twilio.com/docs/messaging/guides/webhook-request).

### Inferences
- Ne pas promettre la récupération silencieuse de toute la boîte SMS personnelle iPhone/Android, ni de l’historique WhatsApp personnel. Première version : copier/coller, transfert quand disponible, partage de texte/capture, photo ou note. Auto-ingestion SMS : numéro professionnel/API contractuelle, disponibilité française à vérifier.
- OAuth à droits minimaux ; sélection explicite des boîtes/dossiers ; lecture et envoi comme permissions distinctes ; révoquer une connexion arrête les nouveaux accès. Préserver message original, pièces, expéditeur déclaré, Message-ID/identifiant fournisseur, timestamps et canal.
- Inbox : chaque source produit un élément canonique dédupliqué, sans transformer automatiquement un email en preuve comptable ou en instruction. Le message transféré n’authentifie pas nécessairement son auteur initial. Correlation par alias lot, adresse connue, bail actif ; plusieurs correspondances = demande de rattachement.
- Capture : OCR/transcription proposent données et provenance ; une déduction IA n’écrase jamais le fichier original. Recherche et résumés respectent les autorisations de chaque document. Fichiers hostiles scannés et rendus en environnement isolé.
- Communication sortante : file durable, destinataire autorisé et modèle approuvé, trace d’idempotence avant envoi, suivi fournisseur ; état inconnu traité comme tel. Notification reçue ne vaut pas réponse envoyée ni preuve de lecture.

### Gaps
- Fournisseurs mail/SMS du propriétaire, numéro à conserver, accessibilité du partage dans chaque application mobile, consentements et contrats fournisseurs non précisés. Une application web seule ne doit pas être spécifiée comme disposant d’un accès général aux SMS du téléphone.
