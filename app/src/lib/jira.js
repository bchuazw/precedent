// Jira access for Precedent: reading work items, harvesting "Decision:" comments, writing comments.
import api, { route } from '@forge/api';
import { textOf, adfDoc, adfParagraph } from '../engine/adf.js';

const client = (asUser) => (asUser ? api.asUser() : api.asApp());

async function call(asUser, path, init = {}) {
  const res = await client(asUser).requestJira(path, { ...init, headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) } });
  if (!res.ok) {
    const err = new Error(`Jira ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

let siteUrl = null;

/** Base URL of the Jira site (for building links). */
export async function jiraBase() {
  if (siteUrl) return siteUrl;
  const info = await call(false, route`/rest/api/3/serverInfo`);
  siteUrl = info.baseUrl;
  return siteUrl;
}

/** A work item as plain text fields for matching. */
export async function getWorkItem(key, { asUser = true } = {}) {
  const data = await call(asUser, route`/rest/api/3/issue/${key}?fields=summary,description,labels,components,issuetype,status,project`);
  const f = data.fields ?? {};
  return {
    key: data.key,
    id: data.id,
    summary: f.summary ?? '',
    description: f.description ? textOf(f.description) : '',
    labels: f.labels ?? [],
    components: (f.components ?? []).map((c) => c.name),
    type: f.issuetype?.name ?? null,
    status: f.status?.name ?? null,
    projectKey: f.project?.key ?? null,
    url: `${await jiraBase()}/browse/${data.key}`,
  };
}

/** Issues that have comments mentioning "Decision" (JQL text search), most recently updated first. */
export async function issuesWithDecisionComments({ updatedWithinMinutes } = {}) {
  const since = updatedWithinMinutes ? ` AND updated >= "-${Math.ceil(updatedWithinMinutes)}m"` : '';
  const jql = `comment ~ "Decision"${since} ORDER BY updated DESC`;
  const out = [];
  let token;
  for (let i = 0; i < 5; i++) {
    const data = await call(false, route`/rest/api/3/search/jql`, { method: 'POST', body: JSON.stringify({ jql, maxResults: 100, fields: ['summary'], ...(token ? { nextPageToken: token } : {}) }) });
    for (const issue of data.issues ?? []) out.push({ key: issue.key, summary: issue.fields?.summary ?? '' });
    token = data.nextPageToken;
    if (!token) break;
  }
  return out;
}

/** Of the given issue keys, those updated in the last `minutes` minutes. */
export async function recentlyUpdated(keys, minutes) {
  if (!keys.length) return [];
  const out = [];
  for (let i = 0; i < keys.length; i += 50) {
    const jql = `key in (${keys.slice(i, i + 50).join(',')}) AND updated >= "-${Math.ceil(minutes)}m"`;
    const data = await call(false, route`/rest/api/3/search/jql`, { method: 'POST', body: JSON.stringify({ jql, maxResults: 50, fields: ['summary'] }) }).catch(() => ({ issues: [] }));
    for (const issue of data.issues ?? []) out.push({ key: issue.key, summary: issue.fields?.summary ?? '' });
  }
  return out;
}

/** Comments of an issue (ADF bodies). */
export async function comments(key) {
  const data = await call(false, route`/rest/api/3/issue/${key}/comment?maxResults=100&orderBy=created`);
  return (data.comments ?? []).map((c) => ({ id: c.id, authorId: c.author?.accountId ?? null, authorName: c.author?.displayName ?? '', created: c.created, updated: c.updated, adf: c.body }));
}

/** True when the current user can see the issue. */
export async function userCanViewIssue(key) {
  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/issue/${key}?fields=summary`, { headers: { Accept: 'application/json' } });
    return res.ok;
  } catch {
    return false;
  }
}

/** Adds a comment as the user. */
export async function addComment(key, text) {
  return call(true, route`/rest/api/3/issue/${key}/comment`, { method: 'POST', body: JSON.stringify({ body: adfDoc([adfParagraph(text)]) }) });
}
