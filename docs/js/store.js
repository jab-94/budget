// Données du coffre, en mémoire une fois déchiffrées, et leur sauvegarde chiffrée.
//
// Structure (mêmes champs que les tables de la version Python) :
//   accounts      [{id, name, bank, kind}]
//   categories    [{id, name, kind, color}]
//   rules         [{id, pattern, is_regex, category_id, priority, sign, origin}]
//   statements    [{id, account_id, source, period_start, period_end, opening_balance_cents, closing_balance_cents, imported_at}]
//   transactions  [{id, account_id, statement_id, date, label, amount_cents, category_id,
//                   category_locked, category_source, fingerprint, hint}]
//   budgets       {category_id: monthly_limit_cents}
//   settings      {dismissed_insights: [...], irregular_income_categories: [...]}

import * as cloud from "./cloud.js";
import { b64, decryptObject, deriveKey, encryptObject, newSalt, parseHeader, WrongPassword } from "./crypto.js";
import { DEFAULT_CATEGORIES, DEFAULT_RULES } from "./defaults.js";

export const DATA_VERSION = 1;
export const MIN_PASSWORD_LENGTH = 12;

export function newData() {
  const d = { version: DATA_VERSION, nextId: 1, accounts: [], categories: [], rules: [], statements: [],
    transactions: [], budgets: {}, settings: {} };
  const ids = {};
  for (const c of DEFAULT_CATEGORIES) {
    const id = d.nextId++;
    d.categories.push({ id, ...c });
    ids[c.name] = id;
  }
  for (const r of DEFAULT_RULES) {
    if (!ids[r.category]) continue;
    for (const p of r.patterns) {
      d.rules.push({ id: d.nextId++, pattern: p, is_regex: false, category_id: ids[r.category],
        priority: 100, sign: r.sign, origin: "default" });
    }
  }
  return d;
}

function deviceLabel() {
  let label = null;
  try { label = localStorage.getItem("device-label"); } catch (_) { /* rien */ }
  if (!label) {
    const ua = navigator.userAgent;
    const kind = /iPhone|iPad/.test(ua) ? "iPhone" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "PC" : "Appareil";
    label = `${kind}-${[...crypto.getRandomValues(new Uint8Array(2))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    try { localStorage.setItem("device-label", label); } catch (_) { /* rien */ }
  }
  return label;
}

class Store {
  constructor() { this.reset(); }

  reset() {
    this.data = null;
    this.key = null;
    this.salt = null;
    this.revision = null;
    this.uid = null;
    this.pending = false; // une sauvegarde n'a pas encore pu être envoyée (hors ligne)
    this.lastActivity = Date.now();
  }

  get unlocked() { return this.data !== null; }

  nextId() { return this.data.nextId++; }

  /** État du coffre en ligne (ou, hors ligne, de la copie locale). */
  async peek(uid) {
    try {
      const v = await cloud.readVault(uid);
      return { exists: Boolean(v), offline: false, remote: v };
    } catch (e) {
      const cached = await cloud.cacheGet(uid);
      return { exists: Boolean(cached), offline: true, remote: cached, error: e };
    }
  }

  async create(uid, password) {
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Mot de passe trop court (${MIN_PASSWORD_LENGTH} caractères minimum).`);
    this.uid = uid;
    this.salt = newSalt();
    this.key = await deriveKey(password, this.salt);
    this.data = newData();
    this.revision = null;
    await this.save();
  }

  async unlock(uid, password, remote) {
    const v = remote || (await cloud.readVault(uid)) || (await cloud.cacheGet(uid));
    if (!v) throw new Error("Aucun coffre trouvé pour ce compte.");
    const h = parseHeader(v.header);
    const key = await deriveKey(password, h.saltBytes, h.iterations);
    const data = await decryptObject(key, v.header, b64.decode(v.data)); // lève WrongPassword
    this.uid = uid;
    this.key = key;
    this.salt = h.saltBytes;
    this.revision = v.revision;
    this.data = data;
    this.pending = Boolean(v.pending);
    if (this.pending) await this.save().catch(() => {});
    this.touch();
  }

  touch() { this.lastActivity = Date.now(); }

  lock() { this.reset(); }

  /** Chiffre et envoie. En cas de coupure réseau, garde la version chiffrée en local et réessaiera. */
  async save() {
    const revision = (this.revision || 0) + 1;
    const { header, ciphertext } = await encryptObject(this.key, this.salt, this.data, { revision, device: deviceLabel() });
    const data = b64.encode(ciphertext);
    try {
      await cloud.writeVault(this.uid, { header, data, revision, expectedRevision: this.revision });
      this.revision = revision;
      this.pending = false;
      await cloud.cachePut(this.uid, { header, data, revision, pending: false });
    } catch (e) {
      if (e instanceof cloud.Conflict) throw e;
      // Hors ligne : on garde la version chiffrée localement, envoi au prochain enregistrement.
      this.pending = true;
      await cloud.cachePut(this.uid, { header, data, revision: this.revision, pending: true });
    }
  }

  async changePassword(newPassword) {
    if (newPassword.length < MIN_PASSWORD_LENGTH) throw new Error(`Mot de passe trop court (${MIN_PASSWORD_LENGTH} caractères minimum).`);
    this.salt = newSalt();
    this.key = await deriveKey(newPassword, this.salt);
    await this.save();
  }

  /** Remplace les données par celles d'une sauvegarde (déchiffrée avec SON mot de passe), puis réenregistre. */
  async restoreBackup(json, password) {
    let b;
    try { b = JSON.parse(json); } catch (_) { throw new Error("Ce fichier n'est pas une sauvegarde Budget."); }
    if (!b || b.format !== "budget-local-web" || !b.header || !b.data) throw new Error("Ce fichier n'est pas une sauvegarde Budget.");
    const h = parseHeader(b.header);
    const key = await deriveKey(password, h.saltBytes, h.iterations);
    const data = await decryptObject(key, b.header, b64.decode(b.data)); // lève WrongPassword
    if (!data || !Array.isArray(data.transactions)) throw new Error("Sauvegarde illisible.");
    this.data = data;
    await this.save(); // rechiffré avec le mot de passe ACTUEL du coffre
  }

  /** Copie chiffrée complète (même mot de passe), pour une sauvegarde hors ligne. */
  async exportBackup() {
    const { header, ciphertext } = await encryptObject(this.key, this.salt, this.data, { revision: this.revision || 0, device: deviceLabel() });
    return JSON.stringify({ format: "budget-local-web", header, data: b64.encode(ciphertext) });
  }
}

export const store = new Store();
export { WrongPassword };
