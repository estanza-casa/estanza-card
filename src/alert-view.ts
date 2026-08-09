import { tokens } from '@estanza/tokens';
import { css, html, nothing, type TemplateResult, unsafeCSS } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import {
  alertIcons,
  type AlertKind,
  type AlertSeverity,
  type ArmedAlarm,
} from './alerts.js';
import { CONTROL_GAP_PX } from './floor-view.js';
import type { Point } from './gesture.js';
import { icon } from './icons.js';
import { covered, type MarkBox } from './living.js';

export type PinView = {
  key: string;
  kind: AlertKind;
  name: string;
  severity: AlertSeverity;
  at: Point | null;
  low: boolean;
  leaving: boolean;
};

export type BannerView = {
  kind: AlertKind;
  name: string;
  state: string;
  ago: string;
  more: number;
  next: () => void;
};

export const PIN_FADE_MS = 300;
export const PIN_HEAD_PX = 40;
export const NOTICE_HEAD_PX = 32;
export const PIN_STEM_PX = 22;
export const PIN_FOOT_CLEAR_PX = 8;

const PIN_ASIDE_STEP_PX = 4;
const PIN_ASIDE_REACH_PX = 80;

const BANNER_ROOM_PX = 32;
const COUNT_PX = tokens.control.iconSm.height.base;
const COUNT_EDGE_PX = (tokens.layout.minHitTarget - COUNT_PX) / 2;

export function pinBox(
  at: Point,
  severity: AlertSeverity,
  low: boolean,
): MarkBox {
  const head = severity === 'critical' ? PIN_HEAD_PX : NOTICE_HEAD_PX;
  const height = head + PIN_STEM_PX + PIN_FOOT_CLEAR_PX;
  const middle = height / 2 - PIN_FOOT_CLEAR_PX;

  return {
    x: at.x,
    y: low ? at.y + middle : at.y - middle,
    width: head,
    height,
  };
}

export function besideGlyphs(
  at: Point,
  severity: AlertSeverity,
  glyphs: readonly MarkBox[],
): Point {
  const steps = Array.from(
    { length: PIN_ASIDE_REACH_PX / PIN_ASIDE_STEP_PX + 1 },
    (_, step) => step * PIN_ASIDE_STEP_PX,
  );
  const spots = steps.flatMap((step) =>
    step === 0 ? [at] : [at.x + step, at.x - step].map((x) => ({ ...at, x })),
  );

  return (
    spots.find((spot) => !covered(pinBox(spot, severity, false), glyphs)) ?? at
  );
}

export function pinsTemplate(
  pins: PinView[],
  onTap: (key: string) => void,
): TemplateResult {
  return html`<div class="pins">
    ${repeat(
      pins,
      (pin) => pin.key,
      (pin) => pinTemplate(pin, onTap),
    )}
  </div>`;
}

function pinTemplate(
  pin: PinView,
  onTap: (key: string) => void,
): TemplateResult {
  const classes = [
    'pin',
    pin.severity,
    pin.low ? 'low' : '',
    pin.leaving ? 'leaving' : '',
    pin.at ? '' : 'unplaced',
  ]
    .filter(Boolean)
    .join(' ');

  return html`<div
    class=${classes}
    data-alert=${pin.key}
    style=${pin.at ? `left:${pin.at.x}px;top:${pin.at.y}px` : ''}
  >
    <button
      class="pin-head"
      aria-label=${pin.name}
      title=${pin.name}
      tabindex="-1"
      @click=${() => onTap(pin.key)}
    >
      ${icon(alertIcons[pin.kind], pin.severity === 'critical' ? 22 : 18)}
    </button>
    <span class="pin-stem" aria-hidden="true"></span>
  </div>`;
}

export function bannerTemplate(banner: BannerView): TemplateResult {
  return html`<div
    class="banner"
    role="alert"
    @click=${banner.more > 0 ? banner.next : null}
  >
    ${icon(alertIcons[banner.kind], 20)}
    <span class="banner-text"
      ><span class="banner-kind">${banner.name}</span
      ><span class="banner-rest"
        ><span class="banner-state"> · ${banner.state}</span
        ><span class="banner-ago"> · ${banner.ago}</span></span
      ></span
    >
    ${
      banner.more > 0
        ? html`<button
            class="banner-count"
            aria-label="Next alert"
            title="Next alert"
          >
            +${banner.more}
          </button>`
        : nothing
    }
  </div>`;
}

export function armedTemplate(
  alarm: ArmedAlarm,
  open: () => void,
): TemplateResult {
  const label = alarm.away ? 'Alarm armed away' : 'Alarm armed home';

  return html`<div class="status">
    <button
      class="fb"
      data-alarm=${alarm.entityId}
      aria-label=${label}
      title=${label}
      @click=${open}
    >
      ${icon(alarm.away ? 'shield-lock' : 'shield-home', 20)}
    </button>
  </div>`;
}

export const alertStyles = css`
  .pins {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    overflow: hidden;
  }

  .pin {
    position: absolute;
    display: grid;
    justify-items: center;
    translate: -50% -100%;
  }

  .pin.low {
    translate: -50% 0;
  }

  .pin.low .pin-head {
    order: 1;
  }

  .pin.unplaced {
    visibility: hidden;
  }

  .pin.leaving {
    animation: ez-fade 0.3s ease-out forwards;
  }

  .pin-head {
    position: relative;
    width: ${PIN_HEAD_PX}px;
    height: ${PIN_HEAD_PX}px;
    padding: 0;
    border: 0;
    border-radius: ${unsafeCSS(tokens.radius.pill)}px;
    display: grid;
    place-items: center;
    box-shadow: var(--ez-shadow-float);
    font: inherit;
    cursor: pointer;
    pointer-events: auto;
  }

  .pin.leaving .pin-head,
  .pin.unplaced .pin-head {
    pointer-events: none;
  }

  .pin.critical .pin-head {
    background: var(--ez-danger-fill);
    color: var(--ez-on-danger);
    animation: ez-drop 0.25s ease-out 1;
  }

  .pin.critical .pin-head::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: ${unsafeCSS(tokens.radius.pill)}px;
    border: 2px solid var(--ez-danger-fill);
    opacity: 0;
    animation: ez-rings 1s ease-out 3;
  }

  .pin.notice .pin-head {
    width: ${NOTICE_HEAD_PX}px;
    height: ${NOTICE_HEAD_PX}px;
    background: var(--ez-accent);
    color: var(--ez-on-accent);
  }

  .pin-stem {
    width: 2px;
    height: ${PIN_STEM_PX}px;
    background: var(--ez-text);
    opacity: 0.7;
  }

  .pin.critical .pin-stem {
    background: var(--ez-danger-fill);
    opacity: 1;
  }

  .banner {
    position: absolute;
    left: 112px;
    right: 12px;
    top: 12px;
    z-index: 4;
    min-height: 44px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 6px 6px 14px;
    border-radius: ${unsafeCSS(tokens.radius.md)}px;
    background: var(--ez-danger-fill);
    color: var(--ez-on-danger);
    font-size: 14px;
    font-weight: 650;
    box-shadow: var(--ez-shadow-float);
    animation: ez-slide 0.3s ease-out 1;
  }

  .banner .icon {
    flex: none;
  }

  .banner-text {
    flex: 1;
    min-width: 0;
    display: flex;
    line-height: 1.3;
    white-space: nowrap;
  }

  .banner-kind {
    flex: none;
  }

  .banner-rest {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    height: 1.3em;
    overflow: hidden;
  }

  .banner-state {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
  }

  .banner-ago {
    flex: none;
    white-space: pre;
  }

  .banner-count {
    flex: none;
    min-width: 44px;
    height: ${COUNT_PX}px;
    margin-block: -${(COUNT_PX - BANNER_ROOM_PX) / 2}px;
    border: 0;
    border-radius: ${unsafeCSS(tokens.radius.sm)}px;
    display: grid;
    place-items: center;
    padding: 0 8px;
    background: rgba(28, 19, 11, 0.12);
    color: inherit;
    font: inherit;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }

  .status {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 3;
    display: flex;
    padding: ${unsafeCSS(CONTROL_GAP_PX)}px;
    border-radius: ${unsafeCSS(tokens.radius.sm)}px;
    background: var(--ez-bar);
    border: 1px solid var(--ez-border);
    box-shadow: var(--ez-shadow-float);
    backdrop-filter: blur(16px) saturate(160%);
    -webkit-backdrop-filter: blur(16px) saturate(160%);
  }

  .stage.armed .banner {
    right: 64px;
  }

  :host([tablet]) .banner {
    left: 116px;
    top: 16px;
    font-size: 16px;
    translate: var(--ez-drift-x, 0px) var(--ez-drift-y, 0px);
    transition: translate 3s ease-in-out;
  }

  :host([tablet][portrait]) .banner {
    left: 16px;
  }

  :host([tablet]) .banner .icon {
    width: 24px;
    height: 24px;
  }

  :host([tablet]) .status {
    top: 16px;
    right: 16px;
    translate: var(--ez-drift-x, 0px) var(--ez-drift-y, 0px);
    transition: translate 3s ease-in-out;
  }

  :host([tablet]) .stage.armed .banner {
    right: 68px;
  }

  @keyframes ez-drop {
    from {
      transform: translateY(-14px);
      opacity: 0;
    }
  }

  @keyframes ez-rings {
    0% {
      transform: scale(1);
      opacity: 0.9;
    }
    100% {
      transform: scale(2.1);
      opacity: 0;
    }
  }

  @keyframes ez-slide {
    from {
      transform: translateY(-8px);
      opacity: 0;
    }
  }

  @media (pointer: coarse) {
    .banner-count {
      height: ${tokens.layout.minHitTarget}px;
      margin-block: -${(tokens.layout.minHitTarget - BANNER_ROOM_PX) / 2}px;
      border-block: ${COUNT_EDGE_PX}px solid transparent;
      border-radius: ${unsafeCSS(tokens.radius.sm)}px /
        ${unsafeCSS(tokens.radius.sm + COUNT_EDGE_PX)}px;
      background-clip: padding-box;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pin.critical .pin-head,
    .pin.critical .pin-head::after,
    .banner {
      animation: none;
    }

    .pin.leaving {
      animation: none;
      opacity: 0;
    }

    :host([tablet]) .banner,
    :host([tablet]) .status {
      transition: none;
    }
  }
`;
