import './plan-view.js';

import type { HomeDocument } from '@estanza/plan-engine';
import { homeDocumentSchema } from '@estanza/plan-engine/document';
import {
  type DerivedFloor,
  deriveFloors,
} from '@estanza/plan-engine/geometry/geometry.js';
import { QUALITY_TIERS, type QualityTier } from '@estanza/scene/quality.js';
import type { UnitSystem } from '@estanza/shared';
import type { CardUpdate } from '@estanza/shared/card';
import { tokens } from '@estanza/tokens';
import {
  css,
  html,
  LitElement,
  nothing,
  type PropertyValues,
  svg,
  type SVGTemplateResult,
  type TemplateResult,
  unsafeCSS,
} from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';

import {
  actionsFor,
  bindingEntityIds,
  DEFAULT_NIGHT,
  DEFAULT_OTHER_FLOORS,
  defaultApiOrigin,
  type EstanzaCardConfig,
  estanzaHomesUrl,
  type NightSource,
  type OtherFloors,
  type SceneBinding,
  type SceneScope,
  type SceneScopeType,
  scopeKey,
  shareDocumentEndpoint,
  shareIdFromConfig,
  type ThingAction,
  type Trigger,
  triggers,
} from './bindings.js';
import {
  cardHeaders,
  cardUpdateOf,
  homeTooNew,
  NEWER_WORDS,
  OUTDATED_WORDS,
} from './card-update.js';
import {
  actionOf,
  cardDeedOf,
  type ControlKind,
  controlKindOf,
  deedChoices,
  deedLabel,
  deedOf,
  defaultDeed,
} from './control.js';
import {
  confirmTemplate,
  pinToScroller,
  promptStyles,
  type ToastHold,
  UNDO_MS,
  type UndoToast,
  undoToastTemplate,
} from './editor-prompts.js';
import {
  busiestFloor,
  floorStorageKey,
  readFloorChoice,
  storeys,
} from './floors.js';
import type { Point, ScreenAnchor } from './gesture.js';
import {
  deviceClassOf,
  entityDomain,
  type HassEntityState,
  type HomeAssistant,
  isUnavailable,
  mapScopeStates,
  sceneOverlayOf,
} from './hass-state.js';
import { icon, type IconName, scopeIcons } from './icons.js';
import {
  applySuggestion,
  type Candidate,
  candidatesFor,
  entityFilter,
  entityRole,
  formatState,
  holderOf,
  humanize,
  isLinked,
  isStorageRoom,
  isWordId,
  linkedArea,
  linkedEntities,
  moveEntity,
  type PickDetail,
  pickEvent,
  proposedAreas,
  scopeLabels,
  setArea,
  setThingAction,
  shortName,
  suggestAll,
  type Suggestion,
  swapEntity,
  type Thing,
  thingsOf,
  unlinkEntity,
} from './linking.js';
import { placePills } from './living.js';
import { entityName, proposeSetup } from './matching.js';
import type { EstanzaPlanView } from './plan-view.js';
import {
  applyChanges,
  emptyRegistry,
  type EntityChanges,
  entityChanges,
  type EntityRegistry,
  refreshRegistry,
  registryIdsFor,
  renamesOf,
  rewriteConfig,
  unresolvedOf,
  unsettledLinks,
} from './registry.js';
import {
  emptyOverlay,
  type SceneOverlay,
  type ScopeSelectDetail,
} from './scene-view.js';
import { cardVersion } from './version.js';

export type HaFormSchemaEntry = {
  name: string;
  required?: boolean;
  selector: Record<string, unknown>;
};

export type HaFormValueChanged = CustomEvent<{
  value: Record<string, unknown>;
}>;

export type SceneDocumentLoader = (
  config: EstanzaCardConfig,
  heard?: (update: CardUpdate) => void,
) => Promise<unknown>;

export type EditorStatus = 'idle' | 'loading' | 'ready' | 'failed';

export type HighlightDetail = { scope: SceneScope | null };

export type HomeSummary = { name: string; floors: number; rooms: number };

export const highlightEvent = 'estanza-card-highlight';

const SET_IN_YAML = 'yaml';

export const editorLabels: Record<string, string> = {
  share: 'Share link or ID',
  title: 'Card title',
  navigation_path: 'View a tile opens',
  area_id: 'Home Assistant area',
  other_entity: 'Any other entity',
  tap_action: 'On tap',
  hold_action: 'On hold',
  relink_to: 'Relink to',
};

const noToggleReasons: Record<SceneScopeType, string> = {
  door: 'A sensor only reports this door, so a tap cannot open or lock it.',
  window: 'A sensor only reports this window, so a tap cannot open it.',
  light: 'This only reports a reading, so a tap cannot switch it.',
  prop: 'This only reports a reading, so a tap cannot switch it.',
  room: 'This only reports a reading, so a tap cannot switch it.',
};

export const editorHelpers: Record<string, string> = {
  share: 'Paste the link from Share in the Estanza editor.',
  navigation_path:
    'At two rows the card is a still plan. A tap goes to this view, or opens the house in a dialog when it is empty.',
  area_id: 'Every sensor and device in this area counts for the room.',
};

export const sourceSchema: HaFormSchemaEntry[] = [
  { name: 'share', selector: { text: {} } },
];

export const cardSchema: HaFormSchemaEntry[] = [
  { name: 'title', selector: { text: {} } },
  { name: 'navigation_path', selector: { navigation: {} } },
];

type Choice<TValue extends string> = {
  value: TValue;
  name: string;
  glyph: IconName;
};

type Segments<TValue extends string> = {
  heading: string;
  group: string;
  label: string;
  choices: Choice<TValue>[];
  chosen: TValue;
  onChoose: (value: TValue) => void;
};

const nightChoices: Choice<NightSource>[] = [
  { value: 'auto', name: 'Auto', glyph: 'sunset' },
  { value: 'day', name: 'Day', glyph: 'sun' },
  { value: 'night', name: 'Night', glyph: 'moon' },
];

const otherFloorsChoices: Choice<OtherFloors>[] = [
  { value: 'ghosted', name: 'Ghosted', glyph: 'layers' },
  { value: 'hidden', name: 'Hidden', glyph: 'layer' },
];

type CablesShown = 'hidden' | 'shown';

const cablesChoices: Choice<CablesShown>[] = [
  { value: 'hidden', name: 'Hidden', glyph: 'cable-off' },
  { value: 'shown', name: 'Shown', glyph: 'cable' },
];

const qualityLooks: Record<QualityTier, Omit<Choice<QualityTier>, 'value'>> = {
  auto: { name: 'Auto', glyph: 'gauge' },
  saver: { name: 'Saver', glyph: 'bars-1' },
  balanced: { name: 'Balanced', glyph: 'bars-2' },
  sharp: { name: 'Sharp', glyph: 'bars-3' },
  full: { name: 'Full', glyph: 'bars-4' },
};

const qualityChoices: Choice<QualityTier>[] = QUALITY_TIERS.map((tier) => ({
  value: tier,
  ...qualityLooks[tier],
}));

function segmentsTemplate<TValue extends string>({
  heading,
  group,
  label,
  choices,
  chosen,
  onChoose,
}: Segments<TValue>): TemplateResult {
  return html`
    <div class="choice-row">
      <span class="meta" aria-hidden="true">${heading}</span>
      <div class="segments ${group}" role="group" aria-label=${label}>
        ${choices.map(
          (choice) => html`
            <button
              class="segment"
              aria-label=${choice.name}
              aria-pressed=${choice.value === chosen ? 'true' : 'false'}
              @click=${() => onChoose(choice.value)}
            >
              ${icon(choice.glyph)}
            </button>
          `,
        )}
      </div>
    </div>
  `;
}

export const notHomeFile =
  'That is not an Estanza home file. Export one from Share in the Estanza editor.';

const PICKER_ROWS = 8;

const OPEN_ROWS = 6;

const MARK_RADIUS_PX = 12;

const MARK_GLYPH_PX = 14;

const RING_RADIUS_PX = 17;

const domainIcons: Record<string, IconName> = {
  light: 'lightbulb',
  switch: 'power',
  lock: 'lock',
  cover: 'blinds',
  climate: 'thermometer',
};

const classIcons: Record<string, IconName> = {
  temperature: 'thermometer',
  humidity: 'droplet',
  moisture: 'droplets',
  smoke: 'alarm-smoke',
  gas: 'alarm-smoke',
  window: 'app-window',
  door: 'door-open',
  opening: 'door-open',
  garage: 'garage',
  garage_door: 'garage',
  lock: 'lock',
};

const propIcons: Record<string, IconName> = {
  tv: 'tv',
  television: 'tv',
  monitor: 'tv',
  thermostat: 'thermometer',
  heater: 'thermometer',
  radiator: 'thermometer',
  boiler: 'thermometer',
  conditioner: 'thermometer',
  fan: 'fan',
  speaker: 'speaker',
  soundbar: 'speaker',
  lamp: 'lightbulb',
  fridge: 'refrigerator',
  refrigerator: 'refrigerator',
  freezer: 'refrigerator',
  dishwasher: 'dishwasher',
  washer: 'washing-machine',
  dryer: 'washing-machine',
  washing: 'washing-machine',
};

export function shareDocumentUrl(config: EstanzaCardConfig): string | null {
  const shareId = shareIdFromConfig(config);

  if (!shareId) return null;

  return shareDocumentEndpoint(config.api_origin ?? defaultApiOrigin, shareId);
}

export async function fetchShareDocument(
  config: EstanzaCardConfig,
  heard?: (update: CardUpdate) => void,
): Promise<unknown> {
  if (config.home_document) return config.home_document;

  const url = shareDocumentUrl(config);

  if (!url) return null;

  const response = await fetch(url, {
    headers: cardHeaders({ accept: 'application/json' }),
  });

  heard?.(cardUpdateOf(response));

  if (!response.ok) {
    throw new Error(`estanza-card: share request failed (${response.status})`);
  }

  return homeDocumentOf(await response.json());
}

export function readHomeFile(text: string): HomeDocument | null {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  const parsed = homeDocumentSchema.safeParse(homeDocumentOf(value));

  return parsed.success ? parsed.data : null;
}

export function homeSummary(
  home: HomeDocument,
  floors: DerivedFloor[] = deriveFloors(home),
): HomeSummary {
  const name = home.meta.label?.trim() || home.plan.name?.trim() || 'Your home';
  const rooms = floors
    .flatMap((floor) => floor.rooms)
    .filter((room) => home.rooms[room.id]?.hidden !== true).length;

  return { name, floors: floors.length, rooms };
}

@customElement('estanza-card-editor')
export class EstanzaCardEditor extends LitElement {
  static styles = css`
    ${promptStyles}

    :host {
      display: block;
      color: var(--primary-text-color, #1f2937);
    }

    button {
      font: inherit;
      color: inherit;
    }

    .btn {
      align-items: center;
      background: none;
      border: 1px solid transparent;
      border-radius: ${unsafeCSS(tokens.radius.xl)}px;
      color: var(--primary-color, #03a9f4);
      cursor: pointer;
      display: inline-flex;
      font-size: 14px;
      font-weight: 500;
      justify-content: center;
      min-height: 36px;
      padding: 0 14px;
      white-space: nowrap;
    }

    .btn:hover {
      background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.1);
    }

    .btn:focus-visible,
    .icon-btn:focus-visible {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: 2px;
    }

    .btn.outlined {
      border-color: var(--divider-color, #e5e7eb);
    }

    .btn.filled {
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
    }

    .btn.filled:hover {
      background: var(--dark-primary-color, #0288d1);
    }

    .btn.danger {
      color: var(--error-color, #db4437);
    }

    .btn.danger:hover {
      background: color-mix(
        in srgb,
        var(--error-color, #db4437) 10%,
        transparent
      );
    }

    .icon-btn {
      align-items: center;
      background: none;
      border: 0;
      border-radius: 50%;
      color: var(--secondary-text-color, #6b7280);
      cursor: pointer;
      display: inline-flex;
      flex: none;
      height: 40px;
      justify-content: center;
      padding: 0;
      width: 40px;
    }

    .icon-btn:hover {
      background: var(--secondary-background-color, #f5f5f5);
    }

    .section {
      margin-bottom: 24px;
    }

    .heading {
      font-size: 16px;
      font-weight: 500;
      margin-bottom: 8px;
    }

    .hint,
    .notice,
    .meta {
      color: var(--secondary-text-color, #6b7280);
      font-size: 13px;
    }

    .hint,
    .notice {
      margin: 8px 0 12px;
    }

    .notice.error,
    .error {
      color: var(--error-color, #db4437);
    }

    .footer {
      display: grid;
      gap: 4px;
      padding-bottom: 12px;
      color: var(--secondary-text-color, #6b7280);
      font-size: 12px;
    }

    .home-line {
      align-items: center;
      border: 1px solid var(--divider-color, #e5e7eb);
      border-radius: ${unsafeCSS(tokens.radius.md)}px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      padding: 8px 8px 8px 12px;
    }

    .home-icon,
    .kind {
      align-items: center;
      color: var(--secondary-text-color, #6b7280);
      display: inline-flex;
      flex: none;
      justify-content: center;
      width: 24px;
    }

    .home-text {
      flex: 1;
      min-width: 140px;
    }

    .home-name {
      font-size: 15px;
      font-weight: 500;
    }

    .home-actions {
      display: flex;
      gap: 8px;
      margin-left: auto;
    }

    .source-actions {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }

    input[type='file'] {
      display: none;
    }

    .floors {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 8px;
    }

    .floor-chip {
      background: none;
      border: 1px solid var(--divider-color, #e5e7eb);
      border-radius: ${unsafeCSS(tokens.radius.pill)}px;
      cursor: pointer;
      font-size: 13px;
      min-height: 32px;
      padding: 0 12px;
    }

    .floor-chip[aria-pressed='true'] {
      background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.14);
      border-color: var(--primary-color, #03a9f4);
      font-weight: 500;
    }

    .choice-row {
      align-items: center;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      margin-top: 12px;
    }

    .segments {
      border: 1px solid var(--divider-color, #e5e7eb);
      border-radius: ${unsafeCSS(tokens.radius.pill)}px;
      display: inline-flex;
      gap: 2px;
      padding: 2px;
    }

    .segment {
      align-items: center;
      background: none;
      border: 0;
      border-radius: ${unsafeCSS(tokens.radius.pill)}px;
      color: var(--secondary-text-color, #6b7280);
      cursor: pointer;
      display: inline-flex;
      height: 36px;
      justify-content: center;
      padding: 0;
      width: 44px;
    }

    .segment:hover {
      background: var(--secondary-background-color, #f5f5f5);
    }

    .segment:focus-visible {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: 1px;
    }

    .segment[aria-pressed='true'] {
      background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.14);
      color: var(--primary-color, #03a9f4);
    }

    .preview {
      aspect-ratio: 2 / 3;
      border: 1px solid var(--divider-color, #e5e7eb);
      border-radius: ${unsafeCSS(tokens.radius.md)}px;
      max-height: 640px;
      overflow: hidden;
      position: relative;
      width: 100%;
    }

    .marks {
      height: 100%;
      inset: 0;
      pointer-events: none;
      position: absolute;
      width: 100%;
    }

    .marks .outline {
      fill: var(--primary-color, #03a9f4);
      fill-opacity: 0.18;
      stroke: var(--primary-color, #03a9f4);
      stroke-linejoin: round;
      stroke-width: 2.5;
    }

    .marks .ring {
      fill: none;
      stroke: var(--primary-color, #03a9f4);
      stroke-width: 3;
    }

    .marks .badge {
      fill: var(--primary-color, #03a9f4);
      stroke: var(--card-background-color, #fff);
      stroke-width: 2;
    }

    .marks .target {
      color: var(--primary-color, #03a9f4);
    }

    .marks .target circle {
      fill: var(--card-background-color, #fff);
      stroke: var(--primary-color, #03a9f4);
      stroke-width: 2;
    }

    .marks .target.linked {
      color: var(--text-primary-color, #fff);
    }

    .marks .target.linked circle {
      fill: var(--primary-color, #03a9f4);
      stroke: var(--card-background-color, #fff);
    }

    .marks .tick {
      fill: none;
      stroke: var(--text-primary-color, #fff);
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 2;
    }

    .picker {
      border: 2px solid var(--primary-color, #03a9f4);
      border-radius: ${unsafeCSS(tokens.radius.md)}px;
      margin-top: 12px;
      padding: 4px 0 8px;
      scroll-margin: 12px 0;
    }

    .picker-head {
      align-items: center;
      display: flex;
      gap: 8px;
      padding: 4px 4px 4px 12px;
    }

    .picker-head .kind {
      color: var(--primary-color, #03a9f4);
    }

    .picker-title {
      flex: 1;
      min-width: 0;
    }

    .picker-title .name {
      font-size: 15px;
      font-weight: 500;
      overflow-wrap: anywhere;
    }

    .picker .area,
    .picker .relink,
    .picker .other,
    .picker .more,
    .picker .empty,
    .picker .actions {
      display: block;
      padding: 4px 12px;
    }

    .picker .area-offers {
      margin-top: 0;
      padding: 0 12px 4px;
    }

    .no-toggle {
      padding-bottom: 8px;
    }

    .candidates {
      display: flex;
      flex-direction: column;
    }

    .picker-group {
      color: var(--secondary-text-color, #6b7280);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.1em;
      padding: 12px 15px 4px;
      text-transform: uppercase;
    }

    .relink-open {
      margin-top: 8px;
    }

    .relink-menu {
      border: 1px solid var(--divider-color, #e0e0e0);
      border-radius: ${unsafeCSS(tokens.radius.md)}px;
      display: flex;
      flex-direction: column;
      margin-top: 8px;
      padding-bottom: 4px;
    }

    .relink-floor .picker-group {
      padding-left: 12px;
    }

    .relink-room,
    .relink-target {
      align-items: center;
      display: flex;
      font-size: 14px;
      gap: 12px;
      min-height: 40px;
      padding: 0 12px;
    }

    .relink-room {
      color: var(--secondary-text-color, #6b7280);
    }

    .relink-target {
      background: none;
      border: 0;
      color: var(--primary-text-color, #1f2937);
      cursor: pointer;
      text-align: left;
      width: 100%;
    }

    .relink-target.object {
      padding-left: 42px;
    }

    .relink-target:hover,
    .relink-target:focus-visible {
      background: var(--secondary-background-color, #f5f5f5);
      outline: none;
    }

    .relink-room .c-icon,
    .relink-target .c-icon {
      color: var(--state-icon-color, #44739e);
      display: inline-flex;
      flex: none;
    }

    .candidate {
      align-items: center;
      background: none;
      border: 0;
      border-left: 3px solid transparent;
      cursor: pointer;
      display: flex;
      gap: 12px;
      min-height: 52px;
      padding: 4px 12px;
      text-align: left;
      width: 100%;
    }

    .candidate:hover,
    .candidate:focus-visible,
    .thing-main:hover,
    .thing-main:focus-visible {
      background: var(--secondary-background-color, #f5f5f5);
      outline: none;
    }

    .candidate[aria-pressed='true'] {
      background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.14);
      border-left-color: var(--primary-color, #03a9f4);
    }

    .candidate[aria-pressed='true']:hover,
    .candidate[aria-pressed='true']:focus-visible {
      background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.22);
    }

    .candidate[aria-pressed='true'] .c-name {
      font-weight: 500;
    }

    .c-row {
      align-items: center;
      background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.14);
      border-left: 3px solid var(--primary-color, #03a9f4);
      display: flex;
      padding-right: 4px;
    }

    .c-row .candidate {
      border-left: 0;
      flex: 1;
      min-width: 0;
      padding-left: 12px;
    }

    .c-row .candidate[aria-pressed='true'] {
      background: none;
    }

    .c-row .candidate[aria-pressed='true']:hover,
    .c-row .candidate[aria-pressed='true']:focus-visible {
      background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.08);
    }

    .c-add {
      color: var(--secondary-text-color, #6b7280);
    }

    .candidate.unavailable .c-icon,
    .candidate.unavailable .c-text,
    .candidate.unavailable .c-state {
      opacity: 0.5;
    }

    .replacing {
      align-items: center;
      background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.08);
      border-radius: ${unsafeCSS(tokens.radius.md)}px;
      display: flex;
      gap: 8px;
      margin: 4px 12px;
      padding: 0 4px 0 12px;
    }

    .replacing-text {
      flex: 1;
      font-size: 13px;
      min-width: 0;
    }

    .candidate .c-icon {
      color: var(--state-icon-color, #44739e);
      display: inline-flex;
      flex: none;
    }

    .c-text,
    .thing-text {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
    }

    .c-name {
      font-size: 14px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .thing-name {
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      display: -webkit-box;
      font-size: 14px;
      line-clamp: 2;
      overflow: hidden;
      overflow-wrap: break-word;
    }

    .c-area {
      color: var(--secondary-text-color, #6b7280);
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .c-state {
      color: var(--secondary-text-color, #6b7280);
      flex: none;
      font-size: 13px;
      max-width: 35%;
      overflow: hidden;
      text-align: right;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .c-check {
      color: var(--primary-color, #03a9f4);
      display: inline-flex;
      flex: none;
      width: 18px;
    }

    .overline {
      color: var(--secondary-text-color, #6b7280);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.1em;
      margin: 20px 0 4px;
      text-transform: uppercase;
    }

    .room-title {
      font-size: 13px;
      font-weight: 500;
      margin: 12px 0 2px;
    }

    .thing {
      align-items: center;
      border-bottom: 1px solid var(--divider-color, #e5e7eb);
      display: flex;
      flex-wrap: wrap;
    }

    .offers {
      justify-content: flex-end;
      margin: 0 0 0 auto;
      max-width: 100%;
      padding: 4px;
    }

    .thing.room .thing-name {
      font-weight: 500;
    }

    .thing.open .thing-main {
      flex: 1 1 160px;
    }

    .thing.selected {
      background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.08);
    }

    .thing-main {
      align-items: center;
      background: none;
      border: 0;
      cursor: pointer;
      display: flex;
      flex: 1;
      gap: 12px;
      min-height: 48px;
      min-width: 0;
      padding: 6px 4px;
      text-align: left;
    }

    .thing.open .kind,
    .thing.open .thing-name {
      opacity: 0.6;
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 4px;
    }

    .chip {
      align-items: center;
      background: var(--secondary-background-color, #f3f4f6);
      border: 0;
      border-radius: ${unsafeCSS(tokens.radius.md)}px;
      display: inline-flex;
      font-size: 12px;
      gap: 6px;
      max-width: 100%;
      min-height: 24px;
      padding: 0 10px;
    }

    .chip-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .thing.linked {
      cursor: pointer;
      display: block;
      padding-bottom: 6px;
    }

    .thing-head {
      align-items: center;
      display: flex;
    }

    .thing-head .thing-main {
      min-height: 40px;
      padding-bottom: 0;
    }

    .links {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding-left: 40px;
    }

    .link {
      align-items: center;
      display: flex;
      gap: 8px;
      min-width: 0;
    }

    .link-text {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
    }

    .link-head {
      display: flex;
      gap: 8px;
      font-size: 13px;
    }

    .link-role,
    .link-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .link-state {
      color: var(--secondary-text-color, #6b7280);
      flex: none;
    }

    .link-name {
      color: var(--secondary-text-color, #6b7280);
      font-size: 12px;
    }

    .link.gone .link-text {
      opacity: 0.45;
      text-decoration: line-through;
    }

    .unlink-space {
      flex: none;
      height: 40px;
      width: 40px;
    }

    .link.missing .link-role {
      color: var(--error-color, #db4437);
    }

    .link.area a,
    .scope a {
      align-self: flex-start;
      color: var(--primary-color, #03a9f4);
      font-size: 13px;
      padding: 4px 0;
      text-decoration: underline;
      text-underline-offset: 3px;
    }

    .link.area a:focus-visible,
    .scope a:focus-visible {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: 2px;
    }

    .suggest {
      background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.12);
      cursor: pointer;
      min-height: 32px;
    }

    .suggest:hover,
    .suggest:focus-visible {
      background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.22);
      outline: none;
    }

    .open-head {
      align-items: flex-end;
      display: flex;
      gap: 8px;
      justify-content: space-between;
    }

    .open-head .overline {
      margin-bottom: 8px;
    }

    .changes {
      margin-bottom: 16px;
    }

    .changes .notice {
      margin-bottom: 4px;
    }

    .changes ul {
      font-size: 13px;
      margin: 0 0 8px;
      padding-left: 20px;
    }

    .changes li {
      align-items: center;
      display: flex;
      gap: 8px;
      justify-content: space-between;
      min-height: 36px;
    }

    .changes.renamed li {
      display: list-item;
      min-height: 0;
    }

    .changes.unresolved ul {
      padding-left: 0;
    }

    .changes code {
      overflow-wrap: anywhere;
    }

    @media (pointer: coarse) {
      .floor-chip,
      .suggest,
      .btn {
        min-height: 44px;
      }

      .floor-chip {
        border-radius: ${unsafeCSS(tokens.radius.pill)}px;
      }

      .link.area a,
      .scope a {
        align-items: center;
        display: inline-flex;
        min-height: 44px;
        padding: 0;
      }

      .thing-head .thing-main {
        min-height: 44px;
      }

      .icon-btn {
        width: 44px;
        height: 44px;
      }

      .segment {
        height: 44px;
      }

      .unlink-space {
        width: 44px;
        height: 44px;
      }
    }
  `;

  @property({ attribute: false }) hass?: HomeAssistant;

  @property({ attribute: false }) documentLoader: SceneDocumentLoader =
    fetchShareDocument;

  @state() private config: EstanzaCardConfig | null = null;

  @state() private links: SceneBinding[] = [];

  @state() private status: EditorStatus = 'idle';

  @state() private verdict: CardUpdate = 'ok';

  @state() private home: HomeDocument | null = null;

  @state() private floors: DerivedFloor[] = [];

  @state() private fileError = '';

  @state() private replacing = false;

  @state() private selected: string | null = null;

  @state() private justLinked: string | null = null;

  @state() private floor: string | null = null;

  @state() private allCandidates = false;

  @state() private relinkOpen = false;

  @state() private replacingEntity: string | null = null;

  @state() private otherAll = false;

  @state() private allOpen = false;

  @state() private confirmingAll = false;

  @state() private confirmingRemove = false;

  @state() private held: SceneBinding[] | null = null;

  @state() private drawn = 0;

  @state() private linkedNotice = '';

  @state() private registry: EntityRegistry = emptyRegistry();

  @state() private undo: UndoToast | null = null;

  private undoTimer: ReturnType<typeof setTimeout> | undefined;

  private loadedShareId = '';

  private loadedDocument: HomeDocument | null = null;

  private emitted: string | null = null;

  private builtThings: Thing[] = [];

  private thingsFor: [HomeDocument | null, SceneBinding[], string] | null =
    null;

  private builtAdvice: Advice = { suggestions: new Map(), areas: new Map() };

  private adviceFor: unknown[] = [];

  private markSpots: ScreenAnchor[] = [];

  setConfig(config: EstanzaCardConfig): void {
    const bindings = config.bindings ?? [];

    if (JSON.stringify(bindings) !== this.emitted) this.links = bindings;

    this.config = { ...config, bindings };
    this.emitted = null;
    this.followRegistry();

    void this.loadDocument();
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener(pickEvent, this.onPreviewPick);
  }

  disconnectedCallback(): void {
    window.removeEventListener(pickEvent, this.onPreviewPick);
    this.point(null);
    super.disconnectedCallback();
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('hass')) this.followRegistry();
    if (this.floor === null && this.floors.length > 1) {
      this.floor = this.openingFloor();
    }
  }

  protected updated(): void {
    const toast = this.renderRoot.querySelector<HTMLElement>('.toast.floating');
    const plan = this.planView;

    if (toast) pinToScroller(toast);
    if (plan) plan.markSpots = { shown: this.markSpots, tucked: new Set() };
  }

  get documentLoaded(): boolean {
    return this.home !== null;
  }

  get bindings(): SceneBinding[] {
    return this.links;
  }

  get linkedConfig(): EstanzaCardConfig | null {
    return this.config ? { ...this.config, bindings: this.links } : null;
  }

  get changes(): EntityChanges {
    const config = this.linkedConfig;
    const states = this.hass?.states;

    if (!config || !states) return new Map();

    return entityChanges(config, states, this.registry);
  }

  get things(): Thing[] {
    const home = this.home;
    const known = this.thingsFor;

    const names = this.links
      .map((binding) => this.missingName(binding.scope))
      .join('|');

    if (
      known &&
      known[0] === home &&
      known[1] === this.links &&
      known[2] === names
    ) {
      return this.builtThings;
    }

    const found = home ? thingsOf(home, this.floors, this.links) : [];
    const listed = new Set(found.map((thing) => thing.key));
    const strays = this.links
      .filter((binding) => !listed.has(scopeKey(binding.scope)))
      .map((binding) =>
        strayThing(binding.scope, this.missingName(binding.scope)),
      );

    this.thingsFor = [home, this.links, names];
    this.builtThings = [...found, ...dedupeThings(strays)];

    return this.builtThings;
  }

  get selectedThing(): Thing | null {
    return this.things.find((thing) => thing.key === this.selected) ?? null;
  }

  get candidates(): Candidate[] {
    const thing = this.selectedThing;

    if (!thing || !this.hass) return [];

    const candidates = candidatesFor(thing, this.hass, this.links);

    if (thing.floor !== null) return candidates;

    const kinds = new Set(
      candidates
        .filter((entry) => entry.linked)
        .map((entry) => this.entityKind(entry.entityId)),
    );

    return candidates.filter(
      (entry) => entry.linked || kinds.has(this.entityKind(entry.entityId)),
    );
  }

  private entityKind(entityId: string): string {
    const state = this.hass?.states[entityId];
    const deviceClass = state ? (deviceClassOf(state) ?? '') : '';

    return `${entityDomain(entityId)}|${deviceClass}`;
  }

  get suggestions(): Map<string, Suggestion[]> {
    return this.advice.suggestions;
  }

  get listedThings(): Thing[] {
    const floor = this.shownFloor;
    const things = this.things;

    if (floor === null) return things;

    return things.filter(
      (thing) => thing.floor === floor || thing.floor === null,
    );
  }

  get sureCount(): number {
    const suggestions = this.suggestions;

    return this.listedThings.filter((thing) =>
      (suggestions.get(thing.key) ?? []).some((offer) => offer.strong),
    ).length;
  }

  private get advice(): Advice {
    const hass = this.hass;
    const home = this.home;

    if (!hass || !home) return { suggestions: new Map(), areas: new Map() };

    const inputs = [
      home,
      this.links,
      hass.entities,
      hass.areas,
      hass.devices,
      Object.keys(hass.states).length,
      Object.values(hass.states).filter(isUnavailable).length,
    ];

    if (sameInputs(inputs, this.adviceFor)) return this.builtAdvice;

    const proposal = proposeSetup(home, hass, this.links);

    this.adviceFor = inputs;
    this.builtAdvice = {
      suggestions: suggestAll(proposal, this.things, hass, this.links),
      areas: proposedAreas(proposal, hass),
    };

    return this.builtAdvice;
  }

  render(): TemplateResult | null {
    if (!this.config) return null;

    const changes = this.changes;
    const linking = this.home !== null || this.links.length > 0;

    return html`
      <div class="section">${this.renderHome()}</div>
      ${
        linking
          ? html`<div class="section">
              <div class="heading">Link things in your home</div>
              ${this.renderRenames(changes)} ${this.renderUnresolved(changes)}
              ${this.renderPreview()} ${this.renderPicker()}
              ${
                this.linkedNotice
                  ? html`<div class="notice" role="status">
                      ${this.linkedNotice}
                    </div>`
                  : nothing
              }
              ${this.renderList()}
              ${
                this.registry.status === 'failed'
                  ? html`<div class="hint registry-note">
                      Home Assistant did not share its entity registry, so a
                      renamed entity will not be followed.
                    </div>`
                  : nothing
              }
            </div>`
          : nothing
      }
      <div class="section">
        <div class="heading">Card</div>
        <ha-form
          class="card-form"
          .hass=${this.hass}
          .data=${{
            title: this.config.title ?? '',
            navigation_path: this.config.navigation_path ?? '',
          }}
          .schema=${cardSchema}
          .computeLabel=${computeLabel}
          .computeHelper=${computeHelper}
          @value-changed=${this.cardChanged}
        ></ha-form>
        ${this.renderNightSource()} ${this.renderQuality()}
        ${this.renderOtherFloors()} ${this.renderCables()}
      </div>
      <div class="footer">
        ${
          this.verdict === 'suggested'
            ? html`<div class="newer">${NEWER_WORDS}</div>`
            : nothing
        }
        <div class="version">Estanza card ${cardVersion}</div>
      </div>
      ${
        this.undo && !this.selectedThing
          ? undoToastTemplate(this.undo, this.toastHold)
          : nothing
      }
    `;
  }

  private renderHome(): TemplateResult {
    const home = this.home;

    if (home && !this.replacing) {
      const summary = homeSummary(home, this.floors);

      return html`
        <div class="heading">Home</div>
        <div class="home-line">
          <span class="home-icon">${icon('house')}</span>
          <div class="home-text">
            <div class="home-name">${summary.name}</div>
            <div class="meta">
              ${plural(summary.floors, 'floor')} ·
              ${plural(summary.rooms, 'room')}
            </div>
          </div>
          ${
            this.confirmingRemove
              ? nothing
              : html`<div class="home-actions">
                  <button class="btn replace" @click=${this.replaceHome}>
                    Replace
                  </button>
                  <button
                    class="btn danger remove"
                    @click=${this.askRemoveHome}
                  >
                    Remove
                  </button>
                </div>`
          }
        </div>
        ${
          this.confirmingRemove
            ? confirmTemplate({
                name: 'remove',
                words: `Remove ${summary.name} from this card? Your links will be lost.`,
                yes: 'Remove',
                danger: true,
                onCancel: this.cancelRemoveHome,
                onYes: () => this.removeHome(summary.name),
              })
            : nothing
        }
        <div class="hint scope">
          Walls, rooms and furniture are changed in the Estanza editor.
          <a href=${estanzaHomesUrl} target="_blank" rel="noopener"
            >Open Estanza</a
          >
        </div>
      `;
    }

    return html`
      <div class="heading">Home</div>
      <ha-form
        class="source"
        .hass=${this.hass}
        .data=${{ share: this.config?.share_url ?? this.config?.share_id ?? '' }}
        .schema=${sourceSchema}
        .computeLabel=${computeLabel}
        .computeHelper=${computeHelper}
        @value-changed=${this.shareChanged}
      ></ha-form>
      <div class="source-actions">
        <span class="meta">or</span>
        <button class="btn filled load-file" @click=${this.chooseFile}>
          Load home file
        </button>
        ${
          this.replacing
            ? html`<button class="btn cancel" @click=${this.keepHome}>
                Cancel
              </button>`
            : nothing
        }
      </div>
      <input
        type="file"
        accept=".json,application/json"
        @change=${this.fileChosen}
      />
      ${this.fileError ? html`<div class="notice error">${this.fileError}</div>` : nothing}
      ${this.renderStatus()}
    `;
  }

  private renderNightSource(): TemplateResult {
    return segmentsTemplate({
      heading: 'Day and night',
      group: 'night-source',
      label: 'Day and night in 3D',
      choices: nightChoices,
      chosen: this.config?.night ?? DEFAULT_NIGHT,
      onChoose: (source) => this.chooseNight(source),
    });
  }

  private renderQuality(): TemplateResult {
    return segmentsTemplate({
      heading: 'Quality',
      group: 'quality',
      label: 'Quality',
      choices: qualityChoices,
      chosen: this.config?.quality ?? 'auto',
      onChoose: (tier) => this.chooseQuality(tier),
    });
  }

  private renderOtherFloors(): TemplateResult | typeof nothing {
    if (this.home && this.floors.length < 2) return nothing;

    return segmentsTemplate({
      heading: 'Other floors',
      group: 'other-floors',
      label: 'Other floors',
      choices: otherFloorsChoices,
      chosen: this.config?.other_floors ?? DEFAULT_OTHER_FLOORS,
      onChoose: (mode) => this.chooseOtherFloors(mode),
    });
  }

  private renderCables(): TemplateResult {
    return segmentsTemplate({
      heading: 'Cables',
      group: 'cables',
      label: 'Cables on the plan',
      choices: cablesChoices,
      chosen: this.config?.show_cables ? 'shown' : 'hidden',
      onChoose: (shown) => this.chooseCables(shown),
    });
  }

  private renderStatus(): TemplateResult | typeof nothing {
    if (this.verdict === 'required') {
      return html`<div class="notice outdated">${OUTDATED_WORDS}</div>`;
    }

    if (this.status === 'loading') {
      return html`<div class="notice">Loading your home…</div>`;
    }

    if (this.status === 'failed') {
      return html`
        <div class="notice error">
          Could not read that home. Check the share link, or load the home file.
        </div>
        <button class="btn filled retry" @click=${this.reload}>Retry</button>
      `;
    }

    if (this.status === 'ready' && !this.home) {
      return html`<div class="notice">
        That home has no rooms, lights or doors yet.
      </div>`;
    }

    return nothing;
  }

  private renderPreview(): TemplateResult | typeof nothing {
    const home = this.home;

    if (!home) return nothing;

    const active = this.shownFloor;
    const levels = this.floors.length > 1 ? storeys(this.floors) : [];

    return html`
      ${
        levels.length > 0
          ? html`<div class="floors">
              ${levels.map(
                (level) => html`
                  <button
                    class="floor-chip"
                    aria-pressed=${level.id === active ? 'true' : 'false'}
                    @click=${() => this.chooseFloor(level.id)}
                  >
                    ${level.name}
                  </button>
                `,
              )}
            </div>`
          : nothing
      }
      <div class="preview">
        <estanza-plan-view
          .home=${home}
          .floors=${this.floors}
          .active=${active}
          .scheme=${this.hass?.themes?.darkMode ? 'dark' : 'light'}
          .overlay=${this.overlay}
          .units=${this.units}
          .interactive=${true}
          .targets=${this.things.map((thing) => thing.scope)}
          .glyphs=${this.things
            .filter((thing) => thing.scope.type !== 'room')
            .map((thing) => ({ scope: thing.scope, nudge: { x: 0, y: 0 } }))}
          @scope-select=${this.onPlanSelect}
          @view-change=${this.onPlanDrawn}
        ></estanza-plan-view>
        ${this.renderMarks()}
      </div>
      <div class="hint">Tap a room, light, door or window to link it.</div>
    `;
  }

  private renderMarks(): TemplateResult | typeof nothing {
    const plan = this.planView;

    this.markSpots = [];

    if (!plan || this.drawn === 0) return nothing;

    const selected = this.selectedThing;
    const outline =
      selected?.scope.type === 'room' ? plan.outlineOf(selected.scope) : null;
    const checked = (thing: Thing): boolean =>
      thing.key === this.selected || thing.key === this.justLinked;
    const marked = this.things.flatMap((thing) => {
      const at =
        thing.scope.type === 'room' ? null : plan.anchorOf(thing.scope);

      return at
        ? [{ thing, linked: isLinked(this.links, thing.scope), at }]
        : [];
    });
    const rooms = plan.roomFootprints(
      marked.flatMap(({ thing }) => (roomed(thing) ? [thing.room] : [])),
    );
    const disc = { width: 2 * MARK_RADIUS_PX, height: 2 * MARK_RADIUS_PX };
    const requests = marked.map(({ thing, at }) => ({
      key: thing.key,
      ...at,
      ...disc,
      priority: 0,
      room: roomed(thing) ? (rooms.get(thing.room)?.floor ?? null) : null,
    }));
    const inside = placePills(requests, plan.wordBoxes(), [], false);
    const seated = new Set(inside.map((spot) => spot.key));
    const loose = placePills(
      requests
        .filter((request) => !seated.has(request.key))
        .map((request) => ({ ...request, room: null })),
      [
        ...plan.wordBoxes(),
        ...inside.map((spot) => ({ x: spot.x, y: spot.y, ...disc })),
      ],
    );
    const placed = new Map(
      [...inside, ...loose].map((spot) => [spot.key, { x: spot.x, y: spot.y }]),
    );

    this.markSpots = marked.flatMap(({ thing }) => {
      const spot = placed.get(thing.key);

      return spot ? [{ key: thing.key, ...spot }] : [];
    });

    const marks = marked.flatMap(({ thing, linked }) => {
      const spot = placed.get(thing.key);

      if (!spot) return [];

      return [
        linked && checked(thing)
          ? badgeAt(thing, spot)
          : targetAt(thing, spot, linked, this.iconOf(thing)),
      ];
    });
    const ring =
      selected && selected.scope.type !== 'room'
        ? (placed.get(selected.key) ?? plan.anchorOf(selected.scope))
        : null;

    return html`
      <svg class="marks" aria-hidden="true">
        ${outline ? svg`<path class="outline" d=${outline.edge}></path>` : nothing}
        ${
          ring
            ? svg`<circle class="ring" cx=${ring.x} cy=${ring.y} r=${RING_RADIUS_PX}></circle>`
            : nothing
        }
        ${marks}
      </svg>
    `;
  }

  private renderPicker(): TemplateResult | typeof nothing {
    const thing = this.selectedThing;

    if (!thing) return nothing;

    const { type } = thing.scope;
    const candidates = this.candidates;
    const linkedRows = candidates.filter((entry) => entry.linked).length;
    const unrelated = !candidates.some((entry) => !entry.linked && entry.close);
    const shown = this.allCandidates
      ? candidates
      : candidates.slice(0, linkedRows + PICKER_ROWS);
    const place =
      type !== 'room' && thing.roomName ? ` · ${thing.roomName}` : '';
    const adding = linkedRows > 0 && !this.replacingEntity;

    return html`
      <div class="picker" role="group" aria-label=${`Link ${thing.name}`}>
        <div class="picker-head">
          <span class="kind">${icon(this.iconOf(thing))}</span>
          <div class="picker-title">
            <div class="name">${thing.shortName}</div>
            <div class="meta">${scopeLabels[type]}${place}</div>
          </div>
          <button
            class="icon-btn close"
            aria-label="Close"
            title="Close"
            @click=${this.closePicker}
          >
            ${icon('x')}
          </button>
        </div>
        ${this.undo ? undoToastTemplate(this.undo, this.toastHold, true) : nothing}
        ${
          type === 'room'
            ? html`<ha-form
                class="area"
                .hass=${this.hass}
                .data=${{ area_id: linkedArea(this.links, thing.scope) ?? '' }}
                .schema=${[{ name: 'area_id', selector: { area: {} } }]}
                .computeLabel=${computeLabel}
                .computeHelper=${computeHelper}
                @value-changed=${this.areaChanged}
              ></ha-form>`
            : nothing
        }
        ${this.renderAreaOffers(thing)}
        ${thing.floor === null ? this.renderRelink(thing) : nothing}
        ${
          thing.floor !== null && isLinked(this.links, thing.scope)
            ? this.renderActions(thing)
            : nothing
        }
        ${this.replacingEntity ? this.renderReplacing(this.replacingEntity) : nothing}
        <div class="candidates">
          ${
            shown.length > 0
              ? shown.map(
                  (candidate, index) => html`
                    ${
                      linkedRows > 0 && index === 0
                        ? html`<div class="picker-group">Linked</div>`
                        : nothing
                    }
                    ${
                      index === linkedRows && (unrelated || linkedRows > 0)
                        ? html`<div class="picker-group">
                            ${unrelated ? 'No close matches' : 'Suggested'}
                          </div>`
                        : nothing
                    }
                    ${this.renderCandidate(candidate, adding)}
                  `,
                )
              : html`<div class="meta empty">
                  Nothing in Home Assistant looks like a
                  ${scopeLabels[type].toLowerCase()}. Pick any entity below.
                </div>`
          }
        </div>
        ${
          shown.length < candidates.length
            ? html`<div class="more">
                <button class="btn" @click=${this.showAllCandidates}>
                  Show all ${candidates.length}
                </button>
              </div>`
            : nothing
        }
        ${keyed(
          // Home Assistant's entity picker keeps its list until the states change, so a changed filter needs a new picker.
          `${type}|${thing.name}|${this.otherAll}`,
          html`<ha-form
            class="other"
            .hass=${this.hass}
            .data=${{ other_entity: '' }}
            .schema=${[
              {
                name: 'other_entity',
                selector: {
                  entity: this.otherAll
                    ? {}
                    : { filter: entityFilter(type, thing.name) },
                },
              },
            ]}
            .computeLabel=${computeLabel}
            @value-changed=${this.otherChanged}
          ></ha-form>`,
        )}
        ${
          this.otherAll
            ? nothing
            : html`<div class="more">
                <button class="btn other-all" @click=${this.showOtherAll}>
                  Show all entities
                </button>
              </div>`
        }
      </div>
    `;
  }

  private renderAreaOffers(thing: Thing): TemplateResult | typeof nothing {
    const offers = this.advice.areas.get(thing.key) ?? [];

    if (offers.length === 0 || linkedArea(this.links, thing.scope)) {
      return nothing;
    }

    return html`<div class="chips area-offers">
      ${offers.map(
        (offer) => html`
          <button
            class="chip suggest"
            data-area=${offer.kind === 'area' ? offer.areaId : ''}
            aria-label=${`Link ${offer.name} to ${thing.name}`}
            title=${offer.name}
            @click=${() => this.accept(thing, offer)}
          >
            ${icon('plus', 14)}
            <span class="chip-name">${offerLabel(offer, thing)}</span>
          </button>
        `,
      )}
    </div>`;
  }

  private renderRelink(thing: Thing): TemplateResult {
    return html`<div class="relink">
      <div class="meta">
        This ${scopeLabels[thing.scope.type].toLowerCase()} is no longer in the
        home. Pick what its links belong to now.
      </div>
      <button
        class="btn outlined relink-open"
        aria-expanded=${this.relinkOpen ? 'true' : 'false'}
        @click=${this.toggleRelink}
      >
        ${editorLabels.relink_to}
      </button>
      ${this.relinkOpen ? this.renderRelinkMenu(thing) : nothing}
    </div>`;
  }

  private renderRelinkMenu(thing: Thing): TemplateResult {
    const targets = new Set(
      this.relinkTargets(thing).map((target) => target.key),
    );
    const sections = storeys(this.floors).map((storey) => {
      const onFloor = this.things.filter((entry) => entry.floor === storey.id);
      const rooms = onFloor.filter((entry) => entry.scope.type === 'room');
      const roomless = onFloor.filter(
        (entry) =>
          entry.scope.type !== 'room' &&
          targets.has(entry.key) &&
          !rooms.some((room) => room.room === entry.room),
      );
      const entries = rooms.flatMap((room) => {
        const objects = onFloor.filter(
          (entry) =>
            entry.scope.type !== 'room' &&
            entry.room === room.room &&
            targets.has(entry.key),
        );

        if (!targets.has(room.key) && objects.length === 0) return [];

        return [
          this.renderRelinkEntry(room, targets.has(room.key)),
          ...objects.map((entry) => this.renderRelinkEntry(entry, true)),
        ];
      });

      if (entries.length === 0 && roomless.length === 0) return nothing;

      return html`<div
        class="relink-floor"
        role="group"
        aria-label=${storey.name}
      >
        <div class="picker-group">${storey.name}</div>
        ${entries}
        ${roomless.map((entry) => this.renderRelinkEntry(entry, true))}
      </div>`;
    });

    return html`<div
      class="relink-menu"
      role="group"
      aria-label=${editorLabels.relink_to}
    >
      ${sections}
    </div>`;
  }

  private renderRelinkEntry(entry: Thing, target: boolean): TemplateResult {
    const kind = entry.scope.type === 'room' ? 'room' : 'object';
    const room = entry.room ?? '';

    if (!target) {
      return html`<div class="relink-room" data-kind=${kind} data-room=${room}>
        <span class="c-icon">${icon(this.iconOf(entry), 18)}</span>
        <span class="c-name">${entry.shortName}</span>
      </div>`;
    }

    return html`<button
      class="relink-target ${kind}"
      data-kind=${kind}
      data-room=${room}
      data-key=${entry.key}
      aria-label=${`Relink to ${entry.name}`}
      @click=${() => this.relinkPick(entry)}
    >
      <span class="c-icon">${icon(this.iconOf(entry), 18)}</span>
      <span class="c-name">${entry.shortName}</span>
    </button>`;
  }

  private readonly toggleRelink = (): void => {
    this.relinkOpen = !this.relinkOpen;
  };

  private relinkTargets(thing: Thing): Thing[] {
    return this.things.filter(
      (target) =>
        target.floor !== null &&
        (target.scope.type === thing.scope.type ||
          (thing.scope.type === 'prop' && target.scope.type === 'room')),
    );
  }

  private relinkPick(target: Thing): void {
    const thing = this.selectedThing;

    if (!thing) return;

    const before = this.links;
    const moved = linkedEntities(before, thing.scope).reduce(
      (links, entityId) => moveEntity(links, target.scope, entityId),
      before,
    );

    this.relinkTo(moved);
    this.justLinked = target.key;
    this.select(target.key, true);
    this.offerUndo(`Moved to ${target.name}.`, before);
  }

  private renderReplacing(entityId: string): TemplateResult {
    return html`<div class="replacing" role="status">
      <span class="replacing-text"
        >Pick what replaces ${this.entityLabel(entityId)}</span
      >
      <button
        class="icon-btn"
        aria-label="Stop replacing"
        title="Stop replacing"
        @click=${this.stopReplacing}
      >
        ${icon('x')}
      </button>
    </div>`;
  }

  private renderActions(thing: Thing): TemplateResult {
    const kind = this.kindOf(thing);
    const chosen = actionsFor(this.links, thing.scope);
    const schema = triggers.map((trigger) => {
      const yaml = chosen[trigger];
      const kept =
        yaml && !cardDeedOf(yaml)
          ? [{ value: SET_IN_YAML, label: `Set in YAML: ${yaml.action}` }]
          : [];

      return {
        name: `${trigger}_action`,
        required: true,
        selector: {
          select: {
            mode: 'dropdown',
            options: [
              ...kept,
              ...deedChoices(kind, trigger).map((deed, index) => ({
                value: deed,
                label: `${deedLabel(kind, deed)}${index === 0 ? ' (default)' : ''}`,
              })),
            ],
          },
        },
      };
    });
    const data = Object.fromEntries(
      triggers.map((trigger) => [
        `${trigger}_action`,
        shownDeed(kind, trigger, chosen[trigger]),
      ]),
    );

    return html`<div class="actions">
      ${
        kind === 'sensor'
          ? html`<div class="meta no-toggle">
              ${noToggleReasons[thing.scope.type]}
            </div>`
          : nothing
      }
      <ha-form
        .hass=${this.hass}
        .data=${data}
        .schema=${schema}
        .computeLabel=${computeLabel}
        @value-changed=${this.actionChanged}
      ></ha-form>
    </div>`;
  }

  private kindOf(thing: Thing): ControlKind {
    return controlKindOf(thing.scope, linkedEntities(this.links, thing.scope));
  }

  private renderCandidate(
    candidate: Candidate,
    adding: boolean,
  ): TemplateResult {
    const row = this.renderCandidateButton(candidate, adding);

    if (!candidate.linked || this.replacingEntity) return row;

    return html`<div class="c-row">
      ${row}
      <button
        class="icon-btn replace-entity"
        data-entity=${candidate.entityId}
        aria-label=${`Replace ${candidate.name}`}
        title=${`Replace ${candidate.name}`}
        @click=${() => this.startReplacing(candidate.entityId)}
      >
        ${icon('arrow-left-right')}
      </button>
    </div>`;
  }

  private candidateLabel(candidate: Candidate, adding: boolean): string {
    const holder = candidate.elsewhere
      ? this.movedFrom(candidate.elsewhere, candidate)
      : null;
    const from =
      holder === null ? '' : holder ? ` here from ${holder}` : ' here';

    if (this.replacingEntity) {
      return `Replace ${this.entityLabel(this.replacingEntity)} with ${candidate.name}${from}`;
    }
    if (candidate.linked) return `Unlink ${candidate.name}`;
    if (holder !== null) return `Move ${candidate.name}${from}`;

    return `${adding ? 'Add' : 'Link'} ${candidate.name}`;
  }

  private renderCandidateButton(
    candidate: Candidate,
    adding: boolean,
  ): TemplateResult {
    const state = this.hass?.states[candidate.entityId];
    const mark = candidate.linked
      ? icon('check', 18)
      : candidate.elsewhere
        ? icon('arrow-down-to-dot', 18)
        : icon('plus', 18);

    return html`
      <button
        class="candidate ${candidate.unavailable ? 'unavailable' : ''}"
        aria-pressed=${candidate.linked ? 'true' : 'false'}
        aria-label=${this.candidateLabel(candidate, adding)}
        title=${candidate.name}
        data-entity=${candidate.entityId}
        @click=${() => this.toggle(candidate)}
      >
        <span class="c-icon"
          >${icon(entityIcon(candidate.entityId, state))}</span
        >
        <span class="c-text">
          <span class="c-name">${candidate.label}</span>
          <span class="c-area"
            >${
              candidate.elsewhere
                ? this.renderHolder(candidate.elsewhere, candidate)
                : `${candidate.device ? `${candidate.device} · ` : ''}${candidate.area || 'No area'}`
            }</span
          >
        </span>
        <span class="c-state">${this.stateText(candidate.entityId)}</span>
        <span class="c-check ${candidate.linked ? '' : 'c-add'}">${mark}</span>
      </button>
    `;
  }

  private renderHolder(
    scope: SceneScope,
    candidate: Candidate,
  ): TemplateResult {
    return html`<span class="c-elsewhere"
      >${this.placeOf(scope, candidate)}</span
    >`;
  }

  private movedFrom(scope: SceneScope, candidate: Candidate): string {
    const name = this.nameOf(scope);

    if (!this.repeats(candidate, name)) return name;
    if (this.isMissing(scope)) return missingLabel(scope);

    return this.roomOf(scope);
  }

  private repeats(candidate: Candidate, name: string): boolean {
    const bare = name.replace(/\s*\(missing [^)]*\)$/, '').toLowerCase();

    return [candidate.name, candidate.label].some(
      (own) => own.toLowerCase() === bare,
    );
  }

  private isMissing(scope: SceneScope): boolean {
    const key = scopeKey(scope);

    return this.things.some(
      (thing) => thing.key === key && thing.floor === null,
    );
  }

  private roomOf(scope: SceneScope): string {
    const key = scopeKey(scope);
    const holder = this.things.find(
      (thing) => thing.key === key && thing.floor !== null,
    );

    return holder?.room ? holder.roomName : '';
  }

  private placeOf(scope: SceneScope, candidate: Candidate): string {
    const name = this.nameOf(scope);
    const room = this.roomOf(scope);

    if (!this.repeats(candidate, name)) return `Used by ${name}`;
    if (this.isMissing(scope)) return `Used by ${missingLabel(scope)}`;
    if (room)
      return `Used by the ${scopeLabels[scope.type].toLowerCase()} in ${room}`;

    return 'Linked elsewhere';
  }

  private renderList(): TemplateResult {
    const things = this.listedThings;
    const layout = this.held ?? this.links;
    const linked = things.filter((thing) => isLinked(layout, thing.scope));
    const open = inPlanOrder(
      things.filter((thing) => !isLinked(layout, thing.scope)),
      this.things,
    );
    const suggestions = this.suggestions;
    const rest = open.filter((thing) => !suggestions.has(thing.key));
    const folded = new Set(
      this.allOpen ? [] : rest.slice(OPEN_ROWS).map((thing) => thing.key),
    );
    const shown = open.filter((thing) => !folded.has(thing.key));
    const sure = this.sureCount;

    return html`
      <div class="list">
        ${
          linked.length > 0
            ? this.linkedGroups(linked)
            : html`<div class="hint">Nothing is linked yet.</div>`
        }
        ${
          open.length > 0
            ? html`
                <div class="open-head">
                  <div class="overline">Not linked yet</div>
                  ${
                    sure > 0 && !this.confirmingAll
                      ? html`<button
                          class="btn outlined link-all"
                          @click=${this.askLinkAll}
                        >
                          Link ${plural(sure, 'sure match', 'sure matches')}
                        </button>`
                      : nothing
                  }
                </div>
                ${
                  sure > 0 && this.confirmingAll
                    ? confirmTemplate({
                        name: 'all',
                        words: `Link ${plural(sure, 'thing')} whose names match?`,
                        yes: 'Link',
                        onCancel: this.cancelLinkAll,
                        onYes: this.linkAll,
                      })
                    : nothing
                }
                ${shown.map((thing) => this.renderOpen(thing))}
                ${
                  folded.size > 0
                    ? html`<button
                        class="btn more-open"
                        @click=${this.showAllOpen}
                      >
                        Show ${folded.size} more
                      </button>`
                    : nothing
                }
              `
            : nothing
        }
      </div>
    `;
  }

  private linkedGroups(linked: Thing[]): TemplateResult[] {
    const groups = new Map<string, Thing[]>();
    const rooms = this.things.filter((thing) => thing.scope.type === 'room');

    for (const room of rooms) {
      if (linked.some((thing) => thing.room === room.room)) {
        groups.set(`${room.floor ?? ''}|${room.room ?? ''}`, []);
      }
    }

    for (const thing of linked) {
      const key = `${thing.floor ?? ''}|${thing.room ?? ''}`;

      groups.set(key, [...(groups.get(key) ?? []), thing]);
    }

    return [...groups.values()]
      .filter((group) => group.length > 0)
      .map((group) => {
        const [first] = group;
        const titled = first.scope.type !== 'room';

        return html`
          ${
            titled
              ? html`<div class="room-title">
                  ${first.roomName || 'Elsewhere'}
                </div>`
              : nothing
          }
          ${group.map((thing) => this.renderLinked(thing))}
        `;
      });
  }

  private renderLinked(thing: Thing): TemplateResult {
    const layout = this.held ?? this.links;
    const area = linkedArea(layout, thing.scope);
    const entities = linkedEntities(layout, thing.scope);
    const selected = thing.key === this.selected;

    return html`
      <div
        class="thing linked ${thing.scope.type} ${selected ? 'selected' : ''}"
        data-key=${thing.key}
        @click=${(event: Event) => this.rowClicked(event, thing)}
      >
        <div class="thing-head">
          <button
            class="thing-main"
            aria-label=${`Change the links of ${thing.name}`}
            @click=${() => this.select(thing.key, true)}
          >
            <span class="kind">${icon(this.iconOf(thing))}</span>
            <span class="thing-name">${thing.shortName}</span>
          </button>
        </div>
        <div class="links">
          ${area ? this.renderAreaLink(thing, area) : nothing}
          ${entities.map((entityId) => this.renderLink(thing, entityId))}
        </div>
      </div>
    `;
  }

  private renderAreaLink(thing: Thing, area: string): TemplateResult {
    const name = this.hass?.areas[area]?.name ?? humanize(area);
    const gone = linkedArea(this.links, thing.scope) !== area;

    return html`
      <div class="link area ${gone ? 'gone' : ''}" data-area=${area}>
        <span class="link-text">
          <a
            href=${`/config/areas/area/${encodeURIComponent(area)}`}
            target="_blank"
            rel="noopener"
            >From the ${name} area in Home Assistant</a
          >
        </span>
        ${this.renderUnlink(`the ${name} area`, thing, gone, () =>
          setArea(this.links, thing.scope, ''),
        )}
      </div>
    `;
  }

  private renderLink(thing: Thing, entityId: string): TemplateResult {
    const state = this.hass?.states[entityId];
    const role = state
      ? entityRole(entityId, state, thing.scope.type)
      : 'Not found';
    const name = this.entityLabel(entityId);
    const gone = !linkedEntities(this.links, thing.scope).includes(entityId);
    const classes = ['link', state ? '' : 'missing', gone ? 'gone' : ''];

    return html`
      <div class=${classes.filter(Boolean).join(' ')} data-entity=${entityId}>
        <span class="link-text">
          <span class="link-head">
            <span class="link-role">${role}</span>
            <span class="link-state"
              >${state ? this.stateText(entityId) : ''}</span
            >
          </span>
          <span class="link-name">${name}</span>
        </span>
        ${this.renderUnlink(name, thing, gone, () =>
          unlinkEntity(this.links, thing.scope, entityId),
        )}
      </div>
    `;
  }

  private renderUnlink(
    what: string,
    thing: Thing,
    gone: boolean,
    without: () => SceneBinding[],
  ): TemplateResult {
    const label = `Unlink ${what} from ${thing.name}`;

    if (gone) return html`<span class="unlink-space"></span>`;

    return html`<button
      class="icon-btn unlink"
      aria-label=${label}
      title=${label}
      @click=${() => this.unlink(thing, without())}
    >
      ${icon('x')}
    </button>`;
  }

  private renderOpen(thing: Thing): TemplateResult {
    const offers = this.suggestions.get(thing.key) ?? [];
    const place =
      thing.scope.type !== 'room' && thing.roomName ? thing.roomName : '';

    return html`
      <div class="thing open" data-key=${thing.key}>
        <button
          class="thing-main"
          aria-label=${`Link ${thing.name}`}
          @click=${() => this.select(thing.key, true)}
        >
          <span class="kind">${icon(this.iconOf(thing))}</span>
          <span class="thing-text">
            <span class="thing-name">${thing.shortName}</span>
            ${place ? html`<span class="meta">${place}</span>` : nothing}
          </span>
        </button>
        ${
          offers.length > 0
            ? html`<div class="chips offers">
                ${offers.map(
                  (offer) => html`
                    <button
                      class="chip suggest ${offer.strong ? 'sure' : ''}"
                      aria-label=${`Link ${offer.name} to ${thing.name}`}
                      title=${offer.name}
                      @click=${() => this.accept(thing, offer)}
                    >
                      ${icon('plus', 14)}
                      <span class="chip-name">${offerLabel(offer, thing)}</span>
                    </button>
                  `,
                )}
              </div>`
            : nothing
        }
      </div>
    `;
  }

  private renderRenames(
    changes: EntityChanges,
  ): TemplateResult | typeof nothing {
    const renames = renamesOf(changes);

    if (renames.length === 0) return nothing;

    return html`
      <div class="changes renamed">
        <div class="notice">
          Renamed in Home Assistant. The card already follows the new names;
          update the links to keep them when you save.
        </div>
        <ul>
          ${renames.map(
            ({ from, to }) =>
              html`<li><code>${from}</code> is now <code>${to}</code></li>`,
          )}
        </ul>
        <button class="btn filled use-new-names" @click=${this.useNewNames}>
          Update the links
        </button>
      </div>
    `;
  }

  private renderUnresolved(
    changes: EntityChanges,
  ): TemplateResult | typeof nothing {
    const unresolved = unresolvedOf(changes);

    if (unresolved.length === 0) return nothing;

    return html`
      <div class="changes unresolved">
        <div class="notice error">
          Not found in Home Assistant. It may have been deleted: link another
          entity, or remove it.
        </div>
        <ul>
          ${unresolved.map(
            (entityId) => html`
              <li>
                <span>
                  <code>${entityId}</code>, linked to ${this.linkedTo(entityId)}
                </span>
                <button
                  class="btn danger"
                  @click=${() => this.forget(entityId)}
                >
                  Remove
                </button>
              </li>
            `,
          )}
        </ul>
      </div>
    `;
  }

  private get planView(): EstanzaPlanView | null {
    return this.renderRoot.querySelector('estanza-plan-view');
  }

  private get shownFloor(): string | null {
    const floors = this.floors;

    if (floors.length < 2) return null;
    if (this.floor && floors.some((floor) => floor.id === this.floor)) {
      return this.floor;
    }

    return this.openingFloor();
  }

  private openingFloor(): string | null {
    const floors = this.floors;
    const links = new Map<string, number>();

    for (const thing of this.things) {
      if (thing.floor && isLinked(this.links, thing.scope)) {
        links.set(thing.floor, (links.get(thing.floor) ?? 0) + 1);
      }
    }

    const cardFloor = this.home
      ? readFloorChoice(
          floorStorageKey(
            this.config ? (shareIdFromConfig(this.config) ?? '') : '',
            this.home,
          ),
        )
      : undefined;
    const shown = floors.find((floor) => floor.id === cardFloor);

    if (shown && (shown.rooms.length > 0 || links.has(shown.id))) {
      return shown.id;
    }

    return busiestFloor(floors, links);
  }

  private get overlay(): SceneOverlay {
    const hass = this.hass;

    if (!hass) return emptyOverlay();

    return sceneOverlayOf(mapScopeStates(hass, this.links));
  }

  private get units(): UnitSystem {
    return this.hass?.config?.unit_system?.temperature === '°F'
      ? 'imperial'
      : 'metric';
  }

  private entityLabel(entityId: string): string {
    return this.hass ? entityName(this.hass, entityId) : entityId;
  }

  private stateText(entityId: string): string {
    const hass = this.hass;

    return hass ? formatState(hass, hass.states[entityId]) : '';
  }

  private linkedTo(entityId: string): string {
    const binding = this.links.find((entry) =>
      bindingEntityIds(entry).includes(entityId),
    );

    if (binding) {
      const key = scopeKey(binding.scope);

      return (
        this.things.find((thing) => thing.key === key)?.name ??
        strayThing(binding.scope, this.missingName(binding.scope)).name
      );
    }

    return this.entityLabel(entityId);
  }

  private select(key: string | null, scroll = false): void {
    const thing = this.things.find((entry) => entry.key === key) ?? null;

    this.selected = thing?.key ?? null;
    this.relinkOpen = false;
    this.allCandidates = false;
    this.replacingEntity = null;
    this.otherAll = false;
    this.linkedNotice = '';

    if (thing?.floor && this.floors.length > 1) this.floor = thing.floor;

    this.point(thing?.scope ?? null);

    if (scroll && thing) void this.revealPicker();
  }

  private rowClicked(event: Event, thing: Thing): void {
    const target = event.target instanceof Element ? event.target : null;

    if (target?.closest('a, button')) return;

    this.select(thing.key, true);
  }

  private async revealPicker(): Promise<void> {
    await this.updateComplete;

    const picker = this.renderRoot.querySelector<HTMLElement>('.picker');

    picker?.scrollIntoView?.({ block: 'start', behavior: 'instant' });
  }

  private readonly onPlanSelect = (
    event: CustomEvent<ScopeSelectDetail>,
  ): void => {
    event.stopPropagation();

    const { scopeType, scopeId } = event.detail;

    this.select(`${scopeType}:${scopeId}`, true);
  };

  private readonly onPreviewPick = (event: Event): void => {
    const { scope } = (event as CustomEvent<PickDetail>).detail;

    this.select(scopeKey(scope), true);
  };

  private readonly onPlanDrawn = (): void => {
    this.drawn += 1;
  };

  private chooseFloor(id: string): void {
    this.floor = id;
  }

  private readonly closePicker = (): void => {
    this.select(null);
  };

  private readonly showAllCandidates = (): void => {
    this.allCandidates = true;
  };

  private readonly showAllOpen = (): void => {
    this.allOpen = true;
  };

  private toggle(candidate: Candidate): void {
    const thing = this.selectedThing;

    if (!thing) return;

    const replacing = this.replacingEntity;

    if (replacing) {
      this.swapHere(thing, replacing, candidate.entityId);

      if (replacing !== candidate.entityId && thing.scope.type !== 'room') {
        this.select(null);
      }

      return;
    }

    if (candidate.linked) {
      this.unlinkWithUndo(
        unlinkEntity(this.links, thing.scope, candidate.entityId),
      );

      return;
    }

    this.linkHere(thing, candidate.entityId);

    if (thing.scope.type !== 'room') this.select(null);
  }

  private linkHere(thing: Thing, entityId: string): void {
    this.placeHere(thing, entityId, (links) =>
      moveEntity(links, thing.scope, entityId),
    );
  }

  private swapHere(thing: Thing, oldId: string, newId: string): void {
    this.replacingEntity = null;

    if (oldId === newId) return;

    this.placeHere(thing, newId, (links) =>
      swapEntity(links, thing.scope, oldId, newId),
    );
  }

  private placeHere(
    thing: Thing,
    entityId: string,
    change: (links: SceneBinding[]) => SceneBinding[],
  ): void {
    const before = this.links;
    const holder = holderOf(before, entityId, thing.scope);

    this.relinkTo(change(before));
    this.justLinked = thing.key;

    if (holder) {
      this.offerUndo(`Moved from ${this.nameOf(holder)}.`, before);
    }
  }

  private startReplacing(entityId: string): void {
    this.replacingEntity = entityId;
  }

  private readonly stopReplacing = (): void => {
    this.replacingEntity = null;
  };

  private readonly showOtherAll = (): void => {
    this.otherAll = true;
  };

  private offerUndo(words: string, before: SceneBinding[]): void {
    this.showUndo({
      words,
      restore: () => this.relinkTo(before),
    });
  }

  private showUndo(toast: UndoToast): void {
    this.dismissUndo();
    this.undo = toast;
    this.undoTimer = setTimeout(() => this.dismissUndo(), UNDO_MS);
  }

  private readonly toastHold: ToastHold = {
    hold: () => {
      clearTimeout(this.undoTimer);
      this.undoTimer = undefined;
    },
    release: () => {
      if (!this.undo || this.undoTimer !== undefined) return;

      this.undoTimer = setTimeout(() => this.dismissUndo(), UNDO_MS);
    },
  };

  private dismissUndo(): void {
    clearTimeout(this.undoTimer);
    this.undoTimer = undefined;
    this.undo = null;
    this.held = null;
  }

  private nameOf(scope: SceneScope): string {
    const key = scopeKey(scope);
    const listed = this.things.find((thing) => thing.key === key);

    if (listed) return listed.shortName;

    return isWordId(scope.id)
      ? humanize(scope.id)
      : strayThing(scope, null).name;
  }

  private missingName(scope: SceneScope): string | null {
    const [entityId] = linkedEntities(this.links, scope);

    return entityId && this.hass?.states[entityId]
      ? this.entityLabel(entityId)
      : null;
  }

  private iconOf(thing: Thing): IconName {
    const garage = linkedEntities(this.links, thing.scope).some(
      (entityId) =>
        entityIcon(entityId, this.hass?.states[entityId]) === 'garage',
    );

    return thing.scope.type === 'door' && garage ? 'garage' : thingIcon(thing);
  }

  private readonly areaChanged = (event: HaFormValueChanged): void => {
    event.stopPropagation();

    const thing = this.selectedThing;

    if (!thing) return;

    this.relinkTo(
      setArea(this.links, thing.scope, readString(event.detail.value.area_id)),
    );
  };

  private readonly actionChanged = (event: HaFormValueChanged): void => {
    event.stopPropagation();

    const thing = this.selectedThing;

    if (!thing) return;

    const kind = this.kindOf(thing);
    const chosen = actionsFor(this.links, thing.scope);
    let links = this.links;

    for (const trigger of triggers) {
      const wanted = readString(event.detail.value[`${trigger}_action`]);

      if (wanted === shownDeed(kind, trigger, chosen[trigger])) continue;

      const deed =
        deedChoices(kind, trigger).find((choice) => choice === wanted) ??
        defaultDeed(kind, trigger);
      const action =
        deed === defaultDeed(kind, trigger) ? undefined : actionOf(deed);

      links = setThingAction(links, thing.scope, trigger, action);
    }

    this.relinkTo(links);
  };

  private readonly otherChanged = (event: HaFormValueChanged): void => {
    event.stopPropagation();

    const thing = this.selectedThing;
    const entityId = readString(event.detail.value.other_entity);

    if (!thing || !entityId) return;

    if (this.replacingEntity) {
      this.swapHere(thing, this.replacingEntity, entityId);

      return;
    }

    this.linkHere(thing, entityId);
  };

  private unlink(thing: Thing, links: SceneBinding[]): void {
    if (this.selected === thing.key && !isLinked(links, thing.scope)) {
      this.select(null);
    }

    this.unlinkWithUndo(links);
  }

  private unlinkWithUndo(links: SceneBinding[]): void {
    const before = this.links;

    this.relinkTo(links);
    this.offerUndo('Unlinked.', before);
    this.held = before;
  }

  private accept(thing: Thing, suggestion: Suggestion): void {
    this.relinkTo(applySuggestion(this.links, thing.scope, suggestion));
    this.justLinked = thing.key;
    this.linkedNotice = `Linked ${thing.name}.`;
  }

  private readonly askLinkAll = (): void => {
    this.confirmingAll = true;
  };

  private readonly cancelLinkAll = (): void => {
    this.confirmingAll = false;
  };

  private readonly linkAll = (): void => {
    const suggestions = this.suggestions;
    let links = this.links;
    let count = 0;

    for (const thing of this.listedThings) {
      const sure = (suggestions.get(thing.key) ?? []).filter(
        (suggestion) => suggestion.strong,
      );

      for (const suggestion of sure) {
        links = applySuggestion(links, thing.scope, suggestion);
      }

      if (sure.length > 0) count += 1;
    }

    this.confirmingAll = false;
    this.justLinked = null;
    this.relinkTo(links);
    this.linkedNotice = `Linked ${plural(count, 'thing')}.`;
  };

  private relinkTo(links: SceneBinding[]): void {
    if (JSON.stringify(links) === JSON.stringify(this.links)) return;

    this.dismissUndo();
    this.links = links;
    this.emit();
  }

  private readonly useNewNames = (): void => {
    const config = this.linkedConfig;

    if (!config) return;

    const renames = new Map(
      renamesOf(this.changes).map(({ from, to }) => [from, to]),
    );

    this.relink(applyChanges(config, renames));
  };

  private forget(entityId: string): void {
    const config = this.linkedConfig;

    if (!config) return;

    this.relink(rewriteConfig(config, (id) => (id === entityId ? null : id)));
  }

  private relink(config: EstanzaCardConfig): void {
    this.dismissUndo();
    this.config = config;
    this.links = config.bindings;
    this.emit();
  }

  private followRegistry(): void {
    const config = this.linkedConfig;
    const hass = this.hass;

    if (!config || !hass) return;

    const unsettled = unsettledLinks(config, hass.states, this.registry);

    this.registry = refreshRegistry(
      this.registry,
      hass,
      unsettled,
      Date.now(),
      (next) => {
        this.registry = next;
      },
    );
  }

  private point(scope: SceneScope | null): void {
    window.dispatchEvent(
      new CustomEvent<HighlightDetail>(highlightEvent, { detail: { scope } }),
    );
  }

  private readonly shareChanged = (event: HaFormValueChanged): void => {
    event.stopPropagation();

    if (!this.config) return;

    const share = readString(event.detail.value.share).trim();
    const link = looksLikeUrl(share);

    this.fileError = '';
    this.config = {
      ...this.config,
      share_url: link ? share : undefined,
      share_id: share && !link ? share : undefined,
      home_document: share ? undefined : this.config.home_document,
    };

    this.emit();
    void this.loadDocument();
  };

  private readonly cardChanged = (event: HaFormValueChanged): void => {
    event.stopPropagation();

    if (!this.config) return;

    const title = readString(event.detail.value.title).trim();
    const path = readString(event.detail.value.navigation_path).trim();

    this.config = {
      ...this.config,
      title: title || undefined,
      navigation_path: path || undefined,
    };

    this.emit();
  };

  private chooseNight(source: NightSource): void {
    if (!this.config) return;

    this.config = {
      ...this.config,
      night: source === DEFAULT_NIGHT ? undefined : source,
    };

    this.emit();
  }

  private chooseQuality(tier: QualityTier): void {
    if (!this.config) return;

    this.config = {
      ...this.config,
      quality: tier === 'auto' ? undefined : tier,
    };

    this.emit();
  }

  private chooseOtherFloors(mode: OtherFloors): void {
    if (!this.config) return;

    this.config = {
      ...this.config,
      other_floors: mode === DEFAULT_OTHER_FLOORS ? undefined : mode,
    };

    this.emit();
  }

  private chooseCables(shown: CablesShown): void {
    if (!this.config) return;

    this.config = {
      ...this.config,
      show_cables: shown === 'shown' ? true : undefined,
    };

    this.emit();
  }

  private readonly chooseFile = (): void => {
    this.renderRoot
      .querySelector<HTMLInputElement>('input[type="file"]')
      ?.click();
  };

  private readonly fileChosen = async (event: Event): Promise<void> => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file || !this.config) return;

    const home = readHomeFile(await file.text());

    input.value = '';

    if (!home) {
      this.fileError = notHomeFile;

      return;
    }

    this.fileError = '';
    this.config = {
      ...this.config,
      share_url: undefined,
      share_id: undefined,
      home_document: home,
    };

    this.emit();
    void this.loadDocument();
  };

  private readonly replaceHome = (): void => {
    this.replacing = true;
  };

  private readonly keepHome = (): void => {
    this.replacing = false;
    this.fileError = '';
  };

  private readonly askRemoveHome = (): void => {
    this.confirmingRemove = true;
  };

  private readonly cancelRemoveHome = (): void => {
    this.confirmingRemove = false;
  };

  private removeHome(name: string): void {
    const before = this.linkedConfig;

    this.confirmingRemove = false;

    if (!this.config || !before) return;

    this.select(null);
    this.relink({
      ...this.config,
      share_url: undefined,
      share_id: undefined,
      home_document: undefined,
      bindings: [],
    });
    void this.loadDocument();

    this.showUndo({
      words: `Removed ${name}.`,
      restore: () => {
        this.relink(before);
        void this.loadDocument();
      },
    });
  }

  private readonly reload = (): void => {
    this.loadedShareId = '';
    this.loadedDocument = null;

    void this.loadDocument();
  };

  private emit(): void {
    if (!this.config) return;

    const bindings = this.links;

    this.emitted = JSON.stringify(bindings);

    const linked: EstanzaCardConfig = { ...this.config, bindings };
    const config: EstanzaCardConfig = {
      ...linked,
      registry_ids: registryIdsFor(linked, this.registry),
    };

    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: { config },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async loadDocument(): Promise<void> {
    const config = this.config;

    if (!config) return;

    const inline = config.home_document;

    if (inline) {
      if (inline === this.loadedDocument) return;

      this.loadedShareId = '';
      this.loadedDocument = inline;

      await this.readInto(config, () => this.loadedDocument === inline);

      return;
    }

    const shareId = shareIdFromConfig(config);

    if (!shareId) {
      this.loadedShareId = '';
      this.loadedDocument = null;
      this.showHome(null);
      this.status = 'idle';
      this.verdict = 'ok';

      return;
    }

    if (shareId === this.loadedShareId) return;

    this.loadedDocument = null;
    this.loadedShareId = shareId;

    await this.readInto(config, () => this.loadedShareId === shareId);
  }

  private async readInto(
    config: EstanzaCardConfig,
    current: () => boolean,
  ): Promise<void> {
    this.status = 'loading';
    this.verdict = 'ok';

    try {
      const home = await this.documentLoader(config, (update) => {
        if (current()) this.verdict = update;
      });

      if (!current()) return;
      if (homeTooNew(home)) this.verdict = 'required';

      const parsed = homeDocumentSchema.safeParse(home);
      const readable = parsed.success && this.verdict !== 'required';

      this.showHome(readable ? parsed.data : null);
      this.status = 'ready';
    } catch {
      if (!current()) return;

      this.showHome(null);
      this.status = 'failed';
    }
  }

  private showHome(home: HomeDocument | null): void {
    if (home === this.home) return;

    this.home = home;
    this.floors = home ? deriveFloors(home) : [];
    this.floor = null;
    this.drawn = 0;
    this.replacing = false;
    this.selected = null;
    this.justLinked = null;
  }
}

type Advice = {
  suggestions: Map<string, Suggestion[]>;
  areas: Map<string, Suggestion[]>;
};

function badgeAt(thing: Thing, at: Point): SVGTemplateResult {
  return svg`
    <g class="badge-mark" data-key=${thing.key} transform=${`translate(${at.x} ${at.y})`}>
      <circle class="badge" r=${MARK_RADIUS_PX}></circle>
      <path class="tick" d="M-5.3 0.7 L-1.6 4.3 L5.3 -3.5"></path>
    </g>
  `;
}

function targetAt(
  thing: Thing,
  at: Point,
  linked: boolean,
  glyph: IconName,
): SVGTemplateResult {
  const corner = -MARK_GLYPH_PX / 2;

  return svg`
    <g class="target ${linked ? 'linked' : 'open'}" data-key=${thing.key} transform=${`translate(${at.x} ${at.y})`}>
      <circle r=${MARK_RADIUS_PX}></circle>
      <g transform=${`translate(${corner} ${corner})`}>
        ${icon(glyph, MARK_GLYPH_PX)}
      </g>
    </g>
  `;
}

function roomed(thing: Thing): thing is Thing & { room: string } {
  return (
    thing.room !== null &&
    (thing.scope.type === 'light' || thing.scope.type === 'prop')
  );
}

function thingIcon(thing: Thing): IconName {
  if (thing.scope.type !== 'prop') return scopeIcons[thing.scope.type];

  const noun = (
    thing.name
      .replace(/\(.*\)/g, '')
      .toLowerCase()
      .match(/[a-z]+/g) ?? []
  )
    .reverse()
    .find((word) => Object.hasOwn(propIcons, word));

  return noun ? propIcons[noun] : scopeIcons.prop;
}

function entityIcon(
  entityId: string,
  state: HassEntityState | undefined,
): IconName {
  const deviceClass = state ? deviceClassOf(state) : null;

  return (
    (deviceClass ? classIcons[deviceClass] : undefined) ??
    domainIcons[entityDomain(entityId)] ??
    'box'
  );
}

function strayThing(scope: SceneScope, entityName: string | null): Thing {
  const kind = scopeLabels[scope.type].toLowerCase();
  const name = entityName
    ? `${entityName} (missing ${kind})`
    : isWordId(scope.id)
      ? `${scopeLabels[scope.type]} ${humanize(scope.id)}`
      : `Removed ${kind}`;

  return {
    scope,
    key: scopeKey(scope),
    name,
    shortName: name,
    room: null,
    roomName: '',
    floor: null,
    entrance: false,
  };
}

function missingLabel(scope: SceneScope): string {
  return `the missing ${scopeLabels[scope.type].toLowerCase()}`;
}

function dedupeThings(things: Thing[]): Thing[] {
  return [...new Map(things.map((thing) => [thing.key, thing])).values()];
}

function offerLabel(suggestion: Suggestion, thing: Thing): string {
  if (suggestion.kind === 'area') return `${suggestion.name} area`;
  if (thing.scope.type !== 'room') return suggestion.name;

  return shortName(suggestion.name, [thing.roomName]);
}

function isStorage(thing: Thing): boolean {
  return thing.scope.type === 'room' && isStorageRoom(thing.name);
}

function inPlanOrder(listed: Thing[], things: Thing[]): Thing[] {
  const floors = [...new Set(things.map((thing) => thing.floor))];
  const rooms = things.filter((thing) => thing.scope.type === 'room');
  const roomRank = new Map(
    rooms.map((room, index) => [
      room.room,
      isStorage(room) ? rooms.length + index : index,
    ]),
  );
  const index = new Map(things.map((thing, at) => [thing.key, at]));
  const place = (thing: Thing): number[] => [
    floors.indexOf(thing.floor),
    roomRank.get(thing.room) ?? 2 * rooms.length,
    index.get(thing.key) ?? things.length,
  ];

  return [...listed].sort((a, b) => {
    const right = place(b);

    return place(a).reduce((order, value, at) => order || value - right[at], 0);
  });
}

function sameInputs(next: unknown[], previous: unknown[]): boolean {
  return (
    next.length === previous.length &&
    next.every((value, index) => value === previous[index])
  );
}

function homeDocumentOf(payload: unknown): unknown {
  const body = asRecord(payload);

  if (!body) return payload;

  const home = asRecord(body.home);

  if (home?.document) return home.document;

  return body.document ?? payload;
}

function looksLikeUrl(value: string): boolean {
  return value.includes('://') || value.includes('/');
}

function plural(count: number, noun: string, nouns = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : nouns}`;
}

function shownDeed(
  kind: ControlKind,
  trigger: Trigger,
  action: ThingAction | undefined,
): string {
  return action && !cardDeedOf(action)
    ? SET_IN_YAML
    : deedOf(kind, trigger, action);
}

function computeLabel(schema: HaFormSchemaEntry): string {
  return editorLabels[schema.name] ?? schema.name;
}

function computeHelper(schema: HaFormSchemaEntry): string | undefined {
  return editorHelpers[schema.name];
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

declare global {
  interface HTMLElementTagNameMap {
    'estanza-card-editor': EstanzaCardEditor;
  }
}
