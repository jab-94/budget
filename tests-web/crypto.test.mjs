// Tests du chiffrement de la version web (même Web Crypto que dans les navigateurs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64, decryptObject, deriveKey, encryptObject, newSalt, WrongPassword } from "../docs/js/crypto.js";

const data = { transactions: [{ label: "CB BOULANGERIE MARTIN", amount_cents: -450 }], accounts: [{ name: "LCL" }] };

test("aller-retour : chiffré puis déchiffré à l'identique", async () => {
  const salt = newSalt();
  const key = await deriveKey("phrase de passe longue", salt, 1000);
  const { header, ciphertext } = await encryptObject(key, salt, data, { revision: 1, device: "test", iterations: 1000 });
  assert.deepEqual(await decryptObject(key, header, ciphertext), data);
});

test("le bloc envoyé en ligne ne contient aucune donnée lisible", async () => {
  const salt = newSalt();
  const key = await deriveKey("phrase de passe longue", salt, 1000);
  const { header, ciphertext } = await encryptObject(key, salt, data, { revision: 1, device: "test", iterations: 1000 });
  const stored = header + b64.encode(ciphertext) + Buffer.from(ciphertext).toString("latin1");
  for (const secret of ["BOULANGERIE", "MARTIN", "LCL", "450", "transactions"]) assert.ok(!stored.includes(secret), secret);
});

test("mauvais mot de passe refusé", async () => {
  const salt = newSalt();
  const key = await deriveKey("phrase de passe longue", salt, 1000);
  const { header, ciphertext } = await encryptObject(key, salt, data, { revision: 1, device: "t", iterations: 1000 });
  const wrong = await deriveKey("autre phrase de passe", salt, 1000);
  await assert.rejects(decryptObject(wrong, header, ciphertext), WrongPassword);
});

test("toute modification (données ou en-tête) est détectée", async () => {
  const salt = newSalt();
  const key = await deriveKey("phrase de passe longue", salt, 1000);
  const { header, ciphertext } = await encryptObject(key, salt, data, { revision: 1, device: "t", iterations: 1000 });
  const bad = new Uint8Array(ciphertext); bad[bad.length - 1] ^= 1;
  await assert.rejects(decryptObject(key, header, bad), WrongPassword);
  const h2 = header.replace('"revision":1', '"revision":2');
  await assert.rejects(decryptObject(key, h2, ciphertext), WrongPassword);
});

test("dérivation de clé : 600 000 itérations PBKDF2-SHA256 par défaut", async () => {
  const { KDF_ITERATIONS } = await import("../docs/js/crypto.js");
  assert.equal(KDF_ITERATIONS, 600000);
});
