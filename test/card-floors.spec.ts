import '../src/card.js';

import { planPalette } from '@estanza/plan2d';
import { tokens } from '@estanza/tokens';
import { render } from 'lit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import aurora from '../../estanza/packages/shared/src/demo-home.json';
import { cardType, type SceneBinding } from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import {
  DANGER_DOT,
  floorDotRing,
  floorStackTemplate,
  floorStyles,
  NOTICE_DOT,
} from '../src/floor-view.js';
import type { Storey } from '../src/floors.js';
import type { EstanzaSceneView } from '../src/scene-view.js';
import homeFixture from './fixtures/home.json';
import { MemoryStorage, refusingStorage } from './memory-storage.js';
import { createMockHass, type MockHass, mockLight } from './mock-hass.js';
import { threeStoreyHome } from './storeys.js';

const bindings: SceneBinding[] = [
  {
    scope: { type: 'light', id: 'living-space-light' },
    entity_id: 'light.living',
  },
  { scope: { type: 'light', id: 'cellar-light' }, entity_id: 'light.cellar' },
  { scope: { type: 'light', id: 'bedroom-light' }, entity_id: 'light.bedroom' },
];

let hass: MockHass;

async function mountCard(extra: Record<string, unknown> = {}) {
  const card = document.createElement('estanza-card');

  hass = createMockHass({
    states: [
      mockLight('light.living', { on: true }),
      mockLight('light.cellar', { on: false }),
      mockLight('light.bedroom', { on: false }),
    ],
  });
  card.hass = hass;
  card.setConfig({
    type: cardType,
    home_document: threeStoreyHome(),
    bindings,
    ...extra,
  });
  document.body.append(card);
  await settle(card);

  return card;
}

async function settle(card: EstanzaCard): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await Promise.resolve();
    await card.updateComplete;
    await sceneOf(card)?.updateComplete;
  }
}

function sceneOf(card: EstanzaCard): EstanzaSceneView | null {
  return card.shadowRoot?.querySelector('estanza-scene-view') ?? null;
}

function stack(card: EstanzaCard): HTMLButtonElement[] {
  return [
    ...(card.shadowRoot?.querySelectorAll<HTMLButtonElement>(
      '.floors button',
    ) ?? []),
  ];
}

function storeyButton(card: EstanzaCard, floor: string): HTMLButtonElement {
  const button = card.shadowRoot?.querySelector<HTMLButtonElement>(
    `.floors button[data-floor="${floor}"]`,
  );

  if (!button) throw new Error(`no button for ${floor}`);

  return button;
}

async function choose(card: EstanzaCard, floor: string): Promise<void> {
  storeyButton(card, floor).click();
  await settle(card);
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('the floor stack', () => {
  it('offers all floors, then each storey from the top down', async () => {
    const card = await mountCard();

    expect(
      stack(card).map((button) => button.getAttribute('aria-label')),
    ).toEqual(['All floors', 'First floor', 'Ground floor', 'Basement']);
  });

  it('shows the webapp short name on each storey and only an icon for all floors', async () => {
    const card = await mountCard();

    expect(stack(card).map((button) => button.textContent?.trim())).toEqual([
      '',
      '1st',
      'Grd',
      'B',
    ]);
  });

  it('names every button for a pointer as well', async () => {
    const card = await mountCard();

    for (const button of stack(card)) {
      expect(button.title).toBe(button.getAttribute('aria-label'));
    }
  });

  it('is not drawn for a home with one storey', async () => {
    const card = await mountCard({ home_document: homeFixture });

    expect(stack(card)).toEqual([]);
  });

  it('marks the chosen storey', async () => {
    const card = await mountCard();

    await choose(card, 'f1');

    expect(
      stack(card).map((button) => button.getAttribute('aria-pressed')),
    ).toEqual(['false', 'false', 'true', 'false']);
  });

  it('shows the chosen storey in the scene', async () => {
    const card = await mountCard();

    await choose(card, 'ufloor');

    expect(sceneOf(card)?.floor).toBe('ufloor');
  });

  it('pulls the storeys apart for all floors', async () => {
    const card = await mountCard();

    await choose(card, 'f1');
    await choose(card, 'all');

    expect(sceneOf(card)?.floor).toBeNull();
  });

  it('draws every storey with its walls once all floors is pressed, the roomless one too', async () => {
    const shell = threeStoreyHome();

    for (const floor of shell.plan.floors) {
      if (floor.id === 'f1') floor.rooms = [];
    }

    const card = await mountCard({ home_document: shell });

    await choose(card, 'ufloor');
    await choose(card, 'all');

    const drawn = sceneOf(card)?.drawnFloors() ?? [];

    expect(drawn.map((floor) => floor.id).sort()).toEqual([
      'bfloor',
      'f1',
      'ufloor',
    ]);

    for (const floor of drawn) {
      expect(floor.floor.walls.length).toBeGreaterThan(0);
    }
  });

  it('goes back to one storey when all floors is pressed again', async () => {
    const card = await mountCard();

    await choose(card, 'ufloor');
    await choose(card, 'all');
    await choose(card, 'all');

    expect(sceneOf(card)?.floor).toBe('ufloor');
    expect(storeyButton(card, 'all').getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('shows every storey on the plan for all floors, and marks the button', async () => {
    const card = await mountCard({ default_view: '2d' });

    await choose(card, 'f1');
    await choose(card, 'all');

    const plan = card.shadowRoot?.querySelector('estanza-plan-view');

    expect(plan?.active).toBeNull();
    expect(storeyButton(card, 'all').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the storey a card opens on', () => {
  const upstairs: SceneBinding[] = [
    ...bindings,
    { scope: { type: 'room', id: 'bedroom' }, entity_id: 'sensor.bedroom' },
  ];

  it('is the storey with the most linked things', async () => {
    const card = await mountCard({ bindings: upstairs });

    expect(sceneOf(card)?.floor).toBe('ufloor');
    expect(storeyButton(card, 'ufloor').getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('breaks a tie on links by the storey with the most rooms, at any height', async () => {
    const tall = await mountCard();
    const short = await mountCard({ grid_options: { rows: 6, columns: 12 } });

    expect(sceneOf(tall)?.floor).toBe('f1');
    expect(sceneOf(short)?.floor).toBe('f1');
  });

  it('is the same storey on the tile', async () => {
    const card = await mountCard({
      bindings: upstairs,
      grid_options: { rows: 3, columns: 6 },
    });
    const plan = card.shadowRoot?.querySelector<
      HTMLElement & { active: string }
    >('estanza-plan-view');

    expect(plan?.active).toBe('ufloor');
  });

  it('never opens on a storey with no rooms', async () => {
    const source = structuredClone(threeStoreyHome());

    for (const floor of source.plan.floors) {
      if (floor.id === 'f1') floor.rooms = [];
    }

    const card = await mountCard({
      home_document: source,
      bindings: [
        {
          scope: { type: 'light', id: 'living-space-light' },
          entity_id: 'light.living',
        },
        { scope: { type: 'door', id: 'd1' }, entity_id: 'binary_sensor.door' },
      ],
    });

    expect(sceneOf(card)?.floor).not.toBe('f1');
    expect(sceneOf(card)?.floor).not.toBeNull();
  });

  it('is the storey chosen last time on this card', async () => {
    const first = await mountCard();

    await choose(first, 'bfloor');
    first.remove();

    const again = await mountCard();

    expect(sceneOf(again)?.floor).toBe('bfloor');
  });

  it('falls back to the default when the remembered storey is gone', async () => {
    const first = await mountCard();

    await choose(first, 'ufloor');
    first.remove();

    const flat = await mountCard({ home_document: homeFixture });

    expect(sceneOf(flat)?.floor).toBeNull();
  });

  it('still opens when the browser refuses storage', async () => {
    vi.stubGlobal('localStorage', refusingStorage());

    const card = await mountCard();

    await choose(card, 'f1');

    expect(sceneOf(card)?.floor).toBe('f1');
  });
});

describe('floor dots', () => {
  function dotOf(card: EstanzaCard, floor: string): HTMLElement | null {
    return storeyButton(card, floor).querySelector('.dot');
  }

  it('marks a storey where a light is on, in the light colour', async () => {
    const card = await mountCard();

    expect(dotOf(card, 'f1')).not.toBeNull();
    expect(dotOf(card, 'f1')?.style.background).not.toBe('');
    expect(dotOf(card, 'bfloor')).toBeNull();
    expect(dotOf(card, 'ufloor')).toBeNull();
  });

  it('only lights the dot of a hidden storey, and stays where it is', async () => {
    const card = await mountCard();

    await choose(card, 'ufloor');
    hass.setState('light.cellar', 'on', { brightness: 255 });
    card.hass = { ...hass };
    await settle(card);

    expect(dotOf(card, 'bfloor')).not.toBeNull();
    expect(sceneOf(card)?.floor).toBe('ufloor');
  });

  describe('on Casa Aurora', () => {
    const ground = [
      'hall',
      'living-room',
      'kitchen',
      'study',
      'washroom',
      'garage',
    ];

    async function mountAurora(lit: string[]): Promise<EstanzaCard> {
      const card = document.createElement('estanza-card');
      const lights = aurora.additions.lights.map((light) => light.slug);

      hass = createMockHass({
        states: lights.map((slug) =>
          mockLight(`light.${slug}`, {
            on: lit.includes(slug.replace(/-light$/, '')),
          }),
        ),
      });
      card.hass = hass;
      card.setConfig({
        type: cardType,
        home_document: aurora,
        bindings: lights.map((slug) => ({
          scope: { type: 'light', id: slug },
          entity_id: `light.${slug}`,
        })),
      });
      document.body.append(card);
      await settle(card);

      return card;
    }

    it('leaves the first floor dark with every ground floor light on', async () => {
      const card = await mountAurora(ground);

      expect(dotOf(card, 'f1')).not.toBeNull();
      expect(dotOf(card, 'f2')).toBeNull();
      expect(dotOf(card, 'f3')).toBeNull();
    });

    it('marks the first floor for the guest room light, which is upstairs', async () => {
      const card = await mountAurora([...ground, 'guest-room']);

      expect(dotOf(card, 'f2')).not.toBeNull();
      expect(dotOf(card, 'f3')).toBeNull();
    });
  });
});

describe('tap to control across storeys', () => {
  function targetIds(card: EstanzaCard): string[] {
    return (sceneOf(card)?.targets ?? []).map((scope) => scope.id).sort();
  }

  it('answers taps on every storey while they are apart', async () => {
    const card = await mountCard();

    await choose(card, 'all');

    expect(targetIds(card)).toEqual([
      'bedroom-light',
      'cellar-light',
      'living-space-light',
    ]);
  });

  it('answers taps only on the storey in view', async () => {
    const card = await mountCard();

    await choose(card, 'f1');

    expect(targetIds(card)).toEqual(['living-space-light']);
  });

  it('toggles a ground floor light while the storeys are apart', async () => {
    const card = await mountCard();

    sceneOf(card)?.dispatchEvent(
      new CustomEvent('scope-select', {
        detail: {
          scopeType: 'light',
          scopeId: 'living-space-light',
          gesture: 'tap',
          x: 200,
          y: 150,
        },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(card);

    expect(hass.serviceCalls).toEqual([
      {
        domain: 'light',
        service: 'toggle',
        data: { entity_id: 'light.living' },
      },
    ]);
  });
});

describe('the floor stack on a narrow card', () => {
  const levels: Storey[] = [
    { id: 'ufloor', name: 'First floor', level: 1, label: '1' },
    { id: 'f1', name: 'Ground floor', level: 0, label: '0' },
  ];

  function drawn(collapsed: boolean, toggle: (() => void) | null) {
    const host = document.createElement('div');
    const choose = vi.fn();

    render(
      floorStackTemplate({
        storeys: levels,
        chosen: 'f1',
        dots: new Map(),
        choose,
        collapsed,
        toggle,
      }),
      host,
    );

    return { host, choose };
  }

  it('collapses to one chip that shows the storey in view', () => {
    const { host } = drawn(true, () => undefined);
    const buttons = [...host.querySelectorAll('button')];

    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent?.trim()).toBe('0');
    expect(buttons[0].getAttribute('aria-expanded')).toBe('false');
    expect(buttons[0].getAttribute('aria-label')).toContain('Ground floor');
  });

  it('opens the list when the chip is tapped, without choosing a storey', () => {
    const toggle = vi.fn();
    const { host, choose } = drawn(true, toggle);

    host.querySelector('button')?.click();

    expect(toggle).toHaveBeenCalledOnce();
    expect(choose).not.toHaveBeenCalled();
  });

  it('keeps the storey number in its own box beside the light dot', () => {
    const host = document.createElement('div');

    render(
      floorStackTemplate({
        storeys: levels,
        chosen: 'f1',
        dots: new Map([['f1', '#ffd4ab']]),
        choose: () => undefined,
        collapsed: true,
        toggle: () => undefined,
      }),
      host,
    );

    const chip = host.querySelector('button');
    const loose = [...(chip?.childNodes ?? [])].filter(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );

    expect(loose).toEqual([]);
    expect(chip?.querySelector('.label')?.textContent).toBe('0');
    expect(chip?.querySelector('.dot')).not.toBeNull();
  });

  it('lists every storey once open', () => {
    const { host } = drawn(false, () => undefined);

    expect(host.querySelectorAll('button')).toHaveLength(3);
  });

  function chipDot(dots: Map<string, string>): string | null {
    const host = document.createElement('div');

    render(
      floorStackTemplate({
        storeys: levels,
        chosen: 'f1',
        dots,
        choose: () => undefined,
        collapsed: true,
        toggle: () => undefined,
      }),
      host,
    );

    const dot = host.querySelector<HTMLElement>('.dot');

    return dot ? dot.getAttribute('style') : null;
  }

  it('dots the chip for a light on a storey out of view', () => {
    expect(chipDot(new Map([['ufloor', '#ffd4ab']]))).toBe(
      'background:#ffd4ab',
    );
  });

  it('leaves the chip bare when no storey has a dot', () => {
    expect(chipDot(new Map())).toBeNull();
  });

  it('dots the chip red when any storey has a critical alert', () => {
    expect(
      chipDot(
        new Map([
          ['f1', '#ffd4ab'],
          ['ufloor', DANGER_DOT],
        ]),
      ),
    ).toBe(`background:${DANGER_DOT}`);
  });

  it('prefers a light over a notice elsewhere', () => {
    expect(
      chipDot(
        new Map([
          ['f1', NOTICE_DOT],
          ['ufloor', '#ffd4ab'],
        ]),
      ),
    ).toBe('background:#ffd4ab');
  });

  it('shows a notice when nothing more urgent is on', () => {
    expect(chipDot(new Map([['ufloor', NOTICE_DOT]]))).toBe(
      `background:${NOTICE_DOT}`,
    );
  });

  it('keeps the colour of the storey in view between two lights', () => {
    expect(
      chipDot(
        new Map([
          ['ufloor', '#aabbff'],
          ['f1', '#ffd4ab'],
        ]),
      ),
    ).toBe('background:#ffd4ab');
  });

  it('still shows each storey its own dot once open', () => {
    const host = document.createElement('div');

    render(
      floorStackTemplate({
        storeys: levels,
        chosen: 'f1',
        dots: new Map([['ufloor', '#ffd4ab']]),
        choose: () => undefined,
        collapsed: false,
        toggle: () => undefined,
      }),
      host,
    );

    expect(host.querySelector('[data-floor="ufloor"] .dot')).not.toBeNull();
    expect(host.querySelector('[data-floor="f1"] .dot')).toBeNull();
  });
});

describe('the floor dot ring', () => {
  it('is the plan ink in the light theme, so a pale dot reads on the light bar', () => {
    expect(floorDotRing('light')).toBe(planPalette('light').ink);
  });

  it('stays the dark surface in the dark theme', () => {
    expect(floorDotRing('dark')).toBe(tokens.themes.dark.surface);
  });

  it('draws the dot as wide as the shut-door dot on the view, so it reads at a glance', () => {
    const dot = /\.fb \.dot \{([^}]*)\}/.exec(floorStyles.cssText)?.[1] ?? '';

    expect(dot).toMatch(/width: 10px/);
    expect(dot).toMatch(/height: 10px/);
  });

  it('is drawn 1.5px wide around every floor dot', () => {
    expect(floorStyles.cssText).toMatch(
      /\.fb \.dot \{[^}]*box-shadow: 0 0 0 1\.5px var\(--ez-floor-dot-ring\)/,
    );
  });
});
