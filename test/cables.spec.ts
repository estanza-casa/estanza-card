import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { deriveFloors } from '@estanza/plan-engine/geometry/geometry.js';
import { describe, expect, it } from 'vitest';

import { cardType, parseCardConfig } from '../src/bindings.js';
import { cableRuns } from '../src/cables.js';
import homeFixture from './fixtures/home.json';

const wired = homeDocumentSchema.parse({
  ...homeFixture,
  additions: {
    ...homeFixture.additions,
    cableEndpoints: [
      { slug: 'rack', kind: 'rack', at: [50, 50] },
      { slug: 'ap', kind: 'ap', at: [300, 200], elevation: 250 },
    ],
    cables: [
      {
        slug: 'uplink',
        type: 'cat6',
        from: 'rack',
        to: 'ap',
        points: [
          [0, 0, 0],
          [300, 50, 0],
          [0, 0, 0],
        ],
      },
      {
        slug: 'mains',
        type: 'power',
        color: '#123456',
        points: [
          [10, 10, 0],
          [20, 10, 0],
        ],
      },
    ],
  },
});
const floors = deriveFloors(wired);

describe('cable runs', () => {
  it('keeps cables in a home loaded from the card config', () => {
    const config = parseCardConfig({ type: cardType, home_document: wired });

    expect(config.home_document?.additions.cables).toHaveLength(2);
    expect(config.home_document?.additions.cableEndpoints).toHaveLength(2);
  });

  it('pins each end tied to an endpoint to that endpoint', () => {
    const [uplink] = cableRuns(wired, floors, null).runs;

    expect(uplink.points[0]).toEqual([50, 50, 0]);
    expect(uplink.points.at(-1)).toEqual([300, 200, 250]);
    expect(uplink.points[1]).toEqual([300, 50, 0]);
  });

  it('colours a run by its type unless it names its own colour', () => {
    const runs = cableRuns(wired, floors, null).runs;

    expect(runs.map((run) => run.color)).toEqual(['#3f8efc', '#123456']);
  });

  it('draws only the runs and endpoints on the floor in view', () => {
    expect(cableRuns(wired, floors, floors[0].id).ends).toHaveLength(2);
    expect(cableRuns(wired, floors, 'no-such-floor')).toEqual({
      runs: [],
      ends: [],
    });
  });

  it('reads the cables option as off unless it is set', () => {
    expect(parseCardConfig({ type: cardType }).show_cables).toBeUndefined();
    expect(
      parseCardConfig({ type: cardType, show_cables: true }).show_cables,
    ).toBe(true);
    expect(() =>
      parseCardConfig({ type: cardType, show_cables: 'yes' }),
    ).toThrow(/show_cables/);
  });
});
