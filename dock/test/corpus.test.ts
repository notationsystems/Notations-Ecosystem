import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORPUS_ROLE_ORDER, corpusStanding, type Snapshot, type SnapshotNode } from '../src/model/types';

const sample = JSON.parse(readFileSync(path.resolve(__dirname, '../public/sample-snapshot.json'), 'utf8')) as Snapshot;

const node = (metadata: Record<string, string | number | boolean>): SnapshotNode =>
  ({ nodeId: 'n', name: 'n', kind: 'api', description: 'd', capabilities: [], metadata, location: null } as unknown as SnapshotNode);

describe('corpus standing', () => {
  it('reads the derived metadata the seed writes, and nothing else', () => {
    const standing = corpusStanding(node({ corpus_role: 'hold', corpus_grade: 'sound', corpus_coverage: 1 }));
    expect(standing).toEqual({ role: 'hold', grade: 'sound', coverage: 1, fails: [], ownerOf: [] });
  });

  it('splits declared failures so each names an invariant', () => {
    const standing = corpusStanding(node({ corpus_role: 'feed', corpus_grade: 'bare', corpus_coverage: 0.29, corpus_fails: 'COR-004 COR-005 COR-010' }));
    expect(standing?.fails).toEqual(['COR-004', 'COR-005', 'COR-010']);
  });

  it('reports no standing rather than inventing one', () => {
    expect(corpusStanding(node({ domain: 'platform' }))).toBeNull();
    expect(corpusStanding(node({ corpus_role: 'hold' }))).toBeNull();
  });

  it('refuses a role it does not know instead of rendering it as one', () => {
    const standing = corpusStanding(node({ corpus_role: 'sovereign', corpus_grade: 'sound' }));
    expect(standing?.role).toBeNull();
    expect(standing?.grade).toBe('sound');
  });

  it('never treats a missing coverage as zero', () => {
    // A grade with no coverage figure is `n/a` or `unbuilt`; rendering it as 0% would
    // read as "measured and found empty", which is the coercion the estate refuses.
    expect(corpusStanding(node({ corpus_role: 'project', corpus_grade: 'n/a' }))?.coverage).toBeNull();
  });
});

describe('the sample snapshot carries the whole estate', () => {
  it('grades every node, including the ones that hold nothing', () => {
    const graded = sample.nodes.map((n) => corpusStanding(n));
    expect(graded.filter(Boolean)).toHaveLength(sample.nodes.length);
    for (const standing of graded) {
      expect(CORPUS_ROLE_ORDER).toContain(standing!.role);
    }
  });

  it('separates holding a corpus from owning canonical state, one owner per domain', () => {
    const holders = sample.nodes.filter((n) => n.metadata.corpus_role === 'hold');
    const owners = sample.nodes.filter((n) => typeof n.metadata.corpus_owner_of === 'string');
    // Eight nodes hold a corpus; three own a domain's canonical state. Collapsing the
    // two would make COR-002 unreadable from the snapshot.
    expect(holders.length).toBeGreaterThan(owners.length);
    const claimed = owners.flatMap((n) => String(n.metadata.corpus_owner_of).split(/\s+/));
    expect(new Set(claimed).size).toBe(claimed.length);
    // Only a hold may own canonical state.
    for (const owner of owners) expect(owner.metadata.corpus_role).toBe('hold');
  });

  it('gives every node its canonical name, and never a dereferenceable one', () => {
    for (const n of sample.nodes) {
      expect(n.uri).toBe(`notation://node/notationsystems/${n.nodeId}`);
      expect(n.uri).not.toMatch(/^https?:/);
    }
  });
});
