// Teamwork Graph: who owns a decision's area. Used to tell people who to talk to before reversing a decision.
// Calls run as the viewing user (Teamwork Graph results are permission-filtered for them). Any failure
// (feature off, scope not granted, no user context) degrades to "no team info".
import api from '@forge/api';
import { isNoUserToken } from './viewer.js';

// Teamwork Graph requires named operations shaped "<company>_<operation>".
const TEAMS_OP = 'precedent_teamsForUser';
const TEAMS = `query ${TEAMS_OP}($userId: ID!) {
  atlassianUserInTeams(userId: $userId, first: 5) {
    edges { node { __typename ... on AtlassianTeam { id displayName profileUrl } } }
  }
}`;

const cache = new Map();

/** Teams an Atlassian account belongs to: [{id, name, url}]. */
export async function teamsForUser(accountId) {
  if (!accountId) return [];
  if (cache.has(accountId)) return cache.get(accountId);
  const p = (async () => {
    try {
      // Teamwork Graph is user-scoped (there is no app-level variant), so external MCP calls get no team info.
      let json;
      try {
        json = await (await api.asUser().requestTeamworkGraph(TEAMS, { userId: `ari:cloud:identity::user/${accountId}` }, TEAMS_OP)).json();
      } catch (e) {
        if (isNoUserToken(e)) return [];
        throw e;
      }
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
