// Jira work-item side panel: which past decisions this work follows, touches or contradicts.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ForgeReconciler, { Stack, Inline, Text, Button, Spinner, SectionMessage } from '@forge/react';
import { invoke, rovo, events } from '@forge/bridge';
import { Finding, timeAgo } from './finding.jsx';

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
