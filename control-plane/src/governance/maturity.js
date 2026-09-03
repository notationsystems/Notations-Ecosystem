/** Explicitly distinguish deployed capabilities from research and design intent. */

export const CAPABILITY_MATURITIES = Object.freeze([
  'production',
  'beta',
  'experimental',
  'research',
  'planned',
]);

export const CAPABILITY_MATURITY_SET = new Set(CAPABILITY_MATURITIES);

export function maturityOrResearch(value) {
  if (value === undefined) return 'research';
  if (typeof value !== 'string' || !CAPABILITY_MATURITY_SET.has(value)) {
    throw new Error('Capability maturity must be production, beta, experimental, research, or planned.');
  }
  return value;
}
