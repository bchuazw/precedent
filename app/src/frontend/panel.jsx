// Jira work-item side panel: which past decisions this work follows, touches or contradicts.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ForgeReconciler, { Box, Stack, Inline, Text, Lozenge, Button, Link, User, Spinner, SectionMessage, xcss } from '@forge/react';
import { invoke, rovo, events } from '@forge/bridge';

const RELATION = {
  conflict: { label: 'Conflict', appearance: 'removed' },
  aligned: { label: 'Aligned', appearance: 'success' },
  related: { label: 'Related', appearance: 'default' },
};

const cardBase = {
  padding: 'space.150',
  borderRadius: 'border.radius.200',
  borderWidth: 'border.width',
  borderStyle: 'solid',
};
const cardStyles = {
  conflict: xcss({ ...cardBase, borderColor: 'color.border.danger', backgroundColor: 'color.background.danger' }),
  aligned: xcss({ ...cardBase, borderColor: 'color.border.success', backgroundColor: 'color.background.neutral.subtle' }),
  related: xcss({ ...cardBase, borderColor: 'color.border', backgroundColor: 'color.background.neutral.subtle' }),
};

function sourceLabel(source) {
  if (source?.kind === 'jira-comment') return `Decided in ${source.issueKey}`;
  return source?.space ? `Decided in ${source.space}` : 'Decided in Confluence';
}

function timeAgo(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function Finding({ f }) {
  const d = f.decision;
  const rel = RELATION[f.relation] ?? RELATION.related;
  const owner = d.owners?.find((o) => o.role === 'driver' || o.role === 'approver' || o.role === 'author') ?? d.owners?.[0];
  return (
    <Box xcss={cardStyles[f.relation] ?? cardStyles.related}>
      <Stack space="space.075">
        <Inline spread="space-between" alignBlock="center">
          <Lozenge appearance={rel.appearance} isBold={f.relation === 'conflict'}>
            {rel.label}
          </Lozenge>
          <Text size="small" color="color.text.subtlest">
            {d.key}
            {d.decidedAt ? ` · ${d.decidedAt}` : ''}
          </Text>
        </Inline>
        <Text weight="bold">{d.title}</Text>
        {d.statement && d.statement !== d.title ? (
          <Text size="small" color="color.text.subtle" maxLines={3}>
            “{d.statement}”
          </Text>
        ) : null}
        <Text size="small">{f.reason}</Text>
        {f.relation === 'conflict' && d.rationale ? (
          <Text size="small" color="color.text.subtle">
            Why it was decided: {d.rationale}
          </Text>
        ) : null}
        {f.relation === 'conflict' && owner?.teams?.length ? (
          <Text size="small" color="color.text.subtle">
            Talk to {owner.name || 'the owner'} ({owner.teams.slice(0, 2).map((t) => t.name).join(', ')}) before reversing this.
          </Text>
        ) : null}
        <Inline spread="space-between" alignBlock="center" shouldWrap>
          {owner?.accountId ? <User accountId={owner.accountId} /> : <Text size="small" color="color.text.subtlest">{sourceLabel(d.source)}</Text>}
          {d.source?.url ? (
            <Link href={d.source.url} openNewTab>
              {d.source.kind === 'jira-comment' ? 'Open in Jira' : 'Open decision'}
            </Link>
          ) : null}
        </Inline>
      </Stack>
    </Box>
  );
}

const App = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rovoOn, setRovoOn] = useState(true);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await invoke('check');
      if (res?.error) setError(res.error);
      else {
        setError(null);
        setData(res);
        if (res.indexState === 'indexing') {
          clearTimeout(timer.current);
          timer.current = setTimeout(load, 8000);
        }
      }
    } catch (e) {
      setError(String(e?.message ?? e));
    }
  }, []);

  useEffect(() => {
    load();
    rovo.isEnabled().then(setRovoOn).catch(() => setRovoOn(false));
    const sub = events.on('JIRA_ISSUE_CHANGED', () => load());
    return () => {
      clearTimeout(timer.current);
      Promise.resolve(sub).then((s) => s?.unsubscribe?.());
    };
  }, [load]);

  const sync = async () => {
    setBusy(true);
    try {
      await invoke('syncNow');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const askPrecedent = () =>
    rovo.open({
      type: 'forge',
      agentKey: 'precedent-agent',
      agentName: 'Precedent',
      prompt: data?.counts?.conflict
        ? `Check ${data.work.key} against our decisions. Explain each conflict, why the decision was made, and what we should do.`
        : `Check ${data?.work?.key ?? 'this work item'} against our team's decisions.`,
    });

  if (error) {
    return (
      <SectionMessage appearance="warning" title="Precedent couldn't check this work item">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }
  if (!data) {
    return (
      <Inline space="space.100" alignBlock="center">
        <Spinner size="small" />
        <Text>Checking past decisions…</Text>
      </Inline>
    );
  }
  if (data.indexState === 'indexing' && !data.findings.length) {
    return (
      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center">
          <Spinner size="small" />
          <Text weight="medium">Indexing your team's decisions</Text>
        </Inline>
        <Text size="small" color="color.text.subtle">
          First run: Precedent is reading decision pages and decision items in Confluence and "Decision:" comments in Jira. This takes about a minute.
        </Text>
      </Stack>
    );
  }

  const { counts, findings } = data;
  return (
    <Stack space="space.150">
      <Text weight="medium">{data.headline}</Text>
      {findings.length === 0 ? (
        <Text size="small" color="color.text.subtle">
          Nothing in your recorded decisions touches this work item.
        </Text>
      ) : (
        findings.map((f) => <Finding key={f.decisionId} f={f} />)
      )}
      <Inline space="space.100" shouldWrap>
        {rovoOn ? (
          <Button appearance={counts.conflict ? 'primary' : 'default'} onClick={askPrecedent} iconBefore="decision">
            Ask Precedent
          </Button>
        ) : null}
        <Button appearance="subtle" onClick={sync} isDisabled={busy} iconBefore="refresh">
          {busy ? 'Syncing…' : 'Re-check'}
        </Button>
      </Inline>
      <Text size="small" color="color.text.subtlest">
        Checked against {data.indexedDecisions} decisions · synced {timeAgo(data.lastSyncAt)}
      </Text>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
