/**
 * Table themes. Each one is a set of color variables in index.css, chosen
 * by setting data-theme on <html>. Players pick one in the lobby; this
 * browser remembers it.
 */

export type ThemeId = "felt" | "midnight" | "ember" | "parchment";

export const THEMES: { id: ThemeId; name: string; swatch: [string, string, string] }[] = [
  // swatch: table, rail, accent (shown in the picker so you can see each theme)
  { id: "felt", name: "Felt Table", swatch: ["#0f1a14", "#5b4636", "#d9a441"] },
  { id: "midnight", name: "Midnight", swatch: ["#0d1220", "#3a4766", "#8fb3ff"] },
  { id: "ember", name: "Ember", swatch: ["#1a100d", "#6b3a24", "#e3793b"] },
  { id: "parchment", name: "Parchment", swatch: ["#ece3cf", "#9b7b55", "#7a2e22"] },
];

const PREF_KEY = "freebound.theme";

export function loadTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(PREF_KEY);
    if (THEMES.some((t) => t.id === saved)) return saved as ThemeId;
  } catch {
    // Storage unavailable: fall through to the default.
  }
  return "felt";
}

/** Shows the theme on the page and remembers it for next time. */
export function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(PREF_KEY, id);
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this visit.
  }
}