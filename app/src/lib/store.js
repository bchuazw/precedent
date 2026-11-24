// Decision index in Forge KVS. Each decision is one key ("dec#<id>"); per-source membership lets a
// re-parsed page replace exactly its own decisions. The index is a cache: Confluence and Jira stay the
// source of truth and a full sync can always rebuild it.
import { kvs, WhereConditions } from '@forge/kvs';

const DEC = 'dec#';
const SRC = 'src#';
const META = 'meta#sync';

const safe = (id) => String(id).replace(/[^A-Za-z0-9:._#-]/g, '_');

/** All decisions (pages through KVS 100 at a time). */
export async function allDecisions() {
  const out = [];
  let cursor;
  for (let i = 0; i < 100; i++) {
    let q = kvs.query().where('key', WhereConditions.beginsWith(DEC)).limit(100);
    if (cursor) q = q.cursor(cursor);
    const res = await q.getMany();
    for (const r of res.results ?? []) out.push(r.value);
    cursor = res.nextCursor;
    if (!cursor) break;
  }
  return out;
}

export async function getDecision(id) {
  return kvs.get(DEC + safe(id));
}

/** Replaces the decisions that came from one source (a page or an issue's comments). */
export async function replaceSource(sourceKey, decisions) {
  const prev = (await kvs.get(SRC + safe(sourceKey))) ?? [];
  const nextIds = decisions.map((d) => d.id);
  for (const id of prev) if (!nextIds.includes(id)) await kvs.delete(DEC + safe(id));
  for (const d of decisions) await kvs.set(DEC + safe(d.id), d);
  if (nextIds.length) await kvs.set(SRC + safe(sourceKey), nextIds);
  else if (prev.length) await kvs.delete(SRC + safe(sourceKey));
  return { added: nextIds.filter((id) => !prev.includes(id)).length, removed: prev.filter((id) => !nextIds.includes(id)).length };
}

/** Writes several decisions (used after supersession is recomputed across the whole set). */
export async function putDecisions(decisions) {
  for (const d of decisions) await kvs.set(DEC + safe(d.id), d);
}

/** Every source key that currently contributes decisions ("page:123", "issue:MOBL-1"). */
export async function listSources() {
  const out = [];
  let cursor;
  for (let i = 0; i < 100; i++) {
    let q = kvs.query().where('key', WhereConditions.beginsWith(SRC)).limit(100);
    if (cursor) q = q.cursor(cursor);
    const res = await q.getMany();
    for (const r of res.results ?? []) out.push(r.key.slice(SRC.length));
    cursor = res.nextCursor;
    if (!cursor) break;
  }
  return out;
}

export async function getMeta() {
  return (await kvs.get(META)) ?? { lastSyncAt: null, lastFullSyncAt: null, pagesScanned: 0, decisions: 0, running: false };
}

export async function setMeta(patch) {
  const cur = await getMeta();
  const next = { ...cur, ...patch };
  await kvs.set(META, next);
  return next;
}
