import { planPalette } from '@estanza/plan2d';
import { tokens } from '@estanza/tokens';
import {
  css,
  type CSSResult,
  html,
  nothing,
  type TemplateResult,
  unsafeCSS,
} from 'lit';

import type { FloorChoice, Storey } from './floors.js';
import { icon } from './icons.js';
import type { Theme } from './living.js';

export const DANGER_DOT = 'var(--ez-danger-fill)';
export const NOTICE_DOT = 'var(--ez-text-muted)';
export const CONTROL_ICON_PX = tokens.icons.sizes[1];
export const CONTROL_GAP_PX = tokens.spacing[0];

const FINE_PX = tokens.control.iconSm.height.base;
const COARSE_PX = tokens.control.sm.height.base;
const HIT_GROW_PX = (tokens.layout.minHitTarget - COARSE_PX) / 2;
const RING_GROW_PX = (tokens.layout.minHitTarget - FINE_PX) / 2;
const CURRENT_RING_PX = 2;

export type FloorStackView = {
  storeys: Storey[];
  chosen: FloorChoice;
  dots: Map<string, string>;
  choose: (choice: FloorChoice) => void;
  collapsed: boolean;
  toggle: (() => void) | null;
  page?: string | null;
};

export function floorStackTemplate(view: FloorStackView): TemplateResult {
  if (view.collapsed && view.toggle) return floorChip(view, view.toggle);

  const all = html`<button
    class="fb"
    data-floor="all"
    aria-label="All floors"
    title="All floors"
    aria-pressed=${String(view.chosen === null)}
    @click=${() => view.choose(null)}
  >
    ${icon('layers', CONTROL_ICON_PX)}
  </button>`;

  return html`<div class="floors" role="group" aria-label="Floors">
    ${all} ${view.storeys.map((storey) => storeyButton(view, storey))}
  </div>`;
}

export type FloorPagesView = {
  storeys: Storey[];
  shown: string | null;
  turn: (storey: string) => void;
};

export function floorPagesTemplate(view: FloorPagesView): TemplateResult {
  return html`<div class="pages" role="group" aria-label="Storey shown">
    ${view.storeys.map(
      (storey) =>
        html`<button
          class="fb"
          data-page=${storey.id}
          aria-label=${storey.name}
          title=${storey.name}
          aria-pressed=${String(view.shown === storey.id)}
          @click=${() => view.turn(storey.id)}
        >
          <span class="label">${storey.label}</span>
        </button>`,
    )}
  </div>`;
}

function floorChip(view: FloorStackView, toggle: () => void): TemplateResult {
  const storey = view.storeys.find((shown) => shown.id === view.chosen);
  const name = storey ? storey.name : 'All floors';
  const dot = mostUrgentDot(view);

  return html`<div class="floors" role="group" aria-label="Floors">
    <button
      class="fb"
      data-floor="chip"
      aria-label=${`${name}, choose a floor`}
      title=${name}
      aria-expanded="false"
      aria-haspopup="true"
      @click=${toggle}
    >
      ${
        storey
          ? html`<span class="label">${storey.label}</span>`
          : icon('layers', CONTROL_ICON_PX)
      }${
        dot
          ? html`<span class="dot" style="background:${dot}"></span>`
          : nothing
      }
    </button>
  </div>`;
}

function mostUrgentDot(view: FloorStackView): string | undefined {
  const inView = view.chosen === null ? undefined : view.dots.get(view.chosen);
  const dots = [...(inView ? [inView] : []), ...view.dots.values()];

  if (dots.includes(DANGER_DOT)) return DANGER_DOT;

  return dots.find((dot) => dot !== NOTICE_DOT) ?? dots[0];
}

export function floorDotRing(theme: Theme): string {
  return theme === 'light'
    ? planPalette('light').ink
    : tokens.themes.dark.surface;
}

function storeyButton(view: FloorStackView, storey: Storey): TemplateResult {
  const dot = view.dots.get(storey.id);

  return html`<button
    class="fb"
    data-floor=${storey.id}
    aria-label=${storey.name}
    title=${storey.name}
    aria-pressed=${String(view.chosen === storey.id)}
    aria-current=${view.page === storey.id ? 'page' : nothing}
    @click=${() => view.choose(storey.id)}
  >
    <span class="label">${storey.label}</span>${
      dot ? html`<span class="dot" style="background:${dot}"></span>` : nothing
    }
  </button>`;
}

function touchButton(scope: string): CSSResult {
  const host = unsafeCSS(scope);

  return css`
    ${host} .fb {
      width: ${unsafeCSS(tokens.layout.minHitTarget)}px;
      height: ${unsafeCSS(tokens.layout.minHitTarget)}px;
      padding: ${unsafeCSS(HIT_GROW_PX)}px;
      margin: -${unsafeCSS(HIT_GROW_PX)}px;
      border-radius: ${unsafeCSS(tokens.radius.sm + HIT_GROW_PX)}px;
    }

    ${host} .fb::after {
      display: none;
    }

    ${host} .fb[aria-current='page'] {
      outline-offset: -${unsafeCSS(HIT_GROW_PX + CURRENT_RING_PX)}px;
    }

    ${host} .fb .dot {
      right: ${unsafeCSS(3 + HIT_GROW_PX)}px;
      top: ${unsafeCSS(3 + HIT_GROW_PX)}px;
    }
  `;
}

export const floorStyles = css`
  [data-look='light'] {
    --ez-floor-dot-ring: ${unsafeCSS(floorDotRing('light'))};
  }

  [data-look='dark'] {
    --ez-floor-dot-ring: ${unsafeCSS(floorDotRing('dark'))};
  }

  .floors,
  .pages {
    display: flex;
    flex-direction: column;
    gap: ${unsafeCSS(CONTROL_GAP_PX)}px;
    padding: ${unsafeCSS(CONTROL_GAP_PX)}px;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
    border-radius: ${unsafeCSS(tokens.radius.sm)}px;
    background: var(--ez-bar);
    border: 1px solid var(--ez-border);
    box-shadow: var(--ez-shadow-float);
    backdrop-filter: blur(16px) saturate(160%);
    -webkit-backdrop-filter: blur(16px) saturate(160%);
  }

  .pages {
    flex-direction: row;
  }

  .fb {
    position: relative;
    flex: none;
    width: ${unsafeCSS(FINE_PX)}px;
    height: ${unsafeCSS(FINE_PX)}px;
    border: 0;
    border-radius: ${unsafeCSS(tokens.radius.xs)}px;
    padding: 0;
    display: grid;
    place-items: center;
    background: transparent;
    background-clip: content-box;
    color: var(--ez-text);
    font: inherit;
    font-size: ${unsafeCSS(tokens.typography.roles.caption.size)}px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }

  .fb::after {
    content: '';
    position: absolute;
    inset: -${unsafeCSS(RING_GROW_PX)}px;
  }

  .floors > .fb + .fb::after {
    top: -${unsafeCSS(CONTROL_GAP_PX / 2)}px;
  }

  .floors > .fb:has(+ .fb)::after {
    bottom: -${unsafeCSS(CONTROL_GAP_PX / 2)}px;
  }

  :is(.views, .pages) > .fb + .fb::after {
    left: -${unsafeCSS(CONTROL_GAP_PX / 2)}px;
  }

  :is(.views, .pages) > .fb:has(+ .fb)::after {
    right: -${unsafeCSS(CONTROL_GAP_PX / 2)}px;
  }

  .fb:hover {
    background-color: var(--ez-surface2);
  }

  .fb:active {
    background-color: var(--ez-surface3);
  }

  .fb[aria-pressed='true'],
  .fb[data-floor='chip'] {
    background-color: var(--ez-chosen);
    color: var(--ez-on-chosen);
  }

  .fb[aria-pressed='true']:hover {
    background-color: var(--ez-chosen-hover);
  }

  .fb[aria-pressed='true']:active {
    background-color: var(--ez-chosen-press);
  }

  .fb[aria-current='page'] {
    background-color: var(--ez-surface2);
    outline: ${unsafeCSS(CURRENT_RING_PX)}px solid var(--ez-chosen);
    outline-offset: -${unsafeCSS(CURRENT_RING_PX)}px;
  }

  .fb .label {
    line-height: 1;
  }

  .fb .dot {
    position: absolute;
    right: 3px;
    top: 3px;
    width: 10px;
    height: 10px;
    border-radius: ${unsafeCSS(tokens.radius.pill)}px;
    box-shadow: 0 0 0 1.5px var(--ez-floor-dot-ring);
  }

  @media (pointer: coarse) {
    ${touchButton('')}
  }

  ${touchButton(':host([tablet])')}
`;
