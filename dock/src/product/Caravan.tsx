import { Evidenced, ReleaseFrame, TruthBadge } from '../components/Evidence';
import { TRUTH, isUnknown } from '../model/truth';
import { coverage, unanswered } from './slice';
import type { CaravanSlice } from './types';

/**
 * The Caravan product surface: inspect a bounded logistics slice — party and site resolution,
 * movement lineage, and the exceptions that fall out of both.
 *
 * Read-only by construction. There is no affordance here that changes corpus, rights, release or
 * infrastructure state, because this surface has no authority to offer one.
 */
export function Caravan({ slice }: { slice: CaravanSlice }) {
  // Derived from the data, not read from the response's digest: an unknown the response forgot
  // to list still reaches the screen.
  const exceptions = unanswered(slice);
  const cover = coverage(slice);
  return (
    <div className="product">
      <ReleaseFrame
        fields={[
          { name: 'release', truth: slice.frame.release },
          { name: 'valid time', truth: slice.frame.valid_time },
          { name: 'knowledge time', truth: slice.frame.knowledge_time },
          { name: 'coverage', truth: slice.frame.coverage },
        ]}
      />

      {/* Exception-first: what could not be answered comes before what could. */}
      <section>
        <h3>Could not answer · {exceptions.length} of {cover.total}</h3>
        <p className="sub">
          Derived from the slice itself, not from the response's own list. {cover.answered} of {cover.total} values
          carry an answer; the rest say why they do not.
        </p>
        {exceptions.length === 0 ? (
          <p className="sub">Every value in this slice carries an answer.</p>
        ) : (
          <ul className="exceptions">
            {exceptions.map((e) => (
              <li key={e.path}>
                <TruthBadge truth={e.truthClass} />
                <span className="mono">{e.path}</span>
                <span className="why">{e.whyUnknown}</span>
                {e.detail?.length ? <span className="why-detail">{e.detail.join(' · ')}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>Parties · {slice.parties.length}</h3>
        <p className="sub">Resolution against the Payload OS <code>organization</code> spine. An identity the corpus cannot resolve is not resolved here.</p>
        {slice.parties.map((p) => (
          <div className="cap" key={p.id}>
            <div className="cap-head"><span className="mono">{p.id}</span><span className="badge">{p.role}</span></div>
            <Evidenced truth={p.resolution} render={(v) => <span className="mono">{v}</span>} label="resolves to" />
            {p.note ? <div className="sub">{p.note}</div> : null}
          </div>
        ))}
      </section>

      <section>
        <h3>Shipments · {slice.shipments.length}</h3>
        {slice.shipments.map((s) => (
          <div className="cap" key={s.id}>
            <div className="cap-head"><span className="mono">{s.id}</span></div>
            <div className="kv">
              <span>lot</span><b><Evidenced truth={s.lot} render={(v) => <span className="mono">{v}</span>} /></b>
              <span>commodity</span><b><Evidenced truth={s.commodity_reference} render={(v) => <span className="mono">{v}</span>} /></b>
              <span>destination</span><b><Evidenced truth={s.destination_site} render={(v) => <span className="mono">{v}</span>} /></b>
              <span>status</span><b><Evidenced truth={s.status} render={(v) => <span>{v}</span>} /></b>
            </div>
            {/* A pointer into another line is labelled as one; it carries no price and no entitlement. */}
            {s.mapping_note ? <div className="mapping">governed mapping · {s.mapping_note}</div> : null}
          </div>
        ))}
      </section>

      <section>
        <h3>Movement lineage · {slice.voyages.length}</h3>
        {slice.voyages.map((v) => (
          <div className="cap" key={v.id}>
            <div className="cap-head"><span className="mono">{v.id}</span></div>
            <Evidenced truth={v.position} render={(x) => <span>{x}</span>} label="position" />
            {v.milestones.length === 0 ? (
              <div className="sub">No milestone has been recorded against this voyage. That is an absence of observation, not an empty itinerary.</div>
            ) : (
              <ol className="lineage">
                {v.milestones.map((m) => (
                  <li key={m.id}>
                    <span className="badge">{m.kind}</span>
                    <Evidenced truth={m.at} render={(x) => <span className="mono">{x}</span>} />
                    {isUnknown(m.at) ? <span className="why">{TRUTH[m.at.class].means}</span> : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
