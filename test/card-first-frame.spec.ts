import '../src/card.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cardType } from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import { EstanzaSceneView } from '../src/scene-view.js';
import { MemoryStorage } from './memory-storage.js';
import { createMockHass } from './mock-hass.js';
import { threeStoreyHome } from './storeys.js';

let drawable = true;
let frames = 0;

async function mountCard(): Promise<EstanzaCard> {
  const card = document.createElement('estanza-card');

  card.hass = createMockHass({ states: [] });
  card.setConfig({ type: cardType, home_document: threeStoreyHome() });
  document.body.append(card);
  await settle(card);

  return card;
}

async function settle(card: EstanzaCard): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await Promise.resolve();
    await card.updateComplete;
  }
}

function part(card: EstanzaCard, selector: string): HTMLElement {
  const found = card.shadowRoot?.querySelector<HTMLElement>(selector);

  if (!found) throw new Error(`no ${selector} in the card`);

  return found;
}

async function drawFrame(card: EstanzaCard): Promise<void> {
  frames += 1;
  part(card, 'estanza-scene-view').dispatchEvent(new Event('view-change'));
  await settle(card);
}

function waiting(card: EstanzaCard): boolean {
  return part(card, '.stage').classList.contains('undrawn');
}

beforeEach(() => {
  drawable = true;
  frames = 0;
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(EstanzaSceneView.prototype, 'drawable', 'get').mockImplementation(
    () => drawable,
  );
  vi.spyOn(EstanzaSceneView.prototype, 'frames', 'get').mockImplementation(
    () => frames,
  );
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the card before its home is drawn', () => {
  it('keeps the view and floor controls hidden until the first frame', async () => {
    const card = await mountCard();

    expect(part(card, '.dock .views')).toBeTruthy();
    expect(part(card, '.dock .floors')).toBeTruthy();
    expect(waiting(card)).toBe(true);

    await drawFrame(card);

    expect(waiting(card)).toBe(false);
  });

  it('keeps the controls once shown, even when the scene stops drawing', async () => {
    const card = await mountCard();

    await drawFrame(card);
    drawable = false;
    frames = 0;
    card.requestUpdate();
    await settle(card);

    expect(waiting(card)).toBe(false);
  });

  it('shows the controls at once when the scene cannot draw', async () => {
    drawable = false;

    const card = await mountCard();

    expect(waiting(card)).toBe(false);
  });
});
