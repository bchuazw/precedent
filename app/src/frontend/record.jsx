// "Record a decision" form for the Jira work-item panel. Shows, as you type, what Precedent understood
// (chosen / ruled out / scope), so people learn the phrasing that makes a decision checkable. Saves a
// "Decision:" comment on the work item as the current user; it is indexed immediately. When the work
// intentionally reverses a decision it conflicts with, the new decision can supersede it, which clears
// the conflict everywhere.
import React, { useEffect, useRef, useState } from 'react';
import { Stack, Inline, Text, Button, Label, TextArea, Textfield, Select, SectionMessage, Spinner } from '@forge/react';
import { invoke } from '@forge/bridge';

const EXAMPLE = 'Use PostgreSQL instead of MongoDB for new services';

function Terms({ label, items, color }) {
  if (!items?.length) return null;
  return (
    <Inline space="space.050" alignBlock="baseline" shouldWrap>
      <Text size="small" weight="medium" color="color.text.subtle">{label}:</Text>
      <Text size="small" color={color}>{items.join(' · ')}</Text>
    </Inline>
  );
}

export function RecordDecision({ issueKey, conflicts = [], initialSupersedes = null, onDone, onCancel }) {
  const [statement, setStatement] = useState('');
  const [rationale, setRationale] = useState('');
  const [supersedes, setSupersedes] = useState(initialSupersedes);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const timer = useRef(null);

  // Live preview of the parse, debounced while typing.
  useEffect(() => {
    clearTimeout(timer.current);
    const text = statement.trim();
    if (text.length < 6) {
      setPreview(null);
      return undefined;
    }
    setPreviewing(true);
    timer.current = setTimeout(async () => {
      try {
        setPreview(await invoke('previewDecision', { statement: text }));
      } catch {
        setPreview(null);
      } finally {
        setPreviewing(false);
      }
    }, 450);
    return () => clearTimeout(timer.current);
  }, [statement]);

  const options = conflicts.map((d) => ({ label: `${d.key ? `${d.key}: ` : ''}${d.title}`, value: d.key || d.title }));
  const selected = options.find((o) => o.value === supersedes) ?? null;
  const understood = preview && (preview.chosen?.length || preview.rejected?.length);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await invoke('recordDecision', { statement: statement.trim(), rationale: rationale.trim() || null, supersedes: supersedes || null });
      if (res?.error) setError(res.error);
      else onDone?.(res);
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack space="space.100">
      <Stack space="space.050">
        <Label labelFor="precedent-statement">Decision</Label>
        {/* Uncontrolled: a controlled value round-trips through the bridge and drops keystrokes when typing fast. */}
        <TextArea
          id="precedent-statement"
          placeholder={EXAMPLE}
          onChange={(e) => setStatement(e.target.value)}
          resize="smart"
        />
      </Stack>
      <Stack space="space.050">
        <Label labelFor="precedent-rationale">Why (optional)</Label>
        <Textfield
          id="precedent-rationale"
          placeholder="because we need multi-document transactions"
          onChange={(e) => setRationale(e.target.value)}
        />
      </Stack>
      {options.length ? (
        <Stack space="space.050">
          <Label labelFor="precedent-supersedes">Reverses an earlier decision (optional)</Label>
          <Select
            inputId="precedent-supersedes"
            options={options}
            value={selected}
            isClearable
            placeholder="No, this is a new decision"
            onChange={(opt) => setSupersedes(opt?.value ?? null)}
          />
        </Stack>
      ) : null}

      {statement.trim().length >= 6 ? (
        <Stack space="space.050">
          {previewing && !preview ? (
            <Inline space="space.050" alignBlock="center">
              <Spinner size="small" />
              <Text size="small" color="color.text.subtle">Reading it…</Text>
            </Inline>
          ) : understood ? (
            <>
              <Text size="small" color="color.text.subtle">Precedent will read this as:</Text>
              <Terms label="Chosen" items={preview.chosen} color="color.text.success" />
              <Terms label="Ruled out" items={preview.rejected} color="color.text.danger" />
              <Terms label="Scope" items={preview.scope} color="color.text" />
              {preview.negativeVerb ? (
                <Text size="small" color="color.text.subtlest">Only work that would {preview.negativeVerb} it will be flagged.</Text>
              ) : null}
            </>
          ) : (
            <Text size="small" color="color.text.warning">
              Name what you chose and what you ruled out, for example “{EXAMPLE}”, so new work can be checked against it.
            </Text>
          )}
        </Stack>
      ) : null}

      {supersedes ? (
        <Text size="small" color="color.text.subtle">
          {supersedes} will be marked superseded and stop raising conflicts.
        </Text>
      ) : null}
      {error ? (
        <SectionMessage appearance="error" title="Couldn't record the decision">
          <Text>{error}</Text>
        </SectionMessage>
      ) : null}
      <Inline space="space.100">
        <Button appearance="primary" onClick={save} isDisabled={saving || statement.trim().length < 6}>
          {saving ? 'Recording…' : `Record on ${issueKey ?? 'this work item'}`}
        </Button>
        {onCancel ? (
          <Button appearance="subtle" onClick={onCancel} isDisabled={saving}>
            Cancel
          </Button>
        ) : null}
      </Inline>
    </Stack>
  );
}
