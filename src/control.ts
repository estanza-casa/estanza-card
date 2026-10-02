import {
  type ActionTrigger,
  actionTriggers,
  type PerformAction,
  type SceneScope,
  scopeKey,
  type ThingAction,
  type ThingActions,
  type Trigger,
} from './bindings.js';
import {
  entityDomain,
  type HassEntityState,
  isUnavailable,
  type ScopeState,
} from './hass-state.js';
import { isWordId, scopeLabels } from './linking.js';

export const PENDING_LIMIT_MS = 5000;
export const CONFIRMED_FADE_MS = 150;
export const FAILED_MARK_MS = 4000;
export const TOAST_MS = 6500;
export const LOCK_CONFIRM_MS = 4000;
export const CONFIRM_GAP_MS = 300;

const NUMERIC_TOLERANCE = 3;

const guardedCoverClasses = ['garage', 'gate', 'door'];

const hassActions = [
  'navigate',
  'url',
  'assist',
  'fire-dom-event',
  'perform-action',
  'call-service',
];

export const controlKinds = [
  'light',
  'switch',
  'cover',
  'lock',
  'room',
  'sensor',
  'gadget',
] as const;

export type ControlKind = (typeof controlKinds)[number];

export const deeds = [
  'toggle',
  'open',
  'close',
  'lock',
  'unlock',
  'sheet',
  'more-info',
  'none',
] as const;

export type Deed = (typeof deeds)[number];

export type PlannedDeed = Extract<
  Deed,
  'toggle' | 'open' | 'close' | 'lock' | 'unlock'
>;

const kindDeeds: Record<ControlKind, readonly Deed[]> = {
  light: ['toggle', 'sheet', 'more-info', 'none'],
  switch: ['toggle', 'sheet', 'more-info', 'none'],
  cover: ['toggle', 'open', 'close', 'sheet', 'more-info', 'none'],
  lock: ['toggle', 'lock', 'unlock', 'more-info', 'none'],
  room: ['sheet', 'toggle', 'none'],
  sensor: ['none', 'more-info'],
  gadget: ['more-info', 'none'],
};

const defaultDeeds: Record<ControlKind, Record<Trigger, Deed>> = {
  light: { tap: 'toggle', hold: 'sheet' },
  switch: { tap: 'toggle', hold: 'sheet' },
  cover: { tap: 'toggle', hold: 'sheet' },
  lock: { tap: 'toggle', hold: 'more-info' },
  room: { tap: 'sheet', hold: 'sheet' },
  sensor: { tap: 'none', hold: 'none' },
  gadget: { tap: 'more-info', hold: 'none' },
};

const toggleLabels: Record<ControlKind, string> = {
  light: 'Turn on or off',
  switch: 'Turn on or off',
  cover: 'Open or close',
  lock: 'Lock or unlock',
  room: 'Turn its lights on or off',
  sensor: 'Turn on or off',
  gadget: 'Turn on or off',
};

const deedLabels: Record<Exclude<Deed, 'toggle'>, string> = {
  open: 'Open',
  close: 'Close',
  lock: 'Lock',
  unlock: 'Unlock',
  sheet: 'Show controls',
  'more-info': 'Show details',
  none: 'Nothing',
};

const performedDeeds: Record<PerformAction, Deed> = {
  'cover.open_cover': 'open',
  'cover.close_cover': 'close',
  'lock.lock': 'lock',
  'lock.unlock': 'unlock',
};

export type Control = {
  kind: ControlKind;
  key: string;
  scope: SceneScope;
  entityIds: string[];
  states: HassEntityState[];
  name: string;
  unavailable: boolean;
};

export type ServiceCall = {
  domain: string;
  service: string;
  data: Record<string, unknown>;
};

export type Expectation = {
  entityId: string;
  states: string[];
  attributes?: Record<string, number>;
};

export type ControlPlan = {
  calls: ServiceCall[];
  optimistic: HassEntityState[];
  expect: Expectation[];
};

export type CoverMove = 'open' | 'close' | 'stop';

export function controlFor(
  scopeState: ScopeState,
  actions: ThingActions = {},
  homeName: string | null = null,
): Control | null {
  const kind = controlKindOf(scopeState.scope, scopeState.entityIds);
  const answers = (trigger: ActionTrigger) =>
    handedToHass(actions[trigger]) ||
    deedOf(kind, trigger, actions[trigger]) !== 'none';

  if (readOnly(kind) && !actionTriggers.some(answers)) return null;

  return markedControl(scopeState, homeName);
}

export function markedControl(
  scopeState: ScopeState,
  homeName: string | null = null,
): Control {
  const { scope } = scopeState;
  const kind = controlKindOf(scope, scopeState.entityIds);
  const domains = kind === 'room' ? ['light'] : [kind];
  const entityIds = readOnly(kind)
    ? scopeState.entityIds
    : scopeState.entityIds.filter((entityId) =>
        domains.includes(entityDomain(entityId)),
      );
  const states = scopeState.states.filter((state) =>
    entityIds.includes(state.entity_id),
  );

  return {
    kind,
    key: scopeKey(scope),
    scope,
    entityIds,
    states,
    name: controlName(kind, scopeState, states, homeName),
    unavailable:
      kind === 'room' && entityIds.length === 0
        ? false
        : states.every((state) => isUnavailable(state)),
  };
}

export function planToggle(control: Control, firm = false): ControlPlan {
  if (control.kind === 'cover') return planCoverToggle(control, firm);
  if (control.kind === 'lock') return planLock(control, isLocked(control));

  const usable = control.states.filter((state) => !isUnavailable(state));
  const target = usable.some((state) => state.state === 'on') ? 'off' : 'on';
  const optimistic = usable.map((state) => withState(state, target));
  const expect = usable.map((state) => ({
    entityId: state.entity_id,
    states: [target],
  }));

  if (!firm && control.kind !== 'room' && usable.length === 1) {
    const entityId = usable[0].entity_id;

    return {
      calls: [
        {
          domain: entityDomain(entityId),
          service: 'toggle',
          data: { entity_id: entityId },
        },
      ],
      optimistic,
      expect,
    };
  }

  return {
    calls: callsByDomain(
      usable.map((state) => state.entity_id),
      `turn_${target}`,
    ),
    optimistic,
    expect,
  };
}

export function planBrightness(control: Control, percent: number): ControlPlan {
  const usable = control.states.filter((state) => !isUnavailable(state));

  if (percent <= 0) {
    return {
      calls: callsByDomain(
        usable.map((state) => state.entity_id),
        'turn_off',
      ),
      optimistic: usable.map((state) => withState(state, 'off')),
      expect: usable.map((state) => ({
        entityId: state.entity_id,
        states: ['off'],
      })),
    };
  }

  const brightness = Math.round((percent / 100) * 255);

  return {
    calls: usable.map((state) => ({
      domain: 'light',
      service: 'turn_on',
      data: { entity_id: state.entity_id, brightness_pct: percent },
    })),
    optimistic: usable.map((state) => withState(state, 'on', { brightness })),
    expect: usable.map((state) => ({
      entityId: state.entity_id,
      states: ['on'],
      attributes: { brightness },
    })),
  };
}

export function planWhite(control: Control, kelvin: number): ControlPlan {
  const usable = control.states.filter((state) => !isUnavailable(state));

  return {
    calls: usable.map((state) => ({
      domain: 'light',
      service: 'turn_on',
      data: { entity_id: state.entity_id, color_temp_kelvin: kelvin },
    })),
    optimistic: usable.map((state) =>
      withState(state, 'on', {
        color_temp_kelvin: kelvin,
        rgb_color: undefined,
      }),
    ),
    expect: usable.map((state) => ({
      entityId: state.entity_id,
      states: ['on'],
    })),
  };
}

export function planPosition(control: Control, position: number): ControlPlan {
  const usable = control.states.filter((state) => !isUnavailable(state));

  return {
    calls: usable.map((state) => ({
      domain: 'cover',
      service: 'set_cover_position',
      data: { entity_id: state.entity_id, position },
    })),
    optimistic: usable.map((state) =>
      withState(state, position > 0 ? 'open' : 'closed', {
        current_position: position,
      }),
    ),
    expect: usable.map((state) => ({
      entityId: state.entity_id,
      states: ['open', 'closed', 'opening', 'closing'],
      attributes: { current_position: position },
    })),
  };
}

export function planCover(control: Control, move: CoverMove): ControlPlan {
  const usable = control.states.filter((state) => !isUnavailable(state));
  const entityIds = usable.map((state) => state.entity_id);

  if (move === 'stop') {
    return {
      calls: callsByDomain(entityIds, 'stop_cover'),
      optimistic: [],
      expect: [],
    };
  }

  const open = move === 'open';

  return {
    calls: callsByDomain(entityIds, open ? 'open_cover' : 'close_cover'),
    optimistic: usable.map((state) => coverMoved(state, open)),
    expect: usable.map((state) => ({
      entityId: state.entity_id,
      states: open ? ['open', 'opening'] : ['closed', 'closing'],
    })),
  };
}

export function settled(
  plan: ControlPlan,
  states: Record<string, HassEntityState>,
): boolean {
  return plan.expect.every((expectation) => {
    const state = Object.hasOwn(states, expectation.entityId)
      ? states[expectation.entityId]
      : undefined;

    if (!state || !expectation.states.includes(state.state)) return false;

    return Object.entries(expectation.attributes ?? {}).every(
      ([attribute, wanted]) => {
        const value = state.attributes[attribute];

        return (
          typeof value === 'number' &&
          Math.abs(value - wanted) <= NUMERIC_TOLERANCE
        );
      },
    );
  });
}

export function isOn(control: Control): boolean {
  return control.states.some(
    (state) =>
      state.state === 'on' ||
      state.state === 'open' ||
      state.state === 'opening' ||
      state.state === 'unlocked',
  );
}

export const busyStates = [
  'playing',
  'armed_home',
  'armed_away',
  'armed_night',
  'armed_vacation',
  'armed_custom_bypass',
] as const;

export function isActive(control: Control): boolean {
  return (
    isOn(control) ||
    control.states.some((state) =>
      (busyStates as readonly string[]).includes(state.state),
    )
  );
}

function planCoverToggle(control: Control, firm: boolean): ControlPlan {
  const plan = planCover(control, isOn(control) ? 'close' : 'open');

  if (firm) return plan;

  const entityIds = plan.optimistic.map((state) => state.entity_id);

  return { ...plan, calls: callsByDomain(entityIds, 'toggle') };
}

export function isGuarded(control: Control): boolean {
  if (control.kind === 'lock') return true;
  if (control.kind !== 'cover') return false;

  return control.states.some((state) =>
    guardedCoverClasses.includes(String(state.attributes.device_class)),
  );
}

export function opensHome(control: Control, deed: PlannedDeed): boolean {
  if (!isGuarded(control)) return false;
  if (control.kind === 'lock') {
    return deed === 'unlock' || (deed === 'toggle' && isLocked(control));
  }

  return deed === 'open' || (deed === 'toggle' && !isOn(control));
}

export function isLocked(control: Control): boolean {
  return control.states.some(
    (state) => !isUnavailable(state) && state.state === 'locked',
  );
}

function planLock(control: Control, unlock: boolean): ControlPlan {
  const usable = control.states.filter((state) => !isUnavailable(state));

  return {
    calls: callsByDomain(
      usable.map((state) => state.entity_id),
      unlock ? 'unlock' : 'lock',
    ),
    optimistic: usable.map((state) =>
      withState(state, unlock ? 'unlocked' : 'locked'),
    ),
    expect: usable.map((state) => ({
      entityId: state.entity_id,
      states: unlock
        ? ['unlocked', 'unlocking', 'open']
        : ['locked', 'locking'],
    })),
  };
}

export function controlKindOf(
  scope: SceneScope,
  entityIds: string[],
): ControlKind {
  if (scope.type === 'room') return 'room';

  const domains = new Set(entityIds.map(entityDomain));

  if (domains.has('lock')) return 'lock';
  if (domains.has('cover')) return 'cover';
  if (domains.has('light')) return 'light';
  if (domains.has('switch')) return 'switch';
  if (scope.type === 'prop' || scope.type === 'light') return 'gadget';

  return 'sensor';
}

function readOnly(kind: ControlKind): boolean {
  return kind === 'sensor' || kind === 'gadget';
}

export function defaultDeed(kind: ControlKind, trigger: Trigger): Deed {
  return defaultDeeds[kind][trigger];
}

export function deedChoices(kind: ControlKind, trigger: Trigger): Deed[] {
  const fallback = defaultDeed(kind, trigger);

  return [
    fallback,
    ...kindDeeds[kind].filter(
      (deed) => deed !== fallback && actionOf(deed) !== undefined,
    ),
  ];
}

export function deedLabel(kind: ControlKind, deed: Deed): string {
  if (deed === 'toggle') return toggleLabels[kind];
  if (deed === 'sheet' && kind === 'room') return 'Show the room';

  return deedLabels[deed];
}

export function actionOf(deed: Deed): ThingAction | undefined {
  if (deed === 'toggle' || deed === 'more-info' || deed === 'none') {
    return { action: deed };
  }

  const performed = Object.entries(performedDeeds).find(
    ([, value]) => value === deed,
  )?.[0] as PerformAction | undefined;

  return performed
    ? { action: 'perform-action', perform_action: performed }
    : undefined;
}

export function deedOf(
  kind: ControlKind,
  trigger: ActionTrigger,
  action: ThingAction | undefined,
): Deed {
  if (trigger === 'double_tap') {
    const deed = action ? cardDeedOf(action) : null;

    return deed && deedChoices(kind, 'tap').includes(deed) ? deed : 'none';
  }

  if (!action) return defaultDeed(kind, trigger);

  const deed = cardDeedOf(action);

  if (!deed) return 'none';

  return deedChoices(kind, trigger).includes(deed)
    ? deed
    : defaultDeed(kind, trigger);
}

export function cardDeedOf(action: ThingAction): Deed | null {
  const { action: type } = action;

  if (type === 'toggle' || type === 'more-info' || type === 'none') {
    return type;
  }

  if (type !== 'perform-action' && type !== 'call-service') return null;

  const service = action.perform_action ?? action.service;
  const aimed = ['data', 'service_data', 'target'].some(
    (field) => action[field] !== undefined,
  );

  return !aimed &&
    typeof service === 'string' &&
    Object.hasOwn(performedDeeds, service)
    ? performedDeeds[service as PerformAction]
    : null;
}

export function handedToHass(action: ThingAction | undefined): boolean {
  return (
    action !== undefined &&
    cardDeedOf(action) === null &&
    hassActions.includes(action.action)
  );
}

export function planDeed(
  control: Control,
  deed: PlannedDeed,
  firm = false,
): ControlPlan {
  if (deed === 'open' || deed === 'close') return planCover(control, deed);
  if (deed === 'lock' || deed === 'unlock') {
    return planLock(control, deed === 'unlock');
  }

  return planToggle(control, firm);
}

export function isPlanned(deed: Deed): deed is PlannedDeed {
  return (
    deed === 'toggle' ||
    deed === 'open' ||
    deed === 'close' ||
    deed === 'lock' ||
    deed === 'unlock'
  );
}

function controlName(
  kind: ControlKind,
  scopeState: ScopeState,
  states: HassEntityState[],
  homeName: string | null,
): string {
  const reading = scopeState.reading;
  const { scope } = scopeState;

  if (homeName) return homeName;
  if (kind === 'room' && reading?.kind === 'area' && reading.areaName) {
    return reading.areaName;
  }

  return (
    friendlyName(states) ??
    (isWordId(scope.id) ? humanize(scope) : scopeLabels[scope.type])
  );
}

export function friendlyName(states: HassEntityState[]): string | null {
  return (
    states
      .map((state) => state.attributes.friendly_name)
      .find(
        (name): name is string => typeof name === 'string' && name !== '',
      ) ?? null
  );
}

function callsByDomain(entityIds: string[], service: string): ServiceCall[] {
  const byDomain = new Map<string, string[]>();

  for (const entityId of entityIds) {
    const domain = entityDomain(entityId);

    byDomain.set(domain, [...(byDomain.get(domain) ?? []), entityId]);
  }

  return [...byDomain].map(([domain, ids]) => ({
    domain,
    service,
    data: { entity_id: ids.length === 1 ? ids[0] : ids },
  }));
}

function coverMoved(state: HassEntityState, open: boolean): HassEntityState {
  return withState(state, open ? 'open' : 'closed', {
    current_position: open ? 100 : 0,
  });
}

function withState(
  state: HassEntityState,
  value: string,
  attributes: Record<string, unknown> = {},
): HassEntityState {
  return {
    ...state,
    state: value,
    attributes: { ...state.attributes, ...attributes },
  };
}

export function humanize(scope: SceneScope): string {
  const words = scope.id.replace(/[_-]+/g, ' ').trim();

  if (!words) return scope.id;

  return words.charAt(0).toUpperCase() + words.slice(1);
}
