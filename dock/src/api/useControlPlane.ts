import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Command, CommandResult, JournalRecord, Snapshot } from '../model/types';
import { ControlPlaneApiError, ControlPlaneClient, loadConnection, saveConnection, type Connection } from './controlPlane';

export type DockMode = 'live' | 'sample' | 'disconnected';

export interface DockState {
  connection: Connection;
  setConnection: (c: Connection) => void;
  client: ControlPlaneClient;
  mode: DockMode;
  snapshot: Snapshot | null;
  events: JournalRecord[];
  /**
   * True when the plane held more records than the dock followed. Surfaced rather than
   * swallowed: a timeline missing records without saying so is worse than one that says
   * it could not fetch them.
   */
  truncated: boolean;
  error: ControlPlaneApiError | Error | null;
  lastSync: string | null;
  refresh: () => Promise<void>;
  submit: (cmd: Command) => Promise<CommandResult>;
  connect: () => Promise<void>;
}

const POLL_MS = 5000;
const MAX_EVENTS = 500;

async function loadSample(): Promise<Snapshot & { sample?: boolean; sampleNote?: string }> {
  const res = await fetch(`${import.meta.env.BASE_URL}sample-snapshot.json`);
  if (!res.ok) throw new Error('sample-snapshot.json is missing; run `node ecosystem/sample-snapshot.mjs`.');
  return (await res.json()) as Snapshot;
}

/** Live snapshot + incremental events from the control plane, with the bundled sample as an honest fallback. */
export function useControlPlane(): DockState {
  const [connection, setConnectionState] = useState<Connection>(() => loadConnection());
  const [mode, setMode] = useState<DockMode>('disconnected');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<JournalRecord[]>([]);
  const [error, setError] = useState<ControlPlaneApiError | Error | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const cursor = useRef<string | null>(null);
  /** True when the plane had more records than the dock followed. Never hidden. */
  const [truncated, setTruncated] = useState(false);
  const client = useMemo(() => new ControlPlaneClient(connection), [connection]);

  const setConnection = useCallback((c: Connection) => { saveConnection(c); setConnectionState(c); }, []);

  const applySnapshot = useCallback((s: Snapshot) => {
    setSnapshot(s);
    cursor.current = s.eventCursor;
    setLastSync(new Date().toISOString());
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    if (!connection.token) {
      try {
        const sample = await loadSample();
        applySnapshot(sample);
        setMode('sample');
        setEvents([]);
      } catch (e) { setError(e as Error); setMode('disconnected'); }
      return;
    }
    try {
      const s = await client.snapshot();
      applySnapshot(s);
      setMode('live');
      // Backfill the timeline with the whole journal once; polling appends from the cursor
      // afterwards. Paged, because the server caps a page and reading one and stopping
      // would drop records without saying so.
      const all = await client.allEvents();
      setEvents(all.events.slice(-MAX_EVENTS));
      setTruncated(Boolean(all.truncated));
    } catch (e) {
      setError(e as Error);
      setMode('disconnected');
      try { applySnapshot(await loadSample()); setMode('sample'); } catch { /* keep disconnected */ }
    }
  }, [client, connection.token, applySnapshot]);

  const refresh = useCallback(async () => {
    if (mode !== 'live') return connect();
    try { applySnapshot(await client.snapshot()); setError(null); } catch (e) { setError(e as Error); }
  }, [mode, connect, client, applySnapshot]);

  useEffect(() => { void connect(); }, [connect]);

  useEffect(() => {
    if (mode !== 'live') return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await client.allEvents(cursor.current);
        if (stopped) return;
        if (res.events.length) {
          setEvents((prev) => [...prev, ...res.events].slice(-MAX_EVENTS));
          setTruncated(Boolean(res.truncated));
          applySnapshot(await client.snapshot());
        }
        setError(null);
      } catch (e) {
        if (stopped) return;
        if (e instanceof ControlPlaneApiError && e.code === 'CURSOR_UNKNOWN') {
          try { applySnapshot(await client.snapshot()); } catch (inner) { setError(inner as Error); }
        } else setError(e as Error);
      }
    };
    const id = window.setInterval(() => { void tick(); }, POLL_MS);
    return () => { stopped = true; window.clearInterval(id); };
  }, [mode, client, applySnapshot]);

  const submit = useCallback(async (cmd: Command) => {
    if (mode !== 'live') throw new ControlPlaneApiError(0, 'DOCK_NOT_LIVE', 'The dock is showing the sample snapshot; commands need a live control plane.', 'Enter the control-plane token and connect.');
    const result = await client.command(cmd);
    applySnapshot(result.snapshot);
    // The records the plane actually wrote, not a reconstruction of them. This used to
    // fetch the delta, discard it, and append a hand-built record with an empty
    // commandHash and a null previousHash — a fabricated entry in a list the timeline
    // labels "the control plane's append-only, hash-linked record". A projection that
    // invents what it cannot fetch is the one thing this estate says it never does.
    const delta = await client.allEvents(cursor.current);
    setEvents((prev) => [...prev, ...delta.events].slice(-MAX_EVENTS));
    setTruncated(Boolean(delta.truncated));
    return result;
  }, [mode, client, applySnapshot]);

  return { connection, setConnection, client, mode, snapshot, events, truncated, error, lastSync, refresh, submit, connect };
}
