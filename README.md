# Budget

Suivi de budget personnel, **chiffré de bout en bout**, utilisable sur PC, Mac et iPhone :
**https://jab-94.github.io/budget/**

Vos données sont chiffrées **dans le navigateur**, avec le mot de passe du coffre, **avant**
tout envoi. Firebase (Google) ne reçoit qu'un bloc illisible.
Audit de confidentialité : [docs/AUDIT.md](docs/AUDIT.md).

---

## Sécurité

- **Chiffrement** : clé dérivée par PBKDF2-SHA256 (600 000 itérations), chiffrement AES-256-GCM.
  Firebase ne voit qu'un bloc illisible et un en-tête non secret (sel, numéro de révision, date).
- **Deux mots de passe distincts** :
  - celui du **compte**, pour se connecter ; Firebase le connaît ;
  - celui du **coffre**, qui chiffre les données ; il ne quitte jamais l'appareil.
    **Ne prenez pas le même.** Mot de passe du coffre oublié = données perdues.
- **Synchronisation** entre PC, Mac et iPhone. Une modification faite ailleurs n'est jamais
  écrasée : l'app demande de rouvrir le coffre pour récupérer la dernière version.
- **Hors ligne** : une copie chiffrée est gardée sur l'appareil ; les modifications partent au
  retour du réseau. Verrouillage automatique après 15 minutes d'inactivité.
- **Page** : la politique de sécurité (CSP) n'autorise que les trois adresses Firebase
  nécessaires. Aucun CDN, aucune police externe, aucune télémétrie. Les bibliothèques
  (Firebase sans Analytics, pdf.js) sont copiées dans `docs/vendor` et se reconstruisent avec
  `tools/web-vendor/build.sh`.
- **Règles Firestore** (`firestore.rules`) : seul votre compte peut lire ou écrire votre coffre.
- Le code de la page est rechargé depuis GitHub : la sécurité dépend aussi de votre compte
  GitHub (double authentification activée) et de votre compte Google/Firebase.

**iPhone** : ouvrez l'adresse dans Safari, puis Partager › « Sur l'écran d'accueil ».

---

## Fonctions

- **Import** de relevés PDF ou CSV, un ou plusieurs d'un coup, lus dans le navigateur.
  LCL (PDF), Boursobank (PDF), Trade Republic (CSV) reconnus ; autres banques en CSV (vous
  indiquez les colonnes) ou PDF générique. Contrôle des soldes, doublons décochés d'office.
- **Opérations** : recherche (libellé, montant, catégorie, note), filtres, modification
  (date, libellé, montant, note) avec retour possible à l'original, saisie manuelle.
- **Catégorisation par règles** (sans IA) : vos règles (« contient », « commence par »,
  « identique à », « ne contient pas », montant min/max), virements entre vos comptes,
  nature donnée par la banque, puis ~200 enseignes courantes. Type de chaque catégorie
  modifiable : dépense, revenu ou hors budget.
- **Tableau de bord** et **budgets** mensuels par catégorie, avec alertes.
- **Salaire variable** : revenu de référence prudent = le plus petit de (moyenne 6 mois − 20 %)
  et (montant dépassé ~3 mois sur 4).
- **Abonnements** : repérés automatiquement (même commerçant, même montant, au moins 3 mois),
  total mensuel et annuel, résiliation suivie (alerte si encore prélevé), ajout manuel.
- **Suggestions d'économies** : hausses de prix, catégories en hausse, frais bancaires,
  doublons suspects, reste à vivre prévisionnel.
- **Sauvegarde chiffrée** et **export CSV** (en clair : à supprimer après usage).

---

## Pour le développement

```
node --test tests-web/*.test.mjs
```

- `tests-web/crypto.test.mjs` : chiffrement, falsification détectée.
- `tests-web/logic.test.mjs` : montants, dates, catégorisation, revenus, abonnements…
- `tests-web/privacy.test.mjs` : CSP, aucune adresse externe, notre code n'appelle jamais le
  réseau, Firebase sans Analytics, mot de passe du coffre utilisé seulement pour la clé,
  règles Firestore.
- Les faux relevés de test (`tests-web/fixtures/`) sont **inventés** : aucune donnée réelle
  dans ce dépôt public.

Publication : push sur `main` → GitHub Pages republie en ~1 minute. Augmenter
`CACHE_VERSION` dans `docs/service-worker.js` à chaque publication.
