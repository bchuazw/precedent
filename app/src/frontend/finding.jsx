// A decision card shared by the Jira work-item panel and the Confluence page byline.
import React from 'react';
import { Box, Stack, Inline, Text, Lozenge, Link, User, xcss } from '@forge/react';

export const RELATION = {
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

export function timeAgo(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function Finding({ f }) {
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
