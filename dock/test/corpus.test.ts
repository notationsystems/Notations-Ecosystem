import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORPUS_ROLE_ORDER, collectionStanding, corpusStanding, type Snapshot, type SnapshotNode } from '../src/model/types';

const sample = JSON.parse(readFileSync(path.resolve(__dirname, '../public/sample-snapshot.json'), 'utf8')) as Snapshot;

const node = (metadata: Record<string, string | number | boolean>): SnapshotNode =>
  ({ nodeId: 'n', name: 'n', kind: 'api', description: 'd', capabilities: [], metadata, location: null } as unknown as SnapshotNode);

describe('corpus standing', () => {
  it('reads the derived metadata the seed writes, and nothing else', () => {
    const standing = corpusStanding(node({ corpus_role: 'hold', corpus_grade: 'sound', corpus_coverage: 1 }));
    expect(standing).toEqual({ role: 'hold', grade: 'sound', coverage: 1, applicable: null, fails: [], unknown: [], ownerOf: [] });
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

  it('keeps unassessed invariants distinct from held ones', () => {
    // Without this a node with no declared failures reads as one that holds everything,
    // and "not assessed" becomes "passed".
    const standing = corpusStanding(node({ corpus_role: 'feed', corpus_grade: 'bare', corpus_coverage: 0.43, corpus_unknown: 'COR-003 COR-004' }));
    expect(standing?.unknown).toEqual(['COR-003', 'COR-004']);
    expect(standing?.fails).toEqual([]);
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

  it('carries the set of data-domain subjects each node touches', () => {
    const withSubjects = sample.nodes.filter((n) => typeof n.metadata.data_domains === 'string');
    expect(withSubjects.length).toBeGreaterThan(8);
    for (const n of withSubjects) {
      const subjects = String(n.metadata.data_domains).split(' ');
      // Whole subjects only: a half-spelled subject is a wrong one, and the value is
      // truncated on a boundary rather than at a character count.
      expect(subjects.every((s) => /^[a-z][a-z0-9-]*$/.test(s))).toBe(true);
      expect(new Set(subjects).size).toBe(subjects.length);
      expect(String(n.metadata.data_domains).length).toBeLessThanOrEqual(480);
    }
    const terminal = sample.nodes.find((n) => n.nodeId === 'payload-terminal');
    expect(String(terminal!.metadata.data_domains)).toContain('commodity-markets');
    expect(String(terminal!.metadata.data_domains)).toContain('logistics');
  });

  it('gives every node its canonical name, and never a dereferenceable one', () => {
    for (const n of sample.nodes) {
      expect(n.uri).toBe(`notation://node/notationsystems/${n.nodeId}`);
      expect(n.uri).not.toMatch(/^https?:/);
    }
  });
});

describe('collection standing', () => {
  it('reads the declaration a node makes about person data', () => {
    expect(collectionStanding(node({ person_data: 'refused' }))).toEqual({ standing: 'refused', exception: null });
    expect(collectionStanding(node({ person_data: 'incidental' }))?.standing).toBe('incidental');
  });

  it('carries the written exception on a node that serves', () => {
    const standing = collectionStanding(node({ person_data: 'serves', person_data_exception: 'Serves analyst profiles; ends when the upstream contract does.' }));
    expect(standing?.standing).toBe('serves');
    expect(standing?.exception).toBe('Serves analyst profiles; ends when the upstream contract does.');
  });

  it('reports a missing declaration rather than reading it as a refusal', () => {
    // A node seeded before the policy existed has said nothing. Silence is a gap; the
    // one thing it must never be rendered as is the strongest of the three answers.
    expect(collectionStanding(node({ domain: 'platform' }))).toBeNull();
    expect(collectionStanding(node({ person_data: 'none' }))).toBeNull();
  });

  it('does not admit an exception it cannot read as a sentence', () => {
    expect(collectionStanding(node({ person_data: 'serves', person_data_exception: '   ' }))?.exception).toBeNull();
  });
});

describe('the sample snapshot states where every node sits under the collection policy', () => {
  it('declares one of the three standings for all thirty', () => {
    const declared = sample.nodes.map((n) => collectionStanding(n));
    expect(declared.filter(Boolean)).toHaveLength(sample.nodes.length);
  });

  it('gives every first-party node that serves people an exception, and the same COR-010 failure', () => {
    const serving = sample.nodes.filter((n) => n.metadata.person_data === 'serves');
    expect(serving.length).toBeGreaterThan(0);
    for (const n of serving) {
      if (n.metadata.maturity === 'upstream-mirror') continue;
      expect(collectionStanding(n)?.exception).toBeTruthy();
      // The two records must not be able to disagree: serving people is the declared
      // refusal that is not held.
      expect(String(n.metadata.corpus_fails ?? '')).toContain('COR-010');
    }
  });

  it('keeps refusal the estate\'s default rather than its exception', () => {
    const refused = sample.nodes.filter((n) => n.metadata.person_data === 'refused');
    const serving = sample.nodes.filter((n) => n.metadata.person_data === 'serves');
    expect(refused.length).toBeGreaterThan(serving.length * 5);
  });
});

describe('the closed vocabularies reach the snapshot and are searchable', () => {
  it('gives every node the surfaces its capabilities are reached through', () => {
    for (const n of sample.nodes) expect(typeof n.metadata.surfaces).toBe('string');
    const all = new Set(sample.nodes.flatMap((n) => String(n.metadata.surfaces).split(' ')).filter(Boolean));
    // All nineteen, so the vocabulary is answerable from a snapshot rather than partly.
    expect(all.size).toBe(19);
  });

  it('says how a node is reached and never where it lives', () => {
    // A surface is a kind drawn from a closed vocabulary — `http`, `mcp`, `cli` — and
    // never a locator. `http` is a legal surface; `http://payload:3000` would be a
    // hostname and a port crossing a boundary the plane exists to hold, so the check is
    // membership in the vocabulary rather than a guess at what a locator looks like.
    const vocabulary = new Set(
      Object.keys(JSON.parse(readFileSync(path.resolve(__dirname, '../../ecosystem/surfaces.json'), 'utf8')).surfaces),
    );
    for (const n of sample.nodes) {
      for (const surface of String(n.metadata.surfaces).split(' ').filter(Boolean)) {
        expect(vocabulary.has(surface)).toBe(true);
        expect(surface).toMatch(/^[a-z][a-z0-9_-]*$/);
      }
    }
  });
});
