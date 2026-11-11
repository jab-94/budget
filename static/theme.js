// Applique le thème choisi (clair / sombre / auto) AVANT l'affichage de la page.
// Le choix est gardé dans le navigateur de cet ordinateur (préférence d'affichage, aucune donnée).
"use strict";
(function () {
  let choice = null;
  try { choice = localStorage.getItem("theme"); } catch (_) { /* stockage indisponible */ }
  if (choice === "light" || choice === "dark") document.documentElement.dataset.theme = choice;
})();
