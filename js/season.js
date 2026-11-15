// The season view: what everyone would pay or collect if the season ended today (money is
// settled once, at the end of the season) and a chart of each owner's running total. Pure
// string builders, no DOM; js/app.js adds the chart's hover readout. All money is integer cents.

import { esc, fmtMoney } from "./render.js";

// The fewest payments that settle `totals` (owner key -> cents, summing to 0): the biggest
// debtor pays the biggest creditor, repeatedly. Ties keep league order. Returns
// [{from, to, cents}].
export function settleUp(totals, ownerKeys) {
  const sum = ownerKeys.reduce((a, k) => a + (totals[k] ?? 0), 0);
  if (sum !== 0) throw new Error(`settleUp: totals must add up to 0 (they add up to ${sum} cents)`);
  const side = (sign) =>
    ownerKeys
      .filter((k) => Math.sign(totals[k]) === sign)
      .map((k) => ({ k, left: Math.abs(totals[k]) }))
      .sort((a, b) => b.left - a.left || ownerKeys.indexOf(a.k) - ownerKeys.indexOf(b.k));
  const payers = side(-1);
  const takers = side(1);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < payers.length && j < takers.length) {
    const cents = Math.min(payers[i].left, takers[j].left);
    out.push({ from: payers[i].k, to: takers[j].k, cents });
    payers[i].left -= cents;
    takers[j].left -= cents;
    if (payers[i].left === 0) i++;
    if (takers[j].left === 0) j++;
  }
  return out;
}

const nameOf = (league, k) => league.owners.find((o) => o.key === k)?.display ?? k;

// Plain text for the group chat.
export function settleUpText(totals, league, throughWeek) {
  const keys = league.owners.map((o) => o.key);
  const lines = [`Sunday Tables: if the season ended after Week ${throughWeek}`];
  for (const p of settleUp(totals, keys)) lines.push(`${nameOf(league, p.from)} pays ${nameOf(league, p.to)} ${fmtMoney(p.cents).replace("+", "")}`);
  return lines.join("\n");
}

// The "if the season ended today" section, from the locked-in totals.
export function renderSettleUp(totals, league, throughWeek) {
  const keys = league.owners.map((o) => o.key);
  if (keys.every((k) => totals[k] === 0)) return `<p class="pot">Nothing to settle yet.</p>`;
  const pays = settleUp(totals, keys);
  const rows = pays
    .map(
      (p) =>
        `<tr><th scope="row">${esc(nameOf(league, p.from))}</th><td class="pays">pays</td>` +
        `<td class="to">${esc(nameOf(league, p.to))}</td><td class="money">${esc(fmtMoney(p.cents).replace("+", ""))}</td></tr>`,
    )
    .join("\n");
  return (
    `<p class="season-note">Money is settled once, at the end of the season. Locked-in weeks only (through Week ${esc(throughWeek)}).</p>` +
    `<div class="table-wrap"><table class="grid settle"><tbody>\n${rows}\n</tbody></table></div>` +
    `<button type="button" id="copy-settle" class="copy">Copy for the group chat</button><span id="copy-done" class="copy-done" role="status"></span>`
  );
}

// ---------- Season chart ----------

// A "nice" step for about `count` gridlines over `span` dollars: 1, 2 or 5 times a power of ten.
function niceStep(span, count) {
  const raw = Math.max(span, 1) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw);
}

export const CHART = { w: 640, h: 280, left: 56, right: 14, top: 14, bottom: 30 };

// Geometry shared by the SVG and the hover readout: x position of each week, y of a value.
export function chartScale(history) {
  const values = history.flatMap((h) => Object.values(h.totals)).map((c) => c / 100);
  const step = niceStep(Math.max(...values, 0) - Math.min(...values, 0), 5);
  const lo = Math.floor(Math.min(...values, 0) / step) * step;
  const hi = Math.ceil(Math.max(...values, 0) / step) * step || step;
  const { w, h, left, right, top, bottom } = CHART;
  const n = Math.max(history.length - 1, 1);
  const x = (i) => left + ((w - left - right) * i) / n;
  const y = (dollars) => top + ((h - top - bottom) * (hi - dollars)) / (hi - lo);
  const ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  return { x, y, ticks, lo, hi };
}

// The running total of every owner after each locked-in week (history[0] is the starting
// totals). Owner i is drawn in colour slot i+1 (CSS --s1...), so a colour always means the
// same owner.
export function renderSeasonChart(history, league) {
  if (history.length < 2) return `<p class="pot">The chart starts once a week is locked in.</p>`;
  const { x, y, ticks } = chartScale(history);
  const { w, h, left, right } = CHART;
  const money = (d) => (d === 0 ? "$0" : `${d < 0 ? "−" : ""}$${Math.abs(d)}`);
  const grid = ticks
    .map((t) => `<line class="${t === 0 ? "zero" : "gridline"}" x1="${left}" x2="${w - right}" y1="${y(t)}" y2="${y(t)}"/><text class="ytick" x="${left - 6}" y="${y(t) + 4}">${money(t)}</text>`)
    .join("");
  const weeks = history
    .map((hh, i) => (i === 0 ? "" : `<text class="xtick" x="${x(i)}" y="${h - 10}">${esc(hh.week)}</text>`))
    .join("");
  const lines = league.owners
    .map((o, k) => {
      const pts = history.map((hh, i) => `${x(i).toFixed(1)},${y(hh.totals[o.key] / 100).toFixed(1)}`).join(" ");
      return `<polyline class="sline" data-owner="${esc(o.key)}" style="stroke: var(--s${k + 1})" points="${pts}"/>`;
    })
    .join("");
  const latest = history.at(-1);
  const summary = league.owners.map((o) => `${o.display} ${fmtMoney(latest.totals[o.key])}`).join(", ");
  const legend = league.owners
    .map(
      (o, k) =>
        `<button type="button" class="key" data-owner="${esc(o.key)}" aria-pressed="false"><span class="swatch" style="background: var(--s${k + 1})"></span>${esc(o.display)}</button>`,
    )
    .join("");
  const head = `<tr><th>Team</th>${history.map((hh, i) => `<th>${i === 0 ? "Start" : `Wk ${esc(hh.week)}`}</th>`).join("")}</tr>`;
  const body = league.owners
    .map((o) => `<tr><th scope="row">${esc(o.display)}</th>${history.map((hh) => `<td class="money">${esc(fmtMoney(hh.totals[o.key]))}</td>`).join("")}</tr>`)
    .join("\n");
  return (
    `<div class="legend" role="group" aria-label="Highlight an owner">${legend}</div>` +
    `<div class="chart-wrap"><svg class="season" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(`Running totals after Week ${latest.week}: ${summary}`)}">` +
    `${grid}${weeks}${lines}` +
    `<line class="cross" x1="0" x2="0" y1="${CHART.top}" y2="${h - CHART.bottom}" visibility="hidden"/>` +
    `<rect class="hit" x="${left}" y="0" width="${w - left - right}" height="${h}" fill="transparent"/></svg>` +
    `<div class="tip" hidden></div></div>` +
    `<details class="as-table"><summary>Show as a table</summary><div class="table-wrap"><table class="grid"><thead>${head}</thead><tbody>\n${body}\n</tbody></table></div></details>`
  );
}
