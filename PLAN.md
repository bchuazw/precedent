# Codegeist 2026: plan

Deadline: **Tue Dec 22 2026, 12:00 PT = Wed Dec 23, 04:00 SGT.** Judging Jan 5 to Feb 3 2027; winners about Feb 15.
Registered on Devpost 2026-11-24 (solo). Rules: https://codegeist2026.devpost.com/rules

## Working concept: "Precedent"

> Your team already decided. Precedent makes sure you remember, before you ship.

The challenge text says Teamwork Graph gives teams "shared understanding of who's doing what, **what's already been decided**, and what needs to happen next." Teams forget decisions: a new story quietly reverses an architecture call, a vendor that was rejected comes back, a policy is re-argued from zero. Precedent turns past decisions into something Jira, Rovo and coding agents check automatically.

**Pieces (scope to what can be polished by Dec 20):**
1. **Decision index.** Harvest decisions from Confluence (native decision items, ADR pages, "Decision:" sections) and Jira (resolved "decision" issues, comments marked as decisions). Store normalized records with owner, date, rationale, scope, and links (Forge storage).
2. **Rovo agent "Precedent".** Actions: search_decisions, check_against_decisions (given an issue or a proposal), explain_decision (why, who, when, what it replaced), record_decision. Answers always cite the source page or issue.
3. **Jira issue panel.** On any work item: related decisions with stance (aligned / tension / conflict), each with a citation and owner, plus "Ask Precedent" for a reasoned check.
4. **Rovo MCP tools.** The same check exposed via rovo:mcp, so a coding agent (Claude Code, Cursor) can ask "does this change contradict a team decision?" before it writes code. This is the video's wow moment.
5. **Teamwork Graph.** Read who decided and which team owns the area, to route "talk to X before reversing this".

**Bonus prizes targeted:** Best Rovo agents, Best Atlassian MCP app, Best Teamwork Graph integration. Category: Apps for Software Teams.

**AI cost rule:** no Forge LLM calls (billed to us, no free allowance). Reasoning runs inside Rovo; the app supplies retrieval, structure and citations. Deterministic parts (harvesting, indexing, lexical/semantic-lite matching) run in Forge functions.

## Environment (done 2026-11-24)
- Atlassian account (Google SSO), Developer Space `bchuazw` (8a14c2e2-ec44-458e-80f5-14d14de42dc7).
- Free dev site bchuazw-dev.atlassian.net (no Rovo on the free bundle).
- Forge demo site (enterprise Jira/Confluence/JSM **with Rovo**, seeded data, 90 days): provisioning via `forge site provision`.
- Forge CLI 16 via `C:\Users\bchua\.codegeist\forge.ps1` (private Node 24.22.3; token in `C:\Users\bchua\.codegeist\atlassian-api-token`, never printed).
- `spike/`: preset rovo-agent-skill app (codegeist-spike) deployed to development and installed on bchuazw-dev Jira.

## Milestones
1. Nov 24-25: demo site up; spike agent visible in Rovo chat; Teamwork Graph and rovo:mcp checked on the demo site.
2. Nov 26-Dec 2: decision harvesting + storage + search; agent actions; issue panel v1.
3. Dec 3-9: conflict check quality; MCP tools; Teamwork Graph owners; seed demo data.
4. Dec 10-15: polish UI, judge setup flow, README, distribution link.
5. Dec 16-20: video (under 5 min, public YouTube), Devpost story, bonus write-ups. Submit by Dec 21 SGT.
