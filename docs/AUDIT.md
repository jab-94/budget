# Audit de confidentialité — Budget local

> Audit réalisé à la fin du développement (étape 6), sur la version du dépôt qui
> contient ce fichier. Il répond à une question : **une donnée bancaire peut-elle
> quitter l'ordinateur ?**

## Conclusion

**Non, dans l'usage normal de l'app.** Aucune dépendance n'effectue d'appel réseau.
Les seules connexions sont celles entre le navigateur et l'app, sur `127.0.0.1`
(l'ordinateur lui-même).

Il existe **une seule sortie de données, et vous la choisissez** : si le coffre est
rangé dans iCloud Drive, c'est l'application iCloud d'Apple qui synchronise le
fichier. Ce fichier est chiffré en AES-256-GCM, avec une clé dérivée de votre mot de
passe par scrypt ; Apple ne voit qu'un bloc illisible. Les rapports PDF déposés dans
`Rapports/` sont eux aussi chiffrés (AES-256).

Un point a été **trouvé et corrigé** pendant cet audit : FastAPI embarque un module
de télémétrie (voir § 3).

---

## 1. Méthode

1. **Environnement neuf** : les dépendances d'exécution (`requirements.txt`) ont été
   installées seules, dans un environnement Python vide, pour obtenir la liste
   exacte de ce qui est installé chez vous (§ 2).
2. **Lecture du code de chaque paquet** : recherche de tout ce qui permet une
   connexion réseau (`socket`, `http.client`, `urllib.request`, `urlopen`,
   `requests`, `urllib3`, `httpx`, `aiohttp`, `smtplib`, `ftplib`,
   `create_connection`), puis examen de chaque passage trouvé (§ 3).
3. **Essai en conditions réelles avec un garde réseau** : le vrai serveur a été
   lancé avec `tools/network_guard.py`, qui **bloque et signale** toute connexion
   ou résolution DNS vers l'extérieur. Tous les parcours ont ensuite été déroulés
   dans un navigateur : création du coffre, trois comptes, import des relevés PDF
   LCL et Boursobank, import du CSV Trade Republic, tableau de bord, opérations,
   budgets, revenus, suggestions, catégories, sauvegarde chiffrée, export CSV,
   rapport PDF, verrouillage. Résultat : **0 tentative bloquée** côté serveur et
   **0 requête** du navigateur hors de `127.0.0.1` (§ 4).
4. **Contrôle positif du garde** : il a bien bloqué une vraie tentative vers
   `example.com` et laissé passer une connexion locale. Son silence pendant
   l'essai est donc une preuve, pas une panne.
5. **Tests automatiques** (141) exécutés avec un garde réseau actif pendant toute
   la suite (§ 5).

## 2. Dépendances d'exécution (installées chez vous)

Les 6 dépendances directes sont figées dans `requirements.txt` ; les autres sont
leurs propres dépendances.

| Paquet | Version | Rôle | Code réseau ? | Verdict |
|---|---|---|---|---|
| **fastapi** | 0.162.2 | API locale | `http.client` sert uniquement à la table des textes de statut HTTP (« 404 Not Found »). La doc interactive, qui charge un CDN, est **désactivée** (`docs_url=None`, test). **Télémétrie intégrée : voir § 3** | ✅ aucun appel |
| starlette | 1.10.0 | socle de FastAPI | `http.client.responses` (textes de statut) ; `testclient.py` sert aux tests seulement | ✅ aucun appel |
| **uvicorn** | 0.54.0 | serveur web local | sockets pour **écouter** sur `127.0.0.1` (vérifié au lancement et par test) ; jamais de connexion sortante | ✅ écoute locale uniquement |
| anyio | 4.16.0 | entrées/sorties asynchrones | abstractions de sockets utilisées par le serveur ; aucune connexion ouverte par l'app | ✅ aucun appel |
| h11 | 0.16.0 | protocole HTTP du serveur | aucun | ✅ |
| click | 8.5.1 | ligne de commande d'uvicorn | aucun | ✅ |
| pydantic / pydantic_core | 2.14.3 / 2.50.4 | validation des données | aucun | ✅ |
| annotated-types, annotated-doc, typing_extensions, typing-inspection | — | typage | aucun | ✅ |
| idna | 3.20 | encodage de noms de domaine | aucun (pas de requête) | ✅ |
| **opentelemetry-api** | 1.45.2 | imposé par FastAPI | interface de télémétrie **sans** émetteur ; le mot `requests` n'apparaît que dans un exemple de documentation. **Coupé explicitement, voir § 3** | ✅ inerte et désactivé |
| **cryptography** | 50.0.2 | chiffrement du coffre (AES-256-GCM, scrypt) | aucun | ✅ |
| cffi, pycparser | 2.1.1 / 3.12 | liaison C pour cryptography | aucun | ✅ |
| **pdfplumber** | 0.11.10 | lecture des relevés PDF | aucun | ✅ |
| pdfminer.six | 20260107 | moteur de pdfplumber | aucun | ✅ |
| pypdfium2 | 5.15.2 | rendu PDF (PDFium) | aucun | ✅ |
| pillow | 13.0.0 | images (pdfplumber, reportlab) | aucun | ✅ |
| charset-normalizer | 3.5.2 | détection d'encodage (reportlab) | aucun | ✅ |
| **pypdf** | 7.0.0 | chiffrement AES-256 des rapports PDF | aucun | ✅ |
| **reportlab** | 5.1.0 | création des rapports PDF | peut télécharger une image ou une police si on lui donne une URL (`urlopen`). **Refusé par défaut** (`trustedHosts=None`), **forcé** dans l'app (`rl_config.trustedHosts = None`, `trustedSchemes = ["file"]`, test), et l'app ne lui passe jamais d'URL | ✅ aucun appel |

**Polices et front** : aucune police téléchargée (polices système), aucune
bibliothèque JavaScript, aucun CDN. Les graphiques sont dessinés en SVG par le code
de l'app.

## 3. Point trouvé et corrigé : la télémétrie intégrée à FastAPI

FastAPI 0.162 **impose** le paquet `opentelemetry-api` et contient un module
`fastapi/telemetry`. Ce module peut produire des traces, des mesures et des journaux
d'erreurs, y compris le contenu des requêtes. Il peut aussi **ajouter des envois
automatiques** si la variable `FASTAPI_OTEL_AUTO_CONFIGURE=true` est définie et que
les paquets `opentelemetry-sdk` et `opentelemetry-exporter-otlp` sont installés.

**Avant correction** : rien ne sortait, parce que ces paquets ne sont pas installés.
Cette protection était insuffisante pour la contrainte n°1.

**Après correction** (`app/main.py`) :
- toute la télémétrie est désactivée **explicitement** :
  `FastAPI(telemetry={"tracing": False, "metrics": False, "logs": False, "operation_spans": False, "auto_configure": False})` ;
- le coupe-circuit officiel `OTEL_SDK_DISABLED=true` est activé ;
- la variable `FASTAPI_OTEL_AUTO_CONFIGURE` est retirée au démarrage ;
- tests (`tests/test_telemetry_off.py`) : ils échouent si un réglage repasse à
  `True`, ou si un émetteur de télémétrie (SDK OpenTelemetry, Sentry, PostHog,
  Segment, Mixpanel) est installé.

## 4. Essai réel avec garde réseau

```
LCL     : ✓ Cohérent : 1 234,56 € + 1 225,32 € = 2 459,88 €
Bourso  : ✓ Cohérent : 1 234,56 € + 1 152,06 € = 2 386,62 €
TR      : 9 opérations lues
exports : budget-sauvegarde-AAAA-MM-JJ.vault, budget-operations-AAAA-MM-JJ.csv
rapport : ✓ Rapport chiffré enregistré
requêtes navigateur hors 127.0.0.1 : []   erreurs JS : []
tentatives bloquées côté serveur   : 0
```

Le journal du serveur ne contient que des messages fixes et des compteurs (« Import
enregistré : 5 opération(s). »), sans aucun libellé, montant, IBAN ni nom.

## 5. Garanties vérifiées par les tests automatiques

| Test | Ce qu'il garantit |
|---|---|
| `tests/conftest.py` | **garde réseau sur toute la suite** : toute connexion ou résolution DNS hors de la machine fait échouer le test. Les imports PDF, le chiffrement et la génération de rapports sont exécutés sous ce garde |
| `tests/test_privacy_static.py` | aucune URL externe, CDN, police distante, télémétrie ni `fetch` vers une adresse absolue dans le front ; aucune bibliothèque réseau importée par l'app ; jamais `0.0.0.0` ; `data/`, `*.vault`, `*.pdf`, `*.csv` ignorés par git |
| `tests/test_server_security.py` | CSP stricte, refus des hôtes étrangers (DNS rebinding), jeton de session, doc FastAPI coupée, journaux masqués |
| `tests/test_telemetry_off.py` | télémétrie FastAPI désactivée, aucun émetteur installé, reportlab ne peut pas télécharger d'URL |
| `tests/test_vault.py`, `tests/test_export.py`, `tests/test_report.py` | coffre, sauvegarde et rapport illisibles sans mot de passe ; falsification détectée ; restauration fonctionnelle |
| `tests/test_import_flow.py` | un fichier importé n'est **jamais** écrit sur le disque, même en fichier temporaire |

## 6. Dépendances de développement (tests uniquement)

`requirements-dev.txt` ajoute `pytest` et `httpx2`. httpx2 est un client HTTP, mais il
est utilisé **uniquement** par le client de test de Starlette, qui appelle l'app **en
mémoire**, sans passer par le réseau. Il n'est pas nécessaire pour utiliser l'app, et
le garde réseau des tests bloquerait toute connexion sortante.

## 7. Refaire l'audit vous-même

```
# 1. Les tests (garde réseau inclus)
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest

# 2. L'app avec le garde réseau : utilisez-la normalement, puis vérifiez
#    qu'aucune ligne « BLOQUÉ » n'apparaît et que data/network_guard.log n'existe pas.
.venv/bin/python tools/network_guard.py

# 3. La liste exacte des paquets installés
.venv/bin/python -m pip list
```
(Sous Windows, remplacez `.venv/bin/python` par `.venv\Scripts\python`.)

Vous pouvez aussi couper le wifi : toute l'app fonctionne hors ligne.

## 8. Limites honnêtes

- **Installation** : `pip install` télécharge les paquets depuis PyPI, une seule fois.
  C'est la seule étape qui utilise Internet, et elle ne transmet aucune donnée
  bancaire.
- **Synchronisation iCloud** : si vous rangez le coffre dans iCloud Drive, le fichier
  chiffré y est copié par Apple. C'est votre choix ; sans le mot de passe, il est
  illisible. Activer la « Protection avancée des données » d'iCloud ajoute un
  chiffrement de bout en bout.
- **Export CSV** : ce fichier est **en clair**. L'app vous en avertit ; supprimez-le
  après usage.
- **Mises à jour des dépendances** : une nouvelle version d'un paquet pourrait
  changer de comportement. Les versions sont donc figées dans `requirements.txt`.
  Après toute mise à jour, relancez les tests et le garde réseau.
- **Le navigateur lui-même** (Chrome, Safari, Edge) peut contacter ses propres
  services, par exemple pour ses mises à jour. Cela ne concerne pas l'app : la CSP
  interdit à la page d'envoyer quoi que ce soit ailleurs qu'à `127.0.0.1`.
