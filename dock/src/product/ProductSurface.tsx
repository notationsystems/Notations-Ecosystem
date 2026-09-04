import { useEffect, useState } from 'react';
import { TruthBadge } from '../components/Evidence';
import { Caravan } from './Caravan';
import { LANDSHARK, LineSurface, TRADEWIND } from './Mapping';
import { STANDING_LABEL, type CaravanSlice, type SurfaceStanding } from './types';

export type ProductId = 'caravan' | 'tradewind' | 'landshark';

export const PRODUCTS: ReadonlyArray<{ id: ProductId; name: string; standing: SurfaceStanding }> = [
  { id: 'caravan', name: 'Caravan', standing: 'reference_implementation' },
  { id: 'tradewind', name: 'Tradewind', standing: 'not_built' },
  { id: 'landshark', name: 'Landshark', standing: 'not_built' },
];

/**
 * The product surfaces of the Payload OS bundle.
 *
 * Payload OS is named in the frame because it is the layer these three sit on; it is never offered
 * as a fourth product. Each surface states its standing — reference implementation, verified release
 * candidate, deployed customer service, or not built — because a demo that blurs those is the
 * easiest lie a frontend can tell.
 */
export function ProductSurface({ product }: { product: ProductId }) {
  const [slice, setSlice] = useState<CaravanSlice | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${import.meta.env.BASE_URL}caravan-fixture.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`fixture responded ${r.status}`))))
      .then((data: CaravanSlice) => { if (live) setSlice(data); })
      .catch((e: Error) => { if (live) setFailed(e.message); });
    return () => { live = false; };
  }, []);

  const standing = PRODUCTS.find((p) => p.id === product)?.standing ?? 'not_built';

  if (failed) {
    return (
      <div className="product">
        <div className="notlive">
          <b>The slice did not load.</b>
          <div className="why">{failed} — nothing is shown rather than a surface that looks empty and complete.</div>
        </div>
      </div>
    );
  }
  if (!slice) return <div className="product"><p className="sub">Loading the slice…</p></div>;

  return (
    <div className="product-surface">
      <div className="product-head">
        <span className="os">Payload OS</span>
        <span className="sep">/</span>
        <b>{PRODUCTS.find((p) => p.id === product)?.name}</b>
        <span className={`standing standing-${standing}`}>{STANDING_LABEL[standing]}</span>
        {/* Only Caravan reads the slice as data. The other two borrow it for mapping counts, and
            saying they read a fixture would overstate what they show. */}
        {product === 'caravan' && slice.status === 'fixture' && <span className="standing standing-fixture" title={slice.not_a_service}>reading a shape fixture</span>}
      </div>
      {product === 'caravan' && slice.slice && (
        <div className="slice-id">
          <div className="frame-field"><span className="lbl">corridor</span><b>{slice.slice.corridor}</b></div>
          <div className="frame-field"><span className="lbl">mode</span><b>{slice.slice.mode}</b></div>
          <div className="frame-field"><span className="lbl">geography</span><b>{slice.slice.geography}</b></div>
          <div className="frame-field">
            <span className="lbl">basis</span>
            <span className="evidenced"><TruthBadge truth="VERIFIED_DERIVATION" /><span className="why">{slice.slice.evidence.basis}</span></span>
          </div>
          {/* Deciding what the slice is about is not holding records for it, and the surface says which. */}
          <div className="frame-field">
            <span className="lbl">records</span>
            <span className="evidenced"><TruthBadge truth="NOT_EVIDENCED" /><span className="why">{slice.slice.shipment_records.whyUnknown}</span></span>
          </div>
        </div>
      )}
      {product === 'caravan' && slice.why_no_corridor && (
        <p className="sub corridor-note">{slice.why_no_corridor}</p>
      )}
      {product === 'caravan' ? <Caravan slice={slice} /> : <LineSurface line={product === 'tradewind' ? TRADEWIND : LANDSHARK} slice={slice} />}
    </div>
  );
}
