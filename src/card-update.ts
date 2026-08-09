import { homeDocumentSchema } from '@estanza/plan-engine/document';
import {
  CARD_UPDATE_HEADER,
  CARD_VERSION_HEADER,
  type CardUpdate,
  cardUpdateSchema,
} from '@estanza/shared/card';
import { tokens } from '@estanza/tokens';
import { css, html, type TemplateResult, unsafeCSS } from 'lit';

import { icon } from './icons.js';
import { cardVersion } from './version.js';

export const HOME_VERSION: number =
  homeDocumentSchema.innerType().shape.version.value;

export const OUTDATED_WORDS =
  'This home needs a newer Estanza card. Update it in HACS.';

export const NO_HOME_WORDS = 'Pick a home in the card settings';

export const NEWER_WORDS = 'A newer Estanza card is available in HACS.';

export function cardHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  return { ...headers, [CARD_VERSION_HEADER]: cardVersion };
}

export function cardUpdateOf(response: Response): CardUpdate {
  const parsed = cardUpdateSchema.safeParse(
    response.headers.get(CARD_UPDATE_HEADER),
  );

  return parsed.success ? parsed.data : 'ok';
}

export function homeTooNew(document: unknown): boolean {
  if (typeof document !== 'object' || document === null) return false;

  const version: unknown = Reflect.get(document, 'version');

  return typeof version === 'number' && version > HOME_VERSION;
}

export type Face = 'outdated' | 'no-home';

const faceWords: Record<Face, string> = {
  outdated: OUTDATED_WORDS,
  'no-home': NO_HOME_WORDS,
};

export function faceTemplate(face: Face): TemplateResult {
  return html`<div class="face ${face}" role="status">
    <span class="face-mark">${icon('estanza', 24)}</span>
    <p class="face-words">${faceWords[face]}</p>
  </div>`;
}

export const faceStyles = css`
  .face {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 0;
    padding: 24px;
    text-align: center;
    color: var(--primary-text-color);
    background: var(--ha-card-background, var(--card-background-color));
  }

  .face-mark {
    display: grid;
    place-items: center;
    flex: none;
    width: 44px;
    height: 44px;
    border: 1px solid var(--divider-color);
    border-radius: ${unsafeCSS(tokens.radius.md)}px;
    color: var(--primary-text-color);
  }

  .face-words {
    margin: 0;
    max-width: 28ch;
    font-size: 14px;
    line-height: 1.45;
    color: var(--secondary-text-color);
  }

  ha-card.tile .face {
    flex-direction: row;
    gap: 10px;
    padding: 8px 12px;
    text-align: left;
  }

  ha-card.tile .face-mark {
    width: 32px;
    height: 32px;
    border-radius: ${unsafeCSS(tokens.radius.sm)}px;
  }

  ha-card.tile .face-words {
    max-width: none;
    font-size: 12px;
    line-height: 1.3;
  }
`;
