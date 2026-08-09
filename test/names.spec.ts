import { describe, expect, it } from 'vitest';

import { numberRepeats, openingRowName } from '../src/names.js';

describe('the name of an opening seen from a room', () => {
  it('names a door after the room on the other side', () => {
    expect(openingRowName('door', 'Hall', 'Kitchen')).toBe('Door to Hall');
  });

  it('names a door on an outside wall', () => {
    expect(openingRowName('door', null, 'Kitchen')).toBe('Door to outside');
  });

  it('names a window after the room it lights', () => {
    expect(openingRowName('window', null, 'Kitchen')).toBe('Kitchen window');
    expect(openingRowName('window', 'Hall', 'Living Room')).toBe(
      'Living Room window',
    );
  });
});

describe('rows of one sheet that share a name', () => {
  it('numbers them in the order they come and leaves a unique name bare', () => {
    const rows = [
      'Hall window',
      'Door to Hall',
      'Hall window',
      'Hall window',
    ].map((name, at) => ({ name, at }));

    expect(numberRepeats(rows)).toEqual([
      { name: 'Hall window 1', at: 0 },
      { name: 'Door to Hall', at: 1 },
      { name: 'Hall window 2', at: 2 },
      { name: 'Hall window 3', at: 3 },
    ]);
  });
});
