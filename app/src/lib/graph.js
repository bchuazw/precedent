// Teamwork Graph: who owns a decision's area. Used to tell people who to talk to before reversing a decision.
// Calls run as the viewing user (Teamwork Graph results are permission-filtered for them). Any failure
// (feature off, scope not granted, no user context) degrades to "no team info".
import api from '@forge/api';
import { isNoUserToken } from './viewer.js';

// Teamwork Graph requires named operations shaped "<company>_<operation>".
// Preferred: a persisted Cypher query registered for this app (new apps may not run raw Cypher, and the
// curated field below is refused for newer installations with "User is not permitted to query this organization").
//   MATCH (user:AtlassianUser {ari: $id})-[:atlassian_user_is_in_atlassian_team]->(team:AtlassianTeam)
//   RETURN collect(distinct team) as teams
export const TEAMS_QUERY_KEY = '56292d1a-cb38-4861-80f0-4a279165de9c';
const PERSISTED_OP = 'precedent_userTeams';
const PERSISTED = `query ${PERSISTED_OP}($queryKey: String!, $queryParams: CypherRequestParams) {
  customQuery(queryKey: $queryKey, queryParams: $queryParams, first: 25) {
    edges { node { columns { key value { __typename
      ... on CypherQueryResultListNode { nodes { id data { __typename ... on AtlassianTeam { id displayName } } } }
    } } } }
  }
}`;
const TEAMS_OP = 'precedent_teamsForUser';
const TEAMS = `query ${TEAMS_OP}($userId: ID!) {
  atlassianUserInTeams(userId: $userId, first: 5) {
    edges { node { __typename ... on AtlassianTeam { id displayName profileUrl } } }
  }
}`;

/** Teams from a customQuery response: columns keyed "teams" holding a list of AtlassianTeam nodes. */
export function teamsFromCustomQuery(json) {
  const out = [];
  for (const edge of json?.data?.customQuery?.edges ?? []) {
    for (const col of edge?.node?.columns ?? []) {
      if (col?.key !== 'teams') continue;
      const nodes = col.value?.nodes ?? (col.value?.data ? [col.value] : []);
      for (const n of nodes) if (n?.data?.displayName) out.push({ id: n.data.id, name: n.data.displayName, url: null });
    }
  }
  return out;
}

const cache = new Map();

/** Teams an Atlassian account belongs to: [{id, name, url}]. */
export async function teamsForUser(accountId) {
  if (!accountId) return [];
  if (cache.has(accountId)) return cache.get(accountId);
  const p = (async () => {
    try {
      // Teamwork Graph is user-scoped (there is no app-level variant), so external MCP calls get no team info.
      const ari = `ari:cloud:identity::user/${accountId}`;
      let persisted;
      try {
        persisted = await (await api.asUser().requestTeamworkGraph(PERSISTED, { queryKey: TEAMS_QUERY_KEY, queryParams: { id: ari } }, PERSISTED_OP)).json();
      } catch (e) {
        if (isNoUserToken(e)) return [];
        throw e;
      }
      const viaPersisted = teamsFromCustomQuery(persisted);
      if (viaPersisted.length || (persisted?.data?.customQuery && !persisted?.errors?.length)) return viaPersisted;
      if (persisted?.errors?.length) console.warn('teamwork graph (persisted)', JSON.stringify(persisted.errors).slice(0, 300));
      const json = await (await api.asUser().requestTeamworkGraph(TEAMS, { userId: ari }, TEAMS_OP)).json();
      if (json?.errors?.length) console.warn('teamwork graph', JSON.stringify(json.errors).slice(0, 300));
      const edges = json?.data?.atlassianUserInTeams?.edges ?? [];
      const teams = edges
        .map((e) => e?.node)
        .filter((n) => n?.displayName)
        .map((n) => ({ id: n.id, name: n.displayName, url: n.profileUrl ?? null }));
      return teams;
    } catch (e) {
      console.warn('teamsForUser failed', String(e?.message ?? e).slice(0, 200));
      return [];
    }
  })();
  cache.set(accountId, p);
  return p;
}

/** Adds `teams` to each owner (first two owners only, to stay fast). */
export async function withTeams(owners) {
  const list = owners ?? [];
  return Promise.all(list.map(async (o, i) => (i < 2 && o.accountId ? { ...o, teams: await teamsForUser(o.accountId) } : o)));
}
