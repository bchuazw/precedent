# Precedent

**Your team already decided. Precedent makes sure you remember before you ship.**

**Demo video (2:26):** https://youtu.be/1BGpiO1y-Yc

Teams make decisions in Confluence pages, meeting notes and Jira comments, then forget them. Months later a story quietly reverses an architecture call. A vendor that was ruled out comes back. A security rule gets broken by someone who was never in the room. Precedent is a Forge app that keeps a live index of your team's recorded decisions. It checks new work against them wherever the work happens:

| Where | What you see |
| --- | --- |
| **Jira work item** | A "Past decisions" panel. Its header reads "1 conflict" when the work item contradicts a decision. Each card gives the decision, why it was made, who owns it, and a link to the source. |
| **Confluence page** | A byline item on RFCs, proposals and design docs, such as "2 conflicts with past decisions", with the same cards in a popup. |
| **Rovo** | The **Precedent** agent answers "does this contradict anything we decided?", "why do we use X?" and "what did we decide recently?" with citations. It can also record a new decision for you. |
| **Coding agents (MCP)** | Claude Code, Cursor or any MCP client can call Precedent's tools before writing code: "does adding an SMS fallback contradict a team decision?" |
| **Decision register** | A Jira app page that lists every decision with what it chose, what it ruled out, owner, date and source. It can be searched and filtered. |
| **Work at risk** | A tab on the register that scans the 100 most recently updated open work items and lists every one that contradicts a decision: a lead's view of the whole team. |

Precedent reads decisions where teams already write them. Nothing new needs to be adopted:

- Confluence pages made from the **Decision** template (DACI and ADR-style pages included): options, outcome, driver, approver, status.
- Native Confluence **decision items** in any page, such as meeting notes.
- Jira comments that start with **"Decision:"**.
- "Supersedes ADR-003" links, so reversed decisions are marked superseded and stop raising flags.

## Try it in five minutes (judges)

1. **Install** Precedent on a site that has Jira and Confluence: **[installation link](https://developer.atlassian.com/console/install/d93cb16f-78d7-4259-aadd-e989600915f0?signature=AYABeMxTjQ3GEJ5p4EMDgxdR%2Bl8AAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBiJlZrdjGnCl4SvJ5W7TAkgAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDMh684SwsOV5m3y%2B%2BwIBEIA7ez1Fibu3em3%2B78bzzgQCu%2FxDfMfSha38E%2Bv1Z%2BO0r6dlDyGZyOGsZE8PDQy0KISwRVIocd8sLtnjBLsAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgG8WR9Eba5Na6ff9%2BKcJriHAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMlSsciLMeYui60qkQAgEQgDuyncbwzr9YAgGPffvF5qr2WnenvE7kXIJlevoN1LeSZP%2B5HYkXsLoQyvGX7vKoK1%2FP1NzsJ78o%2Bypk%2BgAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAQg2KiGMjFB1Z6rkaPajz70AAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAygdxBys0229wOEbtsCARCAO7JtQCEunldiAcikRsABKF932ShBj%2Bu2gxJ97DaJ%2BJ8yOODRZ6y1TL%2Bd1bB9dnLpwiwDDsjJiRrUxluZAgAAAAAMAAAQAAAAAAAAAAAAAAAAALWraiBy5hq01d9ZAv%2BqM9T%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADLe3hBpWfHutvSADCIzZIs6HbMC0qDELkXWGOg9X5lrKuJ5xZCtDyjXv3H3CiQvxb5%2BP%2BasTZsI4eYisZ2W4k2e%2BDI%3D&product=jira&product=confluence)**. The link installs it into both Jira and Confluence: Precedent reads decisions from Confluence and checks work in Jira. If one of the two shows "Installation failed", click **Install** again; a retry installs the missing one.
2. **Add a decision.** Create a Confluence page with a decision item: type `/decision`, then write
   `Use passkeys with a TOTP fallback instead of SMS one-time passcodes for 2FA, because SIM-swap attacks make SMS codes unsafe.`
3. **Create a Jira work item** "Add an SMS one-time passcode fallback for 2FA" and open it. The **Precedent** panel reports **1 conflict** and names the decision, why it was made, and who owns it.
4. Click **Ask Precedent** (Rovo) to talk it through. You can also ask Rovo chat: _"What did we decide about two-factor authentication?"_
5. Open **Apps > Decision register** in Jira to see the whole index. The **Work at risk** tab lists open work items that contradict a decision.

The first check on a new site indexes existing decision pages, which takes about a minute for a few hundred pages. After that, Precedent keeps up with edits as they happen.

### MCP (coding agents)

A site admin enables external access once: **admin.atlassian.com > (site) > Connected apps > Precedent > Details > Tools > Enable tools**. If Precedent is installed in both Jira and Confluence, do this for both rows. Then add the server to your MCP client:

```
claude mcp add --transport http precedent https://mcp.atlassian.com/forge/d93cb16f-78d7-4259-aadd-e989600915f0
```

Tools: `check-proposal`, `check-work-item`, `check-confluence-page`, `search-decisions`, `get-decision`, `list-recent-decisions`.

## How it works

```
Confluence pages ──┐                                   ┌── Jira panel + header lozenge
Decision items ────┤   extract ─► parse ─► index ─►    ├── Confluence byline
Jira "Decision:" ──┘   (ADF)    (polarity) (KVS)    check   ├── Rovo agent (7 actions)
                                                       ├── MCP tools (6)
                                                       └── Decision register
```

- **Extraction.** Precedent reads pages as Atlassian Document Format. It finds decision-template and DACI pages (details table, options table, outcome) and native decision items. In Jira it reads comments that start with "Decision:". Owners come from the driver and approver mentions, with names resolved through Jira's user API.
- **Polarity parsing.** A deterministic parser reads each statement for what was chosen, what was ruled out, and the scope. It understands "X instead of Y for Z", "do not use Y", "never log Y", "replace Y with X", "migrate from Y to X" and "no Y". Synonyms are normalised: "text codes" counts as SMS one-time passcodes, "GPT-4o" as a third-party LLM, "phone number" as PII.
- **Checking.** Each piece of work is scored against every decision with BM25 relevance plus explicit rules. Naming a ruled-out option within the decision's scope is a **conflict**. Removing one ("remove SMS codes") is **aligned**. Using the chosen option is **aligned**. Topic overlap is **related**. A prohibition tied to an action, such as "never *log* PII", only fires when the work does that action. Every flag carries the evidence it used, so it can be explained.
- **No LLM in the app.** Matching is deterministic, fast and free. Reasoning and conversation happen in Rovo, which receives structured, cited findings from Precedent's actions.
- **Freshness.** A full index runs on an async queue. Every read does an incremental sync (CQL `lastmodified` plus Jira JQL), and an hourly scheduled trigger catches up on anything missed. When the extraction rules change, each installation re-indexes once on its own.
- **Permissions.** Everything shown to a person is filtered to decisions whose source page or work item they can already open. In the UI and in Rovo this check runs as the user. External MCP calls carry no user token, so Precedent asks Confluence and Jira whether the caller's account can view each source, using the content permission check and the browse-permission user search.
- **Teamwork Graph.** For conflicts, Precedent looks up the decision owner's teams ("Talk to Ryan Lee (Platform Support, Product Team) before reversing this"). It uses a persisted Cypher query registered for the app (user → `atlassian_user_is_in_atlassian_team` → team), runs it as the viewing user, and falls back to the curated `atlassianUserInTeams` field.

## Data and privacy

- Runs entirely on Atlassian's Forge platform: Forge functions, Forge KVS storage, no external services and no egress.
- Stores only decision records: statement, parsed terms, owners' account ids, dates and links. It does not store page bodies or any personal data: names are looked up from Atlassian when they are shown.
- Writes happen only when a user asks to record a decision. Precedent then adds a "Decision:" comment, a decision item on the current page, or an entry on a space's "Decision register" page, all as that user.
- Full policy: [PRIVACY.md](PRIVACY.md). Terms: [TERMS.md](TERMS.md).

## Repository

| Path | Contents |
| --- | --- |
| `app/manifest.yml` | Forge modules: `jira:issueContext`, `jira:globalPage`, `confluence:contentBylineItem`, `rovo:agent`, 7 `action`s, `rovo:mcp`, queue `consumer`, `scheduledTrigger` |
| `app/src/engine/` | Pure, tested logic: ADF parsing, extraction, polarity parser, matcher |
| `app/src/lib/` | Forge layer: Confluence and Jira clients, KVS store, sync, permission checks, Teamwork Graph |
| `app/src/frontend/` | UI Kit: Jira panel, Confluence byline, Decision register |
| `app/test/` | `node --test app/test/engine.test.mjs` |
| `tools/seed.mjs` | Creates the demo decisions, an RFC and work items on a test site |
| `tools/judge-smoke.mjs` | Runs the five-minute steps above on a fresh site: one decision item and one contradicting work item |
| `tools/mcp-client.mjs` | Minimal MCP client (OAuth 2.1 with dynamic registration and PKCE) used to test the MCP tools |

### Develop

```
cd app
npm install
forge deploy -e development
forge install -e development --product jira --site <your-site>.atlassian.net
forge install -e development --product confluence --site <your-site>.atlassian.net
node --test test/engine.test.mjs
```
