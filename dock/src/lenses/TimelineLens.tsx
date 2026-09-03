import type { LensProps } from './types';

/** Placeholder: replaced by the full lens implementation. */
export function TimelineLens({ filtered }: LensProps) {
  return <div className="lens"><div className="placeholder">TimelineLens · {filtered.nodes.length} nodes · {filtered.relations.length} relations</div></div>;
}
