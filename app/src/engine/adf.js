// Helpers for Atlassian Document Format (ADF), the JSON body format of Confluence pages and Jira fields.

/** Depth-first walk; fn(node, ancestors). */
export function walk(node, fn, ancestors = []) {
  if (!node || typeof node !== 'object') return;
  fn(node, ancestors);
  const next = [...ancestors, node];
  for (const child of node.content ?? []) walk(child, fn, next);
}

/** Plain text of a node. Mentions become "@Name", dates become ISO dates, statuses their label. */
export function textOf(node) {
  const parts = [];
  walk(node, (n) => {
    switch (n.type) {
      case 'text':
        parts.push(n.text);
        break;
      case 'mention':
        parts.push(n.attrs?.text ? (n.attrs.text.startsWith('@') ? n.attrs.text : `@${n.attrs.text}`) : '@someone');
        break;
      case 'date':
        parts.push(isoDate(n.attrs?.timestamp));
        break;
      case 'status':
        parts.push(n.attrs?.text ?? '');
        break;
      case 'emoji':
        break;
      case 'hardBreak':
        parts.push(' ');
        break;
      case 'paragraph':
      case 'heading':
      case 'listItem':
      case 'tableCell':
      case 'tableHeader':
        if (parts.length && !/\s$/.test(parts[parts.length - 1])) parts.push(' ');
        break;
      default:
        break;
    }
  });
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** Account ids mentioned inside a node. */
export function mentionsIn(node) {
  const ids = [];
  walk(node, (n) => {
    if (n.type === 'mention' && n.attrs?.id) ids.push({ accountId: n.attrs.id, name: (n.attrs.text ?? '').replace(/^@/, '') });
  });
  return ids;
}

export function isoDate(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return '';
  return new Date(n).toISOString().slice(0, 10);
}

/** Parses a JSON ADF string safely. */
export function parseAdf(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Reads a table into rows of cells (each cell = its node). */
export function tableRows(table) {
  return (table.content ?? [])
    .filter((r) => r.type === 'tableRow')
    .map((r) => (r.content ?? []).filter((c) => c.type === 'tableCell' || c.type === 'tableHeader'));
}

/**
 * Splits a document's top-level content into sections keyed by heading text (lower-case, emoji removed).
 * Content before the first heading goes under ''.
 */
export function sections(doc) {
  const out = new Map([['', []]]);
  let current = '';
  for (const node of doc?.content ?? []) {
    if (node.type === 'heading') {
      current = textOf(node).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!out.has(current)) out.set(current, []);
      continue;
    }
    out.get(current).push(node);
  }
  return out;
}

/** Builds a minimal ADF document from paragraphs of plain text (used when writing to Jira/Confluence). */
export function adfDoc(blocks) {
  return { type: 'doc', version: 1, content: blocks };
}

export function adfParagraph(text, marks) {
  return { type: 'paragraph', content: text ? [{ type: 'text', text, ...(marks ? { marks } : {}) }] : [] };
}
