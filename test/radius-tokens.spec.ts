// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const SOURCE = new URL('../src/', import.meta.url);
const CONSOLE_BADGE = 'version.ts';
const SHAPES = new Set(['0', '50%']);

function typedRadii(): string[] {
  return readdirSync(SOURCE)
    .filter((file) => file.endsWith('.ts') && file !== CONSOLE_BADGE)
    .flatMap((file) =>
      [
        ...readFileSync(new URL(file, SOURCE), 'utf8').matchAll(
          /border-radius:\s*([^;]+);/g,
        ),
      ]
        .map((match) => match[1].trim())
        .filter((value) => !SHAPES.has(value))
        .filter((value) => /\d+px/.test(value.replace(/\$\{[^}]+\}px/g, '')))
        .map((value) => `${file}: ${value}`),
    );
}

describe('the corner radius of the card', () => {
  it('is read from @estanza/tokens, never typed in', () => {
    expect(typedRadii()).toEqual([]);
  });
});
