// Confluence access for Precedent: crawling pages (with ADF bodies), incremental changes via CQL,
// permission checks as the viewing user, and writing new decisions back as native decision items.
import api, { route, assumeTrustedRoute } from '@forge/api';
import { parseAdf } from '../engine/adf.js';
import { viewerAccountId, isNoUserToken } from './viewer.js';

const client = (asUser) => (asUser ? api.asUser() : api.asApp());

async function getJson(asUser, path) {
  const res = await client(asUser).requestConfluence(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Confluence ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const spaceCache = new Map();

/** Space key and name for a set of space ids (cached for the life of the invocation). */
async function spaces(ids) {
  const missing = [...new Set(ids.filter((id) => id && !spaceCache.has(String(id))))];
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    const data = await getJson(false, route`/wiki/api/v2/spaces?limit=50&ids=${chunk.join(',')}`);
    for (const s of data.results ?? []) spaceCache.set(String(s.id), { key: s.key, name: s.name });
  }
  return spaceCache;
}

function toPage(p, base) {
  return {
    id: String(p.id),
    title: p.title,
    spaceId: String(p.spaceId),
    authorId: p.version?.authorId ?? p.authorId ?? null,
    createdAt: p.createdAt ? String(p.createdAt).slice(0, 10) : null,
    updatedAt: p.version?.createdAt ?? p.createdAt ?? null,
    url: p._links?.webui ? `${base ?? ''}${p._links.webui}` : null,
    adf: parseAdf(p.body?.atlas_doc_format?.value),
  };
}

async function decorate(pages) {
  const cache = await spaces(pages.map((p) => p.spaceId));
  for (const p of pages) {
    const s = cache.get(p.spaceId);
    p.spaceKey = s?.key ?? null;
    p.spaceName = s?.name ?? null;
  }
  return pages;
}

/**
 * Pages one batch of current pages with ADF bodies. Returns {pages, next} where next is the cursor path.
 * Call repeatedly with the returned cursor until next is null.
 */
export async function listPages(cursorPath) {
  // The cursor is a path returned by Confluence itself, so it is trusted as-is.
  const path = cursorPath ? assumeTrustedRoute(cursorPath) : route`/wiki/api/v2/pages?limit=100&status=current&body-format=atlas_doc_format`;
  const data = await getJson(false, path);
  const base = data._links?.base ?? null;
  const pages = await decorate((data.results ?? []).map((p) => toPage(p, base)));
  const next = data._links?.next ? (data._links.next.startsWith('/wiki') ? data._links.next : `/wiki${data._links.next}`) : null;
  return { pages, next };
}

/** One page with its ADF body. */
export async function getPage(id, { asUser = false } = {}) {
  const data = await getJson(asUser, route`/wiki/api/v2/pages/${id}?body-format=atlas_doc_format`);
  // Single-page responses carry only a relative webui link; prefix the site's wiki base so links work anywhere.
  const base = data._links?.base ?? (await siteBase().catch(() => null));
  const [page] = await decorate([toPage(data, base)]);
  return page;
}

/** Ids of pages modified in the last `minutes` minutes (CQL). */
export async function changedPageIds(minutes) {
  const cql = `type=page AND lastmodified >= now("-${Math.max(1, Math.ceil(minutes))}m") ORDER BY lastmodified DESC`;
  const ids = [];
  let start = 0;
  for (let i = 0; i < 10; i++) {
    const data = await getJson(false, route`/wiki/rest/api/search?limit=50&start=${start}&cql=${cql}`);
    for (const r of data.results ?? []) if (r.content?.id) ids.push(String(r.content.id));
    if (!data.results?.length || data.results.length < 50) break;
    start += 50;
  }
  return ids;
}

let wikiBase = null;

/** Site base URL, e.g. https://example.atlassian.net/wiki (from a lightweight call, cached). */
export async function siteBase() {
  if (wikiBase) return wikiBase;
  const data = await getJson(false, route`/wiki/api/v2/spaces?limit=1`);
  wikiBase = data._links?.base ?? null;
  return wikiBase;
}

/**
 * True when the current user can view the page (used to filter what Precedent shows).
 * Asks as the user when there is a user token; otherwise (external MCP calls) asks Confluence whether
 * the caller's account can read the page.
 */
export async function userCanView(pageId) {
  try {
    const res = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}?body-format=storage`, { headers: { Accept: 'application/json' } });
    return res.ok;
  } catch (e) {
    const accountId = viewerAccountId();
    return accountId && isNoUserToken(e) ? appCheckCanRead(pageId, accountId) : false;
  }
}

async function appCheckCanRead(pageId, accountId) {
  try {
    const res = await api.asApp().requestConfluence(route`/wiki/rest/api/content/${pageId}/permission/check`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: { type: 'user', identifier: accountId }, operation: 'read' }),
    });
    if (!res.ok) return false;
    return (await res.json())?.hasPermission === true;
  } catch {
    return false;
  }
}

/** Space id for a space key. */
export async function spaceIdForKey(key) {
  const data = await getJson(true, route`/wiki/api/v2/spaces?keys=${key}&limit=1`);
  return data.results?.[0]?.id ?? null;
}

/** Finds a page by exact title in a space (as the user). */
export async function findPageByTitle(spaceId, title) {
  const data = await getJson(true, route`/wiki/api/v2/spaces/${spaceId}/pages?title=${title}&limit=1&body-format=atlas_doc_format`);
  const p = data.results?.[0];
  return p ? toPage(p, data._links?.base ?? null) : null;
}

/** Creates a page as the user. */
export async function createPage({ spaceId, title, adf }) {
  const res = await api.asUser().requestConfluence(route`/wiki/api/v2/pages`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ spaceId, status: 'current', title, body: { representation: 'atlas_doc_format', value: JSON.stringify(adf) } }),
  });
  if (!res.ok) throw new Error(`Could not create page: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return toPage({ ...data, body: { atlas_doc_format: { value: JSON.stringify(adf) } } }, data._links?.base ?? null);
}

/** Replaces a page's body as the user (version must be the current version + 1). */
export async function updatePage({ id, title, adf, version }) {
  const res = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${id}`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, status: 'current', title, version: { number: version, message: 'Decision recorded by Precedent' }, body: { representation: 'atlas_doc_format', value: JSON.stringify(adf) } }),
  });
  if (!res.ok) throw new Error(`Could not update page: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Current version number of a page. */
export async function pageVersion(id) {
  const data = await getJson(true, route`/wiki/api/v2/pages/${id}`);
  return data.version?.number ?? 1;
}
