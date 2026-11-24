# Sunday Tables: league rules

Seven owners: Art, Mxue, Vince, Kevin, Galli, JD, JohnO. Every week each owner fills in two tables:
the **Team table** and the **Lightning table**. The site shows them live and keeps the money.

## 1. Weekly picks
- Picks are made on the day of the first game of the week. The scorekeeper posts both tables once the
  picks are in.
- **Tight ends count as WR:** a tight end can be picked in any WR spot, on either table.

## 2. Scoring (both tables)
- **Passing:** 1 point per 20 yards; 3 points per TD; 1 point per 2-point conversion pass.
- **Rushing and receiving:** 1 point per 10 yards; 6 points per TD; 2 points per 2-point conversion run or catch.
- **No decimals:** each yardage category is scored on its own and the decimals are dropped (287 passing
  yards = 14, 48 rushing yards = 4).
- **Negative yards count:** a category with negative yards can cost points once it reaches a whole point
  (−11 rushing yards = −1; −8 rushing yards = 0). A player's total can be negative.
- **No penalties:** interceptions, fumbles, sacks and so on cost nothing.
- **What doesn't score:** only passing, rushing and receiving count. Kick and punt returns (yards or
  touchdowns) and defensive or fumble-return touchdowns score nothing.

## 3. Team table (QB / RB / RB / WR / WR)
- Each owner puts in $20 ($140 pot). The highest five-player total takes the pot; a tie splits it.
- Owners may pick the same players, but **no player can be on all seven Team tables**: if everyone picks
  the same player, everyone replaces that pick. (This doesn't apply to the Thanksgiving Day pool; see 6.)

## 4. Lightning table: a draft, $2 per point
- **The draft:** owners have a pick order for the week. There are seven rounds. In round 1 the first
  owner in the order chooses the position for that round and picks first; the others follow in order. In
  round 2 the second owner chooses the position and picks first, and so on, wrapping around, so the owner
  who started the previous round picks last.
- **Positions:** the owner choosing a round may name any position (e.g. RB4), as long as there are enough
  players left for all seven owners. That is settled in the draft.
- **Each round (column) is its own contest:** the highest score wins it. Every other owner pays the
  winner (winner's points minus their own) x $2.
- **Ties at the top** split the column's winnings; tied winners pay each other nothing.

## 5. Season and money
- The regular season is **Weeks 1-18**. The money and the overall winner are decided on the regular
  season only.
- **The money is settled once, after Week 18** (no weekly payments). The site's standings show where
  everyone stands.
- **Last place buys the group lunch** at a high-end restaurant after the season.
- **Playoffs:** run after Week 18 and are separate from the money. Rules to be added closer to the time.

## 6. Thanksgiving week: two pools
Thanksgiving week has the usual **main pool** (Team table and Lightning table, all the usual rules) plus a
**Thanksgiving Day pool**. Both count toward the regular season.
- **Who can be picked:** only players in games on Thanksgiving Day (Thursday). Players picked for it can
  also be picked in the main pool.
- **Lineup:** 1 QB, 2 RB, 2 WR/TE, and a kicker. **Every player in a lineup, the kicker included, must be
  from a different NFL team.**
- **Unanimous picks are allowed:** the same player can be in all seven lineups (rule 3 doesn't apply here).
- **Money:** each owner puts in $20 ($140 pot). The highest five-player total (QB, RBs, WRs; scored as in
  rule 2) takes the pot.
- **Tiebreak:** the kicker breaks a tie on the total: 1 point per extra point, 3 points per field goal
  (any distance; misses score 0). Kicker points only break ties; they don't add to the total. If the
  kickers tie too, the tied owners split the pot.

## 7. Rulings
- **Settled scores:** if a week was paid on a score that differs from these rules, the paid score stands.
  The site shows it with a `*` and explains it on the player's stats card. (None so far.)
- **Cancelled or postponed games:** the week stays provisional (those players show "?") until the
  scorekeeper settles it.

---

# Scorekeeping (how the site is kept)

All commands run from this folder. The site is the files in this folder; publishing is `git push`.
Data: ESPN public API (scoreboard + game summary box scores). 2-pt conversions are parsed from scoring-play text.

1. **Record last week** once all its games are final: `npm run score -- <season> <week> --record`.
   This freezes the results into `data/weeks/<season>-<week>.json`; the site then stops asking ESPN about that week.
2. **Add the new week:** write the two pasted tables into a draft file (same shape as
   `test/fixtures/2026-09/week-draft.json`), using ESPN full display names
   (e.g. "James Cook III", "Michael Penix Jr.", "Kenneth Walker III"). Column order can differ week to week.
   The Lightning table's owners are pasted in pick order and its columns in round order: keep the columns as
   pasted and add `"pick_order": ["Vince", "Art", ...]` (the owners as pasted) to the Lightning table; the
   site lists the table in that order and marks each round's first pick with ◆. A pick order that doesn't
   list every owner once is ignored (the CLI warns) and never stops the week from scoring.
3. **Resolve names:** `npm run score -- resolve <draft.json> --out data/weeks/<season>-<week>.json`.
   Fix any names it cannot find and re-run. It warns if a player is on all seven Team tables (rule 3).
4. **List the week** in `data/weeks/index.json`.
5. **Publish:** commit and `git push`. The site shows the week and updates on its own while games are on.
6. To see the tables in the terminal at any time: `npm run score -- <season> <week>`.

**Thanksgiving week (rule 6):** the draft gets a third table next to the other two:
`"thanksgiving_table": {"columns": ["QB", "RB", "RB", "WR", "WR", "K"], "rosters": {"Art": [...], ...}}`
(the shape is in `test/thanksgiving.test.js`). The kicker column must be named exactly `"K"`, once: that is
how `resolve` knows to look up a kicker there and how the scoring knows the tiebreak. No `pick_order`.
`resolve` and `npm run score -- <season> <week>` warn if a lineup repeats an NFL team (kicker included) or
names someone not playing on Thanksgiving Day. The pool is never checked against rule 3 (unanimous picks are
allowed there); the main Team table keeps rule 3 that week too. `team_table.shared_ok: true` switches the
rule 3 check off for a week: only for an exception the league agrees, never for Thanksgiving.

**Ticker commentary:** the jokes between the scores come from `data/banter.json` (hand-written lines,
plus lines the site writes from the live scores). It has its own switch: `"on": true` shows it, `"on": false`
turns it off (the scores and fun facts carry on). The hand-written lines quote season numbers through
`"through_week"`; once a later week is recorded, `npm run score` warns until they are refreshed (or switched off).
`"notes_for_writers"` holds the league facts the lines are written from (lunch history and so on); the site
doesn't show them.

**Adding a past week** (before the starting totals in `data/baseline.json`): do steps 2-4, check the week's
settlement against the old spreadsheet, subtract it from the baseline totals, set `through_week` one lower,
then record the week. `resolve` uses the team each player played for that week, so traded players score correctly.

**Settled corrections (rule 7):** keep the paid number as the player's `points` in the recorded week and add
`"override": {"rules": <rules points>, "reason": "..."}`. The tests check that every other saved score
matches its stat line exactly.

**2-pt check:** ESPN's box score has no 2-pt conversions, so they are read from the scoring-play text and
cross-checked against the score (a team's score rising by exactly 8 on one play means a successful 2-pt try).
For finished games, `npm run score -- <season> <week>` prints a `2-PT CHECK` line for any play where the two
disagree, or where the play text names someone who is almost, but not exactly, one of our players (e.g.
"Mitch Trubisky" vs "Mitchell Trubisky"). `--record` refuses until each is settled in the week file:
`"two_pt_fixes": [{"play": "<play id>", "id": "<athlete id>", "points": 1 or 2, "reason": "..."}]` credits the
player (1 for the passer, 2 for the receiver or runner) in place of whatever the play text credited for that
role on that play; a credit for the other role on the same play stays. Use `"id": null, "points": 0` to clear
every credit on the play (nobody of ours should get anything). The site uses the fix too.
