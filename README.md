# Voomnet RH — Gestion des Primes Trimestrielles & Contrats

Application d’aide à la décision pour le suivi des **primes trimestrielles**, des **contrats** et des **alertes RH**. L’interface est livrée en un fichier [`index.html`](index.html), avec Tailwind CSS, Lucide, PapaParse, SheetJS, la police Inter et une démonstration fictive intégrés : aucun CDN n’est requis.

**L’application ne fonctionne pas de manière autonome hors ligne** : l’accès à l’interface nécessite Neon Auth, la fonction Netlify, PostgreSQL et une connexion internet. La connexion réelle, la base et les comptes RH doivent être configurés et vérifiés avant utilisation.

### Sommaire

- [Démarrage et utilisation RH](#démarrage)
- [Données d’entrée et démonstration](#données-dentrée)
- [Règles métier](#règles-métier)
- [Emails et exports](#emails-et-alertes)
- [Connexion RH et sécurité](#connexion-au-service-rh)
- [Déploiement Netlify et Neon](#déploiement-netlify--neon-configuration-manuelle-requise)
- [Dépannage](#dépannage)
- [Développement et tests](#développement)

## Démarrage

- **Usage en ligne** : ouvrir le site Netlify configuré, puis se connecter avec un compte RH autorisé. Le fichier `index.html` seul, sans API et connexion, affiche la page de connexion mais ne débloque pas l’application.
- **Aperçu local** : `npm install` puis `npm start` (port `3000`, configurable via `PORT`). Ce serveur statique permet de visualiser la page de connexion, mais ne fournit pas la fonction Netlify ; la connexion réelle ne fonctionnera pas sans environnement Netlify et configuration Neon.
- **Régénérer le fichier autonome** : `npm run build`.
- **Tests** : `npm test` (moteur de règles) et `npm run test:browser` (nécessite `npm start` dans un autre terminal).

Les sources sont dans `src/`, les fichiers **fictifs** de démonstration dans `data/`, et le fichier HTML généré à la racine. Pour commencer en tant que RH :

1. Connectez-vous avec votre compte individuel autorisé.
2. Ouvrez **Espace RH en ligne → Charger depuis la base** avant toute sauvegarde. Si la base est vide, l’interface le signale.
3. Dans **Données & imports**, importez les absences, le pointage et, si disponible, le référentiel des collaborateurs. Le bouton de démonstration charge uniquement des données fictives.
4. Vérifiez les dates, les anomalies, le périmètre actif, les décisions de prime et les contrats ; configurez les alertes si nécessaire.
5. Choisissez **Espace RH en ligne → Sauvegarder dans la base** pour partager les données. La sauvegarde n’est **pas automatique**.
6. Exportez les informations nécessaires et déconnectez-vous, surtout sur un poste partagé. La déconnexion efface l’espace local et les modifications non sauvegardées, pas la base partagée.

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
- Limites de protection : 10 Mo par fichier, 50 000 lignes, 100 colonnes.
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
- Sauvegarde `localStorage`, export/import JSON, valeurs source rétablissables.
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
- Microsoft Graph nécessite OAuth côté serveur ; SMTP n’est pas un protocole navigateur. Aucun mot de passe SMTP ni secret Graph ne doit être saisi dans le HTML.
- Les motifs médicaux, le score et les recommandations défavorables ne sont pas inclus dans les emails.
- « Accepté par l’API » signifie acceptation de la requête, pas remise confirmée. Aucun renvoi automatique n’est effectué.

## Exports et impression

- **Excel `.xlsx`** : décisions RH, absences confidentielles, pointage, méthode et paramètres.
- **CSV `.csv`** : décisions RH, UTF-8 avec BOM, séparateur `;`, protection contre l’injection de formules.
- **Impression / PDF** : rapport paysage A4 propre, sans motifs médicaux, via la boîte d’impression du navigateur.
- **JSON** : fiches contractuelles et paramètres, sans jeton Bearer.

## Confidentialité et sécurité

- Les fichiers sont lus et calculés dans le navigateur. Au chargement, Neon Auth est consulté ; si une session existe, la fonction RH vérifie ses droits. Une sauvegarde en ligne explicitement demandée transmet les sources, contrats et paramètres à l’API Netlify puis à Neon.
- Un envoi API ne transmet les données qu’après validation explicite, au prestataire configuré.
- Le `localStorage` n’est pas un coffre-fort chiffré : sur poste partagé, exporter puis effacer les données locales.
- Les fichiers sources locaux ne sont pas conservés après actualisation ; les fiches contractuelles et paramètres le sont. Une sauvegarde partagée explicite est conservée en base. La démonstration fictive est réintégrée au HTML.
- Ne jamais committer de jeton GitHub, mot de passe SMTP, secret Graph ou clé privée. Un jeton publié dans une conversation doit être révoqué.

## Connexion au service RH

La page de connexion s’affiche dès l’ouverture. Aucun compte ou mot de passe par défaut n’est intégré : les comptes individuels doivent être créés dans Neon Auth **et** autorisés dans `rh_users`. Après authentification, l’API vérifie les droits avant d’afficher l’application. Si le compte n’est pas autorisé, son identifiant est affiché pour permettre à l’administrateur de l’activer. Une panne de Neon ou de l’API maintient l’écran de connexion fermé à l’application ; la connexion internet est donc nécessaire, y compris après actualisation.

Depuis **Espace RH en ligne**, l’utilisateur peut ensuite charger/sauvegarder la base ou se déconnecter. La déconnexion efface l’espace local et retourne à l’écran de connexion ; sauvegardez d’abord les modifications importantes. Une session restaurée est revalidée par l’API. Les droits sont également contrôlés côté serveur à chaque lecture et écriture ; un refus ou une session expirée lors d’une opération renvoie à la connexion. Une révocation n’efface pas rétroactivement les données déjà consultées ou exportées, et l’écran ne vérifie pas continuellement une session inactive.

**Limite importante :** la page HTML et son code, ainsi que les données de démonstration fictives, sont des fichiers statiques publics. Le masquage de l’interface dans le navigateur n’est pas une protection serveur du fichier HTML. Les données RH partagées, elles, restent derrière la fonction et sa vérification d’autorisation. Ne jamais embarquer de données confidentielles dans le HTML. Sur poste partagé, le stockage navigateur n’est pas un coffre chiffré : déconnectez-vous et protégez la session du poste.

## Déploiement Netlify + Neon (configuration manuelle requise)

**Attention : cette intégration est préparée dans le dépôt, mais n’est pas configurée ni testée sur un projet Neon réel depuis cet environnement.** Ne pas y stocker de données réelles tant que l’accès, les sauvegardes et la sécurité n’ont pas été vérifiés de bout en bout.

1. Révoquer toute clé S3 ou tout jeton exposé, et ne générer un remplacement que si nécessaire. Le stockage S3 n’est pas utilisé par cette intégration. Ne jamais partager `DATABASE_URL`, mot de passe, clés S3 ou secrets dans la conversation, dans Git ou dans le navigateur.
2. Le dépôt GitHub a déjà contenu des données RH réelles dans `main` et son historique. Les données de démonstration de la **version courante** sont fictives, mais ceci ne supprime ni l’historique, ni les clones, ni les anciens déploiements. Restreindre immédiatement le dépôt et les anciens sites, puis organiser une purge de l’historique et une réponse adaptée à l’exposition avec les responsables concernés.
3. Dans Neon, sélectionner le projet `lingering-hill-77521227` et la bonne branche/base `neondb`. À l’aide de l’éditeur SQL propriétaire, exécuter [`database/001_initial.sql`](database/001_initial.sql). Le script est idempotent et ne crée pas d’utilisateurs. Il crée `rh_users` (liste d’accès explicite), `rh_workspace` (espace partagé versionné), et `rh_audit` (identifiant, action, version, date ; sans contenu RH).
4. Activer Neon Auth et l’authentification email/mot de passe, ainsi que la vérification des adresses. Créer/inviter individuellement les comptes RH par les moyens administratifs de Neon. Ajouter l’origine HTTPS exacte du site Netlify aux domaines/origines de confiance Neon Auth, et vérifier CORS et les cookies inter-sites. L’URL Auth intégrée dans `src/cloud.js` correspond au projet communiqué ; pour une autre branche/projet, la modifier et reconstruire. Les navigateurs bloquant les cookies tiers peuvent empêcher la connexion ; tester dans les navigateurs utilisés par l’équipe.
5. Chaque compte doit aussi être autorisé **explicitement** dans PostgreSQL : après vérification de l’identité auprès de l’administrateur, récupérer son `id` Neon Auth (affiché sur la page de connexion si le compte est authentifié mais non autorisé, ou consultable dans la console Neon), puis exécuter dans l’éditeur SQL :

   ```sql
   INSERT INTO rh_users (user_id, active) VALUES ('ID_UTILISATEUR_NEON_AUTH', true)
   ON CONFLICT (user_id) DO UPDATE SET active = true;
   ```

   Remplacer la valeur par l’identifiant réel, jamais par un email. Un compte créé mais absent/inactif dans `rh_users` reçoit 403. Pour le retirer : `UPDATE rh_users SET active = false WHERE user_id = 'ID_UTILISATEUR_NEON_AUTH';` Ne pas autoriser automatiquement tous les comptes inscrits. Tous les comptes autorisés ont les **mêmes droits** sur l’ensemble des données ; il n’y a pas de rôles distincts ni de cloisonnement par service.
6. Connecter le site Netlify existant au dépôt GitHub et déployer la branche contenant ces changements après leur intégration dans la branche de production. Le fichier `netlify.toml` utilise Node 22, reconstruit `index.html`, publie uniquement `public/` et déploie la fonction `workspace`. Ne pas publier la racine du dépôt. Vérifier les réglages Netlify existants : ils ne doivent pas remplacer cette commande ou ce répertoire par l’ancienne configuration.
7. Dans **Netlify → Site configuration → Environment variables**, configurer pour la fonction serveur (et le contexte de déploiement concerné) :

   | Variable | Valeur |
   |---|---|
   | `DATABASE_URL` | URL PostgreSQL Neon avec TLS, fournie par Neon ; **secrète**, côté serveur uniquement. Utiliser de préférence un rôle applicatif distinct à privilèges minimaux. |
   | `NEON_AUTH_BASE_URL` | `https://ep-orange-unit-b7693tds.neonauth.c-13.us-east-1.aws.neon.tech/neondb/auth` |
   | `NEON_AUTH_JWKS_URL` | `https://ep-orange-unit-b7693tds.neonauth.c-13.us-east-1.aws.neon.tech/neondb/auth/.well-known/jwks.json` |
   | `RH_ALLOWED_ORIGIN` | Origine HTTPS exacte du site, par exemple `https://votre-site.netlify.app`, sans chemin ni slash final. |

   `DATABASE_URL` n’est pas une URL S3. Après modification des variables, redéployer. Pour chaque contexte ou domaine de prévisualisation, configurer explicitement son origine et sa base isolée ; ne pas ouvrir l’accès aux aperçus publics de production.
8. La fonction exige un JWT Neon valide (signature JWKS, émetteur, audience, échéance), puis vérifie `rh_users` dans la base à chaque requête. Lecture et écriture sont journalisées. Un compte non listé ne peut pas accéder à la base même s’il peut se connecter à Neon Auth. Un jeton existant peut rester valable jusqu’à son expiration ; désactiver le compte dans `rh_users` bloque immédiatement l’API.
9. À l’ouverture, se connecter sur la page RH. Dans l’application : **Espace RH en ligne → Charger depuis la base**. Si la base est vide, importer les fichiers réels puis choisir **Sauvegarder dans la base**. La sauvegarde est manuelle, limitée à 4 Mo de JSON par espace partagé, et protège contre les écrasements concurrents par un numéro de version. En cas de conflit, préserver/exporter les modifications locales avant de recharger : le chargement remplace l’espace local. L’export JSON conserve les fiches et paramètres, pas les fichiers sources ; conservez ceux-ci séparément pour pouvoir les réimporter. Déconnexion : l’espace de travail et les paramètres de ce navigateur sont effacés, pas la base ; les modifications non enregistrées sont perdues.
10. Vérifier avec deux comptes fictifs : refus d’un utilisateur non autorisé, chargement/sauvegarde, conflit, déconnexion et restauration ; vérifier aussi chiffrement, rétention, sauvegardes, disponibilité, journal d’accès et conformité applicables aux données RH et médicales. Ne pas considérer un test simulé comme un test réel du service.

### Privilèges recommandés pour le rôle PostgreSQL de l’application

Créer le rôle via les outils Neon sans inscrire son mot de passe dans Git. Avec un propriétaire de base, adapter les noms selon votre configuration, puis attribuer **uniquement** `SELECT` sur `rh_users`, `SELECT, UPDATE` sur `rh_workspace`, `INSERT` sur `rh_audit` et `USAGE` sur la séquence d’identité `rh_audit_id_seq` ; le rôle ne doit pas pouvoir modifier `rh_users`, le schéma, ni les tables Neon Auth. Utiliser ce rôle dans `DATABASE_URL`. Tester ces droits sur une base isolée avant mise en production.

## Dépannage

| Symptôme | Points à vérifier |
|---|---|
| Connexion impossible | Identifiants, service Neon Auth, connexion internet, domaine de confiance, CORS et blocage des cookies tiers. |
| « Compte non autorisé » | Vérifier l’`id` retourné par Neon Auth et l’entrée active dans `rh_users`. Vérifier aussi l’origine autorisée si la réponse est 403. |
| Service RH indisponible ou non configuré | Variables Netlify, redéploiement, URL PostgreSQL/TLS, droits du rôle et exécution du schéma SQL. Le serveur local `npm start` ne fournit pas l’API. |
| Conflit lors de la sauvegarde | Une autre version a été enregistrée. Préserver/exporter les modifications locales, puis recharger avant de sauvegarder ; le rechargement remplace l’espace local. |
| Sauvegarde trop volumineuse | La limite est de 4 Mo pour le JSON de l’espace partagé, distincte de la limite d’import de 10 Mo par fichier. |
| Déconnexion distante non confirmée | Les données locales sont effacées, mais la fin de session distante n’est pas garantie. Fermer le navigateur et contacter l’administrateur. |

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
| `src/cloud.js` | Connexion Neon Auth et actions de l’espace partagé. |
| `database/001_initial.sql` | Schéma PostgreSQL initial. |
| `netlify/functions/workspace.mjs` | API RH, autorisations, sauvegarde versionnée et audit. |
| `netlify.toml` | Commande de build, dossier publié et fonctions Netlify. |
| `scripts/build.mjs` | Génération de `index.html` depuis les sources et les données fictives. |
| `tests/` | Tests métier, API et navigateurs. |

### Tests

Lancer le serveur local (`npm start`) dans un premier terminal, puis dans un second :

```bash
npm test                      # règles métier
npm run test:cloud            # API et vérification JWT, base simulée
npm run test:browser          # parcours navigateur et accessibilité
node tests/cloud-browser.mjs  # connexion et API simulées
```

Les tests navigateur utilisent Playwright et le Chromium embarqué `@sparticuz/chromium`. `tests/browser.mjs` accepte `TEST_URL` et `CHROMIUM_PATH` ; ses réponses d’authentification simulées utilisent cependant l’origine `http://127.0.0.1:3000`. `tests/cloud-browser.mjs` attend également le serveur local sur cette adresse. Les tests simulent Neon Auth, la base et les envois d’emails : ils **ne prouvent pas** qu’une configuration ou un envoi réel fonctionne.

SheetJS est embarqué via la distribution npm `@e965/xlsx` 0.20.3, avec PapaParse 5.5.3, Lucide 0.468.0 et Inter.
