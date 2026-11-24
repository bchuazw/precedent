// Jira access for Precedent: reading work items, harvesting "Decision:" comments, writing comments.
import api, { route, assumeTrustedRoute } from '@forge/api';
import { textOf, adfDoc, adfParagraph } from '../engine/adf.js';
import { viewerAccountId, isNoUserToken } from './viewer.js';

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

/**
 * Reads an issue as the user. Without a user token (external MCP calls), reads it as the app, but only
 * after Jira confirms the caller's account can browse it.
 */
async function readAsViewer(path, key) {
  try {
    return await call(true, path);
  } catch (e) {
    if (!isNoUserToken(e)) throw e; // a real answer for the user (404/403): respect it
    const accountId = viewerAccountId();
    if (!accountId || !(await appCheckCanBrowse(key, accountId))) {
      const err = new Error(`Jira 404: work item ${key} not found or not visible to you`);
      err.status = 404;
      throw err;
    }
    return call(false, path);
  }
}

/** Asks Jira whether an account can view an issue (users-with-browse-permission search, exact account id). */
async function appCheckCanBrowse(key, accountId) {
  try {
    const users = await call(false, route`/rest/api/3/user/viewissue/search?issueKey=${key}&accountId=${accountId}&maxResults=1`);
    return Array.isArray(users) && users.some((u) => u.accountId === accountId);
  } catch {
    return false;
  }
}

/** A work item as plain text fields for matching. */
export async function getWorkItem(key, { asUser = true } = {}) {
  const path = route`/rest/api/3/issue/${key}?fields=summary,description,labels,components,issuetype,status,project`;
  const data = asUser ? await readAsViewer(path, key) : await call(false, path);
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

/** Display names for account ids (Confluence stores mentions without names). */
export async function displayNames(accountIds) {
  const ids = [...new Set(accountIds.filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const query = chunk.map((id) => `accountId=${encodeURIComponent(id)}`).join('&');
    const data = await call(false, assumeTrustedRoute(`/rest/api/3/user/bulk?maxResults=50&${query}`)).catch(() => ({ values: [] }));
    for (const u of data.values ?? []) if (u.accountId && u.displayName) out.set(u.accountId, u.displayName);
  }
  return out;
}

/** Comments of an issue (ADF bodies). */
export async function comments(key) {
  const data = await call(false, route`/rest/api/3/issue/${key}/comment?maxResults=100&orderBy=created`);
  return (data.comments ?? []).map((c) => ({ id: c.id, authorId: c.author?.accountId ?? null, authorName: c.author?.displayName ?? '', created: c.created, updated: c.updated, adf: c.body }));
}

/** True when the current user can see the issue (as the user, or by account id for external MCP calls). */
export async function userCanViewIssue(key) {
  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/issue/${key}?fields=summary`, { headers: { Accept: 'application/json' } });
    return res.ok;
  } catch (e) {
    const accountId = viewerAccountId();
    return accountId && isNoUserToken(e) ? appCheckCanBrowse(key, accountId) : false;
  }
}

/** Adds a comment as the user. */
export async function addComment(key, text) {
  return call(true, route`/rest/api/3/issue/${key}/comment`, { method: 'POST', body: JSON.stringify({ body: adfDoc([adfParagraph(text)]) }) });
}
