// Choosing which week the standings' "Thru Wk" column runs through.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderStandings } from "../js/render.js";
import { scoreWeek, standings } from "../js/scoring.js";
import { OWNERS, league } from "./helpers.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const recorded = read("../data/weeks/2026-09.json");
const realLeague = read("../data/league.json");
const baseline = read("./fixtures/baseline-wk8.json");
const wk9 = { week: 9, recorded: true, final: true, settlement: scoreWeek(recorded, recorded.recorded.players, realLeague).settlement };
const real = standings(baseline, [wk9], realLeague);
const rows = (html) => [...html.matchAll(/<th scope="row">([^<]*)<\/th>/g)].map((m) => m[1]);
const mxue = (html) => html.match(/<th scope="row">Mxue<\/th>.*?<\/tr>/)[0];

test("standings keeps the running totals after the baseline and after each recorded week", () => {
  assert.deepEqual(real.history.map((h) => h.week), [8, 9]);
  assert.equal(real.history[0].totals.JD, 57200);
  assert.equal(real.history[0].totals.Mxue, -21800);
  assert.equal(real.history[1].totals.JD, 50000);
  assert.deepEqual(real.history[1].totals, real.base);
});

test("history runs in week order, skips open weeks, and is just the baseline when nothing is recorded", () => {
  const flat = { through_week: 8, totals: Object.fromEntries(OWNERS.map((o) => [o, 0])) };
  const pay = (cents) => Object.fromEntries(OWNERS.map((o, i) => [o, { total: i === 0 ? cents : i === 1 ? -cents : 0 }]));
  const s = standings(flat, [
    { week: 11, recorded: false, final: false, settlement: pay(500) },
    { week: 10, recorded: true, final: true, settlement: pay(300) },
    { week: 9, recorded: true, final: true, settlement: pay(100) },
  ], league);
  assert.deepEqual(s.history.map((h) => [h.week, h.totals.Art, h.totals.Mxue]), [[8, 0, 0], [9, 100, -100], [10, 400, -400]]);
  assert.deepEqual(standings(flat, [], league).history.map((h) => h.week), [8]);
});

test("the Thru Wk header is a week picker, on the latest recorded week by default", () => {
  const html = renderStandings(real, realLeague);
  assert.match(html, /<select class="thru" data-thru aria-label="Standings through week">/);
  assert.match(html, /<option value="8">Thru Wk 8<\/option><option value="9" selected>Thru Wk 9<\/option>/);
  assert.match(html, /<button[^>]*data-sort="base"/);
  assert.match(mxue(html), /Mxue<\/th><td class="money pos">\+\$230<\/td><td class="net money pos">\+\$230<\/td><td class="order">5</);
});

test("picking an earlier week changes only that column", () => {
  const html = renderStandings(real, realLeague, null, 8);
  assert.match(html, /<option value="8" selected>Thru Wk 8<\/option><option value="9">Thru Wk 9<\/option>/);
  assert.match(mxue(html), /Mxue<\/th><td class="money neg">−\$218<\/td><td class="net money pos">\+\$230<\/td><td class="order">5</);
});

test("a week that is not in the history falls back to the latest", () => {
  assert.equal(renderStandings(real, realLeague, null, 5), renderStandings(real, realLeague));
});

test("sorting the Thru Wk column uses the picked week's numbers", () => {
  const html = renderStandings(real, realLeague, { key: "base", dir: "desc" }, 8);
  // through week 8: JohnO +592, JD +572, Art +134, Kevin −92, Mxue −218, Galli −458, Vince −530
  assert.deepEqual(rows(html), ["JohnO", "JD", "Art", "Kevin", "Mxue", "Galli", "Vince"]);
  assert.match(html, /<th aria-sort="descending"><select/);
});

test("with only the baseline there is nothing to pick, so the header is a plain label", () => {
  const html = renderStandings(standings(baseline, [], realLeague), realLeague);
  assert.doesNotMatch(html, /<select/);
  assert.match(html, /<button[^>]*data-sort="base">Thru Wk 8<\/button>/);
});
