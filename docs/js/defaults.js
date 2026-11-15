// Catégories et règles par défaut (à l'origine générées depuis l'ancienne version Python ; désormais modifiées ici).
export const DEFAULT_CATEGORIES = [
 {
  "name": "Alimentation",
  "kind": "expense",
  "color": "#6d7cff"
 },
 {
  "name": "Logement",
  "kind": "expense",
  "color": "#a78bfa"
 },
 {
  "name": "Transports",
  "kind": "expense",
  "color": "#34d1bf"
 },
 {
  "name": "Abonnements",
  "kind": "expense",
  "color": "#ffb44c"
 },
 {
  "name": "Santé",
  "kind": "expense",
  "color": "#ff6b8b"
 },
 {
  "name": "Loisirs",
  "kind": "expense",
  "color": "#7bd88f"
 },
 {
  "name": "Restaurants",
  "kind": "expense",
  "color": "#ff8a5c"
 },
 {
  "name": "Frais bancaires",
  "kind": "expense",
  "color": "#94a3b8"
 },
 {
  "name": "Impôts",
  "kind": "expense",
  "color": "#7c8db5"
 },
 {
  "name": "Divers",
  "kind": "expense",
  "color": "#a1a1aa"
 },
 {
  "name": "Salaire",
  "kind": "income",
  "color": "#10b981"
 },
 {
  "name": "Autres revenus",
  "kind": "income",
  "color": "#6ee7b7"
 },
 {
  "name": "Virements internes",
  "kind": "transfer",
  "color": "#c4c4cc"
 },
 {
  "name": "Shopping",
  "kind": "expense",
  "color": "#e879f9"
 },
 {
  "name": "Espèces",
  "kind": "expense",
  "color": "#c8a26b"
 },
 {
  "name": "Revenus financiers",
  "kind": "income",
  "color": "#5ac8fa"
 },
 {
  "name": "Investissement",
  "kind": "transfer",
  "color": "#8b9bb8"
 },
 {
  "name": "Cadeaux",
  "kind": "expense",
  "color": "#f472b6"
 },
 {
  "name": "Mensualités de prêt",
  "kind": "expense",
  "color": "#a68a7b"
 },
 {
  "name": "Cadeaux reçus",
  "kind": "income",
  "color": "#c084fc"
 },
 {
  "name": "Remboursements",
  "kind": "income",
  "color": "#60a5fa"
 },
 {
  "name": "Primes",
  "kind": "income",
  "color": "#34d399"
 },
 {
  "name": "Intéressement et participation",
  "kind": "income",
  "color": "#2dd4bf"
 },
 {
  "name": "Prêts entre proches",
  "kind": "transfer",
  "color": "#b8a888"
 },
 {
  "name": "Vêtements",
  "kind": "expense",
  "color": "#fb7185"
 },
 {
  "name": "Beauté et soins",
  "kind": "expense",
  "color": "#f9a8d4"
 },
 {
  "name": "Maison et équipement",
  "kind": "expense",
  "color": "#d4a373"
 },
 {
  "name": "Voyages",
  "kind": "expense",
  "color": "#22d3ee"
 },
 {
  "name": "Assurances",
  "kind": "expense",
  "color": "#818cf8"
 },
 {
  "name": "Sport",
  "kind": "expense",
  "color": "#4ade80"
 },
 {
  "name": "Enfants",
  "kind": "expense",
  "color": "#fbbf24"
 },
 {
  "name": "Animaux",
  "kind": "expense",
  "color": "#a3e635"
 },
 {
  "name": "Éducation",
  "kind": "expense",
  "color": "#5b8cff"
 },
 {
  "name": "Dons",
  "kind": "expense",
  "color": "#fda4af"
 }
];
export const DEFAULT_RULES = [{"category": "Alimentation", "sign": null, "patterns": ["CARREFOUR", "LECLERC", "AUCHAN", "INTERMARCHE", "LIDL", "ALDI", "MONOPRIX", "FRANPRIX", "CASINO", "SUPER U", "HYPER U", "MAGASINS U", "PICARD", "BIOCOOP", "NATURALIA", "GRAND FRAIS", "NETTO", "LEADER PRICE", "G20", "SPAR", "PROXI", "BOULANGERIE", "BOUCHERIE", "PRIMEUR", "FROMAGERIE", "LA VIE CLAIRE", "THIRIET"]}, {"category": "Restaurants", "sign": null, "patterns": ["RESTAURANT", "MCDONALD", "MC DONALD", "BURGER KING", "KFC", "QUICK", "DELIVEROO", "UBER EATS", "JUST EAT", "STARBUCKS", "BRASSERIE", "PIZZA", "SUSHI", "CAFE", "BISTRO", "PAUL"]}, {"category": "Transports", "sign": null, "patterns": ["SNCF", "OUIGO", "TRAINLINE", "RATP", "NAVIGO", "IDF MOBILITES", "UBER", "BOLT", "HEETCH", "G7", "TAXI", "BLABLACAR", "LIME", "VELIB", "ESSO", "SHELL", "AVIA", "STATION", "CARBURANT", "PEAGE", "VINCI AUTOROUTES", "SANEF", "APRR", "ASF", "PARKING", "INDIGO", "AIR FRANCE", "TRANSAVIA", "EASYJET", "RYANAIR", "VUELING"]}, {"category": "Abonnements", "sign": null, "patterns": ["NETFLIX", "SPOTIFY", "DEEZER", "DISNEY", "CANAL", "AMAZON PRIME", "PRIME VIDEO", "APPLE COM BILL", "ICLOUD", "YOUTUBE", "FREE MOBILE", "FREE TELECOM", "FREEBOX", "ORANGE", "SOSH", "SFR", "RED BY SFR", "BOUYGUES", "B AND YOU", "OPENAI", "ADOBE", "MICROSOFT", "GOOGLE STORAGE", "AUDIBLE", "MOLOTOV"]}, {"category": "Logement", "sign": null, "patterns": ["LOYER", "EDF", "ENGIE", "VEOLIA", "SUEZ", "EAU DE PARIS", "SYNDIC", "FONCIA", "NEXITY", "ASSURANCE HABITATION", "GAZ", "ELECTRICITE", "OHM ENERGIE", "MINT ENERGIE", "EKWATEUR"]}, {"category": "Santé", "sign": null, "patterns": ["PHARMACIE", "PHARMA", "MEDECIN", "DOCTEUR", "DOCTOLIB", "CPAM", "AMELI", "MUTUELLE", "HARMONIE", "ALAN", "DENTISTE", "DENTAIRE", "OPTIQUE", "OPTICIEN", "KINE", "LABORATOIRE", "HOPITAL", "CLINIQUE", "OSTEO"]}, {"category": "Loisirs", "sign": null, "patterns": ["FNAC", "CULTURA", "CINEMA", "UGC", "PATHE", "GAUMONT", "MK2", "STEAM", "PLAYSTATION", "NINTENDO", "TICKETMASTER", "FNAC SPECTACLES", "MUSEE", "LIBRAIRIE"]}, {"category": "Shopping", "sign": null, "patterns": ["AMAZON", "AMZN", "ACTION", "LA REDOUTE", "CDISCOUNT", "ALIEXPRESS", "APPLE STORE"]}, {"category": "Espèces", "sign": "-", "patterns": ["RETRAIT", "RETRAIT DAB", "DAB"]}, {"category": "Frais bancaires", "sign": "-", "patterns": ["COTISATION", "FRAIS", "COMMISSION", "AGIOS", "INTERETS DEBITEURS", "FRAIS TENUE", "OPTION", "OFFRE GROUPEE"]}, {"category": "Impôts", "sign": null, "patterns": ["DGFIP", "IMPOT", "IMPOTS", "TRESOR PUBLIC", "TAXE FONCIERE", "TAXE HABITATION", "URSSAF", "PRELEVEMENT A LA SOURCE"]}, {"category": "Salaire", "sign": "+", "patterns": ["SALAIRE", "PAIE", "REMUNERATION"]}, {"category": "Autres revenus", "sign": "+", "patterns": ["CAF", "FRANCE TRAVAIL", "POLE EMPLOI"]}, {"category": "Virements internes", "sign": null, "patterns": ["VIR INTERNE", "VIREMENT INTERNE", "VIR CPTE A CPTE", "VIREMENT DE COMPTE A COMPTE"]}, {"category": "Primes", "sign": "+", "patterns": ["PRIME"]}, {"category": "Intéressement et participation", "sign": "+", "patterns": ["INTERESSEMENT", "PARTICIPATION", "EPARGNE SALARIALE", "NATIXIS INTEREPARGNE", "AMUNDI ESR"]}, {"category": "Mensualités de prêt", "sign": "-", "patterns": ["ECHEANCE PRET", "ECH PRET", "REMBOURSEMENT PRET", "PRET IMMOBILIER", "CREDIT IMMOBILIER", "ECHEANCE CREDIT", "COFIDIS", "CETELEM", "SOFINCO", "FRANFINANCE"]}, {"category": "Vêtements", "sign": null, "patterns": ["ZALANDO", "VINTED", "ZARA", "H M", "UNIQLO", "KIABI", "SHEIN", "CELIO", "JULES", "BERSHKA", "PULL AND BEAR", "MANGO", "PRIMARK", "NIKE", "ADIDAS", "FOOT LOCKER", "COURIR", "JD SPORTS", "LACOSTE", "BRICE", "CAMAIEU", "PROMOD", "ETAM", "SEZANE", "ASOS", "VETEMENTS", "CHAUSSURES"]}, {"category": "Beauté et soins", "sign": null, "patterns": ["SEPHORA", "NOCIBE", "MARIONNAUD", "YVES ROCHER", "KIKO", "COIFFURE", "COIFFEUR", "BARBIER", "INSTITUT DE BEAUTE", "ONGLERIE"]}, {"category": "Maison et équipement", "sign": null, "patterns": ["IKEA", "LEROY MERLIN", "CASTORAMA", "DARTY", "BOULANGER", "MAISONS DU MONDE", "CONFORAMA", "BRICO DEPOT", "BRICORAMA", "MR BRICOLAGE", "WELDOM", "LA FOIR FOUILLE", "GIFI", "HEMA", "BUT CONFORAMA", "ELECTRO DEPOT"]}, {"category": "Voyages", "sign": null, "patterns": ["AIRBNB", "BOOKING", "HOTEL", "EXPEDIA", "ACCOR", "IBIS", "CLUB MED", "PIERRE ET VACANCES", "CENTER PARCS", "ABRITEL", "HOSTELWORLD", "OPODO", "LASTMINUTE"]}, {"category": "Assurances", "sign": "-", "patterns": ["ASSURANCE", "AXA", "MAIF", "MACIF", "MATMUT", "ALLIANZ", "GMF", "MAAF", "GROUPAMA", "GENERALI", "DIRECT ASSURANCE", "LUKO"]}, {"category": "Sport", "sign": null, "patterns": ["DECATHLON", "BASIC FIT", "FITNESS PARK", "NEONESS", "GO SPORT", "INTERSPORT", "KEEPCOOL", "ON AIR", "CMG SPORTS", "ORANGE BLEUE", "STRAVA", "CLUB SPORTIF", "LICENCE"]}, {"category": "Enfants", "sign": "-", "patterns": ["CRECHE", "NOUNOU", "PAJEMPLOI", "CANTINE", "OKAIDI", "JACADI", "CYRILLUS", "AUBERT", "VERTBAUDET", "JOUE CLUB", "KING JOUET"]}, {"category": "Animaux", "sign": "-", "patterns": ["VETERINAIRE", "VETO", "ANIMALIS", "ZOOPLUS", "MAXI ZOO", "TRUFFAUT ANIMAUX", "CROQUETTES"]}, {"category": "Éducation", "sign": "-", "patterns": ["ECOLE", "UNIVERSITE", "CNED", "UDEMY", "COURSERA", "FRAIS DE SCOLARITE", "AUTO ECOLE"]}, {"category": "Dons", "sign": "-", "patterns": ["CROIX ROUGE", "RESTOS DU COEUR", "UNICEF", "SECOURS POPULAIRE", "FONDATION", "MSF", "WWF", "TELETHON", "HELLOASSO"]}];
export const CATEGORIES_V4 = ["Cadeaux", "Mensualités de prêt", "Cadeaux reçus", "Remboursements", "Primes", "Intéressement et participation", "Prêts entre proches"];
export const HINT_CATEGORY = {"investissement": "Investissement", "dividende": "Revenus financiers", "interets": "Revenus financiers", "frais": "Frais bancaires", "impot": "Impôts"};
export const NOISE_WORDS = new Set(["A", "ACHAT", "AU", "BUY", "CARD", "CARTE", "CB", "DE", "DES", "DU", "ECH", "EMIS", "EN", "EUR", "FAC", "FACTURE", "FR", "FROM", "INCOMING", "INST", "INSTANTANE", "LA", "LE", "LES", "MANDAT", "PAIEMENT", "PAIEMT", "PAR", "POUR", "PRELEVEMENT", "PRLV", "RECU", "REF", "SA", "SARL", "SAS", "SEPA", "TO", "TRADE", "TRANSACTION", "TRANSFER", "VIR", "VIREMENT", "X"]);
// v5 : nouvelles catégories de dépenses, et règles par défaut déplacées vers elles (coffres existants : migrations.js).
export const CATEGORIES_V5 = ["Vêtements", "Beauté et soins", "Maison et équipement", "Voyages", "Assurances", "Sport", "Enfants", "Animaux", "Éducation", "Dons"];
export const MOVED_RULES_V5 = {"ZALANDO": "Vêtements", "VINTED": "Vêtements", "ZARA": "Vêtements", "H M": "Vêtements", "UNIQLO": "Vêtements", "KIABI": "Vêtements", "SHEIN": "Vêtements", "SEPHORA": "Beauté et soins", "IKEA": "Maison et équipement", "LEROY MERLIN": "Maison et équipement", "CASTORAMA": "Maison et équipement", "DARTY": "Maison et équipement", "BOULANGER": "Maison et équipement", "AIRBNB": "Voyages", "BOOKING": "Voyages", "DECATHLON": "Sport", "BASIC FIT": "Sport", "FITNESS PARK": "Sport", "NEONESS": "Sport"};

/** v6 : couleurs des catégories alignées sur la palette des graphiques. Ancienne couleur par défaut → nouvelle ;
 *  seules les catégories qui ont encore leur couleur d'origine changent (une couleur choisie à la main reste). */
export const RECOLOR_V6 = {
  "Alimentation": [
    "#5b8def",
    "#6d7cff"
  ],
  "Logement": [
    "#8a6fdf",
    "#a78bfa"
  ],
  "Transports": [
    "#3fb3a8",
    "#34d1bf"
  ],
  "Abonnements": [
    "#e0a03a",
    "#ffb44c"
  ],
  "Santé": [
    "#e2677c",
    "#ff6b8b"
  ],
  "Loisirs": [
    "#6cbf5a",
    "#7bd88f"
  ],
  "Restaurants": [
    "#d9775c",
    "#ff8a5c"
  ],
  "Frais bancaires": [
    "#9a9a9a",
    "#94a3b8"
  ],
  "Impôts": [
    "#7a8699",
    "#7c8db5"
  ],
  "Divers": [
    "#b0b0b0",
    "#a1a1aa"
  ],
  "Salaire": [
    "#2e9e6a",
    "#10b981"
  ],
  "Autres revenus": [
    "#57a87a",
    "#6ee7b7"
  ],
  "Virements internes": [
    "#c0c0c0",
    "#c4c4cc"
  ],
  "Shopping": [
    "#c46fb5",
    "#e879f9"
  ],
  "Espèces": [
    "#a58b5c",
    "#c8a26b"
  ],
  "Revenus financiers": [
    "#3f9bc4",
    "#5ac8fa"
  ],
  "Investissement": [
    "#7f8fa6",
    "#8b9bb8"
  ],
  "Cadeaux": [
    "#d46a9f",
    "#f472b6"
  ],
  "Mensualités de prêt": [
    "#8d7a6b",
    "#a68a7b"
  ],
  "Cadeaux reçus": [
    "#c98bd6",
    "#c084fc"
  ],
  "Remboursements": [
    "#6aa7c9",
    "#60a5fa"
  ],
  "Primes": [
    "#3fae7f",
    "#34d399"
  ],
  "Intéressement et participation": [
    "#4fb59a",
    "#2dd4bf"
  ],
  "Prêts entre proches": [
    "#b3a58c",
    "#b8a888"
  ],
  "Vêtements": [
    "#ec6aa0",
    "#fb7185"
  ],
  "Beauté et soins": [
    "#f29bb8",
    "#f9a8d4"
  ],
  "Maison et équipement": [
    "#b08968",
    "#d4a373"
  ],
  "Voyages": [
    "#2bb3c0",
    "#22d3ee"
  ],
  "Assurances": [
    "#7d8fb3",
    "#818cf8"
  ],
  "Sport": [
    "#4caf8e",
    "#4ade80"
  ],
  "Enfants": [
    "#f6b04b",
    "#fbbf24"
  ],
  "Animaux": [
    "#8bbf5b",
    "#a3e635"
  ],
  "Éducation": [
    "#5b7bd6",
    "#5b8cff"
  ],
  "Dons": [
    "#d9806b",
    "#fda4af"
  ]
};
