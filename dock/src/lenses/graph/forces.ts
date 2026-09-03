/** Extra d3-force behaviour for GraphLens. Written without importing d3 so the dependency set stays as-is. */
import type { GraphNodeDatum } from '../../model/graph';
import { nodeRadius } from './render';

type SimNode = GraphNodeDatum & { x?: number; y?: number; vx?: number; vy?: number };
export type Force = ((alpha: number) => void) & { initialize?: (nodes: SimNode[]) => void };

/**
 * Pairwise collision force: keeps discs (radius = nodeRadius + padding) from overlapping so labels stay readable.
 * O(n²) per tick, which is fine for an ecosystem graph of tens to a few hundred nodes.
 */
export function collideForce(padding = 16, strength = 0.7): Force {
  let nodes: SimNode[] = [];
  const force: Force = () => {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (!a) continue;
      const ra = nodeRadius(a.capabilities) + padding;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        if (!b) continue;
        const min = ra + nodeRadius(b.capabilities) + padding;
        let dx = (b.x ?? 0) - (a.x ?? 0);
        let dy = (b.y ?? 0) - (a.y ?? 0);
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d === 0) { dx = (i - j) * 0.01; dy = 0.01; d = Math.hypot(dx, dy); }
        const push = ((min - d) / d) * 0.5 * strength;
        a.x = (a.x ?? 0) - dx * push; a.y = (a.y ?? 0) - dy * push;
        b.x = (b.x ?? 0) + dx * push; b.y = (b.y ?? 0) + dy * push;
      }
    }
  };
  force.initialize = (n) => { nodes = n; };
  return force;
}

/** Charge strength and link distance that keep the layout calm and legible for large discs. */
export const CHARGE_STRENGTH = -70;
export const LINK_DISTANCE = 70;
