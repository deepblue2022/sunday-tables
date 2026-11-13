#!/usr/bin/env node
// League scoring CLI. Run through `npm run score -- ...` (adds --use-system-ca, which this
// network's proxy certificate needs).
//
//   npm run score -- resolve <draft.json> [--out <file>]   resolve names to ESPN players
//   npm run score -- <season> <week>                       print tables, settlement, standings
//   npm run score -- <season> <week> --record              freeze a final week into its week file
import { readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { scoreWeek, standings, derivePlayers, twoPtWarnings } from "../js/scoring.js";
import { loadLive, fetchRosters, fetchScoreboard, playedTeams, API } from "../js/espn.js";
import { resolveDraft, applyPlayedTeams, recordWeek, zeros, teamMismatches, formatWeek, gatherWeeks, assertWeekIdentity, parseArgs } from "./lib.mjs";

const DATA = fileURLToPath(new URL("../data/", import.meta.url));
const weekName = (season, week) => `${season}-${String(week).padStart(2, "0")}.json`;
const weekPath = (season, week) => path.join(DATA, "weeks", weekName(season, week));

async function readJson(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    throw new Error(`cannot read ${file}: ${err.code ?? err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
}

// Write via a temporary file so a crash cannot leave a half-written data file.
async function writeJson(file, data) {
  await writeFile(`${file}.tmp`, JSON.stringify(data, null, 1) + "\n");
  await rename(`${file}.tmp`, file);
}

async function fetchFn(url) {
  let r;
  try {
    r = await fetch(url);
  } catch (err) {
    throw new Error(`${url}: ${err.cause?.code ?? err.cause?.message ?? err.message}`);
  }
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

async function currentTeams() {
  return Object.fromEntries((await fetchRosters(fetchFn)).map((p) => [p.id, p.team]));
}

async function cmdResolve({ draft: draftArg, out }) {
  const league = await readJson(path.join(DATA, "league.json"));
  const draft = await readJson(path.resolve(process.cwd(), draftArg));
  const resolved = resolveDraft(draft, await fetchRosters(fetchFn), league);
  // If some of the week's games have already been played, use the team each player played for.
  const scoreboard = await fetchScoreboard(resolved.season, resolved.week, fetchFn);
  const played = {};
  for (const g of scoreboard.games.filter((g) => g.phase === "in" || g.phase === "done")) {
    Object.assign(played, playedTeams(await fetchFn(`${API}/summary?event=${g.id}`)));
  }
  const { weekFile, changes } = applyPlayedTeams(resolved, played);
  for (const c of changes) console.error(`Note: ${c.name} is on ${c.from} now but played this week for ${c.to}; using ${c.to}.`);
  if (out) {
    await writeJson(path.resolve(process.cwd(), out), weekFile);
    console.log(`Resolved ${weekFile.season} week ${weekFile.week} -> ${out}`);
  } else {
    process.stdout.write(JSON.stringify(weekFile, null, 1) + "\n");
  }
}

async function cmdWeek({ season, week, record }) {
  const league = await readJson(path.join(DATA, "league.json"));
  const baseline = await readJson(path.join(DATA, "baseline.json"));
  const index = await readJson(path.join(DATA, "weeks", "index.json"));
  if (!index.some((w) => w.season === season && w.week === week)) {
    throw new Error(`${season} week ${week} is not in data/weeks/index.json`);
  }

  // Score one week: from its recorded results if it has them, otherwise live from ESPN.
  const load = async (entry) => {
    const weekFile = await readJson(weekPath(entry.season, entry.week));
    assertWeekIdentity(weekFile, entry.season, entry.week, weekName(entry.season, entry.week));
    if (weekFile.recorded) {
      const players = weekFile.recorded.players;
      return { weekFile, players, result: scoreWeek(weekFile, players, league), errors: [] };
    }
    const live = await loadLive(weekFile, fetchFn);
    const players = derivePlayers(weekFile, live.scoreboard, live.gamesById);
    const twoPt = twoPtWarnings(weekFile, live.scoreboard, live.gamesById);
    return { weekFile, players, result: scoreWeek(weekFile, players, league), errors: live.errors, twoPt };
  };
  const { weeks, selected, warnings } = await gatherWeeks(index.filter((w) => w.season === season), week, load);
  const { weekFile, players, result, errors, twoPt = [] } = selected;

  const status = weekFile.recorded ? "recorded" : result.final ? "final, not recorded" : "provisional";
  console.log(`${season} week ${week} (${status})\n`);
  console.log(formatWeek(result, standings(baseline, weeks, league), league));
  for (const w of warnings) console.log(`\nWARNING: ${w}`);
  for (const e of errors) console.log(`\nWARNING: could not load ${e}`);
  for (const t of twoPt) console.log(`\n2-PT CHECK: ${t}`);
  if (twoPt.length) console.log("Settle each one with a two_pt_fixes entry in the week file (see RULES.md).");

  if (weekFile.recorded) {
    if (record) throw new Error(`Week ${week} is already recorded. To re-record, delete "recorded" from its week file first.`);
    return;
  }
  const teams = await currentTeams();
  for (const m of teamMismatches(weekFile, teams)) {
    console.log(`\nWARNING: ${m.name} is ${m.team} in the week file but ESPN now lists ${m.current}`);
  }
  if (!record) return;

  if (errors.length) throw new Error("Not recording: some games could not be loaded.");
  if (twoPt.length) throw new Error("Not recording: settle the 2-PT CHECK items above first.");
  const recorded = recordWeek(weekFile, players, result, teams);
  const zero = zeros(weekFile, players);
  console.log(zero.length ? "\nScored 0 for not playing (confirm each is real):" : "\nNo DNP or BYE players.");
  for (const z of zero) console.log(`  ${z.name} (${z.team}) ${z.state.toUpperCase()}`);
  await writeJson(weekPath(season, week), recorded);
  console.log(`\nRecorded week ${week} in data/weeks/${weekName(season, week)}`);
}

const parsed = parseArgs(process.argv.slice(2));
try {
  if (!parsed) {
    console.log("usage:\n  npm run score -- resolve <draft.json> [--out <file>]\n  npm run score -- <season> <week> [--record]");
    process.exitCode = 2;
  } else if (parsed.cmd === "resolve") {
    await cmdResolve(parsed);
  } else {
    await cmdWeek(parsed);
  }
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exitCode = 1;
}
