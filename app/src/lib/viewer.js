// Who Precedent is answering for, per invocation.
// UI and Rovo calls carry a user token, so permission checks run as that user (asUser).
// External MCP calls carry only the caller's account id (context.principal), so the same checks are made
// by the app on that user's behalf with Atlassian's permission-check APIs. Either way, nobody sees a
// decision whose source page or work item they could not open themselves.
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();

/** Runs fn with the given caller account id available to permission checks. */
export const runAs = (accountId, fn) => store.run({ accountId: accountId ?? null }, fn);

/** Account id of the caller, when known. */
export const viewerAccountId = () => store.getStore()?.accountId ?? null;

/** True for Forge's "no user token for this call" error (asUser() outside a user session, e.g. external MCP). */
export const isNoUserToken = (e) => e?.serviceKey === 'atlassian-token-service-key' || /NEEDS_AUTHENTICATION/.test(`${e?.name ?? ''} ${e?.code ?? ''}`);
