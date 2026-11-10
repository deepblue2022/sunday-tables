// Presentation helpers: pure string builders, no DOM. Shared by the page and the CLI.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// Integer cents -> "+$448", "−$60", "$0"; cents are shown only when the amount is not whole dollars.
export function fmtMoney(cents) {
  const abs = Math.abs(cents);
  const amount = abs % 100 === 0 ? String(abs / 100) : (abs / 100).toFixed(2);
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  return `${sign}$${amount}`;
}

export const STATE_TAG = { live: "LIVE", dnp: "DNP", bye: "BYE", unknown: "?" };
// Players whose game has not produced a score yet show a dash instead of points.
export const showsDash = (state) => state === "not_started" || state === "unknown";
