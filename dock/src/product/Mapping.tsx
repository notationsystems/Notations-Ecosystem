import { TruthBadge } from '../components/Evidence';
import type { CaravanSlice } from './types';

/**
 * Tradewind and Landshark, as typed mapping views.
 *
 * Neither line has an implementing node, a source, a release, a rights profile or a customer
 * service. So neither gets a data surface here. What they get is the shape they will take and the
 * one declared join that connects them to Caravan — rendered as a governed mapping, which is a
 * statement about keys and nothing else.
 *
 * A governed mapping never merges identities, never suggests causal or commercial authority, and
 * never infers market price from movement, delivery from market data, or land entitlement from
 * either.
 */

export interface LineShell {
  id: 'tradewind' | 'landshark';
  name: string;
  job: string;
  notTheJob: readonly string[];
  objectClasses: readonly string[];
  owns: readonly string[];
  /** Why this surface has no data in it. Shown, not hidden. */
  whyNotLive: string;
}

export const TRADEWIND: LineShell = {
  id: 'tradewind',
  name: 'Tradewind',
  job: 'Price and risk.',
  notTheJob: [
    'Tracking a truck — that is Caravan’s object; Tradewind holds a voyage reference, not a milestone stream.',
    'A prediction-market venue. Prediction markets are a source class under this line, admitted only where an event resolves against an object the estate already owns.',
  ],
  objectClasses: ['instrument', 'contract', 'curve', 'print', 'position', 'event_market'],
  owns: ['commodity', 'contract.derivative'],
  whyNotLive: 'Tradewind is defined, not built: zero implementing nodes, no admitted source, no release, and no rights profile confirmed for any market feed. Showing prices here would be inventing them.',
};

export const LANDSHARK: LineShell = {
  id: 'landshark',
  name: 'Landshark',
  job: 'Land as a legal and development object.',
  notTheJob: [
    'Clash detection in Revit. Engineers are users of survey and plan objects here; they are not the BIM customer.',
    'A listings portal. A listing is a dated observation attached to a parcel, never the product.',
  ],
  objectClasses: ['parcel', 'zone', 'survey', 'plan', 'entitlement', 'listing_lease'],
  owns: ['site', 'contract.lease'],
  whyNotLive: 'Landshark is defined, not built: zero implementing nodes and no admitted register or planning instrument. Showing an entitlement here would imply a legal position nothing evidences.',
};

/** The one declared cross-line join, drawn as keys rather than as a claim about the world. */
export function GovernedMapping({ slice }: { slice: CaravanSlice }) {
  const commodityRefs = slice.shipments.filter((s) => s.commodity_reference.class === 'CANONICAL_PROOF').length;
  const siteRefs = slice.shipments.filter((s) => s.destination_site.class === 'CANONICAL_PROOF').length;
  return (
    <section>
      <h3>Governed mapping</h3>
      <p className="sub">
        A relationship between keys, declared and checked. It is not authority: Tradewind does not
        price this movement, and Landshark does not entitle its destination.
      </p>
      <figure className="join" role="img" aria-label="Tradewind contract joins to a Caravan voyage on commodity id, and that voyage joins to a Landshark parcel on site id.">
        <svg viewBox="0 0 640 96" style={{ maxWidth: '100%', height: 'auto' }}>
          <defs>
            <marker id="mapping-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          <g fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="8" y="30" width="150" height="36" rx="4" />
            <rect x="245" y="30" width="150" height="36" rx="4" />
            <rect x="482" y="30" width="150" height="36" rx="4" />
            <line x1="158" y1="48" x2="238" y2="48" markerEnd="url(#mapping-arrow)" />
            <line x1="395" y1="48" x2="475" y2="48" markerEnd="url(#mapping-arrow)" />
          </g>
          <g fill="currentColor" fontSize="11" textAnchor="middle" fontFamily="ui-monospace, monospace">
            <text x="83" y="52">tradewind.contract</text>
            <text x="320" y="52">caravan.voyage</text>
            <text x="557" y="52">landshark.parcel</text>
            <text x="198" y="40" fontSize="10">commodity_id</text>
            <text x="435" y="40" fontSize="10">site_id</text>
          </g>
          <g fill="currentColor" fontSize="10" textAnchor="middle" opacity="0.65">
            <text x="83" y="84">not built</text>
            <text x="320" y="84">building</text>
            <text x="557" y="84">not built</text>
          </g>
        </svg>
        <figcaption className="sub">
          Both hops are checked against declared class keys by <code>node ecosystem/product-lines.mjs</code>.
          A hop whose key is absent from either end fails LINE-005 rather than being drawn anyway.
        </figcaption>
      </figure>
      <div className="kv">
        <span>commodity references in this slice</span><b>{commodityRefs} of {slice.shipments.length}</b>
        <span>site references in this slice</span><b>{siteRefs} of {slice.shipments.length}</b>
      </div>
      <p className="sub">
        A reference is a pointer. Caravan holds a <code>commodity_id</code> and no curve, and a
        <code> site_id</code> and no by-law.
      </p>
    </section>
  );
}

export function LineSurface({ line, slice }: { line: LineShell; slice: CaravanSlice }) {
  return (
    <div className="product">
      <div className="notlive">
        <TruthBadge truth="NOT_EVIDENCED" title={line.whyNotLive} />
        <div>
          <b>{line.name} is a product shell, not a service.</b>
          <div className="why">{line.whyNotLive}</div>
        </div>
      </div>

      <section>
        <h3>The job</h3>
        <p>{line.job}</p>
        <h3>Not the job</h3>
        <ul className="exceptions">{line.notTheJob.map((n) => <li key={n}><span className="why">{n}</span></li>)}</ul>
      </section>

      <section>
        <h3>Object classes · {line.objectClasses.length}</h3>
        <div className="chips">{line.objectClasses.map((c) => <span className="badge" key={c}>{c}</span>)}</div>
        <h3>Owns on the spine</h3>
        <div className="chips">{line.owns.map((c) => <span className="badge" key={c}>{c}</span>)}</div>
        <p className="sub">Every other spine type is held as a reference. One line defines a type; the others point at it.</p>
      </section>

      <GovernedMapping slice={slice} />
    </div>
  );
}
