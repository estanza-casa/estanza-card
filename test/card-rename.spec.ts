import { afterEach, describe, expect, it, vi } from 'vitest';

import { cardType } from '../src/bindings.js';
import { EstanzaCard } from '../src/card.js';
import {
  createMockHass,
  mockBinarySensor,
  type MockHass,
  mockLight,
} from './mock-hass.js';

const config = {
  type: cardType,
  bindings: [
    {
      scope: { type: 'light', id: 'kitchen-light' },
      entity_id: 'light.kitchen',
    },
    {
      scope: { type: 'room', id: 'bathroom' },
      entity_id: 'binary_sensor.bathroom_leak',
    },
  ],
  registry_ids: {
    'light.kitchen': 'reg-kitchen',
    'binary_sensor.bathroom_leak': 'reg-leak',
  },
};

function beforeRename(): MockHass {
  const hass = createMockHass({
    states: [
      mockLight('light.kitchen', { on: true }),
      mockBinarySensor('binary_sensor.bathroom_leak', 'moisture', true),
    ],
  });

  hass.callWS = vi.fn().mockResolvedValue([
    { id: 'reg-kitchen', entity_id: 'light.kitchen' },
    { id: 'reg-leak', entity_id: 'binary_sensor.bathroom_leak' },
  ]);

  return hass;
}

function afterRename(): MockHass {
  const hass = createMockHass({
    states: [
      mockLight('light.kitchen_ceiling', { on: true }),
      mockBinarySensor('binary_sensor.under_sink_leak', 'moisture', true),
    ],
  });

  hass.callWS = vi.fn().mockResolvedValue([
    { id: 'reg-kitchen', entity_id: 'light.kitchen_ceiling' },
    { id: 'reg-leak', entity_id: 'binary_sensor.under_sink_leak' },
  ]);

  return hass;
}

async function mountCard(hass: MockHass): Promise<EstanzaCard> {
  const card = new EstanzaCard();

  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  card.setConfig(config);
  card.hass = hass;
  document.body.append(card);
  await card.updateComplete;

  return card;
}

async function rename(card: EstanzaCard, hass: MockHass): Promise<void> {
  card.hass = hass;
  await card.updateComplete;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('estanza-card when an entity is renamed', () => {
  it('never asks for the registry while every bound entity exists', async () => {
    const hass = beforeRename();
    const card = await mountCard(hass);

    card.hass = { ...hass, states: { ...hass.states } };
    await card.updateComplete;

    expect(hass.callWS).not.toHaveBeenCalled();
  });

  it('keeps the light lit and the leak raised through a rename', async () => {
    const card = await mountCard(beforeRename());
    const renamed = afterRename();

    await rename(card, renamed);

    await vi.waitFor(() => {
      expect(card.scopeStates['light:kitchen-light'].entityIds).toEqual([
        'light.kitchen_ceiling',
      ]);
    });

    expect(card.overlay.lights['kitchen-light'].on).toBe(true);
    expect(card.alerts.map((alert) => alert.entityId)).toEqual([
      'binary_sensor.under_sink_leak',
    ]);
    expect(renamed.callWS).toHaveBeenCalledTimes(1);
  });

  it('resolves the rename straight away on a fresh load', async () => {
    const card = await mountCard(afterRename());

    await vi.waitFor(() => {
      expect(card.overlay.lights['kitchen-light'].on).toBe(true);
    });
  });

  it('asks once for many updates that arrive together', async () => {
    const card = await mountCard(beforeRename());
    const renamed = afterRename();

    renamed.callWS = vi.fn().mockResolvedValue([]);
    await rename(card, renamed);
    await rename(card, { ...renamed, states: { ...renamed.states } });
    await rename(card, { ...renamed, states: { ...renamed.states } });

    await vi.waitFor(() => {
      expect(renamed.callWS).toHaveBeenCalled();
    });
    await card.updateComplete;
    await rename(card, { ...renamed, states: { ...renamed.states } });

    expect(renamed.callWS).toHaveBeenCalledTimes(1);
  });

  it('skips a deleted entity without an error on the card', async () => {
    const card = await mountCard(beforeRename());
    const deleted = afterRename();

    deleted.callWS = vi
      .fn()
      .mockResolvedValue([
        { id: 'reg-leak', entity_id: 'binary_sensor.under_sink_leak' },
      ]);
    await rename(card, deleted);

    await vi.waitFor(() => {
      expect(card.alerts).toHaveLength(1);
    });

    expect(card.scopeStates['light:kitchen-light']).toBeUndefined();
    expect(card.shadowRoot?.textContent).not.toMatch(/registry|not found/i);
  });

  it('falls back to entity ids quietly when the registry is refused', async () => {
    const card = await mountCard(beforeRename());
    const refused = afterRename();

    refused.callWS = vi.fn().mockRejectedValue(new Error('Unauthorized'));
    await rename(card, refused);

    await vi.waitFor(() => {
      expect(refused.callWS).toHaveBeenCalled();
    });
    await card.updateComplete;

    expect(card.scopeStates['light:kitchen-light'].status).toBe('missing');
    expect(card.shadowRoot?.textContent).not.toMatch(/registry|unauthorized/i);
  });
});
