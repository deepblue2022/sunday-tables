// The banner ticker: every NFL game of the current week (live first, then finished, then still
// to play), with a league fun fact or comment after every few games. Pure functions, no DOM:
// js/app.js shows one item at a time. Every item is plain text; the page escapes it.

import { fmtMoney } from "./render.js";

const short = (name) => String(name).split(" ").filter((w) => !["Jr.", "Sr.", "II", "III", "IV"].includes(w)).pop();
const dollars = (cents) => fmtMoney(Math.abs(cents)).replace("+", "");

// How long an item stays on screen (before any extra time a long item needs to scroll): live
// games longest, games still to play a quick glance, everything else in between.
export const ITEM_MS = { live: 7000, upcoming: 3000, other: 4500 };
export const itemTime = (item) => (item?.live ? ITEM_MS.live : item?.upcoming ? ITEM_MS.upcoming : ITEM_MS.other);

// Is any NFL game being played right now? The banner only shows while one is.
export const hasLiveGame = (scoreboard) => Boolean(scoreboard?.games?.some((g) => g.phase === "in"));

// One item per game: {text, live, upcoming?}. `fmtKickoff` formats an ISO time ("Sun 1:00 PM").
export function scoreItems(scoreboard, fmtKickoff = (iso) => iso) {
  if (!scoreboard?.games?.length) return [];
  const rank = { in: 0, done: 1, pre: 2, unresolved: 3 };
  return [...scoreboard.games]
    .sort((a, b) => rank[a.phase] - rank[b.phase] || String(a.kickoff).localeCompare(String(b.kickoff)))
    .map((g) => {
      const home = g.home ?? g.teams[1];
      const away = g.teams.find((t) => t !== home) ?? g.teams[0];
      if (g.phase === "pre") return { text: `${away} @ ${home} · ${fmtKickoff(g.kickoff)}`, live: false, upcoming: true };
      if (g.phase === "unresolved") return { text: `${away} @ ${home} · postponed`, live: false };
      const s = g.score ?? {};
      const line = `${away} ${s[away] ?? 0} – ${home} ${s[home] ?? 0}`;
      return { text: `${line} · ${g.detail ?? (g.phase === "done" ? "Final" : "Live")}`, live: g.phase === "in" };
    });
}

// How a fact is introduced. The lead-ins are handed out in turn down the list of facts, so the
// ticker varies evenly; a fact keeps its lead-in from one refresh to the next.
export const LEAD_INS = ["Fun fact:", "Did you know?", "Stat check:", "By the numbers:", "League note:", "For the record:", "Trivia:"];

// Fun facts from the locked-in weeks. `weeks` is the page model's weeks ({week, recorded,
// result}); "side pot" is a Lightning column.
// `extra`: more facts worked out elsewhere (js/analytics.js), given lead-ins along with these.
export function seasonFacts(weeks, league, extra = []) {
  const done = weeks.filter((w) => w.recorded && w.result).sort((a, b) => a.week - b.week);
  if (!done.length) return [];
  const owners = league.owners;
  const latest = done.at(-1).week;
  const facts = [];
  const fact = (s) => facts.push(`${LEAD_INS[facts.length % LEAD_INS.length]} ${s}`);
  const sides = new Map(); // owner -> side pots won
  const potCount = new Map(); // owner -> Team pots won

  for (const o of owners) {
    // side pots (Lightning columns) won, by week
    const sideWeeks = done.filter((w) => w.result.lightning.columns.some((c) => c.winners.includes(o.key) && c.winners.length < owners.length));
    const sideCount = done.reduce((n, w) => n + w.result.lightning.columns.filter((c) => c.winners.includes(o.key) && c.winners.length < owners.length).length, 0);
    if (!sideWeeks.length) fact(`${o.display} hasn't won a side pot all season.`);
    else {
      const dry = latest - sideWeeks.at(-1).week;
      if (dry >= 2) fact(`${o.display} hasn't won a side pot in ${dry} weeks.`);
    }
    // Team pots
    const pots = done.filter((w) => w.result.team.winners.includes(o.key));
    if (!pots.length) fact(`${o.display} has yet to win a Team pot this season.`);
    else if (latest - pots.at(-1).week >= 3) fact(`${o.display} hasn't won the Team pot since Week ${pots.at(-1).week}.`);
    // the current streak, up or down
    let streak = 0;
    const sign = Math.sign(done.at(-1).result.settlement[o.key].total);
    for (let i = done.length - 1; i >= 0 && sign !== 0 && Math.sign(done[i].result.settlement[o.key].total) === sign; i--) streak++;
    if (streak >= 3) fact(`${o.display} has finished ${sign > 0 ? "up" : "down"} ${streak} weeks in a row.`);
    sides.set(o.key, sideCount);
    potCount.set(o.key, pots.length);
  }

  const most = (counts, label) => {
    const top = Math.max(...counts.values());
    const who = owners.filter((o) => counts.get(o.key) === top);
    if (top > 0 && who.length === 1) fact(`${who[0].display} has won the most ${label} this season: ${top}.`);
  };
  most(sides, "side pots");
  most(potCount, "Team pots");

  // season bests and worsts
  const weekly = done.flatMap((w) => owners.map((o) => ({ o, week: w.week, cents: w.result.settlement[o.key].total })));
  const best = weekly.reduce((a, b) => (b.cents > a.cents ? b : a));
  const worst = weekly.reduce((a, b) => (b.cents < a.cents ? b : a));
  fact(`${best.o.display}'s +${dollars(best.cents)} in Week ${best.week} is the best week of the season.`);
  fact(`${worst.o.display}'s −${dollars(worst.cents)} in Week ${worst.week} is the worst week of the season.`);
  const cells = done.flatMap((w) => w.result.lightning.columns.flatMap((c) => owners.map((o) => ({ o, week: w.week, col: c.name, cell: c.cells[o.key] }))));
  const top = cells.reduce((a, b) => (b.cell.points > a.cell.points ? b : a));
  fact(`The top side-pot score this season is ${short(top.cell.name)}'s ${top.cell.points} for ${top.o.display} (${top.col}, Week ${top.week}).`);
  const teams = done.flatMap((w) => owners.map((o) => ({ o, week: w.week, total: w.result.team.rows[o.key].total })));
  const tb = teams.reduce((a, b) => (b.total > a.total ? b : a));
  fact(`The best Team table this season is ${tb.o.display}'s ${tb.total} in Week ${tb.week}.`);

  // ---- more variety ----
  // the one owner with the most of something (no fact when it's a tie at the top)
  const soleTop = (counts) => {
    const top = Math.max(...counts.values());
    const who = [...counts].filter(([, n]) => n === top);
    return who.length === 1 ? { key: who[0][0], n: top } : null;
  };
  const name = (key) => owners.find((o) => o.key === key)?.display ?? key;
  const everyCell = (w, o) => [...w.result.team.rows[o.key].players, ...w.result.lightning.columns.map((c) => c.cells[o.key])];

  // most picks that didn't play (DNP or bye)
  const idle = new Map(owners.map((o) => [o.key, done.reduce((n, w) => n + everyCell(w, o).filter((c) => c.state === "dnp" || c.state === "bye").length, 0)]));
  const mostIdle = soleTop(idle);
  if (mostIdle && mostIdle.n >= 2) fact(`${name(mostIdle.key)} has had ${mostIdle.n} picks not play this season, the most in the league.`);

  // the most-picked player, across every owner and both tables
  const picks = new Map();
  for (const w of done) for (const o of owners) for (const c of everyCell(w, o)) picks.set(c.name, (picks.get(c.name) ?? 0) + 1);
  const popular = soleTop(picks);
  if (popular) fact(`${popular.key} is the most-picked player this season: ${popular.n} times.`);

  // the biggest single side-pot payday
  const paydays = done.flatMap((w) => w.result.lightning.columns.filter((c) => c.winners.length === 1).map((c) => ({ w, c, o: c.winners[0] })));
  if (paydays.length) {
    const p = paydays.reduce((a, b) => (b.c.money[b.o] > a.c.money[a.o] ? b : a));
    const cell = p.c.cells[p.o];
    fact(`The biggest side-pot payday this season is ${name(p.o)}'s +${dollars(p.c.money[p.o])} from ${p.c.name} in Week ${p.w.week} (${short(cell.name)}, ${cell.points}).`);
  }

  // the closest Team pot finish
  const finishes = done
    .map((w) => {
      const t = owners.map((o) => ({ key: o.key, total: w.result.team.rows[o.key].total })).sort((a, b) => b.total - a.total);
      return { week: w.week, first: t[0], second: t[1], margin: t[0].total - t[1].total };
    })
    .filter((f) => f.margin > 0);
  if (finishes.length) {
    const c = finishes.reduce((a, b) => (b.margin < a.margin ? b : a));
    if (c.margin <= 5) fact(`The closest Team pot this season: ${name(c.first.key)} beat ${name(c.second.key)} by ${c.margin} in Week ${c.week}.`);
  }

  // most side pots won in a single week
  const sweeps = done.flatMap((w) => owners.map((o) => ({ o, week: w.week, n: w.result.lightning.columns.filter((c) => c.winners.length === 1 && c.winners[0] === o.key).length })));
  const sw = sweeps.reduce((a, b) => (b.n > a.n ? b : a));
  if (sw.n >= 3 && sweeps.filter((s) => s.n === sw.n).length === 1) fact(`${sw.o.display} won ${sw.n} side pots in Week ${sw.week}, the most in one week this season.`);

  // the best average Team table
  const avg = new Map(owners.map((o) => [o.key, done.reduce((n, w) => n + w.result.team.rows[o.key].total, 0) / done.length]));
  const bestAvg = soleTop(avg);
  if (bestAvg && done.length >= 3) fact(`${name(bestAvg.key)} has the best average Team table this season: ${bestAvg.n.toFixed(1)}.`);

  // the longest run of weeks up this season (not just the current one)
  let longest = null;
  for (const o of owners) {
    let run = 0;
    for (const w of done) {
      run = w.result.settlement[o.key].total > 0 ? run + 1 : 0;
      if (run >= 4 && (!longest || run > longest.run)) longest = { o, run, end: w.week };
    }
  }
  if (longest) fact(`${longest.o.display}'s ${longest.run} weeks up in a row (Weeks ${longest.end - longest.run + 1} to ${longest.end}) is the longest streak this season.`);
  for (const x of extra) fact(x);
  return facts;
}

// The ticker: games, with one comment after every `every` games. `comments` rotate: `turn`
// picks where in the comment list this pass starts, so each pass shows different ones.
export function tickerItems({ games, comments, every = 3, turn = 0 }) {
  if (!games.length) return comments.map((text) => ({ text, live: false, comment: true }));
  const out = [];
  let c = comments.length ? turn % comments.length : 0;
  games.forEach((g, i) => {
    out.push(g);
    if (comments.length && (i + 1) % every === 0) {
      out.push({ text: comments[c % comments.length], live: false, comment: true });
      c++;
    }
  });
  return out;
}
