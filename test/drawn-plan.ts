import { vi } from 'vitest';

type Size = { width: number; height: number };

export function fakeContext(): CanvasRenderingContext2D {
  const store: Record<string | symbol, unknown> = {
    font: '12px sans-serif',
    measureText(this: { font: string }, text: string) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 12);

      return { width: text.length * px * 0.6 };
    },
  };

  return new Proxy(store, {
    get: (target, key) =>
      key in target
        ? target[key]
        : () => ({ addColorStop: () => undefined, width: 0 }),
    set: (target, key, value) => {
      target[key] = value;

      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

export function drawPlansAt(size: Size): void {
  const sized = (element: Element): boolean =>
    element.classList.contains('stage') ||
    element.localName === 'estanza-plan-view';

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (kind: string) => (kind === '2d' ? fakeContext() : null) as never,
  );
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(
    function (this: Element) {
      return sized(this) ? size.width : 0;
    },
  );
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(
    function (this: Element) {
      return sized(this) ? size.height : 0;
    },
  );
}
