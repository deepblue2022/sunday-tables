// Season analytics: luck (points vs results), hot/cold picks, close calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { playerAverages, pickHeat, teamPotMoney, sidePotMoney, resultsLuck, closeCalls, analyticsFacts } from "../js/analytics.js";
import { build, column, league, OWNERS } from "./helpers.js";

// A recorded week from the test helper (every player final, unique ids per owner and slot).
const recordedWeek = (week, teamPts, lightPts) => {
  const { weekFile, playersById } = build(teamPts, lightPts);
  return { ...weekFile, week, recorded: { players: playersById } };
};

test("playerAverages and pickHeat: picks above or below the players' own season average", () => {
  const w1 = recordedWeek(1, { Art: [30] });
  const w2 = recordedWeek(2, { Art: [10] });
  const live = { ...recordedWeek(3, { Art: [99] }), recorded: undefined }; // not locked in: ignored
  assert.equal(playerAverages([w1, w2, live]).get("T-Art-0"), 20);
  assert.equal(pickHeat([w1, w2], league).Art, 0); // +10 then -10
});

test("teamPotMoney and sidePotMoney follow the league's rules", () => {
  assert.equal(teamPotMoney(50, [40, 30, 20, 10, 0, 0], 2000), 12000);
  assert.equal(teamPotMoney(50, [50, 30, 20, 10, 0, 0], 2000), 5000); // shared pot
  assert.equal(teamPotMoney(40, [50, 30, 20, 10, 0, 0], 2000), -2000);
  assert.equal(sidePotMoney(10, [8, 0, 0, 0, 0, 0], 200), (2 + 50) * 200);
  assert.equal(sidePotMoney(8, [10, 0, 0, 0, 0, 0], 200), -2 * 200);
  assert.equal(sidePotMoney(10, [10, 0, 0, 0, 0, 0], 200), (5 * 10 * 200) / 2); // tied winners share
});

test("resultsLuck: a score that loses only because of a freak week is unlucky; luck adds up to $0", () => {
  // Week 1: Art's Team table 60 loses to Kevin's 61. Weeks 2-3: nobody else gets near 60.
  const weeks = [
    recordedWeek(1, { Art: [60], Kevin: [61], Vince: [10] }),
    recordedWeek(2, { Art: [12], Kevin: [20], Vince: [30] }),
    recordedWeek(3, { Art: [12], Kevin: [20], Vince: [30] }),
  ];
  const luck = resultsLuck(weeks, league);
  assert.ok(luck.Art.cents < 0, JSON.stringify(luck.Art)); // 60 usually wins the pot, but lost once
  assert.ok(luck.Vince.cents > 0); // 30 won twice, but would have lost in Week 1
  assert.ok(Math.abs(luck.Kevin.cents) < 1e-6); // 61 wins in any week: earned, not lucky
  assert.ok(Math.abs(OWNERS.reduce((n, o) => n + luck[o].cents, 0)) < 1e-6);
  assert.ok(Math.abs(OWNERS.reduce((n, o) => n + luck[o].expected, 0)) < 1e-6);
  // the same results every week: nobody is lucky or unlucky
  const same = [recordedWeek(1, { Art: [50], Kevin: [40] }, column(0, { Art: 9 })), recordedWeek(2, { Art: [50], Kevin: [40] }, column(0, { Art: 9 }))];
  for (const o of OWNERS) assert.ok(Math.abs(resultsLuck(same, league)[o].cents) < 1e-6);
});

test("closeCalls: side pots by 2 or fewer, Team pots by 5 or fewer; shared pots don't count", () => {
  const w = recordedWeek(1, { Art: [50], JD: [46], Galli: [40] }, { ...column(0, { Kevin: 10, Vince: 9, Mxue: 8, JD: 7 }) });
  const c = closeCalls([w], league);
  assert.deepEqual(c.Kevin, { sideWon: 1, sideLost: 0, potWon: 0, potLost: 0 });
  assert.equal(c.Vince.sideLost, 1);
  assert.equal(c.Mxue.sideLost, 1);
  assert.equal(c.JD.sideLost, 0); // 3 behind: not close
  assert.equal(c.Art.potWon, 1);
  assert.equal(c.JD.potLost, 1);
  assert.equal(c.Galli.potLost, 0); // 10 behind
  assert.equal(closeCalls([recordedWeek(1, {}, column(0, { Kevin: 10, Vince: 10 }))], league).Kevin.sideWon, 0);
});

test("the real season through Week 10", () => {
  const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), "utf8"));
  const realLeague = read("league.json");
  const files = [];
  for (let w = 1; w <= 10; w++) files.push(read(`weeks/2026-${String(w).padStart(2, "0")}.json`));
  const luck = resultsLuck(files, realLeague);
  const dollars = (o) => Math.round(luck[o].cents / 100);
  assert.deepEqual(Object.fromEntries(realLeague.owners.map((o) => [o.key, dollars(o.key)])), { Art: -98, Mxue: 206, Vince: -47, Kevin: -183, Galli: 183, JD: 61, JohnO: -121 });
  for (const o of realLeague.owners) assert.equal(luck[o.key].actual, luck[o.key].expected + luck[o.key].cents);
  // the luck lines are held back by default
  assert.ok(!analyticsFacts(files, realLeague).some((f) => /luck/i.test(f)));
  const facts = analyticsFacts(files, realLeague, { luck: true });
  for (const want of [
    "Mxue is the luckiest owner this season: $206 more than their points usually win.",
    "Kevin is the unluckiest owner this season: $183 less than their points usually win.",
    "Galli's luck this season: +$183 vs what their points usually win.",
    "JD has had the hottest picks this season: +69 points above the players' usual.",
    "Vince has had the coldest picks this season: 111 points below the players' usual.",
    "Kevin's picks have run 48 points below the players' usual this season.",
    "JohnO has won 7 side pots by 2 points or fewer, the most in the league.",
    "Galli has won 1 side pot by 2 or fewer and lost 3 that way.",
    "Vince has missed the Team pot by 5 points or fewer once this season.",
  ]) assert.ok(facts.includes(want), `missing: ${want}\n${facts.join("\n")}`);
  assert.equal(facts.filter((f) => /'s luck this season:/.test(f)).length, realLeague.owners.length - 2);
  assert.doesNotMatch(facts.join(" "), /\b(he|him|his|she|her)\b/i);
  // the analytics are in the ticker only: no section on the page
  assert.doesNotMatch(readFileSync(new URL("../index.html", import.meta.url), "utf8"), /id="analytics"/);
});

test("nothing locked in yet: no analytics facts", () => {
  const { weekFile } = build();
  assert.deepEqual(analyticsFacts([weekFile], league), []);
});
