import type { Truth } from '../model/truth';

/**
 * The Caravan tenant-read shape, as the shell consumes it.
 *
 * Every consequential field is a `Truth`, not a bare value. That is the whole point: a shell built
 * against bare values learns to expect data that does not exist, and then renders a zero the first
 * time production hands it an unknown.
 */
export interface CaravanFrame {
  release: Truth<string>;
  valid_time: Truth<string>;
  knowledge_time: Truth<string>;
  coverage: Truth<string>;
}

export interface CaravanParty {
  id: string;
  role: string;
  resolution: Truth<string>;
  note?: string;
}

export interface CaravanShipment {
  id: string;
  lot: Truth<string>;
  commodity_reference: Truth<string>;
  destination_site: Truth<string>;
  status: Truth<string>;
  mapping_note?: string;
}

export interface CaravanMilestone {
  id: string;
  kind: string;
  at: Truth<string>;
}

export interface CaravanVoyage {
  id: string;
  position: Truth<string>;
  milestones: CaravanMilestone[];
}

export interface CaravanException {
  subject: string;
  why: string;
  truth_class: string;
}

export interface CaravanSlice {
  schema: string;
  status: 'fixture' | 'release_candidate' | 'service';
  not_a_service?: string;
  why_no_corridor?: string;
  frame: CaravanFrame;
  parties: CaravanParty[];
  shipments: CaravanShipment[];
  voyages: CaravanVoyage[];
  exceptions: CaravanException[];
}

/** What a surface is: the distinction the estate refuses to let a demo blur. */
export type SurfaceStanding = 'reference_implementation' | 'release_candidate' | 'deployed_service' | 'not_built';

export const STANDING_LABEL: Record<SurfaceStanding, string> = {
  reference_implementation: 'reference implementation',
  release_candidate: 'verified release candidate',
  deployed_service: 'deployed customer service',
  not_built: 'not built',
};
