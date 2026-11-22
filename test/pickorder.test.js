// The Lightning draft: rows in pick order, as pasted, with each round's first pick marked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderLightning, fmtMoney } from "../js/render.js";
import { scoreWeek, validateWeekFile, pickOrder, pickOrderProblem } from "../js/scoring.js";
import { resolveDraft, formatWeek, recordWeek, applyPlayedTeams } from "../cli/lib.mjs";
import { build, league, OWNERS } from "./helpers.js";

const ORDER = ["Vince", "Art", "Mxue", "Kevin", "Galli", "JohnO", "JD"];
const rows = (html) => [...html.matchAll(/<tr><th scope="row">([^<]+)<\/th>/g)].map((m) => m[1]);

test("rows follow the pick order and round i's first pick (by pick_order[i]) is marked ◆, with a key", () => {
  const { weekFile, playersById } = build();
  const html = renderLightning(scoreWeek(weekFile, playersById, league), league, null, ORDER);
  const [players, money] = html.split("<h3>$ by column</h3>");
  assert.deepEqual(rows(players), ORDER);
  assert.deepEqual(rows(money), ORDER); // the $ table lines up with it
  // exactly one mark per round, on the round's first pick: Vince in column 0, Art in 1, ...
  const table = players.slice(0, players.indexOf("</table>"));
  assert.equal((table.match(/<span class="first" aria-hidden="true">◆<\/span>/g) ?? []).length, ORDER.length);
  assert.doesNotMatch(table, />1st</); // not a rank
  // a one-line key explains the mark
  assert.match(players, /<p class="pick-key">.*◆<\/span> chose this round's position and picked first<\/p>/);
  ORDER.forEach((o, i) => assert.match(players, new RegExp(`data-card="l\\|${i}\\|${o}" aria-label="${o} L${i} \\(first pick of the round\\)`)));
});

test("without a pick order: league order and no marks", () => {
  const { weekFile, playersById } = build();
  const html = renderLightning(scoreWeek(weekFile, playersById, league), league);
  assert.deepEqual(rows(html.split("<h3>")[0]), OWNERS);
  assert.doesNotMatch(html, /class="first"|pick-key/);
});

test("a bad pick_order never stops a week from scoring: it is ignored, with a reason for the CLI", () => {
  const { weekFile, playersById } = build();
  weekFile.lightning_table.pick_order = ORDER;
  assert.deepEqual(pickOrder(weekFile, league), ORDER);
  assert.equal(pickOrderProblem(weekFile, league), null);
  for (const bad of [["Vince", "Art"], [...ORDER.slice(0, 6), "Vince"], [...ORDER.slice(0, 6), "Nobody"], "Vince", null]) {
    weekFile.lightning_table.pick_order = bad;
    assert.doesNotThrow(() => validateWeekFile(weekFile, league), JSON.stringify(bad));
    assert.equal(pickOrder(weekFile, league), null, JSON.stringify(bad));
    assert.match(pickOrderProblem(weekFile, league), /must list every owner once/);
    // the week still scores, and the table falls back to league order with no marks
    const html = renderLightning(scoreWeek(weekFile, playersById, league), league, null, bad);
    assert.deepEqual(rows(html.split("<h3>")[0]), OWNERS);
    assert.doesNotMatch(html, /class="first"/);
  }
  delete weekFile.lightning_table.pick_order;
  assert.equal(pickOrderProblem(weekFile, league), null); // no order recorded: nothing to warn about
});

test("the CLI text lists the Lightning section in pick order, like the site; the rest stays in league order", () => {
  const { weekFile, playersById } = build();
  const result = scoreWeek(weekFile, playersById, league);
  const st = { recordedThrough: 0, base: Object.fromEntries(OWNERS.map((o) => [o, 0])), open: [], totals: Object.fromEntries(OWNERS.map((o) => [o, 0])), order: Object.fromEntries(OWNERS.map((o) => [o, 1])) };
  const text = formatWeek(result, st, league, ORDER);
  const lightning = text.slice(text.indexOf("== Lightning table =="), text.indexOf("== Settlement"));
  const firstColumn = lightning.split("\n")[1];
  assert.deepEqual([...firstColumn.matchAll(/(\w+):/g)].map((m) => m[1]), ORDER);
  assert.match(lightning, new RegExp(ORDER.join(" +")));
  const settlement = text.slice(text.indexOf("== Settlement"));
  assert.match(settlement, new RegExp(OWNERS.join(" +")));
  // the grid says which order it is in, and every amount sits under its owner
  assert.match(lightning, /\$ by column \(pick order\)/);
  const lines = lightning.split("\n");
  const header = lines.find((l) => /^ +Vince +Art/.test(l));
  const firstRow = lines[lines.indexOf(header) + 1];
  const col = (line, i) => line.slice(20 + 10 * i, 30 + 10 * i).trim();
  ORDER.forEach((o, i) => {
    assert.equal(col(header, i), o);
    assert.equal(col(firstRow, i), fmtMoney(result.lightning.columns[0].money[o]));
  });
});

test("the CLI text falls back to league order for an order that wasn't checked first", () => {
  const { weekFile, playersById } = build();
  const result = scoreWeek(weekFile, playersById, league);
  const st = { recordedThrough: 0, base: Object.fromEntries(OWNERS.map((o) => [o, 0])), open: [], totals: Object.fromEntries(OWNERS.map((o) => [o, 0])), order: Object.fromEntries(OWNERS.map((o) => [o, 1])) };
  for (const bad of [[...ORDER.slice(0, 6), "Nobody"], "Vince", ["Art"]]) {
    const text = formatWeek(result, st, league, bad); // must not throw
    assert.match(text, /\$ by column\n/);
    assert.doesNotMatch(text, /pick order/);
  }
});

test("the resolver keeps pick_order from the draft", () => {
  const draft = {
    season: 2026,
    week: 11,
    team_table: { columns: ["QB"], rosters: { Art: ["Pat One"] } },
    lightning_table: { columns: ["QB2"], pick_order: ["Art"], rosters: { Art: ["Pat One"] } },
  };
  const out = resolveDraft(draft, [{ id: "1", name: "Pat One", team: "AAA", pos: "QB" }]);
  assert.deepEqual(out.lightning_table.pick_order, ["Art"]);
  // an empty value is dropped rather than stored
  const none = resolveDraft({ ...draft, lightning_table: { ...draft.lightning_table, pick_order: null } }, [{ id: "1", name: "Pat One", team: "AAA", pos: "QB" }]);
  assert.equal("pick_order" in none.lightning_table, false);
});

test("Weeks 10 and 11 carry the pick order from the pasted tables", () => {
  const read = (w) => JSON.parse(readFileSync(new URL(`../data/weeks/2026-${w}.json`, import.meta.url), "utf8"));
  const realLeague = JSON.parse(readFileSync(new URL("../data/league.json", import.meta.url), "utf8"));
  const w10 = read("10");
  const w11 = read("11");
  assert.deepEqual(w10.lightning_table.pick_order, ["Vince", "Galli", "Kevin", "Art", "Mxue", "JohnO", "JD"]);
  assert.deepEqual(w11.lightning_table.pick_order, ORDER);
  for (const w of [w10, w11]) {
    assert.doesNotThrow(() => validateWeekFile(w, realLeague));
    assert.equal(pickOrderProblem(w, realLeague), null);
  }
  // round 1: Vince chose QB2 and took Maye (Week 10) / Mahomes (Week 11)
  assert.equal(w10.lightning_table.rosters.Vince[0].name, "Drake Maye");
  assert.equal(w11.lightning_table.rosters.Vince[0].name, "Patrick Mahomes");
});

test("locking in a week and correcting teams keep the pick order", () => {
  const { weekFile, playersById } = build();
  weekFile.lightning_table.pick_order = ORDER;
  const recorded = recordWeek(weekFile, playersById, scoreWeek(weekFile, playersById, league), {});
  assert.deepEqual(recorded.lightning_table.pick_order, ORDER);
  const { weekFile: moved } = applyPlayedTeams(weekFile, { "L-Art-0": "ZZZ" });
  assert.deepEqual(moved.lightning_table.pick_order, ORDER);
});
