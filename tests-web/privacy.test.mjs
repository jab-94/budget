// Garde-fous de confidentialité de la version web (docs/, publiée sur GitHub Pages).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const WEB = new URL("../docs/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, WEB), "utf8");
const OUR_JS = readdirSync(new URL("js/", WEB)).filter((f) => f.endsWith(".js")).sort().map((f) => `js/${f}`);
const ALLOWED_HOSTS = new Set(["firestore.googleapis.com", "identitytoolkit.googleapis.com", "securetoken.googleapis.com"]);

function csp() {
  const m = read("index.html").match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(m, "CSP absente de docs/index.html");
  return Object.fromEntries(m[1].split("; ").map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));
}

test("la CSP n'autorise que Firebase", () => {
  const c = csp();
  assert.deepEqual(c["default-src"], ["'self'"]);
  assert.deepEqual(c["script-src"], ["'self'"]);
  assert.deepEqual(c["style-src"], ["'self'"]);
  assert.deepEqual(c["object-src"], ["'none'"]);
  assert.deepEqual(c["frame-src"], ["'none'"]);
  const hosts = new Set(c["connect-src"].filter((h) => h !== "'self'").map((h) => h.replace(/^https:\/\//, "")));
  assert.deepEqual(hosts, ALLOWED_HOSTS);
});

test("la page ne charge rien d'externe", () => {
  const html = read("index.html");
  const withoutCsp = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, "");
  assert.ok(!/https?:\/\/|\/\/cdn|fonts\.googleapis/.test(withoutCsp));
  for (const [, src] of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)) {
    assert.ok(!src.startsWith("http") && !src.startsWith("//"), src);
  }
});

test("notre code n'appelle jamais le réseau directement", () => {
  for (const f of [...OUR_JS, "service-worker.js"]) {
    const src = read(f);
    assert.ok(!/https?:\/\//.test(src), f);
    for (const bad of ["XMLHttpRequest", "sendBeacon", "new WebSocket", "EventSource", "importScripts("]) assert.ok(!src.includes(bad), `${f} : ${bad}`);
    if (f !== "service-worker.js") assert.ok(!src.includes("fetch("), f);
    for (const [, a, b] of src.matchAll(/from\s+"([^"]+)"|import\("([^"]+)"\)/g)) {
      const path = a || b;
      assert.ok(path.startsWith("./") || path.startsWith("../"), `${f} : ${path}`);
    }
  }
});

test("le service worker ignore les autres origines", () => {
  assert.ok(read("service-worker.js").includes("url.origin !== self.location.origin"));
});

test("le paquet Firebase n'a ni Analytics ni adresse non autorisée", () => {
  const src = read("vendor/firebase.js");
  const hosts = new Set(src.match(/[a-z0-9.-]+\.googleapis\.com/g) || []);
  for (const h of hosts) assert.ok(ALLOWED_HOSTS.has(h), h);
  for (const bad of ["google-analytics.com", "googletagmanager", "app-measurement.com", "firebaselogging", "measurementId"]) {
    assert.ok(!src.includes(bad), bad);
  }
});

test("le mot de passe du coffre ne sert qu'à dériver la clé", () => {
  const store = read("js/store.js");
  const allowed = /async (create|unlock|changePassword|restoreBackup)\(|\.length < MIN_PASSWORD_LENGTH|deriveKey\((new)?[pP]assword/;
  for (const line of store.split("\n")) {
    if (/\b(password|newPassword)\b/.test(line) && !line.trim().startsWith("//")) {
      assert.ok(allowed.test(line), `usage inattendu du mot de passe du coffre : ${line.trim()}`);
    }
  }
  assert.ok(!store.includes("cloud.login"));
  // Ce qui part vers Firebase : en-tête non secret + bloc chiffré, rien d'autre.
  const cloud = read("js/cloud.js");
  assert.ok(cloud.includes("{ header, data, revision, expectedRevision }"));
  assert.ok(cloud.includes("tx.set(metaRef, { header, chunks: chunks.length, revision, updatedAt"));
});

test("règles Firestore : seul le propriétaire", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.ok(rules.includes("allow read, write: if false;"));
  assert.equal(rules.split("request.auth.uid == uid").length - 1, 2);
});

test("pdf.js : pas d'exécution de code généré", () => {
  assert.ok(read("js/pdfparse.js").includes("isEvalSupported: false"));
});
