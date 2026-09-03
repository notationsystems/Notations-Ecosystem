import { useMemo, useState } from 'react';
import type { LensProps } from './types';
import {
  POSTURE_DIMENSION_LABEL,
  POSTURE_DIMENSION_ORDER,
  POSTURE_STATE_COLOR,
  type ConstellationDimension,
  type PostureDimension,
  type PostureSignal,
  type PostureState,
  type SnapshotNode,
} from '../model/types';

const STATE_ORDER: PostureState[] = ['failing', 'weak', 'unknown', 'adequate', 'strong'];
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

function stateRank(state: PostureState): number {
  return STATE_ORDER.indexOf(state);
}

/** Nodes that carry an attestation for this dimension, worst first. */
function nodesFor(nodes: SnapshotNode[], dimension: PostureDimension): Array<{ node: SnapshotNode; signal: PostureSignal }> {
  return nodes
    .flatMap((node) => {
      const signal = node.security?.signals.find((entry) => entry.dimension === dimension);
      return signal ? [{ node, signal }] : [];
    })
    .sort((a, b) => stateRank(a.signal.state) - stateRank(b.signal.state) || a.node.nodeId.localeCompare(b.node.nodeId));
}

function Findings({ findings }: { findings?: Partial<Record<(typeof SEVERITIES)[number], number>> }) {
  if (!findings) return null;
  const present = SEVERITIES.filter((severity) => (findings[severity] ?? 0) > 0);
  if (!present.length) return <span className="sec-findings none">no open findings</span>;
  return (
    <span className="sec-findings">
      {present.map((severity) => (
        <span key={severity} className={`sec-count ${severity}`}>
          {findings[severity]} {severity}
        </span>
      ))}
    </span>
  );
}

function Coverage({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="sec-coverage empty">coverage unknown</span>;
  return (
    <span className="sec-coverage" title={`${Math.round(value * 100)}% of the surface is covered by this control`}>
      <span className="bar">
        <span className="fill" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      {Math.round(value * 100)}%
    </span>
  );
}

/**
 * The security constellation.
 *
 * Eleven dimensions of posture across every attested node. What is shown is exactly
 * what the control plane is permitted to hold: a state, a coverage fraction, counts by
 * severity and a sentence. There is nothing here to steal — no key material, no
 * addresses, no advisory identifiers, no paths — because the command boundary refuses
 * all of it, and the footer says so where an operator will read it.
 */
export function SecurityLens({ snapshot, filtered, onSelect, dock }: LensProps) {
  const [selectedDimension, setSelectedDimension] = useState<PostureDimension | null>(null);
  const constellation = snapshot.constellation;

  const dimensions = useMemo<ConstellationDimension[]>(() => {
    const byId = new Map((constellation?.dimensions ?? []).map((entry) => [entry.dimension, entry]));
    return POSTURE_DIMENSION_ORDER.map(
      (dimension) =>
        byId.get(dimension) ?? {
          dimension,
          description: '',
          states: {},
          nodes: 0,
          stale: 0,
          coverage: null,
          findings: { critical: 0, high: 0, medium: 0, low: 0 },
          worst: 'unknown' as PostureState,
        },
    );
  }, [constellation]);

  // One population throughout. This used to count attestations across the whole snapshot
  // and unattested nodes across the filtered one, so with any rail filter active the KPI
  // read "12 / 30" against a list of four — two different questions in one sentence.
  const attested = filtered.nodes.filter((node) => node.security);
  const unattested = filtered.nodes.filter((node) => !node.security);
  const detail = selectedDimension ? nodesFor(filtered.nodes, selectedDimension) : [];

  return (
    <div className="lens scroll">
      <div className="strip">
        <div className="kpi">
          <span>attested nodes</span>
          <b>
            {attested.length} / {filtered.nodes.length}
          </b>
        </div>
        <div className="kpi">
          <span>stale attestations</span>
          <b>{constellation?.staleNodes ?? 0}</b>
        </div>
        {(constellation?.unrecognisedSignals ?? 0) > 0 ? (
          <div className="kpi">
            <span>unrecognised signals</span>
            <b style={{ color: 'var(--warn, #d98b2b)' }}>{constellation?.unrecognisedSignals}</b>
          </div>
        ) : null}
        <div className="kpi">
          <span>dimensions failing</span>
          <b>{dimensions.filter((entry) => entry.worst === 'failing').length}</b>
        </div>
        <div className="kpi">
          <span>dimensions weak</span>
          <b>{dimensions.filter((entry) => entry.worst === 'weak').length}</b>
        </div>
        <div style={{ marginLeft: 'auto', maxWidth: 460, textAlign: 'right', color: 'var(--muted)', fontSize: 11 }}>
          Posture is evidence, not material. The control plane refuses credentials, key material, vulnerability
          detail, network topology, offensive capability and links to raw findings at the command boundary.
        </div>
      </div>

      {dock.mode !== 'live' && (
        <div className="notice" style={{ marginBottom: 12 }}>
          Sample snapshot: these posture states are illustrative, generated from the catalog. Connect to a live
          control plane to see attested evidence.
        </div>
      )}

      <div className="sec-grid">
        {dimensions.map((entry) => {
          const total = Object.values(entry.states).reduce((sum, count) => sum + (count ?? 0), 0);
          const active = selectedDimension === entry.dimension;
          return (
            <button
              key={entry.dimension}
              className={`sec-card ${active ? 'active' : ''} ${entry.nodes === 0 ? 'empty' : ''}`}
              style={{ borderColor: entry.nodes ? POSTURE_STATE_COLOR[entry.worst] : undefined }}
              onClick={() => setSelectedDimension(active ? null : entry.dimension)}
              title={entry.description || POSTURE_DIMENSION_LABEL[entry.dimension]}
            >
              <span className="sec-head">
                <span className="sec-dot" style={{ background: POSTURE_STATE_COLOR[entry.worst] }} />
                {POSTURE_DIMENSION_LABEL[entry.dimension]}
              </span>
              <span className="sec-state" style={{ color: POSTURE_STATE_COLOR[entry.worst] }}>
                {entry.nodes ? entry.worst : 'not attested'}
              </span>
              {entry.nodes > 0 && (
                <>
                  <span className="sec-bar" aria-hidden>
                    {STATE_ORDER.map((state) => {
                      const count = entry.states[state] ?? 0;
                      if (!count) return null;
                      return (
                        <span
                          key={state}
                          style={{ width: `${(count / total) * 100}%`, background: POSTURE_STATE_COLOR[state] }}
                          title={`${count} node(s) ${state}`}
                        />
                      );
                    })}
                  </span>
                  <span className="sec-meta">
                    <Coverage value={entry.coverage} />
                    <span>
                      {entry.nodes} node{entry.nodes === 1 ? '' : 's'}
                      {entry.stale > 0 ? ` · ${entry.stale} stale` : ''}
                    </span>
                  </span>
                  <Findings findings={entry.findings} />
                </>
              )}
            </button>
          );
        })}
      </div>

      {selectedDimension && (
        <section style={{ marginTop: 16 }}>
          <h3 style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {POSTURE_DIMENSION_LABEL[selectedDimension]} · {detail.length} attestation{detail.length === 1 ? '' : 's'}
          </h3>
          <table className="grid">
            <thead>
              <tr>
                <th>Node</th>
                <th>State</th>
                <th>Coverage</th>
                <th>Findings</th>
                <th>Summary</th>
                <th>Attested</th>
              </tr>
            </thead>
            <tbody>
              {detail.map(({ node, signal }) => (
                <tr key={node.nodeId}>
                  <td>
                    <a href="#" onClick={(event) => { event.preventDefault(); onSelect(node.nodeId); }}>
                      {node.name}
                    </a>
                  </td>
                  <td>
                    <span className="badge" style={{ color: POSTURE_STATE_COLOR[signal.state], borderColor: POSTURE_STATE_COLOR[signal.state] }}>
                      {signal.state}
                    </span>
                  </td>
                  <td><Coverage value={signal.coverage ?? null} /></td>
                  <td><Findings findings={signal.findings} /></td>
                  <td style={{ color: 'var(--muted)' }}>{signal.summary ?? '—'}</td>
                  <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {new Date(node.security!.attestedAt).toLocaleString()}
                    <div style={{ fontSize: 11 }}>
                      {node.security!.method.replace(/_/g, ' ')} · {node.security!.attestedBy}{node.security!.signer ? ` · signed by ${node.security!.signer.signerId}` : ' · unsigned'}
                    </div>
                  </td>
                </tr>
              ))}
              {!detail.length && (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--muted)' }}>
                    No node has attested this dimension. Run <code>node security/attest.mjs</code> against the system that
                    owns the control, or record an operator review from the console.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {unattested.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <h3 style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Not attested · {unattested.length}
          </h3>
          <div style={{ color: 'var(--muted)', marginBottom: 6 }}>
            A node with no attestation is not a healthy node; it is an unmeasured one. The constellation counts it as
            unknown rather than assuming the best.
          </div>
          <div className="checks">
            {unattested.map((node) => (
              <button key={node.nodeId} className="chip" onClick={() => onSelect(node.nodeId)}>
                {node.name}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
