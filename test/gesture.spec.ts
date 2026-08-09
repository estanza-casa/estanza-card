import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DRAG_THRESHOLD_PX,
  GestureTracker,
  LONG_PRESS_MS,
  pickTarget,
} from '../src/gesture.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('gesture tracking', () => {
  it('reads a short still touch as a tap', () => {
    const tracker = new GestureTracker(() => undefined);

    tracker.down({ x: 10, y: 10 });

    expect(tracker.up({ x: 10, y: 10 })).toBe('tap');
  });

  it('keeps a tap that wobbles less than the drag threshold', () => {
    const tracker = new GestureTracker(() => undefined);

    tracker.down({ x: 10, y: 10 });
    tracker.move({ x: 10 + DRAG_THRESHOLD_PX - 1, y: 10 });

    expect(tracker.up({ x: 10 + DRAG_THRESHOLD_PX - 1, y: 10 })).toBe('tap');
  });

  it('reads a movement past eight pixels as an orbit, never a tap', () => {
    const tracker = new GestureTracker(() => undefined);

    tracker.down({ x: 10, y: 10 });
    tracker.move({ x: 16, y: 16 });

    expect(tracker.up({ x: 10, y: 10 })).toBe('drag');
  });

  it('counts a drag that comes back to where it started as a drag', () => {
    const tracker = new GestureTracker(() => undefined);

    tracker.down({ x: 10, y: 10 });
    tracker.move({ x: 40, y: 10 });
    tracker.move({ x: 10, y: 10 });

    expect(tracker.up({ x: 10, y: 10 })).toBe('drag');
  });

  it('fires a long press after 450ms held still', () => {
    const onPress = vi.fn();
    const tracker = new GestureTracker(onPress);

    tracker.down({ x: 10, y: 10 });
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);

    expect(onPress).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(onPress).toHaveBeenCalledWith({ x: 10, y: 10 });
    expect(tracker.up({ x: 10, y: 10 })).toBe('press');
  });

  it('never fires a long press once the pointer has dragged', () => {
    const onPress = vi.fn();
    const tracker = new GestureTracker(onPress);

    tracker.down({ x: 10, y: 10 });
    tracker.move({ x: 30, y: 10 });
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);

    expect(onPress).not.toHaveBeenCalled();
  });

  it('treats a second finger as a pinch, not a tap', () => {
    const tracker = new GestureTracker(() => undefined);

    tracker.down({ x: 10, y: 10 });
    tracker.down({ x: 80, y: 80 });

    expect(tracker.up({ x: 10, y: 10 })).toBe('drag');
  });

  it('forgets a cancelled gesture', () => {
    const onPress = vi.fn();
    const tracker = new GestureTracker(onPress);

    tracker.down({ x: 10, y: 10 });
    tracker.cancel();
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(onPress).not.toHaveBeenCalled();
    expect(tracker.up({ x: 10, y: 10 })).toBeNull();
  });
});

describe('target picking', () => {
  const anchors = [
    { key: 'light:lamp', x: 100, y: 100 },
    { key: 'light:strip', x: 130, y: 100 },
  ];

  it('answers a tap within 22px of an object on screen', () => {
    expect(pickTarget({ x: 100, y: 121 }, anchors)).toBe('light:lamp');
  });

  it('lets the nearest object win where targets overlap', () => {
    expect(pickTarget({ x: 118, y: 100 }, anchors)).toBe('light:strip');
  });

  it('answers nothing further than 22px away', () => {
    expect(pickTarget({ x: 100, y: 123 }, anchors)).toBeNull();
  });
});
