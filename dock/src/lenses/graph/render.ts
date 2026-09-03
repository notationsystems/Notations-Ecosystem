/** Pure canvas/painting helpers for GraphLens (no React, no DOM bindings) so they can be unit-tested. */
import type { GraphLinkDatum, GraphNodeDatum } from '../../model/graph';
import { HEALTH_COLOR, KIND_LABEL, RELATION_COLOR, RELATION_LABEL } from '../../model/types';

/** Node radius in graph units: 4 + 3·√capabilities. */
export function nodeRadius(capabilities: number): number {
  return 4 + 3 * Math.sqrt(Math.max(0, capabilities));
}

export const DIM_ALPHA = 0.16;
export const LABEL_MIN_SCALE = 0.9;
const AMBER = '#f5b942';

export interface PaintOptions {
  selected: boolean;
  /** false when a focus neighbourhood is active and this node lies outside it. */
  inFocus: boolean;
}

/** Paints one node: kind-coloured disc, health ring (dashed when unknown), amber halo when selected, label below when zoomed in. */
export function paintNode(node: GraphNodeDatum & { x?: number; y?: number }, ctx: CanvasRenderingContext2D, scale: number, opts: PaintOptions): void {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const r = nodeRadius(node.capabilities);
  const px = 1 / scale; // one screen pixel in graph units
  ctx.save();
  ctx.globalAlpha = opts.inFocus ? 1 : DIM_ALPHA;

  if (opts.selected) {
    ctx.beginPath();
    ctx.arc(x, y, r + 6 * px, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(245, 185, 66, 0.22)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r + 6 * px, 0, 2 * Math.PI);
    ctx.lineWidth = 1 * px;
    ctx.strokeStyle = 'rgba(245, 185, 66, 0.9)';
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = node.color;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, r + 1.5 * px, 0, 2 * Math.PI);
  ctx.lineWidth = 2 * px;
  ctx.strokeStyle = HEALTH_COLOR[node.health] ?? HEALTH_COLOR.unknown;
  ctx.setLineDash(node.health === 'unknown' ? [3 * px, 2.5 * px] : []);
  ctx.stroke();
  ctx.setLineDash([]);

  if (scale > LABEL_MIN_SCALE) {
    ctx.font = `${opts.selected ? 600 : 500} ${11 * px}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3 * px;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(7, 9, 15, 0.85)';
    ctx.strokeText(node.name, x, y + r + 4 * px);
    ctx.fillStyle = opts.selected ? AMBER : '#e6e9ef';
    ctx.fillText(node.name, x, y + r + 4 * px);
  }
  ctx.restore();
}

/** Larger-than-visible pointer area so rings and labels are hoverable. */
export function paintPointerArea(node: GraphNodeDatum & { x?: number; y?: number }, color: string, ctx: CanvasRenderingContext2D, scale: number): void {
  ctx.beginPath();
  ctx.arc(node.x ?? 0, node.y ?? 0, nodeRadius(node.capabilities) + 3 / scale, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
}

/** Hex → rgba with alpha, for dimmed links. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m || !m[1]) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function linkColor(link: GraphLinkDatum, inFocus: boolean): string {
  const base = RELATION_COLOR[link.kind] ?? '#9AA5B1';
  return inFocus ? withAlpha(base, 0.75) : withAlpha(base, 0.08);
}

/** Endpoint id regardless of whether force-graph has replaced the id with the node object yet. */
export function endpointId(v: unknown): string {
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && 'id' in v) return String((v as { id: unknown }).id);
  return '';
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** HTML tooltip for a node (force-graph renders nodeLabel as innerHTML). */
export function nodeTooltip(node: GraphNodeDatum): string {
  const caps = `${node.capabilities} capabilit${node.capabilities === 1 ? 'y' : 'ies'}${node.executeCapabilities ? ` · ${node.executeCapabilities} execute` : ''}`;
  return `<div style="font:12px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e6e9ef;background:rgba(13,17,25,0.94);border:1px solid #1f2736;border-radius:6px;padding:6px 9px;line-height:1.4">`
    + `<div style="font-weight:600">${esc(node.name)}</div>`
    + `<div style="color:#8b94a5"><span style="color:${node.color}">●</span> ${esc(KIND_LABEL[node.kind] ?? node.kind)}</div>`
    + `<div style="color:#8b94a5;font-variant-numeric:tabular-nums">${caps}</div>`
    + `<div><span style="color:${HEALTH_COLOR[node.health] ?? HEALTH_COLOR.unknown}">◌</span> ${esc(node.health)}</div>`
    + `</div>`;
}

/** Small relation-kind label shown while hovering a link. */
export function linkTooltip(link: GraphLinkDatum): string {
  const color = RELATION_COLOR[link.kind] ?? '#9AA5B1';
  return `<span style="font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:${color};background:rgba(13,17,25,0.94);border:1px solid #1f2736;border-radius:4px;padding:2px 7px">${esc(RELATION_LABEL[link.kind] ?? link.kind)}</span>`;
}
