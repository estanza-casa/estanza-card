import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cardType,
  type SceneBinding,
  type SceneScope,
  scopeKey,
  type ThingAction,
} from '../src/bindings.js';
import { EstanzaCard } from '../src/card.js';
import { EstanzaSceneView } from '../src/scene-view.js';
import homeFixture from './fixtures/home.json';
import { MemoryStorage } from './memory-storage.js';
import {
  createMockHass,
  mockEntityState,
  type MockHass,
  mockSwitch,
} from './mock-hass.js';

const TV = 'prop:tv';
const PLUG = 'prop:plug';

let hass: MockHass;

function home() {
  const draft = structuredClone(homeFixture);

  Object.assign(draft.additions, {
    props: [
      { slug: 'tv', type: 'tv', room: 'living-space' },
      { slug: 'plug', type: 'plug', room: 'living-space' },
    ],
  });

  return homeDocumentSchema.parse(draft);
}

function tvWith(actions: Partial<SceneBinding>): SceneBinding[] {
  return [
    {
      scope: { type: 'prop', id: 'tv' },
      entity_id: 'media_player.living_tv',
      ...actions,
    },
  ];
}

async function mountCard(bindings: SceneBinding[]): Promise<EstanzaCard> {
  const card = document.createElement('estanza-card');

  hass = createMockHass({
    states: [
      mockEntityState('media_player.living_tv', 'playing', {
        friendly_name: 'Living TV',
      }),
      mockSwitch('switch.tv_plug', false),
    ],
  });
  card.hass = hass;
  card.setConfig({ type: cardType, home_document: home(), bindings });
  document.body.append(card);
  await settle(card);

  return card;
}

async function settle(card: EstanzaCard): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await Promise.resolve();
    await card.updateComplete;
    await card.shadowRoot?.querySelector('estanza-scene-view')?.updateComplete;
  }
}

function tap(card: EstanzaCard, key = TV): void {
  card.shadowRoot
    ?.querySelector(`.mark[data-key="${key}"]`)
    ?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, detail: 0 }),
    );
}

function heard(type: string, on: EventTarget = window): unknown[] {
  const details: unknown[] = [];

  on.addEventListener(type, (event) =>
    details.push((event as CustomEvent).detail),
  );

  return details;
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 9, 2, 12, 0) });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(EstanzaSceneView.prototype, 'anchorOf').mockImplementation(
    (scope: SceneScope) =>
      scopeKey(scope) === TV
        ? { x: 120, y: 120 }
        : scopeKey(scope) === PLUG
          ? { x: 300, y: 300 }
          : null,
  );
  vi.spyOn(EstanzaSceneView.prototype, 'pinAnchors').mockImplementation(
    () => new Map(),
  );
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function hold(card: EstanzaCard, key: string): void {
  card.shadowRoot?.querySelector(`.mark[data-key="${key}"]`)?.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'F10',
      shiftKey: true,
      bubbles: true,
      composed: true,
    }),
  );
}

function askedOf(card: EstanzaCard): unknown[] {
  return heard('hass-action', card);
}

describe('Home Assistant’s own actions', () => {
  it.each<[string, ThingAction]>([
    ['navigate', { action: 'navigate', navigation_path: '/lovelace/tv' }],
    [
      'navigate in place',
      {
        action: 'navigate',
        navigation_path: '/lovelace/tv',
        navigation_replace: true,
      },
    ],
    ['url', { action: 'url', url_path: 'https://example.com/tv' }],
    [
      'assist',
      { action: 'assist', pipeline_id: 'last_used', start_listening: true },
    ],
    [
      'fire-dom-event, the browser_mod popup',
      {
        action: 'fire-dom-event',
        browser_mod: {
          service: 'browser_mod.popup',
          data: { title: 'TV', content: { type: 'custom:my-remote-card' } },
        },
      },
    ],
    [
      'perform-action with a target',
      {
        action: 'perform-action',
        perform_action: 'media_player.volume_set',
        data: { volume_level: 0.4 },
        target: { entity_id: 'media_player.living_tv' },
      },
    ],
  ])('hands %s to Home Assistant’s own action handler', async (_, action) => {
    const card = await mountCard(tvWith({ tap_action: action }));
    const asked = askedOf(card);

    tap(card);

    expect(asked).toEqual([
      {
        config: { entity: 'media_player.living_tv', tap_action: action },
        action: 'tap',
      },
    ]);
    expect(hass.serviceCalls).toEqual([]);
  });

  it('hands over a hold as a hold', async () => {
    const assist = { action: 'assist' };
    const card = await mountCard(tvWith({ hold_action: assist }));
    const asked = askedOf(card);

    hold(card, TV);

    expect(asked).toEqual([
      {
        config: { entity: 'media_player.living_tv', hold_action: assist },
        action: 'hold',
      },
    ]);
  });

  it('opens the details of the entity an action names', async () => {
    const moreInfo = heard('hass-more-info');
    const card = await mountCard(
      tvWith({ tap_action: { action: 'more-info', entity: 'switch.tv_plug' } }),
    );

    tap(card);

    expect(moreInfo).toEqual([{ entityId: 'switch.tv_plug' }]);
  });

  it('ignores an action type it does not know, without failing', async () => {
    const card = await mountCard([
      {
        scope: { type: 'prop', id: 'plug' },
        entity_id: 'switch.tv_plug',
        tap_action: { action: 'teleport', to: 'mars' },
      },
    ]);
    const asked = askedOf(card);
    const moreInfo = heard('hass-more-info');

    expect(
      card.shadowRoot?.querySelector(`.mark[data-key="${PLUG}"]`),
    ).not.toBeNull();
    expect(() => tap(card, PLUG)).not.toThrow();
    expect(asked).toEqual([]);
    expect(moreInfo).toEqual([]);
    expect(hass.serviceCalls).toEqual([]);
  });

  it('marks a device whose only action is one Home Assistant runs', async () => {
    const card = await mountCard(
      tvWith({
        tap_action: { action: 'none' },
        hold_action: { action: 'navigate', navigation_path: '/energy' },
      }),
    );

    expect(card.controls.has(TV)).toBe(true);
  });
});

describe('a double tap', () => {
  const doubled: ThingAction = {
    action: 'navigate',
    navigation_path: '/lovelace/tv',
  };

  it('runs double_tap_action when the second tap comes within 250 ms', async () => {
    const moreInfo = heard('hass-more-info');
    const card = await mountCard(tvWith({ double_tap_action: doubled }));
    const asked = askedOf(card);

    tap(card);
    vi.advanceTimersByTime(249);
    tap(card);
    vi.advanceTimersByTime(400);

    expect(asked).toEqual([
      {
        config: {
          entity: 'media_player.living_tv',
          double_tap_action: doubled,
        },
        action: 'double_tap',
      },
    ]);
    expect(moreInfo).toEqual([]);
  });

  it('waits out the double tap, then runs the tap', async () => {
    const moreInfo = heard('hass-more-info');
    const card = await mountCard(tvWith({ double_tap_action: doubled }));

    tap(card);
    vi.advanceTimersByTime(249);

    expect(moreInfo).toEqual([]);

    vi.advanceTimersByTime(1);

    expect(moreInfo).toEqual([{ entityId: 'media_player.living_tv' }]);
  });

  it('keeps the first tap when the second one lands on another thing', async () => {
    const moreInfo = heard('hass-more-info');
    const card = await mountCard([
      ...tvWith({ double_tap_action: doubled }),
      {
        scope: { type: 'prop', id: 'plug' },
        entity_id: 'switch.tv_plug',
        tap_action: { action: 'more-info' },
        double_tap_action: doubled,
      },
    ]);

    tap(card);
    vi.advanceTimersByTime(100);
    tap(card, PLUG);
    vi.advanceTimersByTime(400);

    expect(moreInfo).toEqual([
      { entityId: 'media_player.living_tv' },
      { entityId: 'switch.tv_plug' },
    ]);
  });

  it('runs a tap at once when there is no double tap to wait for', async () => {
    const moreInfo = heard('hass-more-info');
    const card = await mountCard(
      tvWith({ double_tap_action: { action: 'none' } }),
    );

    tap(card);

    expect(moreInfo).toEqual([{ entityId: 'media_player.living_tv' }]);
  });
});

describe('an action with a confirmation', () => {
  it('lets Home Assistant ask, and switch the thing, with its own dialog', async () => {
    const toggle = {
      action: 'toggle',
      confirmation: { text: 'Turn the TV plug on?' },
    };
    const card = await mountCard([
      {
        scope: { type: 'prop', id: 'plug' },
        entity_id: 'switch.tv_plug',
        tap_action: toggle,
      },
    ]);
    const asked = askedOf(card);

    tap(card, PLUG);

    expect(asked).toEqual([
      {
        config: { entity: 'switch.tv_plug', tap_action: toggle },
        action: 'tap',
      },
    ]);
    expect(hass.serviceCalls).toEqual([]);
  });

  it('aims a confirmed cover or lock action at the thing’s own entity', async () => {
    const card = await mountCard([
      {
        scope: { type: 'prop', id: 'plug' },
        entity_id: 'switch.tv_plug',
        tap_action: { action: 'toggle' },
        hold_action: {
          action: 'perform-action',
          perform_action: 'lock.unlock',
          confirmation: true,
        },
      },
    ]);
    const asked = askedOf(card);

    hold(card, PLUG);

    expect(asked).toEqual([
      {
        config: {
          entity: 'switch.tv_plug',
          hold_action: {
            action: 'perform-action',
            perform_action: 'lock.unlock',
            confirmation: true,
            target: { entity_id: ['switch.tv_plug'] },
          },
        },
        action: 'hold',
      },
    ]);
  });

  it('runs a plain toggle itself, at once', async () => {
    const card = await mountCard([
      {
        scope: { type: 'prop', id: 'plug' },
        entity_id: 'switch.tv_plug',
        tap_action: { action: 'toggle' },
      },
    ]);
    const asked = askedOf(card);

    tap(card, PLUG);

    expect(asked).toEqual([]);
    expect(hass.serviceCalls).toEqual([
      {
        domain: 'switch',
        service: 'toggle',
        data: { entity_id: 'switch.tv_plug' },
      },
    ]);
  });
});
