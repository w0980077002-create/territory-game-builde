#!/usr/bin/env python3
"""Opt-in, keyless TERRITORY agent: one guarded local AI edit per approved issue."""
import difflib
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.request

OWNER = "w0980077002-create"
ROLES = {"UI", "ANIMATION", "GAMEPLAY", "QA"}
ROOT = Path.cwd().resolve()
LIMIT = 16000
BANNED = re.compile(r"(?:^|[/_-])(admin|auth|payment|wallet|supabase|economy|rewards?|vip|secrets?|tokens?|security)(?:[/_.-]|$)", re.I)


def issue_info():
    event_file = os.environ.get("GITHUB_EVENT_PATH")
    if not event_file:
        raise ValueError("GITHUB_EVENT_PATH is required")
    event = json.loads(Path(event_file).read_text(encoding="utf-8"))
    issue = event["issue"]
    if os.environ.get("GITHUB_ACTOR") != OWNER or issue["user"]["login"] != OWNER:
        raise ValueError("Only the repository owner can launch an agent")
    match = re.match(r"^\[AI:(UI|ANIMATION|GAMEPLAY|QA)\]\s+(.+)", issue["title"])
    if not match:
        raise ValueError("Issue title must start with [AI:UI], [AI:ANIMATION], [AI:GAMEPLAY] or [AI:QA]")
    role = match.group(1)
    body = issue.get("body") or ""
    if not body or len(body) > 5000:
        raise ValueError("Issue body required, max 5000 characters")
    if role == "QA":
        return role, "", body, issue["number"]
    match_file = re.search(r"(?mi)^TARGET_FILE:\s*(src/components/[A-Za-z0-9_./-]+\.(?:css|tsx))\s*$", body)
    if not match_file:
        raise ValueError("Exactly one TARGET_FILE in src/components/*.css or *.tsx is required")
    target_name = match_file.group(1)
    if ".." in target_name or BANNED.search(target_name):
        raise ValueError("Target is prohibited by safety policy")
    target = (ROOT / target_name).resolve()
    if not target.is_relative_to(ROOT / "src" / "components") or not target.is_file():
        raise ValueError("Target must be an existing component file")
    if target.stat().st_size > LIMIT:
        raise ValueError("Target too large for reliable small-model editing; split the task")
    if role == "ANIMATION" and not target_name.endswith(".css"):
        raise ValueError("Free ANIMATION agent is limited to CSS effects (not character rigs)")
    task_match = re.search(r"(?mis)^REQUEST:\s*(.+)$", body)
    if not task_match or len(task_match.group(1).strip()) < 15:
        raise ValueError("REQUEST: with a precise description is required")
    return role, target_name, task_match.group(1)[:2800].strip(), issue["number"]


def request_model(prompt):
    payload = json.dumps({
        "model": "qwen2.5-coder:3b", "prompt": prompt, "stream": False, "format": "json",
        "options": {"temperature": 0.1, "num_ctx": 8192, "num_predict": 1000}
    }).encode()
    req = urllib.request.Request(
        "http://127.0.0.1:11434/api/generate", data=payload,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=850) as response:
        generated = json.loads(response.read().decode())["response"]
    data = json.loads(generated)
    if not isinstance(data, dict):
        raise ValueError("Model must produce one JSON object")
    return data


def apply_css_property(original, patch):
    """Change exactly one pre-existing safe CSS declaration; never accept free-form CSS code."""
    selector = patch.get("selector")
    prop = patch.get("property")
    value = patch.get("value")
    allowed = {
        "background", "background-color", "color", "border-color",
        "outline-color", "box-shadow", "text-shadow", "opacity", "gap",
        "padding", "margin", "font-size", "line-height", "border-radius",
        "transition-duration", "animation-duration"
    }
    if not all(isinstance(x, str) for x in (selector, prop, value)):
        raise ValueError("CSS patch needs string selector, property and value")
    selector, prop, value = selector.strip(), prop.strip().lower(), value.strip()
    if not selector.startswith(".") or len(selector) > 100 or prop not in allowed:
        raise ValueError("CSS selector/property not allowed")
    if not value or len(value) > 380 or any(x in value for x in (";", "{", "}", "\n")):
        raise ValueError("CSS value is too long or contains unsafe syntax")
    if re.search(r"(url\s*\(|@import|expression\s*\(|javascript:|data:|!important)", value, re.I):
        raise ValueError("CSS patch may not fetch remote assets or bypass safety")
    blocks = list(re.finditer(re.escape(selector) + r"\s*\{([^{}]*)\}", original))
    if len(blocks) != 1:
        raise ValueError("CSS selector must have exactly one existing block")
    block = blocks[0]
    rule = re.compile(r"(^|;)(\s*" + re.escape(prop) + r"\s*:\s*)([^;]+)", re.I)
    hits = list(rule.finditer(block.group(1)))
    if len(hits) != 1:
        raise ValueError("Property must exist exactly once in the CSS selector")
    hit = hits[0]
    previous_value = hit.group(3).strip()
    # Preserve authored material depth: flat colors must not replace textured gradients.
    if prop == "background" and "gradient(" in previous_value and "gradient(" not in value:
        raise ValueError("Refusing to flatten an existing textured background")
    if prop == "background" and "url(" in previous_value and "url(" not in value:
        raise ValueError("Refusing to remove an existing image-backed texture")
    start = block.start(1) + hit.start(3)
    end = block.start(1) + hit.end(3)
    return original[:start] + value + original[end:]


def perform_edit(role, target_name, task):
    path = ROOT / target_name
    original = path.read_text(encoding="utf-8")
    rules = (ROOT / "AGENTS.md").read_text(encoding="utf-8")[:3100]
    style = {
        "UI": "Prioritize compact 360px mobile layout, approved Shop/Arena natural textured dark-oak wood, warm gold and forged metal. Never add huge buttons, flat brown cards, mirrored wood patterns, or remove existing artwork.",
        "ANIMATION": "Improve one small CSS animation/effect. Maintain accessibility, reduced motion and mobile performance. Do not claim sprite animation from CSS alone.",
        "GAMEPLAY": "Improve ONLY a visual, non-reward, test-stage interface in this component. No currency, player state, inventory, game outcomes or API changes."
    }[role]
    specialist = {
        "UI": "art-director.agent.md",
        "ANIMATION": "combat-animator.agent.md",
        "GAMEPLAY": "gameplay-designer.agent.md",
    }[role]
    specialist_path = ROOT / ".github" / "agents" / specialist
    specialist_guidance = specialist_path.read_text(encoding="utf-8")[:2300]
    feedback = ""
    # Optional explicit component/property locks prevent the small model from
    # hallucinating CSS selectors and editing a different existing component.
    selector_lock = re.search(r"(?mi)^TARGET_SELECTOR:\s*(\.[A-Za-z0-9_-]+)\s*$", task)
    property_lock = re.search(r"(?mi)^TARGET_PROPERTY:\s*([a-z-]+)\s*$", task)
    for attempt in range(2):
        is_css = target_name.endswith(".css")
        output_format = (
            'Return ONLY {"selector":".existing-class","property":"background","value":"new CSS value"}. '
            "Edit ONE existing CSS declaration, not an entire rule. "
            "Use the exact class selector and property name visible in the source. "
            "Only output the new PROPERTY VALUE, without a semicolon or curly braces. "
            if is_css else
            'Return ONLY {"search":"EXACT existing substring","replace":"new substring"}. '
            "Select ONE short existing unique substring, preserving all unrelated text. "
        )
        prompt = (
            "You are a cautious TERRITORY code assistant. "
            + output_format
            + "Never change external files or any game economy, auth, save or server logic.\n"
            + f"ROLE: {role}\nSPECIALIST GUIDANCE: {style}\nEXISTING SPECIALIST PROFILE:\n{specialist_guidance}\n"
            + f"OWNER TASK: {task}\nEXPLICIT SELECTOR LOCK: {selector_lock.group(1) if selector_lock else 'none'}\nEXPLICIT PROPERTY LOCK: {property_lock.group(1) if property_lock else 'none'}\nREPO RULES EXCERPT:\n{rules}\n"
            + f"FILE PATH: {target_name}\nCURRENT FILE (verbatim):\n{original}\n"
            + f"{feedback}"
        )
        try:
            patch = request_model(prompt)
            if is_css:
                if selector_lock:
                    patch["selector"] = selector_lock.group(1)
                if property_lock:
                    patch["property"] = property_lock.group(1).lower()
                result = apply_css_property(original, patch)
            else:
                old, new = patch["search"], patch["replace"]
                if not isinstance(old, str) or not isinstance(new, str):
                    raise ValueError("TSX patch must contain two strings")
                if len(old.strip()) < 12 or len(old) > 3500 or len(new) > 5000:
                    raise ValueError("Replacement is empty or exceeds one-edit safety bounds")
                if original.count(old) != 1:
                    raise ValueError("Search span is not an exact, unique substring")
                result = original.replace(old, new, 1)
            plus = minus = 0
            for ln in difflib.unified_diff(original.splitlines(), result.splitlines()):
                if ln.startswith("+") and not ln.startswith("+++"):
                    plus += 1
                if ln.startswith("-") and not ln.startswith("---"):
                    minus += 1
            if plus + minus > 100 or len(result) - len(original) > 3500 or len(original) - len(result) > 1500:
                raise ValueError("Change too large for automated coding")
            if result == original:
                raise ValueError("No change produced")
            path.write_text(result, encoding="utf-8")
            print(f"Free {role} agent edited {target_name}, added {plus} / removed {minus} lines.")
            return
        except (ValueError, KeyError, json.JSONDecodeError) as error:
            feedback = f"\nYOUR PREVIOUS PATCH WAS REJECTED: {error}. Follow the JSON schema precisely and choose one existing declaration only.\n"
            print(f"Attempt {attempt + 1} failed: {error}", file=sys.stderr)
            if attempt == 1:
                raise ValueError("No safe scoped patch generated; repository unchanged") from error
            time.sleep(1)


def main():
    role, target, task, number = issue_info()
    if len(sys.argv) != 2 or sys.argv[1] not in ("plan", "edit"):
        raise ValueError("Expected plan or edit")
    if sys.argv[1] == "plan":
        print(f"role={role}")
        print(f"target={target}")
        print(f"issue={number}")
    elif role != "QA":
        perform_edit(role, target, task)
    else:
        raise ValueError("QA mode runs checks, not code edits")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"TERRITORY FREE AGENT: {exc}", file=sys.stderr)
        sys.exit(1)
