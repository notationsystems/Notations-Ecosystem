import type { ConsoleIntent } from '../App';
import type { LensProps } from './types';

export interface ConsoleLensProps extends LensProps { intent: ConsoleIntent | null; onIntentConsumed: () => void }

/** Placeholder: replaced by the full lens implementation. */
export function ConsoleLens({ intent }: ConsoleLensProps) {
  return <div className="lens"><div className="placeholder">ConsoleLens · intent {intent?.action ?? 'none'}</div></div>;
}
