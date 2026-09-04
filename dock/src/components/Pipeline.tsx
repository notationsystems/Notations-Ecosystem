import type { Coordination, SnapshotNode } from '../model/types';
import { isObserved } from '../model/truth';

/**
 * The four states an intent can pass through in the Notations Universe:
 *   observed → proposed → approved → dispatched
 * The control plane intentionally stops at approved / not_dispatched, so the last
 * stage is rendered locked and is never lit by anything the dock knows.
 */
export type Stage = 'observed' | 'proposed' | 'approved' | 'dispatched';
export const STAGES: Stage[] = ['observed', 'proposed', 'approved', 'dispatched'];

export interface PipelineState {
  reached: Stage | null;
  /** A proposal that was rejected stops at proposed with a red marker. */
  rejected?: boolean;
  /** Awaiting an operator between proposed and approved. */
  pending?: boolean;
}

export function stageOfCoordination(c: Coordination): PipelineState {
  if (c.status === 'approved') return { reached: 'approved' };
  if (c.status === 'rejected') return { reached: 'proposed', rejected: true };
  if (c.status === 'approval_required') return { reached: 'proposed', pending: true };
  // 'ready': an observe/propose-mode intent that needs no operator; it is proposed and usable, never dispatched by the plane.
  return { reached: 'proposed' };
}

export function stageOfNode(n: SnapshotNode): PipelineState {
  // Reached means something looked, whatever it found — an observation of 'unknown' is still one.
  return { reached: isObserved(n) ? 'observed' : null };
}

const LABEL: Record<Stage, string> = { observed: 'observed', proposed: 'proposed', approved: 'approved', dispatched: 'dispatched' };

export function Pipeline({ state, compact = false, title }: { state: PipelineState; compact?: boolean; title?: string }) {
  const idx = state.reached ? STAGES.indexOf(state.reached) : -1;
  return (
    <div className={`pipeline ${compact ? 'compact' : ''}`} title={title}>
      {STAGES.map((s, i) => {
        const lit = i <= idx;
        const locked = s === 'dispatched';
        const cls = ['stage', lit ? 'lit' : '', locked ? 'locked' : '', state.rejected && s === 'proposed' ? 'rejected' : '', state.pending && s === 'approved' ? 'pending' : ''].join(' ');
        return (
          <span key={s} className={cls}>
            <span className="node" />
            {!compact && <span className="name">{LABEL[s]}{locked ? ' · not dispatched' : state.pending && s === 'approved' ? ' · awaiting operator' : state.rejected && s === 'proposed' ? ' · rejected' : ''}</span>}
            {i < STAGES.length - 1 && <span className="bar" />}
          </span>
        );
      })}
    </div>
  );
}
