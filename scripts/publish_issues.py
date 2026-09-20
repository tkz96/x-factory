#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
import time

REPO = "tkz96/x-factory"
CACHE_FILE = os.path.expanduser("~/.gemini/antigravity-ide/brain/b34d6d0d-c3c0-4a9e-837c-dbb69f938f11/scratch/created_issues.json")
PARSER_FILE = os.path.expanduser("~/.gemini/antigravity-ide/brain/b34d6d0d-c3c0-4a9e-837c-dbb69f938f11/scratch/parse_tickets.py")

# Ensure scratch directory exists
os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)

# Import epics from parser
sys.path.append(os.path.dirname(PARSER_FILE))
from parse_tickets import epics

def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_cache(cache):
    with open(CACHE_FILE, "w") as f:
        json.dump(cache, f, indent=2)

def format_ticket_body(epic, ticket_id, title, raw_body):
    lines = [l.strip() for l in raw_body.strip().split('\n') if l.strip()]
    
    sections = []
    current_header = None
    current_items = []
    depends_on = 'None'
    
    for line in lines:
        if line.lower().startswith('depends on:'):
            depends_on = line.split(':', 1)[1].strip()
            continue
        # Check for section headers like "Cover:", "Support:", "Goal:", etc.
        if line.endswith(':') and not line.startswith('http'):
            header_name = line[:-1].strip()
            # If it's a lowercase transition word like "to:", keep it as item
            if header_name.lower() in ['to', 'change']:
                current_items.append(f"**{line}**")
                continue
            if current_header or current_items:
                sections.append((current_header, current_items))
            current_header = header_name
            current_items = []
        else:
            current_items.append(line)
            
    if current_header or current_items:
        sections.append((current_header, current_items))
        
    out = [f"### **{epic}**\n"]
    for header, items in sections:
        if header:
            out.append(f"#### {header}")
        for it in items:
            if it.startswith('- ') or it.startswith('* '):
                out.append(it)
            elif '↓' in it or '→' in it:
                out.append(f"- `{it}`")
            else:
                out.append(f"- {it}")
        out.append("")
        
    out.append("#### Dependencies")
    out.append(f"- **Depends on:** {depends_on}")
    out.append("\n---\n*Part of the [Architecture & Production Migration Roadmap](https://github.com/tkz96/x-factory/issues).*")
    return "\n".join(out).strip()

def run_gh_command(cmd, max_retries=4):
    retries = 0
    while retries <= max_retries:
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0:
            return res.stdout.strip()
        err = res.stderr
        print(f"Command failed (code {res.returncode}): {err}")
        if "rate limit" in err.lower() or "secondary" in err.lower() or "abuse" in err.lower():
            wait_time = 30 * (retries + 1)
            print(f"Rate limited by GitHub. Backing off for {wait_time}s...")
            time.sleep(wait_time)
            retries += 1
        elif "connection" in err.lower() or "timeout" in err.lower():
            time.sleep(5)
            retries += 1
        else:
            raise RuntimeError(f"gh command failed: {err}")
    raise RuntimeError(f"Exceeded max retries for gh command: {cmd}")

def create_issue(title, body):
    cmd = ["gh", "issue", "create", "-R", REPO, "--title", title, "--body", body]
    output = run_gh_command(cmd)
    m = re.search(r'(https://github\.com/[^\s]+/issues/(\d+))', output)
    if m:
        url = m.group(1)
        issue_number = int(m.group(2))
        return issue_number, url
    raise ValueError(f"Could not parse issue URL from gh output: {output}")


def main():
    cache = load_cache()
    print(f"Loaded cache with {len(cache)} existing issues.")
    
    # 1. Create all 78 issues
    for idx, t in enumerate(epics):
        t_id = t["id"]
        if t_id in cache:
            print(f"[{idx+1}/{len(epics)}] Already created {t_id}: #{cache[t_id]['number']}")
            continue
            
        title = f"[{t_id}] {t['title']}"
        body = format_ticket_body(t["epic"], t_id, t["title"], t["body"])
        
        print(f"[{idx+1}/{len(epics)}] Creating issue for {t_id}: {title}...")
        try:
            num, url = create_issue(title, body)
            cache[t_id] = {
                "number": num,
                "url": url,
                "title": t["title"],
                "epic": t["epic"],
                "depends_on": [l.split(':', 1)[1].strip() for l in t["body"].split('\n') if l.strip().lower().startswith('depends on:')]
            }
            save_cache(cache)
            print(f"  ✓ Created #{num}: {url}")
            # Pacing delay to respect GitHub API limits
            time.sleep(1.8)
        except Exception as e:
            print(f"Error creating {t_id}: {e}")
            sys.exit(1)
            
    print("\nAll 78 ticket issues created or verified in cache!")
    
    # 2. Create Master Roadmap Issue
    if "ROADMAP" not in cache:
        print("\nCreating Master Roadmap Issue...")
        roadmap_title = "[Roadmap] Production-Grade Runtime & React Migration Backlog (XFM-01 – XFM-78)"
        
        roadmap_body_lines = [
            "# Production-Grade Runtime & React Migration Backlog",
            "",
            "This tracking issue oversees the complete architectural transition of X-Factory into a production-grade runtime featuring durable SQLite persistence, background worker execution, transactional event streaming, and TanStack/React frontend state management.",
            "",
            "## Architectural Principles & Sequence",
            "- **Non-Negotiable Order**: Durable State → Durable Jobs → Independent Worker → Recoverable Workflow → Durable Events → Server-State Management → React Shell → View Migration → Hostile Lifecycle QA.",
            "- **Critical Path**: `XFM-01` → `XFM-02` → `XFM-03` → `XFM-04` → `XFM-06` → `XFM-08` → `XFM-09` → `XFM-10` → `XFM-11` → `XFM-12`.",
            "",
            "```mermaid",
            "graph TD",
            "  M01[XFM-01 Architecture] --> M02[XFM-02 Data contracts]",
            "  M02 --> M03[XFM-03 Workflow contract]",
            "  M02 --> M05[XFM-05 SQLite infra]",
            "  M03 --> M04[XFM-04 Failure & recovery]",
            "  M05 --> M18[XFM-18–27 Worker system]",
            "  M18 --> M28[XFM-28–37 Workflow engine]",
            "  M28 --> M38[XFM-38–45 Frontend state]",
            "  M38 --> M46[XFM-46–55 React migration]",
            "  M46 --> M56[XFM-56–68 Production QA]",
            "  M56 --> M69[XFM-69–78 Ops & cleanup]",
            "```",
            "",
            "---",
            "",
            "## Epics & Tickets Checklist",
            ""
        ]
        
        current_epic = None
        for t in epics:
            t_id = t["id"]
            epic_name = t["epic"]
            num = cache[t_id]["number"]
            
            if epic_name != current_epic:
                current_epic = epic_name
                roadmap_body_lines.append(f"\n### {epic_name}\n")
                
            roadmap_body_lines.append(f"- [ ] #{num} `[{t_id}]` {t['title']}")
            
        roadmap_body = "\n".join(roadmap_body_lines).strip()
        num, url = create_issue(roadmap_title, roadmap_body)
        cache["ROADMAP"] = {"number": num, "url": url}
        save_cache(cache)
        print(f"  ✓ Created Master Roadmap Issue #{num}: {url}")
    else:
        print(f"Master Roadmap Issue already exists: #{cache['ROADMAP']['number']}")
        
    roadmap_num = cache["ROADMAP"]["number"]
    
    # 3. Update issue bodies to link exact issue numbers for dependencies & roadmap
    print("\nUpdating dependency links in issue descriptions...")
    for idx, t in enumerate(epics):
        t_id = t["id"]
        issue_num = cache[t_id]["number"]
        
        # Check raw dependencies
        raw_deps = "None"
        for line in t["body"].split('\n'):
            if line.strip().lower().startswith('depends on:'):
                raw_deps = line.split(':', 1)[1].strip()
                break
                
        # Format resolved dependencies with #issue_number links
        resolved_deps = raw_deps
        for other_t in epics:
            other_id = other_t["id"]
            if other_id in raw_deps:
                other_num = cache[other_id]["number"]
                # Replace XFM-xx with #num (XFM-xx)
                resolved_deps = re.sub(rf'\b{other_id}\b', f'#{other_num} ({other_id})', resolved_deps)
                
        # Re-format body with resolved dependencies and link to roadmap issue
        body = format_ticket_body(t["epic"], t_id, t["title"], t["body"])
        # Replace dependencies line
        body = re.sub(r'- \*\*Depends on:\*\*.*', f'- **Depends on:** {resolved_deps}', body)
        # Update roadmap link
        body = body.replace("(https://github.com/tkz96/x-factory/issues)", f"(#{roadmap_num})")
        
        # Edit issue via gh
        cmd = ["gh", "issue", "edit", str(issue_num), "-R", REPO, "--body", body]
        run_gh_command(cmd)
        if (idx + 1) % 10 == 0 or idx == len(epics) - 1:
            print(f"  ✓ Updated dependencies for [{idx+1}/{len(epics)}] issues")
        time.sleep(1.0)
        
    print("\nAll done! Every ticket is created, indexed, and cross-referenced.")

if __name__ == "__main__":
    main()
