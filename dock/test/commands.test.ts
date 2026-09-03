import { describe, expect, it } from 'vitest';
import { declareRelation, recordObservation, registerNode, requestCapability, resolveCoordination, validateCommand } from '../src/model/commands';
import { ControlPlaneApiError, ControlPlaneClient } from '../src/api/controlPlane';
import { CONSOLE_ACTIONS, buildCommand, initialDrafts } from '../src/lenses/ops/consoleDrafts';

const ctx = { actorId: 'operator:dock', expectedRevision: null, now: () => '2026-09-03T00:00:00.000Z' };

describe('command builders validate with the control plane parser', () => {
  it('builds every command shape the server accepts', () => {
    const cmds = [
      registerNode(ctx, { nodeId: 'x-node', name: 'X', kind: 'api', description: 'A node.', capabilities: [{ capabilityId: 'a.read', label: 'Read A', description: 'Reads A.', mode: 'observe', approval: 'automatic' }], metadata: { domain: 'platform' }, location: null }),
      declareRelation(ctx, { sourceNodeId: 'a', targetNodeId: 'b', kind: 'depends_on', description: 'A needs B.' }),
      recordObservation(ctx, { nodeId: 'a', health: 'healthy', detail: 'Responding.' }),
      requestCapability(ctx, { requesterNodeId: 'a', targetNodeId: 'b', capabilityId: 'b.run', requestedMode: 'execute', purpose: 'Assess a scenario.' }),
      resolveCoordination(ctx, { coordinationId: 'coord-1', decision: 'approved', note: 'Approved for a separate adapter.' }),
    ];
    for (const c of cmds) {
      const v = validateCommand(c);
      expect(v.ok, JSON.stringify(v)).toBe(true);
      expect(c.requestId).toMatch(/^dock:[a-z_]+:/);
    }
    expect((cmds[1] as { relationId: string }).relationId).toBe('a--depends_on--b');
  });
  it('rejects what the server rejects, with the server wording', () => {
    const bad = registerNode(ctx, { nodeId: 'x', name: 'X', kind: 'api', description: 'd', capabilities: [{ capabilityId: 'run', label: 'Run', description: 'Runs.', mode: 'execute', approval: 'automatic' }] });
    const v = validateCommand(bad);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.detail).toMatch(/approval must be "operator"/);
    const secret = registerNode(ctx, { nodeId: 'x', name: 'X', kind: 'api', description: 'd', capabilities: [{ capabilityId: 'a', label: 'A', description: 'A.', mode: 'observe', approval: 'automatic' }], metadata: { api_token: 'nope' } });
    const s = validateCommand(secret);
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.detail).toMatch(/prohibited/);
  });
});

describe('client', () => {
  it('sends the bearer token and surfaces control-plane error bodies', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/v1/events?after=gone')) return new Response(JSON.stringify({ error: 'CURSOR_UNKNOWN', detail: 'gone', remedy: 'Refresh the snapshot.' }), { status: 409 });
      return new Response(JSON.stringify({ schema: 'notations.control-plane.snapshot.v1', nodes: [], relations: [], coordination: [], revision: null, eventCursor: null }), { status: 200 });
    }) as typeof fetch;
    const client = new ControlPlaneClient({ baseUrl: 'http://127.0.0.1:8787/', token: 't0k', actorId: 'operator:dock' }, fetchImpl);
    await client.snapshot();
    expect(calls[0]?.url).toBe('http://127.0.0.1:8787/v1/snapshot');
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer t0k');
    await expect(client.events('gone')).rejects.toMatchObject({ code: 'CURSOR_UNKNOWN', status: 409, remedy: 'Refresh the snapshot.' });
    await expect(client.events('gone')).rejects.toBeInstanceOf(ControlPlaneApiError);
  });
});

describe('the console covers every action the plane accepts', () => {
  it('offers the plane six actions, not five', () => {
    // The security lens told an operator to "record an operator review from the console",
    // and the console had five actions to the plane's six. `operator_review` is one of
    // four declared attestation methods that had no way to be used.
    expect(CONSOLE_ACTIONS.map((a) => a.id).sort()).toEqual([
      'declare_relation', 'record_observation', 'record_security_posture', 'register_node', 'request_capability', 'resolve_coordination',
    ]);
  });

  it('builds a posture command the plane accepts', () => {
    const drafts = initialDrafts({ nodes: [{ nodeId: 'payload-terminal' }], relations: [], coordination: [] } as never);
    const draft = { ...drafts, posture: { nodeId: 'payload-terminal', method: 'operator_review' as const, signals: [
      { dimension: 'identity' as const, state: 'adequate' as const, coverage: '0.8', summary: 'Every credential is bound to one actor identity.' },
      { dimension: 'backup' as const, state: 'unknown' as const, coverage: '', summary: '' },
    ] } };
    const cmd = buildCommand('record_security_posture', draft, ctx) as unknown as { signals: Array<Record<string, unknown>> };
    const v = validateCommand(cmd);
    expect(v.ok, JSON.stringify(v)).toBe(true);
    // An empty coverage box means "not measured", never a measured zero.
    expect(cmd.signals[0]).toMatchObject({ dimension: 'identity', state: 'adequate', coverage: 0.8 });
    expect(cmd.signals[1]).toEqual({ dimension: 'backup', state: 'unknown' });
  });

  it('refuses material in a posture summary with the server wording, before it is sent', () => {
    const drafts = initialDrafts({ nodes: [{ nodeId: 'payload-terminal' }], relations: [], coordination: [] } as never);
    // secret-scan:allow a fixture the evidence boundary must refuse
    const hostile = { ...drafts, posture: { nodeId: 'payload-terminal', method: 'operator_review' as const, signals: [
      { dimension: 'exposure' as const, state: 'weak' as const, coverage: '', summary: 'Exposure limited to 10.4.2.7 and db.internal:5432.' },
    ] } };
    const v = validateCommand(buildCommand('record_security_posture', hostile, ctx));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.detail).toMatch(/network-topology/);
  });
});
