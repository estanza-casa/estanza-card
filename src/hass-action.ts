import type { ActionTrigger, ThingAction } from './bindings.js';
import { cardDeedOf, handedToHass } from './control.js';

export const DOUBLE_TAP_MS = 250;

export function waitsForDoubleTap(action: ThingAction | undefined): boolean {
  return action !== undefined && action.action !== 'none';
}

export function goesToHass(action: ThingAction | undefined): boolean {
  if (!action) return false;

  const deed = cardDeedOf(action);

  return (
    handedToHass(action) ||
    (Boolean(action.confirmation) && deed !== null && deed !== 'none')
  );
}

export function askHass(
  node: HTMLElement,
  trigger: ActionTrigger,
  action: ThingAction,
  entityIds: string[],
): void {
  const deed = cardDeedOf(action);
  const aimed =
    deed !== null && !['toggle', 'more-info', 'none'].includes(deed)
      ? { ...action, target: { entity_id: entityIds } }
      : action;

  node.dispatchEvent(
    new CustomEvent('hass-action', {
      detail: {
        config: { entity: entityIds[0], [`${trigger}_action`]: aimed },
        action: trigger,
      },
      bubbles: true,
      composed: true,
    }),
  );
}
