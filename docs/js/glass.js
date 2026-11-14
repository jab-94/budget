// Chargement de la bibliothèque Liquid Glass (React embarqué dans vendor/), sur téléphone seulement,
// et petites passerelles pour l'utiliser depuis le reste de l'app (JavaScript sans React).
// Sur ordinateur, ou si le chargement échoue, tout retombe sur les éléments HTML d'origine.

export const isPhone = () => matchMedia("(max-width: 860px)").matches;

let promise = null;
let lg = null;

/** Charge la bibliothèque (une seule fois). Renvoie null sur ordinateur. */
export function loadGlass() {
  if (!isPhone()) return Promise.resolve(null);
  if (!promise) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "vendor/liquidglass.css";
    document.head.prepend(link); // avant app.css : nos règles gardent la priorité
    promise = import("../vendor/liquidglass.js").then((m) => { lg = m; return m; });
  }
  return promise;
}

const host = (cls) => { const d = document.createElement("div"); d.className = cls; document.body.append(d); return d; };

// ---------- Fenêtres : feuille en verre sur téléphone, <dialog> sinon ----------
const sheets = new Map();

/** Ouvre la fenêtre `dialogId` : son <form> passe dans une feuille qui monte du bas (téléphone). */
export function openModal(dialogId) {
  const dialog = document.getElementById(dialogId);
  if (!lg) { dialog.showModal(); return; }
  let s = sheets.get(dialogId);
  if (!s) {
    const form = dialog.querySelector("form");
    s = lg.mount(host("glass-sheet-host"), "Sheet", { "aria-label": form.querySelector("h2")?.textContent || "Fenêtre",
      detents: ["large"], open: false, content: form, contentClass: "sheet-form",
      onOpenChange: (open) => { if (!open) closeModal(dialogId); } });
    s.dialog = dialog;
    s.form = form;
    sheets.set(dialogId, s);
  }
  s.isOpen = true;
  s.update({ open: true });
}

export function closeModal(dialogId) {
  const s = sheets.get(dialogId);
  if (s) {
    s.isOpen = false;
    s.update({ open: false });
    // Une fois la feuille refermée, le formulaire retourne dans sa <dialog> (masquée) : le reste de
    // l'app le retrouve dans la page pour le préremplir avant la prochaine ouverture.
    setTimeout(() => { if (!s.isOpen) s.dialog.append(s.form); }, 450);
    return;
  }
  const dialog = document.getElementById(dialogId);
  if (dialog.open) dialog.close();
}

export const isModalOpen = (dialogId) => (sheets.has(dialogId) ? sheets.get(dialogId).isOpen : document.getElementById(dialogId).open);

// ---------- Questions oui / non : alerte iOS sur téléphone, confirm() sinon ----------
let alertBox = null;

/** Pose une question ; renvoie true si l'utilisateur confirme. */
export function askConfirm(message, { confirmLabel = "Confirmer", destructive = false, title = null } = {}) {
  if (!lg) return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { if (answered) return; answered = true; alertBox.update({ open: false }); resolve(v); };
    const props = { open: true, title: title || message, message: title ? message : undefined,
      onOpenChange: (open) => { if (!open) done(false); },
      actions: [{ label: "Annuler", role: "cancel", onSelect: () => done(false) },
        { label: confirmLabel, role: destructive ? "destructive" : undefined, onSelect: () => done(true) }] };
    if (!alertBox) alertBox = lg.mount(host("glass-alert-host"), "Alert", props);
    else alertBox.update(props);
  });
}
