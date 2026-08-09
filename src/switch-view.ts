import { tokens } from '@estanza/tokens';
import { css, html, type TemplateResult, unsafeCSS } from 'lit';

import type { View } from './bindings.js';
import { CONTROL_GAP_PX } from './floor-view.js';

export type ViewSwitchView = {
  chosen: View;
  choose: (view: View) => void;
};

const choices: { view: View; glyph: string; label: string }[] = [
  { view: '2d', glyph: '2D', label: '2D floor plan' },
  { view: '3d', glyph: '3D', label: '3D view' },
];

export function viewSwitchTemplate(view: ViewSwitchView): TemplateResult {
  return html`<div class="views" role="group" aria-label="View">
    ${choices.map(
      (choice) =>
        html`<button
          class="fb"
          data-view=${choice.view}
          aria-label=${choice.label}
          title=${choice.label}
          aria-pressed=${String(view.chosen === choice.view)}
          @click=${() => view.choose(choice.view)}
        >
          <span class="label">${choice.glyph}</span>
        </button>`,
    )}
  </div>`;
}

export const switchStyles = css`
  .dock {
    position: absolute;
    left: 12px;
    top: 12px;
    z-index: 3;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    max-height: calc(100% - 24px);
    pointer-events: none;
  }

  .dock > * {
    pointer-events: auto;
  }

  .stage.sheet-up .dock {
    max-height: calc(100% - 24px - var(--ez-sheet-rise, 0px));
  }

  .views {
    flex: none;
    display: flex;
    gap: ${unsafeCSS(CONTROL_GAP_PX)}px;
    padding: ${unsafeCSS(CONTROL_GAP_PX)}px;
    border-radius: ${unsafeCSS(tokens.radius.sm)}px;
    background: var(--ez-bar);
    border: 1px solid var(--ez-border);
    box-shadow: var(--ez-shadow-float);
    backdrop-filter: blur(16px) saturate(160%);
    -webkit-backdrop-filter: blur(16px) saturate(160%);
  }

  [data-look='light'] {
    --ez-view-off: ${unsafeCSS(tokens.themes.light.textBody)};
  }

  [data-look='dark'] {
    --ez-view-off: ${unsafeCSS(tokens.themes.dark.textBody)};
  }

  .views .fb {
    font-size: ${unsafeCSS(tokens.layout.segmentedOptionSize)}px;
    font-weight: ${unsafeCSS(tokens.typography.roles.body.weight)};
    color: var(--ez-view-off);
  }

  .views .fb[aria-pressed='true'] {
    font-weight: ${unsafeCSS(tokens.typography.roles.bodyStrong.weight)};
    color: var(--ez-on-chosen);
  }

  estanza-plan-view {
    animation: ez-appear 0.5s ease-in-out 1;
  }

  estanza-plan-view.arriving {
    opacity: 0;
    pointer-events: none;
    animation: none;
  }

  estanza-plan-view:is(.holding, .leaving, .away) {
    pointer-events: none;
  }

  estanza-plan-view.leaving {
    animation: ez-fade 0.5s ease-in-out forwards;
  }

  estanza-plan-view.away {
    visibility: hidden;
    animation: none;
  }

  .stage:is(.plan-held, .plan-leaving, .plan-arriving)
    :is(.marks, .temps, .marks *, .temps *) {
    pointer-events: none;
  }

  .stage.plan-leaving :is(.marks, .temps) {
    animation: ez-fade 0.5s ease-in-out forwards;
  }

  .stage.plan-arriving :is(.marks, .temps) {
    opacity: 0;
  }

  .stage.on-plan :is(.marks, .temps, .pins) {
    animation: ez-appear 0.5s ease-in-out 1;
  }

  .stage.on-plan :is(.marks, .temps, .pins, .highlight) {
    transition: opacity ${unsafeCSS(tokens.motion.micro)};
  }

  .stage.on-plan.retiling :is(.marks, .temps, .pins, .highlight) {
    opacity: 0;
    pointer-events: none;
    transition: none;
  }

  :host([tablet]) .dock {
    left: 16px;
    top: 16px;
    max-height: calc(100% - 32px);
    translate: var(--ez-drift-x, 0px) var(--ez-drift-y, 0px);
    transition: translate 3s ease-in-out;
  }

  :host([tablet][portrait]) .dock {
    top: auto;
    left: 0;
    right: 0;
    bottom: 16px;
    width: fit-content;
    margin-inline: auto;
    flex-direction: row;
    flex-wrap: wrap-reverse;
    justify-content: center;
    align-items: center;
    max-height: none;
    max-width: calc(100% - 32px);
  }

  :host([tablet][portrait]) .stage.sheet-up .dock {
    bottom: calc(16px + var(--ez-sheet-rise, 0px));
  }

  :host([tablet][portrait]) .dock .floors {
    min-width: 0;
    max-width: none;
  }

  @media (prefers-reduced-motion: reduce) {
    estanza-plan-view,
    estanza-plan-view.leaving,
    .stage.on-plan :is(.marks, .temps, .pins),
    .stage.plan-leaving :is(.marks, .temps) {
      animation: none;
    }

    :host([tablet]) .dock {
      transition: none;
    }
  }
`;
