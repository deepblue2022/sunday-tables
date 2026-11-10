#!/usr/bin/env python3
"""Weekly fantasy scoring for the league (see RULES.md).

Usage: python3 score.py <season> <week> [rosters.json]
Rosters default to rosters_week<week>.json next to this script.
Players are given by ESPN display name (e.g. "James Cook III").
"""
import json, os, re, subprocess, sys

API = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"
HERE = os.path.dirname(os.path.abspath(__file__))


def get(url):
    # curl rather than urllib: Python 3.13's strict SSL rejects this network's proxy cert.
    out = subprocess.run(["curl", "-sSf", "--max-time", "30", url],
                         capture_output=True, check=True).stdout
    return json.loads(out)


def fetch_week(season, week):
    sb = get(f"{API}/scoreboard?seasontype=2&week={week}&dates={season}")
    stats, two_pt, pending = {}, {}, set()
    for ev in sb["events"]:
        if not ev["status"]["type"]["completed"]:
            # Everyone on either team's roster is still pending.
            for c in ev["competitions"][0]["competitors"]:
                ro = get(f"{API}/teams/{c['team']['id']}/roster")
                for grp in ro.get("athletes", []):
                    for a in grp["items"]:
                        pending.add(a["displayName"])
            continue
        d = get(f"{API}/summary?event={ev['id']}")
        for t in d.get("boxscore", {}).get("players", []):
            for cat in t["statistics"]:
                if cat["name"] not in ("passing", "rushing", "receiving"):
                    continue
                for a in cat["athletes"]:
                    n = a["athlete"]["displayName"]
                    s = dict(zip(cat["keys"], a["stats"]))
                    r = stats.setdefault(n, {})
                    for k in ("passingYards", "passingTouchdowns", "rushingYards",
                              "rushingTouchdowns", "receivingYards", "receivingTouchdowns"):
                        if k in s:
                            r[k] = int(s[k] or 0)
        for p in d.get("scoringPlays", []):
            txt = p.get("text", "")
            if "Failed" in txt:
                continue
            m = re.search(r"\((.+?) Pass to (.+?) for Two-Point Conversion\)", txt)
            if m:
                two_pt[m.group(1)] = two_pt.get(m.group(1), 0) + 1  # passer
                two_pt[m.group(2)] = two_pt.get(m.group(2), 0) + 2  # receiver
            m = re.search(r"\((.+?) (?:Run|Rush) for Two-Point Conversion\)", txt)
            if m:
                two_pt[m.group(1)] = two_pt.get(m.group(1), 0) + 2
    return stats, two_pt, pending


def short(name):
    parts = [w for w in name.split() if w not in ("Jr.", "Sr.", "II", "III", "IV")]
    return parts[-1]


def points(stats, two_pt, name):
    s = stats.get(name, {})
    g = lambda k: max(s.get(k, 0), 0)
    return (g("passingYards") // 20 + g("rushingYards") // 10 + g("receivingYards") // 10
            + 3 * s.get("passingTouchdowns", 0)
            + 6 * (s.get("rushingTouchdowns", 0) + s.get("receivingTouchdowns", 0))
            + two_pt.get(name, 0))


def main():
    season, week = int(sys.argv[1]), int(sys.argv[2])
    path = sys.argv[3] if len(sys.argv) > 3 else os.path.join(HERE, f"rosters_week{week}.json")
    cfg = json.load(open(path))
    stats, two_pt, pending = fetch_week(season, week)
    for n in {n for t in ("team_table", "lightning_table")
              for ps in cfg[t]["rosters"].values() for n in ps}:
        if n not in stats and n not in pending:
            print(f"WARNING: no stats for {n} (bye, inactive, or name mismatch) -> 0")

    def pts(n):
        if n in pending:
            return None  # game not final yet
        return points(stats, two_pt, n)

    # Team table: highest total wins the pot, ties split.
    team = cfg["team_table"]
    print(f"== Team table (week {week}) ==")
    totals, open_ = {}, False
    for owner, players in team["rosters"].items():
        ps = [pts(n) for n in players]
        open_ |= None in ps
        totals[owner] = sum(p for p in ps if p is not None)
        print(f"{owner:7} " + "  ".join(f"{short(n)}={'?' if p is None else p}"
                                      for n, p in zip(players, ps)) + f"  TOTAL={totals[owner]}")
    pot = team["buy_in"] * len(totals)
    best = max(totals.values())
    winners = [o for o, t in totals.items() if t == best]
    print(f"Pot ${pot}: {'PROVISIONAL ' if open_ else ''}winner(s) {winners}, "
          f"${pot / len(winners):.2f} each")

    # Lightning table: per column, winner(s) collect $rate * delta from everyone else.
    light = cfg["lightning_table"]
    rate, cols = light["rate"], light["columns"]
    owners = list(light["rosters"])
    net = {o: 0.0 for o in owners}
    print(f"\n== Lightning table (${rate}/pt) ==")
    for i, col in enumerate(cols):
        vals = {o: pts(light["rosters"][o][i]) for o in owners}
        names = {o: light["rosters"][o][i] for o in owners}
        line = "  ".join(f"{o}:{short(names[o])}={'?' if v is None else v}" for o, v in vals.items())
        if None in vals.values():
            print(f"{col:5} PENDING  {line}")
            continue
        top = max(vals.values())
        win = [o for o, v in vals.items() if v == top]
        potc = sum(rate * (top - v) for v in vals.values())
        for o, v in vals.items():
            net[o] += potc / len(win) if o in win else -rate * (top - v)
        print(f"{col:5} winner {win}  {line}")
    print("Net (settled columns): " + "  ".join(f"{o} {net[o]:+.2f}" for o in owners))


if __name__ == "__main__":
    main()
