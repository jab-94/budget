# Budget — contexte du projet pour Claude Code

Suivi de budget personnel, **confidentialité d'abord** (contrainte n°1 de l'utilisateur).
Deux versions, même logique métier :

| | Version web (principale) | Version locale |
|---|---|---|
| Dossier | `docs/` (GitHub Pages : https://jab-94.github.io/budget/) | `app/` (Python, FastAPI, 127.0.0.1) |
| Données | coffre chiffré dans le navigateur, synchronisé via Firebase (projet `budget-app-a4f61`) | fichier `.vault` chiffré |
| Tests | `node --test tests-web/*.test.mjs` + `tests/test_web_privacy.py` | `.venv/bin/python -m pytest` |

## Règles non négociables
- Les données ne sortent JAMAIS en clair : chiffrement dans le navigateur (PBKDF2-SHA256
  600 000 itérations + AES-256-GCM) AVANT tout envoi. Firebase ne reçoit qu'un bloc chiffré.
- Mot de passe du COFFRE ≠ mot de passe du COMPTE Firebase ; le premier ne quitte jamais l'appareil.
- Aucun CDN, aucune police externe, aucune télémétrie. Bibliothèques copiées dans `docs/vendor`
  (reconstruire avec `tools/web-vendor/build.sh`). CSP dans `docs/index.html` : seules les 3 adresses
  Firebase (firestore, identitytoolkit, securetoken).
- Jamais de donnée réelle dans le dépôt (public) : relevés de test fabriqués, prénoms fictifs.
  Auteur des commits : `331623628+jab-94@users.noreply.github.com`.
- Règles Firestore : seul l'UID du propriétaire (voir console Firebase ; `firestore.rules` garde un
  emplacement générique).

## Livraison de la version web (IMPORTANT)
- **Augmenter `CACHE_VERSION` dans `docs/service-worker.js` à chaque publication** (`budget-v1`, `budget-v2`…),
  sinon les téléphones gardent l'ancienne version en cache.
- Ajouter tout nouveau fichier JS à la liste `CORE` du service worker.
- Service worker : RÉSEAU D'ABORD pour le code (HTML/CSS/js), cache d'abord seulement pour vendor/ et
  les icônes. Ne jamais repasser le code en « cache d'abord » : la page et le code se désynchronisaient
  après une mise à jour (bug vécu : import multiple qui ne lisait qu'un fichier).
- Push sur `main` → GitHub Pages republie en ~1 min.
- La logique métier existe en double (Python `app/` et JS `docs/js/`) : toute règle modifiée d'un côté
  doit l'être de l'autre ; `tests-web/logic.test.mjs` vérifie que les résultats concordent.

## Calibrage des banques (d'après des extraits MASQUÉS, jamais de vrais relevés)
- LCL : PDF (« Crédit Lyonnais », point « . » = débit, lignes REF/NATURE ignorées).
- Boursobank : PDF uniquement (pas d'export CSV) ; opérations après « MOUVEMENTS EN EUR »,
  colonnes = 2 mots après « Valeur », mots souvent collés.
- Trade Republic : CSV (23 colonnes confirmées), frais/taxes séparés, titres = Investissement.
- Script de masquage pour calibrer : `tools/inspect_pdf.py` (PDF et CSV).

## Utilisateur
- Pas développeur : expliquer simplement, guider pas à pas (Windows + Mac + iPhone).
- Salaire variable (PAS de droits d'auteur : erreur dans la demande initiale, catégorie retirée).
- Revenu de référence prudent = min(moyenne 6 mois − 20 %, montant dépassé ~3 mois sur 4).
- Compte joint Boursobank : traitement spécifique (part de chacun) reporté à plus tard.
