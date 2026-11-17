// The banner ticker: every NFL game of the current week (live first, then finished, then still
// to play), with a league fun fact or comment after every few games. Pure functions, no DOM:
// js/app.js shows one item at a time. Every item is plain text; the page escapes it.

import { fmtMoney } from "./render.js";

const short = (name) => String(name).split(" ").filter((w) => !["Jr.", "Sr.", "II", "III", "IV"].includes(w)).pop();
const dollars = (cents) => fmtMoney(Math.abs(cents)).replace("+", "");

// Is any NFL game being played right now? The banner only shows while one is.
export const hasLiveGame = (scoreboard) => Boolean(scoreboard?.games?.some((g) => g.phase === "in"));

// One item per game: {text, live}. `fmtKickoff` formats an ISO time ("Sun 1:00 PM").
export function scoreItems(scoreboard, fmtKickoff = (iso) => iso) {
  if (!scoreboard?.games?.length) return [];
  const rank = { in: 0, done: 1, pre: 2, unresolved: 3 };
  return [...scoreboard.games]
    .sort((a, b) => rank[a.phase] - rank[b.phase] || String(a.kickoff).localeCompare(String(b.kickoff)))
    .map((g) => {
      const home = g.home ?? g.teams[1];
      const away = g.teams.find((t) => t !== home) ?? g.teams[0];
      if (g.phase === "pre") return { text: `${away} @ ${home} · ${fmtKickoff(g.kickoff)}`, live: false };
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
export function seasonFacts(weeks, league) {
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
