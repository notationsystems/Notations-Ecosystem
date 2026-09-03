import type { ReactNode } from 'react';
import { TRUTH, isObservation, isUnknown, type Truth, type TruthClass } from '../model/truth';

/**
 * The two components every consequential view uses to show what an answer is worth.
 *
 * API-001: a frontend renders the truth class it was given. These render it and nothing else —
 * neither takes a fallback value, because a fallback is the mechanism by which an unknown becomes
 * a known on screen.
 */

export function TruthBadge({ truth, title }: { truth: TruthClass; title?: string }) {
  const spec = TRUTH[truth];
  return (
    <span className={`truth truth-${spec.tone}`} data-truth={truth} title={title ?? spec.means}>
      {spec.label}
    </span>
  );
}

/**
 * A value under its class. A non-success renders as the stated unknown with its reason — never as a
 * zero, a dash, or a blank that reads as complete.
 */
export function Evidenced<T>({ truth, render, label }: { truth: Truth<T>; render: (value: T) => ReactNode; label?: string }) {
  if (isUnknown(truth)) {
    return (
      <span className="evidenced">
        <TruthBadge truth={truth.class} />
        <span className="why">{truth.whyUnknown}</span>
        {truth.detail?.length ? <span className="why-detail">{truth.detail.join(' · ')}</span> : null}
      </span>
    );
  }
  if (isObservation(truth)) {
    // An observation with no stated limits is an unsupported claim; it is shown as one.
    const limits = truth.limitations.length
      ? truth.limitations.join(' · ')
      : 'No limitations were stated with this observation, so it carries no support.';
    return (
      <span className="evidenced">
        {label ? <span className="lbl">{label}</span> : null}
        {render(truth.value)}
        <TruthBadge truth={truth.class} />
        <span className="why">observed {new Date(truth.observedAt).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z')}{truth.source ? ` · ${truth.source}` : ''} · {limits}</span>
      </span>
    );
  }
  return (
    <span className="evidenced">
      {label ? <span className="lbl">{label}</span> : null}
      {render(truth.value)}
      <TruthBadge truth={truth.class} />
      <span className="why mono">
        {truth.reference} · root {truth.proofRoot.slice(0, 12)}
        {truth.release ? ` · release ${truth.release}` : ''}
        {truth.knowledgeTime ? ` · known ${truth.knowledgeTime}` : ''}
      </span>
    </span>
  );
}

/**
 * The release-first frame. Every field is itself a truth, so a frame with nothing behind it says
 * NOT_EVIDENCED rather than rendering an empty box that reads as fine.
 */
export function ReleaseFrame({ fields }: { fields: ReadonlyArray<{ name: string; truth: Truth<string> }> }) {
  return (
    <div className="frame">
      {fields.map(({ name, truth }) => (
        <div className="frame-field" key={name}>
          <span className="lbl">{name}</span>
          <Evidenced truth={truth} render={(v) => <b>{v}</b>} />
        </div>
      ))}
    </div>
  );
}
