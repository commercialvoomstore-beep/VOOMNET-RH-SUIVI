# Voomnet RH — Gestion des Primes Trimestrielles & Contrats

Application d’aide à la décision pour le suivi des **primes trimestrielles**, des **contrats** et des **alertes RH**. L’interface est livrée en un fichier [`index.html`](index.html), avec Tailwind CSS, Lucide, PapaParse, SheetJS, la police Inter et une démonstration fictive intégrés : aucun CDN n’est requis.

**L’application ne fonctionne pas de manière autonome hors ligne** : l’accès à l’interface nécessite Supabase Auth, l’API de données Supabase, PostgreSQL et une connexion internet. La connexion réelle, la base et les comptes RH doivent être configurés et vérifiés avant utilisation.

### Sommaire

- [Démarrage et utilisation RH](#démarrage)
- [Données d’entrée et démonstration](#données-dentrée)
- [Règles métier](#règles-métier)
- [Emails et exports](#emails-et-alertes)
- [Connexion RH et sécurité](#connexion-au-service-rh)
- [Déploiement Netlify et Supabase](#déploiement-netlify--supabase-configuration-manuelle-requise)
- [Dépannage](#dépannage)
- [Développement et tests](#développement)

## Démarrage

- **Usage en ligne** : ouvrir le site Netlify configuré, puis se connecter avec un compte personnel confirmé. Le fichier `index.html` seul, sans API et connexion, affiche la page de connexion mais ne débloque pas l’application.
- **Aperçu local** : `npm install` puis `npm start` (port `3000`, configurable via `PORT`). Ce serveur statique permet aussi de tester la connexion si Supabase est configuré pour son origine et si la migration est appliquée ; privilégier un projet de test isolé.
- **Régénérer le fichier autonome** : `npm run build`.
- **Tests** : `npm test` (moteur de règles) et `npm run test:browser` (nécessite `npm start` dans un autre terminal).

Les sources sont dans `src/`, les fichiers **fictifs** de démonstration dans `data/`, et le fichier HTML généré à la racine. Pour commencer en tant que RH :

1. Créez un compte avec votre adresse e-mail et un mot de passe, confirmez votre adresse si Supabase le demande, puis connectez-vous avec cette adresse et ce mot de passe.
2. Dans **Données & imports**, importez les absences, le pointage et, si disponible, le référentiel des collaborateurs. Chaque import réussi est enregistré automatiquement dans votre espace personnel. Le bouton de démonstration charge uniquement des données fictives.
3. Vérifiez les dates, les anomalies, le périmètre actif, les décisions de prime et les contrats ; configurez les alertes si nécessaire.
4. Depuis **Espace RH en ligne**, sauvegardez séparément les fiches et paramètres. Consultez **Historique des imports** pour rétablir une version précédente. L’actualisation charge la version enregistrée et remplace les modifications locales non sauvegardées.
5. Exportez les résultats nécessaires et déconnectez-vous, surtout sur un poste partagé. Les imports restent en base ; les fiches et paramètres non sauvegardés peuvent être perdus.

## Données d’entrée

| Zone d’import | Fichier attendu | Fichier transmis reconnu |
|---|---|---|
| Absences déclarées | `Absence.csv` | `LISTES-PERMISSIONS.csv` |
| Pointage | `Voomnet-Pointage.csv` | `LISTES-POINTAGES.csv` |
| Référentiel contrats / emails | complément optionnel | `LISTES-EMPLOYEES.csv` |

- CSV à séparateur `;` (détection de secours `,` et tabulation), **UTF-8** et **Windows-1252 / ISO-8859-1**, avec ou sans BOM.
- Classeurs **XLSX / XLS** via SheetJS.
- Jointure stricte par matricule : `Matricule 3CX = Matricule = Numéro 3CX`.
- Normalisation de casse/accents pour la recherche et l’affichage, sans fusion approximative par nom.
- Limites de protection : 10 Mo par fichier, 50 000 lignes, 100 colonnes ; chaque requête à la base est limitée à 4 Mio de JSON traité. Un fichier de moins de 10 Mo peut donc être refusé si les données transformées dépassent cette limite. Un import refusé ne remplace pas la version active.
- Les en-têtes manquants, guillemets CSV invalides et lignes sans matricule/date exploitable sont signalés ; un import échoué ne remplace pas les données précédentes.
- Le fichier de référentiel est facultatif pour démarrer ; il enrichit les fiches avec contrat et email. Les colonnes du référentiel listées ci-dessous, sauf `Contact`, sont attendues si ce fichier est importé.
- Les doublons exacts sont écartés ; les conflits de pointage pour un même matricule/date retiennent la dernière ligne et sont tracés.
- Un code de suivi partagé entre plusieurs collaborateurs n’entraîne pas de suppression des demandes distinctes.

### Colonnes des fichiers

Les modèles vierges sont téléchargeables depuis **Données & imports**. Les noms de fichiers peuvent varier : la reconnaissance utilise les en-têtes.

**Absences** :

```text
Code suivi unique;Matricule 3CX;Demandeur;Type d'absence;Motif détaillé;Date de début;Date de fin;Durée (jours ouvrés);Justifiée;Statut RH;Date de demande;Remarque administrative RH
```

**Pointage** :

```text
Date;Matricule;Nom;Service;Statut;Arrivée;Départ;Retard (min);Durée (min)
```

**Référentiel collaborateurs** :

```text
Utilisateur;Numéro 3CX;Email;Poste;Poste occupé;Status contrat;DEBUT CONTRAT;FIN CONTRAT;Contact
```

Les dates sont notamment acceptées au format `JJ/MM/AAAA` ou `AAAA-MM-JJ`. Une valeur reconnue comme indéterminée est possible pour une fin de contrat CDI.

### Démonstration fictive

Le référentiel fictif contient **18 collaborateurs de démonstration**, dont **17 présents dans le pointage**. Ces noms, données et adresses sont artificiels. Collaborateur Démo 9001 est présent uniquement dans le référentiel ; son service et ses dates ne sont pas déduits de son email.

Par exemple, pour une date du jour fixée au **12 novembre 2026**, la période par défaut est septembre–novembre 2026. Avec le contrôle croisé activé : 18 suivis, 8 primes disponibles, 10 non disponibles, 3 échéances ≤ J-30, 5 demandes déclarées et 13 jours « Absent » distincts au pointage.

## Règles métier

### Prime trimestrielle

- Période par défaut : trois derniers mois calendaires. Presets : trois mois glissants, trimestre civil, période personnalisée.
- **Toute demande** dont la `Date de début` **ou** la `Date de demande` tombe dans la fenêtre rend la prime **non disponible**, quels que soient le motif, la justification, le statut RH ou le caractère futur de l’absence.
- Le bouton bascule **Contrôle croisé du pointage** ajoute les jours dont le statut est exactement `Absent` (casse/accents ignorés) comme critère d’annulation.
- Montant de base modifiable (50 000 FCFA par défaut) ; budget = collaborateurs actifs éligibles × montant. Le contrôle croisé est activé par défaut et peut être désactivé.
- Une absence de pointage ne vaut pas absence de travail et ne bloque pas la prime à elle seule.

### Contrats et aide à la décision

- Champs éditables par matricule : type (`CDD`, `CDI`, `Stage`, `Essai`), début, fin, email professionnel, inclusion dans le périmètre actif.
- Sauvegarde locale `localStorage`, sauvegarde en ligne manuelle des fiches et paramètres, export/import JSON, valeurs source rétablissables.
- Jours restants calculés par rapport à la date du jour : rouge ≤ 15 jours ou échu, orange 16–30, vert > 30. CDI sans échéance et dates manquantes ont des statuts neutres explicites.
- Seuil d’alerte configurable : J-15, J-30, J-45 ou J-60.
- Les fichiers ne fournissent pas de statut d’activité fiable : tous les collaborateurs sont inclus par défaut dans le périmètre actif, à confirmer par le RH.

### Score d’assiduité indicatif

```
100
− min(24, demandes × 6)
− min(35, jours absents distincts × 7)
− min(24, arrondi(minutes de retard × 0,08))
− pénalité de durée moyenne < 480 min (max 12, seulement si ≥ 3 durées positives)
```

Résultat borné entre 0 et 100. Les durées vides ne sont jamais comptées comme zéro. Les motifs sont consultables par le RH mais **ne pondèrent pas le score**.

- ≥ 85 : renouvellement favorable ;
- 60–84 : sous réserve d’entretien ;
- < 60 : non-renouvellement recommandé ;
- moins de 3 pointages ou moins de 3 durées positives : **sous réserve d’entretien**, quelle que soit la note ; sans pointage, le score n’est pas évaluable.

Ces seuils sont des conventions d’aide à la décision, pas des règles légales. Toute décision finale nécessite un examen humain et contradictoire.

## Emails et alertes

- Deux campagnes manuelles : **fins de contrat** et **primes disponibles**, chacune avec son modèle modifiable et un aperçu individuel. La prime est annoncée sous réserve de validation RH. Les imports d’absences et, si le contrôle croisé est actif, de pointage sont nécessaires avant un envoi de primes. Leur présence ne garantit pas leur exhaustivité : vérifiez la période, les données et les destinataires.
- Avant chaque envoi, le RH sélectionne les destinataires et confirme explicitement. La copie RH est préremplie avec `manager@voomnettechnology.ci` ; elle reste modifiable ou supprimable dans les paramètres. Les adresses personnalisées existantes sont conservées ; une ancienne valeur vide sans marqueur de choix est initialisée à cette adresse. Vérifier la copie affichée avant confirmation : elle reçoit le même message et ses éventuelles données d’assiduité. Le canal Outlook ajoute une copie individuelle à l’adresse RH configurée et, si elle est renseignée, envoie également un récapitulatif séparé des nombres de requêtes acceptées et non confirmées. Aucun récapitulatif n’est lancé après une interruption. Les canaux EmailJS et webhook conservent leur fonctionnement antérieur : pas de récapitulatif séparé automatique.
- Les messages Outlook disposent d’une présentation HTML Voomnet avec le logo intégré au message (pièce jointe inline CID) ; le texte édité est échappé et peut être vérifié dans l’aperçu. Le rendu varie selon la messagerie. `mailto:` reste en texte brut ; pour EmailJS, le modèle doit utiliser la variable HTML `message_html` (dans le contenu HTML, avec la syntaxe non échappée `{{{message_html}}}`) afin d’afficher cette présentation. Pour EmailJS et les webhooks, le logo est chargé depuis `https://rh-suivi.netlify.app/voomnet-logo.png` : certains clients bloquent les images externes et affichent alors le texte alternatif. Un webhook externe reçoit `text` et `html` et doit choisir d’envoyer le HTML. Les modèles et textes déjà personnalisés sont conservés.
- Les variables disponibles sont `{Nom}`, `{Matricule}`, `{Service}`, `{Date_Fin_Contrat}`, `{Jours_Restants}`, `{Total_Absences}`, `{Statut_Prime}`, `{Retard_Minutes}`, `{Duree_Moyenne}`, `{Periode}`. Le modèle de contrat par défaut inclut un bilan d’assiduité : relisez et adaptez-le. Les motifs médicaux, le score et les recommandations défavorables ne sont pas ajoutés par les variables fournies.
- « Accepté par l’API » ne prouve pas la remise. Après un délai ou une interruption, un message peut avoir été envoyé : vérifier les éléments envoyés Outlook avant toute nouvelle tentative. Aucun renvoi ni dédoublonnage automatique n’est effectué ; l’historique des résultats est limité à la session.
- **Aucun envoi planifié n’est activé**. Cette version ne permet pas l’envoi automatique en l’absence du navigateur ; les calendriers, le stockage sécurisé et la prévention des doublons nécessitent un développement et une validation supplémentaires.
- **EmailJS** reste disponible avec Service ID, Template ID et clé publique. Le modèle doit consommer `to_email`, `cc_email`, `subject`, `message`. Le **webhook HTTPS externe** reste disponible avec son propre relais ; son jeton facultatif n’est conservé qu’en mémoire de session. `mailto:` ouvre un message à valider dans une messagerie.

### Configuration du relais Outlook / Microsoft 365

Le relais Netlify prend en charge les **comptes Microsoft personnels** et les **comptes professionnels Microsoft 365** via la permission déléguée `Mail.Send` : il utilise la boîte du compte connecté, pas une boîte commune partagée ou un envoi au nom d’une autre personne. Une boîte partagée nécessite une adaptation. Le site ne demande pas de mot de passe Outlook. La connexion utilise MSAL dans le navigateur et un jeton Microsoft éphémère envoyé au relais pour chaque message ; ce jeton donne le pouvoir d’envoyer des emails depuis la boîte connectée et reste sensible même s’il n’est pas un mot de passe. Il n’est pas écrit dans la base ni dans les paramètres ; une fermeture ou une déconnexion exige de reconnecter Outlook. Les jetons restent exposés au JavaScript du site : utiliser un poste de confiance et protéger contre XSS.

1. Dans [Microsoft Entra / App registrations](https://entra.microsoft.com/), créer ou utiliser une application dont les comptes autorisés correspondent à la boîte choisie. Pour une boîte professionnelle de votre entreprise, **Supported accounts → Accounts in this organizational directory only** limite les connexions à cet annuaire ; choisir une option plus large incluant les comptes personnels seulement si nécessaire. Changer ce réglage peut empêcher la connexion d’autres utilisateurs déjà autorisés : vérifier les usages existants. Pour les comptes personnels, Microsoft exige `api.requestedAccessTokenVersion: 2` dans le manifeste. L’accès à l’enregistrement peut nécessiter des droits Microsoft adaptés. Dans **Overview**, noter l’**Application (client) ID** et, pour Microsoft 365 professionnel, le **Directory (tenant) ID**. Ces identifiants sont publics ; ne pas créer ni saisir de secret client pour ce flux navigateur.
2. Dans **Authentication**, ajouter la plateforme **Single-page application** (pas Web) avec l’URI de redirection exacte `https://rh-suivi.netlify.app/outlook-callback.html` ou l’URL correspondante de votre site. Autoriser les fenêtres pop-up côté navigateur. Dans **API permissions → Microsoft Graph → Delegated permissions**, ajouter **Mail.Send**, puis accepter le consentement lors de la connexion ; en entreprise, la politique du tenant peut nécessiter l’intervention d’un administrateur. Cette permission permet d’envoyer au nom du compte connecté ; ne pas accorder de permission d’application générale. Voir la [documentation Microsoft](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).
3. Dans **Netlify → Site configuration → Environment variables**, définir `RH_ALLOWED_ORIGIN` sur l’origine HTTPS exacte, par exemple `https://rh-suivi.netlify.app` sans slash final, pour le contexte Production et les Functions, puis redéployer. Le build publie `outlook-callback.html` et la fonction `outlook-send`. Les prévisualisations utilisent une origine différente : configurez-les séparément avec un projet de test et une URI de redirection correspondante, ou laissez le relais désactivé. Aucune clé service-role ou mot de passe Microsoft n’est nécessaire.
4. Dans **Paramètres → Connexion d’envoi**, Outlook professionnel est préconfiguré avec les identifiants publics Voomnet. Les anciennes configurations vides sont initialisées, mais les prestataires et identifiants déjà configurés restent inchangés ; ils peuvent toujours être modifiés et enregistrés. Cliquer **Connecter Outlook**, choisir la boîte professionnelle d’envoi et accepter les autorisations sur le site Microsoft. Vérifier l’adresse affichée : elle détermine l’expéditeur. L’adresse du compte et sa connexion ne sont pas figées ; la connexion Outlook est temporaire et doit être renouvelée après fermeture ou déconnexion. Enregistrer l’adresse RH dans les règles et sauvegarder les paramètres via **Espace RH en ligne** si nécessaire.
5. Pour un essai, utiliser des données fictives et un destinataire vous appartenant. Vérifier aperçu, adresse, copie RH et récapitulatif avant toute campagne réelle. Activer aussi des protections et limites d’usage côté Netlify et Microsoft ; le relais ne fournit pas de quota distribué ni d’idempotence. La validation du jeton Supabase et l’accès à l’espace actif sont vérifiés à chaque requête, puis Microsoft vérifie son propre jeton. La sélection des primes est une protection de l’interface, pas une règle imposée par le relais : une personne possédant ses jetons valides peut appeler le relais pour envoyer un message au nom de sa propre boîte.

Si le relais n’est pas configuré ou si Outlook est indisponible, aucun envoi réel n’est garanti. Le serveur `npm start` est statique et **n’exécute pas** les fonctions Netlify. Les tests automatiques simulent Microsoft : ils ne prouvent pas le consentement, la connexion réelle ou la remise des emails.

## Exports et impression

- **Excel `.xlsx`** : décisions RH, absences confidentielles, pointage, méthode et paramètres.
- **CSV `.csv`** : décisions RH, UTF-8 avec BOM, séparateur `;`, protection contre l’injection de formules.
- **Impression / PDF** : rapport paysage A4 propre, sans motifs médicaux, via la boîte d’impression du navigateur.
- **JSON** : fiches contractuelles et paramètres, sans jeton Bearer.

## Confidentialité et sécurité

- Chaque import validé est transmis à l’API de données Supabase et enregistré en JSONB dans une table d’historique par type ; les fiches et paramètres nécessitent une sauvegarde manuelle.
- Les tables RH ne sont pas directement accessibles aux rôles `anon` et `authenticated`. La fonction SQL `voomnet_workspace`, exécutée avec des privilèges élevés, identifie le propriétaire par `auth.uid()` issu du jeton validé par Supabase ; chaque opération est filtrée par cet UUID. Elle vérifie aussi le statut actif, la version et la forme des données. Vérifier qu’aucune autre politique, privilège ou fonction ne donne accès aux tables, notamment si le projet n’est pas vierge.
- **Inscription ouverte et accès automatique** : toute personne peut créer son espace. La confirmation d’email ne prouve pas l’appartenance au service RH. Ne pas utiliser avec des données sensibles sans évaluer ce risque et mettre en place les contrôles complémentaires appropriés.
- La session est conservée dans `localStorage`, accessible au JavaScript du site. Protéger le site contre XSS, utiliser un poste de confiance, se déconnecter et protéger les exports. Une révocation ne détruit pas les données déjà téléchargées ; l’état de session n’est pas vérifié en continu.
- Configurer les limites et protections de Supabase Auth : l’API Auth publique est accessible directement, sans les anciennes limites par identifiant de la fonction Netlify. Les anciens secrets divulgués doivent être révoqués ou renouvelés ; l’ancien mot de passe `rh_backend` partagé dans la conversation doit être remplacé. Le dépôt et les anciens déploiements peuvent conserver des données RH dans leur historique : organiser leur traitement séparément.

## Connexion au service RH

Inscrivez-vous avec une adresse e-mail réelle et un mot de passe d’au moins 12 caractères. Suivez le lien de confirmation si nécessaire, puis connectez-vous avec **la même adresse e-mail et le mot de passe**. Le lien **Mot de passe oublié ?** envoie un lien de réinitialisation ; choisissez ensuite un nouveau mot de passe. L’adresse du compte RH connecté est affichée en haut de l’application ; le bouton **Déconnexion** est dans la barre supérieure. Cet affichage ne crée pas d’historique des connexions et ne représente pas la boîte Outlook éventuellement connectée. Aucun mot de passe ni compte n’est préinstallé.

Les comptes Supabase existants gardent leur UUID et leur espace : utilisez leur adresse e-mail existante, pas l’ancien identifiant numérique. En cas de mot de passe oublié, utilisez la réinitialisation. Ne créez pas un nouveau compte pour récupérer un ancien espace : un nouveau compte a un nouvel UUID.

## Déploiement Netlify + Supabase (configuration manuelle requise)

**Cette mise à jour ne configure pas votre projet distant.** Sauvegarder la base et tester la restauration puis essayer sur un projet de test dédié avec des données fictives avant production. Les tests locaux simulent Supabase : ils ne prouvent ni la configuration réelle, ni la livraison des emails, ni les permissions ou limites du service hébergé.

### 1. Configurer Supabase

1. Dans le projet Supabase dédié, activer l’inscription par e-mail et mot de passe, la confirmation d’e-mail et l’envoi des messages ; configurer SMTP si nécessaire pour les usages réels. Imposer un minimum de 12 caractères côté Supabase : le navigateur ne suffit pas. Activer des limites adaptées contre les abus et désactiver les fournisseurs Auth inutilisés, y compris les connexions anonymes.
2. Dans **Authentication → URL Configuration**, définir la Site URL HTTPS de production et autoriser les URLs de redirection du site, y compris `https://rh-suivi.netlify.app/` et `https://rh-suivi.netlify.app/?recovery=1` (ou celles de votre site). Adapter aussi les URLs des environnements de test séparés. Vérifier les modèles d’email et la réception réelle des liens de confirmation et de réinitialisation.
3. La Data API doit être activée et exposer le schéma `public` pour la fonction `voomnet_workspace`. La clé publishable et l’URL déjà présentes dans `src/cloud.js` sont publiques. Ne jamais intégrer la clé secrète/service-role ou un mot de passe dans le client, Git ou le chat. Pour un autre projet, modifier l’URL et la clé publishable dans `src/cloud.js`, puis reconstruire.

### 2. Migrer la base et déployer

1. Prévoir une interruption du service, sauvegarder et vérifier la restauration. **Ne pas recréer les utilisateurs Supabase.** Le script conserve les UUID, données, historiques et statut `active` existants ; il ne migre pas les comptes ni données Neon. Les espaces restent associés à leur UUID d’origine.
2. Dans le SQL Editor du projet dédié, exécuter [`database/006_supabase_email.sql`](database/006_supabase_email.sql) en entier. Ce script transactionnel et relançable crée les tables manquantes, retire le trigger `voomnet_rh_on_signup` qui exigeait un identifiant RH, retire les droits de l’ancien rôle serveur sur les tables RH et crée la fonction sécurisée. Les anciennes tables d’identifiants sont conservées sans être utilisées. Vérifier les éventuels privilèges et politiques ajoutés hors de ces migrations. **Ne pas réexécuter `004` ou `005` après `006`** : ils réinstalleraient l’ancien mécanisme ou ses droits.
3. Déployer cette version sur Netlify immédiatement après la migration. L’ancien site ne pourra plus accéder aux espaces dès la révocation des droits de `rh_backend` ; la nouvelle version ne fonctionnera pas correctement tant que `006` n’est pas appliqué. En cas d’échec, arrêter le basculement et utiliser la sauvegarde et le plan de retour testés ; ne pas supprimer ou recréer les utilisateurs.
4. `DATABASE_URL`, le rôle `rh_backend` et les anciennes fonctions Netlify RH ne sont plus requis. Le nouveau relais Outlook utilise `RH_ALLOWED_ORIGIN` comme expliqué ci-dessus. La migration retire les droits connus de ce rôle mais ne le supprime pas, ni ne révoque son mot de passe ou ses autres droits éventuels. Un administrateur doit examiner et révoquer/renouveler séparément le secret exposé et les autres accès, puis retirer les variables devenues inutiles après vérification.
5. Vérifier avec deux comptes de test : inscription, réception et confirmation d’email, mauvais mot de passe, récupération, déconnexion, imports des trois types, historique et restauration, conflits de version, exports, emails et isolation croisée (y compris accès direct à la Data API). Tester aussi un ancien compte et ses imports. L’accès refusé à un compte `active = false` reste refusé ; ne pas le réactiver implicitement.

### Données précédentes

`001`, `002`, `004`, `005` et les scripts Neon restent historiques ; `006` suffit pour une installation Supabase vierge ou pour migrer l’installation décrite ci-dessus. Une migration depuis Neon nécessite une reprise séparée avec vérification des propriétaires. Le script ne purge aucune donnée distante ni ancien historique Git.

## Dépannage

| Symptôme | Points à vérifier |
|---|---|
| Inscription impossible | Supabase Auth activé, confirmation et SMTP, politique de mot de passe, limites et erreurs dans les journaux. L’ancien trigger `voomnet_rh_on_signup` doit avoir été retiré par `006`. |
| Connexion impossible | Adresse e-mail du compte existant, mot de passe, confirmation, limites Auth et disponibilité du service. |
| Lien de récupération invalide | Lien expiré ou déjà utilisé, URL de redirection autorisée dans Supabase, configuration email et horloge ; demander un nouveau lien. |
| Service de données indisponible | Migration `006` appliquée, Data API activée et schéma `public` exposé, URL et clé publishable du bon projet ; consulter les journaux Supabase. |
| Compte non autorisé | Vérifier `rh_users.active` pour l’UUID concerné ; la migration ne réactive pas les comptes désactivés. |
| Conflit de sauvegarde | Préserver/exporter les modifications locales, puis actualiser ; l’actualisation remplace l’espace local. |
| Import trop volumineux | Limite de 4 Mio de JSON par requête, distincte des 10 Mo par fichier. |

## Développement

**Prérequis :** Node.js 22.17 ou supérieur dans la série 22, et npm. Pour une installation reproductible et une prévisualisation statique :

```bash
npm ci
npm run build
npm start
```

Le serveur écoute sur le port `3000` par défaut (`PORT` permet de le modifier). La connexion et les données réelles nécessitent un projet Supabase configuré ; utilisez un projet de test séparé.

| Chemin | Rôle |
|---|---|
| `src/app.html`, `src/styles.css`, `src/app.js` | Interface, styles, imports et stockage local. |
| `src/core.js` | Règles métier, analyse des fichiers, scores et exports. |
| `src/cloud.js` | Authentification Supabase et Microsoft, espace personnel et historique. |
| `src/microsoft-auth.mjs` | Validation des identifiants et choix de l’autorité Microsoft. |
| `database/006_supabase_email.sql` | Migration Supabase, protections et fonction d’espace privé. |
| `database/001_initial.sql` à `005_supabase_role_serveur.sql` | Anciennes migrations historiques ; ne pas réappliquer après `006`. |
| `netlify.toml` | Build, publication du site et déploiement des fonctions. |
| `netlify/functions/outlook-send.mjs` | Relais d’envoi manuel Outlook ; validation des sessions et origine. |
| `src/email-design.js` | Gabarit HTML commun, échappement des textes et mise en page des messages. |
| `assets/voomnet-logo.png`, `src/email-logo.cjs` | Logo original publié et copie encodée pour les messages Outlook inline. |
| `outlook-callback.html` | Page de retour OAuth Microsoft pour la fenêtre de connexion. |
| `scripts/build.mjs` | Génération de `index.html` depuis les sources et les données fictives. |
| `scripts/create-rh-user.mjs`, `scripts/admin-auth.mjs` | Outils historiques pour Neon Auth uniquement ; non utilisés avec Supabase. |
| `tests/` | Tests métier, API et navigateurs. |

### Tests

Lancer le serveur local (`npm start`) dans un premier terminal, puis dans un second :

```bash
npm test                      # règles métier
npm run test:cloud            # migration et isolation simulées
npm run test:supabase         # migration et contrôle de sécurité simulés
npm run test:outlook          # relais Outlook, avec services simulés
npm run test:browser          # parcours navigateur et accessibilité
node tests/cloud-browser.mjs  # parcours Auth et Data API simulés
```

Les tests navigateur utilisent Playwright et le Chromium embarqué `@sparticuz/chromium`. `tests/browser.mjs` accepte `TEST_URL` et `CHROMIUM_PATH` ; ses réponses d’authentification simulées utilisent cependant l’origine `http://127.0.0.1:3000`. `tests/cloud-browser.mjs` attend également le serveur local sur cette adresse. Les tests simulent Supabase Auth, la base et les envois d’emails : ils **ne prouvent pas** qu’une configuration ou un envoi réel fonctionne.

SheetJS est embarqué via la distribution npm `@e965/xlsx` 0.20.3, avec PapaParse 5.5.3, Lucide 0.468.0 et Inter.
