import { tokens } from '@estanza/tokens';
import {
  css,
  html,
  nothing,
  svg,
  type SVGTemplateResult,
  type TemplateResult,
  unsafeCSS,
} from 'lit';

import type { Point } from './gesture.js';
import {
  LABEL_HEIGHT,
  type PlacedLabel,
  SMALL_LABEL_HEIGHT,
  TABLET_LABEL_HEIGHT,
  type Theme,
} from './living.js';
import { TOUCH_PX } from './mark-layout.js';

export type TemperatureLabel = PlacedLabel & {
  text: string;
  name: string | null;
  selected: boolean;
  small: boolean;
  large: boolean;
};

export type OpenPill = (label: PlacedLabel, event: MouseEvent) => void;

const navy = unsafeCSS(tokens.ramps.navy['600']);
const white = unsafeCSS(tokens.ramps.neutral['0']);
const LEADER_DOT_RADIUS_PX = 2.5;
const touchReach = unsafeCSS(`min(0px, calc((100% - ${TOUCH_PX}px) / 2))`);

export function temperaturesTemplate(
  labels: TemperatureLabel[],
  theme: Theme,
  onOpen: OpenPill | null,
  withPills = true,
): TemplateResult | typeof nothing {
  if (labels.length === 0) return nothing;

  const leaders = labels.flatMap((label) =>
    label.anchor ? [leader(label, label.anchor)] : [],
  );

  return html`<div class="temps ${theme}">
    ${
      leaders.length > 0
        ? html`<svg class="leaders" aria-hidden="true">${leaders}</svg>`
        : nothing
    }
    ${withPills ? labels.map((label) => pillTemplate(label, onOpen)) : nothing}
  </div>`;
}

export function pillTemplate(
  label: TemperatureLabel,
  onOpen: OpenPill | null,
): TemplateResult {
  const style = `left:${label.x}px;top:${label.y}px`;
  const face = html`<span class="face">${label.text}</span>`;
  const classes = [
    'temp',
    label.selected ? 'selected' : '',
    label.small ? 'small' : '',
    label.large ? 'large' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (!onOpen) {
    return html`<span
      class=${classes}
      data-room=${label.key}
      title=${label.name ?? nothing}
      style=${style}
      >${face}</span
    >`;
  }

  const name = label.name ? `${label.name} ${label.text}` : label.text;

  return html`<button
    class=${classes}
    data-room=${label.key}
    style=${style}
    aria-label=${name}
    title=${name}
    aria-haspopup="dialog"
    aria-expanded=${String(label.selected)}
    @click=${(event: MouseEvent) => onOpen(label, event)}
  >
    ${face}
  </button>`;
}

function leader(label: TemperatureLabel, to: Point): SVGTemplateResult {
  return svg`<g class=${label.selected ? 'leader selected' : 'leader'} data-room=${label.key}>
    <line class="halo" x1=${label.x} y1=${label.y} x2=${to.x} y2=${to.y}></line>
    <line x1=${label.x} y1=${label.y} x2=${to.x} y2=${to.y}></line>
    <circle cx=${to.x} cy=${to.y} r=${LEADER_DOT_RADIUS_PX}></circle>
  </g>`;
}

export const temperatureStyles = css`
  .temps {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .leaders {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    --lead: ${navy};
    --halo: ${white};
  }

  .temps.dark .leaders {
    --lead: ${white};
    --halo: ${navy};
  }

  .temp,
  .leader {
    transition: opacity 150ms ease-out;
  }

  .pills-moving :is(.temp, .leader):not(.selected) {
    pointer-events: none;
    transition: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .temp,
    .leader {
      transition: none;
    }
  }

  .leader line {
    stroke: var(--lead);
    stroke-width: 1.25;
  }

  .leader .halo {
    stroke: var(--halo);
    stroke-opacity: 0.6;
    stroke-width: 3.25;
  }

  .leader circle {
    fill: var(--lead);
    stroke: var(--halo);
    stroke-opacity: 0.6;
    stroke-width: 1;
  }

  .temp {
    position: absolute;
    translate: -50% -50%;
    display: grid;
    place-items: center;
    border: 0;
    padding: 0;
    background: none;
    font: inherit;
  }

  button.temp {
    pointer-events: auto;
    cursor: pointer;
    touch-action: none;
  }

  button.temp:focus-visible {
    outline: none;
  }

  button.temp:focus-visible .face {
    outline: 2px solid var(--ez-focus);
    outline-offset: 2px;
  }

  .temp .face {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    height: ${LABEL_HEIGHT}px;
    padding: 0 8px;
    border-radius: ${unsafeCSS(tokens.radius.pill)}px;
    background: ${navy};
    color: ${white};
    box-shadow: ${unsafeCSS(tokens.elevation.shadowFloatOnLight)};
    font-size: ${unsafeCSS(tokens.typography.roles.caption.size)}px;
    font-weight: ${unsafeCSS(tokens.typography.roles.fieldLabel.weight)};
    line-height: 1;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  :is(.temps.dark, [data-look='dark']) .temp .face {
    background: ${white};
    color: ${navy};
    box-shadow: ${unsafeCSS(tokens.themes.dark.shadowSm)};
  }

  :is(.temps, .marks) .temp.selected .face {
    box-shadow:
      0 0 0 2px var(--ez-surface),
      0 0 0 4px var(--ez-chosen),
      var(--ez-shadow-float);
  }

  :host([large-pills]) .temp .face,
  .temp.large .face {
    height: ${TABLET_LABEL_HEIGHT}px;
    padding: 0 10px;
    font-size: 15px;
  }

  .temp.small .face,
  :host([large-pills]) .temp.small .face {
    height: ${SMALL_LABEL_HEIGHT}px;
    padding: 0 6px;
    font-size: ${unsafeCSS(tokens.typography.roles.wellLabel.size)}px;
  }

  button.temp::before {
    content: '';
    position: absolute;
    inset: var(--hit-t, 0px) var(--hit-r, 0px) var(--hit-b, 0px)
      var(--hit-l, 0px);
  }

  @media (pointer: coarse) {
    button.temp::before {
      inset: var(--hit-t, ${touchReach}) var(--hit-r, ${touchReach})
        var(--hit-b, ${touchReach}) var(--hit-l, ${touchReach});
    }
  }
`;
