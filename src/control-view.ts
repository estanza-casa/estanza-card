import { DEFAULT_LIGHT_COLOR } from '@estanza/plan-engine/document';
import { tokens } from '@estanza/tokens';
import {
  css,
  type CSSResult,
  html,
  nothing,
  svg,
  type TemplateResult,
  unsafeCSS,
} from 'lit';

import {
  type Control,
  type ControlKind,
  type CoverMove,
  isActive,
  isLocked,
  isOn,
  LOCK_CONFIRM_MS,
} from './control.js';
import type { Point } from './gesture.js';
import {
  deviceClassOf,
  entityDomain,
  type HassEntityState,
  humidityDeviceClass,
  lightColorPresets,
  type ScopeState,
  temperatureDeviceClass,
} from './hass-state.js';
import { icon, type IconName, scopeIcons } from './icons.js';
import type { LabelSize, Theme } from './living.js';
import { sheetNamesTemplate } from './names.js';
import type { SceneGesture } from './scene-view.js';
import { type Dock, SHEET_WIDTH_PX } from './sheet.js';

export const markPhases = ['pending', 'confirmed', 'failed', 'armed'] as const;

export type MarkPhase = (typeof markPhases)[number];

export const ARMED_BOX: LabelSize = { width: 88, height: 44 };
export const SHEET_FADE_MS = 150;

const HIT_PX = tokens.layout.minHitTarget;
const FINE_PX = tokens.control.iconSm.height.base;
const COARSE_PX = tokens.control.sm.height.base;
const CHIP_INSET_PX = 4;
const BORDER_PX = 1;

export const openingLooks = ['open', 'shut'] as const;

export type OpeningLook = (typeof openingLooks)[number];

export const tones = ['lamp', 'accent', 'lock'] as const;

export type Tone = (typeof tones)[number];

export type MarkView = {
  control: Control;
  at: Point;
  under: boolean;
  phase: MarkPhase | null;
  selected: boolean;
  lamp: string | null;
  opening: OpeningLook | null;
  pointer: MarkPointer | null;
  onConfirm: () => void;
  onKey: (gesture: SceneGesture) => void;
};

export type MarkPointer = {
  down: (event: PointerEvent) => void;
  move: (event: PointerEvent) => void;
  up: (event: PointerEvent) => void;
  cancel: () => void;
};

export type Toast = {
  message: string;
  retry: (() => void) | null;
};

export type RoomRow = {
  key: string | null;
  entityId: string;
  kind: 'door' | 'window';
  icon: IconName;
  tone: Tone | null;
  name: string;
  state: string;
  armed: ArmedRow | null;
};

export type ArmedRow = {
  label: string;
  prompt: string;
  from: IconName;
  to: IconName;
};

export type DeviceRow = {
  key: string;
  entityId: string | null;
  kind: ControlKind;
  icon: IconName;
  name: string;
  state: string;
  lamp: string | null;
  on: boolean;
  tone: Tone | null;
  toggles: boolean;
};

export type SheetSwipe = {
  down: (event: PointerEvent) => void;
  move: (event: PointerEvent) => void;
  up: (event: PointerEvent) => void;
  cancel: () => void;
};

export type SheetActions = {
  close: () => void;
  swipe: SheetSwipe;
  more: (entityId: string) => void;
  reach: (key: string) => void;
  act: (row: RoomRow) => void;
  toggle: () => void;
  device: (key: string) => void;
  draft: (percent: number) => void;
  brightness: (percent: number) => void;
  white: (kelvin: number) => void;
  position: (percent: number) => void;
  cover: (move: CoverMove) => void;
};

export type SheetView = {
  control: Control;
  scopeState: ScopeState;
  title: string;
  spot: Dock | null;
  phase: MarkPhase | null;
  draft: number | null;
  lamp: string;
  lampChip: boolean;
  temperature: string | null;
  humidity: string | null;
  devices: DeviceRow[];
  rows: RoomRow[];
  alerts: AlertRow[];
};

export type AlertRow = {
  entityId: string;
  icon: IconName;
  name: string;
  state: string;
};

const garageClasses = ['garage', 'garage_door'];

const WHITE_MATCH = 24;

const colourModes = ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'];
const dimmableModes = [...colourModes, 'brightness', 'color_temp', 'white'];

function keepFocus(event: MouseEvent): void {
  event.preventDefault();
}

function holdKey(event: KeyboardEvent): boolean {
  return event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
}

export function markTemplate(view: MarkView): TemplateResult {
  const { control, phase } = view;
  const padlock = lockLook(control);
  const dot =
    view.opening === 'shut' &&
    !phase &&
    !view.selected &&
    control.kind !== 'lock';
  const lamp = control.scope.type === 'light';
  const plug = control.kind === 'switch' && !lamp;
  const classes = [
    'mark',
    control.kind,
    padlock ?? '',
    phase ?? '',
    view.selected ? 'selected' : '',
    control.unavailable ? 'unavailable' : '',
    plug ? 'plug' : '',
    (lamp || plug) && isOn(control) ? 'on' : '',
    view.opening ? 'opening' : '',
    view.opening === 'open' ? 'open' : '',
    dot ? 'dot' : '',
    view.under ? 'under' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const armed = phase === 'armed';
  const label = armed
    ? `${armedVerb(control)} ${control.name}`
    : padlock
      ? `${control.name}, ${padlock}`
      : control.name;

  return html`<button
    class=${classes}
    data-key=${control.key}
    data-tone=${toneOf(control, view.opening) ?? nothing}
    style="left:${view.at.x}px;top:${view.at.y}px;${
      view.lamp ? `--lamp:${view.lamp}` : ''
    }"
    aria-label=${label}
    title=${label}
    @click=${(event: MouseEvent) => {
      if (armed) view.onConfirm();
      else if (event.detail === 0) view.onKey('tap');
    }}
    @keydown=${(event: KeyboardEvent) => {
      if (!holdKey(event)) return;

      event.preventDefault();
      view.onKey('press');
    }}
    @mousedown=${keepFocus}
    @pointerdown=${view.pointer?.down ?? null}
    @pointermove=${view.pointer?.move ?? null}
    @pointerup=${view.pointer?.up ?? null}
    @pointercancel=${view.pointer?.cancel ?? null}
  >
    <span class="disc"
      >${armed ? armedTurn(control, view.opening) : nothing}${
        dot || armed
          ? nothing
          : icon(markIcon(control, false, view.opening), 16)
      }${
        phase === 'failed'
          ? html`<span class="bad">${icon('triangle-alert', 11)}</span>`
          : nothing
      }${ring()}</span
    >
  </button>`;
}

function armedTurn(
  control: Control,
  opening: OpeningLook | null,
): TemplateResult {
  return html`${icon(markIcon(control, false, opening), 16)}<span
      class="turn"
    ></span
    >${icon(markIcon(control, true, opening), 16)}<span
      class="drain"
      style="animation-duration:${LOCK_CONFIRM_MS}ms"
    ></span>`;
}

export type LeaderView = { key: string; at: Point; anchor: Point };

export type BubbleView = {
  key: string;
  at: Point;
  icon: IconName | null;
  count: number;
  label: string;
  under: boolean;
  selected: boolean;
  onOpen: (event: MouseEvent) => void;
};

export type ChoiceRow = {
  key: string;
  icon: IconName;
  name: string;
  state: string;
  lamp: string | null;
  on: boolean;
  tone: Tone | null;
};

export type ChooserView = {
  title: string;
  rows: ChoiceRow[];
  spot: Dock | null;
};

export type ChooserActions = {
  close: () => void;
  choose: (key: string) => void;
  swipe: SheetSwipe;
};

export function leadersTemplate(
  leaders: readonly LeaderView[],
): TemplateResult | typeof nothing {
  if (leaders.length === 0) return nothing;

  return html`<svg class="mark-leaders" aria-hidden="true">
    ${leaders.map(
      ({ key, at, anchor }) => svg`<g class="mark-leader" data-key=${key}>
        <line class="halo" x1=${at.x} y1=${at.y} x2=${anchor.x} y2=${anchor.y}></line>
        <line x1=${at.x} y1=${at.y} x2=${anchor.x} y2=${anchor.y}></line>
        <circle cx=${anchor.x} cy=${anchor.y} r="2.5"></circle>
      </g>`,
    )}
  </svg>`;
}

export function bubbleTemplate(view: BubbleView): TemplateResult {
  const classes = [
    'bubble',
    view.under ? 'under' : '',
    view.selected ? 'selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return html`<button
    class=${classes}
    data-key=${view.key}
    style="left:${view.at.x}px;top:${view.at.y}px"
    aria-label=${view.label}
    title=${view.label}
    aria-haspopup="dialog"
    aria-expanded=${String(view.selected)}
    @click=${view.onOpen}
  >
    <span class="disc"
      >${view.icon ? icon(view.icon, 14) : nothing}<span class="count"
        >${view.count}</span
      ></span
    >
  </button>`;
}

export function chooserTemplate(
  view: ChooserView,
  actions: ChooserActions,
): TemplateResult {
  const { spot } = view;

  return html`<div
    class="sheet chooser ${spot ? '' : 'bottom'}"
    role="dialog"
    aria-labelledby="sheet-title"
    style=${dockStyle(spot)}
    @pointerdown=${actions.swipe.down}
    @pointermove=${actions.swipe.move}
    @pointerup=${actions.swipe.up}
    @pointercancel=${actions.swipe.cancel}
  >
    ${spot ? nothing : html`<div class="grip"></div>`}
    <div class="sheet-head">
      ${sheetNamesTemplate(view.title)} ${tool('x', 'Close', actions.close)}
    </div>
    <div class="choices">
      ${view.rows.map(
        (row) =>
          html`<button
            class="choice"
            data-key=${row.key}
            aria-pressed=${String(row.on)}
            data-tone=${row.tone ?? nothing}
            style=${row.lamp ? `--lamp:${row.lamp}` : ''}
            @click=${() => actions.choose(row.key)}
          >
            <span class="lamp-icon">${icon(row.icon, 18)}</span>
            <span class="choice-name">${row.name}</span>
            <span class="choice-state">${row.state}</span>
          </button>`,
      )}
    </div>
  </div>`;
}

export function toastTemplate(
  toast: Toast,
  onRetry: () => void,
): TemplateResult {
  return html`<div class="toast" role="status">
    <span class="toast-icon">${icon('triangle-alert', 18)}</span>
    <span class="toast-text">${toast.message}</span>
    ${
      toast.retry
        ? html`<button
            class="tb plain"
            data-act="retry"
            aria-label="Try again"
            title="Try again"
            @click=${onRetry}
          >
            ${icon('refresh-cw', 18)}
          </button>`
        : nothing
    }
  </div>`;
}

function dockStyle(spot: Dock | null): string {
  if (!spot) return '';

  return `left:${spot.x}px;top:${spot.y}px;width:${spot.width}px;max-height:${spot.room}px`;
}

export function sheetTemplate(
  view: SheetView,
  actions: SheetActions,
): TemplateResult {
  const { control, spot } = view;
  const body =
    control.kind === 'room'
      ? roomBody(view, actions)
      : control.kind === 'cover'
        ? coverBody(view, actions)
        : lightBody(view, actions);

  return html`<div
    class="sheet ${spot ? '' : 'bottom'} ${
      control.kind === 'room' ? 'room' : ''
    } ${
      control.kind === 'room' && view.rows.length + view.devices.length > 0
        ? 'rows'
        : ''
    }"
    data-kind=${control.kind === 'switch' ? 'light' : control.kind}
    role="dialog"
    aria-labelledby="sheet-title"
    style=${dockStyle(spot)}
    @pointerdown=${actions.swipe.down}
    @pointermove=${actions.swipe.move}
    @pointerup=${actions.swipe.up}
    @pointercancel=${actions.swipe.cancel}
  >
    ${spot ? nothing : html`<div class="grip"></div>`}
    <div class="sheet-head">
      ${sheetNamesTemplate(view.title)} ${tool('x', 'Close', actions.close)}
    </div>
    ${body}
  </div>`;
}

function lightBody(view: SheetView, actions: SheetActions): TemplateResult {
  const { control } = view;
  const state = control.states[0];
  const modes = colourModesOf(state);
  const dimmable =
    control.kind === 'light' &&
    (modes.length === 0 || modes.some((mode) => dimmableModes.includes(mode)));
  const coloured = modes.some((mode) => colourModes.includes(mode));
  const whites = coloured || modes.includes('color_temp');
  const percent = view.draft ?? brightnessOf(control);
  const white = reportedWhite(state);
  const entityId = control.entityIds[0] ?? '';
  const plug = control.kind === 'switch' && control.scope.type !== 'light';
  const power = tool(
    'power',
    'Power',
    actions.toggle,
    isOn(control),
    'power',
    plug ? 'plug' : '',
  );
  const level = view.draft !== null || isOn(control) ? `${percent}%` : 'Off';

  return html`
    ${
      dimmable
        ? html`<div class="level">
            ${power}
            <div class="bar">
              <div class="track">
                <div class="pct">${level}</div>
                <div
                  class="fill"
                  style="width:${percent}%;background:${view.lamp}"
                >
                  <div class="pct" aria-hidden="true">${level}</div>
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                .value=${String(percent)}
                aria-label="Brightness"
                title="Brightness"
                @input=${(event: Event) => actions.draft(rangeValue(event))}
                @change=${(event: Event) =>
                  actions.brightness(rangeValue(event))}
              />
            </div>
          </div>`
        : html`<div class="level">
            ${power}
            <span class="power-state ${isOn(control) ? 'on' : ''}"
              >${lampState(control)}</span
            >
          </div>`
    }
    <div class="tools light-tools">
      ${
        whites
          ? lightColorPresets.map(
              (preset) =>
                html`<button
                  class="tb swatch"
                  data-act="white"
                  aria-label=${preset.name}
                  title=${preset.name}
                  aria-pressed=${String(
                    isOn(control) && white === preset.kelvin,
                  )}
                  @click=${() => actions.white(preset.kelvin)}
                >
                  <span style="background:${whiteOf(preset.kelvin)}"></span>
                </button>`,
            )
          : nothing
      }
      ${
        coloured
          ? tool(
              'palette',
              'Colour',
              () => actions.more(entityId),
              null,
              'colour',
            )
          : nothing
      }
      ${tool('ellipsis', 'More settings', () => actions.more(entityId), null, 'more')}
    </div>
  `;
}

function coverBody(view: SheetView, actions: SheetActions): TemplateResult {
  const { control } = view;
  const position = view.draft ?? positionOf(control.states[0]);
  const words = coverWords(control.states[0], view.draft, position);
  const entityId = control.entityIds[0] ?? '';

  return html`
    <div class="bar">
      <div class="track">
        <div class="slats"></div>
        <div class="fill cover-fill" style="width:${100 - position}%"></div>
        <div class="pct">${words}</div>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        .value=${String(position)}
        aria-label="Position"
        title="Position"
        @input=${(event: Event) => actions.draft(rangeValue(event))}
        @change=${(event: Event) => actions.position(rangeValue(event))}
      />
    </div>
    <div class="tools cover-tools">
      ${tool('arrow-up', 'Open', () => actions.cover('open'))}
      ${tool('pause', 'Stop', () => actions.cover('stop'))}
      ${tool('arrow-down', 'Shut', () => actions.cover('close'))}
      ${tool('ellipsis', 'More settings', () => actions.more(entityId), null, 'more')}
    </div>
  `;
}

function roomBody(view: SheetView, actions: SheetActions): TemplateResult {
  const lights = view.lampChip;
  const line = lights || view.temperature !== null || view.humidity !== null;

  if (
    !line &&
    view.rows.length === 0 &&
    view.devices.length === 0 &&
    view.alerts.length === 0
  ) {
    return html``;
  }

  return html`<div class="room-body">
    ${view.alerts.length > 0 ? alertRows(view, actions) : nothing}
    ${line ? roomLine(view, actions, lights) : nothing}
    ${view.devices.length > 0 ? deviceRows(view, actions) : nothing}
    ${view.rows.length > 0 ? openingRows(view, actions) : nothing}
  </div>`;
}

function alertRows(view: SheetView, actions: SheetActions): TemplateResult {
  return html`<div class="openings alerts">
    ${view.alerts.map(
      (row) =>
        html`<button
          class="readout row alert"
          data-alert=${row.entityId}
          @click=${() => actions.more(row.entityId)}
        >
          <span class="row-icon"
            ><span class="lamp-icon">${icon(row.icon, 16)}</span></span
          ><span class="row-text"
            >${row.name} <span class="row-state">${row.state}</span></span
          >
        </button>`,
    )}
  </div>`;
}

function deviceRows(view: SheetView, actions: SheetActions): TemplateResult {
  return html`
    <div class="devices">
      ${view.devices.map(
        (row) =>
          html`<div class="device" data-row=${row.kind} data-key=${row.key}>
            ${
              row.toggles
                ? html`<button
                    class="device-toggle ${row.kind === 'switch' && !row.lamp ? 'plug' : ''}"
                    data-act="device-toggle"
                    aria-label=${row.name}
                    title=${row.name}
                    aria-pressed=${String(row.on)}
                    data-tone=${row.tone ?? nothing}
                    style=${row.lamp ? `--lamp:${row.lamp}` : ''}
                    @click=${() => actions.device(row.key)}
                  >
                    <span class="lamp-icon">${icon(row.icon, 18)}</span>
                  </button>`
                : html`<span
                    class="device-icon"
                    data-tone=${row.tone ?? nothing}
                    style=${row.lamp ? `--lamp:${row.lamp}` : ''}
                    ><span class="lamp-icon">${icon(row.icon, 18)}</span></span
                  >`
            }
            <button
              class="readout device-name"
              @click=${() => {
                if (row.entityId) actions.more(row.entityId);
                else actions.reach(row.key);
              }}
            >
              <span class="row-text"
                >${row.name} <span class="row-state">${row.state}</span></span
              >
            </button>
          </div>`,
      )}
    </div>
  `;
}

function roomLine(
  view: SheetView,
  actions: SheetActions,
  lights: boolean,
): TemplateResult {
  const { control } = view;

  return html`<div class="room-line">
    ${
      view.temperature === null
        ? nothing
        : html`<div class="readout temperature">
            ${icon('thermometer', 16)}<span>${view.temperature}</span>
          </div>`
    }
    ${
      view.humidity === null
        ? nothing
        : html`<div class="readout humidity">
            ${icon('droplet', 16)}<span>${view.humidity}</span>
          </div>`
    }
    ${
      lights
        ? html`<button
            class="lamp ${view.phase ?? ''}"
            data-act="room-toggle"
            aria-label="${view.title} lights"
            title="${view.title} lights"
            aria-pressed=${String(isOn(control))}
            style="--lamp:${view.lamp}"
            @click=${actions.toggle}
          >
            <span class="lamp-icon">${icon('lightbulb', 20)}${ring()}</span>
            <span class="lamp-state">${lampState(control)}</span>
          </button>`
        : nothing
    }
  </div>`;
}

function openingRows(view: SheetView, actions: SheetActions): TemplateResult {
  return html`
    <div class="openings">
      ${view.rows.map(
        (row) =>
          html`<button
            class="readout row ${row.armed ? 'armed' : ''}"
            data-row=${row.kind}
            data-key=${row.key ?? nothing}
            aria-label=${row.armed?.label ?? nothing}
            @click=${() => actions.act(row)}
          >
            <span
              class="row-icon"
              data-tone=${row.armed ? nothing : (row.tone ?? nothing)}
              >${
                row.armed
                  ? html`${icon(row.armed.from, 16)}<span class="turn"></span
                      >${icon(row.armed.to, 16)}`
                  : html`<span class="lamp-icon">${icon(row.icon, 16)}</span>`
              }</span
            ><span class="row-text"
              >${row.name}
              ${
                row.armed
                  ? html`<span class="row-state">${row.armed.prompt}</span>`
                  : row.state
                    ? html`<span class="row-state">${row.state}</span>`
                    : nothing
              }</span
            >${
              row.armed
                ? html`<span
                    class="drain"
                    style="animation-duration:${LOCK_CONFIRM_MS}ms"
                  ></span>`
                : nothing
            }
          </button>`,
      )}
    </div>
  `;
}

function tool(
  name: IconName,
  label: string,
  onClick: () => void,
  pressed: boolean | null = null,
  act = label.toLowerCase(),
  look = '',
): TemplateResult {
  return html`<button
    class="tb ${look}"
    data-act=${act}
    aria-label=${label}
    title=${label}
    aria-pressed=${pressed === null ? nothing : String(pressed)}
    @click=${onClick}
  >
    ${icon(name, 20)}
  </button>`;
}

function ring(): TemplateResult {
  return html`<svg class="ring" viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="18" transform="rotate(-90 20 20)" />
  </svg>`;
}

export function markIcon(
  control: Control,
  armed: boolean,
  opening: OpeningLook | null,
): IconName {
  if (control.kind === 'lock') {
    const locked = control.states.some((state) => state.state === 'locked');

    if (armed) return locked ? 'lock-open' : 'lock';

    return locked ? 'lock' : 'lock-open';
  }

  const opens = control.kind === 'cover' || control.kind === 'sensor';

  if (opens && control.scope.type === 'door') {
    return doorIcon(control.states, armed || opening !== 'shut');
  }

  if (control.kind === 'cover') return 'blinds';
  if (control.kind === 'switch') return 'power';
  if (control.kind === 'gadget') return deviceIcon(control);
  if (control.kind === 'sensor') return scopeIcons[control.scope.type];

  return 'lightbulb';
}

const domainIcons: Record<string, IconName> = {
  media_player: 'tv',
  climate: 'thermometer',
  fan: 'fan',
  camera: 'camera',
  binary_sensor: 'activity',
  vacuum: 'vacuum',
  scene: 'sparkles',
  script: 'sparkles',
};

function deviceIcon(control: Control): IconName {
  const state = control.states[0];
  const domain = entityDomain(control.entityIds[0] ?? '');
  const deviceClass = state ? deviceClassOf(state) : null;

  if (domain === 'media_player' && deviceClass === 'speaker') return 'speaker';
  if (domain === 'sensor') {
    if (deviceClass === temperatureDeviceClass) return 'thermometer';
    if (deviceClass === humidityDeviceClass) return 'droplet';

    return 'gauge';
  }

  return Object.hasOwn(domainIcons, domain)
    ? domainIcons[domain]
    : scopeIcons.prop;
}

export function doorIcon(
  states: readonly HassEntityState[],
  open: boolean,
): IconName {
  const garage = states.some((state) =>
    garageClasses.includes(String(state.attributes.device_class)),
  );

  if (garage) return open ? 'garage-open' : 'garage';

  return open ? 'door-open' : 'door-closed';
}

export function openingRowIcon(
  control: Control | null,
  kind: RoomRow['kind'],
  states: readonly HassEntityState[],
  opening: OpeningLook,
): IconName {
  if (control) return markIcon(control, false, opening);
  if (kind === 'window') return 'app-window';

  return doorIcon(states, opening === 'open');
}

export function toneOf(
  control: Control | null,
  opening: OpeningLook | null,
): Tone | null {
  if (control?.kind === 'lock') {
    if (isLocked(control)) return 'lock';

    return isOn(control) || opening === 'open' ? 'accent' : null;
  }

  if (opening !== null) return opening === 'open' ? 'accent' : null;
  if (!control || !isActive(control)) return null;

  return control.scope.type === 'light' ? 'lamp' : 'accent';
}

function lockLook(control: Control): 'locked' | 'unlocked' | null {
  if (control.kind !== 'lock') return null;
  if (isLocked(control)) return 'locked';

  return isOn(control) ? 'unlocked' : null;
}

export function lampState(control: Control): string {
  if (control.unavailable) return 'Unavailable';
  if (!isOn(control)) return 'Off';
  if (control.entityIds.length !== 1) return 'On';

  const light = control.states.find(
    (state) => state.entity_id === control.entityIds[0],
  );
  const brightness = numberAttribute(light, 'brightness');

  return brightness === null
    ? 'On'
    : `${Math.round((brightness / 255) * 100)}%`;
}

export function armedVerb(control: Control): string {
  if (control.kind === 'cover') return 'Open';

  return control.states.some((state) => state.state === 'locked')
    ? 'Unlock'
    : 'Lock';
}

export function armedRow(
  control: Control,
  opening: OpeningLook | null,
): ArmedRow {
  const verb = armedVerb(control);

  return {
    label: `${verb} ${control.name}`,
    prompt: `Tap again to ${verb.toLowerCase()}`,
    from: markIcon(control, false, opening),
    to: markIcon(control, true, opening),
  };
}

function brightnessOf(control: Control): number {
  const state = control.states.find((entry) => entry.state === 'on');

  if (!state) return 0;

  const brightness = numberAttribute(state, 'brightness');

  return brightness === null ? 100 : Math.round((brightness / 255) * 100);
}

function coverWords(
  state: HassEntityState | undefined,
  draft: number | null,
  position: number,
): string {
  if (draft === null && state?.state === 'opening') return 'Opening';
  if (draft === null && state?.state === 'closing') return 'Closing';
  if (position <= 0) return 'Closed';
  if (position >= 100) return 'Open';

  return `Open · ${position}%`;
}

function positionOf(state: HassEntityState | undefined): number {
  if (!state) return 0;

  const position = numberAttribute(state, 'current_position');

  if (position !== null) return Math.round(position);

  return state.state === 'open' ? 100 : 0;
}

function reportedWhite(state: HassEntityState | undefined): number | null {
  const kelvin = numberAttribute(state, 'color_temp_kelvin');

  if (kelvin !== null) {
    return lightColorPresets.reduce((best, preset) =>
      Math.abs(preset.kelvin - kelvin) < Math.abs(best.kelvin - kelvin)
        ? preset
        : best,
    ).kelvin;
  }

  const rgb = reportedRgb(state);

  if (!rgb) return null;

  const [nearest] = lightColorPresets
    .map((preset) => ({
      kelvin: preset.kelvin,
      apart: Math.hypot(
        ...whiteRgb(preset.kelvin).map((channel, at) => channel - rgb[at]),
      ),
    }))
    .sort((a, b) => a.apart - b.apart);

  return nearest && nearest.apart <= WHITE_MATCH ? nearest.kelvin : null;
}

function reportedRgb(state: HassEntityState | undefined): number[] | null {
  const rgb = numbersAttribute(state, 'rgb_color', 3);

  if (rgb) return rgb;

  const hs = numbersAttribute(state, 'hs_color', 2);

  return hs ? hsRgb(hs[0], hs[1]) : null;
}

function hsRgb(hue: number, saturation: number): number[] {
  const chroma = Math.min(Math.max(saturation, 0), 100) / 100;
  const sector = (((hue % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const [red, green, blue] = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ][Math.floor(sector) % 6];

  return [red, green, blue].map((channel) => (channel + 1 - chroma) * 255);
}

// Tanner Helland's curve fit of black-body colour by temperature.
function whiteRgb(kelvin: number): number[] {
  const hundreds = kelvin / 100;
  const warm = hundreds <= 66;
  const red = warm ? 255 : 329.698727446 * (hundreds - 60) ** -0.1332047592;
  const green = warm
    ? 99.4708025861 * Math.log(hundreds) - 161.1195681661
    : 288.1221695283 * (hundreds - 60) ** -0.0755148492;
  const blue = warm
    ? 138.5177312231 * Math.log(Math.max(hundreds - 10, 1)) - 305.0447927307
    : 255;

  return [red, green, blue].map((channel) =>
    Math.round(Math.min(255, Math.max(0, channel))),
  );
}

function whiteOf(kelvin: number): string {
  return `#${whiteRgb(kelvin)
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

function colourModesOf(state: HassEntityState | undefined): string[] {
  const modes = state?.attributes.supported_color_modes;

  return Array.isArray(modes)
    ? modes.filter((mode): mode is string => typeof mode === 'string')
    : [];
}

function numberAttribute(
  state: HassEntityState | undefined,
  attribute: string,
): number | null {
  const value = state?.attributes[attribute];

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numbersAttribute(
  state: HassEntityState | undefined,
  attribute: string,
  length: number,
): number[] | null {
  const value = state?.attributes[attribute];

  if (!Array.isArray(value) || value.length < length) return null;

  const numbers = value.slice(0, length);

  return numbers.every(
    (entry): entry is number =>
      typeof entry === 'number' && Number.isFinite(entry),
  )
    ? numbers
    : null;
}

function rangeValue(event: Event): number {
  return Number((event.target as HTMLInputElement).value);
}

export function dotLook(theme: Theme): { core: string; ring: string } {
  const half = tokens.themes[theme];

  return { core: half.text, ring: half.surface };
}

function themeVars(theme: Theme): CSSResult {
  const half = tokens.themes[theme];
  const dot = dotLook(theme);

  return css`
    --ez-dot: ${unsafeCSS(dot.core)};
    --ez-dot-ring: ${unsafeCSS(dot.ring)};
    --ez-surface: ${unsafeCSS(half.surface)};
    --ez-surface2: ${unsafeCSS(half.surface2)};
    --ez-surface3: ${unsafeCSS(half.surface3)};
    --ez-border: ${unsafeCSS(half.border)};
    --ez-border-strong: ${unsafeCSS(half.borderStrong)};
    --ez-text: ${unsafeCSS(half.text)};
    --ez-text-muted: ${unsafeCSS(half.textMuted)};
    --ez-text-meta: ${unsafeCSS(half.textMeta)};
    --ez-chosen: ${unsafeCSS(half.secondaryBtn.bg)};
    --ez-on-chosen: ${unsafeCSS(half.secondaryBtn.text)};
    --ez-chosen-hover: ${unsafeCSS(half.secondaryBtn.hover)};
    --ez-chosen-press: ${unsafeCSS(half.secondaryBtn.pressed)};
    --ez-bar: ${unsafeCSS(half.barBg)};
    --ez-focus: ${unsafeCSS(half.focusRing)};
    --ez-accent: ${unsafeCSS(half.accent)};
    --ez-lock: ${unsafeCSS(tokens.ramps.navy['600'])};
    --ez-on-lock: ${unsafeCSS(tokens.ramps.neutral['0'])};
    --ez-on-accent: ${unsafeCSS(half.onAccent)};
    --ez-danger-fill: ${unsafeCSS(tokens.functional.danger.base)};
    --ez-on-danger: ${unsafeCSS(half.onDanger)};
    --ez-danger-text: ${unsafeCSS(half.dangerText)};
    --ez-shadow-float: ${unsafeCSS(half.shadowFloat)};
    --ez-shadow-lg: ${unsafeCSS(half.shadowLg)};
    color-scheme: ${unsafeCSS(theme)};
  `;
}

function touchSheet(scope: string): CSSResult {
  const host = unsafeCSS(scope);
  const reach = unsafeCSS((COARSE_PX - HIT_PX) / 2);
  const ring = unsafeCSS((COARSE_PX - HIT_PX) / 2 - BORDER_PX);
  const chipIcon = unsafeCSS(COARSE_PX - 2 * CHIP_INSET_PX);
  const rowReach = unsafeCSS((HIT_PX - COARSE_PX) / 2);

  return css`
    ${host} .sheet :is(.openings, .devices) {
      gap: ${HIT_PX - COARSE_PX}px;
    }

    ${host} .sheet .readout {
      min-height: ${COARSE_PX}px;
    }

    ${host} .sheet :is(.device, .readout.row) {
      height: ${COARSE_PX}px;
    }

    ${host} .sheet :is(.device-toggle, .device-icon, .row-icon) {
      margin-inline-start: -${rowReach}px;
    }

    ${host} .sheet :is(.device-toggle, .device-name, .readout.row)::after {
      inset: -${rowReach}px 0;
    }

    ${host} .sheet :is(.device-icon, .row-icon) .lamp-icon {
      width: ${COARSE_PX}px;
      height: ${COARSE_PX}px;
    }

    ${host} .sheet .tb,
    ${host} .sheet .lamp,
    ${host} .sheet .bar,
    ${host} .sheet .device-toggle .lamp-icon {
      height: ${COARSE_PX}px;
    }

    ${host} .sheet .tb,
    ${host} .sheet .device-toggle .lamp-icon {
      width: ${COARSE_PX}px;
    }

    ${host} .sheet .lamp .lamp-icon {
      width: ${chipIcon}px;
      height: ${chipIcon}px;
    }

    ${host} .sheet :is(.tb, .lamp)::after {
      inset: ${ring}px;
    }

    ${host} .sheet .bar input {
      inset: ${reach}px 0;
    }
  `;
}

export const controlStyles = css`
  :host {
    ${themeVars('light')}
  }

  :host([dark]) {
    ${themeVars('dark')}
  }

  [data-look='light'] {
    ${themeVars('light')}
  }

  [data-look='dark'] {
    ${themeVars('dark')}
  }

  .icon {
    display: block;
    flex: none;
  }

  .marks {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .mark,
  .bubble {
    z-index: 1;
  }

  .mark {
    position: absolute;
    translate: -50% -50%;
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--ez-text);
    cursor: pointer;
    pointer-events: none;
    touch-action: none;
  }

  :is(.mark, .bubble)::before {
    content: '';
    position: absolute;
    inset: var(--hit-t, 0px) var(--hit-r, 0px) var(--hit-b, 0px)
      var(--hit-l, 0px);
    pointer-events: auto;
  }

  :is(.mark.under, .mark.dot, .bubble.under)::before {
    pointer-events: none;
  }

  .mark.under {
    opacity: 0;
    pointer-events: none;
    animation: ez-leave 150ms ease-out;
  }

  .mark .disc {
    position: relative;
    width: 28px;
    height: 28px;
    border-radius: ${unsafeCSS(tokens.radius.pill)}px;
    display: grid;
    place-items: center;
    background: var(--ez-bar);
    border: 1px solid var(--ez-border-strong);
    box-shadow: var(--ez-shadow-float);
  }

  .mark.opening .disc {
    width: 22px;
    height: 22px;
    color: var(--ez-text-meta);
  }

  .mark.opening .icon {
    width: 14px;
    height: 14px;
  }

  .mark.dot {
    pointer-events: none;
  }

  .mark.dot .disc {
    box-sizing: border-box;
    width: 10px;
    height: 10px;
    background: var(--ez-dot);
    border: 2px solid var(--ez-dot-ring);
    pointer-events: auto;
  }

  .mark[data-tone='lamp'] .disc {
    background: var(--lamp, ${unsafeCSS(DEFAULT_LIGHT_COLOR)});
    color: #1c130b;
    border-color: rgba(28, 19, 11, 0.25);
    box-shadow:
      0 0 14px 4px var(--lamp, ${unsafeCSS(DEFAULT_LIGHT_COLOR)}),
      var(--ez-shadow-float);
  }

  .mark[data-tone='accent'] .disc {
    background: var(--ez-accent);
    color: var(--ez-on-accent);
    border-color: transparent;
  }

  .mark[data-tone='lock'] .disc {
    background: var(--ez-lock);
    color: var(--ez-on-lock);
  }

  .mark.plug[data-tone='accent'] .disc {
    box-shadow:
      0 0 14px 4px var(--ez-accent),
      var(--ez-shadow-float);
  }

  .mark.opening.open .disc {
    width: 28px;
    height: 28px;
  }

  .mark.opening.open .icon {
    width: 16px;
    height: 16px;
  }

  .mark.lock:not(.armed) .disc {
    width: 28px;
    height: 28px;
  }

  .mark.lock:not(.armed) .icon {
    width: 16px;
    height: 16px;
  }

  .ring {
    position: absolute;
    inset: -6px;
    width: calc(100% + 12px);
    height: calc(100% + 12px);
    pointer-events: none;
  }

  .ring circle {
    fill: none;
    stroke: transparent;
    stroke-width: 2.5;
  }

  .pending .ring circle {
    stroke: var(--ez-chosen);
    stroke-dasharray: 113;
    stroke-dashoffset: 113;
    animation: ez-draw 5s linear forwards;
  }

  .confirmed .ring circle {
    stroke: var(--ez-chosen);
    animation: ez-fade 150ms ease-out forwards;
  }

  .failed .ring circle {
    stroke: var(--ez-danger-fill);
  }

  .mark.failed .disc,
  .lamp.failed .lamp-icon {
    animation: ez-shake 300ms ease 1;
  }

  .mark .bad {
    position: absolute;
    right: -8px;
    top: -8px;
    width: 18px;
    height: 18px;
    border-radius: ${unsafeCSS(tokens.radius.pill)}px;
    display: grid;
    place-items: center;
    background: var(--ez-danger-fill);
    color: var(--ez-on-danger);
  }

  .mark.selected .disc {
    box-shadow:
      0 0 0 2px var(--ez-chosen),
      var(--ez-shadow-float);
  }

  .mark.unavailable {
    opacity: 0.4;
  }

  .mark.unavailable .disc {
    border-style: dashed;
  }

  .mark.armed {
    width: auto;
  }

  .mark.armed .disc {
    width: ${ARMED_BOX.width}px;
    height: ${ARMED_BOX.height}px;
    background: var(--ez-chosen);
    color: var(--ez-on-chosen);
    border-color: transparent;
  }

  .mark.armed .ring {
    display: none;
  }

  .mark.armed .disc {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    overflow: hidden;
  }

  .mark.armed .turn,
  .readout.row.armed .turn {
    flex: none;
    width: 6px;
    height: 6px;
    margin-inline-start: -3px;
    border-top: 2px solid currentColor;
    border-right: 2px solid currentColor;
    rotate: 45deg;
  }

  .readout.row.armed .row-icon {
    gap: 3px;
  }

  .drain {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 4px;
    background: var(--ez-accent);
    transform-origin: left;
    animation: ez-drain linear forwards;
  }

  .mark-leaders {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .mark-leader line {
    stroke: var(--ez-dot);
    stroke-width: 1.25;
  }

  .mark-leader .halo {
    stroke: var(--ez-dot-ring);
    stroke-opacity: 0.6;
    stroke-width: 3.25;
  }

  .mark-leader circle {
    fill: var(--ez-dot);
    stroke: var(--ez-dot-ring);
    stroke-opacity: 0.6;
    stroke-width: 1;
  }

  .bubble {
    position: absolute;
    translate: -50% -50%;
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--ez-text);
    font: inherit;
    cursor: pointer;
    pointer-events: none;
    touch-action: none;
  }

  .bubble .disc {
    height: 28px;
    min-width: 28px;
    box-sizing: border-box;
    padding: 0 8px 0 6px;
    border-radius: ${unsafeCSS(tokens.radius.pill)}px;
    display: flex;
    align-items: center;
    gap: 3px;
    background: var(--ez-bar);
    border: 1px solid var(--ez-border-strong);
    box-shadow: var(--ez-shadow-float);
  }

  .bubble .count {
    font-size: 13px;
    font-weight: 750;
    line-height: 1;
  }

  .bubble.selected .disc {
    box-shadow:
      0 0 0 2px var(--ez-chosen),
      var(--ez-shadow-float);
  }

  .bubble.under {
    opacity: 0;
    pointer-events: none;
  }

  .choices {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    max-height: 296px;
    overflow-y: auto;
  }

  .choice {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    min-height: 48px;
    padding: 4px 14px 4px 6px;
    border-radius: ${unsafeCSS(tokens.radius.md)}px;
    border: 1px solid var(--ez-border);
    background: var(--ez-surface2);
    color: var(--ez-text);
    font: inherit;
    font-size: 14px;
    font-weight: 650;
    text-align: left;
    cursor: pointer;
  }

  .choice:hover {
    background: var(--ez-surface3);
  }

  .choice .lamp-icon {
    flex: none;
  }

  .choice-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow-wrap: anywhere;
  }

  .choice-state {
    color: var(--ez-text-muted);
    font-weight: 500;
    white-space: nowrap;
  }

  .toast {
    position: absolute;
    left: 50%;
    bottom: 14px;
    translate: -50% 0;
    z-index: 6;
    width: min(420px, calc(100% - 28px));
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 52px;
    padding: 4px 4px 4px 14px;
    border-radius: ${unsafeCSS(tokens.radius.lg)}px;
    background: var(--ez-surface);
    color: var(--ez-text);
    border: 1px solid var(--ez-border-strong);
    box-shadow: var(--ez-shadow-float);
    font-size: 14px;
  }

  .stage.sheet-up .toast {
    top: 14px;
    bottom: auto;
  }

  .toast-icon {
    color: var(--ez-danger-text);
  }

  .toast-text {
    flex: 1;
  }

  .sheet {
    position: absolute;
    z-index: 7;
    box-sizing: border-box;
    padding: ${unsafeCSS(tokens.spacing[1])}px ${unsafeCSS(tokens.spacing[2])}px
      ${unsafeCSS(tokens.spacing[2])}px;
    border-radius: ${unsafeCSS(tokens.radius.xl)}px;
    background: var(--ez-surface);
    color: var(--ez-text);
    border: 1px solid var(--ez-border);
    box-shadow: var(--ez-shadow-lg);
    display: grid;
    gap: ${unsafeCSS(tokens.spacing[1])}px;
    animation: ez-appear ${SHEET_FADE_MS}ms ease-out;
  }

  .sheet.leaving {
    pointer-events: none;
    animation: none;
  }

  .sheet:not(.bottom) {
    width: ${SHEET_WIDTH_PX}px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .sheet.bottom {
    left: 0;
    right: 0;
    bottom: 0;
    width: auto;
    max-height: 50%;
    overflow-y: auto;
    overscroll-behavior: contain;
    border-radius: ${unsafeCSS(tokens.radius.xxl)}px
      ${unsafeCSS(tokens.radius.xxl)}px 0 0;
    padding: ${unsafeCSS(tokens.spacing[3])}px ${unsafeCSS(tokens.spacing[2])}px
      calc(${unsafeCSS(tokens.spacing[2])}px + env(safe-area-inset-bottom, 0px));
  }

  .grip {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: ${unsafeCSS(tokens.spacing[3])}px;
    touch-action: none;
    cursor: grab;
  }

  .grip::before {
    content: '';
    position: absolute;
    top: 6px;
    left: 50%;
    width: 38px;
    height: 4.5px;
    margin-left: -19px;
    border-radius: ${unsafeCSS(tokens.radius.sm)}px;
    background: var(--ez-border-strong);
  }

  .sheet.bottom .sheet-head {
    touch-action: none;
  }

  .sheet .tb {
    width: ${FINE_PX}px;
    height: ${FINE_PX}px;
    border-radius: ${unsafeCSS(tokens.radius.sm)}px;
  }

  .sheet .tools .tb {
    flex: 1 1 0;
    width: auto;
  }

  .sheet :is(.tb, .lamp)::after {
    content: '';
    position: absolute;
    inset: ${(FINE_PX - HIT_PX) / 2 - BORDER_PX}px;
  }

  .sheet-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 -4px 0 0;
  }

  .sheet-title {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 14px;
    font-weight: 650;
    line-height: 1.3;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow-wrap: anywhere;
  }

  .sheet-head .tb {
    border-color: transparent;
  }

  .level {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .level .bar {
    flex: 1;
    min-width: 0;
  }

  .power-state {
    font-size: 14px;
    font-weight: 650;
    color: var(--ez-text-muted);
  }

  .power-state.on {
    color: var(--ez-text);
  }

  .tb.plug[aria-pressed='true'],
  .tb.plug[aria-pressed='true']:hover {
    background: var(--ez-accent);
    color: var(--ez-on-accent);
  }

  .level .bar .fill {
    box-shadow: inset -2px 0 0 var(--ez-text);
  }

  .bar {
    position: relative;
    height: ${FINE_PX}px;
  }

  .bar .track {
    position: absolute;
    inset: 0;
    border-radius: ${unsafeCSS(tokens.radius.sm)}px;
    background: var(--ez-surface2);
    border: 1px solid var(--ez-border);
    overflow: hidden;
  }

  .bar .fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    overflow: hidden;
  }

  .bar .cover-fill {
    background: var(--ez-surface2);
  }

  .bar .slats {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      var(--ez-surface3) 0 10px,
      var(--ez-surface2) 10px 14px
    );
  }

  .bar .pct {
    position: absolute;
    left: 14px;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    font-size: 13px;
    font-weight: 750;
    white-space: nowrap;
    color: var(--ez-text);
    pointer-events: none;
  }

  .bar .fill .pct {
    color: #1c130b;
  }

  .bar input {
    position: absolute;
    inset: ${(FINE_PX - HIT_PX) / 2}px 0;
    width: 100%;
    height: auto;
    margin: 0;
    opacity: 0;
    cursor: ew-resize;
  }

  .bar:has(input:focus-visible) .track {
    outline: 2px solid var(--ez-focus);
    outline-offset: 2px;
  }

  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .tb {
    position: relative;
    width: 44px;
    height: 44px;
    border-radius: ${unsafeCSS(tokens.radius.md)}px;
    border: 1px solid var(--ez-border);
    background: var(--ez-surface);
    color: var(--ez-text);
    display: grid;
    place-items: center;
    padding: 0;
    cursor: pointer;
  }

  .tb.plain {
    border: 0;
    background: transparent;
  }

  .tb:hover {
    background: var(--ez-surface2);
  }

  .tb:active {
    background: var(--ez-surface3);
  }

  .tb[aria-pressed='true'] {
    background: var(--ez-chosen);
    color: var(--ez-on-chosen);
    border-color: transparent;
  }

  .tb[aria-pressed='true']:hover {
    background: var(--ez-chosen-hover);
  }

  .tb[aria-pressed='true']:active {
    background: var(--ez-chosen-press);
  }

  .tb.swatch {
    border-color: var(--ez-border-strong);
  }

  .tb.swatch span {
    width: 26px;
    height: 26px;
    border-radius: ${unsafeCSS(tokens.radius.pill)}px;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
  }

  .tb.swatch[aria-pressed='true'] {
    background: var(--ez-surface);
    box-shadow: 0 0 0 2px var(--ez-chosen);
  }

  .room-body {
    display: flex;
    flex-direction: column;
    gap: ${unsafeCSS(tokens.spacing[1])}px;
  }

  .room-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: ${unsafeCSS(tokens.spacing[1])}px;
    row-gap: ${unsafeCSS(tokens.spacing[1])}px;
  }

  .room-line .readout span {
    white-space: nowrap;
  }

  .lamp {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: ${unsafeCSS(tokens.spacing[1])}px;
    box-sizing: border-box;
    height: ${FINE_PX}px;
    padding: 0 ${unsafeCSS(tokens.spacing[2])}px 0 ${CHIP_INSET_PX - 1}px;
    border-radius: ${unsafeCSS(tokens.radius.sm)}px;
    border: 1px solid var(--ez-border);
    background: var(--ez-surface2);
    color: var(--ez-text);
    font: inherit;
    font-size: 14px;
    font-weight: 650;
    cursor: pointer;
  }

  .lamp:hover {
    background: var(--ez-surface3);
  }

  .lamp-icon {
    position: relative;
    width: 36px;
    height: 36px;
    border-radius: ${unsafeCSS(tokens.radius.pill)}px;
    display: grid;
    place-items: center;
    background: var(--ez-surface);
  }

  .lamp .lamp-icon {
    width: ${FINE_PX - 2 * CHIP_INSET_PX}px;
    height: ${FINE_PX - 2 * CHIP_INSET_PX}px;
  }

  .lamp[aria-pressed='true'] .lamp-icon {
    background: var(--lamp, ${unsafeCSS(DEFAULT_LIGHT_COLOR)});
    color: #1c130b;
  }

  .openings,
  .devices {
    display: flex;
    flex-direction: column;
    gap: ${HIT_PX - FINE_PX}px;
  }

  .device,
  .readout.row {
    position: relative;
    display: flex;
    align-items: center;
    gap: ${unsafeCSS(tokens.spacing[0])}px;
    height: ${FINE_PX}px;
    min-height: 0;
  }

  .device-toggle,
  .device-icon,
  .row-icon {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: ${HIT_PX}px;
    height: 100%;
    margin-inline-start: -${(HIT_PX - FINE_PX) / 2}px;
  }

  .readout.device-name {
    position: relative;
    flex: 1;
    height: 100%;
    min-height: 0;
  }

  .device-toggle::after,
  .device-name::after,
  .readout.row::after {
    content: '';
    position: absolute;
    inset: -${(HIT_PX - FINE_PX) / 2}px 0;
  }

  .row-text {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    line-height: 17px;
  }

  .device-icon .lamp-icon,
  .row-icon .lamp-icon {
    width: ${FINE_PX}px;
    height: ${FINE_PX}px;
    background: var(--ez-surface2);
    color: var(--ez-text-muted);
  }

  .device-toggle {
    position: relative;
    padding: 0;
    border: 0;
    border-radius: ${unsafeCSS(tokens.radius.pill)}px;
    background: none;
    color: var(--ez-text);
    cursor: pointer;
  }

  .device-toggle .lamp-icon {
    box-sizing: border-box;
    border: 1px solid var(--ez-border);
    background: var(--ez-surface2);
  }

  .device-toggle:hover .lamp-icon {
    background: var(--ez-surface3);
  }

  :is(.row-icon, .device-icon, .device-toggle, .choice)[data-tone='lamp']
    .lamp-icon {
    background: var(--lamp, ${unsafeCSS(DEFAULT_LIGHT_COLOR)});
    color: #1c130b;
    border-color: transparent;
  }

  :is(.row-icon, .device-icon, .device-toggle, .choice)[data-tone='accent']
    .lamp-icon {
    background: var(--ez-accent);
    color: var(--ez-on-accent);
    border-color: transparent;
  }

  :is(.row-icon, .device-icon, .device-toggle, .choice)[data-tone='lock']
    .lamp-icon {
    background: var(--ez-lock);
    color: var(--ez-on-lock);
    border-color: transparent;
  }

  .device-icon {
    color: var(--ez-text-muted);
  }

  .readout {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    min-height: ${FINE_PX}px;
    font-size: 15px;
    font-weight: 650;
  }

  .readout span {
    overflow-wrap: anywhere;
  }

  .readout.row,
  .readout.device-name {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    text-align: start;
    cursor: pointer;
  }

  .readout .row-state {
    color: var(--ez-text-muted);
    white-space: nowrap;
  }

  .readout.row.armed {
    border-radius: ${unsafeCSS(tokens.radius.sm)}px;
    background: var(--ez-chosen);
    box-shadow: 0 0 0 4px var(--ez-chosen);
    color: var(--ez-on-chosen);
  }

  .readout.row.armed .row-state {
    color: inherit;
  }

  .readout.row.alert {
    border-radius: ${unsafeCSS(tokens.radius.sm)}px;
    background: var(--ez-danger-fill);
    box-shadow: 0 0 0 4px var(--ez-danger-fill);
    color: var(--ez-on-danger);
  }

  .readout.row.alert .row-state {
    color: inherit;
  }

  .readout.row.alert .lamp-icon {
    background: transparent;
    color: inherit;
  }

  .readout.row.armed .drain {
    border-radius: 0 0 ${unsafeCSS(tokens.radius.sm)}px
      ${unsafeCSS(tokens.radius.sm)}px;
  }

  button:focus-visible {
    outline: 2px solid var(--ez-focus);
    outline-offset: 2px;
  }

  .mark:focus-visible {
    outline: none;
  }

  .mark:focus-visible .disc {
    outline: 2px solid var(--ez-focus);
    outline-offset: 2px;
  }

  @media (pointer: coarse) {
    .toast .tb,
    .mark {
      min-width: ${HIT_PX}px;
      min-height: ${HIT_PX}px;
    }

    ${touchSheet('')}
  }

  ${touchSheet(':host([tablet])')}

  @keyframes ez-draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  @keyframes ez-drain {
    to {
      scale: 0 1;
    }
  }

  @keyframes ez-fade {
    to {
      opacity: 0;
    }
  }

  @keyframes ez-shake {
    25% {
      transform: translateX(-3px);
    }
    50% {
      transform: translateX(3px);
    }
    75% {
      transform: translateX(-2px);
    }
  }

  @keyframes ez-appear {
    from {
      opacity: 0;
    }
  }

  @keyframes ez-leave {
    from {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sheet {
      animation: none;
    }

    .pending .ring circle {
      animation: none;
      stroke-dasharray: 4 4;
      stroke-dashoffset: 0;
    }

    .mark.failed .disc,
    .lamp.failed .lamp-icon {
      animation: none;
    }
  }
`;
