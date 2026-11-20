// Season analytics from the locked-in weeks, shown as ticker fun facts. Pure functions, no DOM.
//  - Luck (points vs results): given the points an owner's picks actually scored, did they win
//    the money those points usually win? Each score is replayed against the other owners'
//    scores in the same contest in every locked-in week; the average outcome is the expected
//    money. Luck = actual money - expected money.
//  - Hot/cold picks: how far an owner's picks scored above or below those players' own season
//    averages (not called luck: it mixes in how well the players were chosen).
//  - Close calls: pots won or lost by a hair.

import { scoreWeek } from "./scoring.js";
import { fmtMoney } from "./render.js";

const TABLES = ["team_table", "lightning_table"];
const recordedOnly = (weekFiles) => weekFiles.filter((f) => f.recorded).sort((a, b) => a.season - b.season || a.week - b.week);

// Each player's average over every locked-in week they were picked in (once per week).
export function playerAverages(weekFiles) {
  const seen = new Map();
  for (const f of recordedOnly(weekFiles)) {
    for (const [id, p] of Object.entries(f.recorded.players)) seen.set(id, [...(seen.get(id) ?? []), p.points]);
  }
  return new Map([...seen].map(([id, pts]) => [id, pts.reduce((a, b) => a + b, 0) / pts.length]));
}

// Hot/cold picks, per owner: points above (+) or below (-) the picks' own season averages,
// added up over every pick in both tables.
export function pickHeat(weekFiles, league) {
  const owners = league.owners.map((o) => o.key);
  const avg = playerAverages(weekFiles);
  const out = Object.fromEntries(owners.map((o) => [o, 0]));
  for (const f of recordedOnly(weekFiles)) {
    for (const o of owners) for (const t of TABLES) for (const p of f[t].rosters[o]) out[o] += f.recorded.players[p.id].points - avg.get(p.id);
  }
  return out;
}

// What a score earns against a set of opposing scores, by the league's rules (cents; may be
// fractional when a pot is shared).
//  Team pot: everyone puts in `buyIn`; the top score takes the pot (shared on a tie).
//  Side pot: every non-winner pays the winner (top - theirs) x `perPoint`; tied winners share.
export function teamPotMoney(mine, others, buyIn) {
  const top = Math.max(mine, ...others);
  if (mine < top) return -buyIn;
  const winners = 1 + others.filter((s) => s === top).length;
  return (buyIn * (others.length + 1)) / winners - buyIn;
}
export function sidePotMoney(mine, others, perPoint) {
  const top = Math.max(mine, ...others);
  if (mine < top) return -(top - mine) * perPoint;
  const winners = 1 + others.filter((s) => s === top).length;
  const pot = others.filter((s) => s < top).reduce((a, s) => a + (top - s) * perPoint, 0);
  return pot / winners;
}

// Luck (points vs results), per owner: {actual, expected, cents} in cents, where cents is
// actual - expected. Each contest an owner played is replayed: the owner's actual score against
// the other owners' scores in the same contest of every locked-in week (the Team table; a
// Lightning column by its name, so a QB2 score only meets QB2 scores). A column name used in
// only one week compares with itself, which is no luck either way.
export function resultsLuck(weekFiles, league) {
  const owners = league.owners.map((o) => o.key);
  const weeks = recordedOnly(weekFiles).map((f) => scoreWeek(f, f.recorded.players, league));
  const team = weeks.map((r) => Object.fromEntries(owners.map((o) => [o, r.team.rows[o].total])));
  const columns = new Map(); // column name -> [{owner: points}] for every week it was played
  for (const r of weeks) {
    for (const c of r.lightning.columns) {
      columns.set(c.name, [...(columns.get(c.name) ?? []), Object.fromEntries(owners.map((o) => [o, c.cells[o].points]))]);
    }
  }
  const out = Object.fromEntries(owners.map((o) => [o, { actual: 0, expected: 0, cents: 0 }]));
  const replay = (o, mine, sets, money) => sets.reduce((a, set) => a + money(mine, owners.filter((x) => x !== o).map((x) => set[x])), 0) / sets.length;
  weeks.forEach((r, i) => {
    for (const o of owners) {
      out[o].actual += r.settlement[o].total;
      out[o].expected += replay(o, team[i][o], team, (m, others) => teamPotMoney(m, others, league.teamBuyInCents));
      for (const c of r.lightning.columns) {
        out[o].expected += replay(o, c.cells[o].points, columns.get(c.name), (m, others) => sidePotMoney(m, others, league.lightningCentsPerPoint));
      }
    }
  });
  // Replaying scores against other weeks' opponents isn't zero-sum the way the real money is
  // (a side pot pays its winner from six opponents, so a good score is worth more against a
  // random set than a bad one costs), which lifts every owner's expected money a little. Take
  // the league average back off, so expected money adds up to $0 like the real money and luck
  // compares each owner with the rest of the league.
  const lift = owners.reduce((a, o) => a + out[o].expected, 0) / owners.length;
  for (const o of owners) {
    out[o].expected -= lift;
    out[o].cents = out[o].actual - out[o].expected;
  }
  return out;
}

// Close calls, per owner: side pots (Lightning columns) won outright by 2 points or fewer, and
// lost by 2 or fewer (within 2 of a sole winner); Team pots the same with 5 points.
export const CLOSE = { side: 2, team: 5 };
export function closeCalls(weekFiles, league) {
  const owners = league.owners.map((o) => o.key);
  const out = Object.fromEntries(owners.map((o) => [o, { sideWon: 0, sideLost: 0, potWon: 0, potLost: 0 }]));
  const tally = (points, winners, margin, won, lost) => {
    if (winners.length !== 1) return; // a shared pot is neither won nor lost by a hair
    const top = points[winners[0]];
    const rest = owners.filter((o) => o !== winners[0]);
    if (top - Math.max(...rest.map((o) => points[o])) > margin) return;
    out[winners[0]][won]++;
    for (const o of rest) if (top - points[o] <= margin) out[o][lost]++;
  };
  for (const f of recordedOnly(weekFiles)) {
    const r = scoreWeek(f, f.recorded.players, league);
    for (const c of r.lightning.columns) {
      tally(Object.fromEntries(owners.map((o) => [o, c.cells[o].points])), c.winners, CLOSE.side, "sideWon", "sideLost");
    }
    tally(Object.fromEntries(owners.map((o) => [o, r.team.rows[o].total])), r.team.winners, CLOSE.team, "potWon", "potLost");
  }
  return out;
}

const signed = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n))}`;
// luck money is an estimate: whole dollars
const luckMoney = (cents) => fmtMoney(Math.round(cents / 100) * 100);
const times = (n) => (n === 1 ? "once" : `${n} times`);
const pots = (n) => `${n} side pot${n === 1 ? "" : "s"}`;

// The analytics as ticker fun facts (without lead-ins; js/ticker.js adds those): the league
// leaders, then a luck line, a hot/cold line and close calls for every owner.
// The luck lines are held back for now (the scorekeeper's call); pass { luck: true }, or flip
// SHOW_LUCK, to put them in the ticker.
export const SHOW_LUCK = false;
export function analyticsFacts(weekFiles, league, { luck: showLuck = SHOW_LUCK } = {}) {
  if (!recordedOnly(weekFiles).length) return [];
  const luck = showLuck ? resultsLuck(weekFiles, league) : null;
  const heat = pickHeat(weekFiles, league);
  const close = closeCalls(weekFiles, league);
  const owners = league.owners;
  const out = [];
  const ends = (score) => {
    const sorted = [...owners].sort((a, b) => score(b) - score(a));
    return [sorted[0], sorted.at(-1)];
  };

  // luck: points vs results
  if (showLuck) {
    const [lucky, unlucky] = ends((o) => luck[o.key].cents);
    if (luck[lucky.key].cents >= 50) {
      out.push(`${lucky.display} is the luckiest owner this season: ${luckMoney(luck[lucky.key].cents).replace("+", "")} more than their points usually win.`);
    }
    if (luck[unlucky.key].cents <= -50) {
      out.push(`${unlucky.display} is the unluckiest owner this season: ${luckMoney(-luck[unlucky.key].cents).replace("+", "")} less than their points usually win.`);
    }
    for (const o of owners) {
      if (o === lucky || o === unlucky) continue; // already said above
      const c = luck[o.key].cents;
      const what = Math.abs(c) < 50 ? "right about what their points usually win" : `${luckMoney(c)} vs what their points usually win`;
      out.push(`${o.display}'s luck this season: ${what}.`);
    }
  }

  // hot/cold picks: players vs their own usual
  const [hot, cold] = ends((o) => heat[o.key]);
  if (Math.round(heat[hot.key]) > 0) out.push(`${hot.display} has had the hottest picks this season: ${signed(heat[hot.key])} points above the players' usual.`);
  if (Math.round(heat[cold.key]) < 0) out.push(`${cold.display} has had the coldest picks this season: ${Math.abs(Math.round(heat[cold.key]))} points below the players' usual.`);
  for (const o of owners) {
    if (o === hot || o === cold) continue;
    const h = Math.round(heat[o.key]);
    out.push(`${o.display}'s picks have run ${h === 0 ? "right at" : `${Math.abs(h)} points ${h > 0 ? "above" : "below"}`} the players' usual this season.`);
  }

  // close calls
  const most = (field, text) => {
    const top = Math.max(...owners.map((o) => close[o.key][field]));
    const who = owners.filter((o) => close[o.key][field] === top);
    if (top >= 3 && who.length === 1) out.push(text(who[0].display, top));
  };
  most("sideWon", (n, k) => `${n} has won ${k} side pots by ${CLOSE.side} points or fewer, the most in the league.`);
  most("sideLost", (n, k) => `${n} has lost ${k} side pots by ${CLOSE.side} points or fewer, the most in the league.`);
  for (const o of owners) {
    const c = close[o.key];
    if (c.sideWon + c.sideLost >= 3) out.push(`${o.display} has won ${pots(c.sideWon)} by ${CLOSE.side} or fewer and lost ${c.sideLost} that way.`);
    if (c.potLost >= 1) out.push(`${o.display} has missed the Team pot by ${CLOSE.team} points or fewer ${times(c.potLost)} this season.`);
  }
  return out;
}
