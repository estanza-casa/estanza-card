import { tokens } from '@estanza/tokens';
import { css, html, type TemplateResult, unsafeCSS } from 'lit';

export type UndoToast = { words: string; restore: () => void };

export type ToastHold = { hold: () => void; release: () => void };

export const UNDO_MS = 6000;

const TOAST_GUTTER_PX = 12;

export function undoToastTemplate(
  toast: UndoToast,
  { hold, release }: ToastHold,
  inline = false,
): TemplateResult {
  return html`<div
    class="toast ${inline ? 'inline' : 'floating'}"
    role="status"
    @pointerenter=${hold}
    @pointerleave=${release}
    @focusin=${hold}
    @focusout=${release}
  >
    <span class="toast-text">${toast.words}</span>
    <button class="toast-undo" @click=${toast.restore}>Undo</button>
  </div>`;
}

export type Confirm = {
  name: string;
  words: string;
  yes: string;
  danger?: boolean;
  onCancel: () => void;
  onYes: () => void;
};

export function confirmTemplate(confirm: Confirm): TemplateResult {
  return html`<div class="confirm confirm-${confirm.name}" role="group">
    <span class="confirm-text">${confirm.words}</span>
    <button class="btn cancel-${confirm.name}" @click=${confirm.onCancel}>
      Cancel
    </button>
    <button
      class="btn filled ${confirm.danger ? 'danger-filled' : ''} confirm-${confirm.name}-yes"
      @click=${confirm.onYes}
    >
      ${confirm.yes}
    </button>
  </div>`;
}

export function pinToScroller(toast: HTMLElement): void {
  const scroller = scrollerOf(toast);

  if (!scroller) return;

  const box = scroller.getBoundingClientRect();
  const left = box.left + TOAST_GUTTER_PX;
  const bottom = Math.min(box.bottom, window.innerHeight) - TOAST_GUTTER_PX;

  toast.style.position = 'fixed';
  toast.style.margin = '0';
  toast.style.width = `${scroller.clientWidth - 2 * TOAST_GUTTER_PX}px`;
  toast.style.left = '0px';
  toast.style.top = '0px';
  toast.style.bottom = 'auto';

  // Home Assistant's dialog carries a transform, so fixed is measured from the dialog, not the page.
  const origin = toast.getBoundingClientRect();

  toast.style.left = `${left - origin.left}px`;
  toast.style.top = `${bottom - origin.height - origin.top}px`;
}

function scrollerOf(start: Element): Element | null {
  let node: Element | null = parentOf(start);

  while (node) {
    const { overflowY } = getComputedStyle(node);

    if (
      /(auto|scroll)/.test(overflowY) &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }

    node = parentOf(node);
  }

  return null;
}

function parentOf(node: Element): Element | null {
  if (node.assignedSlot) return node.assignedSlot;

  const parent = node.parentNode;

  if (parent instanceof ShadowRoot) return parent.host;

  return parent instanceof Element ? parent : null;
}

export const promptStyles = css`
  .confirm {
    align-items: center;
    background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.08);
    border-radius: ${unsafeCSS(tokens.radius.md)}px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    margin: 4px 0 8px;
    padding: 6px 8px 6px 12px;
  }

  .confirm-text {
    flex: 1 1 160px;
    font-size: 13px;
  }

  .btn.filled.danger-filled {
    background: var(--error-color, #db4437);
  }

  .btn.filled.danger-filled:hover {
    background: color-mix(in srgb, var(--error-color, #db4437) 85%, black);
  }

  .toast {
    align-items: center;
    background: var(--primary-text-color, #1f2937);
    border-radius: ${unsafeCSS(tokens.radius.md)}px;
    bottom: 12px;
    box-sizing: border-box;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.24);
    color: var(--card-background-color, #fff);
    display: flex;
    gap: 8px;
    margin: 12px 0;
    padding: 4px 4px 4px 16px;
    position: sticky;
    z-index: 2;
  }

  .toast.inline {
    box-shadow: none;
    margin: 4px 12px 8px;
    position: static;
  }

  .toast-text {
    flex: 1;
    font-size: 14px;
    min-width: 0;
  }

  .toast-undo {
    background: none;
    border: 0;
    border-radius: ${unsafeCSS(tokens.radius.xl)}px;
    color: var(--card-background-color, #fff);
    cursor: pointer;
    flex: none;
    font-size: 14px;
    font-weight: 600;
    min-height: 36px;
    padding: 0 14px;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .toast-undo:hover {
    background: color-mix(in srgb, currentColor 14%, transparent);
  }

  .toast-undo:focus-visible {
    outline: 2px solid var(--card-background-color, #fff);
    outline-offset: -4px;
  }

  @media (pointer: coarse) {
    .toast-undo {
      min-height: 44px;
    }
  }
`;
