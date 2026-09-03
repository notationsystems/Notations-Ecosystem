import type { LensProps } from './types';

export interface LedgerLensProps extends LensProps { onResolve: (coordinationId: string) => void }

/** Placeholder: replaced by the full lens implementation. */
export function LedgerLens({ snapshot }: LedgerLensProps) {
  return <div className="lens"><div className="placeholder">LedgerLens · {snapshot.coordination.length} coordination records</div></div>;
}
