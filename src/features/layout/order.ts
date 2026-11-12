import type { Json } from './model.js';

// Stacking order is the order of componentConfig: index 0 is drawn first (at
// the back), the last one on top. The editor's Arrange › Order commands move
// a component within that array; report-level components are ordered within
// report.componentConfig.

export const ORDERS = ['front', 'back', 'forward', 'backward'] as const;
export type Order = (typeof ORDERS)[number];

// Where the component would go, or undefined when it is already there.
export function orderTarget(list: Json[], componentId: string, order: Order): number | undefined {
  const at = list.findIndex((c) => c.componentId === componentId);
  if (at < 0) return undefined;
  const last = list.length - 1;
  const to = order === 'front' ? last : order === 'back' ? 0 : order === 'forward' ? Math.min(last, at + 1) : Math.max(0, at - 1);
  return to === at ? undefined : to;
}

// Moves it in place; true when something moved.
export function reorder(list: Json[], componentId: string, order: Order): boolean {
  const to = orderTarget(list, componentId, order);
  if (to === undefined) return false;
  const at = list.findIndex((c) => c.componentId === componentId);
  const [c] = list.splice(at, 1);
  list.splice(to, 0, c!);
  return true;
}

export function alreadyText(order: Order): string {
  return {
    front: 'already in front of everything',
    back: 'already behind everything',
    forward: 'already in front of everything (nothing to bring it forward past)',
    backward: 'already behind everything (nothing to send it back behind)',
  }[order];
}
