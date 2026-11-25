# Precedent: Devpost submission draft

**Tagline:** Your team already decided. Precedent makes sure you remember before you ship.

**Demo video:** https://youtu.be/1BGpiO1y-Yc

**Category:** Apps for Software Teams
**Bonus categories:** Best Rovo agent · Best Atlassian MCP app · Best Teamwork Graph integration

---

## Inspiration

Every team has had this meeting: someone proposes adding an SMS fallback, and someone else sighs, "we decided against that in March." Usually nobody remembers why, so the argument starts from zero. Worse, the story ships before anyone notices.

The decisions were written down. They sit in a Confluence decision page, a decision item in meeting notes, or a "Decision:" comment on a Jira ticket. Nobody reads those at the moment it matters, which is when new work is written. Precedent brings the decision to the work.

## What it does

Precedent indexes the decisions your team already records and checks new work against them, wherever that work happens:

- **Jira work item panel.** Shows whether the work contradicts, follows or relates to a past decision. The collapsed header reads "1 conflict" before anyone opens it. Each card gives the decision, what it ruled out, why, the owner, a link, and (via Teamwork Graph) the owner's teams: "Talk to Ryan Lee (Platform Support, Product Team) before reversing this."
- **Confluence byline** on RFCs, proposals and design docs: "1 conflict with past decisions", so authors find out while they are still writing.
- **Rovo agent "Precedent"** with seven actions. It checks a work item, a Confluence page or an idea described in chat; searches decisions; explains one in full; lists recent decisions; and records new decisions as a Jira comment or a native Confluence decision item. It cites every answer and offers paths forward: change the work, talk to the owner, or record a superseding decision.
- **MCP server** (rovo:mcp) with six tools, so coding agents such as Claude Code or Cursor can ask "does this change contradict a team decision?" before writing code.
- **Decision register** in Jira. It lists every decision with what it chose and ruled out, owner, date and source. A **Work at risk** tab lists every open work item that contradicts a decision, which is a lead's view of the whole team.

Precedent reads decisions where teams already write them: Decision-template and DACI pages, native decision items, and Jira "Decision:" comments. When a page says "Supersedes ADR-003", the old decision is marked superseded and stops raising flags.

## How we built it

Precedent is a Forge app on Node 24 with UI Kit, Forge KVS, an async event queue, a scheduled trigger, Rovo agent and action modules, and the rovo:mcp module.

- **Extraction** walks Atlassian Document Format. It recognises Decision-template and DACI pages (details table, options table, outcome, status lozenges), native decision items and "Decision:" comments. Owners come from driver and approver mentions, with names resolved through Jira's bulk user API.
- **A deterministic polarity parser** turns statements into structure. "Use passkeys with a TOTP fallback instead of SMS one-time passcodes for 2FA" becomes chosen: passkeys; ruled out: SMS one-time passcodes; scope: 2FA. It handles instead of, rather than, replace, migrate, over, do not, never, no and ban, and it keeps the prohibited action ("never *log* PII") so that a page that merely mentions phone numbers does not conflict with a logging rule.
- **Matching** combines BM25 relevance with explicit rules: conflict, aligned (including *removing* a ruled-out option), and related. Concept synonyms map "text codes" to SMS OTP, "GPT-4o" to third-party LLM providers, and "phone number" to PII. Every flag carries its evidence, so the UI and Rovo can explain it.
- **No LLM inside the app.** Checks are instant, free and reproducible. Rovo supplies the conversation and reasoning on top of structured, cited findings.
- **Freshness.** A full index runs on a queue (562 pages in about 18 s). Every read runs an incremental sync (CQL lastmodified plus JQL), and an hourly trigger catches stragglers. When the extraction engine changes, every installation re-indexes itself once.
- **Permissions** are enforced on every result. In the UI and in Rovo, visibility is checked in bulk as the user. External MCP calls arrive without a user token, so Precedent asks Confluence (content permission check) and Jira (browse-permission search) whether the caller's account can see each source.
- **Testing.** 22 unit tests cover the parser and matcher, plus an end-to-end MCP client (OAuth 2.1 with dynamic client registration and PKCE) used to check every demo scenario.

## Challenges we ran into

- **False positives destroy trust.** Early versions flagged a QBR page that mentioned "SMS" and a template page full of placeholder options. Each fix became a rule with a test: strict two-anchor matching for ruled-out terms, scope clauses, removal context ("remove SMS codes" is *aligned*), action-scoped prohibitions, and a stronger bar for topic overlap on long documents.
- **MCP runs differently.** MCP tool calls run in the Confluence installation with no user token, so every `asUser()` call failed. We rebuilt visibility around the caller's account id, so MCP results stay permission-filtered.
- **Speed.** The register first took 15 to 20 seconds. Bulk visibility checks (one request per product) and background refresh through the queue brought it to about 3.

## Accomplishments that we're proud of

- On a demo site with hundreds of seeded pages and issues, Work at risk finds all 7 planted contradictions with no false positives.
- One engine behind five surfaces (Jira, Confluence, Rovo, MCP, register), each permission-filtered for the person asking.
- It runs entirely on Forge and is eligible for Runs on Atlassian: no external services, no egress, no page bodies stored.

## What we learned

Deterministic structure plus an LLM front end beats an LLM alone for this job. Teams need to trust a "conflict" flag, and a flag that shows its evidence ("mentions 'SMS one-time passcodes', which ADR-007 ruled out for 2FA on 12 March") is one people act on.

## What's next

- Decisions from more places: Loom transcripts, Slack threads via connectors, Bitbucket ADR files.
- "Decision drift" alerts: notify a decision's owner when work contradicting it moves to In Progress.
- Expiry and review dates, so old decisions get re-confirmed instead of silently going stale.

---

## Bonus: Rovo agent

The **Precedent** agent has seven actions: check-work-item, check-confluence-page, check-proposal, search-decisions, get-decision, list-recent-decisions and record-decision. "Ask Precedent" buttons in the Jira panel and the Confluence byline open it with the context filled in. The prompt grounds every answer in action results, has it cite decisions by key with links, dates and owners, and makes it treat matches as signals that it can call false alarms. It only records a decision when the user asks, and the user confirms the write.

## Bonus: Atlassian MCP app

The rovo:mcp module exposes six read tools. A coding agent can check a plan ("add an SMS fallback for 2FA"), a Jira key or a design-doc link before it writes code, and gets back the decision, its rationale, owner and link. We tested it end to end with our own OAuth 2.1 client (dynamic registration and PKCE). Permission filtering holds without a user token: for each result, Precedent asks Confluence and Jira whether the caller's account can see the source.

## Bonus: Teamwork Graph

When work conflicts with a decision, Precedent asks Teamwork Graph which teams the decision's owner belongs to, so the advice is concrete: "Talk to Ryan Lee (Platform Support, Product Team) before reversing this." The Rovo agent receives the same team context, so it can recommend who to talk to.

How it's built:
- **Persisted Cypher query.** New apps can't send raw Cypher at request time, so Precedent registers the traversal for the app: `MATCH (user:AtlassianUser {ari: $id})-[:atlassian_user_is_in_atlassian_team]->(team:AtlassianTeam) RETURN collect(distinct team) as teams`. It then calls it through `customQuery`, with the curated `atlassianUserInTeams` field as a fallback.
- **Permission-filtered.** Calls run as the viewing user (`asUser().requestTeamworkGraph`), so results are filtered for that person.
- **Graceful degradation.** If the graph isn't reachable, for example over external MCP with no user token, the card still names the owner.
