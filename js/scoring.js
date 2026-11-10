// Pure scoring engine: no I/O. Runs in the browser and in Node. All money is integer cents.

export const BLOCKING = ["live", "not_started", "unknown"];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const yards = (v, per) => Math.floor(Math.max(num(v), 0) / per);

export function playerPoints(statLine, twoPt = 0) {
  const s = statLine || {};
  return (
    yards(s.passYds, 20) + yards(s.rushYds, 10) + yards(s.recYds, 10) +
    3 * num(s.passTD) + 6 * (num(s.rushTD) + num(s.recTD)) + num(twoPt)
  );
}

// Split totalCents among winners; leftover cents go one each in ownerOrder.
export function splitCents(totalCents, winners, ownerOrder) {
  const ordered = ownerOrder.filter((o) => winners.includes(o));
  const share = Math.floor(totalCents / ordered.length);
  let left = totalCents - share * ordered.length;
  const out = {};
  for (const o of ordered) out[o] = share + (left-- > 0 ? 1 : 0);
  return out;
}
