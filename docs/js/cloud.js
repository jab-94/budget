// Synchronisation du coffre CHIFFRÉ avec Firebase (Firestore) et copie locale (IndexedDB).
//
// Firebase ne reçoit que : un en-tête non secret (sel, iv, numéro de révision, date)
// et un bloc chiffré illisible, découpé en morceaux (limite Firestore : 1 Mo par document).
//
//   vaults/{uid}                 { header, chunks, revision, updatedAt }
//   vaults/{uid}/chunks/{0..n}   { data }   (base64 du bloc chiffré)
//
// Les règles de sécurité Firestore n'autorisent que VOTRE compte (voir firestore.rules).

import { FIREBASE_CONFIG } from "./config.js";
import {
  initializeApp, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  getFirestore, doc, getDoc, runTransaction, collection,
} from "../vendor/firebase.js";

const CHUNK_CHARS = 900000; // < 1 Mo par document

let app, auth, db;

export function init() {
  if (app) return;
  app = initializeApp(FIREBASE_CONFIG);
  // Pas de « popupRedirectResolver » : aucune fenêtre ni iframe Google n'est chargée.
  auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  db = getFirestore(app);
}

export function onUser(cb) {
  init();
  return onAuthStateChanged(auth, cb);
}

export async function login(email, password) {
  init();
  try {
    return (await signInWithEmailAndPassword(auth, email, password)).user;
  } catch (e) {
    const code = String(e.code || "");
    if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
      throw new Error("E-mail ou mot de passe du compte incorrect.");
    }
    if (code.includes("too-many-requests")) throw new Error("Trop d'essais : patientez quelques minutes.");
    if (code.includes("network")) throw new Error("Pas de connexion Internet.");
    throw new Error("Connexion impossible.");
  }
}

export async function logout() {
  init();
  await signOut(auth);
}

export const currentUser = () => (auth ? auth.currentUser : null);

export class Conflict extends Error {}

/** Lit le coffre chiffré en ligne. Renvoie null s'il n'existe pas encore. */
export async function readVault(uid) {
  init();
  const meta = await getDoc(doc(db, "vaults", uid));
  if (!meta.exists()) return null;
  const m = meta.data();
  const parts = [];
  for (let i = 0; i < m.chunks; i++) {
    const c = await getDoc(doc(db, "vaults", uid, "chunks", String(i)));
    if (!c.exists()) throw new Error("Coffre en ligne incomplet : réessayez dans un instant.");
    parts.push(c.data().data);
  }
  return { header: m.header, data: parts.join(""), revision: m.revision };
}

/**
 * Écrit le coffre chiffré, SEULEMENT si la révision en ligne est celle attendue
 * (sinon un autre appareil a modifié le coffre entre-temps : Conflict).
 */
export async function writeVault(uid, { header, data, revision, expectedRevision }) {
  init();
  const chunks = [];
  for (let i = 0; i < data.length; i += CHUNK_CHARS) chunks.push(data.slice(i, i + CHUNK_CHARS));
  await runTransaction(db, async (tx) => {
    const metaRef = doc(db, "vaults", uid);
    const cur = await tx.get(metaRef);
    const onlineRev = cur.exists() ? cur.data().revision : null;
    if (onlineRev !== expectedRevision) throw new Conflict("Le coffre a été modifié sur un autre appareil.");
    const oldCount = cur.exists() ? cur.data().chunks : 0;
    chunks.forEach((c, i) => tx.set(doc(collection(db, "vaults", uid, "chunks"), String(i)), { data: c }));
    for (let i = chunks.length; i < oldCount; i++) tx.delete(doc(db, "vaults", uid, "chunks", String(i)));
    tx.set(metaRef, { header, chunks: chunks.length, revision, updatedAt: new Date().toISOString() });
  });
}

// --- Copie locale chiffrée (IndexedDB) -------------------------------------------------------------
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("budget-local", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("vault");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function cacheGet(uid) {
  try {
    const d = await idb();
    return await new Promise((resolve) => {
      const r = d.transaction("vault").objectStore("vault").get(uid);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    });
  } catch (_) { return null; }
}

export async function cachePut(uid, value) {
  try {
    const d = await idb();
    await new Promise((resolve) => {
      const t = d.transaction("vault", "readwrite");
      t.objectStore("vault").put(value, uid);
      t.oncomplete = resolve;
      t.onerror = resolve;
    });
  } catch (_) { /* stockage indisponible : le coffre en ligne reste la référence */ }
}

export async function cacheClear() {
  try {
    const d = await idb();
    await new Promise((resolve) => {
      const t = d.transaction("vault", "readwrite");
      t.objectStore("vault").clear();
      t.oncomplete = resolve;
      t.onerror = resolve;
    });
  } catch (_) { /* rien */ }
}
