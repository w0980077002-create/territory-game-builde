#!/usr/bin/env python3
"""Read-only, event-driven TERRITORY specialist checks. No production access."""
import json, os, re, subprocess, sys, urllib.request
from pathlib import Path
from datetime import datetime, timezone

OWNER = "w0980077002-create"
MARKER = "SPECIALIST_APPROVED: owner-2026-11-08"
PROFILES = {"ART":"art-director.agent.md","ANIMATION":"combat-animator.agent.md",
    "GAMEPLAY":"gameplay-designer.agent.md","ECONOMY":"economy-guardian.agent.md",
    "LEAD":"lead-producer.agent.md","QA":"release-qa.agent.md"}
CHECKS = {"ART":("typecheck","test:visual-viking","build"),
    "ANIMATION":("typecheck","test:combat","build"),
    "GAMEPLAY":("typecheck","test:pve"),
    "ECONOMY":("test:pve","test:client-guard"),
    "LEAD":(), "QA":("typecheck","lint","test:pve","build")}
LIMITATIONS = {"ART":"Existing art tests, NOT a new illustration or real mobile visual acceptance.",
    "ANIMATION":"Existing combat checks, NOT newly created character rigs or video.",
    "GAMEPLAY":"Offline PvE checks only; no Telegram test or real-player validation.",
    "ECONOMY":"Offline tests only, no production currencies or database access.",
    "LEAD":"Automatic issue/PR triage, not a cloud coding-agent session.",
    "QA":"Offline CI only; no real phone verification."}

def event_info():
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    issue = event["issue"]
    if os.environ.get("GITHUB_ACTOR") != OWNER or issue["user"]["login"] != OWNER:
        raise ValueError("Owner approval required")
    match = re.match(r"^\[AGENT:(ART|ANIMATION|GAMEPLAY|ECONOMY|LEAD|QA)\]\s+", issue["title"])
    if not match or MARKER not in (issue.get("body") or "").splitlines():
        raise ValueError("Exact specialist role and standalone approval marker required")
    if len(issue.get("body") or "") > 20000:
        raise ValueError("Issue too large")
    role = match.group(1)
    if not (Path(".github/agents") / PROFILES[role]).is_file():
        raise ValueError("Specialist profile not found")
    return role, int(issue["number"])

def github_get(path):
    repo = os.environ["GITHUB_REPOSITORY"]
    if repo != OWNER + "/territory-game-builde":
        raise ValueError("Unexpected repository")
    req = urllib.request.Request("https://api.github.com/repos/" + repo + path,
       headers={"Authorization":"Bearer "+os.environ["GH_TOKEN"],
                "Accept":"application/vnd.github+json", "User-Agent":"territory-readonly-specialist"})
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.load(resp)

def lead_lines():
    issues = [x for x in github_get("/issues?state=open&per_page=60") if "pull_request" not in x]
    prs = github_get("/pulls?state=open&per_page=30")
    lines = [f"Open issues (first 60): {len(issues)}; open PRs (first 30): {len(prs)}.",
             "Specialist assignments still needing a reviewed result:"]
    lines += [f"- Issue #{x['number']}: {x['title'][:100]}" for x in issues
              if x["title"].startswith("[AGENT:")]
    lines += [f"- PR #{x['number']}: {x['title'][:100]}" for x in prs[:6]]
    return lines

def check(role, issue):
    lines = [f"### TERRITORY {role} automatic execution — #{issue}",
             "UTC: "+datetime.now(timezone.utc).isoformat(),
             "Strict read-only execution; no code changes, merge, deployment or Supabase writes.",
             "Profile: .github/agents/"+PROFILES[role]]
    failed = False
    if role == "LEAD":
        try: lines += lead_lines()
        except Exception as exc:
            failed = True
            lines.append("FAIL: GitHub queue read: "+str(exc))
    else:
        for task in CHECKS[role]:
            print("Running npm run "+task, flush=True)
            try:
                p = subprocess.run(["npm","run",task],capture_output=True,text=True,timeout=480)
                ok = p.returncode == 0
                failed |= not ok
                lines.append(f"- {'PASS' if ok else 'FAIL'}: npm run {task}")
                if not ok:
                    lines.append("  Last output: "+" | ".join((p.stderr+"\n"+p.stdout).splitlines()[-10:])[:1250])
            except subprocess.TimeoutExpired:
                failed = True
                lines.append("- FAIL: npm run "+task+" timed out (480s)")
    lines += ["Result: "+("FAILED CHECKS" if failed else "CHECKS PASSED"),
              "Limit: "+LIMITATIONS[role],
              "New code/art must use a separate assigned, scoped task and proof, not this audit."]
    report = "\n".join(lines)+"\n"
    Path("/tmp/territory-specialist-report.md").write_text(report,encoding="utf-8")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"],"a",encoding="utf-8") as f: f.write(report)
    print(report)
    return 1 if failed else 0

def daily():
    report = "### TERRITORY daily Lead Producer (read-only)\nUTC: "+datetime.now(timezone.utc).isoformat()+"\n"+"\n".join(lead_lines())+"\nNo writes or releases.\n"
    with open(os.environ["GITHUB_STEP_SUMMARY"],"a",encoding="utf-8") as f: f.write(report)
    print(report)

if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["daily"]:
            daily()
        else:
            role, issue = event_info()
            if sys.argv[1:] == ["plan"]:
                print("role="+role)
                print("issue="+str(issue))
            elif sys.argv[1:] == ["check"]:
                sys.exit(check(role,issue))
            else: raise ValueError("Expected plan/check/daily")
    except Exception as error:
        print("TERRITORY SPECIALIST ERROR:",error,file=sys.stderr)
        sys.exit(1)
