# Audit de confidentialité — Budget

> Question : **une donnée bancaire peut-elle sortir de l'appareil en clair ?**
> Réponse : **non.** Seul un coffre chiffré dans le navigateur est envoyé à Firebase.
>
> (Une ancienne version locale en Python, auditée séparément, a été retirée du dépôt
> en novembre 2026 ; son audit reste consultable dans l'historique Git.)

## Analyse

**Ce qui sort de l'appareil** : uniquement le coffre **chiffré dans le navigateur**,
vers Firestore (projet Firebase dédié, région Europe), ainsi que l'e-mail et le
mot de passe du **compte**, qui servent à la connexion. Le mot de passe du **coffre**
ne quitte jamais l'appareil.

| Élément | Analyse |
|---|---|
| Chiffrement | PBKDF2-SHA256 (600 000 itérations, sel aléatoire) → AES-256-GCM, après compression. L'en-tête (sel, iv, révision, date) est authentifié : toute modification est détectée (tests `tests-web/crypto.test.mjs`) |
| Ce que voit Google | un bloc illisible découpé en morceaux, un numéro de révision et une date de mise à jour |
| Accès à la base | règles Firestore : seul l'UID du propriétaire peut lire ou écrire son coffre, tout le reste est interdit. Inscriptions fermées |
| Code chargé | uniquement depuis `jab-94.github.io` (CSP `script-src 'self'`). Firebase (Auth + Firestore « lite », sans Analytics) et pdf.js sont **copiés** dans `docs/vendor` |
| Connexions autorisées | CSP `connect-src` : `firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, rien d'autre. Pas d'iframe, pas de fenêtre Google, pas de reCAPTCHA chargé |
| pdf.js | exécution de code généré désactivée (`isEvalSupported: false`) ; polices et tables locales |
| Notre code | n'appelle jamais `fetch`, `XMLHttpRequest`, WebSocket ou `sendBeacon` ; seul le module Firebase embarqué parle au réseau (test `tests-web/privacy.test.mjs`) |
| Hors ligne | copie **chiffrée** dans le navigateur (IndexedDB) ; service worker qui ne met en cache que les fichiers de l'app, jamais les échanges avec Firebase |

**Limites propres à la version web** :
- **Le code de la page est rechargé depuis GitHub.** Une personne qui prendrait le
  contrôle du compte GitHub pourrait publier une page modifiée. Protection : double
  authentification sur GitHub (activée) et sur le compte Google qui gère Firebase.
- **Le mot de passe du compte Firebase** est connu de Google. Il ne permet pas de lire
  le coffre, à condition d'être différent du mot de passe du coffre.
- Firebase envoie avec ses requêtes des informations techniques (version du kit,
  navigateur), sans aucune donnée budgétaire.
- **Barre d'onglets Liquid Glass (téléphone)** : la bibliothèque `@onlymoein/liquidglass` et React sont
  copiées dans `docs/vendor` (aucun CDN) et ne contiennent aucun appel réseau (test
  `tests-web/privacy.test.mjs`). La CSP autorise en plus `worker-src blob:` : la bibliothèque dessine ses
  reflets dans un worker créé à partir de son propre code ; un worker reste soumis à `connect-src`.
