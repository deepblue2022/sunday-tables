// Commentary for the banner: lines written from the live scores of the week on screen, plus the
// weekly hand-written batch (data/banter.json). Pure functions, no DOM: js/app.js shows them.
// Every line is plain text; the page escapes it. Wording stays neutral about the owners
// (no he/she): the jokes are about picks and money only.

import { fmtMoney } from "./render.js";

const short = (name) => String(name).split(" ").filter((w) => !["Jr.", "Sr.", "II", "III", "IV"].includes(w)).pop();
const money = (cents) => fmtMoney(Math.abs(cents)).replace("+", "");
const pick = (variants, seed) => variants[Math.abs(seed) % variants.length];
// A stable number from a string, so a situation keeps its wording from one refresh to the next.
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

const PLAYED = ["live", "final"];
const isZero = (c) => (c.state === "final" && c.points === 0) || c.state === "dnp";

// Lines about the week on screen. `result` is scoreWeek's output, `standings` the standings
// model (or null), `extra.onLast` maps an owner to lines used when that owner is last in the standings.
export function liveBanter({ result, standings = null, league, weekFile, extra = {} }) {
  if (!result) return [];
  const owners = league.owners;
  const name = (key) => owners.find((o) => o.key === key)?.display ?? key;
  const perPoint = league.lightningCentsPerPoint * (owners.length - 1); // a point's worth to a column winner
  const pot = `$${(league.teamBuyInCents * owners.length) / 100}`;
  const NUM = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const word = (n) => NUM[n] ?? String(n);
  const others = word(owners.length - 1); // "the other six"
  const everyone = word(owners.length).replace(/^./, (c) => c.toUpperCase()); // "Seven"
  const lines = [];
  const add = (key, variants) => lines.push(pick(variants, hash(key)));
  // Situations that can pile up (zeros late on a Sunday) are capped so the rest still get airtime.
  const capped = {};
  const addCapped = (kind, max, key, variants) => {
    capped[kind] = capped[kind] ?? { max, items: [] };
    capped[kind].items.push({ key, text: pick(variants, hash(key)) });
  };
  const started = result.team.started || result.lightning.columns.some((c) => c.started) || Boolean(result.thanksgiving?.started);
  const order = standings ? [...owners].sort((a, b) => standings.totals[a.key] - standings.totals[b.key]) : null;

  if (!started) {
    if (order) {
      const last = order[0].display;
      const first = order[order.length - 1].display;
      add("pre", [
        `Nothing has kicked off yet, so everyone is undefeated this week. Enjoy it while it lasts, ${last}.`,
        `No scores yet. This is the closest ${last} will be to the lead all week.`,
        `Kickoff is coming. ${first} is on top of the season and pretending not to check the standings.`,
        `All square until kickoff. ${last}, this is your moment. Statistically, it's also your only one.`,
      ]);
    }
    return lines;
  }

  // ---- Lightning columns ----
  const leads = {}; // owner -> columns led
  for (const col of result.lightning.columns) {
    const ranked = owners
      .map((o) => ({ owner: o.key, cell: col.cells[o.key] }))
      .sort((a, b) => b.cell.points - a.cell.points);
    const [first, second] = ranked;
    const margin = first.cell.points - second.cell.points;
    const leader = name(first.owner);
    const player = short(first.cell.name);
    if (col.started && margin > 0) leads[first.owner] = [...(leads[first.owner] ?? []), col.name];

    // a close race still being played
    if (col.provisional && col.started && margin <= 2 && first.cell.points > 0 && PLAYED.includes(second.cell.state)) {
      add(`close|${col.name}`, [
        `${col.name}: ${short(first.cell.name)} ${first.cell.points}, ${short(second.cell.name)} ${second.cell.points}. Every point is worth ${money(perPoint)} to whoever ends up on top.`,
        `${col.name} is a knife fight: ${name(first.owner)} ${first.cell.points}, ${name(second.owner)} ${second.cell.points}. Somebody do something.`,
        `${name(first.owner)} and ${name(second.owner)} are ${margin === 0 ? "dead level" : `${margin} apart`} in ${col.name}. One catch could swing it.`,
      ]);
    }
    // still alive: trailing, but the owner's player has yet to play
    if (col.provisional && col.started) {
      for (const r of ranked.slice(1)) {
        const gap = first.cell.points - r.cell.points;
        if (r.cell.state === "not_started" && gap > 0 && gap <= 15) {
          add(`alive|${col.name}|${r.owner}`, [
            `${name(r.owner)} trails ${col.name} by ${gap}, but ${short(r.cell.name)} hasn't played yet. Don't count them out.`,
            `${leader}, don't get comfortable in ${col.name}: ${name(r.owner)}'s ${short(r.cell.name)} is still to play, ${gap} back.`,
            `${name(r.owner)} is ${gap} behind in ${col.name} with ${short(r.cell.name)} still in the locker room. Hope is a dangerous thing.`,
          ]);
          break;
        }
      }
    }
    // The column leader gets at most one line: a big game, else a runaway, else a big pot.
    const take = col.money[first.owner];
    if (col.started && margin > 0 && first.cell.points >= 25 && PLAYED.includes(first.cell.state)) {
      add(`big|${col.name}|${first.owner}`, [
        `${player} has dropped ${first.cell.points} for ${leader}. Somebody check on the rest of the ${col.name} column.`,
        `${first.cell.points} from ${player}. ${leader} is pretending this was the plan all along.`,
        `${player}: ${first.cell.points} points${col.provisional ? " and counting" : ""}. ${leader} would like to thank the academy.`,
      ]);
    } else if (col.started && margin >= 10 && PLAYED.includes(first.cell.state)) {
      add(`run|${col.name}|${first.owner}`, [
        `${leader}'s ${player} has ${first.cell.points} in ${col.name}. The rest of the ${col.name} column is just paying the bill.`,
        `${col.name} is ${leader}'s${col.provisional ? " to lose" : ""}: ${player} is up ${margin} on the field. That's ${money(margin * league.lightningCentsPerPoint)} from each of you.`,
        `${player} has ${first.cell.points} for ${leader}. Everyone else in ${col.name}, please form an orderly queue.`,
        `${leader} leads ${col.name} by ${margin}. The other ${others} are competing for second place, which pays nothing.`,
      ]);
    } else if (col.started && margin > 0 && take >= 25000) {
      add(`col$|${col.name}|${first.owner}`, [
        `${col.name} is worth ${money(take)} to ${leader} right now. The other ${others} are splitting the bill.`,
        `${leader} is collecting ${money(take)} from ${col.name} alone. Some people have jobs; ${leader} has ${player}.`,
      ]);
    }
    // a tie at the top with real points, once both games are under way or over
    if (col.started && margin === 0 && first.cell.points >= 10 && PLAYED.includes(first.cell.state) && PLAYED.includes(second.cell.state)) {
      add(`tie|${col.name}|${first.owner}|${second.owner}`, [
        `${col.name} is a dead heat: ${name(first.owner)}'s ${short(first.cell.name)} and ${name(second.owner)}'s ${short(second.cell.name)} on ${first.cell.points} each. Everyone else pays twice.`,
        `${name(first.owner)} and ${name(second.owner)} are tied in ${col.name} on ${first.cell.points}. Splitting the winnings, doubling the misery.`,
      ]);
    }
    // everyone level on 0 after games have started
    if (col.started && first.cell.points === 0 && ranked.some((r) => PLAYED.includes(r.cell.state))) {
      addCapped("nil", 1, `nil|${col.name}`, [
        `${col.name}: games are under way and nobody has a point. Riveting stuff.`,
        `${col.name} is still 0 across the board. ${everyone} owners, no ideas.`,
      ]);
    }
  }

  // one owner leading several columns
  for (const [owner, cols] of Object.entries(leads)) {
    if (cols.length >= 3) {
      add(`sweep|${owner}|${cols.length}`, [
        `${name(owner)} leads ${cols.length} Lightning columns (${cols.join(", ")}). Leave some for the rest of the league.`,
        `${name(owner)} is top of ${cols.join(", ")}. This is starting to look like a hostile takeover.`,
      ]);
    }
  }

  // ---- zeros, in both tables ----
  const zeroCount = {};
  const zeroLine = (o, c, where) => {
    zeroCount[o.key] = (zeroCount[o.key] ?? 0) + 1;
    addCapped("zero", 6, `zero|${where}|${o.key}|${c.id}`, [
      `${o.display}'s ${short(c.name)}: ${c.state === "dnp" ? "DNP" : "0 points"}${where ? ` in ${where}` : ""}. A bold strategy.`,
      `${short(c.name)} gave ${o.display} a clean 0${where ? ` in ${where}` : ""}. Very efficient. Very bad.`,
      `${o.display} started ${short(c.name)}${where ? ` in ${where}` : ""} and got exactly what they paid for: nothing.`,
      `${short(c.name)} put up a 0 for ${o.display}. Somewhere, a fantasy analyst is deleting a tweet.`,
    ]);
  };
  for (const col of result.lightning.columns) for (const o of owners) if (isZero(col.cells[o.key])) zeroLine(o, col.cells[o.key], col.name);
  for (const o of owners) for (const c of result.team.rows[o.key].players) if (isZero(c)) zeroLine(o, c, "the Team table");
  for (const [owner, n] of Object.entries(zeroCount)) {
    if (n >= 2) {
      add(`zeros|${owner}|${n}`, [
        `${name(owner)} has ${n} players on a finished zero this week. That's not bad luck, that's a lifestyle.`,
        `${n} zeros for ${name(owner)} so far. The roster is less a lineup, more a cry for help.`,
      ]);
    }
  }

  // ---- the Team table ----
  const sig = (key) => result.team.rows[key].players.map((c) => c.id).sort().join(",");
  const twins = owners.filter((o, i) => owners.some((p, j) => j !== i && sig(p.key) === sig(o.key)));
  if (twins.length >= 2) {
    const pair = twins.slice(0, 2).map((o) => o.display);
    add(`twins|${pair.join("|")}`, [
      `${pair[0]} and ${pair[1]} sent in the same Team table. Whatever happens to one happens to both. Touching.`,
      `${pair[0]} and ${pair[1]}: same Team table, same fate. At least they'll split the blame.`,
      `${pair[0]} and ${pair[1]} picked the identical Team table. Copying homework is allowed here, apparently.`,
    ]);
  }
  const totals = owners.map((o) => ({ key: o.key, total: result.team.rows[o.key].total })).sort((a, b) => b.total - a.total);
  if (result.team.started) {
    const [t1, t2] = totals;
    const tl = totals[totals.length - 1];
    if (t1.total > t2.total) {
      add(
        `team|${t1.key}`,
        result.team.provisional
          ? [
              `${name(t1.key)} leads the Team table with ${t1.total}. The ${pot} pot is starting to look nervous.`,
              `${name(t1.key)} is on top of the Team table, ${t1.total - t2.total} ahead of ${name(t2.key)}. Plenty of football left. Probably.`,
              `${name(t1.key)}'s Team table has ${t1.total}. ${name(t2.key)} is ${t1.total - t2.total} back and refreshing furiously.`,
            ]
          : [
              `${name(t1.key)} takes the ${pot} Team pot with ${t1.total}. Drinks are not on ${name(t1.key)}.`,
              `${name(t1.key)} wins the Team table with ${t1.total}, ${t1.total - t2.total} clear of ${name(t2.key)}. Expect to hear about it.`,
            ],
      );
    }
    if (result.team.provisional && t1.total - t2.total <= 5 && t1.total > 0) {
      add(`teamclose|${t1.key}|${t2.key}`, [
        `The Team table is a race: ${name(t1.key)} ${t1.total}, ${name(t2.key)} ${t2.total}. ${pot} says somebody's going to be very annoying tonight.`,
        `${t1.total - t2.total === 0 ? "Dead level" : `Just ${t1.total - t2.total} points`} between ${name(t1.key)} and ${name(t2.key)} for the ${pot} pot. Nails, meet teeth.`,
      ]);
    }
    // the bottom, once that owner's five players are all done
    const done = result.team.rows[tl.key].players.every((c) => ["final", "dnp", "bye"].includes(c.state));
    if (done && tl.total < t1.total) {
      add(`teamlast|${tl.key}`, [
        `${name(tl.key)}'s Team table finished on ${tl.total}. The pot sends its regards.`,
        `${name(tl.key)} is bottom of the Team table with ${tl.total}. ${tl.total < 40 ? "Bold to pick five players and have none of them show up." : "Respectable, and completely useless."}`,
      ]);
    }
  }

  // ---- this week's money ----
  const net = owners.map((o) => ({ key: o.key, cents: result.settlement[o.key].total })).sort((a, b) => a.cents - b.cents);
  const worst = net[0];
  const best = net[net.length - 1];
  if (worst.cents <= -4000) {
    add(`pay|${worst.key}`, [
      `${name(worst.key)} is on pace to hand over ${money(worst.cents)} this week. Venmo is standing by.`,
      `${name(worst.key)}: −${money(worst.cents)} this week and counting. The league thanks you for your generosity.`,
      `${name(worst.key)} is down ${money(worst.cents)} this week. It's not a loss, it's an investment in everyone else.`,
    ]);
  }
  if (best.cents >= 8000) {
    add(`win|${best.key}`, [
      `${name(best.key)} is up ${money(best.cents)} this week. Act humble. Nobody believes you.`,
      `${name(best.key)} is ${money(best.cents)} up this week and already planning how to spend it.`,
      `${name(best.key)}: +${money(best.cents)} this week. The group chat is about to be unbearable.`,
    ]);
  }

  // ---- the live standings ----
  if (order) {
    const last = order[0];
    const first = order[order.length - 1];
    const lastLine = extra.onLast?.[last.key];
    add(`last|${last.key}`, [
      `${last.display} is last in the live standings at ${fmtMoney(standings.totals[last.key])}.${lastLine?.length ? ` ${pick(lastLine, hash(last.key + result.team.rows[last.key].total))}` : ""}`,
    ]);
    add(`first|${first.key}`, [
      `${first.display} leads the season at ${fmtMoney(standings.totals[first.key])}. Everyone else: this is your fault.`,
      `${first.display} is top of the live standings at ${fmtMoney(standings.totals[first.key])}. Insufferable, and correct.`,
      `${first.display} sits on top of the season at ${fmtMoney(standings.totals[first.key])}. Please clap.`,
    ]);
    // places changing hands compared with the settled standings (before this week)
    if (standings.base) {
      const settled = [...owners].sort((a, b) => standings.base[a.key] - standings.base[b.key]);
      const wasFirst = settled[settled.length - 1];
      const wasLast = settled[0];
      if (wasFirst.key !== first.key) {
        add(`newfirst|${first.key}|${wasFirst.key}`, [
          `${first.display} has passed ${wasFirst.display} for first in the live standings. ${wasFirst.display} is refreshing nervously.`,
          `Change at the top: ${first.display} is first if it ends now, ${wasFirst.display} drops to chasing.`,
        ]);
      }
      if (wasLast.key !== last.key) {
        add(`newlast|${last.key}|${wasLast.key}`, [
          `${wasLast.display} is out of last place in the live standings! ${last.display} has taken over the basement.`,
          `Breaking: ${wasLast.display} has climbed out of last. ${last.display}, the basement is all yours, for now.`,
        ]);
      }
    }
  }
  // the capped situations: a stable but mixed selection (by hash), not just the first columns
  for (const { max, items } of Object.values(capped)) {
    lines.push(...[...items].sort((a, b) => hash(a.key) - hash(b.key)).slice(0, max).map((i) => i.text));
  }
  return [...new Set(lines)];
}

// The banner's pool for a week: live lines (while it is unrecorded) taking turns with the
// hand-written batch, so tapping through alternates between the two. Each is {text, live}.
export function banterPool({ week, result, standings, league, weekFile, banter }) {
  const live = week && !week.recorded && result ? liveBanter({ result, standings, league, weekFile, extra: { onLast: banter?.on_last } }) : [];
  const written = Array.isArray(banter?.lines) ? banter.lines.filter((l) => typeof l === "string" && l.trim()) : [];
  const out = [];
  for (let i = 0; i < Math.max(live.length, written.length); i++) {
    if (i < live.length) out.push({ text: live[i], live: true });
    if (i < written.length) out.push({ text: written[i], live: false });
  }
  return out;
}
