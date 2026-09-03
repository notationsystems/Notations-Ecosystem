import { useMemo, useState } from 'react';
import type { LensProps } from './types';
import {
  CORPUS_GRADE_COLOR,
  CORPUS_ROLE_LABEL,
  CORPUS_ROLE_ORDER,
  PERSON_DATA_COLOR,
  PERSON_DATA_LABEL,
  PERSON_DATA_ORDER,
  collectionStanding,
  corpusStanding,
  type CorpusRole,
  type PersonDataStanding,
  type SnapshotNode,
} from '../model/types';

/**
 * Corpus standing across the estate.
 *
 * The security constellation answers "can this be trusted to hold what it holds?".
 * This answers the other half: "is what it holds worth anything?" — the ten invariants
 * of docs/CORPUS.md, graded per node and grouped by the part each node plays in the
 * programme rather than by its deployment shape.
 *
 * Everything here comes from derived metadata the seed writes (`corpus_role`,
 * `corpus_grade`, `corpus_coverage`, `corpus_fails`). The declarations themselves, and
 * the evidence paths that justify them, stay in the catalog and never cross into the
 * journal — so this lens can show an operator where the programme is weak without the
 * browser holding a map of where to look.
 *
 * The estate's collection policy rides alongside, because it is the same kind of claim:
 * a declaration a node makes about itself, checkable against what it holds. A node that
 * answers questions about people is visible here rather than discoverable only by
 * reading thirty catalog files — which is the difference between a policy and a
 * paragraph.
 */

const GRADE_ORDER = ['unsound', 'bare', 'developing', 'sound', 'unbuilt', 'n/a', 'undeclared'];

function gradeRank(grade: string): number {
  const at = GRADE_ORDER.indexOf(grade);
  return at < 0 ? GRADE_ORDER.length : at;
}

function Coverage({ value, applicable }: { value: number | null; applicable: number | null }) {
  if (value === null) return <span className="sec-coverage empty">not graded</span>;
  // The denominator is shown, never implied: a projection exempt from seven invariants
  // earns the same word on three that a hold earns on ten, and they are not the same claim.
  return (
    <span className="sec-coverage" title={`${Math.round(value * 100)}% of the ${applicable ?? '?'} invariants that apply to this node are held`}>
      <span className="bar">
        <span className="fill" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      {Math.round(value * 100)}% of {applicable ?? '?'}
    </span>
  );
}

export function CorpusLens({ filtered, selected, onSelect }: LensProps) {
  const [role, setRole] = useState<CorpusRole | null>(null);
  const [collection, setCollection] = useState<PersonDataStanding | null>(null);

  const graded = useMemo(
    () =>
      filtered.nodes
        .map((node) => ({ node, standing: corpusStanding(node), collection: collectionStanding(node) }))
        .filter(
          (entry): entry is {
            node: SnapshotNode;
            standing: NonNullable<ReturnType<typeof corpusStanding>>;
            collection: ReturnType<typeof collectionStanding>;
          } => entry.standing !== null,
        ),
    [filtered.nodes],
  );

  const byRole = useMemo(() => {
    const groups = new Map<CorpusRole | 'unassigned', typeof graded>();
    for (const entry of graded) {
      const key = entry.standing.role ?? 'unassigned';
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => gradeRank(a.standing.grade) - gradeRank(b.standing.grade) || a.node.nodeId.localeCompare(b.node.nodeId));
    }
    return groups;
  }, [graded]);

  const withCoverage = graded.filter((entry) => entry.standing.coverage !== null);
  const mean = withCoverage.length
    ? Math.round((withCoverage.reduce((sum, entry) => sum + (entry.standing.coverage ?? 0), 0) / withCoverage.length) * 100)
    : null;
  const unsound = graded.filter((entry) => entry.standing.grade === 'unsound');
  const holders = graded.filter((entry) => entry.standing.role === 'hold');
  // Holding a corpus and owning a domain's canonical state are different claims, and
  // COR-002 is about the second: exactly one owner per domain.
  const owners = graded.filter((entry) => entry.standing.ownerOf.length);
  // A node that serves person data and cannot say what would end that is the one case
  // the policy calls a defect rather than a choice; the estate's two are both declared.
  const serving = graded.filter((entry) => entry.collection?.standing === 'serves');
  const undeclaredCollection = graded.filter((entry) => entry.collection === null);
  const byCollection = (value: PersonDataStanding) => graded.filter((entry) => entry.collection?.standing === value);

  const inRole = role ? [...(byRole.get(role) ?? [])] : graded.slice().sort((a, b) => gradeRank(a.standing.grade) - gradeRank(b.standing.grade) || a.node.nodeId.localeCompare(b.node.nodeId));
  const shown = collection ? inRole.filter((entry) => entry.collection?.standing === collection) : inRole;

  if (!graded.length) {
    return (
      <div className="lens scroll">
        <p className="empty-note">
          No node in this snapshot declares a corpus standing. Standing is derived from the catalog by
          <code> ecosystem/corpus.mjs</code> and seeded as node metadata; a journal written before that
          existed carries none.
        </p>
      </div>
    );
  }

  return (
    <div className="lens scroll">
      <div className="strip">
        <div className="kpi">
          <span>graded nodes</span>
          <b>
            {graded.length} / {filtered.nodes.length}
          </b>
        </div>
        <div className="kpi">
          <span>corpus holders</span>
          <b>{holders.length}</b>
        </div>
        <div className="kpi">
          <span>canonical-state owners</span>
          <b title={owners.map((entry) => `${entry.node.nodeId}: ${entry.standing.ownerOf.join(', ')}`).join('\n')}>{owners.length}</b>
        </div>
        <div className="kpi">
          <span>mean coverage</span>
          <b>{mean === null ? '—' : `${mean}%`}</b>
        </div>
        <div className="kpi">
          <span>declared failures</span>
          <b>{graded.reduce((sum, entry) => sum + entry.standing.fails.length, 0)}</b>
        </div>
        <div className="kpi">
          <span>unassessed</span>
          <b>{graded.reduce((sum, entry) => sum + entry.standing.unknown.length, 0)}</b>
        </div>
        <div className="kpi">
          <span>unsound</span>
          <b style={{ color: unsound.length ? CORPUS_GRADE_COLOR.unsound : undefined }}>{unsound.length}</b>
        </div>
        <div className="kpi">
          <span>serves person data</span>
          <b
            style={{ color: serving.length ? PERSON_DATA_COLOR.serves : undefined }}
            title={
              serving.length
                ? serving.map((entry) => `${entry.node.nodeId}: ${entry.collection?.exception ?? 'no exception declared'}`).join('\n\n')
                : 'No node in this snapshot answers questions about identifiable people.'
            }
          >
            {serving.length}
          </b>
        </div>
        <div style={{ marginLeft: 'auto', maxWidth: 470, textAlign: 'right', color: 'var(--muted)', fontSize: 11 }}>
          A node that owns canonical state but cannot show provenance, typed refusal or an admission
          boundary is <b>unsound</b> whatever its coverage — a different category, not a low score.
        </div>
      </div>

      <div className="corpus-roles">
        <button type="button" className={`tab ${role === null ? 'active' : ''}`} onClick={() => setRole(null)}>
          all roles ({graded.length})
        </button>
        {CORPUS_ROLE_ORDER.map((id) => {
          const count = (byRole.get(id) ?? []).length;
          if (!count) return null;
          return (
            <button key={id} type="button" className={`tab ${role === id ? 'active' : ''}`} onClick={() => setRole(role === id ? null : id)} title={CORPUS_ROLE_LABEL[id]}>
              {id} ({count})
            </button>
          );
        })}
        <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)', margin: '0 4px' }} />
        {PERSON_DATA_ORDER.map((value) => {
          const count = byCollection(value).length;
          if (!count) return null;
          return (
            <button
              key={value}
              type="button"
              className={`tab ${collection === value ? 'active' : ''}`}
              onClick={() => setCollection(collection === value ? null : value)}
              title={PERSON_DATA_LABEL[value]}
              style={{ borderColor: collection === value ? PERSON_DATA_COLOR[value] : undefined }}
            >
              {value} ({count})
            </button>
          );
        })}
        {undeclaredCollection.length > 0 && (
          <span className="tab" title="Seeded before the collection policy existed. Read as a gap, never as a refusal.">
            collection undeclared ({undeclaredCollection.length})
          </span>
        )}
      </div>

      <div className="sec-grid" style={{ marginTop: 12 }}>
        {shown.map(({ node, standing, collection: person }) => (
          <button
            key={node.nodeId}
            type="button"
            className={`sec-card ${selected === node.nodeId ? 'active' : ''} ${standing.grade === 'unbuilt' ? 'empty' : ''}`}
            style={{ borderLeftColor: CORPUS_GRADE_COLOR[standing.grade] ?? 'var(--line)' }}
            onClick={() => onSelect(selected === node.nodeId ? null : node.nodeId)}
          >
            <span className="sec-head">
              <span className="sec-dot" style={{ background: CORPUS_GRADE_COLOR[standing.grade] ?? 'var(--line)' }} />
              {node.name}
            </span>
            <span className="sec-meta">
              <span className="sec-state">{standing.grade}</span>
              <span title={standing.ownerOf.length ? `Owns the canonical state of: ${standing.ownerOf.join(', ')}` : undefined}>
                {standing.ownerOf.length ? `Owns ${standing.ownerOf.join(', ')}` : standing.role ? CORPUS_ROLE_LABEL[standing.role] : 'role undeclared'}
              </span>
            </span>
            <span className="sec-meta">
              <Coverage value={standing.coverage} applicable={standing.applicable} />
              {person && person.standing !== 'refused' && (
                <span
                  className="badge"
                  style={{ borderColor: PERSON_DATA_COLOR[person.standing], color: PERSON_DATA_COLOR[person.standing] }}
                  title={person.exception ?? PERSON_DATA_LABEL[person.standing]}
                >
                  {person.standing === 'serves' ? 'serves people' : 'people incidental'}
                </span>
              )}
            </span>
            {standing.fails.length || standing.unknown.length ? (
              <span className="sec-findings">
                {standing.fails.map((id) => (
                  <span key={id} className="sec-count high" title="Declared not held. Naming a failure is the point; silence would be worse.">
                    {id}
                  </span>
                ))}
                {standing.unknown.map((id) => (
                  <span key={id} className="sec-count medium" title="Not yet assessed. Counts against the node — silence is not assent.">
                    {id}?
                  </span>
                ))}
              </span>
            ) : (
              <span className="sec-findings none">every applicable invariant held</span>
            )}
          </button>
        ))}
      </div>

      <p className="empty-note" style={{ marginTop: 14 }}>
        Ten invariants, five roles, four standings — <code>docs/CORPUS.md</code>. A role decides which
        invariants apply: a projection holds nothing to be provenant about and is exempt from seven of
        them, but is bound absolutely by the one that says it must never write back. Exemption is
        structural and is not the same as failure; “not built yet” is a failure.
      </p>
      <p className="empty-note" style={{ marginTop: 6 }}>
        The collection standing beside each grade is the estate's policy —
        <code> docs/COLLECTION_POLICY.md</code> — not one repository's CI rule. Refusing person data is
        a property of what a system is for; a node that answers questions about people must name the
        exception and what would end it, and the same fact is recorded as its <code>COR-010</code>
        failure rather than left to two places to disagree about.
      </p>
    </div>
  );
}
