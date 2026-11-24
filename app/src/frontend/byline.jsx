// Confluence page byline: does this RFC / proposal / design doc contradict a decision the team already made?
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ForgeReconciler, { Stack, Inline, Text, Button, Spinner, SectionMessage } from '@forge/react';
import { invoke, rovo } from '@forge/bridge';
import { Finding, timeAgo } from './finding.jsx';

const App = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [rovoOn, setRovoOn] = useState(true);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await invoke('checkPage');
      if (res?.error) return setError(res.error);
      setError(null);
      setData(res);
      if (res.indexState === 'indexing') {
        clearTimeout(timer.current);
        timer.current = setTimeout(load, 8000);
      }
    } catch (e) {
      setError(String(e?.message ?? e));
    }
  }, []);

  useEffect(() => {
    load();
    rovo.isEnabled().then(setRovoOn).catch(() => setRovoOn(false));
    return () => clearTimeout(timer.current);
  }, [load]);

  if (error) {
    return (
      <SectionMessage appearance="warning" title="Precedent couldn't check this page">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }
  if (!data) {
    return (
      <Inline space="space.100" alignBlock="center">
        <Spinner size="small" />
        <Text>Checking this page against past decisions…</Text>
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

  const { counts, findings, page } = data;
  const askPrecedent = () =>
    rovo.open({
      type: 'forge',
      agentKey: 'precedent-agent',
      agentName: 'Precedent',
      prompt: counts.conflict
        ? `Check the Confluence page "${page.title}" against our decisions. Explain each conflict, why that decision was made, and what the author should change or who to talk to.`
        : `Check the Confluence page "${page.title}" against our team's decisions.`,
    });

  return (
    <Stack space="space.150">
      <Text weight="medium">{data.headline}</Text>
      {findings.length === 0 ? (
        <Text size="small" color="color.text.subtle">
          Nothing in your recorded decisions touches this page.
        </Text>
      ) : (
        findings.map((f) => <Finding key={f.decisionId} f={f} />)
      )}
      {rovoOn ? (
        <Inline>
          <Button appearance={counts.conflict ? 'primary' : 'default'} onClick={askPrecedent} iconBefore="decision">
            Ask Precedent
          </Button>
        </Inline>
      ) : null}
      <Text size="small" color="color.text.subtlest">
        Checked against {data.indexedDecisions} decision{data.indexedDecisions === 1 ? '' : 's'}{page.ownDecisions ? ' made elsewhere' : ''} · synced {timeAgo(data.lastSyncAt)}
      </Text>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
