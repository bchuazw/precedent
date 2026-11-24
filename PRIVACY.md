# Precedent privacy policy

_Last updated: 24 November 2026_

Precedent is an Atlassian Forge app. It runs entirely on Atlassian's Forge platform and sends no data outside your Atlassian site.

## What Precedent reads

- Confluence pages, to find recorded decisions: Decision-template and DACI pages, and native decision items.
- Jira work items and their comments, to find "Decision:" comments and to check work against decisions.
- Team membership from Atlassian Teamwork Graph, to show which teams a decision's owner belongs to.

Reading happens as the app, to keep the index current, or as the signed-in user, to decide what that user may see.

## What Precedent stores

Precedent stores a decision index in Forge storage, which is hosted by Atlassian in your site's data residency region. Each record holds:

- the decision's statement, the options it chose and ruled out, its scope and rationale;
- its status, date, and the link and title of the page or work item it came from;
- the Atlassian account ids of its owners, without names or any other profile data.

Precedent does not store page bodies, comments other than decision statements, display names, email addresses or any other personal data. Names shown in the app are looked up from Atlassian when they are displayed.

## Who can see what

Every result is filtered to decisions whose source page or work item the person asking can already open in Confluence or Jira.

## What Precedent writes

Precedent writes to your site only when a user asks it to record a decision. It then adds a "Decision:" comment to a Jira work item, a decision item to a Confluence page, or an entry on a space's "Decision register" page, all as that user.

## Sharing and third parties

None. Precedent has no external servers, no analytics of its own and no third-party services. Atlassian's own platform logging and analytics apply as described in Atlassian's privacy policy.

## Deleting data

Uninstalling Precedent deletes its Forge storage. Decisions you record with Precedent are ordinary Jira comments and Confluence content and stay on your site.

## Contact

Open an issue in this repository.
