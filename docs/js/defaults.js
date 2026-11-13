// Généré à partir de la version Python (app/db.py, app/categorize.py) : ne pas modifier à la main.
export const DEFAULT_CATEGORIES = [
 {
  "name": "Alimentation",
  "kind": "expense",
  "color": "#5b8def"
 },
 {
  "name": "Logement",
  "kind": "expense",
  "color": "#8a6fdf"
 },
 {
  "name": "Transports",
  "kind": "expense",
  "color": "#3fb3a8"
 },
 {
  "name": "Abonnements",
  "kind": "expense",
  "color": "#e0a03a"
 },
 {
  "name": "Santé",
  "kind": "expense",
  "color": "#e2677c"
 },
 {
  "name": "Loisirs",
  "kind": "expense",
  "color": "#6cbf5a"
 },
 {
  "name": "Restaurants",
  "kind": "expense",
  "color": "#d9775c"
 },
 {
  "name": "Frais bancaires",
  "kind": "expense",
  "color": "#9a9a9a"
 },
 {
  "name": "Impôts",
  "kind": "expense",
  "color": "#7a8699"
 },
 {
  "name": "Divers",
  "kind": "expense",
  "color": "#b0b0b0"
 },
 {
  "name": "Salaire",
  "kind": "income",
  "color": "#2e9e6a"
 },
 {
  "name": "Autres revenus",
  "kind": "income",
  "color": "#57a87a"
 },
 {
  "name": "Virements internes",
  "kind": "transfer",
  "color": "#c0c0c0"
 },
 {
  "name": "Shopping",
  "kind": "expense",
  "color": "#c46fb5"
 },
 {
  "name": "Espèces",
  "kind": "expense",
  "color": "#a58b5c"
 },
 {
  "name": "Revenus financiers",
  "kind": "income",
  "color": "#3f9bc4"
 },
 {
  "name": "Investissement",
  "kind": "transfer",
  "color": "#7f8fa6"
 }
];
export const DEFAULT_RULES = [{"category": "Alimentation", "sign": null, "patterns": ["CARREFOUR", "LECLERC", "AUCHAN", "INTERMARCHE", "LIDL", "ALDI", "MONOPRIX", "FRANPRIX", "CASINO", "SUPER U", "HYPER U", "MAGASINS U", "PICARD", "BIOCOOP", "NATURALIA", "GRAND FRAIS", "NETTO", "LEADER PRICE", "G20", "SPAR", "PROXI", "BOULANGERIE", "BOUCHERIE", "PRIMEUR", "FROMAGERIE", "LA VIE CLAIRE", "THIRIET"]}, {"category": "Restaurants", "sign": null, "patterns": ["RESTAURANT", "MCDONALD", "MC DONALD", "BURGER KING", "KFC", "QUICK", "DELIVEROO", "UBER EATS", "JUST EAT", "STARBUCKS", "BRASSERIE", "PIZZA", "SUSHI", "CAFE", "BISTRO", "PAUL"]}, {"category": "Transports", "sign": null, "patterns": ["SNCF", "OUIGO", "TRAINLINE", "RATP", "NAVIGO", "IDF MOBILITES", "UBER", "BOLT", "HEETCH", "G7", "TAXI", "BLABLACAR", "LIME", "VELIB", "ESSO", "SHELL", "AVIA", "STATION", "CARBURANT", "PEAGE", "VINCI AUTOROUTES", "SANEF", "APRR", "ASF", "PARKING", "INDIGO", "AIR FRANCE", "TRANSAVIA", "EASYJET", "RYANAIR", "VUELING"]}, {"category": "Abonnements", "sign": null, "patterns": ["NETFLIX", "SPOTIFY", "DEEZER", "DISNEY", "CANAL", "AMAZON PRIME", "PRIME VIDEO", "APPLE COM BILL", "ICLOUD", "YOUTUBE", "FREE MOBILE", "FREE TELECOM", "FREEBOX", "ORANGE", "SOSH", "SFR", "RED BY SFR", "BOUYGUES", "B AND YOU", "OPENAI", "ADOBE", "MICROSOFT", "GOOGLE STORAGE", "AUDIBLE", "MOLOTOV"]}, {"category": "Logement", "sign": null, "patterns": ["LOYER", "EDF", "ENGIE", "VEOLIA", "SUEZ", "EAU DE PARIS", "SYNDIC", "FONCIA", "NEXITY", "ASSURANCE HABITATION", "GAZ", "ELECTRICITE", "OHM ENERGIE", "MINT ENERGIE", "EKWATEUR"]}, {"category": "Santé", "sign": null, "patterns": ["PHARMACIE", "PHARMA", "MEDECIN", "DOCTEUR", "DOCTOLIB", "CPAM", "AMELI", "MUTUELLE", "HARMONIE", "ALAN", "DENTISTE", "DENTAIRE", "OPTIQUE", "OPTICIEN", "KINE", "LABORATOIRE", "HOPITAL", "CLINIQUE", "OSTEO"]}, {"category": "Loisirs", "sign": null, "patterns": ["FNAC", "CULTURA", "DECATHLON", "CINEMA", "UGC", "PATHE", "GAUMONT", "MK2", "STEAM", "PLAYSTATION", "NINTENDO", "BASIC FIT", "FITNESS PARK", "NEONESS", "AIRBNB", "BOOKING", "TICKETMASTER", "FNAC SPECTACLES", "MUSEE", "LIBRAIRIE"]}, {"category": "Shopping", "sign": null, "patterns": ["AMAZON", "AMZN", "ZALANDO", "VINTED", "IKEA", "LEROY MERLIN", "CASTORAMA", "DARTY", "BOULANGER", "ZARA", "H M", "UNIQLO", "KIABI", "SEPHORA", "ACTION", "LA REDOUTE", "CDISCOUNT", "ALIEXPRESS", "SHEIN", "APPLE STORE"]}, {"category": "Espèces", "sign": "-", "patterns": ["RETRAIT", "RETRAIT DAB", "DAB"]}, {"category": "Frais bancaires", "sign": "-", "patterns": ["COTISATION", "FRAIS", "COMMISSION", "AGIOS", "INTERETS DEBITEURS", "FRAIS TENUE", "OPTION", "OFFRE GROUPEE"]}, {"category": "Impôts", "sign": null, "patterns": ["DGFIP", "IMPOT", "IMPOTS", "TRESOR PUBLIC", "TAXE FONCIERE", "TAXE HABITATION", "URSSAF", "PRELEVEMENT A LA SOURCE"]}, {"category": "Salaire", "sign": "+", "patterns": ["SALAIRE", "PAIE", "REMUNERATION"]}, {"category": "Autres revenus", "sign": "+", "patterns": ["CAF", "FRANCE TRAVAIL", "POLE EMPLOI"]}, {"category": "Virements internes", "sign": null, "patterns": ["VIR INTERNE", "VIREMENT INTERNE", "VIR CPTE A CPTE", "VIREMENT DE COMPTE A COMPTE"]}];
export const HINT_CATEGORY = {"investissement": "Investissement", "dividende": "Revenus financiers", "interets": "Revenus financiers", "frais": "Frais bancaires", "impot": "Impôts"};
export const NOISE_WORDS = new Set(["A", "ACHAT", "AU", "BUY", "CARD", "CARTE", "CB", "DE", "DES", "DU", "ECH", "EMIS", "EN", "EUR", "FAC", "FACTURE", "FR", "FROM", "INCOMING", "INST", "INSTANTANE", "LA", "LE", "LES", "MANDAT", "PAIEMENT", "PAIEMT", "PAR", "POUR", "PRELEVEMENT", "PRLV", "RECU", "REF", "SA", "SARL", "SAS", "SEPA", "TO", "TRADE", "TRANSACTION", "TRANSFER", "VIR", "VIREMENT", "X"]);
