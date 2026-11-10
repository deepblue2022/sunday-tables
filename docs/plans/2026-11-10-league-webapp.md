# Fantasy League Webapp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static GitHub Pages site showing the league's weekly team table, lightning table, settlement and accumulated standings, live from ESPN, with a Node CLI that uses the same scoring engine.

**Architecture:** Plain ES modules, no build step, no dependencies. `js/scoring.js` is pure; `js/espn.js` is the only code that knows ESPN's JSON; `js/render.js` builds HTML strings; `js/app.js` wires them in the browser; `cli/` wires them in Node.

**Tech Stack:** Vanilla JS (ES modules), HTML/CSS, Node 25 (`node --test`, built-in `fetch`), git, GitHub Pages.

**Spec:** `docs/specs/2026-11-10-league-webapp-design.md` (read it first; this plan does not restate it). Golden output: `docs/specs/week9-golden.txt`.

## Global Constraints

- Working directory for every command: `/home/mxue/stuff/fantasy`.
- No npm dependencies. `package.json` has `"type": "module"`.
- Any Node process that reaches the network runs with `--use-system-ca` (plain Node fails with `SELF_SIGNED_CERT_IN_CHAIN` here). Tests never touch the network.
- All money inside the code is **integer cents**. `baseline.json` is whole dollars and is converted on load.
- Owner keys and order everywhere: `Art, Mxue, Vince, Kevin, Galli, JD, JohnO`.
- Player state strings: `"final" | "dnp" | "bye" | "live" | "not_started" | "unknown"`. Blocking states: `live`, `not_started`, `unknown`.
- Game phase strings: `"pre" | "in" | "done" | "unresolved"`.
- Stat line shape: `{passYds, passTD, rushYds, rushTD, recYds, recTD}`; any key may be missing.
- ESPN base: `https://site.api.espn.com/apis/site/v2/sports/football/nfl`.
- Do not change `RULES.md` scoring rules. Do not delete `score.py` until Task 8.
- Commit after each task with the message given. Use the machine's existing git identity; if none is set, stop and ask.

## Review Focus

Conditions the spec implies but does not spell out; each has a test in the task named.

1. ESPN stat values arrive as strings and can be `"--"` or absent → points are integers, never `NaN` (Task 1).
2. Player names contain apostrophes and could contain HTML characters (`Ja'Marr Chase`, `D'Andre Swift`) → rendered escaped, and 2-pt name matching still works (Tasks 4, 7).
3. In-progress games report many status names (halftime, end of period, delayed) → anything with state `"in"` is `in`; only `completed: true` is `done` (Task 4).
4. GitHub Pages and browsers cache JSON → every data fetch uses `cache: "no-cache"`; a tab hidden for hours refreshes as soon as it is visible again (Task 7).
5. A week file whose roster has the wrong number of players for its columns, or an owner missing → the page and CLI show an error naming the file, not a blank or shifted table (Task 2).

---

### Task 1: Scaffold and scoring primitives

**Files:**
- Create: `package.json`, `.gitignore`, `.nojekyll` (empty), `js/scoring.js`, `test/scoring.test.js`

**Interfaces:**
- Produces: `playerPoints(statLine, twoPt = 0) → integer`; `splitCents(totalCents, winners, ownerOrder) → {owner: cents}` (winners only); `BLOCKING = ["live","not_started","unknown"]`.

- [ ] **Step 1:** `git init -b main`. Write `package.json`: `{"name":"fantasy-league","private":true,"type":"module","scripts":{"test":"node --test","score":"node --use-system-ca cli/score.mjs"}}`. Write `.gitignore`: `*:Zone.Identifier`, `*:sec.endpointdlp`, `image001.png`, `node_modules/`.

- [ ] **Step 2: Write failing tests** in `test/scoring.test.js` (`node:test`, `node:assert/strict`):

```js
test("playerPoints", () => {
  assert.equal(playerPoints({passYds:372, passTD:3, rushYds:13, rushTD:1}, 2), 36); // Love wk9
  assert.equal(playerPoints({passYds:242, passTD:1, rushYds:-1}), 15);              // negative yards = 0
  assert.equal(playerPoints({passYds:-3, rushYds:57}), 5);
  assert.equal(playerPoints({passYds:287, rushYds:48}), 18);                        // floored per category
  assert.equal(playerPoints({}, 2), 2);                                             // 2-pt only
  assert.equal(playerPoints({recYds:"171", recTD:"1"}), 23);                        // strings
  assert.equal(playerPoints({recYds:"--", rushTD:undefined}), 0);                   // junk never NaN
});
test("splitCents gives leftover cents in owner order", () => {
  const order = ["Art","Mxue","Vince","Kevin","Galli","JD","JohnO"];
  assert.deepEqual(splitCents(14000, ["JohnO","Galli","Vince"], order), {Vince:4667, Galli:4667, JohnO:4666});
  assert.deepEqual(splitCents(20000, ["Kevin","JD"], order), {Kevin:10000, JD:10000});
});
```

- [ ] **Step 3:** Run `npm test` → FAIL (module not found).
- [ ] **Step 4:** Implement both functions in `js/scoring.js`. Coerce every stat with a helper that returns 0 for non-finite values.
- [ ] **Step 5:** Run `npm test` → PASS.
- [ ] **Step 6:** `git add -A && git commit -m "feat: scaffold and scoring primitives"` (this first commit also brings in the existing spec, plan, RULES.md, score.py and JSON files).

---

### Task 2: `scoreWeek`

**Files:**
- Modify: `js/scoring.js`
- Test: `test/scoreweek.test.js`

**Interfaces:**
- Consumes: `playerPoints`, `splitCents`, `BLOCKING`.
- Produces: `scoreWeek(weekFile, playersById, league) → result`, where `league = {owners:[{key, display}], teamBuyInCents: 2000, lightningCentsPerPoint: 200}` and `playersById = {athleteId: {points, state}}` (a missing id counts as `{points: 0, state: "unknown"}`).

```js
result = {
  final,                                   // no rostered player in a BLOCKING state
  team: { rows: {owner: {players: [{name, id, points, state}], total}},
          winners: [owner], started, provisional, money: {owner: cents} },
  lightning: { columns: [{name, cells: {owner: {name, id, points, state}},
                          winners: [owner], started, provisional, money: {owner: cents}}],
               net: {owner: cents} },
  settlement: {owner: {lightning, teamPot, total}}   // cents
}
```

`started` = at least one player in that table/column is `live`, `final` or `dnp` (their game has kicked off; `bye` and `unknown` do not count). `provisional` = any player in it is BLOCKING. `winners` is `[]` when `started` is false. Points of BLOCKING players count as their current `points` (0 when not started/unknown). Team money: each owner −buy-in, winners share the pot via `splitCents`. Lightning column money: each non-winner pays `(top − pts) × rate`; winners share the sum via `splitCents`.

- Also produces: `validateWeekFile(weekFile, league)` — throws `Error` whose message includes `"<season>-<week>"` and what is wrong, if any owner in `league.owners` is missing from either table or a roster's length differs from its `columns` length. `scoreWeek` calls it first.

- [ ] **Step 1: Write failing tests.** Build a small helper in the test that makes a week file from `{owner: [points…]}` per table with synthetic ids. Assertions:

```js
// lightning column, 2-way tie (Week 9 QB3: 17,21,17,36,6,36,19)
assert.deepEqual(col.winners, ["Kevin","JD"]);
assert.deepEqual(col.money, {Art:-3800, Mxue:-3000, Vince:-3800, Kevin:10000, Galli:-6000, JD:10000, JohnO:-3400});
// lightning column, 3-way tie with a leftover cent (10,10,10,9,9,9,5 in owner order)
assert.deepEqual(col.money, {Art:534, Mxue:533, Vince:533, Kevin:-200, Galli:-200, JD:-200, JohnO:-1000});
// team pot, single winner
assert.deepEqual(team.money, {Art:-2000, Mxue:-2000, Vince:-2000, Kevin:-2000, Galli:12000, JD:-2000, JohnO:-2000});
// team pot, 3-way tie Vince/Galli/JohnO
assert.deepEqual(team.money, {Art:-2000, Mxue:-2000, Vince:2667, Kevin:-2000, Galli:2667, JD:-2000, JohnO:2666});
// every case: sum of settlement[*].total === 0
// states: one "live" player → that column provisional, result.final false, other columns not provisional
// states: "bye" and "dnp" players only → final true
// states: all "not_started" → started false, winners [], money all 0
// validateWeekFile: roster of 4 in a 5-column table → throws /2026-9/ ; owner missing → throws
```

- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** Implement. **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** `git commit -am "feat: scoreWeek with ties, states and settlement"`

---

### Task 3: Standings and default week

**Files:**
- Modify: `js/scoring.js`
- Test: `test/standings.test.js`

**Interfaces:**
- Produces: `standings(baseline, weeks, league)` where `baseline = {through_week, totals: {owner: dollars}}` and `weeks = [{week, recorded, final, settlement}]` (settlement from `scoreWeek`, or `null` if that week could not be loaded) →
  `{recordedThrough, base: {owner: cents}, open: [{week, provisional, amounts: {owner: cents} | null}], totals: {owner: cents}, order: {owner: 1..7}}`. `base` = baseline + recorded weeks; `open` = unrecorded weeks in order; `provisional` = `!final`; order 1 = lowest total, ties broken by league owner order.
- Produces: `defaultWeek(weeks)` where `weeks = [{week, recorded, started}]` in index order → the earliest unrecorded week with `started`, else the last week.

- [ ] **Step 1: Write failing tests:**

```js
const baseline = {through_week: 8, totals: {JD:572, Galli:-458, Art:134, Mxue:-218, Vince:-530, JohnO:592, Kevin:-92}};
const wk9 = {Art:-6000, Mxue:44800, Vince:-19600, Kevin:-4200, Galli:10600, JD:-7200, JohnO:-18400}; // as settlement[*].total
// recorded week 9:
assert.deepEqual(s.totals, {Art:7400, Mxue:23000, Vince:-72600, Kevin:-13400, Galli:-35200, JD:50000, JohnO:40800});
assert.deepEqual(s.order,  {Vince:1, Galli:2, Kevin:3, Art:4, Mxue:5, JohnO:6, JD:7});
assert.equal(s.recordedThrough, 9); assert.deepEqual(s.open, []);
// same week unrecorded and not final: recordedThrough 8, base = baseline×100, open[0] = {week:9, provisional:true, amounts: wk9}, totals unchanged
// defaultWeek: [{9,recorded},{10,unrecorded,started:false}] → 10 (last);
//              [{9,unrecorded,started:true},{10,unrecorded,started:false}] → 9
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** `git commit -am "feat: standings and default week"`

---

### Task 4: ESPN parsers and fixtures

**Files:**
- Create: `js/espn.js`, `test/make-fixtures.mjs`, `test/fixtures/` (generated), `test/espn.test.js`

**Interfaces:**
- Produces:
  - `parseScoreboard(json) → {games: [{id, teams: [abbr, abbr], phase, kickoff}], byeTeams: [abbr]}`. Phase from `event.status.type`: `completed === true` → `done`; else `state === "pre"` → `pre`; `state === "in"` → `in`; anything else → `unresolved`. `byeTeams` from `json.week.teamsOnBye[].abbreviation` (absent → `[]`).
  - `parseGame(json) → {stats: {athleteId: statLine}, twoPt: [{name, team, points}]}`. Stats from `boxscore.players[].statistics[]` named `passing`/`rushing`/`receiving`, zipping `keys` with each athlete's `stats`; map `passingYards→passYds`, `passingTouchdowns→passTD`, `rushingYards→rushYds`, `rushingTouchdowns→rushTD`, `receivingYards→recYds`, `receivingTouchdowns→recTD`. 2-pt regexes per the spec, on `scoringPlays[].text`, `team` = `scoringPlays[].team.abbreviation`.
  - `fetchScoreboard(season, week, fetchFn)`, `fetchGame(id, fetchFn)` — `fetchFn(url)` resolves to parsed JSON and rejects on non-2xx.
  - `fetchRosters(fetchFn) → [{id, name, team, pos}]` — team ids from `GET /teams` (`sports[0].leagues[0].teams[].team.id`), then `/teams/{id}/roster` (`athletes[].items[]`: `id`, `displayName`, `position.abbreviation`; team abbreviation from the response's `team.abbreviation`).
  - `nextPollMs(games) → 60000 | 300000 | null` — 60000 if any game is `in`; else 300000 if any is `pre`; else `null`.

- [ ] **Step 1:** Write `test/make-fixtures.mjs` (run once, with network). It saves, trimmed to exactly the fields listed above plus `status.type` and `competitions[0].competitors[].team.abbreviation`: `test/fixtures/2026-09/scoreboard.json`; `test/fixtures/2026-09/game-<id>.json` for all 15 Week 9 events; `test/fixtures/2022-17-scoreboard.json` (contains the cancelled BUF @ CIN game, event 401437947). Run `node --use-system-ca test/make-fixtures.mjs`. Expected: 17 files, total under 400 KB.

- [ ] **Step 2: Write failing tests:**

```js
// parseScoreboard(week 9): 15 games, all phase "done"; byeTeams sorted equals ["PIT","TEN"]
// parseScoreboard(2022 wk17): game 401437947 phase "unresolved"
// phase mapping on hand-made events: {state:"in",completed:false,name:"STATUS_HALFTIME"} → "in";
//   {state:"in",name:"STATUS_DELAYED"} → "in"; {state:"post",completed:false} → "unresolved"; {state:"pre"} → "pre"
// parseGame(GB @ NE, 401873049): stats["<Jordan Love's id>"] deepEqual {passYds:372, passTD:3, rushYds:13, rushTD:1};
//   twoPt includes {name:"Jordan Love", team:"GB", points:2}; no entry from the "Failed" play in that game
// parseGame on a hand-made scoringPlays list:
//   "X 5 Yd Run (Bo Nix Pass to Ja'Marr Chase for Two-Point Conversion)" → [{name:"Bo Nix",points:1},{name:"Ja'Marr Chase",points:2}]
//   "(Michael Penix Jr. Pass to Drake London for Two-Point Conversion)" → names keep the suffix
//   "(Two-Point Pass Conversion Failed)" → []
// nextPollMs: [in, pre] → 60000; [pre, done] → 300000; [done, unresolved] → null
```
(Read Jordan Love's athlete id from the fixture when writing the test; do not hard-code a guess.)

- [ ] **Step 3:** FAIL. **Step 4:** Implement. **Step 5:** PASS.
- [ ] **Step 6:** `git add -A && git commit -m "feat: ESPN parsers and trimmed fixtures"`

---

### Task 5: Player states, live loading, and the Week 9 golden test

**Files:**
- Modify: `js/scoring.js` (`relevantGames`, `derivePlayers`), `js/espn.js` (`loadLive`)
- Create: `test/states.test.js`, `test/week9.golden.test.js`, `test/fixtures/2026-09/week-draft.json`

**Interfaces:**
- Consumes: Task 2 and Task 4 outputs.
- Produces:
  - `relevantGames(weekFile, scoreboard) → [game]` — games containing any rostered player's `team`.
  - `derivePlayers(weekFile, scoreboard, gamesById) → playersById` — `gamesById[gameId]` is a `parseGame` result, or absent/`null` when not loaded. State rules are the spec's Player states table, evaluated in this order for each player: team in a game → by phase (`pre` → `not_started`; `unresolved` → `unknown`; `in`/`done` with no loaded summary → `unknown`; `in` → `live`; `done` → `final` if stat line or 2-pt else `dnp`); else team in `byeTeams` → `bye`; else `unknown`. Points = `playerPoints(stats[id], sum of twoPt entries whose name === player.name and team === player.team)`; 0 for `not_started`/`unknown`/`bye`/`dnp`.
  - `loadLive(weekFile, fetchFn, cache = new Map()) → {scoreboard, gamesById, errors: [string]}` — fetches the scoreboard (a failure rejects), then every relevant `in` or `done` game not in `cache`; a game is put in `cache` only when fetched while its phase is `done`; a failed game fetch leaves it absent from `gamesById` and adds a message to `errors`.

- [ ] **Step 1:** Create `test/fixtures/2026-09/week-draft.json` from `rosters_week9.json`: same two tables, full names as they are there. In the test, build the week file by giving each name the `id` and `team` found in the fixture box scores (a tiny test helper that scans the 15 game fixtures by display name among their athletes). This keeps the test off the network; real resolution is Task 6.

- [ ] **Step 2: Write failing tests** in `test/states.test.js` with a hand-made scoreboard and games:

```js
// done game, player has stats → final with points; done game, loaded, no stats, no 2pt → dnp, 0
// done game, no stats but a 2-pt entry matching name+team → final, 2
// 2-pt entry with matching name but other team → not credited
// in game, loaded → live;   in game, summary absent → unknown;   done game, summary absent → unknown
// pre game → not_started;   unresolved game → unknown
// team in byeTeams → bye;   team in neither → unknown
// loadLive with a fake fetchFn: done game fetched once across two calls sharing a cache;
//   in game fetched on every call; a game fetched while "in" is refetched after it turns "done";
//   one game rejecting → errors.length 1 and others still loaded; scoreboard rejecting → loadLive rejects
```

- [ ] **Step 3: Write the golden test** `test/week9.golden.test.js`: load fixtures → `derivePlayers` → `scoreWeek`. Assert:

```js
// result.final === true
// team totals: {Art:73, Mxue:104, Vince:106, Kevin:105, Galli:115, JD:87, JohnO:106}; team.winners ["Galli"]
// every lightning cell's points equals the value parsed from docs/specs/week9-golden.txt
//   (lines start with the column name; cells look like "Owner:Short=N"; 49 cells)
// column winners: RB2 [Mxue], QB2 [Mxue], QB3 [Kevin,JD], QB4 [Galli], WR2 [Mxue], WR3 [Mxue], RB3 [Art]
// lightning.net: {Art:-4000, Mxue:46800, Vince:-17600, Kevin:-2200, Galli:-1400, JD:-5200, JohnO:-16400}
// settlement totals: {Art:-6000, Mxue:44800, Vince:-19600, Kevin:-4200, Galli:10600, JD:-7200, JohnO:-18400}
// standings with the Week 8 baseline: totals {JD:50000, JohnO:40800, Mxue:23000, Art:7400, Kevin:-13400, Galli:-35200, Vince:-72600}
```

- [ ] **Step 4:** FAIL. **Step 5:** Implement. **Step 6:** `npm test` → PASS (all files).
- [ ] **Step 7:** `git add -A && git commit -m "feat: player states, live loading, Week 9 golden test"`

---

### Task 6: CLI and data migration

**Files:**
- Create: `cli/lib.mjs`, `cli/score.mjs`, `test/cli.test.js`, `data/league.json`, `data/baseline.json`, `data/weeks/index.json`, `data/weeks/2026-09.json`

**Interfaces:**
- Consumes: everything above.
- Produces in `cli/lib.mjs` (pure, tested):
  - `resolveDraft(draft, rosterPlayers) → weekFile`. Draft roster entries are `"Full Name"` or `{name, team}`. Candidates are `rosterPlayers` with `pos` in `QB, RB, WR, TE, FB` and `name === entry name` (and `team` if given). Exactly one → `{name, id, team}`. Otherwise throw an `Error` listing every failing entry with its candidates (`name, team, pos`), all in one message.
  - `recordWeek(weekFile, playersById, result, currentTeams) → weekFile` with `recorded.players` for every rostered id. Throws if `weekFile.recorded` exists, if `!result.final`, or if any rostered player's `currentTeams[id]` differs from their `team` (message names the players).
  - `formatWeek(result, standings, league) → string` — team table, lightning table, $ by column, settlement, standings; dollars via `fmtMoney` (Task 7 defines it in `js/render.js`; until then format inline and switch in Task 7).
  - `zeros(weekFile, playersById) → [{name, team, state}]` — rostered players in `dnp` or `bye`.
- `cli/score.mjs` commands: `resolve <draft.json> [--out <file>]`; `<season> <week>`; `<season> <week> --record`. `fetchFn` = `(url) => fetch(url).then(r => r.ok ? r.json() : Promise.reject(new Error(url + " " + r.status)))`. Week files live at `data/weeks/<season>-<week padded to 2>.json`. `--record` aborts if `loadLive` returns any `errors`, prints `zeros`, then writes the file. The plain print command warns on team mismatches without failing.

- [ ] **Step 1: Write failing tests** in `test/cli.test.js`:

```js
const roster = [
  {id:"1", name:"Justin Jefferson", team:"MIN", pos:"WR"}, {id:"2", name:"Justin Jefferson", team:"CLE", pos:"LB"},
  {id:"3", name:"DeVonta Smith", team:"PHI", pos:"WR"},     {id:"4", name:"Josh Allen", team:"BUF", pos:"QB"},
  {id:"5", name:"Josh Allen", team:"XYZ", pos:"QB"},
];
// "Justin Jefferson" → id "1" (defender ignored)
// "Josh Allen" → throws, message contains "BUF" and "XYZ";  {name:"Josh Allen", team:"BUF"} → id "4"
// "Jon Nobody" → throws, message contains "Jon Nobody"; two bad entries → one error naming both
// recordWeek: final result → recorded.players has every rostered id with {points, state}
// recordWeek: throws when already recorded; when result.final is false; when currentTeams differs (names the player)
// zeros: returns only dnp and bye players
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement `cli/lib.mjs` and `cli/score.mjs`. **Step 4:** `npm test` → PASS.

- [ ] **Step 5: Write the data files.**
  - `data/league.json`: `{"name":"Fantasy League","owners":[{"key":"Art","display":"Art"},{"key":"Mxue","display":"Mxue"},{"key":"Vince","display":"Vince"},{"key":"Kevin","display":"Kevin"},{"key":"Galli","display":"Galli"},{"key":"JD","display":"JD"},{"key":"JohnO","display":"JohnO"}],"teamBuyInCents":2000,"lightningCentsPerPoint":200}`
  - `data/baseline.json`: `{"through_week":8,"totals":{"JD":572,"Galli":-458,"Art":134,"Mxue":-218,"Vince":-530,"JohnO":592,"Kevin":-92}}`
  - `data/weeks/index.json`: `[{"season":2026,"week":9}]`

- [ ] **Step 6: Migrate Week 9 against the real API.**
  Run: `npm run score -- resolve test/fixtures/2026-09/week-draft.json --out data/weeks/2026-09.json`
  Expected: succeeds with no ambiguity errors (if a player has changed teams since Week 9 and resolves to a new team, stop and report rather than editing by hand).
  Run: `npm run score -- 2026 9` and diff its numbers against `docs/specs/week9-golden.txt` → every player score and the lightning net match; team winner Galli 115; settlement and standings match Task 5's values.
  Run: `npm run score -- 2026 9 --record` → prints the DNP/BYE list (expected: none) and writes `recorded`.
  Run: `npm run score -- 2026 9 --record` again → refuses ("already recorded").

- [ ] **Step 7:** Add a test to `test/week9.golden.test.js`: scoring `data/weeks/2026-09.json` from its `recorded.players` gives the same settlement as the fixtures. `npm test` → PASS.
- [ ] **Step 8:** `git add -A && git commit -m "feat: CLI (resolve, print, record) and Week 9 data"`

---

### Task 7: The page

**Files:**
- Create: `js/render.js`, `js/app.js`, `index.html`, `test/render.test.js`
- Modify: `cli/lib.mjs` (use `fmtMoney`)

**Interfaces:**
- Consumes: `scoreWeek`, `standings`, `defaultWeek`, `derivePlayers`, `relevantGames`, `loadLive`, `nextPollMs`.
- Produces in `js/render.js` (pure string builders, no DOM):
  - `esc(s)` — HTML-escapes `& < > " '`.
  - `fmtMoney(cents) → string` — `"+$448"`, `"−$60"` (U+2212), `"$0"`, cents only when not whole: `"+$26.67"`.
  - `renderTeamTable(result, league)`, `renderLightning(result, league)`, `renderSettlement(result, league)`, `renderStandings(standings, league)` → HTML strings.
  - State tags: `live` → `LIVE`, `dnp` → `DNP`, `bye` → `BYE`, `unknown` → `?`; `not_started` and `unknown` show `—` instead of points.
  - Winner cells/rows carry class `win`; provisional tables/columns carry class `prov` and the visible word "provisional".

- [ ] **Step 1: Write failing tests** in `test/render.test.js`:

```js
assert.equal(fmtMoney(44800), "+$448"); assert.equal(fmtMoney(-6000), "−$60");
assert.equal(fmtMoney(0), "$0");        assert.equal(fmtMoney(2667), "+$26.67");
assert.equal(esc(`<b>"D'Andre"</b> & co`), "&lt;b&gt;&quot;D&#39;Andre&quot;&lt;/b&gt; &amp; co");
// renderTeamTable(week 9 recorded result): contains "Galli wins $140"; exactly one row with class "win"; no "provisional"
// renderLightning with one live player: contains "LIVE" and "provisional"; a player named `<img src=x>` appears escaped
// renderLightning with nothing started: no element with class "win"; cells show "—"
// renderStandings(week 9 recorded): rows in league order contain "+$500" for JD and order numbers 1..7
// renderStandings with an open provisional week: contains "Wk 9" and "provisional"
```

- [ ] **Step 2:** FAIL. **Step 3:** Implement `js/render.js`; switch `cli/lib.mjs` to `fmtMoney`. **Step 4:** `npm test` → PASS.

- [ ] **Step 5: Write `index.html` and `js/app.js`.**
  - `index.html`: `<meta name="viewport" content="width=device-width,initial-scale=1">`, `<meta name="robots" content="noindex">`, title "Fantasy League", inline CSS, containers `#header #banner #team #lightning #settlement #standings`, `<script type="module" src="js/app.js">`. Styles: system font; light and dark via `prefers-color-scheme`; each table inside a `overflow-x:auto` wrapper with the owner column sticky; body never scrolls sideways at 360 px; `.win` bold with a tinted background; `.prov` muted with a dashed border; money positive/negative colored and also signed.
  - `app.js` behavior, in order: load `data/league.json`, `data/baseline.json`, `data/weeks/index.json`, then every week file, all with `fetch(url, {cache: "no-cache"})`; a failure shows "Could not load <file>" in `#banner` and stops. For each unrecorded week call `loadLive` (one shared cache per week) → `derivePlayers` → `scoreWeek`; recorded weeks use `recorded.players`. Pick the week with `defaultWeek` (`started` = `result.team.started || any lightning column started`). Render the selected week's three tables and the standings (standings always from all weeks). Header: league name, `<select>` of weeks, "updated hh:mm", Refresh button.
  - Refresh loop: after each load, `nextPollMs(relevantGames(...))` over all unrecorded weeks (use the smallest non-null) schedules the next load with `setTimeout`; no timer while `document.hidden`; on `visibilitychange` to visible, load immediately if the last load is older than 60 s.
  - Errors: scoreboard failure keeps the previous render and shows "Live stats unavailable — showing data from hh:mm" (or dashes on first load); `errors` from `loadLive` show "Some games could not be loaded" and those players are `unknown`.

- [ ] **Step 6: Manual check.** Run `python3 -m http.server 8765` in the repo and open `http://localhost:8765/`. Expected: Week 9 shows with no ESPN requests in the Network tab (it is recorded); team table winner Galli 115; settlement Mxue +$448; standings JD +$500 … Vince −$726 with Order 1–7; no horizontal page scroll at 360 px width; dark mode readable.
  Then test the live path without touching real data: copy `data/weeks/2026-09.json` to `data/weeks/2026-10.json` with `"week": 10` and `recorded` removed, add it to `index.json`, reload. Expected: Week 10 column appears in standings as provisional, players show `—` or live points depending on the real Week 10 schedule, ESPN requests appear, and the page schedules a refresh. **Delete the Week 10 file and the index entry afterwards** and confirm `git status` shows no data changes.

- [ ] **Step 7:** `git add -A && git commit -m "feat: league page with live refresh"`

---

### Task 8: Publish and hand over

**Files:**
- Modify: `RULES.md` (Weekly workflow section), memory file `~/.claude/projects/-home-mxue-stuff/memory/fantasy-football-league.md`
- Delete: `score.py`, `rosters_week9.json`, `accumulated.json`

This task needs Mxue at the keyboard for the account steps.

- [ ] **Step 1:** Final check before retiring the old scorer: `npm test` passes and `npm run score -- 2026 9` matches `docs/specs/week9-golden.txt`. Then `git rm score.py rosters_week9.json accumulated.json`.
- [ ] **Step 2:** Rewrite the "Weekly workflow" section of `RULES.md` to the spec's five steps with the real commands (`npm run score -- resolve …`, `npm run score -- <season> <week> [--record]`, `git push`), and add the note on cancelled/postponed games. Leave the scoring rules untouched. Commit: `git commit -am "docs: new weekly workflow; retire score.py"`.
- [ ] **Step 3 (Mxue):** create a GitHub account. Install the GitHub CLI (ask Mxue before running any `sudo` install) and run `gh auth login` via `! gh auth login`.
- [ ] **Step 4:** Confirm the repo name and that it will be **public** with Mxue, then: `gh repo create <name> --public --source=. --push`, and enable Pages from `main` / root (`gh api -X POST repos/{owner}/{repo}/pages -f 'source[branch]=main' -f 'source[path]=/'`).
- [ ] **Step 5:** Wait for the Pages build, open `https://<username>.github.io/<name>/`. Expected: same as Task 7 Step 6's first check, on a phone-width window. Confirm `curl -sI` of `data/weeks/2026-09.json` on the live site returns 200.
- [ ] **Step 6:** Update the memory file: site URL, repo, the `npm run score` commands, week files replace `rosters_week<N>.json`, baseline in `data/baseline.json`. Give Mxue the link.
