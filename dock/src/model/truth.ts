/**
 * The truth-response classification a Payload OS API response carries, and what this frontend is
 * obliged to render for each. The vocabulary is declared once in `ecosystem/truth-classes.json`
 * and mirrored here for the browser; `dock/test/truth.test.ts` fails if the two drift.
 *
 * API-001: a frontend renders the truth class it was given. It never upgrades a class, never
 * substitutes a value for a typed non-success, and never styles an observation as a verified fact.
 */

export const TRUTH_CLASSES = [
  'CANONICAL_PROOF',
  'VERIFIED_DERIVATION',
  'OPERATIONAL_OBSERVATION',
  'UNOBSERVED',
  'UNRESOLVED',
  'CONFLICTING',
  'NOT_EVIDENCED',
] as const;

export type TruthClass = (typeof TRUTH_CLASSES)[number];
export type TruthOutcome = 'success' | 'non_success';
export type TruthTone = 'verified' | 'observed' | 'unknown' | 'conflict';

export interface TruthSpec {
  outcome: TruthOutcome;
  tone: TruthTone;
  /** The short label a badge shows. */
  label: string;
  /** One sentence a reader can act on, shown next to the badge. */
  means: string;
  /** Fields a view carrying this class must show before a reader can decide anything. */
  mustRender: readonly string[];
}

export const TRUTH: Readonly<Record<TruthClass, TruthSpec>> = {
  CANONICAL_PROOF: {
    outcome: 'success',
    tone: 'verified',
    label: 'canonical',
    means: 'Canonical state, addressable and checkable against the proof root that carries it.',
    mustRender: ['canonical_reference', 'proof_root', 'valid_time', 'knowledge_time', 'release'],
  },
  VERIFIED_DERIVATION: {
    outcome: 'success',
    tone: 'verified',
    label: 'derived · verified',
    means: 'Derived, with the inputs, the transformation and the envelope root open to inspection.',
    mustRender: ['canonical_reference', 'proof_root', 'derivation_path', 'valid_time', 'knowledge_time', 'release'],
  },
  OPERATIONAL_OBSERVATION: {
    outcome: 'success',
    tone: 'observed',
    label: 'observation',
    means: 'One process’s opinion of itself at a moment. Not canonical state.',
    mustRender: ['observed_at', 'limitations', 'source'],
  },
  UNOBSERVED: {
    outcome: 'non_success',
    tone: 'unknown',
    label: 'unobserved',
    means: 'Nothing has looked. The subject exists and no observation of it is recorded.',
    mustRender: ['subject', 'why_unknown'],
  },
  UNRESOLVED: {
    outcome: 'non_success',
    tone: 'unknown',
    label: 'unresolved',
    means: 'The identity could not be resolved to one subject with the evidence available.',
    mustRender: ['candidates_considered', 'why_unknown'],
  },
  CONFLICTING: {
    outcome: 'non_success',
    tone: 'conflict',
    label: 'conflicting',
    means: 'Evidenced answers disagree and nothing in the corpus settles which is right.',
    mustRender: ['positions', 'each_position_evidence', 'why_unknown'],
  },
  NOT_EVIDENCED: {
    outcome: 'non_success',
    tone: 'unknown',
    label: 'not evidenced',
    means: 'Answerable in principle, but no admitted evidence bears on it.',
    mustRender: ['question', 'why_unknown'],
  },
};

export const isSuccess = (c: TruthClass): boolean => TRUTH[c].outcome === 'success';
export const isNonSuccess = (c: TruthClass): boolean => TRUTH[c].outcome === 'non_success';

/**
 * A value carried under a truth class. A non-success has no value by construction — that is the
 * point of the type: there is nowhere to put a zero, so a zero cannot be rendered in its place.
 */
export type Truth<T> =
  | { readonly class: 'CANONICAL_PROOF' | 'VERIFIED_DERIVATION'; readonly value: T; readonly reference: string; readonly proofRoot: string; readonly release?: string; readonly validTime?: string; readonly knowledgeTime?: string; readonly derivationPath?: readonly string[] }
  | { readonly class: 'OPERATIONAL_OBSERVATION'; readonly value: T; readonly observedAt: string; readonly limitations: readonly string[]; readonly source?: string }
  | { readonly class: 'UNOBSERVED' | 'UNRESOLVED' | 'CONFLICTING' | 'NOT_EVIDENCED'; readonly whyUnknown: string; readonly detail?: readonly string[] };

export type Unknown<T> = Extract<Truth<T>, { whyUnknown: string }>;
export type Observation<T> = Extract<Truth<T>, { observedAt: string }>;
export type Proven<T> = Extract<Truth<T>, { proofRoot: string }>;

// Guards rather than comparisons, so a view that forgets a branch fails to compile instead of
// falling through to a shape that has no value in it.
export const isUnknown = <T,>(t: Truth<T>): t is Unknown<T> => isNonSuccess(t.class);
export const isObservation = <T,>(t: Truth<T>): t is Observation<T> => t.class === 'OPERATIONAL_OBSERVATION';
export const isProven = <T,>(t: Truth<T>): t is Proven<T> => t.class === 'CANONICAL_PROOF' || t.class === 'VERIFIED_DERIVATION';

/**
 * The one accessor a view should use. It cannot return a fallback, because a fallback is exactly
 * the thing API-001 forbids: the caller must branch on the class and render the unknown.
 */
export function valueOf<T>(t: Truth<T>): T | undefined {
  return isUnknown(t) ? undefined : t.value;
}

/** An observation with no stated limits is not an observation; it is an unsupported claim. */
export function isRenderable<T>(t: Truth<T>): boolean {
  if (isObservation(t)) return Boolean(t.observedAt) && t.limitations.length > 0;
  if (isProven(t)) return Boolean(t.reference) && Boolean(t.proofRoot);
  return Boolean(t.whyUnknown);
}

/**
 * A node's health as a truth, rather than as a value with a colour.
 *
 * A health field on a node is one probe's opinion at one moment, so it is an OPERATIONAL_OBSERVATION
 * and carries the limits that come with being one. A node nothing has observed is UNOBSERVED, and
 * that is not the same as healthy, offline, or unknown-the-enum-value — it is the absence of a look.
 */
export function healthTruth(node: { health: string; lastObservedAt: string | null; lastObservation?: { source: string; detail: string } | null }): Truth<string> {
  if (!node.lastObservedAt) {
    return {
      class: 'UNOBSERVED',
      whyUnknown: 'No observation of this node has been recorded, so its health is not known.',
      detail: [`The registry carries health "${node.health}", which is a default and not a finding.`],
    };
  }
  return {
    class: 'OPERATIONAL_OBSERVATION',
    value: node.health,
    observedAt: node.lastObservedAt,
    source: node.lastObservation?.source,
    limitations: [
      'One probe, from one place, at one moment.',
      'Liveness is not correctness: a process that answers may still be wrong.',
      ...(node.lastObservation?.detail ? [node.lastObservation.detail] : []),
    ],
  };
}

/**
 * A node's security posture as a truth. An unsigned attestation is the principal's own word about
 * itself; it is a success class only once an independent signer has verified it.
 */
export function postureTruth(node: { security?: { attestedAt: string; method: string; signer?: { signerId: string } | null } | null }): Truth<string> {
  const s = node.security;
  if (!s) {
    return { class: 'NOT_EVIDENCED', whyUnknown: 'No security posture has been attested for this node.' };
  }
  if (!s.signer) {
    return {
      class: 'OPERATIONAL_OBSERVATION',
      value: s.method,
      observedAt: s.attestedAt,
      source: s.method,
      limitations: [
        'Unsigned: this is the principal’s own word about itself.',
        'No independent signer verified this statement.',
      ],
    };
  }
  return {
    class: 'VERIFIED_DERIVATION',
    value: s.method,
    reference: `notation://security/posture/${s.method}`,
    proofRoot: s.signer.signerId,
    knowledgeTime: s.attestedAt,
    derivationPath: ['posture statement', `signed by ${s.signer.signerId}`],
  };
}
