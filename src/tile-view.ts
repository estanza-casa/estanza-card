import { tokens } from '@estanza/tokens';
import { css, html, nothing, type TemplateResult, unsafeCSS } from 'lit';

import { alertIcons, type AlertKind, type AlertSeverity } from './alerts.js';
import type { Rect } from './camera-rig.js';
import { icon } from './icons.js';
import { lightsWord } from './tile.js';

const STOREY_LEFT_PX = 8;
const STOREY_TOP_PX = 6;
const STOREY_WIDTH_PX = 28;
const STOREY_GAP_PX = 4;

export const tileStoreyClear: Rect[] = [
  {
    left: 0,
    top: 0,
    right: STOREY_LEFT_PX + STOREY_WIDTH_PX + STOREY_GAP_PX,
    bottom:
      STOREY_TOP_PX + tokens.typography.roles.caption.size + STOREY_GAP_PX,
  },
];

export type TileAlert = {
  kind: AlertKind;
  severity: AlertSeverity;
  words: string;
};

export type TileStatus = {
  lights: number;
  alert: TileAlert | null;
};

export type HouseDialog = {
  house: HTMLElement;
  title: string;
  close: () => void;
};

export function tileStatusTemplate(status: TileStatus): TemplateResult {
  const lights = lightsWord(status.lights);
  const alert = status.alert;

  return html`<div class="tile-status">
    ${
      status.lights > 0
        ? html`<span
            class="tile-lights"
            role="img"
            aria-label=${lights}
            title=${lights}
            >${icon('lightbulb', 16)}<span class="tile-count"
              >${status.lights}</span
            ></span
          >`
        : nothing
    }
    ${
      alert
        ? html`<span
            class="tile-alert ${alert.severity}"
            role="img"
            aria-label=${alert.words}
            title=${alert.words}
            >${icon(alertIcons[alert.kind], 14)}</span
          >`
        : nothing
    }
  </div>`;
}

export function houseTemplate(dialog: HouseDialog): TemplateResult {
  return html`<dialog
    class="house"
    aria-labelledby="house-title"
    @close=${dialog.close}
    @click=${(event: Event) => {
      if (event.target === event.currentTarget) dialog.close();
    }}
  >
    <div class="house-head">
      <h2 class="house-title" id="house-title">${dialog.title}</h2>
      <button
        class="close"
        aria-label="Close"
        title="Close"
        @click=${dialog.close}
      >
        ${icon('x', 20)}
      </button>
    </div>
    <div class="house-body">${dialog.house}</div>
  </dialog>`;
}

export const tileStyles = css`
  ha-card.tile {
    flex-direction: row;
    position: relative;
    background: var(--ez-tile-page);
    cursor: pointer;
    outline: none;
  }

  ha-card.tile:focus-visible {
    box-shadow: inset 0 0 0 2px var(--ez-chosen);
  }

  .tile estanza-scene-view {
    position: absolute;
    inset: 0;
    height: auto;
    min-height: 0;
    pointer-events: none;
  }

  .tile-plans {
    display: flex;
    flex: 1;
    min-width: 0;
  }

  .tile-floor {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  .tile-floor + .tile-floor {
    border-left: 1px solid var(--ez-border);
  }

  .tile-storey {
    position: absolute;
    left: ${STOREY_LEFT_PX}px;
    top: ${STOREY_TOP_PX}px;
    z-index: 1;
    font-size: ${unsafeCSS(tokens.typography.roles.caption.size)}px;
    font-weight: 700;
    line-height: 1;
    color: var(--ez-text-meta);
    pointer-events: none;
  }

  .tile estanza-plan-view {
    animation: none;
  }

  .tile-status {
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    width: 40px;
    padding: 10px 0;
    color: var(--ez-text);
  }

  .tile-lights {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    color: var(--ez-text);
  }

  .tile-count {
    font-size: 13px;
    font-weight: 650;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .tile-alert {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: ${unsafeCSS(tokens.radius.pill)}px;
    background: var(--ez-chosen);
    color: var(--ez-on-chosen);
  }

  .tile-alert.critical {
    background: var(--ez-danger-fill);
    color: var(--ez-on-danger);
  }

  dialog.house {
    box-sizing: border-box;
    width: min(760px, calc(100vw - 24px));
    height: min(640px, calc(100dvh - 24px));
    max-width: none;
    max-height: none;
    padding: 0;
    border: 1px solid var(--divider-color, var(--ez-border));
    border-radius: var(
      --ha-dialog-border-radius,
      ${unsafeCSS(tokens.radius.xl)}px
    );
    background: var(
      --ha-dialog-surface-background,
      var(--card-background-color, var(--ez-surface))
    );
    color: var(--primary-text-color, var(--ez-text));
    box-shadow: var(--ez-shadow-lg);
    overflow: hidden;
  }

  dialog.house[open] {
    display: flex;
    flex-direction: column;
  }

  dialog.house::backdrop {
    background: rgba(11, 24, 57, 0.5);
  }

  .house-head {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 16px;
    border-bottom: 1px solid var(--divider-color, var(--ez-border));
  }

  .house-title {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: 16px;
    font-weight: 650;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .house-body {
    flex: 1;
    min-height: 0;
    --ha-card-border-radius: 0;
    --ha-card-border-width: 0;
    --ha-card-box-shadow: none;
  }

  .house-body > estanza-card {
    display: block;
    height: 100%;
  }

  dialog.house .close {
    display: grid;
    flex: none;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: ${unsafeCSS(tokens.radius.md)}px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  dialog.house .close:hover {
    background: color-mix(in srgb, currentColor 10%, transparent);
  }

  dialog.house .close:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }
`;
