export function toYaml(value) {
  return `${block(value, 0).join('\n')}\n`;
}

function block(value, indent) {
  if (Array.isArray(value)) return listBlock(value, indent);

  return mapBlock(value, indent);
}

function listBlock(items, indent) {
  const pad = ' '.repeat(indent);

  return items.flatMap((item) => {
    if (!isNested(item)) return [`${pad}- ${scalar(item)}`];

    const [first, ...rest] = block(item, indent + 2);

    return [`${pad}- ${first.trimStart()}`, ...rest];
  });
}

function mapBlock(record, indent) {
  const pad = ' '.repeat(indent);

  return Object.entries(record).flatMap(([key, value]) => {
    if (isEmpty(value)) return [`${pad}${key}:${emptyValue(value)}`];
    if (!isNested(value)) return [`${pad}${key}: ${scalar(value)}`];

    return [`${pad}${key}:`, ...block(value, indent + 2)];
  });
}

function isNested(value) {
  return typeof value === 'object' && value !== null && !isEmpty(value);
}

function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;

  return typeof value === 'object' && Object.keys(value).length === 0;
}

function emptyValue(value) {
  if (Array.isArray(value)) return ' []';
  if (typeof value === 'object' && value !== null) return ' {}';

  return '';
}

function scalar(value) {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(String(value));
}
