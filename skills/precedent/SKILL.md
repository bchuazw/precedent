---
name: precedent-decision-check
description: Check planned code changes against the team's recorded decisions (Confluence decision pages and ADRs, decision items, Jira "Decision:" comments) through the Precedent MCP server before writing code. Use when asked to implement a story or feature, add a dependency, vendor, database or service, change authentication, logging, data handling or release behaviour, or when a task names a Jira work item key — in any codebase whose team works in Jira and Confluence.
---

# Precedent: check team decisions before you build

Teams record decisions ("use passkeys instead of SMS codes for 2FA", "never log PII", "no new MongoDB services")
and then forget them. Precedent indexes those decisions and answers one question for a coding agent:
**does this change contradict something the team already decided?** Call it before writing code, not after.

## Setup (once)

1. A site admin enables external access: admin.atlassian.com → (site) → Connected apps → Precedent → Details →
   Tools → **Enable tools** (for both the Jira and the Confluence rows if Precedent is installed in both).
2. Add the server to your MCP client, for example Claude Code:

   ```
   claude mcp add --transport http precedent https://mcp.atlassian.com/forge/d93cb16f-78d7-4259-aadd-e989600915f0
   ```

   You sign in with your Atlassian account. Results only include decisions whose source page or work item
   you can open yourself.

## Tools

| Tool | Use it for | Input |
| --- | --- | --- |
| `check-work-item` | A task that names a Jira key ("implement MOBL-58") | the work item key |
| `check-proposal` | Any plan described in words | one or two sentences: what you are about to build and how |
| `check-confluence-page` | A design doc, RFC or spec you were pointed to | the page link or id |
| `search-decisions` | "Why do we use X?", "what did we decide about Y?" | keywords |
| `get-decision` | Full text, rationale, owner and link of one decision | the decision key (e.g. ADR-007) |
| `list-recent-decisions` | Catching up on what changed lately | — |

## How to use the result

1. **Before writing code**, call `check-work-item` (if there is a key) or `check-proposal` with a concrete
   summary of the plan, naming the technologies, vendors and data involved ("Add an SMS one-time passcode
   fallback to the 2FA sign-in flow" — not "improve login").
2. Read every finding:
   - **conflict** — stop. Tell the user which decision it contradicts, why the team decided it, who owns it,
     and link it. Do not write the conflicting code unless the user explicitly says to go ahead.
     Propose an alternative that follows the decision.
   - **aligned** — proceed, and mention the decision you are following.
   - **related** — read the decision statement yourself. Precedent's automatic check is deliberately cautious and
     only says "conflict" when it is sure; if your plan plainly goes against a related decision, treat it as a
     conflict.
   - **nothing found** — before you rely on that, call `search-decisions` with the technologies, vendors and kinds
     of data your plan involves, and read the top results. No hits means no recorded decision, not permission.
3. **If the user wants to reverse a decision**, don't route around it. Suggest recording a superseding decision
   (in Jira: the Precedent panel's "Record a decision" with "Reverses an earlier decision", or ask the Rovo
   Precedent agent) and talking to the owner Precedent named.
4. Re-check when the plan changes materially (a new dependency, a different data flow).

Never present a conflict as a blocker you invented: always cite the decision key and link Precedent returned.

## Example

> **User:** Add an SMS one-time passcode fallback to the 2FA sign-in flow so locked-out customers can still get in.
>
> **Agent** calls `check-proposal` → `1 possible conflict: ADR-007 — Mentions "SMS one-time passcodes", which
> ADR-007 ruled out for 2FA on 2026-03-12.`
>
> **Agent:** I didn't write the SMS fallback, because it contradicts ADR-007 (decided 2026-03-12): the team chose
> passkeys with a TOTP fallback because SIM-swap attacks make SMS codes unsafe. Ryan Lee owns that decision.
> For locked-out customers I'd suggest one-time recovery codes issued at 2FA setup, plus prompting for a second
> passkey. If you still want SMS, the way forward is a superseding decision — want me to draft it?
