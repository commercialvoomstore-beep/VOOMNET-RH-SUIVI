# Voomnet RH — Gestion des Primes Trimestrielles & Contrats

Application web d’aide à la décision RH, **en un seul fichier HTML autonome** : [`index.html`](index.html).
Tailwind CSS, Lucide, PapaParse, SheetJS, la police Inter et la démonstration Voomnet sont intégrés au fichier. Aucun CDN ni serveur applicatif n’est nécessaire pour ouvrir l’application.

## Démarrage

- **Usage direct** : ouvrir `index.html` dans un navigateur récent.
- **Aperçu local** : `npm install` puis `npm start` (port `3000`, configurable via `PORT`).
- **Régénérer le fichier autonome** : `npm run build`.
- **Tests** : `npm test` (moteur de règles) et `npm run test:browser` (nécessite `npm start` dans un autre terminal).

Les sources de travail sont dans `src/`, les données transmises dans `data/`, et le résultat livrable est `index.html`.

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
- Les doublons exacts sont écartés ; les conflits de pointage pour un même matricule/date retiennent la dernière ligne et sont tracés.
- Un code de suivi partagé entre plusieurs collaborateurs n’entraîne pas de suppression des demandes distinctes.

### Démonstration transmise

Le référentiel joint contient **18 collaborateurs**, dont **17 présents dans le pointage**. L’application ne supprime ni n’invente de personne pour atteindre un chiffre annoncé de 17. Wilfried Gadou est présent uniquement dans le référentiel ; son service et ses dates ne sont pas déduits de son email.

Sur la période par défaut septembre–novembre 2026 et avec le contrôle croisé activé : 18 suivis, 8 primes disponibles, 10 non disponibles, 3 échéances ≤ J-30, 5 demandes déclarées et 13 jours « Absent » distincts au pointage.

## Règles métier

### Prime trimestrielle

- Période par défaut : trois derniers mois calendaires. Presets : trois mois glissants, trimestre civil, période personnalisée.
- **Toute demande** dont la `Date de début` **ou** la `Date de demande` tombe dans la fenêtre rend la prime **non disponible**, quels que soient le motif, la justification, le statut RH ou le caractère futur de l’absence.
- Le bouton bascule **Contrôle croisé du pointage** ajoute les jours dont le statut est exactement `Absent` (casse/accents ignorés) comme critère d’annulation.
- Montant de base en FCFA modifiable ; budget = collaborateurs actifs éligibles × montant.
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
- moins de 3 pointages ou moins de 3 durées positives : **sous réserve d’entretien**, quelle que soit la note.

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

- Les fichiers sont lus et calculés dans le navigateur. Au chargement initial, l’application ne fait aucune requête externe.
- Un envoi API ne transmet les données qu’après validation explicite, au prestataire configuré.
- Le `localStorage` n’est pas un coffre-fort chiffré : sur poste partagé, exporter puis effacer les données locales.
- Les fichiers sources ne sont pas conservés après actualisation ; les fiches contractuelles et paramètres oui. La démonstration est réintégrée au HTML.
- Ne jamais committer de jeton GitHub, mot de passe SMTP, secret Graph ou clé privée. Un jeton publié dans une conversation doit être révoqué.

## Développement

- `src/core.js` : moteur pur, parsing, règles, score, templates, exports.
- `src/app.js` : interface, stockage local, imports, campagnes email.
- `src/styles.css` + `tailwind.config.cjs` : design system compilé dans le HTML.
- `scripts/build.mjs` : inline CSS, bibliothèques, police, démonstration et licences dans `index.html`.
- SheetJS est embarqué via la distribution npm `@e965/xlsx` 0.20.3 (miroir communautaire de SheetJS), avec PapaParse 5.5.3, Lucide 0.468.0 et Inter.
- Les tests navigateur utilisent Playwright et un Chromium embarqué via `@sparticuz/chromium` pour éviter tout téléchargement depuis un CDN de navigateurs.

## Déploiement

Déployer `index.html` sur n’importe quel hébergement statique (GitHub Pages, Netlify, Vercel, serveur interne). Pour un usage strictement local, le fichier peut être ouvert directement. Les appels EmailJS/webhook nécessitent une connexion sortante et une configuration CORS/API valide.
