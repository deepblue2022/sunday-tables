# Sunday Tables

Static league site (GitHub Pages from `main`, repo root) plus a Node CLI. Scoring rules and the weekly
workflow are in `RULES.md`; read it first. No dependencies: `npm test` runs everything.

## Hard rules (the repo is public)

- Before any commit, run `git config user.name mxue && git config user.email ""` so commits have a blank email.
- Commit messages: plain text only. No `Co-Authored-By` lines, no email addresses, nothing personal.
- Never write an employer or company name, or any email address, into files or commit messages.
  The league is called "Sunday Tables". Before pushing, check:
  `git diff origin/main --cached -U0 | grep -i -E '@[a-z0-9.-]+\.[a-z]{2,}'` must print nothing.
- Push straight to `main` (`git push origin main`), not a side branch: the site publishes from `main`.
- Never rewrite or force-push history.

## Weekly update (the usual request)

The scorekeeper pastes two tables per week: the Team table (QB/RB/RB/WR/WR) and the Lightning table
(7 columns; names and order vary by week, e.g. QB2/QB3/RB2/RB3/QB4/RB4/WR2). Short names like "Watson".

1. **Record the previous week** if all its games are final: `npm run score -- <season> <week> --record`.
   Skip if its file already has `"recorded"`.
2. **Draft:** write `/tmp/weekN-draft.json` in the shape of `test/fixtures/2026-09/week-draft.json`, with
   ESPN full display names ("James Cook III", "Michael Penix Jr.", "C.J. Stroud"). Reuse full names from
   earlier `data/weeks/*.json` files where the same player appears.
3. **Resolve:** `npm run score -- resolve /tmp/weekN-draft.json --out data/weeks/<season>-<NN>.json`.
   Fix any reported names and re-run.
4. **List** the week in `data/weeks/index.json` (keep it sorted).
5. **Show** the scorekeeper the result (`npm run score -- <season> <week>`) and list every short name you
   had to guess. **Wait for confirmation** before committing.
6. `npm test`, commit, push to `main`.

**Past weeks** (earlier than `data/baseline.json` `through_week`): steps 2-4, show the week's money and
wait for the scorekeeper to confirm it matches the old spreadsheet, then subtract each owner's week total
from `baseline.json` totals, set `through_week` one lower, record the week, and check the standings in
`npm run score -- <season> <latest week>` are unchanged.

## Name pitfalls

- Use the column to decide the position: "Watson" in a QB column is Deshaun Watson, in a WR column
  Christian Watson. "Allen" in an RB column is Braelon Allen, not Josh Allen.
- "Jay Daniels" = Jayden Daniels (WSH); "Jal Daniels" = Jalon Daniels (TB).
- "Ja. Williams" = Javonte Williams, "K. Williams" = Kyren Williams, plain "Williams" at QB = Caleb Williams.
- If a short name could be two players, ask rather than guess.

## Environment

- The CLI needs network access to `site.api.espn.com`.
- `npm run score` passes `--use-system-ca`. If Node rejects that flag, run `node cli/score.mjs ...` instead.
