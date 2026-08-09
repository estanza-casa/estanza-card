import '../src/card.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cardType } from '../src/bindings.js';
import { EstanzaCard } from '../src/card.js';
import { EstanzaSceneView } from '../src/scene-view.js';
import { MemoryStorage } from './memory-storage.js';
import { createMockHass, mockBinarySensor } from './mock-hass.js';
import { threeStoreyHome } from './storeys.js';

type Watched = typeof EstanzaCard | typeof EstanzaSceneView;

const rescheduled: string[] = [];

function watch(element: Watched): void {
  const prototype = element.prototype as unknown as {
    updated: (...given: unknown[]) => void;
  };
  const updated = prototype.updated;

  vi.spyOn(prototype, 'updated').mockImplementation(function (
    this: EstanzaCard | EstanzaSceneView,
    ...args: unknown[]
  ) {
    updated.apply(this, args);

    if (this.isUpdatePending) rescheduled.push(this.localName);
  });
}

async function settle(card: EstanzaCard): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    await Promise.resolve();
    await card.updateComplete;
    await card.shadowRoot?.querySelector('estanza-scene-view')?.updateComplete;
  }
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 23, 20, 0) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  rescheduled.length = 0;
  watch(EstanzaCard);
  watch(EstanzaSceneView);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a fresh load', () => {
  it('never asks for another update from inside a finished one', async () => {
    const card = document.createElement('estanza-card');

    card.hass = createMockHass({
      states: [
        mockBinarySensor('binary_sensor.bathroom_leak', 'moisture', true),
      ],
    });
    card.setConfig({
      type: cardType,
      home_document: threeStoreyHome(),
      grid_options: { rows: 4 },
      bindings: [
        {
          scope: { type: 'room', id: 'bathroom' },
          entity_ids: ['binary_sensor.bathroom_leak'],
        },
      ],
    });
    document.body.append(card);
    await settle(card);
    await vi.advanceTimersByTimeAsync(2000);
    await settle(card);

    expect(card.shadowRoot?.querySelector('.banner')).not.toBeNull();
    expect(rescheduled).toEqual([]);
  });
});
