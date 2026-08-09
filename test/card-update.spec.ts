import '../src/card.js';

import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { afterEach, describe, expect, it, vi } from 'vitest';

import packageJson from '../package.json';
import { cardType } from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import {
  cardHeaders,
  cardUpdateOf,
  HOME_VERSION,
  homeTooNew,
} from '../src/card-update.js';
import homeFixture from './fixtures/home.json';
import { createHouseHass } from './mock-hass.js';

const home = homeDocumentSchema.parse(homeFixture);

const OUTDATED = 'This home needs a newer Estanza card. Update it in HACS.';

function answered(
  update: string | null,
  body: unknown = {
    home: { name: 'Aurora', document: home, watermark: false },
  },
  status = 200,
): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };

  if (update !== null) headers['X-Estanza-Card-Update'] = update;

  return new Response(JSON.stringify(body), { status, headers });
}

async function settle(card: EstanzaCard): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await card.updateComplete;
    await card.shadowRoot?.querySelector<
      HTMLElement & { updateComplete: Promise<unknown> }
    >('estanza-scene-view')?.updateComplete;
  }
}

async function sharedCard(
  response: () => Response,
  extra: Record<string, unknown> = {},
): Promise<EstanzaCard> {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => response()),
  );

  const card = document.createElement('estanza-card');

  card.hass = createHouseHass();
  card.setConfig({ type: cardType, share_id: 'abc123', ...extra });
  document.body.append(card);
  await settle(card);

  return card;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the card version on the wire', () => {
  it('names the card version in the header every request carries', () => {
    expect(cardHeaders({ accept: 'application/json' })).toEqual({
      accept: 'application/json',
      'X-Estanza-Card': packageJson.version,
    });
  });

  it('reads each verdict the api can give', () => {
    expect(cardUpdateOf(answered('ok'))).toBe('ok');
    expect(cardUpdateOf(answered('suggested'))).toBe('suggested');
    expect(cardUpdateOf(answered('required'))).toBe('required');
  });

  it('counts a missing or unreadable verdict as ok', () => {
    expect(cardUpdateOf(answered(null))).toBe('ok');
    expect(cardUpdateOf(answered('blocked'))).toBe('ok');
    expect(cardUpdateOf(answered('REQUIRED'))).toBe('ok');
  });
});

describe('the home versions the card understands', () => {
  it('understands the version the home schema parses', () => {
    expect(HOME_VERSION).toBe(home.version);
  });

  it('draws a home inside the range', () => {
    expect(homeTooNew(home)).toBe(false);
  });

  it('knows a home above the range is too new', () => {
    expect(homeTooNew({ ...home, version: HOME_VERSION + 1 })).toBe(true);
  });

  it('leaves a home with no version to the schema', () => {
    const { version: _dropped, ...unversioned } = home;

    expect(homeTooNew(unversioned)).toBe(false);
    expect(homeTooNew(null)).toBe(false);
    expect(homeTooNew('home')).toBe(false);
  });
});

describe('a card with no home yet', () => {
  async function homeless(extra: Record<string, unknown> = {}) {
    const fetched = vi.fn();

    vi.stubGlobal('fetch', fetched);

    const card = document.createElement('estanza-card');

    card.hass = createHouseHass();
    card.setConfig({ type: cardType, bindings: [], ...extra });
    document.body.append(card);
    await settle(card);

    return { card, fetched };
  }

  it('shows the Estanza mark and where to pick a home', async () => {
    const { card, fetched } = await homeless();
    const face = card.shadowRoot?.querySelector('ha-card .no-home');

    expect(face?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Pick a home in the card settings',
    );
    expect(face?.querySelector('svg')).not.toBeNull();
    expect(card.shadowRoot?.querySelector('estanza-scene-view')).toBeNull();
    expect(fetched).not.toHaveBeenCalled();
  });

  it('shows it on the tile as well', async () => {
    const { card } = await homeless({ grid_options: { rows: 2, columns: 6 } });

    expect(card.shadowRoot?.querySelector('ha-card .no-home')).not.toBeNull();
    expect(card.shadowRoot?.querySelector('.tile-plans')).toBeNull();
  });
});

describe('a card too old for its home', () => {
  it('replaces the home with one calm state when the api requires an update', async () => {
    const card = await sharedCard(() => answered('required'));
    const face = card.shadowRoot?.querySelector('ha-card .outdated');

    expect(face?.textContent?.replace(/\s+/g, ' ').trim()).toBe(OUTDATED);
    expect(face?.querySelector('svg')).not.toBeNull();
    expect(card.shadowRoot?.querySelector('estanza-scene-view')).toBeNull();
    expect(card.shadowRoot?.querySelector('.stage')).toBeNull();
    expect(card.shadowRoot?.querySelector('button')).toBeNull();
  });

  it('replaces the home when the home is newer than the card, with no floor set', async () => {
    const card = await sharedCard(() =>
      answered('ok', {
        home: {
          name: 'Aurora',
          document: { ...home, version: HOME_VERSION + 1 },
          watermark: false,
        },
      }),
    );

    expect(card.shadowRoot?.querySelector('.outdated')).not.toBeNull();
    expect(card.shadowRoot?.querySelector('estanza-scene-view')).toBeNull();
  });

  it('replaces the tile as well', async () => {
    const card = await sharedCard(() => answered('required'), {
      grid_options: { rows: 2, columns: 6 },
    });

    expect(card.shadowRoot?.querySelector('ha-card .outdated')).not.toBeNull();
    expect(card.shadowRoot?.querySelector('.tile-plans')).toBeNull();
    expect(card.shadowRoot?.querySelector('estanza-scene-view')).toBeNull();
  });

  it('shows nothing on the dashboard when an update is only suggested', async () => {
    const card = await sharedCard(() => answered('suggested'));

    expect(card.shadowRoot?.querySelector('.outdated')).toBeNull();
    expect(card.shadowRoot?.textContent).not.toContain('HACS');
    expect(card.shadowRoot?.querySelector('estanza-scene-view')).not.toBeNull();
  });

  it('looks again once its config changes', async () => {
    const card = await sharedCard(() => answered('required'));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => answered('ok')),
    );
    card.setConfig({ type: cardType, share_id: 'abc123' });
    await settle(card);

    expect(card.shadowRoot?.querySelector('.outdated')).toBeNull();
    expect(card.shadowRoot?.querySelector('estanza-scene-view')).not.toBeNull();
  });
});
