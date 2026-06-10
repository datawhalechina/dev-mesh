import { formatMeshToolOutput, type MeshToolName } from '@devmesh/mcp-contracts';

type TextFormatter<T> = (value: T) => string;
type TextField = readonly [label: string, value: unknown];

export function printJsonOrText(toolName: MeshToolName, value: unknown, json?: boolean): void {
  console.log(json === true ? JSON.stringify(value, null, 2) : formatMeshToolOutput(toolName, value));
}

export function printJsonOrCustomText<T>(value: T, json: boolean | undefined, formatter: TextFormatter<T>): void {
  console.log(json === true ? JSON.stringify(value, null, 2) : formatter(value));
}

export function formatFields(title: string, fields: TextField[]): string {
  const lines = [title];

  for (const [label, value] of fields) {
    const text = scalarToString(value);

    if (text !== undefined) {
      lines.push(`${label}: ${truncate(text)}`);
    }
  }

  return lines.join('\n');
}

export function formatCountedList<T>(
  title: string,
  items: T[],
  formatItem: (item: T, index: number) => string,
  emptyMessage = 'No items returned.'
): string {
  const lines = [title, `items: ${items.length}`];

  if (items.length === 0) {
    lines.push(emptyMessage);
    return lines.join('\n');
  }

  for (const [index, item] of items.entries()) {
    lines.push(formatItem(item, index));
  }

  return lines.join('\n');
}

export function formatInlineFields(fields: TextField[]): string {
  const parts = fields
    .map(([label, value]) => {
      const text = scalarToString(value);
      return text === undefined ? undefined : `${label}=${truncate(text, 80)}`;
    })
    .filter((part): part is string => part !== undefined);

  return parts.join(' | ');
}

export function formatScalar(value: unknown, fallback = 'unknown'): string {
  return scalarToString(value) ?? fallback;
}

export function truncate(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, ' ').trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function scalarToString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}
