import { homeDocumentSchema } from '@estanza/plan-engine/document';
import type { CardUpdate } from '@estanza/shared/card';
import { render } from 'lit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import aurora from '../../estanza/packages/shared/src/demo-home.json';
import packageJson from '../package.json';
import {
  bindingEntityIds,
  cardType,
  type EstanzaCardConfig,
  parseCardConfig,
  type SceneBinding,
  type SceneScope,
  scopeKey,
} from '../src/bindings.js';
import {
  EstanzaCardEditor,
  fetchShareDocument,
  type HaFormSchemaEntry,
  type HighlightDetail,
  highlightEvent,
  homeSummary,
  notHomeFile,
  readHomeFile,
  type SceneDocumentLoader,
  shareDocumentUrl,
} from '../src/config-editor.js';
import { icon, type IconName } from '../src/icons.js';
import {
  entityFilter,
  isStorageRoom,
  type PickDetail,
  pickEvent,
} from '../src/linking.js';
import { covered } from '../src/living.js';
import type { EstanzaPlanView } from '../src/plan-view.js';
import homeFixture from './fixtures/home.json';
import { MemoryStorage } from './memory-storage.js';
import {
  createMockHass,
  mockBinarySensor,
  mockEntityState,
  type MockHass,
  mockLight,
  mockLock,
  mockSensor,
} from './mock-hass.js';

type HaForm = HTMLElement & {
  schema: HaFormSchemaEntry[];
  data: Record<string, unknown>;
  computeLabel?: (entry: HaFormSchemaEntry) => string;
  computeHelper?: (entry: HaFormSchemaEntry) => string | undefined;
};

const baseConfig: EstanzaCardConfig = {
  type: cardType,
  share_url: 'https://estanza.casa/share/abc123',
  bindings: [],
};

const home = homeDocumentSchema.parse(homeFixture);

const loadHome: SceneDocumentLoader = async () => homeFixture;

const failToLoad: SceneDocumentLoader = async () => {
  throw new Error('offline');
};

function editorHass(): MockHass {
  return createMockHass({
    areas: [
      { area_id: 'living', name: 'Living space' },
      { area_id: 'bano', name: 'Baño' },
      { area_id: 'hall_1', name: 'Hall 1' },
      { area_id: 'hall_2', name: 'Hall 2' },
    ],
    states: [
      mockLight('light.living_space_light'),
      mockLight('light.ceiling', { on: false }),
      mockLight('light.hall_spots'),
      mockBinarySensor('binary_sensor.bathroom_door', 'door', false),
      mockBinarySensor('binary_sensor.hall_motion', 'motion', true),
      mockSensor('sensor.garage_humidity', 'humidity', 52, '%'),
      {
        ...mockSensor('sensor.th_7_temperature', 'temperature', 21.4, '°C'),
        attributes: {
          device_class: 'temperature',
          unit_of_measurement: '°C',
          friendly_name:
            'Sonoff Temperature and Humidity Sensor - Hall Temperature',
        },
      },
    ],
    entities: [
      { entity_id: 'light.living_space_light', area_id: 'living' },
      { entity_id: 'light.ceiling', area_id: 'bano' },
      { entity_id: 'light.hall_spots', area_id: 'hall_1' },
      { entity_id: 'binary_sensor.bathroom_door', area_id: 'bano' },
    ],
  });
}

async function createEditor(
  config: EstanzaCardConfig,
  loader: SceneDocumentLoader = loadHome,
  hass: MockHass = editorHass(),
): Promise<EstanzaCardEditor> {
  const editor = document.createElement('estanza-card-editor');

  editor.hass = hass;
  editor.documentLoader = loader;
  document.body.appendChild(editor);
  editor.setConfig(config);

  await editor.updateComplete;

  return editor;
}

async function withHome(
  config: EstanzaCardConfig = baseConfig,
  hass: MockHass = editorHass(),
): Promise<EstanzaCardEditor> {
  const editor = await createEditor(config, loadHome, hass);

  await vi.waitFor(() => {
    expect(editor.documentLoaded).toBe(true);
  });
  await editor.updateComplete;

  return editor;
}

function find<TElement extends Element = HTMLElement>(
  editor: EstanzaCardEditor,
  selector: string,
): TElement {
  const found = editor.renderRoot.querySelector<TElement>(selector);

  if (!found) throw new Error(`nothing matches ${selector}`);

  return found;
}

function all(editor: EstanzaCardEditor, selector: string): HTMLElement[] {
  return [...editor.renderRoot.querySelectorAll<HTMLElement>(selector)];
}

function text(element: Element | null): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function change(form: HaForm, value: Record<string, unknown>): void {
  form.dispatchEvent(
    new CustomEvent('value-changed', {
      detail: { value: { ...form.data, ...value } },
    }),
  );
}

function captureConfig(editor: EstanzaCardEditor): () => EstanzaCardConfig {
  const seen: EstanzaCardConfig[] = [];

  editor.addEventListener('config-changed', (event) => {
    seen.push(
      (event as CustomEvent<{ config: EstanzaCardConfig }>).detail.config,
    );
  });

  return () => {
    const latest = seen.at(-1);

    if (!latest) throw new Error('no config-changed event was fired');

    return latest;
  };
}

async function tapInPreview(
  editor: EstanzaCardEditor,
  scope: SceneScope,
): Promise<void> {
  find(editor, 'estanza-plan-view').dispatchEvent(
    new CustomEvent('scope-select', {
      detail: {
        scopeType: scope.type,
        scopeId: scope.id,
        gesture: 'tap',
        x: 10,
        y: 10,
      },
      bubbles: true,
      composed: true,
    }),
  );

  await editor.updateComplete;
}

async function click(editor: EstanzaCardEditor, element: HTMLElement) {
  element.click();

  await editor.updateComplete;
}

async function relinkToHall(editor: EstanzaCardEditor): Promise<void> {
  await click(editor, find(editor, '.picker .relink-open'));
  await click(editor, find(editor, '.relink-menu [data-key="room:hall"]'));
}

function candidateIds(editor: EstanzaCardEditor): string[] {
  return all(editor, '.picker .candidate').map(
    (row) => row.dataset.entity ?? '',
  );
}

function candidate(editor: EstanzaCardEditor, entityId: string): HTMLElement {
  return find(editor, `.picker .candidate[data-entity="${entityId}"]`);
}

async function loadFile(
  editor: EstanzaCardEditor,
  contents: string,
): Promise<void> {
  const input = find<HTMLInputElement>(editor, 'input[type="file"]');
  const file = new File([contents], 'home.json', { type: 'application/json' });

  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));

  await new Promise((resolve) => setTimeout(resolve, 0));
  await editor.updateComplete;
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the editor under a finger', () => {
  function coarseRules(): string {
    const rules = EstanzaCardEditor.styles.cssText.replace(/\s+/g, ' ');
    const start = rules.indexOf('@media (pointer: coarse)');

    return start < 0 ? '' : rules.slice(start);
  }

  it('grows every chip and button to 44px on a coarse pointer', () => {
    const rules = coarseRules();

    for (const selector of ['.floor-chip', '.suggest', '.btn']) {
      expect(rules).toMatch(
        new RegExp(`\\${selector}[^{]*\\{[^}]*min-height: 44px`),
      );
    }

    expect(rules).toMatch(/\.icon-btn \{[^}]*width: 44px; height: 44px;/);
  });
});

describe('fetchShareDocument', () => {
  it('returns a configured home document without any request', async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal('fetch', fetchMock);

    const document = await fetchShareDocument({
      type: cardType,
      home_document: home,
      bindings: [],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document).toBe(home);
  });

  it('sends the card version and reports the verdict it heard', async () => {
    const heard = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ home: { document: home } }), {
        headers: { 'X-Estanza-Card-Update': 'suggested' },
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const document = await fetchShareDocument(baseConfig, heard);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;

    expect(new Headers(init?.headers).get('X-Estanza-Card')).toBe(
      packageJson.version,
    );
    expect(heard).toHaveBeenCalledWith('suggested');
    expect(document).toEqual(home);
  });

  it('reports the verdict on a 404 before it fails', async () => {
    const heard = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{}', {
          status: 404,
          headers: { 'X-Estanza-Card-Update': 'required' },
        }),
      ),
    );

    await expect(fetchShareDocument(baseConfig, heard)).rejects.toThrow();
    expect(heard).toHaveBeenCalledWith('required');
  });

  it('hears ok when the api says nothing readable', async () => {
    const heard = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ home: { document: home } })),
        ),
    );

    await fetchShareDocument(baseConfig, heard);

    expect(heard).toHaveBeenCalledWith('ok');
  });
});

describe('the editor footer', () => {
  const OUTDATED = 'This home needs a newer Estanza card. Update it in HACS.';
  const NEWER = 'A newer Estanza card is available in HACS.';

  function hearing(update: CardUpdate): SceneDocumentLoader {
    return async (_config, heard) => {
      heard?.(update);

      return homeFixture;
    };
  }

  function text(editor: EstanzaCardEditor): string {
    return (editor.renderRoot.textContent ?? '').replace(/\s+/g, ' ');
  }

  async function loaded(
    loader: SceneDocumentLoader,
  ): Promise<EstanzaCardEditor> {
    const editor = await createEditor(baseConfig, loader);

    await vi.waitFor(() => {
      expect(
        editor.renderRoot.querySelector('.notice')?.textContent ?? '',
      ).not.toContain('Loading');
    });
    await editor.updateComplete;

    return editor;
  }

  it('shows the card version, small and quiet', async () => {
    const editor = await withHome();

    expect(find(editor, '.footer .version').textContent?.trim()).toBe(
      `Estanza card ${packageJson.version}`,
    );
  });

  it('says nothing about updates while the card is current', async () => {
    const editor = await loaded(hearing('ok'));

    expect(text(editor)).not.toContain('HACS');
  });

  it('says quietly that a newer card is available when the api suggests one', async () => {
    const editor = await loaded(hearing('suggested'));

    expect(find(editor, '.footer .newer').textContent?.trim()).toBe(NEWER);
    expect(text(editor)).not.toContain(OUTDATED);
  });

  it('says the home needs a newer card when the api requires one', async () => {
    const editor = await loaded(hearing('required'));

    expect(text(editor)).toContain(OUTDATED);
    expect(editor.renderRoot.querySelector('.footer .newer')).toBeNull();
  });

  it('says the home needs a newer card when the home is newer than the card', async () => {
    const editor = await loaded(async () => ({
      ...homeFixture,
      version: home.version + 1,
    }));

    expect(text(editor)).toContain(OUTDATED);
    expect(text(editor)).not.toContain('Could not read that home');
    expect(text(editor)).not.toContain('That home has no rooms');
  });
});

describe('shareDocumentUrl', () => {
  it('reads the share id out of a share link', () => {
    expect(shareDocumentUrl(baseConfig)).toBe(
      'https://api.estanza.casa/v1/integrations/home-assistant/abc123',
    );
  });

  it('takes a bare share id as it is', () => {
    expect(
      shareDocumentUrl({ type: cardType, share_id: 'xyz789', bindings: [] }),
    ).toBe('https://api.estanza.casa/v1/integrations/home-assistant/xyz789');
  });

  it('has no url without a share', () => {
    expect(shareDocumentUrl({ type: cardType, bindings: [] })).toBeNull();
  });
});

describe('readHomeFile', () => {
  it('reads an exported home file, bare or wrapped as the share sends it', () => {
    expect(readHomeFile(JSON.stringify(homeFixture))).toEqual(home);
    expect(
      readHomeFile(JSON.stringify({ home: { document: homeFixture } })),
    ).toEqual(home);
  });

  it('refuses a file that is not JSON or not a home', () => {
    expect(readHomeFile('not json')).toBeNull();
    expect(readHomeFile('{"hello":"world"}')).toBeNull();
  });

  it('sums a home up by its name, floors and rooms', () => {
    expect(homeSummary(home)).toEqual({
      name: 'Test Home',
      floors: 1,
      rooms: 3,
    });
  });
});

describe('the home in the editor', () => {
  it('is registered as a custom element', () => {
    expect(customElements.get('estanza-card-editor')).toBe(EstanzaCardEditor);
  });

  it('asks for a share link or a home file while there is no home', async () => {
    const editor = await createEditor({ type: cardType, bindings: [] });

    expect(find<HaForm>(editor, '.source').schema.map((e) => e.name)).toEqual([
      'share',
    ]);
    expect(text(find(editor, '.load-file'))).toBe('Load home file');
    expect(
      find<HaForm>(editor, '.card-form').schema.map((e) => e.name),
    ).toEqual(['title', 'navigation_path']);
    expect(editor.renderRoot.querySelector('estanza-plan-view')).toBeNull();
  });

  it('says walls, rooms and furniture are changed in Estanza, with a link there', async () => {
    const editor = await withHome();
    const line = find(editor, '.scope');
    const link = find<HTMLAnchorElement>(editor, '.scope a');

    expect(text(line)).toBe(
      'Walls, rooms and furniture are changed in the Estanza editor. Open Estanza',
    );
    expect(link.href).toBe('https://app.estanza.casa/projects');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener');
  });

  it('keeps the Estanza line out of the way until there is a home', async () => {
    const editor = await createEditor({ type: cardType, bindings: [] });

    expect(editor.renderRoot.querySelector('.scope')).toBeNull();
  });

  it('stores a pasted link as share_url and a pasted id as share_id', async () => {
    const editor = await createEditor({ type: cardType, bindings: [] });
    const config = captureConfig(editor);

    change(find<HaForm>(editor, '.source'), {
      share: 'https://estanza.casa/share/abc123',
    });
    expect(config().share_url).toBe('https://estanza.casa/share/abc123');
    expect(config().share_id).toBeUndefined();

    await editor.updateComplete;
    editor.setConfig({ type: cardType, bindings: [] });
    await editor.updateComplete;
    change(find<HaForm>(editor, '.source'), { share: 'abc123' });
    expect(config().share_id).toBe('abc123');
    expect(config().share_url).toBeUndefined();
  });

  it('sums up a loaded home in one line and never shows its JSON', async () => {
    const editor = await withHome();
    const line = text(find(editor, '.home-line'));

    expect(line).toContain('Test Home');
    expect(line).toContain('1 floor · 3 rooms');
    expect(line).toContain('Replace');
    expect(line).toContain('Remove');
    expect(editor.renderRoot.querySelector('textarea')).toBeNull();
    expect(editor.renderRoot.querySelector('.source')).toBeNull();
    expect(editor.renderRoot.textContent).not.toContain('"walls"');
  });

  it('loads a home file into the config and shows its summary', async () => {
    const editor = await createEditor({ type: cardType, bindings: [] });
    const config = captureConfig(editor);

    await loadFile(editor, JSON.stringify(homeFixture));

    expect(config().home_document).toEqual(home);
    expect(config().share_url).toBeUndefined();

    await vi.waitFor(() => {
      expect(editor.documentLoaded).toBe(true);
    });
    await editor.updateComplete;

    expect(text(find(editor, '.home-line'))).toContain('Test Home');
  });

  it('says so and keeps no document when the file is not a home', async () => {
    const editor = await createEditor({ type: cardType, bindings: [] });
    const seen = vi.fn();

    editor.addEventListener('config-changed', seen);
    await loadFile(editor, '{"hello":"world"}');

    expect(seen).not.toHaveBeenCalled();
    expect(text(find(editor, '.notice.error'))).toBe(notHomeFile);
    expect(editor.documentLoaded).toBe(false);
  });

  it('offers the link and the file again on Replace, and keeps the home on Cancel', async () => {
    const editor = await withHome();

    await click(editor, find(editor, '.replace'));

    expect(find<HaForm>(editor, '.source').data.share).toBe(
      baseConfig.share_url,
    );

    await click(editor, find(editor, '.cancel'));

    expect(text(find(editor, '.home-line'))).toContain('Test Home');
  });

  it('offers Replace and Remove as two separate buttons of its own, only Remove destructive', async () => {
    const editor = await withHome();
    const actions = all(editor, '.home-actions > *');

    expect(actions.map((action) => action.tagName)).toEqual([
      'BUTTON',
      'BUTTON',
    ]);
    expect(actions.map(text)).toEqual(['Replace', 'Remove']);
    expect(find(editor, '.remove').classList).toContain('danger');
    expect(find(editor, '.replace').classList).not.toContain('danger');
  });

  it('renders none of Home Assistant’s internal buttons or icons', async () => {
    const editor = await withHome({
      ...baseConfig,
      bindings: [
        { scope: { type: 'door', id: 'd1' }, entity_id: 'binary_sensor.gone' },
        {
          scope: { type: 'light', id: 'hall-light' },
          entity_id: 'light.hall_spots',
        },
      ],
    });

    await click(editor, find(editor, '.link-all'));
    await tapInPreview(editor, { type: 'light', id: 'hall-light' });

    const internal = editor.renderRoot.querySelectorAll(
      'ha-button, ha-icon-button, ha-state-icon',
    );

    expect(internal).toHaveLength(0);
  });

  it('asks before removing the home, and Cancel keeps it', async () => {
    const editor = await withHome();
    const seen = vi.fn();
    const name = text(find(editor, '.home-name'));

    editor.addEventListener('config-changed', seen);
    await click(editor, find(editor, '.remove'));

    expect(text(find(editor, '.confirm-remove .confirm-text'))).toBe(
      `Remove ${name} from this card? Your links will be lost.`,
    );
    expect(editor.renderRoot.querySelector('.home-actions')).toBeNull();

    await click(editor, find(editor, '.confirm-remove .cancel-remove'));

    expect(all(editor, '.home-actions button').map(text)).toEqual([
      'Replace',
      'Remove',
    ]);

    expect(seen).not.toHaveBeenCalled();
    expect(editor.renderRoot.querySelector('.confirm-remove')).toBeNull();
    expect(editor.documentLoaded).toBe(true);
  });

  it('removes the home and its links once confirmed, and Undo puts both back', async () => {
    const bindings: SceneBinding[] = [
      { scope: { type: 'room', id: 'hall' }, area_id: 'hall_1' },
    ];
    const editor = await withHome({ ...baseConfig, bindings });
    const config = captureConfig(editor);
    const name = text(find(editor, '.home-name'));

    await click(editor, find(editor, '.remove'));
    await click(editor, find(editor, '.confirm-remove .confirm-remove-yes'));

    expect(config().share_url).toBeUndefined();
    expect(config().home_document).toBeUndefined();
    expect(config().bindings).toEqual([]);
    expect(editor.documentLoaded).toBe(false);
    expect(text(find(editor, '.toast .toast-text'))).toBe(`Removed ${name}.`);

    await click(editor, find(editor, '.toast .toast-undo'));

    expect(config().share_url).toBe(baseConfig.share_url);
    expect(config().bindings).toEqual(bindings);

    await vi.waitFor(() => {
      expect(editor.documentLoaded).toBe(true);
    });
  });

  it('reads the home again when retry is pressed', async () => {
    const loader = vi
      .fn<SceneDocumentLoader>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(homeFixture);
    const editor = await createEditor(baseConfig, loader);

    await vi.waitFor(() => {
      expect(editor.renderRoot.textContent).toContain('Could not read');
    });
    await editor.updateComplete;
    await click(editor, find(editor, '.retry'));

    await vi.waitFor(() => {
      expect(editor.documentLoaded).toBe(true);
    });
  });

  it('stores the view a tile opens, and drops it when cleared', async () => {
    const editor = await createEditor(baseConfig, failToLoad);
    const config = captureConfig(editor);
    const form = find<HaForm>(editor, '.card-form');

    change(form, { navigation_path: '/lovelace/home' });
    expect(config().navigation_path).toBe('/lovelace/home');

    change(form, { navigation_path: '' });
    expect(config().navigation_path).toBeUndefined();
  });
});

describe('the night source in the editor', () => {
  function nightButtons(editor: EstanzaCardEditor): HTMLElement[] {
    return all(editor, '.night-source button');
  }

  it('offers Auto, Day and Night as three icon buttons named only for assistive tech', async () => {
    const editor = await createEditor(baseConfig, failToLoad);
    const group = find(editor, '.night-source');
    const buttons = nightButtons(editor);

    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Day and night in 3D');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Auto',
      'Day',
      'Night',
    ]);

    for (const button of buttons) {
      expect(text(button)).toBe('');
      expect(button.querySelector('svg')).not.toBeNull();
      expect(button.hasAttribute('title')).toBe(false);
    }
  });

  it('draws Auto as the sun on the horizon, Day as a plain sun and Night as a moon', async () => {
    const editor = await createEditor(baseConfig, failToLoad);
    const drawn = (name: IconName): string => {
      const box = document.createElement('div');

      render(icon(name), box);

      return box.querySelector('svg')?.innerHTML ?? '';
    };

    expect(
      nightButtons(editor).map(
        (button) => button.querySelector('svg')?.innerHTML,
      ),
    ).toEqual([drawn('sunset'), drawn('sun'), drawn('moon')]);
  });

  it('marks Auto as chosen when the config names no night source', async () => {
    const editor = await createEditor(baseConfig, failToLoad);

    expect(
      nightButtons(editor).map((button) => button.getAttribute('aria-pressed')),
    ).toEqual(['true', 'false', 'false']);
  });

  it('marks the night source the config names', async () => {
    const editor = await createEditor(
      { ...baseConfig, night: 'night' },
      failToLoad,
    );

    expect(
      nightButtons(editor).map((button) => button.getAttribute('aria-pressed')),
    ).toEqual(['false', 'false', 'true']);
  });

  it('stores day and night, and drops the key for the default auto', async () => {
    const editor = await createEditor(baseConfig, failToLoad);
    const config = captureConfig(editor);
    const [auto, day, night] = nightButtons(editor);

    await click(editor, day);
    expect(config().night).toBe('day');
    expect(day.getAttribute('aria-pressed')).toBe('true');

    await click(editor, night);
    expect(config().night).toBe('night');

    await click(editor, auto);
    expect(config().night).toBeUndefined();
  });

  it('keeps the night source when the title changes', async () => {
    const editor = await createEditor(
      { ...baseConfig, night: 'day' },
      failToLoad,
    );
    const config = captureConfig(editor);

    change(find<HaForm>(editor, '.card-form'), { title: 'Home' });

    expect(config().night).toBe('day');
  });
});

describe('the quality in the editor', () => {
  function qualityButtons(editor: EstanzaCardEditor): HTMLElement[] {
    return all(editor, '.quality button');
  }

  function pressed(editor: EstanzaCardEditor): (string | null)[] {
    return qualityButtons(editor).map((button) =>
      button.getAttribute('aria-pressed'),
    );
  }

  it('offers Auto and every named tier as icon buttons named only for assistive tech', async () => {
    const editor = await createEditor(baseConfig, failToLoad);
    const group = find(editor, '.quality');
    const buttons = qualityButtons(editor);

    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Quality');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Auto',
      'Saver',
      'Balanced',
      'Sharp',
      'Full',
    ]);

    for (const button of buttons) {
      expect(text(button)).toBe('');
      expect(button.querySelector('svg')).not.toBeNull();
    }
  });

  it('draws each tier with only its own bars, one to four, and no faint bars that vanish in dark', async () => {
    const editor = await createEditor(baseConfig, failToLoad);
    const [, ...tiers] = qualityButtons(editor);

    expect(
      tiers.map((button) => button.querySelectorAll('svg path').length),
    ).toEqual([1, 2, 3, 4]);
    expect(
      editor.renderRoot.querySelector('.quality [stroke-opacity]'),
    ).toBeNull();
  });

  it('marks Auto as chosen when the config names no quality', async () => {
    const editor = await createEditor(baseConfig, failToLoad);

    expect(pressed(editor)).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
  });

  it('marks the tier the config names', async () => {
    const editor = await createEditor(
      { ...baseConfig, quality: 'sharp' },
      failToLoad,
    );

    expect(pressed(editor)).toEqual([
      'false',
      'false',
      'false',
      'true',
      'false',
    ]);
  });

  it('stores a picked tier, and drops the key for Auto', async () => {
    const editor = await createEditor(baseConfig, failToLoad);
    const config = captureConfig(editor);
    const [auto, saver, , , full] = qualityButtons(editor);

    await click(editor, saver);
    expect(config().quality).toBe('saver');
    expect(saver.getAttribute('aria-pressed')).toBe('true');

    await click(editor, full);
    expect(config().quality).toBe('full');

    await click(editor, auto);
    expect(config().quality).toBeUndefined();
  });

  it('round-trips a picked tier through the card config', async () => {
    const editor = await createEditor(baseConfig, failToLoad);
    const config = captureConfig(editor);
    const [, , balanced] = qualityButtons(editor);

    await click(editor, balanced);

    const saved = parseCardConfig(config());
    const reopened = await createEditor(saved, failToLoad);

    expect(saved.quality).toBe('balanced');
    expect(pressed(reopened)).toEqual([
      'false',
      'false',
      'true',
      'false',
      'false',
    ]);
  });

  it('keeps the quality when the title changes', async () => {
    const editor = await createEditor(
      { ...baseConfig, quality: 'saver' },
      failToLoad,
    );
    const config = captureConfig(editor);

    change(find<HaForm>(editor, '.card-form'), { title: 'Home' });

    expect(config().quality).toBe('saver');
  });
});

describe('the other floors in the editor', () => {
  function modeButtons(editor: EstanzaCardEditor): HTMLElement[] {
    return all(editor, '.other-floors button');
  }

  it('offers Ghosted and Hidden as icon buttons named only for assistive tech', async () => {
    const editor = await createEditor(baseConfig, failToLoad);
    const group = find(editor, '.other-floors');
    const buttons = modeButtons(editor);

    expect(group.getAttribute('aria-label')).toBe('Other floors');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Ghosted',
      'Hidden',
    ]);
    expect(buttons.map((button) => text(button))).toEqual(['', '']);
    expect(
      buttons.map((button) => button.getAttribute('aria-pressed')),
    ).toEqual(['true', 'false']);
  });

  it('stores Hidden, and drops the key for Ghosted', async () => {
    const editor = await createEditor(baseConfig, failToLoad);
    const config = captureConfig(editor);
    const [ghosted, hidden] = modeButtons(editor);

    await click(editor, hidden);
    expect(parseCardConfig(config()).other_floors).toBe('hidden');
    expect(hidden.getAttribute('aria-pressed')).toBe('true');

    await click(editor, ghosted);
    expect(config().other_floors).toBeUndefined();
  });

  it('is not offered for a home with one floor', async () => {
    const editor = await withHome();

    expect(modeButtons(editor)).toEqual([]);
  });
});

describe('linking from the preview', () => {
  it('draws the home as the picker, with every thing tappable', async () => {
    const editor = await withHome();
    const plan = find<EstanzaPlanView>(editor, 'estanza-plan-view');

    expect(plan.home).toEqual(home);
    expect(plan.targets.map((scope) => `${scope.type}:${scope.id}`)).toEqual([
      'room:living-space',
      'room:bathroom',
      'room:hall',
      'light:living-space-light',
      'light:bathroom-light',
      'light:hall-light',
      'door:d1',
      'door:d2',
    ]);
  });

  it('names rooms on its plan the way the card does, clear of the things marked on it', async () => {
    const editor = await withHome();
    const plan = find<EstanzaPlanView>(editor, 'estanza-plan-view');

    expect(plan.glyphs.map(({ scope }) => `${scope.type}:${scope.id}`)).toEqual(
      plan.targets
        .filter((scope) => scope.type !== 'room')
        .map((scope) => `${scope.type}:${scope.id}`),
    );
    expect(
      plan.glyphs.every(({ nudge }) => nudge.x === 0 && nudge.y === 0),
    ).toBe(true);
  });

  it('opens a picker titled with the thing a tap lands on, and points the card at it', async () => {
    const editor = await withHome();
    const seen: (SceneScope | null)[] = [];
    const listen = (event: Event) =>
      seen.push((event as CustomEvent<HighlightDetail>).detail.scope);

    window.addEventListener(highlightEvent, listen);
    await tapInPreview(editor, { type: 'light', id: 'hall-light' });
    await click(editor, find(editor, '.picker .close'));
    window.removeEventListener(highlightEvent, listen);

    expect(seen).toEqual([{ type: 'light', id: 'hall-light' }, null]);
    expect(editor.renderRoot.querySelector('.picker')).toBeNull();
  });

  it('lists only what fits a light, the best first, under its own Home Assistant name, with area and state', async () => {
    const editor = await withHome();

    await tapInPreview(editor, { type: 'light', id: 'hall-light' });

    expect(text(find(editor, '.picker .picker-title'))).toBe(
      'Hall light Light · Hall',
    );
    expect(candidateIds(editor)[0]).toBe('light.hall_spots');
    expect([...candidateIds(editor)].sort()).toEqual([
      'light.ceiling',
      'light.hall_spots',
      'light.living_space_light',
    ]);

    const row = candidate(editor, 'light.hall_spots');

    expect(text(row.querySelector('.c-name'))).toBe('Hall spots');
    expect(row.title).toBe('Hall spots');
    expect(text(row.querySelector('.c-area'))).toBe('Hall 1');
    expect(text(row.querySelector('.c-state'))).toBe('On');
  });

  it('reads a linked door in Home Assistant words, never as off', async () => {
    const door: SceneScope = { type: 'door', id: 'd1' };
    const bindings = [
      { scope: door, entity_id: 'binary_sensor.bathroom_door' },
    ];
    const plain = await withHome({ ...baseConfig, bindings });
    const chip = '.thing.linked[data-key="door:d1"] .link-state';

    expect(text(find(plain, chip))).toBe('Closed');

    const hass = editorHass();

    hass.formatEntityState = (state) =>
      state.state === 'off' ? 'Cerrada' : '';

    const translated = await withHome({ ...baseConfig, bindings }, hass);

    expect(text(find(translated, chip))).toBe('Cerrada');
  });

  it('lists only room sensors for a room, and the room area picker in the picker', async () => {
    const editor = await withHome();

    await tapInPreview(editor, { type: 'room', id: 'hall' });

    expect([...candidateIds(editor)].sort()).toEqual([
      'sensor.garage_humidity',
      'sensor.th_7_temperature',
    ]);
    expect(find<HaForm>(editor, '.picker .area').schema[0].name).toBe(
      'area_id',
    );
  });

  it('reads a humidity sensor in the picker as a whole percent with no space', async () => {
    const hass = editorHass();

    hass.formatEntityState = (state) => `${Number(state.state).toFixed(1)}%`;

    const editor = await withHome(baseConfig, hass);

    await tapInPreview(editor, { type: 'room', id: 'hall' });

    expect(
      text(
        candidate(editor, 'sensor.garage_humidity').querySelector('.c-state'),
      ),
    ).toBe('52%');
  });

  it('links a light with one tap, closes the picker and lists it with its state', async () => {
    const editor = await withHome();
    const config = captureConfig(editor);

    await tapInPreview(editor, { type: 'light', id: 'hall-light' });
    await click(editor, candidate(editor, 'light.hall_spots'));

    expect(config().bindings).toEqual([
      {
        scope: { type: 'light', id: 'hall-light' },
        entity_id: 'light.hall_spots',
      },
    ]);
    expect(editor.renderRoot.querySelector('.picker')).toBeNull();

    const row = find(editor, '.thing.linked[data-key="light:hall-light"]');

    expect(text(row.querySelector('.thing-name'))).toBe('Hall light');
    expect(text(row.querySelector('.link-role'))).toBe('Light');
    expect(text(row.querySelector('.link-state'))).toBe('On');
    expect(text(row.querySelector('.link-name'))).toBe('Hall spots');
  });

  it('lists what a thing already has first in its picker, and a tap there unlinks it', async () => {
    const hallLight: SceneScope = { type: 'light', id: 'hall-light' };
    const editor = await withHome({
      ...baseConfig,
      bindings: [{ scope: hallLight, entity_id: 'binary_sensor.hall_motion' }],
    });
    const config = captureConfig(editor);

    await tapInPreview(editor, hallLight);

    const first = all(editor, '.picker .candidate')[0];

    expect(first.dataset.entity).toBe('binary_sensor.hall_motion');
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(first.querySelector('.c-check svg')).not.toBeNull();
    expect(all(editor, '.picker .picker-group').map(text)).toEqual([
      'Linked',
      'Suggested',
    ]);

    await click(editor, first);

    expect(config().bindings).toEqual([]);
  });

  it('says a picker has no close matches instead of passing strangers off as suggestions', async () => {
    const hass = createMockHass({
      states: [
        {
          ...mockSensor('sensor.porch_temperature', 'temperature', 12, '°C'),
          attributes: {
            device_class: 'temperature',
            unit_of_measurement: '°C',
            friendly_name: 'Porch Sensor W - A Temperature',
          },
        },
      ],
    });
    const editor = await withHome(baseConfig, hass);

    await tapInPreview(editor, { type: 'room', id: 'hall' });

    expect(all(editor, '.picker .picker-group').map(text)).toEqual([
      'No close matches',
    ]);
    expect(candidateIds(editor)).toEqual(['sensor.porch_temperature']);
  });

  it('asks nothing about taps until a thing is linked', async () => {
    const editor = await withHome();

    await tapInPreview(editor, { type: 'light', id: 'hall-light' });

    expect(editor.renderRoot.querySelector('.picker .actions')).toBeNull();
  });

  it('offers a linked light its tap and hold choices, today’s defaults chosen', async () => {
    const hallLight: SceneScope = { type: 'light', id: 'hall-light' };
    const editor = await withHome({
      ...baseConfig,
      bindings: [{ scope: hallLight, entity_id: 'light.hall_spots' }],
    });

    await tapInPreview(editor, hallLight);

    const form = find<HaForm>(editor, '.picker .actions ha-form');
    const options = (name: string) =>
      (
        form.schema.find((entry) => entry.name === name)?.selector.select as {
          options: { value: string; label: string }[];
        }
      ).options;

    expect(form.data).toEqual({ tap_action: 'toggle', hold_action: 'sheet' });
    expect(options('tap_action').map((option) => option.label)).toEqual([
      'Turn on or off (default)',
      'Show details',
      'Nothing',
    ]);
    expect(options('hold_action').map((option) => option.label)).toEqual([
      'Show controls (default)',
      'Turn on or off',
      'Show details',
      'Nothing',
    ]);
    expect(form.computeLabel?.(form.schema[0])).toBe('On tap');
    expect(editor.renderRoot.querySelector('.picker .no-toggle')).toBeNull();
  });

  it('writes a chosen hold in Home Assistant’s shape, and drops it when set back to the default', async () => {
    const hallLight: SceneScope = { type: 'light', id: 'hall-light' };
    const editor = await withHome({
      ...baseConfig,
      bindings: [{ scope: hallLight, entity_id: 'light.hall_spots' }],
    });
    const config = captureConfig(editor);

    await tapInPreview(editor, hallLight);
    change(find<HaForm>(editor, '.picker .actions ha-form'), {
      hold_action: 'more-info',
    });

    expect(config().bindings).toEqual([
      {
        scope: hallLight,
        entity_id: 'light.hall_spots',
        hold_action: { action: 'more-info' },
      },
    ]);

    await editor.updateComplete;
    change(find<HaForm>(editor, '.picker .actions ha-form'), {
      hold_action: 'sheet',
    });

    expect(config().bindings).toEqual([
      { scope: hallLight, entity_id: 'light.hall_spots' },
    ]);
  });

  it('offers a door cover open and close, and writes them as cover services', async () => {
    const hass = editorHass();
    const door: SceneScope = { type: 'door', id: 'd1' };

    hass.states = {
      ...hass.states,
      'cover.porch': mockEntityState('cover.porch', 'closed', {
        device_class: 'door',
        friendly_name: 'Porch door',
      }),
    };

    const editor = await withHome(
      { ...baseConfig, bindings: [{ scope: door, entity_id: 'cover.porch' }] },
      hass,
    );
    const config = captureConfig(editor);

    await tapInPreview(editor, door);

    const form = find<HaForm>(editor, '.picker .actions ha-form');
    const tap = form.schema[0].selector.select as {
      options: { value: string }[];
    };

    expect(tap.options.map((option) => option.value)).toEqual([
      'toggle',
      'open',
      'close',
      'more-info',
      'none',
    ]);

    change(form, { tap_action: 'open' });

    expect(config().bindings[0].tap_action).toEqual({
      action: 'perform-action',
      perform_action: 'cover.open_cover',
    });
  });

  it('says in one line why a door with only a sensor has no toggle', async () => {
    const door: SceneScope = { type: 'door', id: 'd1' };
    const editor = await withHome({
      ...baseConfig,
      bindings: [{ scope: door, entity_id: 'binary_sensor.bathroom_door' }],
    });

    await tapInPreview(editor, door);

    const form = find<HaForm>(editor, '.picker .actions ha-form');
    const tap = form.schema[0].selector.select as {
      options: { value: string }[];
    };

    expect(text(find(editor, '.picker .no-toggle'))).toBe(
      'A sensor only reports this door, so a tap cannot open or lock it.',
    );
    expect(tap.options.map((option) => option.value)).toEqual([
      'none',
      'more-info',
    ]);
  });

  it('opens the plan on the floor that holds the links, not an empty ground floor', async () => {
    const editor = await createEditor(
      {
        ...baseConfig,
        bindings: [
          {
            scope: { type: 'room', id: 'guest-room' },
            entity_id: 'sensor.th_7_temperature',
          },
        ],
      },
      async () => aurora,
    );

    await vi.waitFor(() => {
      expect(editor.documentLoaded).toBe(true);
    });
    await editor.updateComplete;

    expect(text(find(editor, '.floor-chip[aria-pressed="true"]'))).toBe(
      'First floor',
    );
  });

  it('opens the plan on the floor the card is showing', async () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    localStorage.setItem(
      `estanza-card.floor:${location.pathname}|abc123`,
      JSON.stringify('f3'),
    );

    const editor = await createEditor(baseConfig, async () => aurora);

    await vi.waitFor(() => {
      expect(editor.documentLoaded).toBe(true);
    });
    await editor.updateComplete;

    expect(text(find(editor, '.floor-chip[aria-pressed="true"]'))).toBe(
      'Basement',
    );
  });

  it('lists only the things of the floor its chip shows, and follows the chip', async () => {
    const stray: SceneBinding = {
      scope: { type: 'light', id: 'old-lamp' },
      entity_id: 'light.a',
    };
    const editor = await createEditor(
      {
        ...baseConfig,
        bindings: [
          {
            scope: { type: 'room', id: 'guest-room' },
            entity_id: 'sensor.th_7_temperature',
          },
          stray,
        ],
      },
      async () => aurora,
    );

    await vi.waitFor(() => {
      expect(editor.documentLoaded).toBe(true);
    });
    await editor.updateComplete;

    const floorOf = new Map(
      editor.things.map((thing) => [thing.key, thing.floor]),
    );
    const listed = (): (string | null | undefined)[] =>
      all(editor, '.thing').map((row) => floorOf.get(row.dataset.key ?? ''));
    const chip = (name: string): HTMLElement => {
      const found = all(editor, '.floor-chip').find((c) => text(c) === name);

      if (!found) throw new Error(`no ${name} chip`);

      return found;
    };
    const showAll = async (): Promise<void> => {
      const more = editor.renderRoot.querySelector<HTMLElement>('.more-open');

      if (more) await click(editor, more);
    };
    const first = editor.things.find(
      (thing) => thing.key === 'room:guest-room',
    );

    await showAll();

    expect(new Set(listed())).toEqual(new Set([first?.floor, null]));
    expect(all(editor, '.list .overline').map(text)).not.toContain(
      'First floor',
    );

    await click(editor, chip('Ground floor'));
    await showAll();

    const ground = listed();

    expect(ground.length).toBeGreaterThan(1);
    expect(new Set(ground)).toEqual(
      new Set([
        editor.things.find((t) => t.key === 'room:kitchen')?.floor,
        null,
      ]),
    );
    expect(
      editor.renderRoot.querySelector('.thing[data-key="light:old-lamp"]'),
    ).not.toBeNull();
  });

  it('lists a storage room after the real rooms', async () => {
    const withPantry = structuredClone(homeFixture);

    withPantry.rooms.room1.label = 'Pantry';

    const editor = await createEditor(
      baseConfig,
      async () => withPantry,
      createMockHass(),
    );

    await vi.waitFor(() => {
      expect(editor.documentLoaded).toBe(true);
    });
    await editor.updateComplete;
    await click(editor, find(editor, '.more-open'));

    const roomOf = new Map(
      editor.things.map((thing) => [thing.key, thing.room]),
    );
    const keys = all(editor, '.thing.open').map((row) => row.dataset.key ?? '');
    const pantry = keys.indexOf('room:living-space');
    const elsewhere = keys.filter(
      (key) => roomOf.get(key) && roomOf.get(key) !== 'living-space',
    );

    expect(pantry).toBeGreaterThan(-1);
    expect(elsewhere.length).toBeGreaterThan(0);
    expect(elsewhere.every((key) => keys.indexOf(key) < pantry)).toBe(true);
  });

  it('names a contact after the door it is linked to, whatever its class', async () => {
    const hass = editorHass();

    hass.states = {
      ...hass.states,
      'binary_sensor.contact_q': mockBinarySensor(
        'binary_sensor.contact_q',
        'window',
        true,
      ),
    };

    const editor = await withHome(
      {
        ...baseConfig,
        bindings: [
          {
            scope: { type: 'door', id: 'd1' },
            entity_id: 'binary_sensor.contact_q',
          },
        ],
      },
      hass,
    );
    const row = find(editor, '.thing.linked[data-key="door:d1"]');

    expect(text(row.querySelector('.link .link-role'))).toBe('Door');
  });

  it('keeps a room picker open, and a second tap on an entity unlinks it', async () => {
    const editor = await withHome();
    const config = captureConfig(editor);
    const hall: SceneScope = { type: 'room', id: 'hall' };

    await tapInPreview(editor, hall);
    await click(editor, candidate(editor, 'sensor.th_7_temperature'));
    await click(editor, candidate(editor, 'sensor.garage_humidity'));

    expect(config().bindings).toEqual([
      {
        scope: hall,
        entity_ids: ['sensor.th_7_temperature', 'sensor.garage_humidity'],
      },
    ]);
    expect(
      candidate(editor, 'sensor.th_7_temperature').getAttribute('aria-pressed'),
    ).toBe('true');

    await click(editor, candidate(editor, 'sensor.th_7_temperature'));

    expect(config().bindings).toEqual([
      { scope: hall, entity_id: 'sensor.garage_humidity' },
    ]);
  });

  it('writes the area picked for a room', async () => {
    const editor = await withHome();
    const config = captureConfig(editor);

    await tapInPreview(editor, { type: 'room', id: 'hall' });
    change(find<HaForm>(editor, '.picker .area'), { area_id: 'hall_2' });

    expect(config().bindings).toEqual([
      { scope: { type: 'room', id: 'hall' }, area_id: 'hall_2' },
    ]);
  });

  it('links any other entity from the entity picker', async () => {
    const editor = await withHome();
    const config = captureConfig(editor);

    await tapInPreview(editor, { type: 'door', id: 'd2' });
    change(find<HaForm>(editor, '.picker .other'), {
      other_entity: 'binary_sensor.hall_motion',
    });

    expect(config().bindings).toEqual([
      {
        scope: { type: 'door', id: 'd2' },
        entity_id: 'binary_sensor.hall_motion',
      },
    ]);
  });

  it('unlinks a thing with its ✕ and reopens the picker when its row is tapped', async () => {
    const bindings: SceneBinding[] = [
      {
        scope: { type: 'light', id: 'hall-light' },
        entity_id: 'light.hall_spots',
      },
      { scope: { type: 'door', id: 'd1' }, entity_id: 'binary_sensor.x' },
    ];
    const editor = await withHome({ ...baseConfig, bindings });
    const config = captureConfig(editor);

    await click(
      editor,
      find(editor, '.thing.linked[data-key="light:hall-light"] .thing-main'),
    );

    expect(text(find(editor, '.picker .name'))).toBe('Hall light');
    expect(
      candidate(editor, 'light.hall_spots').getAttribute('aria-pressed'),
    ).toBe('true');

    await click(
      editor,
      find(editor, '.thing.linked[data-key="light:hall-light"] .unlink'),
    );

    expect(config().bindings).toEqual([bindings[1]]);
    expect(editor.renderRoot.querySelector('.picker')).toBeNull();
  });

  it('opens the picker from a tap anywhere on a linked row, not only on its name', async () => {
    const editor = await withHome({
      ...baseConfig,
      bindings: [{ scope: { type: 'room', id: 'hall' }, area_id: 'hall_1' }],
    });

    await click(
      editor,
      find(editor, '.thing.linked[data-key="room:hall"] .link.area'),
    );

    expect(text(find(editor, '.picker .name'))).toBe('Hall');
  });

  it('leaves the picker shut when the tap on a linked row is its area link', async () => {
    const editor = await withHome({
      ...baseConfig,
      bindings: [{ scope: { type: 'room', id: 'hall' }, area_id: 'hall_1' }],
    });
    const link = find(
      editor,
      '.thing.linked[data-key="room:hall"] .link.area a',
    );

    link.addEventListener('click', (event) => event.preventDefault());
    await click(editor, link);

    expect(editor.renderRoot.querySelector('.picker')).toBeNull();
  });

  it('marks a missing entity in its chip', async () => {
    const editor = await withHome({
      ...baseConfig,
      bindings: [
        { scope: { type: 'door', id: 'd1' }, entity_id: 'binary_sensor.gone' },
      ],
    });

    expect(
      find(editor, '.link[data-entity="binary_sensor.gone"]').classList,
    ).toContain('missing');
  });

  it('groups linked things under their room', async () => {
    const editor = await withHome({
      ...baseConfig,
      bindings: [
        { scope: { type: 'room', id: 'hall' }, area_id: 'hall_1' },
        { scope: { type: 'light', id: 'hall-light' }, entity_id: 'light.a' },
        { scope: { type: 'door', id: 'd1' }, entity_id: 'binary_sensor.x' },
      ],
    });

    expect(all(editor, '.room-title').map(text)).toEqual(['Living Space']);
    expect(all(editor, '.thing.linked').map((row) => row.dataset.key)).toEqual([
      'door:d1',
      'room:hall',
      'light:hall-light',
    ]);
    expect(
      text(find(editor, '.thing[data-key="room:hall"] .link.area .link-text')),
    ).toBe('From the Hall 1 area in Home Assistant');
  });

  it('opens the picker for a thing tapped in the card preview', async () => {
    const editor = await withHome();

    window.dispatchEvent(
      new CustomEvent<PickDetail>(pickEvent, {
        detail: { scope: { type: 'door', id: 'd1' } },
      }),
    );
    await editor.updateComplete;

    expect(text(find(editor, '.picker .name'))).toBe(
      'Door between Living Space and Bathroom',
    );
    expect(candidateIds(editor)).toEqual(['binary_sensor.bathroom_door']);
  });

  const spread = (scope: SceneScope): { x: number; y: number } => {
    const order = [
      'living-space-light',
      'bathroom-light',
      'hall-light',
      'd1',
      'd2',
    ];

    return { x: 40 + 60 * order.indexOf(scope.id), y: 50 };
  };

  const targetOf = (mark: HTMLElement) => {
    const [, x, y] =
      /translate\(([-\d.]+) ([-\d.]+)\)/.exec(
        mark.getAttribute('transform') ?? '',
      ) ?? [];
    const radius = Number(mark.querySelector('circle')?.getAttribute('r'));

    return {
      key: mark.dataset.key ?? '',
      x: Number(x),
      y: Number(y),
      width: 2 * radius,
      height: 2 * radius,
    };
  };

  it('marks every thing but the rooms with a clear target, filled once linked, and outlines the one being linked', async () => {
    const editor = await withHome({
      ...baseConfig,
      bindings: [
        { scope: { type: 'light', id: 'hall-light' }, entity_id: 'light.a' },
        { scope: { type: 'room', id: 'bathroom' }, area_id: 'bano' },
      ],
    });
    const plan = find<EstanzaPlanView>(editor, 'estanza-plan-view');

    plan.anchorOf = spread;
    plan.outlineOf = () => ({ fill: 'M0,0L9,0L9,9Z', edge: 'M0,0L9,0L9,9Z' });
    plan.dispatchEvent(new Event('view-change'));
    await editor.updateComplete;

    const marks = all(editor, '.marks .target').map(targetOf);

    expect(
      all(editor, '.marks .target.linked').map((mark) => mark.dataset.key),
    ).toEqual(['light:hall-light']);
    expect(
      all(editor, '.marks .target.open').map((mark) => mark.dataset.key),
    ).toEqual([
      'light:living-space-light',
      'light:bathroom-light',
      'door:d1',
      'door:d2',
    ]);
    expect(marks.every((mark) => mark.width >= 24)).toBe(true);
    expect(
      all(editor, '.marks .target.open').every((mark) =>
        mark.querySelector('svg'),
      ),
    ).toBe(true);
    expect(all(editor, '.marks .badge-mark')).toEqual([]);

    await tapInPreview(editor, { type: 'room', id: 'hall' });

    expect(find(editor, '.marks .outline').getAttribute('d')).toBe(
      'M0,0L9,0L9,9Z',
    );

    await tapInPreview(editor, { type: 'door', id: 'd2' });

    expect(editor.renderRoot.querySelector('.marks .ring')).not.toBeNull();
  });

  async function onAPhone(): Promise<EstanzaCardEditor> {
    const editor = await withHome({
      ...baseConfig,
      bindings: [
        { scope: { type: 'room', id: 'bathroom' }, area_id: 'bano' },
        { scope: { type: 'door', id: 'd1' }, entity_id: 'binary_sensor.a' },
      ],
    });
    const plan = find<EstanzaPlanView>(editor, 'estanza-plan-view');

    plan.anchorOf = (scope) =>
      scope.type === 'door' ? { x: 40, y: 50 } : { x: 120, y: 60 };
    Object.defineProperty(plan, 'clientWidth', { value: 340 });
    plan.dispatchEvent(new Event('view-change'));
    await editor.updateComplete;

    return editor;
  }

  const checked = (editor: EstanzaCardEditor): string[] =>
    all(editor, '.marks .badge-mark').map((mark) => mark.dataset.key ?? '');

  const filled = (editor: EstanzaCardEditor): string[] =>
    all(editor, '.marks .target.linked').map((mark) => mark.dataset.key ?? '');

  it('keeps every target full size, with no checks, on a preview as narrow as a phone', async () => {
    const editor = await onAPhone();

    expect(checked(editor)).toEqual([]);
    expect(filled(editor)).toEqual(['door:d1']);
    expect(
      all(editor, '.marks .target')
        .map(targetOf)
        .every((mark) => mark.width >= 24),
    ).toBe(true);
  });

  it('checks only the linked thing that is selected on a phone', async () => {
    const editor = await onAPhone();

    await tapInPreview(editor, { type: 'door', id: 'd1' });

    expect(checked(editor)).toEqual(['door:d1']);
    expect(filled(editor)).toEqual([]);
  });

  it('checks the thing just linked on a phone, once its picker closes', async () => {
    const editor = await onAPhone();

    await tapInPreview(editor, { type: 'light', id: 'hall-light' });
    await click(editor, candidate(editor, 'light.hall_spots'));

    expect(editor.renderRoot.querySelector('.picker')).toBeNull();
    expect(checked(editor)).toEqual(['light:hall-light']);
    expect(filled(editor)).toEqual(['door:d1']);
  });

  it('keeps marks off each other and off the words on a crowded plan', async () => {
    const editor = await withHome({
      ...baseConfig,
      bindings: [
        { scope: { type: 'light', id: 'hall-light' }, entity_id: 'light.a' },
        { scope: { type: 'door', id: 'd1' }, entity_id: 'binary_sensor.a' },
        { scope: { type: 'room', id: 'bathroom' }, area_id: 'bano' },
      ],
    });
    const plan = find<EstanzaPlanView>(editor, 'estanza-plan-view');

    plan.anchorOf = (scope) =>
      scope.type === 'door' ? { x: 104, y: 82 } : { x: 100, y: 80 };
    const word = {
      key: 'name:bathroom',
      x: 110,
      y: 80,
      width: 90,
      height: 20,
    };

    plan.wordBoxes = () => [word];
    plan.dispatchEvent(new Event('view-change'));
    await editor.updateComplete;

    const badges = all(editor, '.marks .target').map(targetOf);

    expect(badges).toHaveLength(5);

    for (const [index, badge] of badges.entries()) {
      expect(covered(badge, [word, ...badges.slice(index + 1)])).toBe(false);
    }
  });

  it('draws a light inside its room when its spot sits on the wall, and leaves a door on its wall', async () => {
    const editor = await withHome();
    const plan = find<EstanzaPlanView>(editor, 'estanza-plan-view');
    const ring = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ];

    plan.anchorOf = (scope) =>
      scope.id === 'hall-light'
        ? { x: 0, y: 100 }
        : { x: 300 + spread(scope).x, y: 300 };
    plan.roomFootprints = (slugs) =>
      new Map(slugs.map((slug) => [slug, { floor: ring, top: ring }]));
    plan.dispatchEvent(new Event('view-change'));
    await editor.updateComplete;

    const marks = all(editor, '.marks .target').map(targetOf);
    const light = marks.find((mark) => mark.key === 'light:hall-light');
    const door = marks.find((mark) => mark.key === 'door:d1');

    expect(light?.x).toBeGreaterThanOrEqual(12);
    expect(door).toMatchObject({ x: 520, y: 300 });
  });

  it('draws each object with a glyph of its kind, so a television is not a box', async () => {
    const editor = await createEditor(baseConfig, async () => aurora);

    await vi.waitFor(() => {
      expect(editor.documentLoaded).toBe(true);
    });

    const plan = find<EstanzaPlanView>(editor, 'estanza-plan-view');
    const keys = new Map<string, number>();

    plan.anchorOf = (scope) => {
      const index = keys.get(scopeKey(scope)) ?? keys.size;

      keys.set(scopeKey(scope), index);

      return { x: 40 * (index % 20), y: 40 * Math.floor(index / 20) };
    };
    plan.dispatchEvent(new Event('view-change'));
    await editor.updateComplete;

    const glyph = (key: string): string =>
      find(editor, `.marks .target[data-key="${key}"] svg`).innerHTML;
    const drawn = (name: IconName): string => {
      const box = document.createElement('div');

      render(icon(name, 14), box);

      return box.querySelector('svg')?.innerHTML ?? '';
    };

    expect(glyph('prop:living-room-television')).toBe(drawn('tv'));
    expect(glyph('prop:living-room-television')).not.toBe(drawn('box'));
    expect(glyph('prop:kitchen-fridge')).toBe(drawn('refrigerator'));
    expect(glyph('prop:kitchen-dishwasher')).toBe(drawn('dishwasher'));
    expect(glyph('prop:washroom-washer-dryer')).toBe(drawn('washing-machine'));
    expect(
      editor.renderRoot.querySelector(
        '.marks .target[data-key="prop:living-room-tv-stand"]',
      ),
    ).toBeNull();
  });

  it('draws a door that holds a garage opener with the garage glyph, on the plan, in the list and in the picker', async () => {
    const hass = editorHass();

    hass.states['cover.garage'] = mockEntityState('cover.garage', 'closed', {
      device_class: 'garage',
      friendly_name: 'Garage door',
    });

    const editor = await withHome(
      {
        ...baseConfig,
        bindings: [
          { scope: { type: 'door', id: 'd1' }, entity_id: 'cover.garage' },
        ],
      },
      hass,
    );
    const plan = find<EstanzaPlanView>(editor, 'estanza-plan-view');
    const drawn = (name: IconName): string => {
      const box = document.createElement('div');

      render(icon(name), box);

      return box.querySelector('svg')?.innerHTML ?? '';
    };

    plan.anchorOf = (scope) => ({ x: 40 + spread(scope).x, y: 60 });
    plan.dispatchEvent(new Event('view-change'));
    await editor.updateComplete;

    const row = find(editor, '.thing.linked[data-key="door:d1"]');
    const onPlan = find(editor, '.marks .target[data-key="door:d1"] svg');

    await tapInPreview(editor, { type: 'door', id: 'd1' });

    expect(row.querySelector('.kind svg')?.innerHTML).toBe(drawn('garage'));
    expect(find(editor, '.picker .picker-head .kind svg').innerHTML).toBe(
      drawn('garage'),
    );
    expect(onPlan.innerHTML).toBe(drawn('garage'));
  });

  it('hands the plan the spot of each target it draws, so a tap lands on the mark in sight', async () => {
    const editor = await withHome({
      ...baseConfig,
      bindings: [
        { scope: { type: 'door', id: 'd1' }, entity_id: 'binary_sensor.a' },
      ],
    });
    const plan = find<EstanzaPlanView>(editor, 'estanza-plan-view');

    plan.anchorOf = () => ({ x: 40, y: 50 });
    plan.dispatchEvent(new Event('view-change'));
    await editor.updateComplete;

    const drawn = all(editor, '.marks .target')
      .map(targetOf)
      .map(({ key, x, y }) => ({ key, x, y }));

    expect(drawn).toHaveLength(5);
    expect(plan.markSpots?.shown).toEqual(drawn);
    expect(plan.markSpots?.tucked.size).toBe(0);
  });
});

describe('moving a sensor between rooms', () => {
  const hall: SceneScope = { type: 'room', id: 'hall' };
  const bathroom: SceneScope = { type: 'room', id: 'bathroom' };
  const sensor = 'sensor.th_7_temperature';

  async function heldByHall(): Promise<EstanzaCardEditor> {
    return withHome({
      ...baseConfig,
      bindings: [{ scope: hall, entity_id: sensor }],
    });
  }

  it('keeps a sensor the hall holds in the bathroom picker, marked with its place', async () => {
    const editor = await heldByHall();

    await tapInPreview(editor, bathroom);

    const row = candidate(editor, sensor);

    expect(row.getAttribute('aria-pressed')).toBe('false');
    expect(text(row.querySelector('.c-area'))).toBe('Used by Hall');
    expect(row.getAttribute('aria-label')).toContain('Move');
  });

  async function placeWhenHeldBy(scope: SceneScope): Promise<string> {
    const editor = await withHome({
      ...baseConfig,
      bindings: [{ scope, entity_id: sensor }],
    });

    await tapInPreview(editor, bathroom);

    return text(candidate(editor, sensor).querySelector('.c-area'));
  }

  it('says which thing holds an entity, a light as much as a door', async () => {
    expect(await placeWhenHeldBy({ type: 'light', id: 'hall-light' })).toBe(
      'Used by Hall light',
    );
  });

  it('names the thing when its room holds another of its kind', async () => {
    expect(await placeWhenHeldBy({ type: 'door', id: 'd2' })).toBe(
      'Used by Door between Living Space and Hall',
    );
  });

  it('names an entity a missing object holds the way the list names that object', async () => {
    const orphan: SceneScope = { type: 'prop', id: 'living-room-tv-gone' };
    const editor = await withHome({
      ...baseConfig,
      bindings: [{ scope: orphan, entity_id: sensor }],
    });
    const listed = text(
      find(
        editor,
        '.thing.linked[data-key="prop:living-room-tv-gone"]',
      ).querySelector('.thing-name'),
    );

    await tapInPreview(editor, bathroom);

    expect(listed).toMatch(/\(missing object\)$/);
    expect(text(candidate(editor, sensor).querySelector('.c-area'))).toBe(
      'Used by the missing object',
    );
  });

  it('names a missing holder by its kind when its name would repeat the entity', async () => {
    expect(await placeWhenHeldBy({ type: 'light', id: 'old-lamp' })).toBe(
      'Used by the missing light',
    );
  });

  it('never repeats the name of the entity it describes', async () => {
    const editor = await withHome({
      ...baseConfig,
      bindings: [
        {
          scope: { type: 'light', id: 'hall-spots' },
          entity_id: 'light.hall_spots',
        },
      ],
    });

    await tapInPreview(editor, { type: 'light', id: 'hall-light' });

    const place = text(
      candidate(editor, 'light.hall_spots').querySelector('.c-area'),
    );

    expect(place).toBe('Used by the missing light');
  });

  it('never names a move after the entity it moves', async () => {
    const editor = await withHome({
      ...baseConfig,
      bindings: [
        {
          scope: { type: 'light', id: 'hall-spots' },
          entity_id: 'light.hall_spots',
        },
      ],
    });

    await tapInPreview(editor, { type: 'light', id: 'hall-light' });

    expect(
      candidate(editor, 'light.hall_spots').getAttribute('aria-label'),
    ).toBe('Move Hall spots here from the missing light');
  });

  it('draws a move cue, never the add cue, on an entity another thing holds', async () => {
    const editor = await heldByHall();
    const drawn = (name: IconName): string => {
      const box = document.createElement('div');

      render(icon(name, 18), box);

      return box.querySelector('svg')?.innerHTML ?? '';
    };

    await tapInPreview(editor, bathroom);

    expect(
      candidate(editor, sensor).querySelector('.c-check svg')?.innerHTML,
    ).toBe(drawn('arrow-down-to-dot'));
  });

  it('keeps the add cue on every free row, before and after an unlink', async () => {
    const editor = await withHome();
    const drawn = (name: IconName): string => {
      const box = document.createElement('div');

      render(icon(name, 18), box);

      return box.querySelector('svg')?.innerHTML ?? '';
    };
    const cues = (): (string | undefined)[] =>
      all(editor, '.picker .candidate[aria-pressed="false"]').map(
        (row) => row.querySelector('.c-check svg')?.innerHTML,
      );

    await tapInPreview(editor, bathroom);

    expect(cues().length).toBeGreaterThan(0);
    expect(new Set(cues())).toEqual(new Set([drawn('plus')]));

    await click(editor, candidate(editor, sensor));
    await tapInPreview(editor, bathroom);
    await click(editor, candidate(editor, sensor));

    expect(candidate(editor, sensor).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(new Set(cues())).toEqual(new Set([drawn('plus')]));
  });

  it('moves it on a pick, in one step, and offers to undo', async () => {
    const editor = await heldByHall();
    const config = captureConfig(editor);

    await tapInPreview(editor, bathroom);
    await click(editor, candidate(editor, sensor));

    expect(config().bindings).toEqual([{ scope: bathroom, entity_id: sensor }]);
    expect(text(find(editor, '.toast .toast-text'))).toBe('Moved from Hall.');
    expect(text(find(editor, '.toast .toast-undo'))).toBe('Undo');
  });

  it('puts both rooms back on Undo', async () => {
    const editor = await heldByHall();
    const config = captureConfig(editor);

    await tapInPreview(editor, bathroom);
    await click(editor, candidate(editor, sensor));
    await click(editor, find(editor, '.toast .toast-undo'));

    expect(config().bindings).toEqual([{ scope: hall, entity_id: sensor }]);
    expect(editor.renderRoot.querySelector('.toast')).toBeNull();
  });

  it('keeps the offer to undo when a form only repeats what it holds', async () => {
    const editor = await heldByHall();
    const seen = vi.fn();

    await tapInPreview(editor, bathroom);
    await click(editor, candidate(editor, sensor));
    editor.addEventListener('config-changed', seen);
    change(find<HaForm>(editor, '.picker .area'), {});
    await editor.updateComplete;

    expect(seen).not.toHaveBeenCalled();
    expect(editor.renderRoot.querySelector('.toast')).not.toBeNull();
  });

  it('lets the offer to undo go after a few seconds', async () => {
    const editor = await heldByHall();

    vi.useFakeTimers();

    try {
      await tapInPreview(editor, bathroom);
      await click(editor, candidate(editor, sensor));

      expect(editor.renderRoot.querySelector('.toast')).not.toBeNull();

      vi.advanceTimersByTime(6000);
      await editor.updateComplete;

      expect(editor.renderRoot.querySelector('.toast')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves an entity picked from any other entity instead of linking it twice', async () => {
    const editor = await heldByHall();
    const config = captureConfig(editor);

    await tapInPreview(editor, bathroom);
    change(find<HaForm>(editor, '.picker .other'), { other_entity: sensor });
    await editor.updateComplete;

    expect(config().bindings).toEqual([{ scope: bathroom, entity_id: sensor }]);
    expect(text(find(editor, '.toast .toast-text'))).toBe('Moved from Hall.');
  });

  it('shows the device of every link under its kind, without a hover', async () => {
    const editor = await heldByHall();
    const link = find(editor, `.thing.linked .link[data-entity="${sensor}"]`);

    expect(text(link.querySelector('.link-role'))).toBe('Temperature');
    expect(text(link.querySelector('.link-state'))).toBe('21.4°');
    expect(text(link.querySelector('.link-name'))).toBe(
      'Sonoff Temperature and Humidity Sensor - Hall Temperature',
    );
  });

  it('says a room linked through its area where to change it', async () => {
    const editor = await withHome({
      ...baseConfig,
      bindings: [{ scope: hall, area_id: 'hall_1' }],
    });
    const area = find(editor, '.thing[data-key="room:hall"] .link.area');
    const anchor = area.querySelector('a');

    expect(text(area.querySelector('.link-text'))).toBe(
      'From the Hall 1 area in Home Assistant',
    );
    expect(anchor?.getAttribute('href')).toBe('/config/areas/area/hall_1');
  });
});

describe('replacing and adding', () => {
  const hallLight: SceneScope = { type: 'light', id: 'hall-light' };
  const frontDoor: SceneScope = { type: 'door', id: 'd1' };

  async function lampWithSpots(): Promise<EstanzaCardEditor> {
    return withHome({
      ...baseConfig,
      bindings: [{ scope: hallLight, entity_id: 'light.hall_spots' }],
    });
  }

  function otherSelector(editor: EstanzaCardEditor): unknown {
    return find<HaForm>(editor, '.picker .other').schema[0].selector;
  }

  it('swaps a linked entity for the one picked after its Replace action', async () => {
    const editor = await lampWithSpots();
    const config = captureConfig(editor);

    await tapInPreview(editor, hallLight);
    await click(
      editor,
      find(editor, '.picker .replace-entity[data-entity="light.hall_spots"]'),
    );

    expect(text(find(editor, '.picker .replacing-text'))).toBe(
      'Pick what replaces Hall spots',
    );

    await click(editor, candidate(editor, 'light.ceiling'));

    expect(config().bindings).toEqual([
      { scope: hallLight, entity_id: 'light.ceiling' },
    ]);
    expect(editor.renderRoot.querySelector('.picker .replacing')).toBeNull();
  });

  it('swaps for any other entity picked while replacing', async () => {
    const editor = await lampWithSpots();
    const config = captureConfig(editor);

    await tapInPreview(editor, hallLight);
    await click(
      editor,
      find(editor, '.picker .replace-entity[data-entity="light.hall_spots"]'),
    );
    change(find<HaForm>(editor, '.picker .other'), {
      other_entity: 'light.living_space_light',
    });

    expect(config().bindings).toEqual([
      { scope: hallLight, entity_id: 'light.living_space_light' },
    ]);
  });

  it('stops replacing on its ✕ and leaves the links as they were', async () => {
    const editor = await lampWithSpots();

    await tapInPreview(editor, hallLight);
    await click(
      editor,
      find(editor, '.picker .replace-entity[data-entity="light.hall_spots"]'),
    );
    await click(editor, find(editor, '.picker .replacing .icon-btn'));

    expect(editor.renderRoot.querySelector('.picker .replacing')).toBeNull();
    expect(
      candidate(editor, 'light.ceiling').getAttribute('aria-label'),
    ).toMatch(/^Add /);
  });

  it('adds only through a row marked to add', async () => {
    const editor = await lampWithSpots();
    const config = captureConfig(editor);

    await tapInPreview(editor, hallLight);

    const row = candidate(editor, 'light.ceiling');

    expect(row.getAttribute('aria-label')).toBe('Add Ceiling');
    expect(row.querySelector('.c-check svg')).not.toBeNull();

    await click(editor, row);

    expect(config().bindings).toEqual([
      { scope: hallLight, entity_ids: ['light.hall_spots', 'light.ceiling'] },
    ]);
  });

  it('offers any other entity only among what fits, and the rest behind Show all', async () => {
    const editor = await withHome();

    await tapInPreview(editor, frontDoor);

    expect(otherSelector(editor)).toEqual({
      entity: { filter: entityFilter('door') },
    });

    await click(editor, find(editor, '.picker .other-all'));

    expect(otherSelector(editor)).toEqual({ entity: {} });
    expect(editor.renderRoot.querySelector('.picker .other-all')).toBeNull();
  });

  it('builds a new entity picker whenever its filter changes, so Home Assistant cannot keep the last list', async () => {
    const editor = await withHome();
    const otherForm = (): HaForm =>
      find<HaForm>(editor, '.picker ha-form.other');

    await tapInPreview(editor, { type: 'room', id: 'hall' });
    const roomForm = otherForm();

    await tapInPreview(editor, frontDoor);
    const doorForm = otherForm();

    await click(editor, find(editor, '.picker .other-all'));
    const allForm = otherForm();

    expect(doorForm).not.toBe(roomForm);
    expect(allForm).not.toBe(doorForm);
    expect(doorForm.schema[0].selector).toEqual({
      entity: { filter: entityFilter('door') },
    });
  });

  it('gives a door a remove for its state and one for its lock', async () => {
    const hass = editorHass();

    hass.states['lock.front_door'] = mockLock('lock.front_door', 'locked');

    const editor = await withHome(
      {
        ...baseConfig,
        bindings: [
          {
            scope: frontDoor,
            entity_ids: ['binary_sensor.bathroom_door', 'lock.front_door'],
          },
        ],
      },
      hass,
    );
    const config = captureConfig(editor);
    const removes = all(
      editor,
      '.thing.linked[data-key="door:d1"] .link .unlink',
    );

    expect(removes.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Unlink Bathroom door from Door between Living Space and Bathroom',
      'Unlink Front door from Door between Living Space and Bathroom',
    ]);

    await click(editor, removes[1]);

    expect(config().bindings).toEqual([
      { scope: frontDoor, entity_id: 'binary_sensor.bathroom_door' },
    ]);
  });

  it('removes the area of a room with the ✕ on its area link', async () => {
    const hall: SceneScope = { type: 'room', id: 'hall' };
    const editor = await withHome({
      ...baseConfig,
      bindings: [
        { scope: hall, area_id: 'hall_1', entity_id: 'sensor.garage_humidity' },
      ],
    });
    const config = captureConfig(editor);

    await click(
      editor,
      find(editor, '.thing.linked[data-key="room:hall"] .link.area .unlink'),
    );

    expect(config().bindings).toEqual([
      { scope: hall, entity_id: 'sensor.garage_humidity' },
    ]);
  });
});

describe('unlinking with an undo', () => {
  const hallLight: SceneScope = { type: 'light', id: 'hall-light' };
  const frontDoor: SceneScope = { type: 'door', id: 'd1' };
  const doorLinks: SceneBinding[] = [
    {
      scope: frontDoor,
      entity_ids: ['binary_sensor.bathroom_door', 'light.ceiling'],
    },
  ];

  function remove(editor: EstanzaCardEditor, entityId: string): HTMLElement {
    return find(
      editor,
      `.thing.linked .link[data-entity="${entityId}"] .unlink`,
    );
  }

  it('unlinks at once and puts the link back on Undo', async () => {
    const bindings = [{ scope: hallLight, entity_id: 'light.hall_spots' }];
    const editor = await withHome({ ...baseConfig, bindings });
    const config = captureConfig(editor);

    await click(editor, remove(editor, 'light.hall_spots'));

    expect(config().bindings).toEqual([]);
    expect(text(find(editor, '.toast .toast-text'))).toBe('Unlinked.');

    await click(editor, find(editor, '.toast .toast-undo'));

    expect(config().bindings).toEqual(bindings);
  });

  it('keeps an unlinked row where it was until the offer to undo goes', async () => {
    const editor = await withHome({ ...baseConfig, bindings: doorLinks });
    const rows = '.thing.linked[data-key="door:d1"] .link';

    vi.useFakeTimers();

    try {
      await click(editor, remove(editor, 'light.ceiling'));

      expect(all(editor, rows)).toHaveLength(2);
      expect(
        find(editor, `${rows}[data-entity="light.ceiling"]`).classList,
      ).toContain('gone');
      expect(all(editor, `${rows}.gone .unlink`)).toHaveLength(0);

      vi.advanceTimersByTime(6000);
      await editor.updateComplete;

      expect(all(editor, rows)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a thing left with no links in the linked list until the offer to undo goes', async () => {
    const editor = await withHome({
      ...baseConfig,
      bindings: [{ scope: hallLight, entity_id: 'light.hall_spots' }],
    });

    await click(editor, remove(editor, 'light.hall_spots'));

    expect(
      editor.renderRoot.querySelector(
        '.thing.linked[data-key="light:hall-light"]',
      ),
    ).not.toBeNull();
    expect(
      editor.renderRoot.querySelector(
        '.thing.open[data-key="light:hall-light"]',
      ),
    ).toBeNull();
  });
});

describe('not linked yet', () => {
  it('lists what is not linked, dimmed, with the best match as a one-tap chip', async () => {
    const editor = await withHome();
    const config = captureConfig(editor);
    const door = find(editor, '.thing.open[data-key="door:d1"]');
    const chip = door.querySelector<HTMLElement>('.suggest');

    expect(text(find(editor, '.overline'))).toBe('Not linked yet');
    expect(text(chip)).toBe('Bathroom door');

    await click(editor, chip as HTMLElement);

    expect(config().bindings).toEqual([
      {
        scope: { type: 'door', id: 'd1' },
        entity_id: 'binary_sensor.bathroom_door',
      },
    ]);
    expect(
      editor.renderRoot.querySelector('.thing.linked[data-key="door:d1"]'),
    ).not.toBeNull();
  });

  it('lists what is not linked in plan order, room by room, each room first', async () => {
    const editor = await createEditor(baseConfig, async () => aurora);

    await vi.waitFor(() => {
      expect(editor.documentLoaded).toBe(true);
    });
    await editor.updateComplete;

    const more = editor.renderRoot.querySelector<HTMLElement>('.more-open');

    if (more) await click(editor, more);

    const byKey = new Map(editor.things.map((thing) => [thing.key, thing]));
    const rows = all(editor, '.thing.open').map(
      (row) => byKey.get(row.dataset.key ?? '') ?? null,
    );
    const rooms = editor.things
      .filter((thing) => thing.scope.type === 'room')
      .filter((thing) => !isStorageRoom(thing.name))
      .map((thing) => thing.room);
    const firsts = rows.filter(
      (thing, index) => index === 0 || rows[index - 1]?.room !== thing?.room,
    );
    const groups = firsts.map((thing) => thing?.room ?? null);
    const planned = groups.filter((room) => rooms.includes(room));

    expect(rows.length).toBeGreaterThan(8);
    expect(new Set(groups).size).toBe(groups.length);
    expect(planned).toEqual(rooms.filter((room) => planned.includes(room)));
    expect(
      firsts
        .filter((thing) => thing?.room !== null)
        .every((thing) => thing?.scope.type === 'room'),
    ).toBe(true);
  });

  it('marks a room with its own icon, not the one of a door', async () => {
    const editor = await withHome();
    const room = find(editor, '.thing.open[data-key="room:hall"] .kind svg');
    const door = find(editor, '.thing.open[data-key="door:d1"] .kind svg');

    expect(room.innerHTML).not.toBe(door.innerHTML);
  });

  it('marks a room with a room glyph, not an empty square that reads as a checkbox', async () => {
    const editor = await withHome();
    const room = find(editor, '.thing.open[data-key="room:hall"] .kind svg');

    expect(room.querySelector('rect')).toBeNull();
    expect(room.querySelectorAll('path').length).toBeGreaterThan(1);
  });

  it('suggests an area for a room whose name matches one', async () => {
    const editor = await withHome();

    expect(
      text(find(editor, '.thing.open[data-key="room:living-space"] .suggest')),
    ).toBe('Living space area');
  });

  it('suggests a sensor with no area for the room its name gives', async () => {
    const editor = await withHome();

    expect(
      text(find(editor, '.thing.open[data-key="room:hall"] .suggest')),
    ).toBe('Sonoff Temperature and Humidity Sensor - Temperature');
    expect(
      find(editor, '.thing.open[data-key="room:hall"] .suggest').title,
    ).toBe('Sonoff Temperature and Humidity Sensor - Hall Temperature');
  });

  it('asks inline before linking the sure matches, and Cancel links nothing', async () => {
    const editor = await withHome();
    const seen = vi.fn();
    const sure = all(editor, '.thing.open .suggest.sure').length;

    editor.addEventListener('config-changed', seen);

    expect(sure).toBeGreaterThan(0);
    expect(text(find(editor, '.link-all'))).toBe(
      `Link ${sure} sure ${sure === 1 ? 'match' : 'matches'}`,
    );
    expect(find(editor, '.link-all').classList).toContain('outlined');

    await click(editor, find(editor, '.link-all'));

    expect(text(find(editor, '.confirm-all .confirm-text'))).toBe(
      `Link ${sure} things whose names match?`,
    );
    expect(editor.renderRoot.querySelector('.link-all')).toBeNull();

    await click(editor, find(editor, '.confirm-all .cancel-all'));

    expect(seen).not.toHaveBeenCalled();
    expect(editor.renderRoot.querySelector('.confirm-all')).toBeNull();
  });

  it('links only the sure matches once confirmed', async () => {
    const editor = await withHome();
    const config = captureConfig(editor);
    const keyOf = (chip: HTMLElement) =>
      chip.closest<HTMLElement>('.thing')?.dataset.key ?? '';
    const sure = all(editor, '.thing.open .suggest.sure').map(keyOf);
    const unsure = all(editor, '.thing.open .suggest:not(.sure)').map(keyOf);

    await click(editor, find(editor, '.link-all'));
    await click(editor, find(editor, '.confirm-all .confirm-all-yes'));

    const linked = config().bindings.map((binding) => scopeKey(binding.scope));

    expect([...linked].sort()).toEqual([...sure].sort());
    expect(linked.filter((key) => unsure.includes(key))).toEqual([]);
    expect(config().bindings).toContainEqual({
      scope: { type: 'room', id: 'living-space' },
      area_id: 'living',
    });
    expect(editor.renderRoot.querySelector('.link-all')).toBeNull();
    expect(text(find(editor, '.notice[role="status"]'))).toMatch(
      /^Linked \d+ things?\.$/,
    );
  });

  it('never suggests over a link that already exists', async () => {
    const existing: SceneBinding = {
      scope: { type: 'room', id: 'bathroom' },
      area_id: 'hall_2',
    };
    const editor = await withHome({ ...baseConfig, bindings: [existing] });
    const config = captureConfig(editor);

    await click(editor, find(editor, '.link-all'));
    await click(editor, find(editor, '.confirm-all .confirm-all-yes'));

    expect(
      config().bindings.filter((binding) => binding.scope.id === 'bathroom'),
    ).toEqual([existing]);
  });

  it('offers the Main Door contact for the entrance door and links it only on a tap', async () => {
    const mainDoor =
      'binary_sensor.aqara_door_window_sensor_a_main_door_contact';
    const hass = createMockHass({
      states: [
        {
          ...mockBinarySensor(mainDoor, 'door', false),
          attributes: {
            device_class: 'door',
            friendly_name: 'Aqara Door/Window Sensor - A - Main Door',
          },
        },
      ],
    });
    const editor = await createEditor(baseConfig, async () => aurora, hass);
    const seen = vi.fn();

    editor.addEventListener('config-changed', seen);

    await vi.waitFor(() => {
      expect(editor.documentLoaded).toBe(true);
    });
    await editor.updateComplete;

    const chip = find(editor, '.thing.open[data-key="door:d1"] .suggest');

    expect(chip.title).toBe('Aqara Door/Window Sensor - A - Main Door');
    expect(seen).not.toHaveBeenCalled();

    const config = captureConfig(editor);

    await click(editor, chip);

    expect(config().bindings).toEqual([
      { scope: { type: 'door', id: 'd1' }, entity_id: mainDoor },
    ]);
  });

  it('opens the picker from a row that is not linked yet', async () => {
    const editor = await withHome();

    await click(
      editor,
      find(editor, '.thing.open[data-key="light:hall-light"] .thing-main'),
    );

    expect(text(find(editor, '.picker .name'))).toBe('Hall light');
  });

  it('offers the areas whose names come close in the room picker, and links one only on a tap', async () => {
    const editor = await withHome();
    const seen = vi.fn();

    editor.addEventListener('config-changed', seen);
    await tapInPreview(editor, { type: 'room', id: 'hall' });

    const offers = all(editor, '.picker .area-offers .suggest');

    expect(offers.map((offer) => offer.dataset.area)).toEqual([
      'hall_1',
      'hall_2',
    ]);
    expect(offers.map((offer) => text(offer))).toEqual([
      'Hall 1 area',
      'Hall 2 area',
    ]);
    expect(seen).not.toHaveBeenCalled();

    const config = captureConfig(editor);

    await click(editor, offers[1]);

    expect(config().bindings).toEqual([
      { scope: { type: 'room', id: 'hall' }, area_id: 'hall_2' },
    ]);
    expect(editor.renderRoot.querySelector('.picker .area-offers')).toBeNull();
  });

  it('lists an unavailable entity last in the picker, greyed', async () => {
    const hass = editorHass();

    hass.states['light.hall_old'] = mockLight('light.hall_old', {
      unavailable: true,
    });
    hass.states['light.hall_old'].attributes.friendly_name = 'Hall light';

    const editor = await withHome(baseConfig, hass);

    await tapInPreview(editor, { type: 'light', id: 'hall-light' });

    const ids = candidateIds(editor);

    expect(ids.at(-1)).toBe('light.hall_old');
    expect(candidate(editor, 'light.hall_old').classList).toContain(
      'unavailable',
    );
    expect(candidate(editor, 'light.hall_spots').classList).not.toContain(
      'unavailable',
    );
  });
});

describe('links the home does not hold', () => {
  it('lists a link the home no longer has, and unlinks it', async () => {
    const stray: SceneBinding = {
      scope: { type: 'light', id: 'old-lamp' },
      entity_id: 'light.a',
    };
    const editor = await withHome({ ...baseConfig, bindings: [stray] });
    const config = captureConfig(editor);
    const row = find(editor, '.thing.linked[data-key="light:old-lamp"]');

    expect(text(row.querySelector('.thing-name'))).toBe('Light Old lamp');

    await click(editor, row.querySelector('.unlink') as HTMLElement);

    expect(config().bindings).toEqual([]);
  });

  it('names a lost link by its kind, never by a generated id', async () => {
    const stray: SceneBinding = {
      scope: { type: 'door', id: 'x3m9ivzq' },
      entity_id: 'light.a',
    };
    const editor = await withHome({ ...baseConfig, bindings: [stray] });
    const row = find(editor, '.thing.linked[data-key="door:x3m9ivzq"]');

    expect(text(row.querySelector('.thing-name'))).toBe('Removed door');
  });

  it('names an orphan after its entity, as a missing object, and relinks it', async () => {
    const hass = editorHass();

    hass.states['climate.lounge'] = mockEntityState('climate.lounge', 'heat', {
      friendly_name: 'Lounge thermostat',
      hvac_action: 'heating',
    });

    const orphan: SceneBinding = {
      scope: { type: 'prop', id: 'living-room-thermostat' },
      entity_id: 'climate.lounge',
    };
    const editor = await withHome({ ...baseConfig, bindings: [orphan] }, hass);
    const config = captureConfig(editor);
    const row = find(
      editor,
      '.thing.linked[data-key="prop:living-room-thermostat"]',
    );

    expect(text(row.querySelector('.thing-name'))).toBe(
      'Lounge thermostat (missing object)',
    );
    expect(text(editor.renderRoot.querySelector('.list'))).not.toMatch(
      /\bObject\b/,
    );

    await click(editor, row.querySelector('.thing-main') as HTMLElement);
    await relinkToHall(editor);

    expect(
      config().bindings.map((binding) => [
        scopeKey(binding.scope),
        bindingEntityIds(binding),
      ]),
    ).toEqual([['room:hall', ['climate.lounge']]]);
    expect(text(find(editor, '.toast .toast-text'))).toBe('Moved to Hall.');
  });

  const orphanEditor = async () => {
    const hass = editorHass();

    hass.states['switch.tv_plug'] = mockEntityState('switch.tv_plug', 'off', {
      friendly_name: 'Television plug',
    });

    const orphan: SceneBinding = {
      scope: { type: 'prop', id: 'gone-television' },
      entity_id: 'switch.tv_plug',
    };
    const editor = await withHome({ ...baseConfig, bindings: [orphan] }, hass);
    const row = find(editor, '.thing.linked[data-key="prop:gone-television"]');

    await click(editor, row.querySelector('.thing-main') as HTMLElement);

    return { editor, orphan };
  };

  it('groups the relink menu under floor headers, each room followed by its own objects', async () => {
    const hass = editorHass();

    hass.states['switch.tv_plug'] = mockEntityState('switch.tv_plug', 'off', {
      friendly_name: 'Television plug',
    });

    const orphan: SceneBinding = {
      scope: { type: 'prop', id: 'gone-television' },
      entity_id: 'switch.tv_plug',
    };
    const editor = await createEditor(
      { ...baseConfig, bindings: [orphan] },
      async () => aurora,
      hass,
    );

    await vi.waitFor(() => {
      expect(editor.documentLoaded).toBe(true);
    });
    await editor.updateComplete;

    const config = captureConfig(editor);

    await click(
      editor,
      find(
        editor,
        '.thing.linked[data-key="prop:gone-television"] .thing-main',
      ),
    );

    expect(editor.renderRoot.querySelector('.relink-menu')).toBeNull();

    await click(editor, find(editor, '.picker .relink-open'));

    const sections = all(editor, '.relink-menu .relink-floor');

    expect(
      sections.map((section) => text(section.querySelector('.picker-group'))),
    ).toEqual(['First floor', 'Ground floor', 'Basement']);

    for (const section of sections) {
      const entries = [...section.querySelectorAll<HTMLElement>('[data-room]')];
      const rooms = entries.map((entry) => entry.dataset.room);

      expect(entries[0].dataset.kind).toBe('room');
      entries.forEach((entry, index) => {
        if (entry.dataset.kind === 'room') {
          expect(rooms.slice(0, index)).not.toContain(entry.dataset.room);
        } else {
          expect(entry.dataset.room).toBe(rooms[index - 1]);
        }
      });
    }

    const television = find(
      editor,
      '.relink-menu .relink-target[data-key^="prop:"]',
    );
    const key = television.dataset.key ?? '';

    await click(editor, television);

    expect(config().bindings.map((binding) => scopeKey(binding.scope))).toEqual(
      [key],
    );
    expect(editor.renderRoot.querySelector('.relink-menu')).toBeNull();
  });

  it('offers an orphan only entities of its own kind, and no tap or hold settings', async () => {
    const { editor } = await orphanEditor();
    const ids = candidateIds(editor);

    expect(ids).toContain('switch.tv_plug');
    expect(ids.every((id) => id.startsWith('switch.'))).toBe(true);
    expect(editor.renderRoot.querySelector('.picker .actions')).toBeNull();
  });

  it('shows the undo offer inside the open picker, never over its rows, and undoes exactly the move', async () => {
    const { editor, orphan } = await orphanEditor();
    const config = captureConfig(editor);

    await relinkToHall(editor);

    const toasts = editor.renderRoot.querySelectorAll('.toast');

    expect(toasts).toHaveLength(1);
    expect(toasts[0].closest('.picker')).not.toBeNull();
    expect(toasts[0].nextElementSibling?.closest('.candidates')).toBeNull();

    await click(editor, find(editor, '.toast .toast-undo'));

    expect(config().bindings).toEqual([orphan]);
    expect(editor.renderRoot.querySelector('.toast')).toBeNull();
  });

  it('keeps the undo offer while the pointer rests on it', async () => {
    const { editor } = await orphanEditor();

    vi.useFakeTimers();

    try {
      await relinkToHall(editor);
      find(editor, '.toast').dispatchEvent(new Event('pointerenter'));
      vi.advanceTimersByTime(10_000);
      await editor.updateComplete;

      expect(editor.renderRoot.querySelector('.toast')).not.toBeNull();

      find(editor, '.toast').dispatchEvent(new Event('pointerleave'));
      vi.advanceTimersByTime(6000);
      await editor.updateComplete;

      expect(editor.renderRoot.querySelector('.toast')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the links of a home it cannot read', async () => {
    const editor = await createEditor(
      {
        ...baseConfig,
        bindings: [{ scope: { type: 'room', id: 'hall' }, area_id: 'hall_1' }],
      },
      failToLoad,
    );

    await vi.waitFor(() => {
      expect(editor.renderRoot.textContent).toContain('Could not read');
    });
    await editor.updateComplete;

    expect(text(find(editor, '.thing.linked .thing-name'))).toBe('Room Hall');
  });
});

describe('a thing whose room is named beside it', () => {
  const lampHome: SceneDocumentLoader = async () => ({
    ...homeFixture,
    additions: {
      ...homeFixture.additions,
      lights: homeFixture.additions.lights.map((light) =>
        light.slug === 'living-space-light'
          ? { ...light, label: 'Floor lamp' }
          : light,
      ),
    },
  });
  const lamp: SceneScope = { type: 'light', id: 'living-space-light' };

  async function withLamp(): Promise<EstanzaCardEditor> {
    const editor = await createEditor(baseConfig, lampHome, editorHass());

    await vi.waitFor(() => {
      expect(editor.documentLoaded).toBe(true);
    });
    await editor.updateComplete;

    return editor;
  }

  it('names it once in the list, with the room on the line below', async () => {
    const editor = await withLamp();
    const row = find(
      editor,
      '.thing.open[data-key="light:living-space-light"]',
    );

    expect(text(row.querySelector('.thing-name'))).toBe('Floor lamp');
    expect(text(row.querySelector('.meta'))).toBe('Living Space');
  });

  it('names it once at the top of its picker', async () => {
    const editor = await withLamp();

    await tapInPreview(editor, lamp);

    expect(text(find(editor, '.picker .name'))).toBe('Floor lamp');
    expect(text(find(editor, '.picker .meta'))).toBe('Light · Living Space');
  });
});

describe('renamed and deleted entities in the editor', () => {
  const lightBinding: SceneBinding = {
    scope: { type: 'light', id: 'living-space-light' },
    entity_id: 'light.living_space',
  };

  function registryHass(
    entries: { id: string; entity_id: string }[] | Error,
    states = [mockLight('light.living_room_ceiling')],
  ): MockHass {
    const withRegistry = createMockHass({ states });

    withRegistry.callWS =
      entries instanceof Error
        ? vi.fn().mockRejectedValue(entries)
        : vi.fn().mockResolvedValue(entries);

    return withRegistry;
  }

  async function editing(
    config: EstanzaCardConfig,
    hass: MockHass,
  ): Promise<EstanzaCardEditor> {
    const editor = await createEditor(config, loadHome, hass);

    await vi.waitFor(() => {
      expect(editor.documentLoaded).toBe(true);
      expect(hass.callWS).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await editor.updateComplete;

    return editor;
  }

  it('shows a renamed entity and updates it on request', async () => {
    const editor = await editing(
      {
        ...baseConfig,
        bindings: [lightBinding],
        registry_ids: { 'light.living_space': 'reg-light' },
      },
      registryHass([
        { id: 'reg-light', entity_id: 'light.living_room_ceiling' },
      ]),
    );
    const config = captureConfig(editor);
    const renamed = text(find(editor, '.renamed'));

    expect(renamed).toContain('light.living_space is now');
    expect(renamed).toContain('light.living_room_ceiling');

    await click(editor, find(editor, '.use-new-names'));

    expect(config().bindings).toEqual([
      { ...lightBinding, entity_id: 'light.living_room_ceiling' },
    ]);
    expect(config().registry_ids).toEqual({
      'light.living_room_ceiling': 'reg-light',
    });
    expect(editor.renderRoot.querySelector('.renamed')).toBeNull();
  });

  it('shows a deleted entity as unresolved, with where it was linked', async () => {
    const editor = await editing(
      {
        ...baseConfig,
        bindings: [lightBinding],
        registry_ids: { 'light.living_space': 'reg-light' },
      },
      registryHass([]),
    );
    const unresolved = text(find(editor, '.unresolved'));

    expect(unresolved).toContain('light.living_space');
    expect(unresolved).toContain('linked to Living Space light');
  });

  it('removes an unresolved entity when asked', async () => {
    const editor = await editing(
      {
        ...baseConfig,
        bindings: [
          lightBinding,
          { scope: { type: 'room', id: 'living-space' }, area_id: 'living' },
        ],
        registry_ids: { 'light.living_space': 'reg-light' },
      },
      registryHass([]),
    );
    const config = captureConfig(editor);

    await click(editor, find(editor, '.unresolved button'));

    expect(config().bindings).toEqual([
      { scope: { type: 'room', id: 'living-space' }, area_id: 'living' },
    ]);
    expect(editor.renderRoot.querySelector('.unresolved')).toBeNull();
  });

  it('writes the registry id of an entity it links', async () => {
    const hass = registryHass(
      [{ id: 'reg-light', entity_id: 'light.living_space' }],
      [mockLight('light.living_space')],
    );
    const editor = await editing(baseConfig, hass);
    const config = captureConfig(editor);

    await tapInPreview(editor, { type: 'light', id: 'living-space-light' });
    await click(editor, candidate(editor, 'light.living_space'));

    expect(config().registry_ids).toEqual({
      'light.living_space': 'reg-light',
    });
  });

  it('keeps working on entity ids alone, with one quiet note, when the registry is refused', async () => {
    const editor = await editing(
      { ...baseConfig, bindings: [lightBinding] },
      registryHass(new Error('Unauthorized'), [
        mockLight('light.living_space'),
      ]),
    );
    const config = captureConfig(editor);

    expect(all(editor, '.registry-note')).toHaveLength(1);
    expect(editor.renderRoot.querySelector('.notice.error')).toBeNull();

    change(find<HaForm>(editor, '.card-form'), { title: 'Home' });

    expect(config().bindings).toEqual([lightBinding]);
    expect(config().registry_ids).toBeUndefined();
  });
});
