import { css, html, type TemplateResult } from 'lit';

import type { OpenThing } from './sheet.js';

export function openingRowName(
  kind: OpenThing['kind'],
  beyond: string | null,
  room: string,
): string {
  if (kind === 'window') return `${room} window`;

  return beyond ? `Door to ${beyond}` : 'Door to outside';
}

export function numberRepeats<TRow extends { name: string }>(
  rows: readonly TRow[],
): TRow[] {
  const counts = new Map<string, number>();
  const seen = new Map<string, number>();

  for (const { name } of rows) counts.set(name, (counts.get(name) ?? 0) + 1);

  return rows.map((row) => {
    if ((counts.get(row.name) ?? 0) < 2) return row;

    const number = (seen.get(row.name) ?? 0) + 1;

    seen.set(row.name, number);

    return { ...row, name: `${row.name} ${number}` };
  });
}

export function sheetNamesTemplate(title: string): TemplateResult {
  return html`<div class="sheet-names">
    <h2 class="sheet-title" id="sheet-title">${title}</h2>
  </div>`;
}

export const namesStyles = css`
  .sheet-names {
    flex: 1;
    min-width: 0;
  }
`;
