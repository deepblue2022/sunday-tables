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
1. Save the pasted tables as `rosters_week<N>.json` (copy the previous week's file), using ESPN full display names
   (e.g. "James Cook III", "Michael Penix Jr.", "Kenneth Walker III").
2. Run `python3 score.py <season> <week>`. Players in unfinished games show `?`; columns with one are PENDING.
3. Re-run after Monday Night Football to settle.

Data: ESPN public API (scoreboard + game summary box scores). 2-pt conversions are parsed from scoring-play text.
