import { test } from "node:test";
import assert from "node:assert/strict";
import { playerPoints, splitCents, BLOCKING } from "../js/scoring.js";

test("playerPoints floors each category and adds TDs and 2-pt", () => {
  assert.equal(playerPoints({ passYds: 372, passTD: 3, rushYds: 13, rushTD: 1 }, 2), 36); // Love wk9
  assert.equal(playerPoints({ passYds: 287, rushYds: 48 }), 18);
  assert.equal(playerPoints({ rushYds: 102, rushTD: 1, recYds: 41, recTD: 2 }), 32); // Walker wk9
});

test("playerPoints: negative yards cost points once they reach a whole point (decimals dropped)", () => {
  assert.equal(playerPoints({ passYds: 242, passTD: 1, rushYds: -1 }), 15); // −1 rushing = 0
  assert.equal(playerPoints({ passYds: -3, rushYds: 57 }), 5); // −3 passing = 0
  assert.equal(playerPoints({ rushYds: -11, recYds: 79, recTD: 1 }), 12); // Jefferson wk5: −1 + 7 + 6
  assert.equal(playerPoints({ rushYds: -9 }), 0);
  assert.equal(playerPoints({ rushYds: -10 }), -1);
  assert.equal(playerPoints({ rushYds: -25, passYds: -40 }), -4); // −2 and −2: a total can be negative
  assert.ok(!Object.is(playerPoints({ rushYds: -5 }), -0), "never −0");
});

test("playerPoints counts a 2-pt conversion with no stat line", () => {
  assert.equal(playerPoints({}, 2), 2);
  assert.equal(playerPoints(undefined, 2), 2);
});

test("playerPoints accepts strings and never returns NaN", () => {
  assert.equal(playerPoints({ recYds: "171", recTD: "1" }), 23);
  assert.equal(playerPoints({ recYds: "--", rushTD: undefined, passYds: null }), 0);
});

test("splitCents gives leftover cents in owner order", () => {
  const order = ["Art", "Mxue", "Vince", "Kevin", "Galli", "JD", "JohnO"];
  assert.deepEqual(splitCents(14000, ["JohnO", "Galli", "Vince"], order), { Vince: 4667, Galli: 4667, JohnO: 4666 });
  assert.deepEqual(splitCents(20000, ["Kevin", "JD"], order), { Kevin: 10000, JD: 10000 });
});

test("BLOCKING lists the states that keep a week provisional", () => {
  assert.deepEqual(BLOCKING, ["live", "not_started", "unknown"]);
});

test("playerPoints scores rushing and receiving separately, never netting them", () => {
  assert.equal(playerPoints({ rushYds: 9, recYds: 9 }), 0); // not 18 yards = 1
  assert.equal(playerPoints({ rushYds: -15, recYds: 15 }), 0); // −1 + 1
  assert.equal(playerPoints({ rushYds: -8, recYds: 63 }), 6); // netted would be 55 = 5
});

test("splitCents refuses winners it cannot pay in full", () => {
  const order = ["Art", "Mxue", "Vince"];
  assert.throws(() => splitCents(14000, [], order), /winners/);
  assert.throws(() => splitCents(14000, ["Bob"], order), /winners/);
  assert.throws(() => splitCents(14000, ["Bob", "Art"], order), /winners/);
});
