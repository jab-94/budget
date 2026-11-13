// Chiffrement du coffre, entièrement dans le navigateur (Web Crypto).
//
// - Clé : PBKDF2-SHA256, 600 000 itérations, sel aléatoire de 16 octets, à partir du
//   mot de passe du coffre. Le mot de passe ne quitte JAMAIS l'appareil.
// - Données : JSON -> compression gzip -> AES-256-GCM (iv aléatoire de 12 octets).
// - L'en-tête (non secret : sel, iv, révision…) est authentifié (données associées) :
//   toute modification du fichier est détectée.

export const KDF_ITERATIONS = 600000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64 = {
  encode(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  decode(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

export class WrongPassword extends Error {}

export async function deriveKey(password, salt, iterations = KDF_ITERATIONS) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
export const gzip = (bytes) => pipe(bytes, new CompressionStream("gzip"));
export const gunzip = (bytes) => pipe(bytes, new DecompressionStream("gzip"));

export function newSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}

/**
 * Chiffre un objet. Renvoie { header (texte JSON), ciphertext (Uint8Array) }.
 * header contient : v, kdf, iterations, salt, iv, revision, device, updated.
 */
export async function encryptObject(key, salt, obj, { revision, device, iterations = KDF_ITERATIONS }) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = JSON.stringify({
    v: 1, kdf: "pbkdf2-sha256", iterations, salt: b64.encode(salt), iv: b64.encode(iv),
    revision, device, updated: new Date().toISOString(),
  });
  const plain = await gzip(enc.encode(JSON.stringify(obj)));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(header) }, key, plain);
  return { header, ciphertext: new Uint8Array(ct) };
}

export function parseHeader(header) {
  const h = JSON.parse(header);
  if (h.v !== 1 || h.kdf !== "pbkdf2-sha256") throw new Error("Format de coffre non reconnu.");
  return { ...h, saltBytes: b64.decode(h.salt), ivBytes: b64.decode(h.iv) };
}

/** Déchiffre. Lève WrongPassword si le mot de passe est faux OU si le fichier a été modifié. */
export async function decryptObject(key, header, ciphertext) {
  const h = parseHeader(header);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: h.ivBytes, additionalData: enc.encode(header) }, key, ciphertext);
  } catch (_) {
    throw new WrongPassword("Mot de passe incorrect.");
  }
  return JSON.parse(dec.decode(await gunzip(new Uint8Array(plain))));
}
