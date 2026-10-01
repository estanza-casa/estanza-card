export const DRAG_THRESHOLD_PX = 8;
export const LONG_PRESS_MS = 450;
export const TARGET_RADIUS_PX = 22;

const SECONDARY_BUTTON = 2;

export type Point = { x: number; y: number };

export type Gesture = 'tap' | 'press' | 'drag';

export type ScreenAnchor = Point & { key: string };

export class GestureTracker {
  private start: Point | null = null;

  private dragged = false;

  private pressed = false;

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly onPress: (at: Point) => void) {}

  down(at: Point): void {
    if (this.start) {
      this.dragged = true;
      this.clearTimer();

      return;
    }

    this.start = at;
    this.dragged = false;
    this.pressed = false;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pressed = true;
      this.onPress(at);
    }, LONG_PRESS_MS);
  }

  move(at: Point): void {
    const start = this.start;

    if (!start || this.dragged) return;
    if (Math.hypot(at.x - start.x, at.y - start.y) <= DRAG_THRESHOLD_PX) return;

    this.dragged = true;
    this.clearTimer();
  }

  up(at: Point): Gesture | null {
    if (!this.start) return null;

    this.move(at);
    this.clearTimer();

    const gesture = this.dragged ? 'drag' : this.pressed ? 'press' : 'tap';

    this.start = null;

    return gesture;
  }

  cancel(): void {
    this.clearTimer();
    this.start = null;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export function isSecondaryPress(event: MouseEvent): boolean {
  return event.button === SECONDARY_BUTTON;
}

export function pickTarget(
  at: Point,
  anchors: readonly ScreenAnchor[],
  radius = TARGET_RADIUS_PX,
): string | null {
  let best: string | null = null;
  let bestDistance = radius;

  for (const anchor of anchors) {
    const distance = Math.hypot(anchor.x - at.x, anchor.y - at.y);

    if (distance <= bestDistance) {
      best = anchor.key;
      bestDistance = distance;
    }
  }

  return best;
}
