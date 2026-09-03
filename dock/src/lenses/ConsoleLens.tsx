import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ConsoleIntent } from '../App';
import { ControlPlaneApiError } from '../api/controlPlane';
import { validateCommand } from '../model/commands';
import { ATTESTATION_METHODS, CAPABILITY_MODES, HEALTHS, KIND_LABEL, NODE_KINDS, POSTURE_DIMENSION_LABEL, POSTURE_DIMENSION_ORDER, RELATION_KINDS, RELATION_LABEL, type Approval, type AttestationMethod, type CapabilityMode, type CommandResult, type Health, type NodeKind, type ObservationSource, type PostureDimension, type PostureState, type RelationKind, type SnapshotNode } from '../model/types';
import type { LensProps } from './types';
import { CONSOLE_ACTIONS, alignRequestToTarget, applyIntent, applyCapabilityPatch, blankCapability, blankSignal, buildCommand, initialDrafts, type CapabilityDraft, type ConsoleAction, type Drafts, type SignalDraft } from './ops/consoleDrafts';
import { shortHash } from './ops/format';
import './ops/ops.css';

export interface ConsoleLensProps extends LensProps { intent: ConsoleIntent | null; onIntentConsumed: () => void }

const SOURCES: ObservationSource[] = ['operator', 'health_check', 'webhook'];
const APPROVALS: Approval[] = ['automatic', 'operator'];

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; result: CommandResult }
  | { kind: 'api_error'; error: ControlPlaneApiError }
  | { kind: 'error'; message: string };

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <div className="field"><label>{label}{hint && <small>{hint}</small>}</label>{children}</div>;
}

function NodeSelect({ value, onChange, nodes, allowEmpty }: { value: string; onChange: (id: string) => void; nodes: SnapshotNode[]; allowEmpty?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">— choose a node —</option>}
      {nodes.map((n) => <option key={n.nodeId} value={n.nodeId}>{n.name} · {n.nodeId}</option>)}
    </select>
  );
}

/**
 * The operator command console. Every form builds a real control-plane command, validates it with the
 * control plane's own parser, and shows exactly what will be journaled before it is submitted.
 */
export function ConsoleLens({ dock, snapshot, intent, onIntentConsumed }: ConsoleLensProps) {
  const [action, setAction] = useState<ConsoleAction>('register_node');
  const [drafts, setDrafts] = useState<Drafts>(() => initialDrafts(snapshot));
  const [state, setState] = useState<SubmitState>({ kind: 'idle' });

  // An intent from another lens (Approve on the ledger, "Request execute" in the inspector) prefills and then is consumed.
  useEffect(() => {
    if (!intent) return;
    const next = applyIntent(drafts, intent, snapshot);
    setAction(next.action);
    setDrafts(next.drafts);
    setState({ kind: 'idle' });
    onIntentConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  const ctx = useMemo(() => ({ actorId: dock.connection.actorId, expectedRevision: snapshot.revision }), [dock.connection.actorId, snapshot.revision]);
  // The preview is a real command (fresh requestId and timestamps are minted again at submit time).
  const preview = useMemo(() => {
    const cmd = buildCommand(action, drafts, ctx);
    return { cmd, validation: validateCommand(cmd) };
  }, [action, drafts, ctx]);

  const nodes = snapshot.nodes;
  const byId = useMemo(() => new Map(nodes.map((n) => [n.nodeId, n])), [nodes]);
  const pending = snapshot.coordination.filter((c) => c.status === 'approval_required');
  const live = dock.mode === 'live';
  const canSubmit = live && preview.validation.ok && state.kind !== 'busy';

  const submit = async () => {
    if (!canSubmit) return;
    setState({ kind: 'busy' });
    try {
      const result = await dock.submit(buildCommand(action, drafts, ctx));
      setState({ kind: 'done', result });
    } catch (e) {
      if (e instanceof ControlPlaneApiError) setState({ kind: 'api_error', error: e });
      else setState({ kind: 'error', message: (e as Error).message ?? String(e) });
    }
  };

  const set = <K extends keyof Drafts>(key: K, patch: Partial<Drafts[K]>) => setDrafts((d) => ({ ...d, [key]: { ...d[key], ...patch } }));

  const renderForm = () => {
    switch (action) {
      case 'register_node': {
        const r = drafts.register;
        const setCap = (i: number, patch: Partial<CapabilityDraft>) => set('register', { capabilities: r.capabilities.map((c, j) => (j === i ? applyCapabilityPatch(c, patch) : c)) });
        return (
          <>
            <div className="grid2">
              <Field label="Node id" hint="letters, digits, : _ . / -"><input className="mono" value={r.nodeId} onChange={(e) => set('register', { nodeId: e.target.value })} placeholder="payload-terminal" /></Field>
              <Field label="Name"><input value={r.name} onChange={(e) => set('register', { name: e.target.value })} placeholder="Payload Terminal" /></Field>
            </div>
            <Field label="Kind"><select value={r.kind} onChange={(e) => set('register', { kind: e.target.value as NodeKind })}>{NODE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
            <Field label="Description"><textarea value={r.description} onChange={(e) => set('register', { description: e.target.value })} placeholder="What this node is and what it holds." /></Field>

            <div className="subhead"><span>Capabilities · {r.capabilities.length}</span><button className="btn small" onClick={() => set('register', { capabilities: [...r.capabilities, blankCapability()] })}>+ capability</button></div>
            {r.capabilities.map((c, i) => (
              <div className="caprow" key={i}>
                <div className="top"><span>capability {i + 1}</span>{r.capabilities.length > 1 && <button className="btn small" onClick={() => set('register', { capabilities: r.capabilities.filter((_, j) => j !== i) })}>remove</button>}</div>
                <div className="grid2">
                  <Field label="Capability id"><input className="mono" value={c.capabilityId} onChange={(e) => setCap(i, { capabilityId: e.target.value })} placeholder="scenario.assess" /></Field>
                  <Field label="Label"><input value={c.label} onChange={(e) => setCap(i, { label: e.target.value })} placeholder="Assess scenario" /></Field>
                </div>
                <Field label="Description"><input value={c.description} onChange={(e) => setCap(i, { description: e.target.value })} placeholder="What the capability does and returns." /></Field>
                <div className="grid2">
                  <Field label="Mode"><select value={c.mode} onChange={(e) => setCap(i, { mode: e.target.value as CapabilityMode })}>{CAPABILITY_MODES.map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
                  <Field label="Approval" hint={c.mode === 'execute' ? <span className="warn">execute ⇒ operator</span> : undefined}>
                    <select value={c.approval} onChange={(e) => setCap(i, { approval: e.target.value as Approval })}>{APPROVALS.map((a) => <option key={a} value={a}>{a}</option>)}</select>
                  </Field>
                </div>
              </div>
            ))}

            <div className="subhead"><span>Metadata · {r.metadata.filter((m) => m.key.trim()).length}</span><button className="btn small" onClick={() => set('register', { metadata: [...r.metadata, { key: '', value: '' }] })}>+ row</button></div>
            {r.metadata.map((m, i) => (
              <div className="kvrow" key={i}>
                <input className="mono" value={m.key} placeholder="key" onChange={(e) => set('register', { metadata: r.metadata.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} />
                <input value={m.value} placeholder="value" onChange={(e) => set('register', { metadata: r.metadata.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                <button className="btn small" onClick={() => set('register', { metadata: r.metadata.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            <div className="hint">Numbers and true/false are typed automatically; quote a value to keep it a string. Credential- and contact-shaped keys are refused.</div>

            <div className="subhead"><span>Location · optional</span></div>
            <div className="grid2">
              <Field label="Latitude"><input className="mono" inputMode="decimal" value={r.latitude} onChange={(e) => set('register', { latitude: e.target.value })} placeholder="51.5074" /></Field>
              <Field label="Longitude"><input className="mono" inputMode="decimal" value={r.longitude} onChange={(e) => set('register', { longitude: e.target.value })} placeholder="-0.1278" /></Field>
            </div>
          </>
        );
      }
      case 'declare_relation': {
        const d = drafts.relation;
        return (
          <>
            <div className="grid2">
              <Field label="Source node"><NodeSelect value={d.sourceNodeId} nodes={nodes} onChange={(v) => set('relation', { sourceNodeId: v })} /></Field>
              <Field label="Target node"><NodeSelect value={d.targetNodeId} nodes={nodes} onChange={(v) => set('relation', { targetNodeId: v })} /></Field>
            </div>
            <Field label="Kind"><select value={d.kind} onChange={(e) => set('relation', { kind: e.target.value as RelationKind })}>{RELATION_KINDS.map((k) => <option key={k} value={k}>{RELATION_LABEL[k]}</option>)}</select></Field>
            <div className="hint">{byId.get(d.sourceNodeId)?.name ?? d.sourceNodeId} <b style={{ color: 'var(--cyan)' }}>{RELATION_LABEL[d.kind]}</b> {byId.get(d.targetNodeId)?.name ?? d.targetNodeId}</div>
            <Field label="Description"><textarea value={d.description} onChange={(e) => set('relation', { description: e.target.value })} placeholder="Why this relation exists." /></Field>
          </>
        );
      }
      case 'record_observation': {
        const o = drafts.observation;
        return (
          <>
            <Field label="Node"><NodeSelect value={o.nodeId} nodes={nodes} onChange={(v) => set('observation', { nodeId: v })} /></Field>
            <div className="grid2">
              <Field label="Health"><select value={o.health} onChange={(e) => set('observation', { health: e.target.value as Health })}>{HEALTHS.map((h) => <option key={h} value={h}>{h}</option>)}</select></Field>
              <Field label="Source"><select value={o.source} onChange={(e) => set('observation', { source: e.target.value as ObservationSource })}>{SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
            </div>
            <Field label="Detail"><textarea value={o.detail} onChange={(e) => set('observation', { detail: e.target.value })} placeholder="What was observed, and how." /></Field>
          </>
        );
      }
      case 'record_security_posture': {
        const p = drafts.posture;
        const setSignal = (index: number, patch: Partial<SignalDraft>) =>
          set('posture', { signals: p.signals.map((sig, i) => (i === index ? { ...sig, ...patch } : sig)) });
        return (
          <>
            <div className="grid2">
              <Field label="Node"><NodeSelect value={p.nodeId} nodes={nodes} onChange={(v) => set('posture', { nodeId: v })} /></Field>
              <Field label="Method" hint="How this posture was established">
                <select value={p.method} onChange={(e) => set('posture', { method: e.target.value as AttestationMethod })}>
                  {ATTESTATION_METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                </select>
              </Field>
            </div>
            <div className="hint">
              Posture replaces this node's whole attestation, so send every dimension you mean to state.
              Evidence only: a summary carrying an address, an advisory id, a package version, a tooling
              invocation, a URL or a path is refused at the boundary, with the plane's own wording.
            </div>
            {p.signals.map((sig, index) => (
              <div key={index} className="cap" style={{ marginTop: 8 }}>
                <div className="grid2">
                  <Field label="Dimension">
                    <select value={sig.dimension} onChange={(e) => setSignal(index, { dimension: e.target.value as PostureDimension })}>
                      {POSTURE_DIMENSION_ORDER.map((d) => <option key={d} value={d}>{POSTURE_DIMENSION_LABEL[d]}</option>)}
                    </select>
                  </Field>
                  <Field label="State">
                    <select value={sig.state} onChange={(e) => setSignal(index, { state: e.target.value as PostureState })}>
                      {(['strong', 'adequate', 'weak', 'failing', 'unknown'] as PostureState[]).map((st) => <option key={st} value={st}>{st}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Coverage" hint="0 to 1, or leave empty — empty means not measured, which is not the same as zero">
                  <input value={sig.coverage} onChange={(e) => setSignal(index, { coverage: e.target.value })} placeholder="" inputMode="decimal" />
                </Field>
                <Field label="Summary" hint="One sentence, at most 280 characters">
                  <textarea value={sig.summary} onChange={(e) => setSignal(index, { summary: e.target.value })} placeholder="What the control is, in one sentence. No addresses, versions, advisories or links." />
                </Field>
                {p.signals.length > 1 && (
                  <button className="btn small" onClick={() => set('posture', { signals: p.signals.filter((_, i) => i !== index) })}>Remove dimension</button>
                )}
              </div>
            ))}
            <button className="btn small" style={{ marginTop: 8 }} onClick={() => set('posture', { signals: [...p.signals, blankSignal()] })}>Add dimension</button>
          </>
        );
      }
      case 'request_capability': {
        const q = drafts.request;
        const target = byId.get(q.targetNodeId);
        const cap = target?.capabilities.find((c) => c.capabilityId === q.capabilityId);
        return (
          <>
            <div className="grid2">
              <Field label="Requester node"><NodeSelect value={q.requesterNodeId} nodes={nodes} onChange={(v) => set('request', { requesterNodeId: v })} /></Field>
              <Field label="Target node"><NodeSelect value={q.targetNodeId} nodes={nodes} onChange={(v) => set('request', alignRequestToTarget({ ...q, targetNodeId: v, capabilityId: '' }, snapshot))} /></Field>
            </div>
            <Field label="Capability" hint={target ? `${target.capabilities.length} declared` : undefined}>
              <select value={q.capabilityId} onChange={(e) => set('request', alignRequestToTarget({ ...q, capabilityId: e.target.value }, snapshot))}>
                {!target?.capabilities.length && <option value="">— target declares no capabilities —</option>}
                {target?.capabilities.map((c) => <option key={c.capabilityId} value={c.capabilityId}>{c.capabilityId} · {c.mode} · {c.label}</option>)}
              </select>
            </Field>
            <Field label="Requested mode" hint="follows the capability's declared mode">
              <div><span className={`badge ${q.requestedMode}`}>{q.requestedMode}</span>{cap && <span className={`badge ${cap.approval === 'operator' ? 'operator' : ''}`}>{cap.approval === 'operator' ? 'operator decision required' : 'automatic'}</span>}</div>
            </Field>
            {cap && <div className="hint">{cap.description}</div>}
            <Field label="Purpose"><textarea value={q.purpose} onChange={(e) => set('request', { purpose: e.target.value })} placeholder="What the requester intends to do with this capability." /></Field>
          </>
        );
      }
      case 'resolve_coordination': {
        const v = drafts.resolve;
        const rec = snapshot.coordination.find((c) => c.coordinationId === v.coordinationId);
        return (
          <>
            <Field label="Coordination" hint={`${pending.length} awaiting decision`}>
              <select value={v.coordinationId} onChange={(e) => set('resolve', { coordinationId: e.target.value })}>
                {!pending.length && <option value="">— nothing awaits a decision —</option>}
                {pending.map((c) => <option key={c.coordinationId} value={c.coordinationId}>{c.coordinationId} · {c.requesterNodeId} → {c.targetNodeId} · {c.capabilityId}</option>)}
                {v.coordinationId && !pending.some((c) => c.coordinationId === v.coordinationId) && <option value={v.coordinationId}>{v.coordinationId} (not pending)</option>}
              </select>
            </Field>
            {rec && <div className="caprow"><div><b>{rec.requesterNodeId}</b> → <b>{rec.targetNodeId}</b> · <span className="mono" style={{ color: 'var(--amber)' }}>{rec.capabilityId}</span> <span className={`badge ${rec.requestedMode}`}>{rec.requestedMode}</span></div><div style={{ color: 'var(--muted)', marginTop: 4 }}>{rec.purpose}</div><div style={{ color: 'var(--muted)', marginTop: 4, fontSize: 11 }}>requested by {rec.requestedBy}</div></div>}
            <Field label="Decision">
              <div style={{ display: 'flex', gap: 6 }}>
                <button className={`btn ${v.decision === 'approved' ? 'primary' : ''}`} onClick={() => set('resolve', { decision: 'approved' })}>Approve</button>
                <button className={`btn ${v.decision === 'rejected' ? 'danger' : ''}`} onClick={() => set('resolve', { decision: 'rejected' })}>Reject</button>
              </div>
            </Field>
            <div className="hint">An approval is journaled as <span className="mono">approved · not_dispatched</span>. No provider action follows from this console.</div>
            <Field label="Note"><textarea value={v.note} onChange={(e) => set('resolve', { note: e.target.value })} placeholder="Why this decision was taken." /></Field>
          </>
        );
      }
    }
  };

  const active = CONSOLE_ACTIONS.find((a) => a.id === action)!;

  return (
    <div className="lens scroll">
      <div className="ops-head">
        <div>
          <h2>Operator console</h2>
          <p className="lede">Commands are validated with the control plane's own parser and journaled with <span className="mono">expectedRevision</span> so a stale dock can never overwrite newer state.</p>
        </div>
        <span className="meta">actor <span className="mono" style={{ textTransform: 'none', letterSpacing: 0 }}>{dock.connection.actorId}</span></span>
      </div>

      <div className="console">
        <div className="pane">
          <div className="actions-tabs">
            {CONSOLE_ACTIONS.map((a) => <button key={a.id} className={`tab ${action === a.id ? 'active' : ''}`} onClick={() => { setAction(a.id); setState({ kind: 'idle' }); }}>{a.label}</button>)}
          </div>
          <p style={{ color: 'var(--muted)', marginTop: 0 }}>{active.blurb}</p>
          {renderForm()}
        </div>

        <div className="pane">
          <div className="subhead" style={{ marginTop: 0 }}><span>Command preview</span><span className="mono" style={{ textTransform: 'none', letterSpacing: 0 }}>{action}</span></div>
          {preview.validation.ok
            ? null
            : <div className="error" style={{ marginBottom: 10, marginTop: 0 }}><div>{preview.validation.detail}</div>{preview.validation.remedy && <div className="remedy">{preview.validation.remedy}</div>}</div>}
          <pre className="preview">{JSON.stringify(preview.cmd, null, 2)}</pre>

          {!live && <div className="notice">The dock is showing the sample snapshot; commands need a live control plane. Enter the control-plane token in the connection panel to submit.</div>}

          <div className="submitbar">
            <button className="btn primary" disabled={!canSubmit} onClick={() => void submit()}>{state.kind === 'busy' ? 'Submitting…' : 'Submit'}</button>
            <span className="rev">revision <b className="mono">{snapshot.revision ? shortHash(snapshot.revision, 12) : 'null (empty journal)'}</b></span>
            {!preview.validation.ok && <span className="warn">fix the command to submit</span>}
          </div>

          {state.kind === 'done' && (
            <div className="result">
              <div><b>{state.result.outcome === 'appended' ? 'Appended to the journal' : 'Duplicate request: already journaled'}</b></div>
              <div className="kv">
                <span>event</span><b className="mono">{state.result.event.eventId}</b>
                <span>kind</span><b>{state.result.event.kind.replace(/_/g, ' ')}</b>
                <span>record hash</span><b className="mono" title={state.result.event.recordHash}>{state.result.event.recordHash}</b>
                <span>revision</span><b className="mono">{shortHash(state.result.snapshot.revision, 12)}</b>
              </div>
              {state.result.event.kind === 'coordination_resolved' && <div style={{ color: 'var(--muted)', marginTop: 6 }}>Recorded as a decision only: the coordination stays not_dispatched.</div>}
            </div>
          )}
          {state.kind === 'api_error' && (
            <div className="error">
              <div className="code">{state.error.code}{state.error.status ? ` · HTTP ${state.error.status}` : ''}</div>
              <div>{state.error.code === 'REVISION_CONFLICT' ? 'The snapshot moved while this command was being prepared; the control plane refused to append over newer state.' : state.error.detail}</div>
              {state.error.code === 'REVISION_CONFLICT' ? <div style={{ marginTop: 6 }}><button className="btn small" onClick={() => { void dock.refresh(); setState({ kind: 'idle' }); }}>Refresh snapshot</button> <span className="remedy">then submit again with the current revision.</span></div> : state.error.remedy && <div className="remedy">{state.error.remedy}</div>}
            </div>
          )}
          {state.kind === 'error' && <div className="error">{state.message}</div>}
        </div>
      </div>
    </div>
  );
}
