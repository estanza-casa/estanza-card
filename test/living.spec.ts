import { describe, expect, it } from 'vitest';

import {
  bandOf,
  boxInside,
  comfortBand,
  covered,
  flagOf,
  followsClock,
  formatHumidity,
  formatTemperature,
  homedPills,
  insetPolygon,
  insidePolygon,
  labelWidth,
  LEADER_REACH_PX,
  lookOf,
  nudgedPills,
  overlapsRing,
  pillInside,
  placePills,
  roomsInView,
  strandedPills,
  strayKeys,
  type SunAngles as Sun,
  sunOf,
  tintOf,
  uncrossed,
} from '../src/living.js';
import hallUnderSheet from './fixtures/hall-under-sheet.json';
import {
  createMockHass,
  MADRID,
  mockEntityState,
  NULL_ISLAND,
} from './mock-hass.js';

describe('the comfort band', () => {
  it('runs from 18 to 26 degrees by default', () => {
    expect(comfortBand({}, '°C')).toEqual({ min: 18, max: 26 });
  });

  it('takes the band a reader configured', () => {
    expect(comfortBand({ comfort_min: 19, comfort_max: 23 }, '°C')).toEqual({
      min: 19,
      max: 23,
    });
  });

  it('turns the default into Fahrenheit for a Fahrenheit home', () => {
    const band = comfortBand({}, '°F');

    expect(band.min).toBeCloseTo(64.4);
    expect(band.max).toBeCloseTo(78.8);
  });

  it('keeps a configured band in the unit the reader wrote it in', () => {
    expect(comfortBand({ comfort_min: 60, comfort_max: 80 }, '°F')).toEqual({
      min: 60,
      max: 80,
    });
  });

  it('calls a room below the band cold', () => {
    expect(bandOf(17.9, { min: 18, max: 25 })).toBe('cold');
  });

  it('calls a room above the band hot', () => {
    expect(bandOf(25.1, { min: 18, max: 25 })).toBe('hot');
  });

  it('keeps both edges of the band comfortable', () => {
    expect(bandOf(18, { min: 18, max: 25 })).toBe('comfort');
    expect(bandOf(25, { min: 18, max: 25 })).toBe('comfort');
  });
});

describe('a temperature on the floor', () => {
  it('reads as a number and a degree, one decimal place', () => {
    expect(formatTemperature(19.24, '°C', '°C')).toBe('19.2°');
  });

  it('keeps the zero of a whole reading', () => {
    expect(formatTemperature(21, '°C', '°C')).toBe('21.0°');
    expect(formatTemperature(21.04, '°C', '°C')).toBe('21.0°');
  });

  it('never writes the unit letter', () => {
    expect(formatTemperature(26, null, null)).toBe('26.0°');
  });

  it('turns a Celsius reading into Fahrenheit for a Fahrenheit home', () => {
    expect(formatTemperature(20, '°C', '°F')).toBe('68.0°');
  });

  it('turns a Fahrenheit reading into Celsius for a Celsius home', () => {
    expect(formatTemperature(68, '°F', '°C')).toBe('20.0°');
  });

  it('turns a kelvin reading into the home unit', () => {
    expect(formatTemperature(293.75, 'K', '°C')).toBe('20.6°');
  });

  it('sizes a pill by its reading alone', () => {
    expect(labelWidth('19.2°')).toBeGreaterThan(labelWidth('19°'));
  });
});

describe('a humidity', () => {
  it('reads as a whole percent with no space', () => {
    expect(formatHumidity(45)).toBe('45%');
    expect(formatHumidity(45.4)).toBe('45%');
    expect(formatHumidity(45.5)).toBe('46%');
  });
});

describe('an outlier temperature', () => {
  const band = { min: 18, max: 26 };
  const calm = [20, 21, 21.5, 22];

  it('shows just the number for a room like the others', () => {
    expect(flagOf(21, calm, band, '°C')).toBeNull();
  });

  it('marks the warmest room when it stands 2 degrees above the rest', () => {
    expect(flagOf(23.5, [...calm, 23.5], band, '°C')).toBe('hot');
  });

  it('marks the coolest room when it stands 2 degrees below the rest', () => {
    expect(flagOf(19, [19, 21, 21.5, 22], band, '°C')).toBe('cold');
  });

  it('leaves the warmest room alone when it is less than 2 degrees apart', () => {
    expect(flagOf(22, calm, band, '°C')).toBeNull();
  });

  it('marks only the extremes, not a room merely far from the middle', () => {
    expect(flagOf(24, [18.5, 24, 24.5, 25], band, '°C')).toBeNull();
  });

  it('marks any room above 26 degrees, even when every room is as hot', () => {
    expect(flagOf(26.5, [26.5, 26.5, 27], band, '°C')).toBe('hot');
  });

  it('marks any room below 18 degrees', () => {
    expect(flagOf(17.5, [17.5, 17.6], band, '°C')).toBe('cold');
  });

  it('keeps both edges of the band unmarked', () => {
    expect(flagOf(18, [18, 18.5], band, '°C')).toBeNull();
    expect(flagOf(26, [25.5, 26], band, '°C')).toBeNull();
  });

  it('never marks a lone room for standing apart from itself', () => {
    expect(flagOf(21, [21], band, '°C')).toBeNull();
  });

  it('measures the gap in Fahrenheit as 3.6 degrees', () => {
    const fahrenheit = { min: 64.4, max: 78.8 };

    expect(flagOf(73.5, [70, 70, 73.5], fahrenheit, '°F')).toBeNull();
    expect(flagOf(73.7, [70, 70, 73.7], fahrenheit, '°F')).toBe('hot');
  });
});

describe('a label that must stay inside its room', () => {
  const room = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 40 },
    { x: 0, y: 40 },
  ];

  it('fits a label well inside the room', () => {
    expect(boxInside({ x: 50, y: 20 }, 60, 22, room)).toBe(true);
  });

  it('refuses a label wider than the room', () => {
    expect(boxInside({ x: 50, y: 20 }, 120, 22, room)).toBe(false);
  });

  it('refuses a label hanging over an edge', () => {
    expect(boxInside({ x: 90, y: 20 }, 40, 22, room)).toBe(false);
  });

  it('refuses a label across the gap of a U-shaped room', () => {
    const u = [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 200 },
      { x: 80, y: 200 },
      { x: 80, y: 40 },
      { x: 40, y: 40 },
      { x: 40, y: 200 },
      { x: 0, y: 200 },
    ];

    expect(boxInside({ x: 60, y: 60 }, 100, 20, u)).toBe(false);
  });
});

describe('a pill that must stay inside its room', () => {
  const diamond = [
    { x: 0, y: -19 },
    { x: 57, y: 0 },
    { x: 0, y: 19 },
    { x: -57, y: 0 },
  ];

  it('fits a pill whose round ends clear a room seen at a slant', () => {
    expect(boxInside({ x: 0, y: 0 }, 48, 22, diamond)).toBe(false);
    expect(pillInside({ x: 0, y: 0 }, 48, 22, diamond)).toBe(true);
  });

  it('refuses a pill longer than the room', () => {
    expect(pillInside({ x: 0, y: 0 }, 120, 22, diamond)).toBe(false);
  });

  it('refuses a pill taller than the room', () => {
    expect(pillInside({ x: 0, y: 0 }, 40, 40, diamond)).toBe(false);
  });

  it('refuses a pill hanging over an edge', () => {
    expect(pillInside({ x: 40, y: 0 }, 48, 22, diamond)).toBe(false);
  });
});

describe('the temperature tint', () => {
  it('washes a cold room navy', () => {
    expect(tintOf('cold')).toBe('#8296cf');
  });

  it('washes a hot room red', () => {
    expect(tintOf('hot')).toBe('#d06855');
  });

  it('leaves a comfortable room alone', () => {
    expect(tintOf('comfort')).toBeNull();
  });

  it('never uses amber, because amber is light', () => {
    expect([tintOf('cold'), tintOf('hot')]).not.toContain('#e8a06a');
  });
});

function sunAt(
  elevation: unknown,
  azimuth: unknown,
  state = 'above_horizon',
  darkMode = false,
) {
  const hass = createMockHass({
    states: [mockEntityState('sun.sun', state, { elevation, azimuth })],
  });

  hass.themes = { darkMode };

  return hass;
}

describe('the sun the scene follows', () => {
  it('reads the elevation and azimuth Home Assistant reports', () => {
    expect(sunOf('auto', sunAt(12.5, 231.4))).toEqual({
      elevation: 12.5,
      azimuth: 231.4,
    });
  });

  it('has no sun when Home Assistant has no sun entity', () => {
    expect(sunOf('auto', createMockHass())).toBeNull();
  });

  it('has no sun before Home Assistant has handed over its state', () => {
    expect(sunOf('auto', undefined)).toBeNull();
  });

  it('has no sun when an angle is missing or not a number', () => {
    expect(sunOf('auto', sunAt(undefined, 120))).toBeNull();
    expect(sunOf('auto', sunAt(10, 'south'))).toBeNull();
    expect(sunOf('auto', sunAt(Number.NaN, 120))).toBeNull();
  });

  it('has no sun when the scene is always day', () => {
    expect(sunOf('day', sunAt(12, 180))).toBeNull();
  });

  it('has no sun when the scene is always night', () => {
    expect(sunOf('night', sunAt(12, 180))).toBeNull();
  });

  it('hands over a set sun as it stands, below the horizon too', () => {
    expect(sunOf('auto', sunAt(-20, 300, 'below_horizon'))).toEqual({
      elevation: -20,
      azimuth: 300,
    });
  });

  it('follows the real sun under a dark theme too', () => {
    expect(sunOf('auto', sunAt(40, 180, 'above_horizon', true))).toEqual({
      elevation: 40,
      azimuth: 180,
    });
  });
});

describe('the look of the card', () => {
  function hassWith(sun: string, darkMode?: boolean, elevation?: number) {
    const hass = createMockHass({
      states: [
        mockEntityState(
          'sun.sun',
          sun,
          elevation === undefined ? {} : { elevation, azimuth: 200 },
        ),
      ],
    });

    if (darkMode !== undefined) hass.themes = { darkMode };

    return hass;
  }

  it('turns the scene to night with the sun, while the chrome keeps a light theme', () => {
    expect(lookOf('auto', hassWith('below_horizon', false, -20))).toEqual({
      theme: 'light',
      night: true,
    });
    expect(lookOf('auto', hassWith('above_horizon', true, 30))).toEqual({
      theme: 'dark',
      night: false,
    });
  });

  it('falls to night 3 degrees below the horizon when it follows the sun', () => {
    expect(lookOf('auto', hassWith('below_horizon', false, -2)).night).toBe(
      false,
    );
    expect(lookOf('auto', hassWith('below_horizon', false, -3)).night).toBe(
      true,
    );
  });

  it('falls to night below the horizon when the sun reports no angles', () => {
    expect(lookOf('auto', hassWith('below_horizon', false)).night).toBe(true);
  });

  it('keeps the day scene always when told to, whatever the sun and the theme', () => {
    expect(lookOf('day', hassWith('below_horizon', true, -20))).toEqual({
      theme: 'dark',
      night: false,
    });
  });

  it('keeps the night scene always when told to, whatever the sun and the theme', () => {
    expect(lookOf('night', hassWith('above_horizon', false, 40))).toEqual({
      theme: 'light',
      night: true,
    });
    expect(lookOf('night', undefined).night).toBe(true);
  });

  it('is light when the theme says nothing about dark mode', () => {
    expect(lookOf('day', hassWith('below_horizon'))).toEqual({
      theme: 'light',
      night: false,
    });
  });

  it('is light by day before Home Assistant has handed over its state', () => {
    expect(lookOf('day', undefined)).toEqual({
      theme: 'light',
      night: false,
    });
  });
});

describe('the sun of a Home Assistant without a location', () => {
  const noon = new Date(2026, 8, 29, 13, 0);
  const evening = new Date(2026, 8, 29, 22, 0);

  function hassAt(
    location: { latitude: number; longitude: number } | null,
    sun: Sun | null,
    darkMode = false,
  ) {
    const hass = createMockHass({
      location,
      states: sun
        ? [
            mockEntityState(
              'sun.sun',
              sun.elevation > 0 ? 'above_horizon' : 'below_horizon',
              sun,
            ),
          ]
        : [],
    });

    hass.themes = { darkMode };

    return hass;
  }

  const setSun: Sun = { elevation: -20, azimuth: 300 };
  const highSun: Sun = { elevation: 45, azimuth: 180 };

  it('hands the scene no sun at 0, 0, where Home Assistant sits before anyone sets a location', () => {
    expect(sunOf('auto', hassAt(NULL_ISLAND, highSun))).toBeNull();
  });

  it('hands the scene no sun when the config carries no location at all', () => {
    expect(sunOf('auto', hassAt(null, highSun))).toBeNull();
  });

  it('follows the sun at a real location, the onboarding default included', () => {
    const amsterdam = { latitude: 52.3731339, longitude: 4.8903147 };

    expect(sunOf('auto', hassAt(amsterdam, setSun))).toEqual(setSun);
    expect(lookOf('auto', hassAt(amsterdam, setSun), noon).night).toBe(true);
    expect(lookOf('auto', hassAt(amsterdam, highSun), evening).night).toBe(
      false,
    );
  });

  it('is day at local midday with no location, whatever the sun at 0, 0 says', () => {
    expect(lookOf('auto', hassAt(NULL_ISLAND, setSun, true), noon)).toEqual({
      theme: 'dark',
      night: false,
    });
    expect(lookOf('auto', hassAt(null, null), noon).night).toBe(false);
  });

  it('is night late in the local evening with no location, whatever the sun at 0, 0 says', () => {
    expect(lookOf('auto', hassAt(NULL_ISLAND, highSun), evening).night).toBe(
      true,
    );
    expect(lookOf('auto', hassAt(null, null), evening).night).toBe(true);
  });

  it('turns day at 07:00 and night at 20:00 on the local clock', () => {
    const at = (hour: number, minute: number) =>
      lookOf('auto', hassAt(null, null), new Date(2026, 8, 29, hour, minute))
        .night;

    expect(at(6, 59)).toBe(true);
    expect(at(7, 0)).toBe(false);
    expect(at(19, 59)).toBe(false);
    expect(at(20, 0)).toBe(true);
  });

  it('reads the local clock when a located Home Assistant has no sun entity', () => {
    expect(lookOf('auto', hassAt(MADRID, null), noon).night).toBe(false);
    expect(lookOf('auto', hassAt(MADRID, null), evening).night).toBe(true);
    expect(followsClock('auto', hassAt(MADRID, null))).toBe(true);
  });

  it('reads the clock only on Auto and when the sun is out of reach', () => {
    expect(followsClock('auto', hassAt(NULL_ISLAND, highSun))).toBe(true);
    expect(followsClock('auto', hassAt(MADRID, highSun))).toBe(false);
    expect(followsClock('day', hassAt(null, null))).toBe(false);
    expect(followsClock('night', hassAt(null, null))).toBe(false);
  });
});

describe('which rooms carry a temperature', () => {
  const floorOf = (slug: string): string | null =>
    ({ kitchen: 'ground', hall: 'ground', bedroom: 'first' })[slug] ?? null;

  it('labels every storey when the floors are apart', () => {
    expect(roomsInView(['kitchen', 'bedroom'], null, floorOf)).toEqual([
      'kitchen',
      'bedroom',
    ]);
  });

  it('labels only the storey in view', () => {
    expect(
      roomsInView(['kitchen', 'hall', 'bedroom'], 'ground', floorOf),
    ).toEqual(['kitchen', 'hall']);
  });

  it('labels nothing below the storey in view', () => {
    expect(roomsInView(['kitchen', 'bedroom'], 'first', floorOf)).toEqual([
      'bedroom',
    ]);
  });

  it('leaves out a room it cannot place on a storey', () => {
    expect(roomsInView(['attic'], 'ground', floorOf)).toEqual([]);
  });
});

describe('temperature pills among the marks in a room', () => {
  const room = [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
    { x: 300, y: 200 },
    { x: 0, y: 200 },
  ];
  const pill = (key: string, x: number, y: number, priority = 0) => ({
    key,
    x,
    y,
    width: 50,
    height: 22,
    priority,
    room,
  });
  const mark = (x: number, y: number) => ({ x, y, width: 32, height: 32 });

  function overlaps(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ): boolean {
    return (
      Math.abs(a.x - b.x) < (a.width + b.width) / 2 &&
      Math.abs(a.y - b.y) < (a.height + b.height) / 2
    );
  }

  const sized = (at: { x: number; y: number }) => ({
    ...at,
    width: 50,
    height: 22,
  });

  it('keeps a pill that has room where it stands', () => {
    expect(placePills([pill('study', 150, 100)], [])).toEqual([
      { key: 'study', x: 150, y: 100 },
    ]);
  });

  it('moves a pill off a light mark to the nearest free spot', () => {
    const light = mark(150, 100);
    const [placed] = placePills([pill('study', 150, 100)], [light]);

    expect(overlaps(sized(placed), light)).toBe(false);
    expect(Math.hypot(placed.x - 150, placed.y - 100)).toBeLessThan(40);
  });

  it('gives the leak pin its spot, stem and all', () => {
    const pin = { x: 150, y: 70, width: 40, height: 62 };
    const [placed] = placePills([pill('washroom', 150, 90)], [pin]);

    expect(overlaps(sized(placed), pin)).toBe(false);
  });

  it('still seats an easy pill after a room with no free spot has searched', () => {
    const crowd = Array.from({ length: 600 }, (_, index) => ({
      x: 600 + (index % 30) * 20,
      y: (Math.floor(index / 30) % 20) * 20,
      width: 24,
      height: 24,
    }));
    const packed = [
      { x: 590, y: -10 },
      { x: 1190, y: -10 },
      { x: 1190, y: 390 },
      { x: 590, y: 390 },
    ];
    const placed = placePills(
      [{ ...pill('packed', 890, 190), room: packed }, pill('study', 150, 100)],
      crowd,
    );

    expect(placed.map((label) => label.key)).toContain('study');
  });

  it('keeps a pill inside its room when it moves', () => {
    const corner = mark(40, 20);
    const [placed] = placePills([pill('hall', 30, 15)], [corner]);

    expect(overlaps(sized(placed), corner)).toBe(false);
    expect(pillInside(placed, 50, 22, room)).toBe(true);
  });

  it('moves a walled-in pill just outside its room, with a leader back in', () => {
    const closet = [
      { x: 100, y: 100 },
      { x: 160, y: 100 },
      { x: 160, y: 140 },
      { x: 100, y: 140 },
    ];
    const walls = { x: 130, y: 111, width: 64, height: 30 };
    const [placed] = placePills(
      [{ ...pill('closet', 130, 120), room: closet }],
      [walls],
    );
    const size = { width: 50, height: 22 };
    const outside = Math.hypot(
      Math.max(100 - placed.x, 0, placed.x - 160),
      Math.max(100 - placed.y, 0, placed.y - 140),
    );

    expect(placed).toMatchObject({ key: 'closet' });
    expect(overlaps({ ...placed, ...size }, walls)).toBe(false);
    expect(outside).toBeGreaterThan(0);
    expect(outside).toBeLessThanOrEqual(LEADER_REACH_PX);
    expect(placed.anchor && insidePolygon(placed.anchor, closet)).toBe(true);
  });

  it('seats a pill that fits its room before a neighbour that spills over its wall', () => {
    const corridor = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 10 },
      { x: 0, y: 10 },
    ];
    const snug = [
      { x: 0, y: 10 },
      { x: 60, y: 10 },
      { x: 60, y: 40 },
      { x: 0, y: 40 },
    ];
    const placed = placePills(
      [
        { ...pill('corridor', 30, 5), room: corridor, others: [snug] },
        { ...pill('snug', 30, 25), room: snug, others: [corridor] },
      ],
      [],
    );
    const seated = placed.find((label) => label.key === 'snug');

    expect(seated && pillInside(seated, 50, 22, snug)).toBe(true);
    expect(placed.map((label) => label.key).sort()).toEqual([
      'corridor',
      'snug',
    ]);
  });

  it('never lets one leader cross another, or a pill sit on a leader, among stacked storeys', () => {
    const rooms = [
      [162, 134, 202, 168],
      [154, 145, 195, 171],
      [173, 122, 204, 142],
      [107, 106, 132, 135],
      [154, 112, 178, 133],
      [155, 158, 197, 191],
      [176, 144, 211, 174],
      [105, 122, 138, 150],
      [141, 136, 178, 164],
    ].map(([left, top, right, bottom]) => [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ]);
    const requests = rooms.map((ring, index) => ({
      ...pill(
        `room${index}`,
        (ring[0].x + ring[2].x) / 2,
        (ring[0].y + ring[2].y) / 2,
      ),
      room: ring,
    }));
    const marks = rooms.map((ring) => ({
      x: ring[0].x + 8,
      y: ring[0].y + 8,
      width: 20,
      height: 20,
    }));
    const placed = placePills(requests, marks).filter((label) => label.anchor);
    const crosses = (
      a: { x: number; y: number },
      b: { x: number; y: number },
      c: { x: number; y: number },
      d: { x: number; y: number },
    ): boolean => {
      const side = (
        p: { x: number; y: number },
        q: { x: number; y: number },
        r: { x: number; y: number },
      ) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));

      return (
        side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
      );
    };
    const onLine = (
      box: { x: number; y: number },
      from: { x: number; y: number },
      to: { x: number; y: number },
    ): boolean =>
      Array.from({ length: 21 }, (_, step) => ({
        x: from.x + ((to.x - from.x) * step) / 20,
        y: from.y + ((to.y - from.y) * step) / 20,
      })).some(
        (dot) => Math.abs(dot.x - box.x) < 25 && Math.abs(dot.y - box.y) < 11,
      );

    expect(placed.length).toBeGreaterThan(1);

    for (const one of placed) {
      for (const other of placed) {
        if (one === other || !one.anchor || !other.anchor) continue;

        expect(crosses(one, one.anchor, other, other.anchor)).toBe(false);
        expect(onLine(other, one, one.anchor)).toBe(false);
      }
    }
  });

  it('drops a pill only when there is no free space near its room either', () => {
    const closet = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 40 },
      { x: 0, y: 40 },
    ];
    const crowd = { x: 30, y: 20, width: 400, height: 300 };

    expect(
      placePills([{ ...pill('closet', 30, 20), room: closet }], [crowd]),
    ).toEqual([]);
  });

  it('keeps a pill off furniture when a clear spot is near', () => {
    const desk = { x: 150, y: 100, width: 60, height: 30 };
    const [placed] = placePills([pill('study', 150, 100)], [], [desk]);

    expect(overlaps(sized(placed), desk)).toBe(false);
    expect(placed.anchor).toBeUndefined();
  });

  it('lets a pill sit on furniture rather than wander from its room name', () => {
    const rug = { x: 150, y: 100, width: 280, height: 180 };

    expect(placePills([pill('living', 150, 100)], [], [rug])).toEqual([
      { key: 'living', x: 150, y: 100 },
    ]);
  });

  it('moves a squeezed pill on the plan just outside its room with a line back, never across its wall', () => {
    const closet = [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 30 },
      { x: 0, y: 30 },
    ];
    const light = mark(30, 15);
    const request = {
      ...pill('closet', 30, 15),
      room: closet,
      inner: closet,
    };
    const [placed] = placePills([request], [light]);

    expect(placed).toMatchObject({ key: 'closet' });
    expect(overlapsRing(sized(placed), closet)).toBe(false);
    expect(placed.anchor && insidePolygon(placed.anchor, closet)).toBe(true);
    expect(overlaps(sized(placed), light)).toBe(false);
  });

  it('leads a pill that crosses its wall to a dot inside its room, clear of the pill and the marks', () => {
    const closet = [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 20 },
      { x: 0, y: 20 },
    ];
    const light = mark(30, 10);
    const [placed] = placePills(
      [{ ...pill('closet', 30, 10), room: closet }],
      [light],
    );
    const dot = {
      ...(placed.anchor ?? { x: NaN, y: NaN }),
      width: 4,
      height: 4,
    };

    expect(insidePolygon(dot, closet)).toBe(true);
    expect(overlaps(dot, sized(placed))).toBe(false);
    expect(overlaps(dot, light)).toBe(false);
  });

  it('moves a pill off a strip of a room it would hide, so its leader shows', () => {
    const strip = [
      { x: 0, y: 100 },
      { x: 70, y: 100 },
      { x: 70, y: 119 },
      { x: 0, y: 119 },
    ];
    const [placed] = placePills(
      [{ ...pill('wardrobe', 35, 110), width: 56, room: strip }],
      [],
    );
    const dot = {
      ...(placed.anchor ?? { x: NaN, y: NaN }),
      width: 4,
      height: 4,
    };

    expect(insidePolygon(dot, strip)).toBe(true);
    expect(overlaps(dot, { ...placed, width: 56, height: 22 })).toBe(false);
  });

  it('leads a pill out of a crowded hall without crossing the room name', () => {
    const hall = [
      { x: 222, y: 114 },
      { x: 150, y: 114 },
      { x: 150, y: 353 },
      { x: 222, y: 353 },
    ];
    const name = { x: 186, y: 148, width: 35, height: 20 };
    const crowd = [
      { x: 203, y: 233, width: 33, height: 113 },
      { x: 186, y: 217, width: 32, height: 32 },
      { x: 186, y: 353, width: 44, height: 16 },
      { x: 222, y: 144, width: 16, height: 41 },
      { x: 222, y: 323, width: 16, height: 44 },
      { x: 150, y: 147, width: 16, height: 40 },
      { x: 150, y: 278, width: 16, height: 43 },
      { x: 186, y: 349, width: 28, height: 7 },
      { x: 186, y: 342, width: 27, height: 7 },
      { x: 188, y: 335, width: 25, height: 7 },
      { x: 191, y: 328, width: 19, height: 7 },
      { x: 225, y: 144, width: 6, height: 25 },
      { x: 225, y: 323, width: 7, height: 28 },
      { x: 147, y: 147, width: 6, height: 24 },
      { x: 147, y: 278, width: 7, height: 27 },
    ];
    const bench = { x: 167, y: 233, width: 24, height: 75 };
    const [placed] = placePills(
      [{ ...pill('hall', 186, 173), width: 64.8, height: 26, room: hall }],
      [name, ...crowd],
      [bench],
    );
    const to = placed.anchor ?? { x: NaN, y: NaN };
    const crossings = Array.from({ length: 101 }, (_, step) => ({
      x: placed.x + ((to.x - placed.x) * step) / 100,
      y: placed.y + ((to.y - placed.y) * step) / 100,
    })).filter(
      (point) =>
        Math.abs(point.x - name.x) < name.width / 2 &&
        Math.abs(point.y - name.y) < name.height / 2,
    );

    expect(insidePolygon(to, hall)).toBe(true);
    expect(crossings).toEqual([]);
  });

  it('never leads a pill through a room name when a sheet pushes the hall to the top of the card', () => {
    const { pill: hall, taken, soft } = hallUnderSheet;
    const placed = placePills([hall], taken, soft);
    const name = taken[0];
    const crossings = placed.flatMap((label) => {
      const to = label.anchor ?? label;

      return Array.from({ length: 101 }, (_, step) => ({
        x: label.x + ((to.x - label.x) * step) / 100,
        y: label.y + ((to.y - label.y) * step) / 100,
      })).filter(
        (point) =>
          Math.abs(point.x - name.x) < name.width / 2 &&
          Math.abs(point.y - name.y) < name.height / 2,
      );
    });

    expect(crossings).toEqual([]);
  });

  it('hides a pill rather than lead it through anything', () => {
    const closet = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 200 },
      { x: 0, y: 200 },
    ];
    const outside = { x: 30, y: -500, width: 2000, height: 1000 };
    const filled = { x: 30, y: 120, width: 2000, height: 160 };
    const word = { x: 30, y: 20, width: 2000, height: 12 };

    expect(
      placePills(
        [{ ...pill('closet', 30, 50), room: closet }],
        [outside, filled, word],
      ),
    ).toEqual([]);
  });

  it('never centres a pill on the plan inside a neighbouring room, nor across its own wall', () => {
    const closet = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 40 },
      { x: 0, y: 40 },
    ];
    const study = [
      { x: 60, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 40 },
      { x: 60, y: 40 },
    ];
    const walls = { x: 19, y: 20, width: 50, height: 100 };
    const request = { ...pill('closet', 30, 20), room: closet, inner: closet };
    const [kept] = placePills([{ ...request, others: [study] }], [walls]);

    expect(kept).toMatchObject({ key: 'closet' });
    expect(insidePolygon(kept, study)).toBe(false);
    expect(overlapsRing(sized(kept), closet)).toBe(false);
    expect(kept.anchor && insidePolygon(kept.anchor, closet)).toBe(true);
  });

  describe('on a storey seen in 3D', () => {
    const study = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 40 },
      { x: 0, y: 40 },
    ];
    const closet = [
      { x: 200, y: 0 },
      { x: 260, y: 0 },
      { x: 260, y: 40 },
      { x: 200, y: 40 },
    ];
    const storey = [study, closet];
    const walls = { x: 240, y: 20, width: 40, height: 100 };
    const request = {
      ...pill('closet', 240, 20),
      room: closet,
      others: [study],
      storey,
    };
    const wall = 8;
    const onStorey = (at: { x: number; y: number }) =>
      [-1, 1].every((sx) =>
        [-1, 1].every((sy) =>
          storey.some((ring) =>
            insidePolygon(
              { x: at.x + sx * (25 - wall), y: at.y + sy * (11 - wall) },
              ring,
            ),
          ),
        ),
      );

    it('keeps a walled-in pill on its storey instead of out on the lawn', () => {
      const [placed] = placePills([request], [walls]);

      expect(placed).toMatchObject({ key: 'closet' });
      expect(onStorey(placed)).toBe(true);
      expect(placed.anchor && insidePolygon(placed.anchor, closet)).toBe(true);
    });

    it('keeps the pill off the wall between two rooms when a clear spot is near', () => {
      const tall = (left: number, right: number) => [
        { x: left, y: 0 },
        { x: right, y: 0 },
        { x: right, y: 80 },
        { x: left, y: 80 },
      ];
      const hall = tall(0, 200);
      const nook = tall(200, 260);
      const filled = { x: 240, y: 40, width: 40, height: 200 };
      const [placed] = placePills(
        [
          {
            ...pill('nook', 210, 40),
            room: nook,
            others: [hall],
            storey: [hall, nook],
          },
        ],
        [filled],
      );

      expect(placed).toMatchObject({ key: 'nook' });
      expect(Math.abs(placed.x - 200)).toBeGreaterThanOrEqual(25 + 6);
    });

    it('hides the pill rather than let it leave a storey with no room for it', () => {
      const covered = { x: 100, y: 20, width: 400, height: 60 };

      expect(placePills([request], [covered])).toEqual([]);
    });
  });

  it('draws no leader for a pill wholly inside its room', () => {
    const [placed] = placePills([pill('hall', 30, 15)], [mark(40, 20)]);

    expect(pillInside(placed, 50, 22, room)).toBe(true);
    expect(placed.anchor).toBeUndefined();
  });

  it('draws nothing under a card control', () => {
    const floors = { x: 40, y: 100, width: 64, height: 200 };
    const [placed] = placePills([pill('hall', 60, 100)], [floors]);

    expect(overlaps(sized(placed), floors)).toBe(false);
  });

  it('never leaves two pills on top of each other in a crowd', () => {
    const crowd = Array.from({ length: 9 }, (_, index) =>
      pill(`r${index}`, 140 + (index % 3) * 6, 90 + Math.floor(index / 3) * 5),
    );
    const placed = placePills(crowd, []);

    expect(placed).toHaveLength(9);

    for (const [index, a] of placed.entries()) {
      for (const b of placed.slice(index + 1)) {
        expect(overlaps(sized(a), sized(b))).toBe(false);
      }
    }
  });

  it('gives a room outside the band first claim on its spot', () => {
    const placed = placePills(
      [pill('calm', 150, 100), pill('cold', 150, 100, 1)],
      [],
    );

    expect(placed.find((label) => label.key === 'cold')).toEqual({
      key: 'cold',
      x: 150,
      y: 100,
    });
  });

  it('moves a pill with no room outline only a short way before hiding it', () => {
    const loose = { ...pill('loose', 150, 100), room: null };
    const wall = { x: 150, y: 100, width: 400, height: 120 };

    expect(placePills([loose], [wall])).toEqual([]);
  });

  it('hides the pill of a room seen edge on, too thin to hold its leader dot', () => {
    const sliver = [
      { x: 0, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 106 },
      { x: 0, y: 106 },
    ];

    expect(
      placePills([{ ...pill('hall', 150, 103), room: sliver }], []),
    ).toEqual([]);
  });

  it('gives up on a crowd of walled-in rooms within the 8 ms phone budget', () => {
    const rooms = Array.from({ length: 12 }, (_, index) => [
      { x: 0, y: index * 24 },
      { x: 300, y: index * 24 },
      { x: 300, y: index * 24 + 18 },
      { x: 0, y: index * 24 + 18 },
    ]);
    const pills = rooms.map((ring, index) => ({
      ...pill(`room-${index}`, 150, index * 24 + 9),
      room: ring,
      others: rooms.filter((other) => other !== ring),
    }));
    const marks = rooms.flatMap((_, index) =>
      Array.from({ length: 10 }, (_, column) =>
        mark(column * 30 + 15, index * 24 + 9),
      ),
    );
    const spent = Array.from({ length: 20 }, () => {
      const start = process.hrtime.bigint();

      placePills(pills, marks);

      return Number(process.hrtime.bigint() - start) / 1e6;
    });

    expect(Math.min(...spent)).toBeLessThan(8);
  });
});

describe('a pill every other pass left without a place', () => {
  const cramped = [
    { x: 100, y: 100 },
    { x: 160, y: 100 },
    { x: 160, y: 140 },
    { x: 100, y: 140 },
  ];
  const request = (key: string, x: number) => ({
    key,
    x,
    y: 120,
    width: 50,
    height: 22,
    priority: 0,
    room: cramped,
  });
  const glyphs = [
    { x: 115, y: 120, width: 32, height: 32 },
    { x: 145, y: 120, width: 32, height: 32 },
  ];
  const clashes = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ): boolean =>
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2;

  it('still shows, clear of every glyph, on a leader back into its room', () => {
    const [placed] = strandedPills([request('den', 130)], glyphs);
    const box = { ...placed, width: 50, height: 22 };

    expect(glyphs.some((glyph) => clashes(box, glyph))).toBe(false);
    expect(placed.anchor).toBeDefined();
    expect(insidePolygon(placed.anchor ?? placed, cramped)).toBe(true);
  });

  it('never stacks two stranded pills on each other', () => {
    const [one, two] = strandedPills(
      [request('den', 130), request('snug', 131)],
      glyphs,
    );

    expect(
      clashes(
        { ...one, width: 50, height: 22 },
        { ...two, width: 50, height: 22 },
      ),
    ).toBe(false);
  });

  it('lets its leader pass a glyph when every clear leader is blocked, never its pill', () => {
    const fence = [0, 1, 2, 3, 4, 5, 6, 7].map((turn) => ({
      x: 130 + 30 * Math.cos((turn * Math.PI) / 4),
      y: 120 + 30 * Math.sin((turn * Math.PI) / 4),
      width: 14,
      height: 14,
    }));

    expect(strandedPills([request('den', 130)], fence)).toEqual([]);

    const [placed] = strandedPills([request('den', 130)], [], fence);
    const box = { ...placed, width: 50, height: 22 };

    expect(placed.anchor).toBeDefined();
    expect(fence.some((glyph) => clashes(box, glyph))).toBe(false);
  });

  it('keeps a pill over its own storey unless told it may go anywhere', () => {
    const storey = [cramped];
    const walled = [{ x: 130, y: 120, width: 60, height: 60 }];
    const pill = { ...request('den', 130), storey };

    expect(strandedPills([pill], walled, [], false)).toEqual([]);

    const [loose] = strandedPills([pill], walled, [], true);

    expect(loose).toBeDefined();
    expect(insidePolygon(loose, cramped)).toBe(false);
  });

  const ring = (left: number, top: number, right: number, bottom: number) => [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  const onRing = (at: { x: number; y: number }, rings: (typeof cramped)[]) =>
    rings.some(
      (one) =>
        insidePolygon(at, one) ||
        one.some((corner, index) => {
          const next = one[(index + 1) % one.length];

          return (
            Math.min(corner.x, next.x) - 4 <= at.x &&
            at.x <= Math.max(corner.x, next.x) + 4 &&
            Math.min(corner.y, next.y) - 4 <= at.y &&
            at.y <= Math.max(corner.y, next.y) + 4
          );
        }),
    );

  it('never parks a pill on the lawn inside the corner of an L-shaped storey', () => {
    const wing = ring(160, 140, 300, 200);
    const storey = [cramped, wing];
    const walled = [
      { x: 130, y: 120, width: 60, height: 40 },
      { x: 230, y: 170, width: 140, height: 60 },
    ];
    const pill = { ...request('den', 130), storey, others: [wing] };
    const placed = strandedPills([pill], walled, [], false);

    expect(placed.filter((label) => !onRing(label, storey))).toEqual([]);
  });

  it('never runs its leader across a neighbouring room', () => {
    const next = ring(160, 100, 260, 140);
    const storey = [cramped, next];
    const walled = [{ x: 115, y: 120, width: 90, height: 100 }];
    const lamp = { x: 185, y: 120, width: 50, height: 80 };
    const pill = { ...request('den', 130), storey, others: [next] };
    const placed = strandedPills([pill], walled, [lamp], false);
    const crossing = placed.filter(({ x, y, anchor }) => {
      if (!anchor) return false;

      return Array.from({ length: 50 }, (_, step) => ({
        x: x + ((anchor.x - x) * step) / 50,
        y: y + ((anchor.y - y) * step) / 50,
      })).some(
        (at) =>
          Math.abs(at.x - x) >= 25 &&
          at.x > 164 &&
          at.x < 256 &&
          at.y > 104 &&
          at.y < 136,
      );
    });

    expect(crossing).toEqual([]);
  });
});

describe('two leaders that cross', () => {
  const size = () => ({ width: 40, height: 20 });
  const crossing = [
    { key: 'a', x: 0, y: 0, anchor: { x: 200, y: 100 } },
    { key: 'b', x: 200, y: 0, anchor: { x: 0, y: 100 } },
  ];

  it('swaps the two pills so the leaders no longer cross', () => {
    const [a, b] = uncrossed(crossing, size, [], new Set());

    expect(a).toMatchObject({ key: 'a', x: 200, y: 0 });
    expect(b).toMatchObject({ key: 'b', x: 0, y: 0 });
  });

  it('keeps the picked pill where it is', () => {
    const [a] = uncrossed(crossing, size, [], new Set(['a']));

    expect(a).toMatchObject({ x: 0, y: 0 });
  });

  it('keeps both pills when the swap would land one on a glyph', () => {
    const glyph = { x: 200, y: 0, width: 38, height: 38 };
    const [a] = uncrossed(crossing, size, [glyph], new Set());

    expect(a).toMatchObject({ x: 0, y: 0 });
  });
});

describe('the pills that must be found a new home', () => {
  const room = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const wing = [
    { x: 100, y: 60 },
    { x: 200, y: 60 },
    { x: 200, y: 100 },
    { x: 100, y: 100 },
  ];
  const size = { width: 40, height: 20 };
  const placeOf = () => ({ room, storey: [room], ...size });
  const winged = () => ({ room, storey: [room, wing], ...size });

  it('moves a pill that sits off its storey', () => {
    const labels = [
      { key: 'on', x: 50, y: 50, anchor: { x: 60, y: 60 } },
      { key: 'sky', x: 50, y: -40, anchor: { x: 50, y: 10 } },
    ];

    expect([...strayKeys(labels, placeOf, [], new Set())]).toEqual(['sky']);
  });

  it('moves a pill on the lawn inside the corner of an L-shaped storey', () => {
    const labels = [{ key: 'lawn', x: 150, y: 25, anchor: { x: 90, y: 30 } }];

    expect([...strayKeys(labels, winged, [], new Set())]).toEqual(['lawn']);
  });

  it('moves a pill just outside the wall of another room on its storey', () => {
    const labels = [{ key: 'edge', x: 150, y: 57, anchor: { x: 98, y: 58 } }];

    expect([...strayKeys(labels, winged, [], new Set())]).toEqual(['edge']);
  });

  it('moves a pill whose leader runs across another room', () => {
    const labels = [{ key: 'far', x: 170, y: 80, anchor: { x: 40, y: 80 } }];

    expect([...strayKeys(labels, winged, [], new Set())]).toEqual(['far']);
  });

  it('keeps a pill beside its own wall whose leader stays in its own room', () => {
    const labels = [{ key: 'near', x: 50, y: -2, anchor: { x: 50, y: 20 } }];

    expect(strayKeys(labels, winged, [], new Set()).size).toBe(0);
  });

  it('moves a pill whose leader ends under a glyph', () => {
    const lamp = { x: 70, y: 70, width: 38, height: 38 };
    const labels = [{ key: 'lamp', x: 25, y: 25, anchor: { x: 72, y: 72 } }];

    expect([...strayKeys(labels, placeOf, [lamp], new Set())]).toEqual([
      'lamp',
    ]);
  });

  it('moves a pill that lies on a door dot', () => {
    const dot = { x: 60, y: 50, width: 10, height: 10 };
    const labels = [{ key: 'door', x: 50, y: 50 }];

    expect([...strayKeys(labels, placeOf, [], new Set(), [dot])]).toEqual([
      'door',
    ]);
    expect(strayKeys(labels, placeOf, [], new Set()).size).toBe(0);
  });

  it('keeps the picked pill even off its storey', () => {
    const labels = [{ key: 'sky', x: 50, y: -40, anchor: { x: 50, y: 10 } }];

    expect(strayKeys(labels, placeOf, [], new Set(['sky'])).size).toBe(0);
  });

  it('moves one of two pills whose leaders still cross', () => {
    const labels = [
      { key: 'a', x: 10, y: 10, anchor: { x: 90, y: 90 } },
      { key: 'b', x: 90, y: 10, anchor: { x: 10, y: 90 } },
    ];

    expect([...strayKeys(labels, placeOf, [], new Set(['b']))]).toEqual(['a']);
  });
});

describe('a pill with nowhere clean to go', () => {
  const closet = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
    { x: 0, y: 40 },
  ];
  const hall = [
    { x: 40, y: 0 },
    { x: 160, y: 0 },
    { x: 160, y: 40 },
    { x: 40, y: 40 },
  ];
  const pill = {
    key: 'closet',
    x: 20,
    y: 20,
    width: 30,
    height: 14,
    priority: 0,
    room: closet,
    storey: [closet, hall],
    floors: [closet, hall],
  };
  const lamp = { x: 20, y: 20, width: 38, height: 38 };

  it('never sits over its own lamp, and reaches over one wall instead', () => {
    const {
      labels: [label],
      stuck,
    } = homedPills([pill], [], [{ x: 13, y: 20, width: 24, height: 44 }]);

    expect(insidePolygon(label, hall)).toBe(true);
    expect(label.anchor && insidePolygon(label.anchor, closet)).toBe(true);
    expect(stuck.size).toBe(0);
  });

  it('sits in its own room clear of a lamp that leaves it space', () => {
    const {
      labels: [label],
    } = homedPills([{ ...pill, room: hall, x: 100, y: 20 }], [], [lamp]);

    expect(insidePolygon(label, hall)).toBe(true);
    expect(label.anchor).toBeUndefined();
  });

  it('never starts a leader under a glyph that fills its whole room', () => {
    const cover = { x: 20, y: 20, width: 60, height: 60 };
    const { labels, stuck } = homedPills([pill], [], [cover]);

    expect(labels[0].anchor).toBeUndefined();
    expect([...stuck]).toEqual(['closet']);
  });

  it('is never left out, and says so when there is no room anywhere', () => {
    const wall = { x: 80, y: 20, width: 400, height: 400 };
    const { labels, stuck } = homedPills([pill], [wall], [lamp]);

    expect(labels).toHaveLength(1);
    expect([...stuck]).toEqual(['closet']);
  });
});

describe('a pill carried while the camera moves', () => {
  const room = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 0, y: 100 },
  ];
  const pill = {
    key: 'hall',
    x: 100,
    y: 50,
    width: 40,
    height: 16,
    priority: 0,
    room,
  };

  it('stays where it is when nothing is in its way', () => {
    expect(nudgedPills([pill], [])).toEqual([{ key: 'hall', x: 100, y: 50 }]);
  });

  it('steps off a mark it slides onto, staying in its own room', () => {
    const lamp = { x: 100, y: 50, width: 38, height: 38 };
    const [label] = nudgedPills([pill], [lamp]);

    expect(covered({ ...pill, ...label }, [lamp])).toBe(false);
    expect(insidePolygon(label, room)).toBe(true);
    expect(Math.hypot(label.x - 100, label.y - 50)).toBeLessThanOrEqual(48);
  });

  it('steps off another pill carried before it', () => {
    const [first, second] = nudgedPills([pill, { ...pill, key: 'study' }], []);

    expect(covered({ ...pill, ...second }, [{ ...pill, ...first }])).toBe(
      false,
    );
  });
});

describe('a pill search held to whole fits', () => {
  it('leaves out a pill that only fits across the walls of its room', () => {
    const closet = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 30 },
      { x: 0, y: 30 },
    ];
    const pill = {
      key: 'closet',
      x: 15,
      y: 15,
      width: 50,
      height: 22,
      priority: 0,
      room: closet,
    };

    expect(placePills([pill], [])).toHaveLength(1);
    expect(placePills([pill], [], [], false)).toEqual([]);
  });
});

describe('a mark under something that wins', () => {
  it('is covered by a pin or a control it overlaps', () => {
    const pin = { x: 100, y: 69, width: 40, height: 62 };

    expect(covered({ x: 105, y: 90, width: 32, height: 32 }, [pin])).toBe(true);
  });

  it('stands free of one it only comes near', () => {
    const pin = { x: 100, y: 69, width: 40, height: 62 };

    expect(covered({ x: 100, y: 130, width: 32, height: 32 }, [pin])).toBe(
      false,
    );
  });
});

describe('an outline just inside a floor', () => {
  it('pulls every edge of a square in by the same distance', () => {
    const square: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];

    expect(insetPolygon(square, 10)).toEqual([
      [10, 10],
      [90, 10],
      [90, 90],
      [10, 90],
    ]);
  });

  it('pulls inward whichever way the outline winds', () => {
    const square: [number, number][] = [
      [0, 0],
      [0, 100],
      [100, 100],
      [100, 0],
    ];

    expect(insetPolygon(square, 10)).toEqual([
      [10, 10],
      [10, 90],
      [90, 90],
      [90, 10],
    ]);
  });
});
