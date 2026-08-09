import { describe, expect, it } from 'vitest';

import {
  alertIcons,
  type AlertKind,
  formatAgo,
  isArmed,
  OPEN_ALERT_AFTER_MINUTES,
  openAlertAfterMs,
  readAlerts,
  severityOf,
} from '../src/alerts.js';
import type { SceneBinding } from '../src/bindings.js';
import { type HassEntityState, mapScopeStates } from '../src/hass-state.js';
import {
  createMockHass,
  mockBinarySensor,
  mockCover,
  mockEntityState,
} from './mock-hass.js';

const MINUTE = 60 * 1000;
const NOW = Date.parse('2026-09-23T12:00:00.000Z');
const TEN_MINUTES = OPEN_ALERT_AFTER_MINUTES * MINUTE;

function changed(state: HassEntityState, msAgo: number): HassEntityState {
  const at = new Date(NOW - msAgo).toISOString();

  return { ...state, last_changed: at, last_updated: at };
}

function read(
  states: HassEntityState[],
  bindings: SceneBinding[],
  options: { now?: number; openAfterMs?: number } = {},
) {
  const hass = createMockHass({ states });

  return readAlerts(
    hass,
    mapScopeStates(hass, bindings),
    options.now ?? NOW,
    options.openAfterMs ?? TEN_MINUTES,
  );
}

const bathroom: SceneBinding = {
  scope: { type: 'room', id: 'bathroom' },
  entity_ids: ['binary_sensor.bathroom_leak'],
};

const frontDoor: SceneBinding = {
  scope: { type: 'door', id: 'front' },
  entity_id: 'binary_sensor.front_door',
};

function openDoor(msAgo: number): HassEntityState {
  return changed(
    mockBinarySensor('binary_sensor.front_door', 'door', true),
    msAgo,
  );
}

describe('alert severity', () => {
  it('treats leaks, smoke, gas and a triggered alarm as critical', () => {
    const kinds: AlertKind[] = ['leak', 'smoke', 'gas', 'alarm'];

    expect(kinds.map(severityOf)).toEqual([
      'critical',
      'critical',
      'critical',
      'critical',
    ]);
  });

  it('treats an open door or window and a problem as a notice', () => {
    const kinds: AlertKind[] = ['door', 'window', 'problem'];

    expect(kinds.map(severityOf)).toEqual(['notice', 'notice', 'notice']);
  });

  it('maps each sensor class to its kind and icon', () => {
    const classes = ['moisture', 'smoke', 'gas', 'safety', 'problem'];
    const states = classes.map((deviceClass) =>
      changed(
        mockBinarySensor(`binary_sensor.${deviceClass}`, deviceClass, true),
        MINUTE,
      ),
    );
    const { alerts } = read(states, [
      {
        scope: { type: 'room', id: 'hall' },
        entity_ids: states.map((state) => state.entity_id),
      },
    ]);
    const byEntity = Object.fromEntries(
      alerts.map((alert) => [alert.entityId, alert.kind]),
    );

    expect(byEntity).toEqual({
      'binary_sensor.moisture': 'leak',
      'binary_sensor.smoke': 'smoke',
      'binary_sensor.gas': 'gas',
      'binary_sensor.safety': 'gas',
      'binary_sensor.problem': 'problem',
    });
    expect(alertIcons.leak).toBe('droplets');
    expect(alertIcons.gas).toBe('triangle-alert');
    expect(alertIcons.alarm).toBe('siren');
  });

  it('ignores a sensor that is dry, clear or unavailable', () => {
    const { alerts } = read(
      [
        mockBinarySensor('binary_sensor.bathroom_leak', 'moisture', false),
        mockEntityState('binary_sensor.kitchen_smoke', 'unavailable', {
          device_class: 'smoke',
        }),
      ],
      [
        {
          ...bathroom,
          entity_ids: [
            'binary_sensor.bathroom_leak',
            'binary_sensor.kitchen_smoke',
          ],
        },
      ],
    );

    expect(alerts).toEqual([]);
  });

  it('places a leak in the room it is bound to', () => {
    const { alerts } = read(
      [
        changed(
          mockBinarySensor('binary_sensor.bathroom_leak', 'moisture', true),
          2 * MINUTE,
        ),
      ],
      [bathroom],
    );

    expect(alerts).toEqual([
      {
        key: 'binary_sensor.bathroom_leak',
        kind: 'leak',
        severity: 'critical',
        entityId: 'binary_sensor.bathroom_leak',
        scope: { type: 'room', id: 'bathroom' },
        since: NOW - 2 * MINUTE,
      },
    ]);
  });
});

describe('an alarm panel', () => {
  it('raises a whole house alarm when an unbound panel is triggered', () => {
    const { alerts } = read(
      [mockEntityState('alarm_control_panel.house', 'triggered')],
      [],
    );

    expect(alerts.map((alert) => [alert.kind, alert.scope])).toEqual([
      ['alarm', null],
    ]);
  });

  it('raises nothing while armed, and says it is armed', () => {
    const states = [mockEntityState('alarm_control_panel.house', 'armed_away')];

    expect(read(states, []).alerts).toEqual([]);
    expect(isArmed(createMockHass({ states }))).toBe(true);
  });

  it('is not armed when disarmed or triggered', () => {
    for (const state of ['disarmed', 'triggered', 'pending']) {
      const hass = createMockHass({
        states: [mockEntityState('alarm_control_panel.house', state)],
      });

      expect(isArmed(hass)).toBe(false);
    }
  });
});

describe('a door left open', () => {
  it('is not flagged just under the threshold, and says when to look again', () => {
    const reading = read([openDoor(TEN_MINUTES - 1000)], [frontDoor]);

    expect(reading.alerts).toEqual([]);
    expect(reading.recheckIn).toBe(1000);
  });

  it('is flagged at the threshold', () => {
    const { alerts } = read([openDoor(TEN_MINUTES)], [frontDoor]);

    expect(alerts.map((alert) => [alert.kind, alert.severity])).toEqual([
      ['door', 'notice'],
    ]);
  });

  it('is flagged past the threshold, pinned on the door itself', () => {
    const { alerts, recheckIn } = read(
      [openDoor(TEN_MINUTES + 5 * MINUTE)],
      [frontDoor],
    );

    expect(alerts[0]?.scope).toEqual({ type: 'door', id: 'front' });
    expect(recheckIn).toBeNull();
  });

  it('clears when closed, and starts counting again when reopened', () => {
    const closed = changed(
      mockBinarySensor('binary_sensor.front_door', 'door', false),
      0,
    );

    expect(read([closed], [frontDoor]).alerts).toEqual([]);

    const reopened = read([openDoor(MINUTE)], [frontDoor]);

    expect(reopened.alerts).toEqual([]);
    expect(reopened.recheckIn).toBe(TEN_MINUTES - MINUTE);
  });

  it('follows a changed threshold', () => {
    const door = [openDoor(6 * MINUTE)];

    expect(read(door, [frontDoor]).alerts).toEqual([]);
    expect(
      read(door, [frontDoor], { openAfterMs: 5 * MINUTE }).alerts,
    ).toHaveLength(1);
    expect(openAlertAfterMs({ open_alert_after: 5 })).toBe(5 * MINUTE);
    expect(openAlertAfterMs({})).toBe(TEN_MINUTES);
  });

  it('calls a sensor on a window a window left open', () => {
    const { alerts } = read(
      [
        changed(
          mockBinarySensor('binary_sensor.bedroom_window', 'window', true),
          TEN_MINUTES,
        ),
      ],
      [
        {
          scope: { type: 'window', id: 'bedroom-east' },
          entity_id: 'binary_sensor.bedroom_window',
        },
      ],
    );

    expect(alerts.map((alert) => alert.kind)).toEqual(['window']);
  });

  it('counts an open garage door, and never an open blind', () => {
    const blind = changed(
      mockEntityState('cover.bedroom_blind', 'open', { device_class: 'blind' }),
      TEN_MINUTES,
    );
    const garage = changed(mockCover('cover.garage', 100), TEN_MINUTES);
    const { alerts } = read(
      [blind, garage],
      [
        {
          scope: { type: 'window', id: 'bedroom-east' },
          entity_id: 'cover.bedroom_blind',
        },
        { scope: { type: 'door', id: 'garage' }, entity_id: 'cover.garage' },
      ],
    );

    expect(alerts.map((alert) => alert.entityId)).toEqual(['cover.garage']);
  });

  it('pins a sensor bound both to a door and a room on the door', () => {
    const { alerts } = read(
      [openDoor(TEN_MINUTES)],
      [
        {
          scope: { type: 'room', id: 'hall' },
          entity_ids: ['binary_sensor.front_door'],
        },
        frontDoor,
      ],
    );

    expect(alerts.map((alert) => alert.scope)).toEqual([
      { type: 'door', id: 'front' },
    ]);
  });
});

describe('alert order', () => {
  it('puts the newest alert first', () => {
    const { alerts } = read(
      [
        changed(
          mockBinarySensor('binary_sensor.bathroom_leak', 'moisture', true),
          5 * MINUTE,
        ),
        changed(
          mockBinarySensor('binary_sensor.kitchen_smoke', 'smoke', true),
          MINUTE,
        ),
      ],
      [
        bathroom,
        {
          scope: { type: 'room', id: 'kitchen' },
          entity_id: 'binary_sensor.kitchen_smoke',
        },
      ],
    );

    expect(alerts.map((alert) => alert.kind)).toEqual(['smoke', 'leak']);
  });
});

describe('how long ago', () => {
  it('reads now, minutes, hours and days', () => {
    expect(formatAgo(30 * 1000)).toBe('now');
    expect(formatAgo(2 * MINUTE)).toBe('2 min');
    expect(formatAgo(90 * MINUTE)).toBe('1 h');
    expect(formatAgo(50 * 60 * MINUTE)).toBe('2 d');
  });
});
