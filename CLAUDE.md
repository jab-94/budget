# Budget — contexte du projet pour Claude Code

Suivi de budget personnel, **confidentialité d'abord** (contrainte n°1 de l'utilisateur).

**Seule la version web compte** : `docs/` (GitHub Pages : https://jab-94.github.io/budget/), coffre chiffré
dans le navigateur, synchronisé via Firebase (projet `budget-app-a4f61`).
Tests : `node --test tests-web/*.test.mjs` (dont `privacy.test.mjs` : garde-fous de confidentialité).

L'ancienne version locale Python a été **supprimée du dépôt** (novembre 2026, à la demande de
l'utilisateur ; encore visible dans l'historique Git). Ne pas la recréer.

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
  Augmenter AUSSI `APP_VERSION` dans `docs/js/version.js` (même numéro, affiché « v15 » à côté du titre ;
  un test vérifie qu'ils concordent).
- Ajouter tout nouveau fichier JS à la liste `CORE` du service worker.
- Icônes : iOS garde l'ancienne image en cache → à chaque nouvelle icône, CHANGER LE NOM des fichiers
  (`apple-touch-icon-v3.png`…) dans index.html, manifest.json et `CORE`. Générateur : `tools/icon/gen_icon.py`.
- Service worker : RÉSEAU D'ABORD pour le code (HTML/CSS/js), cache d'abord seulement pour vendor/ et
  les icônes. Ne jamais repasser le code en « cache d'abord » : la page et le code se désynchronisaient
  après une mise à jour (bug vécu : import multiple qui ne lisait qu'un fichier).
- Push sur `main` → GitHub Pages republie en ~1 min.
- Catégories et règles par défaut : `docs/js/defaults.js` (à modifier directement). Nouvelles
  catégories dans un coffre existant : migration dans `docs/js/migrations.js`.
  v5 (`addCategoriesV5`) : Vêtements, Beauté et soins, Maison et équipement, Voyages, Assurances, Sport, Enfants,
  Animaux, Éducation, Dons ; règles par défaut intactes déplacées (`MOVED_RULES_V5` : ZARA, IKEA, AIRBNB, SEPHORA…).
- Opérations : recherche (`q` : mots sur libellé + note + catégorie + compte, un nombre = montant exact),
  filtres sens / montant min-max / dates. Modification (PUT /api/transactions/:id) : date, libellé, montant,
  compte (seulement si saisie manuelle), note ; valeurs d'origine gardées dans `original` (« Rétablir »).
  L'empreinte anti-doublon n'est PAS recalculée, pour que le réimport du relevé reste reconnu.
- Abonnements (`subscriptions()` dans `docs/js/analytics.js`) : règle de
  l'utilisateur = même commerçant, MÊME montant, au moins 3 mois différents (~1 mois d'écart). Loyer,
  impôts, crédits, espèces exclus du repérage auto. Préférences (confirmé, ignoré, résilié, nom, fréquence)
  dans `settings.subscriptions` (onglet « Abonnements »).
- Carte « Dépenses » animée en tête de l'accueil (`docs/js/statcard.js` + moteur de ressorts `docs/js/motion.js`,
  d'après le composant « Stat card » de designbookmark.com ; ressorts d'origine : points 200/17, chiffres 160/22,
  pastille 380/30, décalage 0,03 s). Données : `spendingStats()` (7 jours glissants, mois, 12 mois cumulés).
  Pas de défilement automatique (choix de l'utilisateur). Même carte pour les Revenus (`/api/stats/income`,
  pastille verte quand ça monte).
- Barre d'onglets « Liquid Glass » en bas sur TÉLÉPHONE (≤ 860 px) : paquet npm `@onlymoein/liquidglass`
  (React) embarqué dans `docs/vendor/liquidglass.js` + `.css` par `tools/web-vendor/build-liquidglass.mjs`
  (l'injection de balises <style> de la bibliothèque est coupée à la construction : CSP style-src 'self').
  Chargé seulement sur téléphone (`docs/js/tabbar.js`) ; l'ordinateur garde le menu latéral. Onglets :
  Accueil, Opérations, Abonnements, Plus, Réglages (tout à droite, demandé par l'utilisateur ; Comptes/Catégories
  gardent Réglages sélectionné). Feuille « Plus » : Budgets, Revenus, Suggestions, Importer ; Importer
  retiré de la barre à la demande de l'utilisateur, accessible par le bouton de l'accueil). CSP : worker-src 'self' blob:
  (dessin des lentilles dans un worker ; reste limité par connect-src).
  Page « Réglages » (`#tab-settings`, aussi dans le menu latéral) : Apparence (téléphone), liens Comptes bancaires,
  Sauvegarde et export, Catégories et règles (avec « ‹ Réglages » sur téléphone), Verrouiller, Se déconnecter.
  Réglage « Apparence » (page Réglages, téléphone) : curseur de transparence → `--lg-transparency` sur <html>
  (0 teintée, 0,5 normale, 1 transparente), gardé en localStorage `glass-transparency`, appliqué tôt par theme.js.
- Autres éléments en verre (téléphone seulement, `docs/js/glass.js` + `docs/js/glassui.js`) : en-tête collant
  (remplace la barre latérale), fenêtres « Modifier / Classer l'opération » en feuilles (`openModal`/`closeModal` :
  le <form> passe dans la feuille puis revient dans sa <dialog>), questions en alertes iOS (`askConfirm`, sauf
  export CSV et restauration qui gardent confirm()), thème en SegmentedControl et transparence en Slider
  (Comptes › Apparence), recherche en SearchField, listes compte/catégorie en Menu. Les contrôles d'origine
  restent dans la page (masqués) et gardent leurs écouteurs ; le verre les pilote. Ordinateur inchangé.
- Bouton « + Importer » de l'accueil : `.rainbow-btn` (composant « Rainbow Button » shadcn/Tailwind refait en CSS pur,
  pas de Tailwind/React/TS dans ce projet). Sombre en thème clair, blanc en thème sombre ; animation coupée si
  « réduire les animations ».
- Boutons d'action (style de base `button`) : même style sans arc-en-ciel, tokens `--btn-bg`/`--btn-ink`
  (noir en clair, blanc en sombre), coins 12 px ; `.ghost`, `.link`, `.danger` gardent leur style.
- Thème des graphiques (d'après le composant « Earnings » d'easyui, React/Tailwind/framer-motion refait en CSS/JS) :
  revenus #6d7cff, dépenses #ffb44c (tokens --series-1/2, --chart-*), barres à bout rond qui montent, jauges fines
  arrondies qui se remplissent (`growTo`), barre empilée à segments séparés, pastilles ▲/▼ vertes/roses, initiale
  teintée par catégorie, courbe monotone (`monotonePath` dans statcard.js) et curseur au doigt sur les cartes animées.
- Carte « Répartition des dépenses » (accueil, après Dépenses par catégorie) : anneau `docs/js/donut.js` (composant
  « Donut Chart » d'easyui refait en JS : épaisseur 16 / +4 au survol, écart 3,5 px, dessin 1 s décalé, mises à
  jour 0,7 s, total au centre, légende qui masque une part). 6 plus grosses catégories + « Autres ».
- Histogrammes « Revenus et dépenses » (accueil) et « Salaire » (Revenus) : `docs/js/barchart.js` (composant « Bar Chart »
  d'easyui refait en JS : groupé / empilé avec transformation, légende qui masque une série, bande + infobulle au
  doigt sur ressort 520/42, autres mois à 0,38, entrée 0,8 s décalée, coins 6 px, 4 graduations). Choix
  « Côte à côte / Empilé » gardé en localStorage `evo-variant`. Souris : clic = ouvrir le mois ; doigt : bouton
  « Afficher ce mois › » dans l'infobulle. Lignes de référence du salaire via `overlays`.
- Cartes de l'accueil cliquables (`data-card-goto` sur les <article>, chevron › après le titre) : un toucher sur une
  zone neutre ouvre la page liée (Revenus, Opérations du mois filtrées sur « Dépenses », Budgets, Abonnements,
  Suggestions). Les éléments interactifs (`CARD_INTERACTIVE` dans app.js : onglets, courbe, anneau, légendes,
  histogramme, lignes de catégories, boutons/liens) gardent leur rôle et ne naviguent pas.
- Choix du compte de l'accueil réduit (demande de l'utilisateur, « Tous les comptes » presque toujours) : téléphone =
  Menu en verre à icône de banque (`selectAsMenu(..., { compact: true })`), nom en petit seulement si un compte est
  choisi ; ordinateur = <select> réduit.
- Fonds d'écran animés (même logique que l'app Sport) : `docs/js/background.js` (shaders WebGL1 « Mesh drift » et
  « Silk » du 21st.dev Shader Builder, en chaînes JS car la CSP interdit les scripts en ligne), canvas `#bg-shader`
  fixe derrière `.shell` (z-index 0/1). Réglages › « Fond d'écran » : Uni (défaut, fond d'origine) / Mesh drift /
  Silk + vitesse 0–100 (50 = vitesse d'origine, 0 = figé) ; localStorage `bg-style` / `bg-speed` ; DPR ≤ 2, pause
  en arrière-plan, figé si « réduire les animations ». Curseur de vitesse en Slider de verre sur téléphone.

## Calibrage des banques (d'après des extraits MASQUÉS, jamais de vrais relevés)
- LCL : PDF (« Crédit Lyonnais », point « . » = débit, lignes REF/NATURE ignorées). Colonne DATE
  sans année (« 31.12 ») : année prise sur la date de valeur (« 31.12.25 »), sinon la plus proche de la
  période (bug vécu : 31/12/2026 au lieu de 2025 ; réparation auto des données : docs/js/migrations.js).
- Boursobank : ✅ confirmé sur 47 vrais relevés (4 ans, tous cohérents, import par lot).
  PDF uniquement (pas d'export CSV) ; opérations après « MOUVEMENTS EN EUR »,
  colonnes = 2 mots après « Valeur ». Les mots collés n'existaient que dans l'extraction pdfplumber de
  l'extrait masqué : dans l'app web (pdf.js), les libellés ont bien leurs espaces (confirmé par l'utilisateur).
- Trade Republic : CSV (23 colonnes confirmées), frais/taxes séparés, titres = Investissement.
- Calibrer une nouvelle banque : demander à l'utilisateur un extrait MASQUÉ (l'ancien script Python
  `tools/inspect_pdf.py` a été retiré ; si besoin, prévoir un masquage dans le navigateur).
- Faux relevés de test : `tests-web/fixtures/` ; `node tests-web/pdf_check.mjs` les lit avec pdf.js.

## Utilisateur
- Pas développeur : expliquer simplement, guider pas à pas (Windows + Mac + iPhone).
- Salaire variable (PAS de droits d'auteur : erreur dans la demande initiale, catégorie retirée).
- Revenu de référence prudent = min(moyenne 6 mois − 20 %, montant dépassé ~3 mois sur 4).
- Compte joint Boursobank : traitement spécifique (part de chacun) reporté à plus tard.
