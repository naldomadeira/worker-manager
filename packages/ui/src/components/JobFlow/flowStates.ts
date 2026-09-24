import type { CSSProperties } from 'react';
import { statusTone } from '../StatusTone/statusTone';

/**
 * The status colour of a flow node, as a CSS value. Nodes, badges and the minimap all read it
 * through the `--node-state` custom property, so one inline style themes a whole node.
 */
export function stateColor(state: string): string {
  return statusTone(state).color;
}

export function stateStyle(state: string): CSSProperties {
  return { '--node-state': stateColor(state) } as CSSProperties;
}
