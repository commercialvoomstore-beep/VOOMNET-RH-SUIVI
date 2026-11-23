# Voomnet RH — Gestion des Primes Trimestrielles & Contrats

Application d’aide à la décision pour le suivi des **primes trimestrielles**, des **contrats** et des **alertes RH**. L’interface est livrée en un fichier [`index.html`](index.html), avec Tailwind CSS, Lucide, PapaParse, SheetJS, la police Inter et une démonstration fictive intégrés : aucun CDN n’est requis.

**L’application ne fonctionne pas de manière autonome hors ligne** : l’accès à l’interface nécessite Supabase Auth, les fonctions Netlify, PostgreSQL et une connexion internet. La connexion réelle, la base et les comptes RH doivent être configurés et vérifiés avant utilisation.

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

- **Usage en ligne** : ouvrir le site Netlify configuré, puis se connecter avec un compte RH autorisé. Le fichier `index.html` seul, sans API et connexion, affiche la page de connexion mais ne débloque pas l’application.
- **Aperçu local** : `npm install` puis `npm start` (port `3000`, configurable via `PORT`). Ce serveur statique permet de visualiser la page de connexion, mais ne fournit pas la fonction Netlify ; la connexion réelle ne fonctionnera pas sans environnement Netlify et configuration Supabase.
- **Régénérer le fichier autonome** : `npm run build`.
- **Tests** : `npm test` (moteur de règles) et `npm run test:browser` (nécessite `npm start` dans un autre terminal).

Les sources sont dans `src/`, les fichiers **fictifs** de démonstration dans `data/`, et le fichier HTML généré à la racine. Pour commencer en tant que RH :

1. Créez un compte avec un identifiant numérique, une adresse e-mail réelle et un mot de passe, confirmez votre adresse si Supabase le demande, puis connectez-vous avec cet identifiant et ce mot de passe.
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

- Modèle dynamique avec variables `{Nom}`, `{Matricule}`, `{Service}`, `{Date_Fin_Contrat}`, `{Jours_Restants}`, `{Total_Absences}`, `{Statut_Prime}`, `{Retard_Minutes}`, `{Duree_Moyenne}`, `{Periode}`.
- Aperçu individuel modifiable, bouton `mailto:` prérempli, copie RH configurable.
- Envoi groupé **uniquement après confirmation explicite** des destinataires et du prestataire.
- **EmailJS** : Service ID, Template ID, clé publique. Le modèle doit consommer `to_email`, `cc_email`, `subject`, `message`.
- **Webhook HTTPS** : relais serveur pour Microsoft Graph ou SMTP. Payload JSON documenté dans l’interface. Le jeton Bearer facultatif reste en mémoire de session et n’est jamais écrit dans le stockage ou les exports.
- Microsoft Graph nécessite OAuth côté serveur ; SMTP n’est pas un protocole navigateur. Aucun mot de passe SMTP ni secret Graph ne doit être saisi dans le HTML. Le relais sécurisé n’est pas fourni par ce projet et doit être configuré séparément. Si Outlook est en panne sur le web et l’ordinateur, `mailto:` peut aussi échouer ; une panne du fournisseur peut affecter Graph/SMTP. EmailJS ou un autre relais n’est une solution que s’il est opérationnel et configuré.
- Les motifs médicaux, le score et les recommandations défavorables ne sont pas inclus dans les emails.
- « Accepté par l’API » signifie acceptation de la requête, pas remise confirmée. Aucun renvoi automatique n’est effectué.

## Exports et impression

- **Excel `.xlsx`** : décisions RH, absences confidentielles, pointage, méthode et paramètres.
- **CSV `.csv`** : décisions RH, UTF-8 avec BOM, séparateur `;`, protection contre l’injection de formules.
- **Impression / PDF** : rapport paysage A4 propre, sans motifs médicaux, via la boîte d’impression du navigateur.
- **JSON** : fiches contractuelles et paramètres, sans jeton Bearer.

## Confidentialité et sécurité

- Chaque import validé est transmis à l’API Netlify et enregistré dans une table d’historique distincte par type. Le contenu des lignes normalisées est conservé en JSONB dans ces tables : ce ne sont pas des colonnes PostgreSQL séparées pour chaque champ source. Les fiches et paramètres nécessitent une sauvegarde manuelle.
- L’API vérifie le jeton auprès de Supabase Auth, puis filtre les lectures et écritures par l’UUID du propriétaire. Les tables RH sont inaccessibles aux rôles navigateur Supabase `anon` et `authenticated` grâce aux droits et à RLS ; le rôle serveur a accès aux données de tous les comptes et doit rester secret.
- **Inscription ouverte et accès automatique**, conformément au choix demandé : toute personne pouvant accéder au site peut créer un compte et revendiquer un identifiant RH encore libre. La vérification d’email ne prouve pas l’appartenance à l’équipe RH. Ne pas utiliser ce mode pour des données RH sensibles sans validation du risque et contrôles complémentaires (invitations/approbation ou restriction réseau).
- Le navigateur conserve la session Supabase dans `localStorage`, non chiffré et accessible au JavaScript du site. Protéger contre XSS, utiliser un poste de confiance, se déconnecter et protéger les exports. Une révocation ou déconnexion ne détruit pas les données déjà téléchargées ; l’état de session n’est pas vérifié en continu.
- La fonction de connexion limite les tentatives par identifiant et par IP sur 15 minutes, avec risque de blocage temporaire d’un utilisateur en cas d’abus. Configurer également les limites et protections d’inscription dans Supabase et Netlify : l’API Auth publique Supabase est accessible indépendamment de la fonction. Surveiller et nettoyer les compteurs anciens.
- Les anciens secrets divulgués doivent être révoqués. Le dépôt et les anciens déploiements peuvent conserver des données RH réelles dans leur historique : restreindre l’accès et organiser leur traitement séparément. Ne jamais intégrer données réelles ou secrets dans le HTML/Git.

## Connexion au service RH

L’inscription demande un identifiant RH numérique unique de 1 à 16 chiffres, une **véritable adresse email** et un mot de passe d’au moins 12 caractères. Supabase Auth gère les mots de passe et l’éventuelle confirmation d’email. L’identifiant est enregistré lors de la création et reste stable même si les métadonnées du compte changent. Pour se connecter, saisir l’identifiant et le mot de passe ; l’adresse est retrouvée uniquement côté serveur. Un bouton **Déconnexion** est visible dans la barre supérieure.

Si la confirmation d’email est activée dans Supabase, suivre le lien reçu avant de se connecter. L’application ne dispose pas encore d’une interface de réinitialisation du mot de passe ; prévoir une procédure sécurisée dans Supabase. La création d’un compte ne migre pas les comptes ou données Neon. Aucun compte 1005 ni mot de passe n’est préinstallé.

## Déploiement Netlify + Supabase (configuration manuelle requise)

**La configuration réelle et le fonctionnement de bout en bout ne sont pas confirmés par les tests locaux.** Utiliser un projet Supabase dédié et isolé : le script `004` ajoute un déclencheur qui exige un identifiant RH à chaque inscription Auth. Sauvegarder et vérifier la restauration avant toute modification. Tester avec des données fictives avant utilisation réelle.

### 1. Configurer Supabase Auth

1. Ouvrir [Supabase](https://supabase.com/dashboard) et sélectionner le projet `hibhvszfgldgxzcxhmou`.
2. Dans **Authentication**, activer l’inscription par email et mot de passe. Imposer une longueur minimale de 12 caractères côté Supabase : un appel direct à l’API peut contourner la validation du formulaire.
3. Activer la confirmation d’email et configurer l’envoi des messages. Dans **Authentication → URL Configuration**, définir l’URL HTTPS du site Netlify et autoriser son URL de retour. Vérifier la réception et les protections contre les inscriptions abusives.
4. Cette intégration est prévue pour le fournisseur **email** ; les autres modes d’inscription exigent une adaptation du déclencheur.

La clé `sb_publishable` et l’URL du projet sont publiques et déjà intégrées dans le client et les fonctions ; elles ne donnent pas à elles seules accès aux données protégées et ne remplacent pas RLS. Ne jamais mettre de clé `service_role`, de clé secrète ou de mot de passe dans le code client, Git ou une conversation.

### 2. Créer les tables et protéger les données

Dans le **SQL Editor** du projet dédié, copier et exécuter les fichiers suivants **dans l’ordre** :

1. [`database/001_initial.sql`](database/001_initial.sql)
2. [`database/002_individual_imports.sql`](database/002_individual_imports.sql)
3. [`database/004_supabase.sql`](database/004_supabase.sql)

Le dernier script configure notamment RLS, retire les accès navigateur aux tables RH et installe le déclencheur d’inscription. Vérifier qu’aucune autre politique ou privilège existant ne donne accès aux données RH. **Ne pas exécuter `003_autoriser_utilisateur_rh.sql` pour Supabase** : il concerne Neon Auth.

### 3. Créer le rôle serveur `rh_backend`

Ce rôle PostgreSQL sert **uniquement aux fonctions Netlify**. Il n’est pas le compte RH `1005`. Un administrateur peut vérifier s’il existe dans le SQL Editor :

```sql
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
FROM pg_roles WHERE rolname = 'rh_backend';
```

S’il n’existe pas, le créer avec une session autorisée à créer des rôles :

```sql
CREATE ROLE rh_backend LOGIN NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER;
```

Ne pas relancer `CREATE ROLE` si le rôle existe déjà ; vérifier ses attributs et ses droits. La création ci-dessus ne définit **aucun mot de passe**. Définir ensuite un mot de passe fort et unique avec `psql` sur un ordinateur de confiance : après connexion à la base en tant qu’administrateur, saisir la commande interactive suivante. `psql` demande le mot de passe sans l’afficher et sans l’écrire dans le fichier de commandes :

```text
\password rh_backend
```

Sur Windows, ouvrir PowerShell et lancer `psql --version` pour vérifier que `psql` est disponible. Dans Supabase, **Connect → Direct → Session pooler** fournit les paramètres de connexion administrateur ; ne jamais placer un mot de passe en argument dans PowerShell ou dans l’historique du terminal. Se connecter avec `psql` en demandant le mot de passe de façon interactive et vérifier TLS. Suivre la [documentation Supabase de connexion PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres) si l’outil ou la connexion n’est pas disponible.

**Alternative SQL Editor :** `ALTER ROLE ... PASSWORD` peut définir un mot de passe, mais celui-ci peut rester dans l’historique des requêtes ou dans des journaux. Utiliser de préférence `psql`, ne jamais envoyer la requête remplie dans une conversation et ne pas conserver de secret dans Git. Si un secret a été exposé, le révoquer ou le remplacer.

Enfin, après les scripts `001`, `002` et `004`, exécuter [`database/005_supabase_role_serveur.sql`](database/005_supabase_role_serveur.sql) dans le SQL Editor pour attribuer les droits. Ce rôle ne doit pas être propriétaire ni avoir `BYPASSRLS`. Il a néanmoins accès aux espaces de tous les comptes : conserver ses identifiants uniquement côté serveur et vérifier les filtres d’accès de l’API.

### 4. Préparer `DATABASE_URL` avec le Transaction pooler

L’adresse `https://hibhvszfgldgxzcxhmou.supabase.co` est l’URL **API** du projet, pas une connexion PostgreSQL. L’hôte `db.hibhvszfgldgxzcxhmou.supabase.co:5432` correspond à une connexion directe, pas à l’hôte du pooler.

1. Dans Supabase, cliquer sur **Connect → Direct / Connection string**, puis choisir **Transaction pooler**.
2. Repérer le nom de l’hôte après `@` et avant `:6543`. Pour le projet communiqué, l’hôte indiqué dans la console est `aws-1-eu-west-1.pooler.supabase.com` ; le vérifier dans Supabase avant utilisation.
3. Remplacer l’utilisateur administrateur `postgres.<référence-projet>` de la chaîne par `rh_backend.<référence-projet>` et utiliser le **mot de passe du rôle `rh_backend`**, non celui du compte administrateur PostgreSQL. La valeur aura la forme suivante :

   ```text
   postgresql://rh_backend.hibhvszfgldgxzcxhmou:MOT_DE_PASSE_ENCODE@aws-1-eu-west-1.pooler.supabase.com:6543/postgres
   ```

4. Remplacer `MOT_DE_PASSE_ENCODE` par le vrai mot de passe **uniquement dans Netlify**, sans crochets ni espaces supplémentaires. La chaîne complète est secrète : ne pas l’envoyer par chat, email ou capture d’écran.

Les caractères spéciaux du mot de passe doivent être encodés en pourcentage **dans la partie mot de passe uniquement** : par exemple `@` devient `%40`, `:` devient `%3A`, `/` devient `%2F`, `#` devient `%23` et `%` devient `%25`. Ne pas encoder le reste de l’URL. Utiliser un outil local de confiance pour les autres caractères, jamais un site de conversion en ligne. Vérifier la connexion TLS avec le rôle et le pooler sur un environnement de test ; en cas d’erreur de certificat, ne pas désactiver sa vérification.

### 5. Configurer Netlify et redéployer

Dans **Netlify → votre site → Site configuration → Environment variables**, ajouter ou modifier :

| Clé | Valeur et usage |
|---|---|
| `DATABASE_URL` | Chaîne PostgreSQL complète du rôle `rh_backend` préparée ci-dessus. **Secrète** ; disponible aux Functions côté serveur uniquement. |
| `RH_ALLOWED_ORIGIN` | Origine HTTPS exacte du site Netlify, sans chemin ni `/` final, par exemple `https://votre-site.netlify.app`. |

Pour `DATABASE_URL`, cocher **Contains secret values** si l’option est proposée et vérifier que le scope **Functions** est inclus. Renseigner la valeur dans le contexte **Production**. Si chaque contexte a une valeur distincte, ne pas copier la base de production dans les Deploy Previews ou Branch deploys : utiliser des bases et variables isolées, ou ne pas activer ces déploiements.

Enregistrer les variables puis lancer un nouveau déploiement depuis **Deploys**. `netlify.toml` publie uniquement `public/` et déploie les fonctions `login`, `signup-ready` et `workspace`. Si le projet Supabase change, adapter l’URL et la clé publique dans `src/cloud.js` et `netlify/lib/supabase.mjs`, puis reconstruire.

### 6. Inscrire et tester un compte RH

Une fois la base, les fonctions et Netlify configurés :

1. Ouvrir le site Netlify et choisir **Créer un compte**.
2. Saisir un identifiant numérique unique, par exemple `1005`, une adresse email réelle et un mot de passe personnel d’au moins 12 caractères ; confirmer ce mot de passe.
3. Si Supabase demande une confirmation, ouvrir le message reçu et suivre son lien, puis revenir sur le site.
4. Se connecter avec **l’identifiant numérique et le mot de passe**, puis utiliser le bouton **Déconnexion**. L’utilisateur peut être consulté dans **Supabase → Authentication → Users**.
5. Avec deux comptes de test, vérifier l’isolation, les imports, l’historique, les restaurations, les exports et les emails. Vérifier également RLS via les API Supabase, le refus d’un mauvais mot de passe, les limites de tentatives, Netlify `context.ip` et la connexion TLS. Les tests simulés ne prouvent pas le fonctionnement du service réel.

**Inscription ouverte :** toute personne ayant accès au site peut choisir un identifiant RH libre et créer son espace ; la confirmation d’email ne prouve pas son appartenance au service RH. Évaluer et renforcer ce dispositif avant d’importer des données sensibles. Aucun mot de passe ni compte `1005` n’est fourni par défaut. L’interface ne propose pas encore la réinitialisation du mot de passe : prévoir une procédure sécurisée dans Supabase.

### Données et comptes précédents

Les anciens scripts `003_autoriser_utilisateur_rh.sql`, `scripts/create-rh-user.mjs` et `scripts/admin-auth.mjs` ne servent qu’à l’ancienne intégration Neon ; ils ne créent pas de compte Supabase. Les données Neon et les éventuels comptes existants ne sont ni supprimés ni importés par cette migration. Une reprise exige sauvegarde, vérification de l’identité des propriétaires et migration planifiée. Ne pas recopier de mot de passe dans SQL.

## Dépannage

| Symptôme | Points à vérifier |
|---|---|
| Inscription impossible | Projet Supabase dédié, signup email activé, scripts exécutés dans l’ordre, identifiant RH unique, mot de passe et configuration email. Les erreurs restent génériques. |
| Connexion impossible | Identifiant et mot de passe, confirmation de l’email, état du compte, limites de tentatives et disponibilité Supabase. |
| Service indisponible ou non configuré | `DATABASE_URL`, `RH_ALLOWED_ORIGIN`, déploiement Netlify, connexion TLS et droits du rôle `rh_backend`. `npm start` est un serveur statique sans fonctions. |
| Conflit lors de la sauvegarde | Préserver/exporter les modifications locales, puis actualiser ; l’actualisation remplace l’espace local. |
| Import trop volumineux | La limite est de 4 Mio de JSON par requête, distincte de la limite de 10 Mo par fichier. |
| Déconnexion distante non confirmée | Fermer le navigateur et vérifier la session dans Supabase ; les données locales ont été effacées. |

## Développement

**Prérequis :** Node.js 22.17 ou supérieur dans la série 22, et npm. Pour une installation reproductible et une prévisualisation statique :

```bash
npm ci
npm run build
npm start
```

Le serveur écoute sur le port `3000` par défaut (`PORT` permet de le modifier). Il n’exécute pas la fonction Netlify : il affiche l’écran de connexion, mais ne permet pas de valider une connexion réelle.

| Chemin | Rôle |
|---|---|
| `src/app.html`, `src/styles.css`, `src/app.js` | Interface, styles, imports et stockage local. |
| `src/core.js` | Règles métier, analyse des fichiers, scores et exports. |
| `src/cloud.js` | Inscription et connexion Supabase, actions de l’espace personnel et historique des imports. |
| `database/001_initial.sql` | Schéma PostgreSQL initial. |
| `database/002_individual_imports.sql` | Migration additive pour les espaces individuels et historiques. |
| `database/004_supabase.sql` | Sécurité Supabase, identifiants RH et inscription. |
| `database/005_supabase_role_serveur.sql` | Droits limités du rôle PostgreSQL serveur. |
| `netlify/functions/login.mjs` | Connexion par identifiant et limitation des tentatives. |
| `netlify/functions/workspace.mjs` | API RH, autorisations, sauvegarde versionnée et audit. |
| `netlify.toml` | Commande de build, dossier publié et fonctions Netlify. |
| `scripts/build.mjs` | Génération de `index.html` depuis les sources et les données fictives. |
| `scripts/create-rh-user.mjs`, `scripts/admin-auth.mjs` | Outils historiques pour Neon Auth uniquement ; non utilisés avec Supabase. |
| `tests/` | Tests métier, API et navigateurs. |

### Tests

Lancer le serveur local (`npm start`) dans un premier terminal, puis dans un second :

```bash
npm test                      # règles métier
npm run test:cloud            # API et validation Supabase simulées
npm run test:supabase         # migrations, contrôle RLS et connexion simulée
npm run test:browser          # parcours navigateur et accessibilité
node tests/cloud-browser.mjs  # connexion et API simulées
```

Les tests navigateur utilisent Playwright et le Chromium embarqué `@sparticuz/chromium`. `tests/browser.mjs` accepte `TEST_URL` et `CHROMIUM_PATH` ; ses réponses d’authentification simulées utilisent cependant l’origine `http://127.0.0.1:3000`. `tests/cloud-browser.mjs` attend également le serveur local sur cette adresse. Les tests simulent Supabase Auth, la base et les envois d’emails : ils **ne prouvent pas** qu’une configuration ou un envoi réel fonctionne.

SheetJS est embarqué via la distribution npm `@e965/xlsx` 0.20.3, avec PapaParse 5.5.3, Lucide 0.468.0 et Inter.
