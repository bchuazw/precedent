// Jira work-item side panel: which past decisions this work follows, touches or contradicts.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ForgeReconciler, { Stack, Inline, Text, Button, Spinner, SectionMessage } from '@forge/react';
import { invoke, rovo, events } from '@forge/bridge';
import { Finding, timeAgo } from './finding.jsx';
import { RecordDecision } from './record.jsx';

const App = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rovoOn, setRovoOn] = useState(true);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(null);
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
  const empty = !data.indexedDecisions && data.indexState !== 'indexing';
  const conflicts = findings.filter((f) => f.relation === 'conflict').map((f) => f.decision);
  const done = async (res) => {
    setRecording(false);
    setRecorded(res);
    await load();
  };

  return (
    <Stack space="space.150">
      {recorded ? (
        <SectionMessage appearance="success" title="Decision recorded">
          <Text>
            Saved as a “Decision:” comment on {recorded.where?.issueKey ?? 'this work item'}. Precedent now checks new work against it
            {/Supersedes\s/.test(recorded.text ?? '') ? ', and the decision it reverses no longer raises conflicts.' : '.'}
          </Text>
        </SectionMessage>
      ) : null}
      {empty ? (
        <SectionMessage appearance="information" title="No team decisions recorded yet">
          <Stack space="space.050">
            <Text>Precedent reads decisions where your team already writes them:</Text>
            <Text>• Confluence pages from the Decision template, and decision items in any page (type /decision)</Text>
            <Text>• Jira comments that start with “Decision:”</Text>
            <Text>Record one below to try it: then create a work item that goes against it.</Text>
          </Stack>
        </SectionMessage>
      ) : (
        <Text weight="medium">{data.headline}</Text>
      )}
      {!empty && findings.length === 0 ? (
        <Text size="small" color="color.text.subtle">
          Nothing in your recorded decisions touches this work item.
        </Text>
      ) : (
        findings.map((f) => <Finding key={f.decisionId} f={f} />)
      )}
      {recording || empty ? (
        <RecordDecision
          issueKey={data.work?.key}
          conflicts={conflicts}
          onDone={done}
          onCancel={empty ? null : () => setRecording(false)}
        />
      ) : (
        <Inline space="space.100" shouldWrap>
          {rovoOn ? (
            <Button appearance={counts.conflict ? 'primary' : 'default'} onClick={askPrecedent} iconBefore="decision">
              Ask Precedent
            </Button>
          ) : null}
          <Button appearance="subtle" onClick={() => { setRecorded(null); setRecording(true); }} iconBefore="add">
            {counts.conflict ? 'Record a decision…' : 'Record a decision'}
          </Button>
          <Button appearance="subtle" onClick={sync} isDisabled={busy} iconBefore="refresh">
            {busy ? 'Syncing…' : 'Re-check'}
          </Button>
        </Inline>
      )}
      <Text size="small" color="color.text.subtlest">
        Checked against {data.indexedDecisions} decision{data.indexedDecisions === 1 ? '' : 's'} · synced {timeAgo(data.lastSyncAt)}
      </Text>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
