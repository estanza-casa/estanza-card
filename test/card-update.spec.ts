import '../src/card.js';

import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import packageJson from '../package.json';
import { cardType } from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import {
  cardHeaders,
  cardUpdateOf,
  HOME_VERSION,
  homeTooNew,
  installedByHand,
  latestCardVersionOf,
  manualUpdateDue,
} from '../src/card-update.js';
import homeFixture from './fixtures/home.json';
import { MemoryStorage, refusingStorage } from './memory-storage.js';
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

  it('keeps the newer-card line off a card the api only suggests updating', async () => {
    const card = await sharedCard(() => answered('suggested'));

    expect(card.shadowRoot?.querySelector('.manual-update')).toBeNull();
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

const BY_HAND = 'http://homeassistant.local:8123/local/estanza-card.js?v=3';
const FROM_HACS =
  'http://homeassistant.local:8123/hacsfiles/estanza-card/estanza-card.js?hacstag=1';

function withLatest(latest: string | undefined): Response {
  return answered('ok', {
    home: { name: 'Aurora', document: home, watermark: false },
    ...(latest === undefined ? {} : { latestCardVersion: latest }),
  });
}

async function installedCard(
  scriptUrl: string,
  latest: string | undefined,
  extra: Record<string, unknown> = {},
): Promise<EstanzaCard> {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => withLatest(latest)),
  );

  const card = document.createElement('estanza-card');

  card.scriptUrl = scriptUrl;
  card.hass = createHouseHass();
  card.setConfig({ type: cardType, share_id: 'abc123', ...extra });
  document.body.append(card);
  await settle(card);

  return card;
}

function updateLine(card: EstanzaCard): HTMLElement | null {
  return card.shadowRoot?.querySelector<HTMLElement>('.manual-update') ?? null;
}

describe('a card installed by hand', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
  });

  it('says a newer card is out and links to its release when it is older', async () => {
    const card = await installedCard(BY_HAND, '9.0.0');
    const line = updateLine(card);

    expect(line?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Estanza card 9.0.0 is out. How to update',
    );
    expect(line?.querySelector('a')?.getAttribute('href')).toBe(
      'https://github.com/estanza-casa/estanza-card/releases/tag/v9.0.0',
    );
    expect(card.shadowRoot?.querySelector('estanza-scene-view')).not.toBeNull();
  });

  it('shows nothing when it is the latest card', async () => {
    const card = await installedCard(BY_HAND, packageJson.version);

    expect(updateLine(card)).toBeNull();
  });

  it('shows nothing when it is newer than the latest the api names', async () => {
    const card = await installedCard(BY_HAND, '0.0.1');

    expect(updateLine(card)).toBeNull();
  });

  it('shows nothing when the api names no latest card', async () => {
    const card = await installedCard(BY_HAND, undefined);

    expect(updateLine(card)).toBeNull();
  });

  it('shows nothing when the latest card the api names is not a plain version', async () => {
    const card = await installedCard(BY_HAND, 'v9.0.0');

    expect(updateLine(card)).toBeNull();
  });

  it('leaves the tile alone', async () => {
    const card = await installedCard(BY_HAND, '9.0.0', {
      grid_options: { rows: 2, columns: 6 },
    });

    expect(updateLine(card)).toBeNull();
  });

  it('hides the line once dismissed, and keeps it hidden for that version only', async () => {
    const card = await installedCard(BY_HAND, '9.0.0');

    updateLine(card)?.querySelector('button')?.click();
    await settle(card);

    expect(updateLine(card)).toBeNull();

    document.body.replaceChildren();

    expect(updateLine(await installedCard(BY_HAND, '9.0.0'))).toBeNull();

    document.body.replaceChildren();

    expect(updateLine(await installedCard(BY_HAND, '9.1.0'))).not.toBeNull();
  });

  it('still shows the line when the browser refuses storage', async () => {
    vi.stubGlobal('localStorage', refusingStorage());

    const card = await installedCard(BY_HAND, '9.0.0');

    expect(updateLine(card)).not.toBeNull();
  });
});

describe('a card installed through HACS', () => {
  it('shows nothing, because HACS updates it', async () => {
    const card = await installedCard(FROM_HACS, '9.0.0');

    expect(updateLine(card)).toBeNull();
  });
});

describe('when a manual card is due an update', () => {
  it('compares each part of the version as a number', () => {
    expect(manualUpdateDue('1.0.2', '1.0.10', BY_HAND)).toBe(true);
    expect(manualUpdateDue('1.9.0', '1.10.0', BY_HAND)).toBe(true);
    expect(manualUpdateDue('1.10.0', '1.9.9', BY_HAND)).toBe(false);
    expect(manualUpdateDue('2.0.0', '1.99.99', BY_HAND)).toBe(false);
  });

  it('is never due for a card it cannot read the version of', () => {
    expect(manualUpdateDue('dev', '9.0.0', BY_HAND)).toBe(false);
    expect(manualUpdateDue('1.0.2', null, BY_HAND)).toBe(false);
  });

  it('counts only a script served from /local/ as installed by hand', () => {
    expect(installedByHand(BY_HAND)).toBe(true);
    expect(installedByHand('https://ha.example/local/cards/estanza.js')).toBe(
      true,
    );
    expect(installedByHand(FROM_HACS)).toBe(false);
    expect(
      installedByHand(
        'http://ha.example/local/community/estanza-card/estanza-card.js',
      ),
    ).toBe(false);
    expect(installedByHand('http://localhost:5173/src/card.ts')).toBe(false);
    expect(installedByHand('http://ha.example/x.js?from=/local/')).toBe(false);
    expect(installedByHand('not a url')).toBe(false);
  });

  it('reads the latest version only when the body carries a plain one', () => {
    expect(latestCardVersionOf({ latestCardVersion: '1.0.2' })).toBe('1.0.2');
    expect(latestCardVersionOf({ latestCardVersion: 102 })).toBeNull();
    expect(latestCardVersionOf({ home: {} })).toBeNull();
    expect(latestCardVersionOf(null)).toBeNull();
  });
});
