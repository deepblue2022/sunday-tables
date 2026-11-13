# Fantasy league rules

7 owners: Art, Mxue, Vince, Kevin, Galli, JD, JohnO. Rosters are pasted in weekly as two tables.

## Player scoring (both tables)
- Passing: 1 pt per 20 yds; 3 pts per TD; 1 pt per 2-pt conversion pass
- Rushing / receiving: 1 pt per 10 yds; 6 pts per TD; 2 pts per 2-pt conversion run/catch
- No decimals: floor each yardage category separately (e.g. 287 pass yds = 14, 48 rush yds = 4); negative yards = 0
- No penalties (INTs, fumbles, etc. = 0)

## Team table (QB / RB / RB / WR / WR)
- Each owner puts in $20 ($140 pot); highest 5-player total takes all
- Ties split the pot

## Lightning table (RB2 / QB2 / QB3 / QB4 / WR2 / WR3 / RB3), $2 per point
- Each column is its own contest: highest scorer wins
- Every other owner pays the winner (winner pts - their pts) x $2
- Ties for the top split the column's winnings; tied winners pay each other nothing

## Weekly workflow
All commands run from this folder. The site is the files in this folder; publishing is `git push`.

1. **Record last week** once all its games are final: `npm run score -- <season> <week> --record`.
   This freezes the results into `data/weeks/<season>-<week>.json`; the site then stops asking ESPN about that week.
2. **Add the new week:** write the two pasted tables into a draft file (same shape as
   `test/fixtures/2026-09/week-draft.json`), using ESPN full display names
   (e.g. "James Cook III", "Michael Penix Jr.", "Kenneth Walker III"). Column order can differ week to week.
3. **Resolve names:** `npm run score -- resolve <draft.json> --out data/weeks/<season>-<week>.json`.
   Fix any names it cannot find and re-run.
4. **List the week** in `data/weeks/index.json`.
5. **Publish:** commit and `git push`. The site shows the week and updates on its own while games are on.
6. To see the tables in the terminal at any time: `npm run score -- <season> <week>`.

**Adding a past week** (before the starting totals in `data/baseline.json`): do steps 2-4, check the week's
settlement against the old spreadsheet, subtract it from the baseline totals, set `through_week` one lower,
then record the week. `resolve` uses the team each player played for that week, so traded players score correctly.

**Settled corrections:** if a week was paid on a score that differs from the rules, keep the paid number
as the player's `points` in the recorded week and add `"override": {"rules": <rules points>, "reason": "..."}`.
The site marks the score with a `*` and the stats card shows both numbers. The tests check that every other
saved score matches its stat line exactly.

**2-pt check:** ESPN's box score has no 2-pt conversions, so they are read from the scoring-play text and
cross-checked against the score (a team's score rising by exactly 8 on one play means a successful 2-pt try).
For finished games, `npm run score -- <season> <week>` prints a `2-PT CHECK` line for any play where the two
disagree, or where the play text names someone who is almost, but not exactly, one of our players (e.g.
"Mitch Trubisky" vs "Mitchell Trubisky"). `--record` refuses until each is settled in the week file:
`"two_pt_fixes": [{"play": "<play id>", "id": "<athlete id>", "points": 1 or 2, "reason": "..."}]` credits the
player (1 for the passer, 2 for the receiver or runner); use `"id": null, "points": 0` when nobody of ours
should get anything. The site uses the fix too.

**Cancelled or postponed games:** the site leaves that week provisional and the players show "?".
The scorekeeper decides how to settle it.

Data: ESPN public API (scoreboard + game summary box scores). 2-pt conversions are parsed from scoring-play text.
