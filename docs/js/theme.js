// Applique le thème choisi (clair / sombre / auto) AVANT l'affichage de la page.
// Le choix est gardé dans le navigateur de cet ordinateur (préférence d'affichage, aucune donnée).
"use strict";
(function () {
  let choice = null;
  try { choice = localStorage.getItem("theme"); } catch (_) { /* stockage indisponible */ }
  if (choice === "light" || choice === "dark") document.documentElement.dataset.theme = choice;
  // Transparence de la barre d'onglets en verre (0 = teintée, 0,5 = normale, 1 = transparente).
  let glass = null;
  try { glass = localStorage.getItem("glass-transparency"); } catch (_) { /* stockage indisponible */ }
  if (glass !== null && !Number.isNaN(Number(glass))) document.documentElement.style.setProperty("--lg-transparency", String(Number(glass)));
})();
