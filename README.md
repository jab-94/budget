# Budget local

Application de suivi de budget personnel **100 % locale**. Vos données bancaires ne
quittent jamais votre ordinateur. La seule exception est celle que vous choisissez :
le fichier **chiffré** que vous pouvez placer dans iCloud Drive.

> État : **terminé (étapes 1 à 6)**. Coffre chiffré, comptes, import PDF et CSV
> (LCL, Boursobank, Trade Republic), catégorisation, tableau de bord, budgets, salaire
> variable, suggestions d'économies, sauvegarde, export et rapport iPhone.
> Audit de confidentialité : [docs/AUDIT.md](docs/AUDIT.md).

---

## Deux façons d'utiliser l'app

| | **Version web** (`docs/`) | **Version locale** (`app/`, Python) |
|---|---|---|
| Accès | adresse GitHub Pages, sur PC, Mac et iPhone | sur l'ordinateur, sans Internet |
| Installation | aucune | Python + lanceur |
| Données | coffre **chiffré dans le navigateur**, synchronisé via Firebase | coffre chiffré dans un fichier (iCloud possible) |
| Ce qui sort de l'appareil | un bloc chiffré illisible, vers Firebase | rien (sauf iCloud, si vous le choisissez) |

## Version web

- **Chiffrement de bout en bout** : vos données sont chiffrées **dans le navigateur**,
  avec le mot de passe du coffre, **avant** tout envoi.
  - Clé : PBKDF2-SHA256, 600 000 itérations. Chiffrement : AES-256-GCM.
  - Firebase (Google) ne reçoit qu'un bloc illisible et un en-tête non secret
    (sel, numéro de révision, date).
- **Deux mots de passe distincts** :
  - celui du **compte**, pour se connecter ; Firebase le connaît ;
  - celui du **coffre**, qui chiffre les données ; il ne quitte jamais l'appareil.
    **Ne prenez pas le même.**
- **Synchronisation** entre PC, Mac et iPhone. Une modification faite ailleurs
  n'est jamais écrasée : l'app demande de rouvrir le coffre pour récupérer la
  dernière version.
- **Hors ligne** : une copie chiffrée est gardée sur l'appareil, et les
  modifications sont envoyées au retour du réseau.
- **iPhone** : ouvrez l'adresse dans Safari, puis Partager › « Sur l'écran
  d'accueil ».
- **Sécurité de la page** : la politique de sécurité (CSP) n'autorise que les
  trois adresses Firebase nécessaires. Aucun CDN, aucune police externe, aucune
  télémétrie. Les bibliothèques (Firebase, pdf.js) sont copiées dans `docs/vendor`
  et peuvent être reconstruites avec `tools/web-vendor/build.sh`.
- **Règles Firestore** (`firestore.rules`) : seul votre compte peut lire ou écrire
  votre coffre ; tout le reste est interdit.
- **Tests** : `node --test tests-web/*.test.mjs` (chiffrement, mêmes résultats que la
  version Python) et `tests/test_web_privacy.py` (garde-fous de confidentialité).

**Ce qu'il faut savoir** : le code de la page est rechargé depuis GitHub. La
sécurité dépend donc aussi de celle de votre compte GitHub (double authentification
activée) et de votre compte Firebase.

---

## Version locale : installation (une seule fois par ordinateur)

1. Installez **Python 3.11 ou plus récent** depuis python.org.
   Sous Windows, cochez « Add Python to PATH » pendant l'installation.
2. Téléchargez ce dossier.
3. Ouvrez un terminal dans le dossier et tapez :

   **Mac**
   ```
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   ```
   **Windows**
   ```
   py -m venv .venv
   .venv\Scripts\pip install -r requirements.txt
   ```

C'est la **seule** étape qui utilise Internet : elle télécharge les bibliothèques
listées dans `requirements.txt`. Ensuite, l'app fonctionne wifi coupé.

## Lancement

- **Mac** : double-cliquez sur `lancer-mac.command`.
- **Windows** : double-cliquez sur `lancer-windows.bat`.

Le navigateur s'ouvre sur l'adresse locale de l'app, `127.0.0.1:8765`. Fermez la
fenêtre du terminal pour arrêter l'app.

## Le coffre-fort et iCloud

- Toutes vos données sont dans **un seul fichier chiffré**, `budget.vault`.
- Si iCloud Drive est installé, l'app propose de le ranger dans `iCloud Drive/Budget/`.
  Le Mac et le PC (avec l'application « iCloud pour Windows ») voient alors le même fichier.
- Le fichier est chiffré en **AES-256-GCM** avec une clé dérivée de votre mot de passe
  par **scrypt**. Apple ne voit qu'un bloc illisible.
- La base n'est **jamais** écrite en clair sur le disque. Elle est déchiffrée en
  mémoire et réenregistrée chiffrée après chaque modification.
- Le coffre se verrouille tout seul après 15 minutes d'inactivité.
- **Mot de passe oublié = données perdues.** Personne ne peut les récupérer.

### Utiliser le Mac et le PC sans conflit

- N'ouvrez le coffre que sur **un appareil à la fois**. Cliquez sur « Verrouiller »
  avant de changer d'ordinateur, puis laissez quelques secondes à iCloud pour
  synchroniser.
- Si le coffre est encore ouvert ailleurs, l'app vous prévient.
- Si le fichier a été modifié sur l'autre appareil pendant que vous travailliez,
  l'app **refuse d'écraser** cette version et vous le signale.
- Si iCloud a créé une copie en conflit (`budget 2.vault`), l'app vous le signale aussi.

**Conseil** : activez la « Protection avancée des données » d'iCloud
(Réglages › votre nom › iCloud). Le fichier est alors chiffré une seconde fois, de
bout en bout, par Apple.

---

## Importer ses relevés

| Banque | Format conseillé | État |
|---|---|---|
| Boursobank | PDF (pas d'export CSV disponible) | **Calibré** sur la structure de vos relevés (en-têtes de page, mots collés, références) |
| LCL | PDF | **Calibré** sur la structure de vos relevés (détails, pied de page, colonnes) |
| Trade Republic | **CSV** (« exportation de transactions en CSV ») | **Reconnu automatiquement** : frais et taxes séparés, achats de titres marqués « Investissement » |
| Autre banque | CSV ou PDF | CSV : vous indiquez les colonnes. PDF : lecture générique |

- Le fichier est envoyé à l'app locale, lu **en mémoire**, puis oublié. Aucune copie
  n'est écrite sur le disque, ni même dans un fichier temporaire.
- Avant d'enregistrer, un écran de vérification :
  - **contrôle les soldes** : solde de début + opérations = solde de fin ;
  - décoche d'office les opérations **déjà importées** et les **doublons probables**,
    c'est-à-dire le même montant à 3 jours près avec un libellé proche, ce qui arrive
    quand on importe le CSV puis le PDF d'un même mois ;
  - permet d'inverser le sens d'une opération (bouton ±) si le PDF a été mal lu.
- Pour calibrer la lecture d'un PDF sans rien dévoiler, lancez `tools/inspect_pdf.py`
  (voir l'en-tête du script).

---

## Catégorisation automatique (sans IA, 100 % locale)

Chaque opération est classée par des **règles**, dans cet ordre :

1. **Vos règles**, créées dans l'onglet Catégories ou en corrigeant une opération.
2. **Virements entre vos comptes** : même montant en sens opposé sur deux de vos
   comptes, à 3 jours près. Ils sont classés « Virements internes ».
3. **Nature donnée par la banque** (export Trade Republic : investissement, dividende,
   frais, taxe…).
4. **Règles par défaut** : environ 200 enseignes françaises courantes, modifiables.
   La plus précise l'emporte (« UBER EATS » avant « UBER »).

- Un **mot-clé** se compare au libellé sans accents ni majuscules, sur des mots entiers.
  Une **expression régulière** est aussi possible.
- **Corriger une opération** (en cliquant sur sa catégorie) la verrouille. L'app
  propose aussi de créer une règle pour les opérations similaires, en affichant
  combien d'opérations elle toucherait.
- Les catégories **« Hors budget »** (Virements internes, Investissement) ne comptent
  ni en dépenses ni en revenus.

---

## Tableau de bord et budgets

- **Solde du mois** = revenus − dépenses. Les virements entre vos comptes et les
  placements (catégories « Hors budget ») ne comptent jamais.
- Un **remboursement** classé dans une catégorie de dépense (ex. CPAM en Santé)
  **réduit** cette dépense, il ne gonfle pas les revenus.
- **Barre « où partent les revenus »** : les principales catégories de dépenses,
  puis ce qui reste.
- **Évolution** sur 6 à 24 mois. Cliquer sur une catégorie affiche son évolution
  seule ; cliquer sur une colonne affiche ce mois. Chaque graphique a sa vue en
  tableau.
- **Budgets** : un plafond mensuel par catégorie. Alerte à 80 %, puis en cas de
  dépassement. L'état est toujours écrit en toutes lettres, pas seulement en couleur.
- **Thème** clair, sombre ou automatique (comme le système), en bas de la barre
  latérale. Ce choix d'affichage est gardé dans le navigateur ; aucune donnée
  n'y est stockée.

---

## Salaire variable : revenu de référence prudent

- Page **Revenus** : moyennes lissées sur 3 et 6 mois de la catégorie « Salaire »
  (catégories suivies modifiables).
- **Revenu de référence prudent** = le plus petit des deux montants suivants :
  - la moyenne des 6 derniers mois, diminuée de 20 % ;
  - le montant dépassé environ 3 mois sur 4 (premier quartile).
- Le calcul porte sur les 6 mois **avant** le mois affiché : un mois en cours, où le
  salaire n'est pas encore arrivé, ne fausse rien. Un mois importé sans salaire
  compte pour 0 ; un mois sans aucune donnée est ignoré.
- Le revenu prudent sert :
  - au **reste à vivre**, où il est compté comme « attendu » tant que le salaire du
    mois n'est pas arrivé ;
  - à la page **Budgets**, qui compare le total des plafonds à ce revenu.

## Sauvegarde, export et rapport iPhone (onglet Comptes)

- **Sauvegarde chiffrée** (`.vault`) : une copie complète du coffre, protégée par le
  même mot de passe. Pour la restaurer, verrouillez l'app, puis indiquez ce fichier
  dans « Emplacement du coffre ».
- **Export CSV** : toutes les opérations, lisibles dans Excel. Ce fichier est
  **en clair** : supprimez-le après usage.
- **Rapport PDF pour l'iPhone** : le résumé d'un mois, chiffré en AES-256 avec un mot
  de passe de votre choix.
  - Enregistré dans le sous-dossier `Rapports` à côté du coffre (iCloud Drive), il
    apparaît dans l'app **Fichiers** de l'iPhone, qui demande le mot de passe à
    l'ouverture.
  - Il peut aussi être simplement téléchargé.
- **Tout supprimer** (zone sensible) : vide le coffre (opérations, comptes, règles,
  budgets).

## Suggestions d'économies (calculées sur votre ordinateur)

- **Prélèvements récurrents et abonnements** : l'app repère les opérations qui
  reviennent à intervalle régulier (hebdomadaire, mensuel, trimestriel, annuel),
  avec le même libellé et un montant stable. Elle en tire le coût annuel, la
  prochaine échéance, les **hausses de prix** et les abonnements **qui semblent
  arrêtés**.
  - Un achat par carte n'est retenu que s'il a un montant fixe : un restaurant
    payé chaque mois n'est pas un abonnement.
  - Une facture prélevée peut varier (énergie). Elle est alors marquée « ≈ ».
- **Catégories en hausse** : au moins +20 % et 30 € de plus que votre moyenne des
  3 mois précédents.
- **Frais bancaires** cumulés sur 12 mois.
- **Doublons suspects** : même montant, même libellé, même compte, à 2 jours près,
  à partir de 10 €.
- **Reste à vivre prévisionnel** pour le mois en cours : revenus reçus − déjà
  dépensé − prélèvements récurrents encore attendus d'ici la fin du mois. Les
  dépenses courantes à venir (courses…) n'y sont pas déduites.
- Chaque suggestion peut être **masquée**, puis réaffichée.

---

## Vérifier vous-même les garanties de confidentialité

| Garantie | Comment la vérifier |
|---|---|
| Aucune requête vers Internet | Coupez le wifi et utilisez l'app : tout fonctionne. Ou ouvrez les outils de développement du navigateur (F12 › onglet **Réseau**) : toutes les lignes pointent vers `127.0.0.1`. |
| Le serveur n'écoute que sur votre machine | Mac : `lsof -iTCP:8765 -sTCP:LISTEN` · Windows : `netstat -ano \| findstr 8765`. Vous devez voir `127.0.0.1:8765`, jamais `0.0.0.0` ni `*`. Depuis votre téléphone, `http://<IP-de-l'ordinateur>:8765` ne répond pas. |
| Le navigateur bloque toute sortie | F12 › Réseau › cliquez sur la page › en-tête `Content-Security-Policy` : `default-src 'self'; connect-src 'self'; …` |
| Le fichier est bien chiffré | Ouvrez `budget.vault` dans un éditeur de texte : on n'y voit que des caractères illisibles, aucun libellé ni montant. |
| Les journaux ne contiennent rien de personnel | La fenêtre du terminal n'affiche que des messages comme « Coffre déverrouillé. » Aucune URL, aucun montant, aucun libellé. |
| Aucune donnée dans Git | `data/`, `*.vault`, `*.pdf`, `*.csv` et `*.db` sont listés dans `.gitignore`. |

### Garde réseau (essai en conditions réelles)

```
.venv/bin/python tools/network_guard.py          (Windows : .venv\Scripts\python tools\network_guard.py)
```
Ce script lance l'app normalement, mais **bloque et signale** toute connexion vers
l'extérieur. Utilisez l'app, puis vérifiez qu'aucune ligne « BLOQUÉ » n'est apparue
dans le terminal. L'audit complet est dans [docs/AUDIT.md](docs/AUDIT.md).

### Tests automatiques

```
.venv/bin/pip install -r requirements-dev.txt     (Windows : .venv\Scripts\pip …)
.venv/bin/python -m pytest
```

Ce que les tests vérifient :
- **`tests/test_privacy_static.py`** relit le code source. Il échoue s'il trouve une URL
  externe, un CDN, une police distante, de la télémétrie, un `fetch` vers une adresse
  absolue dans le front, une bibliothèque réseau (`requests`, `httpx`, `urllib.request`,
  `socket`…) importée dans l'app, ou `0.0.0.0`.
- **`tests/conftest.py`** intercepte toute connexion réseau ou résolution DNS vers
  l'extérieur pendant **toute** la suite de tests. Si une dépendance tentait de
  contacter Internet, le test échouerait.
- **`tests/test_server_security.py`** vérifie la CSP, le refus des hôtes étrangers,
  le jeton de session, la désactivation de la doc en ligne de FastAPI (qui utilise
  un CDN) et le masquage des montants, IBAN et dates dans les journaux.
- **`tests/test_vault.py`** vérifie que le fichier est illisible sans mot de passe,
  qu'une falsification est détectée, que les conflits iCloud sont détectés et que
  « tout supprimer » fonctionne.

## Protections supplémentaires

- **Jeton de session** : chaque lancement génère un secret injecté dans la page. Un
  autre site ouvert dans votre navigateur ne peut pas le lire, donc ne peut pas
  interroger l'app.
- **Contrôle de l'en-tête `Host`** : bloque le « DNS rebinding », c'est-à-dire un site
  web qui tenterait de se faire passer pour l'app locale.
- **Étiquette d'appareil neutre** (ex. `Mac-3f9a`) : le nom de votre ordinateur, qui
  contient souvent un prénom, n'est jamais écrit dans le fichier synchronisé.
