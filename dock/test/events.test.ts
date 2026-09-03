import { describe, expect, it } from 'vitest';
import { ControlPlaneClient } from '../src/api/controlPlane';
import type { EventsResponse } from '../src/model/types';

/** A plane that pages its journal, so the client's pagination can be driven. */
function pagedPlane(total: number, pageSize: number) {
  const calls: string[] = [];
  const records = Array.from({ length: total }, (_, i) => ({
    event: { eventId: `e${i}`, recordedAt: '2026-09-03T00:00:00.000Z', commandHash: `h${i}`, kind: 'node_registered' },
    previousHash: i ? `r${i - 1}` : null,
    recordHash: `r${i}`,
  }));
  const fetchImpl = async (input: string | URL) => {
    const url = new URL(String(input), 'http://127.0.0.1');
    calls.push(url.search);
    const after = url.searchParams.get('after');
    const start = after ? records.findIndex((r) => r.event.eventId === after) + 1 : 0;
    const page = records.slice(start, start + pageSize);
    const truncated = start + pageSize < records.length;
    const body: EventsResponse = {
      schema: 'notations.control-plane.events.v1',
      revision: 'rev',
      eventCursor: records.at(-1)!.event.eventId,
      events: page as never,
      truncated,
      nextCursor: truncated ? page.at(-1)!.event.eventId : null,
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

const client = (fetchImpl: typeof fetch) =>
  new ControlPlaneClient({ baseUrl: '/cp', token: 't', actorId: 'operator:dock' } as never, fetchImpl as never);

describe('reading the journal', () => {
  it('follows the plane pagination instead of dropping the rest', async () => {
    const { calls, fetchImpl } = pagedPlane(25, 10);
    const res = await client(fetchImpl as never).allEvents();
    // Silent truncation is the failure this estate refuses everywhere else: a timeline
    // missing records without saying so is worse than one that says it could not fetch.
    expect(res.events).toHaveLength(25);
    expect(res.truncated).toBe(false);
    expect(calls).toHaveLength(3);
    expect(calls[1]).toContain('after=e9');
  });

  it('stops at a page budget and says it stopped, rather than looping', async () => {
    const { fetchImpl } = pagedPlane(1000, 10);
    const res = await client(fetchImpl as never).allEvents(null, { pages: 3 });
    expect(res.events).toHaveLength(30);
    expect(res.truncated).toBe(true);
  });

  it('sends a limit when asked, and no query at all when not', async () => {
    const { calls, fetchImpl } = pagedPlane(5, 10);
    const c = client(fetchImpl as never);
    await c.events();
    await c.events('e1', { limit: 50 });
    expect(calls[0]).toBe('');
    expect(calls[1]).toContain('limit=50');
    expect(calls[1]).toContain('after=e1');
  });

  it('every record it returns came from the plane, never from the dock', async () => {
    const { fetchImpl } = pagedPlane(3, 10);
    const res = await client(fetchImpl as never).allEvents();
    for (const record of res.events) {
      // A fabricated record was previously appended after each command with an empty
      // commandHash and a null previousHash, into a list the timeline labels the
      // plane's hash-linked record. Nothing the dock returns may be reconstructed.
      expect(record.event.commandHash).not.toBe('');
      expect(record.recordHash).toMatch(/^r\d+$/);
    }
    expect(res.events.slice(1).every((r, i) => r.previousHash === res.events[i].recordHash)).toBe(true);
  });
});
