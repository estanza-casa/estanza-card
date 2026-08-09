import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { deriveFloors } from '@estanza/plan-engine/geometry/geometry.js';
import { describe, expect, it } from 'vitest';

import type { SceneBinding } from '../src/bindings.js';
import { mapScopeStates } from '../src/hass-state.js';
import {
  boxOf,
  dockCovers,
  dockSpot,
  mostlyUnderSheet,
  openingsInRoom,
  SHEET_EDGE_PX,
  SHEET_WIDTH_PX,
  sheetsBelow,
  SWIPE_FLICK_PX_PER_MS,
  swipeCloses,
  underSheet,
  WIDE_VIEWPORT_PX,
} from '../src/sheet.js';
import homeFixture from './fixtures/home.json';
import { createMockHass, mockBinarySensor, mockLock } from './mock-hass.js';

function floorsWithWindow() {
  const [ground, ...upper] = homeFixture.plan.floors;
  const win1 = {
    id: 'win1',
    wallId: 'w6',
    position: 0.5,
    width: 100,
    height: 120,
    sillHeight: 90,
    type: 'standard',
  };
  const home = homeDocumentSchema.parse({
    ...homeFixture,
    plan: {
      ...homeFixture.plan,
      floors: [{ ...ground, windows: [win1] }, ...upper],
    },
  });

  return deriveFloors(home);
}

describe('a room under an open sheet', () => {
  const room = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 0, y: 100 },
  ];

  it('is mostly covered when the sheet hides more than half of its floor', () => {
    expect(
      mostlyUnderSheet(room, [{ left: -20, top: -20, right: 140, bottom: 90 }]),
    ).toBe(true);
  });

  it('is not mostly covered when the sheet hides less than half of it', () => {
    expect(
      mostlyUnderSheet(room, [
        { left: 120, top: -20, right: 400, bottom: 300 },
      ]),
    ).toBe(false);
    expect(mostlyUnderSheet(room, [])).toBe(false);
  });

  it('measures a slanted room by its own outline, not its box', () => {
    const slant = [
      { x: 0, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ];

    expect(
      mostlyUnderSheet(slant, [{ left: 100, top: 0, right: 300, bottom: 100 }]),
    ).toBe(false);
    expect(
      mostlyUnderSheet(slant, [{ left: -10, top: 0, right: 90, bottom: 110 }]),
    ).toBe(true);
  });
});

describe('a mark near an open sheet', () => {
  const sheet = { left: 300, top: 20, right: 560, bottom: 220 };
  const disc = { width: 28, height: 28 };

  it('hides a mark that shows half under the sheet edge', () => {
    expect(underSheet({ x: 565, y: 100 }, disc, [sheet])).toBe(true);
  });

  it('hides a mark wholly under the sheet', () => {
    expect(underSheet({ x: 400, y: 100 }, disc, [sheet])).toBe(true);
  });

  it('keeps a mark clear of the sheet', () => {
    expect(underSheet({ x: 600, y: 100 }, disc, [sheet])).toBe(false);
    expect(underSheet({ x: 400, y: 260 }, disc, [sheet])).toBe(false);
  });

  it('keeps a mark that only touches the sheet edge', () => {
    expect(underSheet({ x: 574, y: 100 }, disc, [sheet])).toBe(false);
  });

  it('keeps every mark when no sheet is open', () => {
    expect(underSheet({ x: 400, y: 100 }, disc, [])).toBe(false);
  });
});

describe('the box of a thing', () => {
  it('bounds its points', () => {
    expect(
      boxOf([
        { x: 4, y: 9 },
        { x: -2, y: 30 },
        { x: 10, y: 1 },
      ]),
    ).toEqual({ left: -2, top: 1, right: 10, bottom: 30 });
  });

  it('is nothing without points', () => {
    expect(boxOf([])).toBeNull();
  });
});

describe('a downward swipe on a bottom sheet', () => {
  it('closes the sheet once it has dragged a quarter of its height', () => {
    expect(swipeCloses(99, 400, 0)).toBe(false);
    expect(swipeCloses(101, 400, 0)).toBe(true);
  });

  it('closes on a fast flick that has barely moved', () => {
    expect(swipeCloses(30, 400, SWIPE_FLICK_PX_PER_MS)).toBe(true);
  });

  it('snaps back from a slow short drag or a flick back up', () => {
    expect(swipeCloses(40, 400, 0.1)).toBe(false);
    expect(swipeCloses(90, 400, -SWIPE_FLICK_PX_PER_MS * 2)).toBe(false);
  });
});

describe('the dock of a sheet', () => {
  it('sits at the top right of the card, one edge in', () => {
    expect(dockSpot({ width: 1024, height: 806 }, 0)).toEqual({
      x: 1024 - SHEET_EDGE_PX - SHEET_WIDTH_PX,
      y: SHEET_EDGE_PX,
      width: SHEET_WIDTH_PX,
      room: 806 - 2 * SHEET_EDGE_PX,
    });
  });

  it('never covers more than 60% of the card width', () => {
    expect(dockSpot({ width: 580, height: 351 }, 0).width).toBe(SHEET_WIDTH_PX);
    expect(dockSpot({ width: 700, height: 351 }, 0).width).toBe(SHEET_WIDTH_PX);
  });

  it('covers the whole card when it would leave less than 40% of it free', () => {
    expect(dockCovers({ width: 468, height: 351 })).toBe(true);
    expect(dockCovers({ width: 400, height: 351 })).toBe(true);
    expect(dockCovers({ width: 372, height: 279 })).toBe(true);
    expect(dockCovers({ width: 520, height: 400 })).toBe(false);
    expect(dockCovers({ width: 580, height: 800 })).toBe(false);
    expect(dockSpot({ width: 468, height: 351 }, 0)).toMatchObject({
      x: SHEET_EDGE_PX,
      width: 468 - 2 * SHEET_EDGE_PX,
    });
  });

  it('drops below a banner that needs the top of the card', () => {
    expect(dockSpot({ width: 820, height: 1180 }, 68).y).toBe(68);
  });

  it('caps a short card at its height less the edge gaps, so the sheet scrolls inside', () => {
    expect(dockSpot({ width: 468, height: 351 }, 0).room).toBe(
      351 - 2 * SHEET_EDGE_PX,
    );
    expect(dockSpot({ width: 844, height: 296 }, 68).room).toBe(
      296 - 68 - SHEET_EDGE_PX,
    );
  });

  it('keeps clear of controls along the bottom of the card', () => {
    expect(dockSpot({ width: 820, height: 1000 }, 0, 96).room).toBe(
      1000 - SHEET_EDGE_PX - 96,
    );
  });
});

describe('where a sheet opens', () => {
  it('docks in any viewport at least 600 wide, whatever the card', () => {
    expect(sheetsBelow(WIDE_VIEWPORT_PX)).toBe(false);
    expect(sheetsBelow(844)).toBe(false);
    expect(sheetsBelow(1920)).toBe(false);
  });

  it('rises from the bottom only in a phone-portrait viewport', () => {
    expect(sheetsBelow(WIDE_VIEWPORT_PX - 1)).toBe(true);
    expect(sheetsBelow(390)).toBe(true);
    expect(sheetsBelow(390, { width: 390, height: 700 })).toBe(true);
  });

  it('covers a card small both ways on a phone instead of rising over a strip of it', () => {
    expect(sheetsBelow(390, { width: 372, height: 279 })).toBe(false);
    expect(sheetsBelow(390, { width: 374, height: 300 })).toBe(false);
  });
});

describe('what is open in a room', () => {
  const bindings: SceneBinding[] = [
    { scope: { type: 'door', id: 'd1' }, entity_id: 'binary_sensor.d1' },
    { scope: { type: 'window', id: 'win1' }, entity_id: 'binary_sensor.win1' },
  ];

  function read(d1: boolean, win1: boolean) {
    const hass = createMockHass({
      states: [
        mockBinarySensor('binary_sensor.d1', 'door', d1),
        mockBinarySensor('binary_sensor.win1', 'window', win1),
      ],
    });

    return mapScopeStates(hass, bindings);
  }

  it('lists an open door in both rooms it joins and nowhere else', () => {
    const floors = floorsWithWindow();
    const states = read(true, false);

    expect(openingsInRoom(floors, 'living-space', states, [])).toEqual([
      {
        kind: 'door',
        entityId: 'binary_sensor.d1',
        scope: { type: 'door', id: 'd1' },
        beyond: 'Bathroom',
        open: true,
        lock: null,
      },
    ]);
    expect(openingsInRoom(floors, 'bathroom', states, [])[0]).toEqual(
      expect.objectContaining({ beyond: 'Living Space', open: true }),
    );
    expect(openingsInRoom(floors, 'hall', states, [])).toEqual([]);
  });

  it('lists an open window on one of the room walls', () => {
    const floors = floorsWithWindow();

    expect(
      openingsInRoom(floors, 'bathroom', read(false, true), []).map((thing) => [
        thing.kind,
        thing.open,
      ]),
    ).toEqual([
      ['door', false],
      ['window', true],
    ]);
  });

  it('lists every door and window of the room, shut ones too', () => {
    expect(
      openingsInRoom(floorsWithWindow(), 'bathroom', read(false, false), []),
    ).toEqual([
      expect.objectContaining({ entityId: 'binary_sensor.d1', open: false }),
      expect.objectContaining({ entityId: 'binary_sensor.win1', open: false }),
    ]);
  });

  it('lists the doors then the windows in plan order, whatever order they were linked in', () => {
    const hass = createMockHass({
      states: [
        mockBinarySensor('binary_sensor.d1', 'door', false),
        mockBinarySensor('binary_sensor.win1', 'window', true),
      ],
    });
    const states = mapScopeStates(hass, [...bindings].reverse());

    expect(
      openingsInRoom(floorsWithWindow(), 'bathroom', states, []).map(
        (thing) => thing.entityId,
      ),
    ).toEqual(['binary_sensor.d1', 'binary_sensor.win1']);
  });

  it('adds every contact sensor bound to the room itself, open or shut, after the plan openings', () => {
    const contact = mockBinarySensor(
      'binary_sensor.study_window',
      'window',
      true,
    );
    const shut = mockBinarySensor('binary_sensor.study_door', 'door', false);

    expect(
      openingsInRoom(floorsWithWindow(), 'hall', read(false, false), [
        contact,
        shut,
      ]),
    ).toEqual([
      {
        kind: 'door',
        entityId: 'binary_sensor.study_door',
        scope: null,
        beyond: null,
        open: false,
        lock: null,
      },
      {
        kind: 'window',
        entityId: 'binary_sensor.study_window',
        scope: null,
        beyond: null,
        open: true,
        lock: null,
      },
    ]);
  });

  it('carries the lock linked to a door beside its contact sensor', () => {
    const hass = createMockHass({
      states: [
        mockBinarySensor('binary_sensor.d1', 'door', false),
        mockLock('lock.d1', 'locked'),
      ],
    });
    const states = mapScopeStates(hass, [
      ...bindings,
      { scope: { type: 'door', id: 'd1' }, entity_id: 'lock.d1' },
    ]);

    expect(
      openingsInRoom(floorsWithWindow(), 'living-space', states, []),
    ).toEqual([
      expect.objectContaining({
        entityId: 'binary_sensor.d1',
        open: false,
        lock: 'lock.d1',
      }),
    ]);
  });

  it('lists a door that has only a lock linked', () => {
    const hass = createMockHass({ states: [mockLock('lock.d1', 'unlocked')] });
    const states = mapScopeStates(hass, [
      { scope: { type: 'door', id: 'd1' }, entity_id: 'lock.d1' },
    ]);

    expect(
      openingsInRoom(floorsWithWindow(), 'living-space', states, []),
    ).toEqual([
      {
        kind: 'door',
        entityId: 'lock.d1',
        scope: { type: 'door', id: 'd1' },
        beyond: 'Bathroom',
        open: false,
        lock: 'lock.d1',
      },
    ]);
  });
});
