import type { EstanzaCardConfig, SceneScope } from './bindings.js';
import {
  deviceClassOf,
  doorDeviceClasses,
  entityDomain,
  type HassEntityState,
  type HomeAssistant,
  isUnavailable,
  type ScopeStateMap,
  windowDeviceClasses,
} from './hass-state.js';
import type { IconName } from './icons.js';

export const alertKinds = [
  'leak',
  'smoke',
  'gas',
  'alarm',
  'door',
  'window',
  'problem',
] as const;

export type AlertKind = (typeof alertKinds)[number];

export const alertSeverities = ['critical', 'notice'] as const;

export type AlertSeverity = (typeof alertSeverities)[number];

export type HomeAlert = {
  key: string;
  kind: AlertKind;
  severity: AlertSeverity;
  entityId: string;
  scope: SceneScope | null;
  since: number;
};

export type AlertReading = {
  alerts: HomeAlert[];
  recheckIn: number | null;
};

export type ArmedAlarm = { entityId: string; away: boolean };

export const OPEN_ALERT_AFTER_MINUTES = 10;

export const alertIcons: Record<AlertKind, IconName> = {
  leak: 'droplets',
  smoke: 'alarm-smoke',
  gas: 'triangle-alert',
  alarm: 'siren',
  door: 'door-open',
  window: 'app-window',
  problem: 'circle-alert',
};

export const alertWords: Record<AlertKind, string> = {
  leak: 'Leak',
  smoke: 'Smoke',
  gas: 'Gas',
  alarm: 'Alarm',
  door: 'Door open',
  window: 'Window open',
  problem: 'Problem',
};

export const alertStates: Record<AlertKind, string> = {
  leak: 'Leak detected',
  smoke: 'Smoke detected',
  gas: 'Gas detected',
  alarm: 'Triggered',
  door: 'Open',
  window: 'Open',
  problem: 'Problem',
};

const criticalKinds: readonly AlertKind[] = ['leak', 'smoke', 'gas', 'alarm'];

const sensorKinds: Record<string, AlertKind> = {
  moisture: 'leak',
  smoke: 'smoke',
  gas: 'gas',
  safety: 'gas',
  problem: 'problem',
};

const alarmDomain = 'alarm_control_panel';
const homeArmings: readonly string[] = ['armed_home', 'armed_night'];
const scopeOrder: readonly string[] = ['door', 'window', 'prop', 'light'];
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function severityOf(kind: AlertKind): AlertSeverity {
  return criticalKinds.includes(kind) ? 'critical' : 'notice';
}

export function openAlertAfterMs(
  config: Pick<EstanzaCardConfig, 'open_alert_after'>,
): number {
  return (config.open_alert_after ?? OPEN_ALERT_AFTER_MINUTES) * MINUTE_MS;
}

export function readAlerts(
  hass: HomeAssistant,
  scopeStates: ScopeStateMap,
  now: number,
  openAfterMs: number,
): AlertReading {
  const claimed = new Set<string>();
  const alerts: HomeAlert[] = [];
  let recheckIn: number | null = null;

  const consider = (state: HassEntityState, scope: SceneScope | null) => {
    if (claimed.has(state.entity_id)) return;

    claimed.add(state.entity_id);

    const kind = alertKindOf(state, scope);

    if (!kind) return;

    const since = changedAt(state, now);

    if (kind === 'door' || kind === 'window') {
      const due = since + openAfterMs - now;

      if (due > 0) {
        recheckIn = recheckIn === null ? due : Math.min(recheckIn, due);

        return;
      }
    }

    alerts.push({
      key: state.entity_id,
      kind,
      severity: severityOf(kind),
      entityId: state.entity_id,
      scope,
      since,
    });
  };

  const scoped = Object.values(scopeStates).sort(
    (a, b) => rank(a.scope) - rank(b.scope),
  );

  for (const scopeState of scoped) {
    for (const state of scopeState.states) consider(state, scopeState.scope);
  }

  for (const state of Object.values(hass.states)) {
    if (entityDomain(state.entity_id) === alarmDomain) consider(state, null);
  }

  alerts.sort((a, b) => b.since - a.since || a.key.localeCompare(b.key));

  return { alerts, recheckIn };
}

export function isArmed(hass: HomeAssistant): boolean {
  return armedAlarm(hass) !== null;
}

export function armedAlarm(hass: HomeAssistant): ArmedAlarm | null {
  const panel = Object.values(hass.states).find(
    (state) =>
      entityDomain(state.entity_id) === alarmDomain &&
      state.state.startsWith('armed_'),
  );

  if (!panel) return null;

  return {
    entityId: panel.entity_id,
    away: !homeArmings.includes(panel.state),
  };
}

export function alertName(kind: AlertKind, subject: string | null): string {
  if (kind === 'door' || kind === 'window') return subject ?? alertWords[kind];
  if (kind === 'alarm' && subject === null) return 'House alarm';
  if (subject === null) return alertWords[kind];

  return `${subject} ${alertWords[kind].toLowerCase()}`;
}

export function formatAgo(ms: number): string {
  if (ms < MINUTE_MS) return 'now';
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)} min`;
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)} h`;

  return `${Math.floor(ms / DAY_MS)} d`;
}

function alertKindOf(
  state: HassEntityState,
  scope: SceneScope | null,
): AlertKind | null {
  if (isUnavailable(state)) return null;

  const domain = entityDomain(state.entity_id);
  const deviceClass = deviceClassOf(state) ?? '';

  if (domain === alarmDomain)
    return state.state === 'triggered' ? 'alarm' : null;

  if (domain === 'cover') {
    const door = (doorDeviceClasses as readonly string[]).includes(deviceClass);

    return door && state.state === 'open' ? 'door' : null;
  }

  if (domain !== 'binary_sensor' || state.state !== 'on') return null;

  const sensed = Object.hasOwn(sensorKinds, deviceClass)
    ? sensorKinds[deviceClass]
    : null;

  if (sensed) return sensed;

  if ((windowDeviceClasses as readonly string[]).includes(deviceClass)) {
    return scope?.type === 'door' ? 'door' : 'window';
  }

  if ((doorDeviceClasses as readonly string[]).includes(deviceClass)) {
    return scope?.type === 'window' ? 'window' : 'door';
  }

  return null;
}

function changedAt(state: HassEntityState, now: number): number {
  const at = Date.parse(state.last_changed);

  return Number.isFinite(at) ? at : now;
}

function rank(scope: SceneScope): number {
  const index = scopeOrder.indexOf(scope.type);

  return index === -1 ? scopeOrder.length : index;
}
