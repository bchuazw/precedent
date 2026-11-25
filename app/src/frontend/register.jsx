// Jira global page: every decision Precedent found in Confluence and Jira that the viewer can open, and the
// open work items that contradict one of them.
import React, { useEffect, useMemo, useState } from 'react';
import ForgeReconciler, { Box, Stack, Inline, Text, Lozenge, Button, Link, User, Textfield, DynamicTable, Spinner, SectionMessage, Tabs, TabList, Tab, TabPanel } from '@forge/react';
import { invoke } from '@forge/bridge';
import { timeAgo } from './finding.jsx';

const STATUS = {
  decided: { label: 'Decided', appearance: 'success' },
  superseded: { label: 'Superseded', appearance: 'moved' },
  proposed: { label: 'Proposed', appearance: 'inprogress' },
};

const FILTERS = ['All', 'Decided', 'Superseded', 'Proposed'];

function matches(d, q) {
  if (!q) return true;
  const hay = [d.key, d.title, d.statement, ...(d.chosen ?? []), ...(d.rejected ?? []), d.source?.title, d.source?.space].join(' ').toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

function terms(list) {
  if (!list?.length) return <Text color="color.text.subtlest">—</Text>;
  return (
    <Stack space="space.025">
      {list.slice(0, 3).map((t) => (
        <Text key={t} size="small">
          {t}
        </Text>
      ))}
    </Stack>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDate = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '—');

const WORK_STATUS = { new: 'default', indeterminate: 'inprogress', done: 'success' };

function AtRisk({ risk }) {
  if (!risk) {
    return (
      <Inline space="space.100" alignBlock="center">
        <Spinner />
        <Text>Checking open work items…</Text>
      </Inline>
    );
  }
  if (risk.error) {
    return (
      <SectionMessage appearance="warning" title="Couldn't check open work">
        <Text>{risk.error}</Text>
      </SectionMessage>
    );
  }
  const rows = risk.items.map((r) => ({
    key: r.id,
    cells: [
      {
        key: 'work',
        content: (
          <Stack space="space.050">
            <Link href={r.work.url} openNewTab>
              {r.work.key}
            </Link>
            <Text size="small">{r.work.summary}</Text>
          </Stack>
        ),
      },
      { key: 'status', content: <Lozenge appearance={WORK_STATUS[r.work.statusCategory] ?? 'default'}>{r.work.status ?? '—'}</Lozenge> },
      { key: 'assignee', content: r.work.assignee?.accountId ? <User accountId={r.work.assignee.accountId} /> : <Text color="color.text.subtlest">Unassigned</Text> },
      {
        key: 'decision',
        content: (
          <Stack space="space.050">
            <Text weight="bold">
              {r.decision.key} · {r.decision.title}
            </Text>
            <Text size="small" color="color.text.subtle">
              {r.reason}
            </Text>
          </Stack>
        ),
      },
      { key: 'confidence', content: <Lozenge appearance={r.confidence === 'high' ? 'removed' : 'moved'}>{r.confidence}</Lozenge> },
      {
        key: 'open',
        content: r.decision.source?.url ? (
          <Link href={r.decision.source.url} openNewTab>
            Open decision
          </Link>
        ) : (
          <Text>—</Text>
        ),
      },
    ],
  }));
  return (
    <Stack space="space.150">
      <Text size="small" color="color.text.subtlest">
        {risk.items.length ? `${risk.items.length} conflict${risk.items.length > 1 ? 's' : ''}` : 'No conflicts'} in the {risk.scanned} most recently updated open work items you can see.
      </Text>
      <DynamicTable
        head={{
          cells: [
            { key: 'work', content: 'Work item', width: 26 },
            { key: 'status', content: 'Status', width: 10 },
            { key: 'assignee', content: 'Assignee', width: 13 },
            { key: 'decision', content: 'Contradicts', width: 35 },
            { key: 'confidence', content: 'Confidence', width: 8 },
            { key: 'open', content: '', width: 8 },
          ],
        }}
        rows={rows}
        rowsPerPage={15}
        emptyView={<Text>No open work item contradicts a recorded decision.</Text>}
      />
    </Stack>
  );
}

const App = () => {
  const [risk, setRisk] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await invoke('register');
      setData(res);
      setError(null);
      if (res.indexState === 'indexing') setTimeout(load, 8000);
    } catch (e) {
      setError(String(e?.message ?? e));
    }
  };

  const loadRisk = async () => {
    try {
      setRisk(await invoke('atRisk'));
    } catch (e) {
      setRisk({ error: String(e?.message ?? e) });
    }
  };

  useEffect(() => {
    load();
    loadRisk();
  }, []);

  const sync = async (kind) => {
    setBusy(true);
    try {
      await invoke(kind);
      await Promise.all([load(), loadRisk()]);
    } finally {
      setBusy(false);
    }
  };

  const rows = useMemo(() => {
    const list = (data?.decisions ?? []).filter((d) => (filter === 'All' || d.status === filter.toLowerCase()) && matches(d, query));
    return list.map((d) => {
      const owner = d.owners?.find((o) => ['driver', 'approver', 'author'].includes(o.role)) ?? d.owners?.[0];
      const st = STATUS[d.status] ?? STATUS.decided;
      return {
        key: d.id,
        cells: [
          {
            key: 'decision',
            content: (
              <Stack space="space.050">
                <Text weight="bold">
                  {d.key} · {d.title}
                </Text>
                {d.statement && d.statement !== d.title ? (
                  <Text size="small" color="color.text.subtle" maxLines={2}>
                    {d.statement}
                  </Text>
                ) : null}
                {d.supersededBy ? (
                  <Text size="small" color="color.text.subtlest">
                    Superseded by {d.supersededBy.key}
                  </Text>
                ) : null}
              </Stack>
            ),
          },
          { key: 'chose', content: terms(d.chosen) },
          { key: 'ruled', content: terms(d.rejected) },
          { key: 'status', content: <Lozenge appearance={st.appearance}>{st.label}</Lozenge> },
          { key: 'date', content: <Text>{niceDate(d.decidedAt)}</Text> },
          { key: 'owner', content: owner?.accountId ? <User accountId={owner.accountId} /> : <Text color="color.text.subtlest">—</Text> },
          {
            key: 'source',
            content: d.source?.url ? (
              <Link href={d.source.url} openNewTab>
                {d.source.kind === 'jira-comment' ? d.source.issueKey : d.source.space ?? 'Confluence'}
              </Link>
            ) : (
              <Text>—</Text>
            ),
          },
        ],
      };
    });
  }, [data, query, filter]);

  if (error) {
    return (
      <SectionMessage appearance="error" title="Couldn't load the decision register">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }

  return (
    <Box paddingBlock="space.200">
      <Stack space="space.200">
        <Inline spread="space-between" alignBlock="center">
          <Stack space="space.050">
            <Text color="color.text.subtle">
              Every decision Precedent found in Confluence decision pages, decision items and Jira "Decision:" comments that you can open.
            </Text>
          </Stack>
          <Inline space="space.100">
            <Button onClick={() => sync('syncNow')} isDisabled={busy} iconBefore="refresh">
              {busy ? 'Syncing…' : 'Sync now'}
            </Button>
            <Button appearance="subtle" onClick={() => sync('reindex')} isDisabled={busy}>
              Re-index everything
            </Button>
          </Inline>
        </Inline>
        <Tabs id="precedent-register-tabs">
          <TabList>
            <Tab>Decisions</Tab>
            <Tab>{risk?.items?.length ? `Work at risk (${risk.items.length})` : 'Work at risk'}</Tab>
          </TabList>
          <TabPanel>
            <Box paddingBlock="space.200">
        {!data ? (
          <Inline space="space.100" alignBlock="center">
            <Spinner />
            <Text>Loading decisions…</Text>
          </Inline>
        ) : (
          <Stack space="space.200">
            {data.indexState === 'indexing' ? (
              <SectionMessage appearance="information" title="Indexing your decisions">
                <Text>Precedent is reading Confluence and Jira for the first time. This page refreshes on its own.</Text>
              </SectionMessage>
            ) : null}
            <Inline space="space.150" alignBlock="center" shouldWrap>
              <Box xcss={{ width: '360px' }}>
                <Textfield placeholder="Search decisions, e.g. 2FA, MongoDB, LLM" value={query} onChange={(e) => setQuery(e.target.value)} />
              </Box>
              <Inline space="space.050">
                {FILTERS.map((f) => (
                  <Button key={f} appearance={filter === f ? 'primary' : 'subtle'} onClick={() => setFilter(f)}>
                    {f}
                  </Button>
                ))}
              </Inline>
              <Text size="small" color="color.text.subtlest">
                {rows.length} of {data.decisions.length} decisions · synced {timeAgo(data.lastSyncAt)}
              </Text>
            </Inline>
            <DynamicTable
              head={{
                cells: [
                  { key: 'decision', content: 'Decision', width: 34 },
                  { key: 'chose', content: 'Chose', width: 14 },
                  { key: 'ruled', content: 'Ruled out', width: 14 },
                  { key: 'status', content: 'Status', width: 9 },
                  { key: 'date', content: 'Decided', width: 9 },
                  { key: 'owner', content: 'Owner', width: 12 },
                  { key: 'source', content: 'Source', width: 8 },
                ],
              }}
              rows={rows}
              rowsPerPage={15}
              emptyView={
                data.decisions.length || data.indexState === 'indexing' ? (
                  <Text>No decisions match your search.</Text>
                ) : (
                  <SectionMessage appearance="information" title="No team decisions recorded yet">
                    <Stack space="space.050">
                      <Text>Precedent reads decisions where your team already writes them: Confluence pages from the Decision template, decision items in any page (type /decision), and Jira comments that start with “Decision:”.</Text>
                      <Text>Quickest way to try it: open any Jira work item, use “Record a decision” in the Precedent panel, then create a work item that goes against it.</Text>
                    </Stack>
                  </SectionMessage>
                )
              }
            />
          </Stack>
        )}
            </Box>
          </TabPanel>
          <TabPanel>
            <Box paddingBlock="space.200">
              <AtRisk risk={risk} />
            </Box>
          </TabPanel>
        </Tabs>
      </Stack>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
