# Fantasy League Webapp — Design

Date: 2026-11-10
Status: Draft for review (revision 3, after independent peer review)

## Goal

A public, link-only web page where the 7 league members can see each week's scoring, money, and accumulated
standings, updating live during games. Mxue remains the only scorekeeper; nobody else edits anything.

Success looks like:
- League members open one link on their phone and see the same tables Mxue currently sends by hand.
- During games, scores and money update on their own without anyone republishing.
- The site's numbers match the existing hand-checked Week 9 2026 results exactly.
- Weekly upkeep is: Mxue pastes the two tables to Claude; Claude publishes one update.

## Users and access

- **Viewers:** anyone with the link. No login. Page includes `<meta name="robots" content="noindex">` so it isn't
  search-indexed, but it is not private: first names and dollar amounts are visible to anyone with the URL.
- **Scorekeeper:** Mxue, via Claude Code, publishes roster data to the GitHub repo.

## Rules (unchanged from RULES.md)

Player points, applied identically in both tables:
- Passing: floor(yds / 20) + 3 per TD + 1 per 2-pt conversion pass
- Rushing and receiving: floor(yds / 10) each + 6 per TD + 2 per 2-pt conversion run or catch
- Each yardage category floored separately; negative yardage counts as 0; no penalties for INTs, fumbles, etc.
- A player's points always include 2-pt conversions, even with no passing, rushing or receiving stat line.

Team table (QB / RB / RB / WR / WR): $20 buy-in each, highest total takes the $140 pot; ties split.

Lightning table (RB2 / QB2 / QB3 / QB4 / WR2 / WR3 / RB3), $2 per point: in each column, every non-winner pays
the winner (winner pts − their pts) × $2. Tied winners split that column's winnings and pay each other nothing.

**Money arithmetic:** all amounts are integer cents. When a pot does not divide evenly among tied winners,
each gets the floor share and the leftover cents go one each to the tied winners in `league.json` owner
order. Every week's settlement therefore sums to exactly $0.

**Cancelled or postponed games:** the rules don't cover these. The site never guesses: such a game keeps
the week provisional until the scorekeeper decides (see Player states).

## Architecture

Static site on GitHub Pages (free, requires a **public** repo). No server. The viewer's browser fetches stats
directly from ESPN's public API. Verified 2026-11-10: the scoreboard and game-summary endpoints return
`Access-Control-Allow-Origin: *`; a scoreboard is about 21 KB and a game summary about 60 KB gzipped.

```
fantasy/                      (git repo, published by GitHub Pages)
  index.html                  page shell + styles
  js/app.js                   UI: loads data, renders tables, refresh loop
  js/espn.js                  fetches ESPN scoreboard + game summaries, parses into a stats object
  js/scoring.js               pure scoring engine (no I/O): points, team pot, lightning, settlement
  data/league.json            owners (display order, display names), rule constants
  data/baseline.json          accumulated totals through Week 8 (from the league sheet)
  data/weeks/index.json       list of available weeks, e.g. [{"season":2026,"week":9}]
  data/weeks/2026-09.json     that week's two roster tables, resolved players, and (once recorded) frozen results
  cli/score.mjs               Node CLI: resolve names, print tables, record a final week
  test/                       node:test tests + trimmed ESPN fixtures
  docs/specs/                 this file and the Week 9 golden output
  RULES.md
```

`score.py`, `rosters_week9.json` and the old `accumulated.json` are retired once `cli/score.mjs` reproduces
the Week 9 output; one engine serves both the page and Claude, so the two can't drift.

### Week file

Players are resolved to ESPN identity **when the file is written**, not in the browser:

```json
{
  "season": 2026, "week": 9,
  "team_table": {
    "columns": ["QB", "RB", "RB", "WR", "WR"],
    "rosters": {"Art": [{"name": "Josh Allen", "id": "3918298", "team": "BUF"}, "..."]}
  },
  "lightning_table": {
    "columns": ["RB2", "QB2", "QB3", "QB4", "WR2", "WR3", "RB3"],
    "rosters": {"Art": [{"name": "James Cook III", "id": "...", "team": "BUF"}, "..."]}
  },
  "recorded": {"players": {"3918298": {"points": 15, "state": "final"}, "...": {}}}
}
```

- `id` is the ESPN athlete id (the key used for all stat lookups; box-score athletes carry the same id as
  team rosters). `team` is the ESPN team abbreviation and tells the page which game the player is in.
  `name` is ESPN's `displayName`, written by `resolve`.
- `recorded` is absent until the week is recorded. Once present, it holds every rostered player's final
  points and state, and the page never calls ESPN for that week.
- **A week is "recorded" if and only if its week file has `recorded`.** Nothing else stores that fact.

### Units

**`scoring.js`** — pure functions, ES module, runs in browser and Node.
- `playerPoints(statLine, twoPt)` → integer
- `scoreWeek(weekFile, playersById)` where each entry is `{points, state}` → team-table totals and pot
  result; per-column lightning winners and money; per-owner settlement `{lightning, teamPot, total}`; plus
  `final: boolean`, true only when **no** rostered player is live, not started, or unknown.
- `standings(baseline, weekResults)` → accumulated totals and Order.

**`espn.js`** — the only code that knows ESPN's shapes; takes an injectable `fetch`.
- `fetchScoreboard(season, week)` from `scoreboard?seasontype=2&week=N&dates=SEASON` →
  `{games: [{id, teams: [abbr, abbr], phase, kickoff}], byeTeams: [abbr]}`. `phase` comes from
  `event.status.type`: `pre` (state "pre"), `in` (state "in"), `done` (`completed: true`), or `unresolved`
  (state "post" but `completed: false` — how a cancelled game appears, e.g. BUF @ CIN, Week 17 2022).
  `byeTeams` comes from the scoreboard's `week.teamsOnBye`.
- `fetchGame(id)` from `summary?event=ID` → `{stats: {athleteId: statLine}, twoPt: [{name, teamAbbr,
  points}]}`. 2-pt conversions are parsed from scoring-play text: `(X Pass to Y for Two-Point Conversion)`
  gives X +1 and Y +2; `(X Run for Two-Point Conversion)` gives X +2; plays containing "Failed" are ignored.
  (Checked against all 73 games of weeks 4–8 2026: every successful conversion matches one of these two
  patterns, and names carry the same suffixes as box-score display names.) A 2-pt name is attached to a
  rostered player by exact match on `name` among rostered players whose `team` is the scoring team.
- `fetchRosters()` (CLI only) → every team's roster. Team ids come from the `teams` endpoint (they are not
  1–32: BAL is 33, HOU is 34). Rosters include injured-reserve and practice-squad players.

**`app.js`** — rendering and refresh only; all numbers come from `scoring.js`.

**`cli/score.mjs`** — run as `node --use-system-ca cli/score.mjs …` (plain Node rejects this network's
proxy certificate; a package.json script wraps it).
- `resolve <draft.json>`: the draft holds **full names** (Claude expands the pasted surnames first, and
  tells Mxue which ones were a judgement call). `resolve` matches each name exactly against ESPN
  `displayName` among QB/RB/WR/TE/FB only — not by column, since WR columns hold tight ends — and writes
  `name`, `id`, `team`. It never guesses: no match, or more than one, fails and lists the candidates; a
  draft entry may give `team` to settle a real duplicate.
- `<season> <week>`: prints both tables, settlement and standings, and warns if any rostered player's
  current ESPN team differs from the week file's `team`.
- `<season> <week> --record`: see Recording.

### Player states

Derived from the player's `team`, the scoreboard, and the game summary:

| State | When | Shown | Blocks final |
|---|---|---|---|
| final | game done; player has a stat line or a 2-pt conversion | points | no |
| did not play | game done; summary loaded; no stat line and no 2-pt | 0, "DNP" | no |
| bye | team is in the scoreboard's `byeTeams` | 0, "BYE" | no |
| live | game in progress | points so far (0 if none yet), "LIVE" | yes |
| not started | game is `pre` | "—" | yes |
| unknown | anything else: game `unresolved`; summary failed to load; or team in neither a game nor `byeTeams` | "—", "?" | yes |

While any player blocks final, the containing lightning column, the team pot and the week settlement are
**provisional**: labelled as such and shown with current numbers, counting non-final players as 0. No
winner is highlighted in a table or column until at least one of its players' games has started.

An `unknown` that will not clear by itself (a cancelled game, a player who changed teams) is resolved by
the scorekeeper editing the week file: correct the `team`, or once the league has ruled, record the week
after setting that player's result by hand in `recorded`.

## Page layout (single page, phone-first)

1. Header: league name, week picker, "last updated hh:mm" and a refresh button. The picker defaults to the
   earliest unrecorded week that has a game started; if there is none, the latest week.
2. **Team table** — owner rows, five player cells (name + points + state tag), total; winner row highlighted;
   pot line ("Galli wins $140" or "provisional: Vince & JohnO tied").
3. **Lightning table** — owner rows × 7 columns, column winners bold; below it the $-by-column grid with a
   lightning-net row.
4. **Week settlement** — per owner: lightning $, team pot $, week total, for the selected week.
5. **Accumulated standings** — always the latest standings, independent of the week picker (see below).

Whole-dollar amounts show without cents. Tables scroll horizontally inside their own container on narrow
screens; the page itself never scrolls sideways.

## Data flow and refresh

On load: fetch `league.json`, `baseline.json`, `weeks/index.json`, and every week file (they are small).

**Recorded week:** rendered entirely from `recorded`. No ESPN calls.

**Unrecorded week** — a game is *relevant* if a rostered player's team is in it:
1. Fetch the scoreboard.
2. Fetch the summary of every relevant game that is `in` or `done`.
3. A `done` game's summary is cached in memory once fetched **after** the game was first seen as `done`,
   so the last plays are never missed.
4. While the tab is visible and any relevant game is not yet `done`, repeat: every 60 seconds if a
   relevant game is `in`, otherwise every 5 minutes (so the page picks up kickoffs by itself). Each repeat
   is the scoreboard plus the summaries from steps 2–3 not already cached.
5. Polling pauses when the tab is hidden and stops once every relevant game is `done` or `unresolved`.
   The refresh button runs steps 1–3 immediately.

### Accumulated standings

`baseline.json`: `{"through_week": 8, "totals": {"JD": 572, "Galli": -458, "...": 0}}`.

Standings = baseline + the settlement of every recorded week (computed from its frozen `recorded` results)
+ the live settlement of every unrecorded week. The table shows: total through the last recorded week;
one column per unrecorded week (normally just the current one), labelled provisional until that week is
final; the resulting total; and Order (1 = lowest total). It does not change with the week picker.

Because recorded-week money is always derived from the week files, there is no second copy to fall out
of step.

### Recording

`node --use-system-ca cli/score.mjs <season> <week> --record`:
1. Fetches the week from ESPN and scores it. Any failed request aborts.
2. Refuses if the week is not final, is already recorded, or any rostered player's current ESPN team
   differs from the week file's `team`.
3. Prints every DNP and BYE player so the scorekeeper can confirm each zero is real.
4. Writes every rostered player's points and state into the week file's `recorded`.

After recording, later ESPN stat corrections do not change the week. To re-record, delete `recorded` from
the week file and run it again.

### Owner names

One display name per owner, set in `league.json`. Default: the roster-table names (Art, Mxue, Vince, Kevin,
Galli, JD, JohnO). The league sheet's "JohnD" and "Mike" are the same people as JD and Galli; the display
name can be changed in `league.json` without touching anything else.

## Error handling

- ESPN unreachable or the scoreboard fails: keep showing the last successfully loaded numbers with a banner
  "Live stats unavailable — showing data from hh:mm"; retry on the next poll. On first load with no data,
  show the rosters with "—" and the banner. Recorded weeks are unaffected.
- One game's summary fails but others succeed: that game's players are `unknown`; the week is provisional.
- A data JSON file missing or malformed: show a plain error message naming the file.
- ESPN changing its response shape is the main long-term risk; `espn.js` isolates it so a fix touches one
  file, and the fixtures make breakage obvious. Recorded weeks keep working regardless.

## Weekly workflow

1. Mxue pastes the two tables to Claude.
2. Claude records the previous week if it is final and not yet recorded (`--record`).
3. Claude writes a draft week file with full names, runs `resolve`, and reports any judgement calls.
4. Claude adds the week to `index.json`, commits, and pushes.
5. The page goes live for the new week and updates itself through Sunday and MNF.

## Testing

- `node --test`, never touching the network. Fixtures are the Week 9 2026 scoreboard and the summaries of
  its relevant games, trimmed to the fields `espn.js` reads, plus the 2022 Week 17 scoreboard entry for the
  cancelled game.
- Golden test: Week 9 from fixtures must reproduce `docs/specs/week9-golden.txt` (the saved output of
  `score.py 2026 9` on 2026-11-10) exactly — team totals (Galli 115, Vince 106, JohnO 106, Kevin 105,
  Mxue 104, JD 87, Art 73), all 49 lightning player scores, every column's winner — plus the settlement
  (Art −60, Mxue +448, Vince −196, Kevin −42, Galli +106, JD −72, JohnO −184) and standings (JD 500,
  JohnO 408, Mxue 230, Art 74, Kevin −134, Galli −352, Vince −726).
- The recorded Week 9 file must give the same results as the fixtures.
- Unit tests for: per-category flooring and negative yards; both 2-pt text patterns, the "Failed" case, and
  a player whose only contribution is a 2-pt conversion; 2-way and 3-way ties in team pot and lightning,
  including leftover cents and the sum-to-zero invariant; every player state, including bye not blocking
  final and unknown/unresolved blocking it; no winner before kickoff; picker default; `resolve` failing on
  unknown and duplicate names (e.g. two players named Justin Jefferson) and ignoring defensive players;
  `--record` refusing a non-final week, an already-recorded week, and a team mismatch.
- Manual check: open the published page at phone width and desktop, during a live game window if possible.

## One-time setup

1. Mxue creates a free GitHub account.
2. Install the GitHub CLI on this machine and sign in (`gh auth login`); `git init` the `fantasy` folder.
3. Create a public repo (e.g. `fantasy-league`) and enable Pages from the `main` branch root.
4. Migrate Week 9: resolve its roster file, record it, and write `baseline.json` from the Week 8 totals.
5. Push; the site appears at `https://<username>.github.io/fantasy-league/`.

Note: because the repo is public, the roster files, totals, and code are also visible on GitHub itself,
not just on the page.

## Out of scope

Logins or per-person editing; notifications; projections or win probabilities; playoff weeks (the page
only handles regular-season weeks); data for weeks before 9 other than the Week 8 baseline; any scoring
rule changes; automatic rulings on cancelled or postponed games.
