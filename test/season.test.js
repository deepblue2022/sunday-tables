// The season view: end-of-season settle-up and the running-total chart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { settleUp, settleUpText, renderSettleUp, renderSeasonChart, chartScale } from "../js/season.js";
import { standings, scoreWeek } from "../js/scoring.js";
import { league, OWNERS } from "./helpers.js";

const totals = (t) => ({ ...Object.fromEntries(OWNERS.map((o) => [o, 0])), ...t });

test("settleUp: every debt is paid, every credit collected, with at most owners-1 payments", () => {
  const t = totals({ Art: 7400, Mxue: 23000, Vince: -72600, Kevin: -13400, Galli: -35200, JD: 50000, JohnO: 40800 });
  const pays = settleUp(t, OWNERS);
  assert.ok(pays.length <= OWNERS.length - 1);
  const net = Object.fromEntries(OWNERS.map((o) => [o, 0]));
  for (const p of pays) {
    assert.ok(p.cents > 0);
    net[p.from] -= p.cents;
    net[p.to] += p.cents;
  }
  assert.deepEqual(net, t);
  // the biggest debtor pays the biggest creditor first
  assert.deepEqual(pays[0], { from: "Vince", to: "JD", cents: 50000 });
});

test("settleUp: nothing owed means no payments; totals that do not add up to 0 are refused", () => {
  assert.deepEqual(settleUp(totals({}), OWNERS), []);
  assert.throws(() => settleUp(totals({ Art: 100 }), OWNERS), /add up to 0/);
});

test("renderSettleUp: payments and the copy button, no dinner duty", () => {
  const t = totals({ Vince: -72600, Galli: -35200, Kevin: -13400, JD: 50000, JohnO: 40800, Art: 7400, Mxue: 23000 });
  const html = renderSettleUp(t, league, 9);
  assert.match(html, /through Week 9/);
  assert.match(html, /<th scope="row">Vince<\/th><td class="pays">pays<\/td><td class="to">JD<\/td><td class="money">\$500<\/td>/);
  assert.doesNotMatch(html, /dinner/i);
  assert.match(html, /id="copy-settle"/);
  assert.match(renderSettleUp(totals({}), league, 0), /Nothing to settle yet/);
});

test("settleUpText: plain lines for the group chat", () => {
  const text = settleUpText(totals({ Vince: -1000, JD: 600, Art: 400 }), league, 9);
  assert.equal(text, "Sunday Tables: if the season ended after Week 9\nVince pays JD $6\nVince pays Art $4");
});

test("renderSeasonChart: one line per owner in a fixed colour slot, a legend, and a table view", () => {
  const history = [
    { week: 0, totals: totals({}) },
    { week: 1, totals: totals({ Art: 5000, Vince: -5000 }) },
    { week: 2, totals: totals({ Art: 2000, Vince: -9000, JD: 7000 }) },
  ];
  const html = renderSeasonChart(history, league);
  assert.equal((html.match(/<polyline class="sline"/g) ?? []).length, OWNERS.length);
  OWNERS.forEach((o, i) => assert.match(html, new RegExp(`data-owner="${o}" style="stroke: var\\(--s${i + 1}\\)"`)));
  assert.equal((html.match(/<button type="button" class="key"/g) ?? []).length, OWNERS.length);
  assert.match(html, /<th>Start<\/th><th>Wk 1<\/th><th>Wk 2<\/th>/);
  assert.match(html, /aria-label="Running totals after Week 2: Art \+\$20, Mxue \$0, Vince −\$90/);
  assert.match(renderSeasonChart(history.slice(0, 1), league), /starts once a week is locked in/);
});

test("chartScale: the y range covers every total and 0, with round gridlines", () => {
  const history = [{ week: 0, totals: totals({}) }, { week: 1, totals: totals({ JD: 73400, Vince: -72600, Art: -800 }) }];
  const { ticks, lo, hi, y } = chartScale(history);
  assert.ok(lo <= -726 && hi >= 734);
  assert.ok(ticks.includes(0));
  assert.ok(ticks.every((t) => t % 100 === 0 || t % 250 === 0 || t % 50 === 0));
  assert.ok(y(hi) < y(0) && y(0) < y(lo)); // higher money is higher on the chart
});

test("the real season: settle-up balances after Week 9", () => {
  const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), "utf8"));
  const realLeague = read("league.json");
  const weeks = [];
  for (let w = 1; w <= 9; w++) {
    const f = read(`weeks/2026-0${w}.json`);
    weeks.push({ week: w, recorded: true, final: true, settlement: scoreWeek(f, f.recorded.players, realLeague).settlement });
  }
  const st = standings(read("baseline.json"), weeks, realLeague);
  const keys = realLeague.owners.map((o) => o.key);
  const net = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const p of settleUp(st.base, keys)) {
    net[p.from] -= p.cents;
    net[p.to] += p.cents;
  }
  assert.deepEqual(net, st.base);
  assert.equal(st.history.length, 10);
});
