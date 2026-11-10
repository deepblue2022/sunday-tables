#!/usr/bin/env node
// League scoring CLI. Run through `npm run score -- ...` (adds --use-system-ca, which this
// network's proxy certificate needs).
//
//   npm run score -- resolve <draft.json> [--out <file>]   resolve names to ESPN players
//   npm run score -- <season> <week>                       print tables, settlement, standings
//   npm run score -- <season> <week> --record              freeze a final week into its week file
import { readFile, writeFile } from "node:fs/promises";
import { scoreWeek, standings, derivePlayers } from "../js/scoring.js";
import { loadLive, fetchRosters } from "../js/espn.js";
import { resolveDraft, recordWeek, zeros, teamMismatches, formatWeek } from "./lib.mjs";

const DATA = new URL("../data/", import.meta.url);
const readJson = async (url) => JSON.parse(await readFile(url, "utf8"));
const weekUrl = (season, week) => new URL(`weeks/${season}-${String(week).padStart(2, "0")}.json`, DATA);
const fetchFn = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
};

// Score one week: from its recorded results if it has them, otherwise live from ESPN.
async function score(weekFile, league) {
  if (weekFile.recorded) {
    const players = weekFile.recorded.players;
    return { players, result: scoreWeek(weekFile, players, league), errors: [] };
  }
  const live = await loadLive(weekFile, fetchFn);
  const players = derivePlayers(weekFile, live.scoreboard, live.gamesById);
  return { players, result: scoreWeek(weekFile, players, league), errors: live.errors };
}

async function currentTeams() {
  return Object.fromEntries((await fetchRosters(fetchFn)).map((p) => [p.id, p.team]));
}

async function cmdResolve(args) {
  const [draftPath] = args;
  const outAt = args.indexOf("--out");
  if (!draftPath) throw new Error("usage: resolve <draft.json> [--out <file>]");
  const draft = await readJson(new URL(draftPath, `file://${process.cwd()}/`));
  const weekFile = resolveDraft(draft, await fetchRosters(fetchFn));
  const text = JSON.stringify(weekFile, null, 1) + "\n";
  if (outAt >= 0) {
    await writeFile(new URL(args[outAt + 1], `file://${process.cwd()}/`), text);
    console.log(`Resolved ${draft.season} week ${draft.week} -> ${args[outAt + 1]}`);
  } else {
    process.stdout.write(text);
  }
}

async function cmdWeek(season, week, record) {
  const league = await readJson(new URL("league.json", DATA));
  const baseline = await readJson(new URL("baseline.json", DATA));
  const index = await readJson(new URL("weeks/index.json", DATA));
  if (!index.some((w) => w.season === season && w.week === week)) {
    throw new Error(`${season} week ${week} is not in data/weeks/index.json`);
  }

  const weeks = [];
  let selected;
  for (const w of index.filter((x) => x.season === season)) {
    const weekFile = await readJson(weekUrl(w.season, w.week));
    const scored = await score(weekFile, league);
    weeks.push({ week: w.week, recorded: Boolean(weekFile.recorded), final: scored.result.final, settlement: scored.result.settlement });
    if (w.week === week) selected = { weekFile, ...scored };
  }
  const { weekFile, players, result, errors } = selected;

  console.log(`${season} week ${week}${weekFile.recorded ? " (recorded)" : result.final ? " (final, not recorded)" : " (provisional)"}\n`);
  console.log(formatWeek(result, standings(baseline, weeks, league), league));
  for (const e of errors) console.log(`\nWARNING: could not load ${e}`);

  if (weekFile.recorded) {
    if (record) throw new Error(`Week ${week} is already recorded. To re-record, delete "recorded" from its week file first.`);
    return;
  }
  const teams = await currentTeams();
  const moved = teamMismatches(weekFile, teams);
  for (const m of moved) console.log(`\nWARNING: ${m.name} is ${m.team} in the week file but ESPN now lists ${m.current}`);
  if (!record) return;

  if (errors.length) throw new Error("Not recording: some games could not be loaded.");
  const recorded = recordWeek(weekFile, players, result, teams);
  const zero = zeros(weekFile, players);
  console.log(zero.length ? "\nScored 0 for not playing (confirm each is real):" : "\nNo DNP or BYE players.");
  for (const z of zero) console.log(`  ${z.name} (${z.team}) ${z.state.toUpperCase()}`);
  await writeFile(weekUrl(season, week), JSON.stringify(recorded, null, 1) + "\n");
  console.log(`\nRecorded week ${week} in data/weeks/${season}-${String(week).padStart(2, "0")}.json`);
}

const args = process.argv.slice(2);
try {
  if (args[0] === "resolve") {
    await cmdResolve(args.slice(1));
  } else if (/^\d{4}$/.test(args[0] ?? "") && /^\d{1,2}$/.test(args[1] ?? "")) {
    await cmdWeek(Number(args[0]), Number(args[1]), args.includes("--record"));
  } else {
    console.log("usage:\n  npm run score -- resolve <draft.json> [--out <file>]\n  npm run score -- <season> <week> [--record]");
    process.exitCode = 2;
  }
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exitCode = 1;
}
