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

1. Connectez-vous avec votre identifiant numérique et votre mot de passe ; votre compte doit avoir été créé et autorisé par l’administrateur.
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

- Les calculs sont effectués dans le navigateur. Chaque import validé est transmis automatiquement à l’API Netlify et stocké dans une table propre à son type, avec historique. Les fiches et paramètres sont enregistrés en ligne uniquement sur demande ; ils sont aussi stockés localement.
- Chaque requête est authentifiée et filtrée par l’identifiant Neon du compte : un compte ne voit pas les imports ou fiches des autres. Cette isolation dépend de la sécurité de l’API, de PostgreSQL et de la configuration ; un administrateur de base y a accès.
- Les imports précédents restent en base même lorsqu’on retire la version active. L’historique est paginé par 100. Prévoir sauvegarde, durée de rétention et procédure de suppression conformes aux règles RH.
- Le `localStorage` n’est pas chiffré. Sur un poste partagé, déconnectez-vous et protégez la session du poste ; un export reste accessible là où il a été enregistré. Les données déjà téléchargées ou consultées ne sont pas effacées par une révocation.
- Les fichiers statiques et la démonstration fictive sont publics. Ne jamais intégrer de données réelles ni de secrets dans le HTML ou Git.

## Connexion au service RH

La page de connexion demande un identifiant numérique de 1 à 16 chiffres et un mot de passe. Pour utiliser Neon Auth email/mot de passe sans exposer une adresse à l’utilisateur, le client transforme l’identifiant en alias technique : par exemple `1005` devient `1005@rh-identifiant.invalid`. Il ne s’agit **pas d’une boîte mail**. Le compte correspondant doit être créé explicitement dans Neon Auth et son identifiant interne autorisé dans `rh_users`. Aucun compte 1005 ni mot de passe n’est créé par le code.

L’acceptation de l’alias `.invalid`, les réglages de vérification d’email et la connexion doivent être vérifiés dans le projet Neon réel. La récupération de mot de passe par email ne peut pas fonctionner avec cet alias non distribuable : prévoir une procédure administrative sécurisée de réinitialisation et de remise du mot de passe, ainsi que limitation des tentatives, surveillance et politique de mots de passe adaptées. Ne pas désactiver des protections sans évaluation. Neon Auth reste responsable du contrôle du mot de passe ; l’API ajoute le contrôle d’accès RH.

La session et les droits sont vérifiés au chargement et à chaque opération en ligne, pas en continu pendant l’inactivité. Une panne de Neon ou de l’API empêche l’accès. La déconnexion efface les données locales, mais ne supprime pas les données en base. Les cookies tiers peuvent être bloqués par certains navigateurs ; vérifier les domaines de confiance, CORS et les cookies en conditions réelles.

## Déploiement Netlify + Neon (configuration manuelle requise)

**Préparation non déployée ni testée sur Neon réel.** Ne pas importer de données réelles avant validation de bout en bout et des mesures de sécurité.

1. Révoquer et remplacer les secrets et mots de passe divulgués. Ne jamais communiquer secrets, mots de passe ou `DATABASE_URL` dans le chat ou Git. Les clés S3 ne sont pas utilisées ici.
2. Le dépôt et ses anciens déploiements ont déjà exposé des données RH réelles. Les fichiers courants sont fictifs, mais les anciens commits, clones et déploiements peuvent rester accessibles. Restreindre les accès et organiser une purge avec les responsables concernés.
3. **Sauvegarder et vérifier une restauration avant migration**. Sur une copie ou branche de test Neon, appliquer [`database/001_initial.sql`](database/001_initial.sql), puis [`database/002_individual_imports.sql`](database/002_individual_imports.sql). La migration est additive : elle conserve `rh_workspace` et crée `rh_personal_workspace`, `rh_import_employees`, `rh_import_absences`, `rh_import_pointage`. L’ancien espace partagé n’est **pas** transféré automatiquement : décider avec les responsables quel compte peut recevoir quelles données et migrer ou réimporter explicitement après contrôle. Ne pas supprimer l’ancien espace avant validation et sauvegarde.
4. Activer Neon Auth email/mot de passe. Par un moyen administratif sécurisé, créer chaque compte avec l’alias technique approprié, par exemple `1005@rh-identifiant.invalid`, et un mot de passe distinct non divulgué. Neon documente la [création administrative](https://neon.com/docs/auth/guides/plugins/admin) et la réinitialisation de mot de passe ; tester au préalable les conditions d’acceptation et de vérification de l’alias. Restreindre l’inscription publique si possible ; ne jamais autoriser automatiquement toute inscription. Ajouter l’origine HTTPS exacte du site aux origines de confiance Neon. L’URL Auth est intégrée dans `src/cloud.js` : si le projet change, la modifier et reconstruire.
5. Récupérer l’**identifiant interne** `user.id` de Neon Auth (différent de `1005`) depuis la console ou le message affiché après connexion d’un compte non autorisé. Dans l’éditeur SQL de la base, autoriser explicitement chaque personne :

   ```sql
   INSERT INTO rh_users (user_id, active) VALUES ('ID_INTERNE_NEON_AUTH', true)
   ON CONFLICT (user_id) DO UPDATE SET active = true;
   ```

   Remplacer la valeur par l’identifiant réel vérifié, pas l’alias ni le mot de passe. Pour révoquer l’accès : `UPDATE rh_users SET active = false WHERE user_id = 'ID_INTERNE_NEON_AUTH';`. Les comptes autorisés ont les mêmes fonctionnalités, mais des espaces individuels distincts.
6. Déployer la branche intégrée au site Netlify. `netlify.toml` construit `index.html`, publie seulement `public/` et déploie la fonction `workspace` avec Node 22. Vérifier que les réglages du site ne remplacent pas cette configuration.
7. Dans **Netlify → Site configuration → Environment variables**, définir pour la fonction et le contexte concernés :

   | Variable | Valeur |
   |---|---|
   | `DATABASE_URL` | URL PostgreSQL Neon avec TLS ; secrète, côté serveur uniquement. Utiliser un rôle applicatif à privilèges minimaux. |
   | `NEON_AUTH_BASE_URL` | `https://ep-orange-unit-b7693tds.neonauth.c-13.us-east-1.aws.neon.tech/neondb/auth` |
   | `NEON_AUTH_JWKS_URL` | `https://ep-orange-unit-b7693tds.neonauth.c-13.us-east-1.aws.neon.tech/neondb/auth/.well-known/jwks.json` |
   | `RH_ALLOWED_ORIGIN` | Origine HTTPS exacte du site, sans chemin ni slash final. |

   Redéployer après modification. Utiliser des données et une base isolées pour les prévisualisations, pas la production ouverte à tous.
8. Vérifier sur un environnement de test : connexion 1005, mauvais mot de passe, utilisateur non autorisé, deux comptes isolés, import, historique, restauration, sauvegarde des fiches, conflit, déconnexion et rechargement. Contrôler les JWT réellement émis (signature EdDSA, issuer et audience attendus), CORS et cookies ; les mocks ne prouvent pas la compatibilité du service réel. Vérifier sauvegardes, chiffrement, rétention et conformité RH avant toute production.

### Créer un compte RH avec l’outil local

L’outil s’exécute **sur l’ordinateur de l’administrateur**, dans un terminal interactif ; il ne fait pas partie du site public Netlify et ne crée pas de fonctionnalité d’administration ouverte sur le web. Il n’enregistre aucun mot de passe ou cookie dans un fichier et n’accepte pas de secret en argument ni par redirection. Les secrets et la session sont toutefois présents en mémoire pendant l’opération : utiliser un poste de confiance, protéger les traces système et ne jamais partager ces valeurs. L’outil utilise l’URL Neon Auth du projet intégrée dans `scripts/admin-auth.mjs` ; si le projet ou la branche change, adapter et vérifier l’URL dans le code avant de l’utiliser.

**Prérequis :** Node.js 22 et un compte **Neon Auth** existant, avec email/mot de passe opérationnels et rôle `admin` (ce n’est pas automatiquement le compte de connexion à la console Neon). Dans la console Neon, sur la bonne branche : **Auth → Users → ⋯ → Make admin** sur un compte dont l’identité est vérifiée. Si vous n’avez pas de compte Auth avec mot de passe, créez-le par une procédure Neon adaptée avant de continuer ; cet outil ne contourne pas cette première étape ni une éventuelle authentification supplémentaire. Voir [l’administration Neon](https://neon.com/docs/auth/guides/plugins/admin).

1. Dans le dossier du projet sur votre poste, lancer :

   ```bash
   npm run admin:create-user
   ```

2. Saisir l’identifiant numérique (par exemple `1005`), le nom affiché, l’email du compte **administrateur Neon Auth**, puis son mot de passe. Les mots de passe sont masqués à la saisie. Saisir et confirmer ensuite un **nouveau** mot de passe RH d’au moins 12 caractères, puis confirmer par `OUI`. Ne pas utiliser le mot de passe déjà divulgué.
3. L’outil crée dans Neon Auth un compte de rôle `user` avec l’alias technique `1005@rh-identifiant.invalid`, puis tente de fermer la session administrateur. La création ne donne pas automatiquement accès à l’application.
4. Vérifier le compte dans **Auth → Users**. Copier la commande SQL affichée par l’outil et l’exécuter dans le **SQL Editor de la bonne base** après application des migrations : elle autorise l’identifiant interne Neon dans `rh_users`. Cette étape est volontairement manuelle. Ne pas confondre l’identifiant interne avec `1005`.
5. Remettre le mot de passe à l’utilisateur par un canal sécurisé, puis tester la connexion et les imports avec des données fictives. Vérifier que Netlify, Neon et la base sont configurés comme indiqué ci-dessus.

**Important :** la compatibilité réelle de l’alias `.invalid`, des points d’accès et du cookie Neon n’a pas été vérifiée ici. Si Neon exige une vérification par email, l’alias ne peut pas recevoir le message ; prévoir une procédure administrative sécurisée, sans désactiver de protection sans évaluation. Le mot de passe ne peut pas être réinitialisé par email sur cet alias. En cas d’interruption ou de réponse serveur incertaine, le compte peut avoir été créé : vérifier dans Neon avant de réessayer. Si la déconnexion administrateur n’est pas confirmée, révoquer la session dans Neon. Ne jamais modifier directement les tables internes Neon Auth ni enregistrer un mot de passe dans SQL ou Git.

### Privilèges PostgreSQL recommandés

Avec un propriétaire de base, attribuer au rôle applicatif uniquement `SELECT` sur `rh_users`, `SELECT, INSERT, UPDATE` sur `rh_personal_workspace`, `SELECT, INSERT` sur les trois tables d’import, `INSERT` sur `rh_audit` et `USAGE` sur leurs séquences d’identité. Ne pas donner les droits de modification de `rh_users`, du schéma ou des tables Neon Auth. Créer le rôle et gérer son mot de passe hors Git ; tester les privilèges sur une base isolée.

## Dépannage

| Symptôme | Points à vérifier |
|---|---|
| Connexion impossible | Identifiants, service Neon Auth, connexion internet, domaine de confiance, CORS et blocage des cookies tiers. |
| « Compte non autorisé » | Vérifier l’`id` retourné par Neon Auth et l’entrée active dans `rh_users`. Vérifier aussi l’origine autorisée si la réponse est 403. |
| Service RH indisponible ou non configuré | Variables Netlify, redéploiement, URL PostgreSQL/TLS, droits du rôle et exécution du schéma SQL. Le serveur local `npm start` ne fournit pas l’API. |
| Conflit lors de la sauvegarde | Une autre version a été enregistrée. Préserver/exporter les modifications locales, puis recharger avant de sauvegarder ; le rechargement remplace l’espace local. |
| Sauvegarde trop volumineuse | La limite est de 4 Mio de JSON par requête, distincte de la limite d’import de 10 Mo par fichier. Réduire le fichier traité puis réessayer. |
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
| `src/cloud.js` | Connexion Neon Auth et actions de l’espace personnel et historique des imports. |
| `database/001_initial.sql` | Schéma PostgreSQL initial. |
| `database/002_individual_imports.sql` | Migration additive pour les espaces individuels et historiques. |
| `netlify/functions/workspace.mjs` | API RH, autorisations, sauvegarde versionnée et audit. |
| `netlify.toml` | Commande de build, dossier publié et fonctions Netlify. |
| `scripts/build.mjs` | Génération de `index.html` depuis les sources et les données fictives. |
| `scripts/create-rh-user.mjs`, `scripts/admin-auth.mjs` | Outil local interactif de création RH via Neon Auth. |
| `tests/` | Tests métier, API et navigateurs. |

### Tests

Lancer le serveur local (`npm start`) dans un premier terminal, puis dans un second :

```bash
npm test                      # règles métier
npm run test:cloud            # API et vérification JWT, base simulée
npm run test:admin            # outil de création RH et sécurité, Neon simulé
npm run test:browser          # parcours navigateur et accessibilité
node tests/cloud-browser.mjs  # connexion et API simulées
```

Les tests navigateur utilisent Playwright et le Chromium embarqué `@sparticuz/chromium`. `tests/browser.mjs` accepte `TEST_URL` et `CHROMIUM_PATH` ; ses réponses d’authentification simulées utilisent cependant l’origine `http://127.0.0.1:3000`. `tests/cloud-browser.mjs` attend également le serveur local sur cette adresse. Les tests simulent Neon Auth, la base et les envois d’emails : ils **ne prouvent pas** qu’une configuration ou un envoi réel fonctionne.

SheetJS est embarqué via la distribution npm `@e965/xlsx` 0.20.3, avec PapaParse 5.5.3, Lucide 0.468.0 et Inter.
