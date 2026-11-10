// Sorting the settlement and standings tables by a clicked column.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSettlement, renderStandings, nextSort } from "../js/render.js";
import { OWNERS, league } from "./helpers.js";

const by = (values) => Object.fromEntries(OWNERS.map((o, i) => [o, values[i]]));
// Owner order: Art, Mxue, Vince, Kevin, Galli, JD, JohnO
const total = by([-6000, 44800, -19600, -4200, 10600, -7200, -18400]);
const light = by([-4000, 46800, -17600, -2200, -3400, -5200, -16400]);
const pot = by([-2000, -2000, -2000, -2000, 14000, -2000, -2000]);
const result = {
  final: true,
  settlement: Object.fromEntries(OWNERS.map((o) => [o, { lightning: light[o], teamPot: pot[o], total: total[o] }])),
};
const table = (open) => ({
  recordedThrough: 8,
  base: by([13400, -21800, -53000, -9200, -45800, 57200, 59200]),
  open,
  totals: by([7400, 23000, -72600, -13400, -35200, 50000, 40800]),
  order: by([4, 5, 1, 3, 2, 7, 6]),
});
const wk9 = { week: 9, provisional: false, amounts: total };
const rows = (html) => [...html.matchAll(/<th scope="row">([^<]*)<\/th>/g)].map((m) => m[1]);

test("with no sort the tables keep league order and every header is a sort button", () => {
  const s = renderSettlement(result, league);
  assert.deepEqual(rows(s), OWNERS);
  for (const key of ["team", "lightning", "teamPot", "total"]) assert.match(s, new RegExp(`<button[^>]*data-sort="${key}"`));
  assert.doesNotMatch(s, /aria-sort/);
  const t = renderStandings(table([wk9]), league);
  assert.deepEqual(rows(t), OWNERS);
  for (const key of ["team", "base", "wk-9", "total", "order"]) assert.match(t, new RegExp(`<button[^>]*data-sort="${key}"`));
});

test("settlement sorts by a money column, high to low and low to high", () => {
  const desc = renderSettlement(result, league, { key: "total", dir: "desc" });
  assert.deepEqual(rows(desc), ["Mxue", "Galli", "Kevin", "Art", "JD", "JohnO", "Vince"]);
  assert.match(desc, /<th aria-sort="descending"><button[^>]*data-sort="total"/);
  assert.equal(desc.match(/aria-sort/g).length, 1);
  const asc = renderSettlement(result, league, { key: "total", dir: "asc" });
  assert.deepEqual(rows(asc), ["Vince", "JohnO", "JD", "Art", "Kevin", "Galli", "Mxue"]);
  assert.match(asc, /<th aria-sort="ascending"><button[^>]*data-sort="total"/);
});

test("settlement keeps each owner's numbers with their row when sorted", () => {
  const html = renderSettlement(result, league, { key: "lightning", dir: "desc" });
  assert.match(html, /<th scope="row">Mxue<\/th><td class="money pos">\+\$468<\/td><td class="money neg">−\$20<\/td><td class="net money pos">\+\$448<\/td>/);
  assert.equal(rows(html)[0], "Mxue");
});

test("equal values stay in league order", () => {
  const html = renderSettlement(result, league, { key: "teamPot", dir: "asc" });
  assert.deepEqual(rows(html), ["Art", "Mxue", "Vince", "Kevin", "JD", "JohnO", "Galli"]);
});

test("the Team column sorts by name", () => {
  assert.deepEqual(rows(renderSettlement(result, league, { key: "team", dir: "asc" })), [...OWNERS].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(rows(renderStandings(table([wk9]), league, { key: "team", dir: "desc" })), [...OWNERS].sort((a, b) => b.localeCompare(a)));
});

test("standings sort by baseline, an open week, total and order", () => {
  const s = table([wk9]);
  assert.deepEqual(rows(renderStandings(s, league, { key: "total", dir: "desc" })), ["JD", "JohnO", "Mxue", "Art", "Kevin", "Galli", "Vince"]);
  assert.deepEqual(rows(renderStandings(s, league, { key: "order", dir: "asc" })), ["Vince", "Galli", "Kevin", "Art", "Mxue", "JohnO", "JD"]);
  assert.deepEqual(rows(renderStandings(s, league, { key: "base", dir: "desc" })).slice(0, 2), ["JohnO", "JD"]);
  const wk = renderStandings(s, league, { key: "wk-9", dir: "desc" });
  assert.deepEqual(rows(wk).slice(0, 2), ["Mxue", "Galli"]);
  assert.match(wk, /<th aria-sort="descending"><button[^>]*data-sort="wk-9"/);
});

test("a sort that cannot apply leaves league order", () => {
  // a week column that is gone, and a week whose scores have not loaded
  assert.deepEqual(rows(renderStandings(table([wk9]), league, { key: "wk-10", dir: "desc" })), OWNERS);
  const notLoaded = table([{ week: 10, provisional: true, amounts: null }]);
  assert.deepEqual(rows(renderStandings(notLoaded, league, { key: "wk-10", dir: "desc" })), OWNERS);
  assert.deepEqual(rows(renderSettlement(result, league, { key: "nope", dir: "asc" })), OWNERS);
});

test("nextSort: first click sorts, second reverses, third goes back to league order", () => {
  let s = nextSort(null, "total");
  assert.deepEqual(s, { key: "total", dir: "desc" });
  s = nextSort(s, "total");
  assert.deepEqual(s, { key: "total", dir: "asc" });
  assert.equal(nextSort(s, "total"), null);
  // names start A to Z; a different column starts afresh
  assert.deepEqual(nextSort(null, "team"), { key: "team", dir: "asc" });
  assert.deepEqual(nextSort({ key: "team", dir: "asc" }, "team"), { key: "team", dir: "desc" });
  assert.deepEqual(nextSort({ key: "total", dir: "asc" }, "order"), { key: "order", dir: "desc" });
});
