import type { TransferBatch } from '@/lib/transferBatchUtils';
import { getBatchEndpoints } from '@/lib/transferBatchUtils';

/** Dynamic lane id — typically `dest-{locationId}`. */
export type TransferLaneId = string;

export type TransferLaneKind = 'fba' | 'noon' | 'jumia' | 'other';

export interface TransferLane {
  id: TransferLaneId;
  titleAr: string;
  titleEn: string;
  shortAr: string;
  shortEn: string;
  accentClass: string;
  headerBgClass: string;
  /** large = FBA (busy) lanes; compact = Noon/Jumia/other */
  sizeTier: 'large' | 'compact';
  kind: TransferLaneKind;
  fromLocationIds: string[];
  toLocationIds: string[];
}

type LocLike = {
  id?: string | number;
  name?: string;
  type?: string;
  is_main?: boolean;
  channel_id?: string | number | null;
  channel?: { slug?: string; name?: string; type?: string } | null;
};

const normalize = (value: string) => String(value || '').trim().toLowerCase();

function locHaystack(loc: LocLike): string {
  const ch = loc.channel;
  return normalize(
    [loc.name, loc.type, ch?.slug, ch?.name, ch?.type].filter(Boolean).join(' ')
  );
}

export function isFbaLocation(loc: LocLike): boolean {
  const type = normalize(String(loc.type || ''));
  const hay = locHaystack(loc);
  return (
    type === 'amazon_fba' ||
    type.includes('fba') ||
    /\bfba\b/.test(hay) ||
    (hay.includes('amazon') && hay.includes('fba')) ||
    (hay.includes('امازون') && hay.includes('fba'))
  );
}

export function isNoonLocation(loc: LocLike): boolean {
  const hay = locHaystack(loc);
  return hay.includes('noon') || hay.includes('نون');
}

export function isJumiaLocation(loc: LocLike): boolean {
  const hay = locHaystack(loc);
  return hay.includes('jumia') || hay.includes('جوميا');
}

/**
 * Shop / main-store style locations (transfer source).
 * Excludes FBA / Noon / Jumia destinations even if the name contains "store".
 */
export function isShopLocation(loc: LocLike): boolean {
  if (isFbaLocation(loc) || isNoonLocation(loc) || isJumiaLocation(loc)) {
    return false;
  }
  const type = normalize(String(loc.type || ''));
  const hay = locHaystack(loc);
  if (
    type === 'store' ||
    type === 'warehouse' ||
    type === 'main' ||
    type === 'shop' ||
    type === 'physical'
  ) {
    return true;
  }
  return /محل/.test(hay) || /\bshop\b/.test(hay) || /\bstore\b/.test(hay);
}

/** Destinations that get their own transfer-lane column. */
export function isTransferLaneDestination(loc: LocLike): boolean {
  return isFbaLocation(loc) || isNoonLocation(loc) || isJumiaLocation(loc);
}

function classifyDestinationKind(loc: LocLike): TransferLaneKind {
  if (isFbaLocation(loc)) return 'fba';
  if (isNoonLocation(loc)) return 'noon';
  if (isJumiaLocation(loc)) return 'jumia';
  return 'other';
}

const KIND_STYLE: Record<
  TransferLaneKind,
  { accentClass: string; headerBgClass: string; sizeTier: 'large' | 'compact' }
> = {
  fba: {
    accentClass: 'border-t-orange-500',
    headerBgClass: 'bg-orange-500/10',
    sizeTier: 'large',
  },
  noon: {
    accentClass: 'border-t-amber-500',
    headerBgClass: 'bg-amber-500/10',
    sizeTier: 'compact',
  },
  jumia: {
    accentClass: 'border-t-sky-500',
    headerBgClass: 'bg-sky-500/10',
    sizeTier: 'compact',
  },
  other: {
    accentClass: 'border-t-slate-500',
    headerBgClass: 'bg-slate-500/10',
    sizeTier: 'compact',
  },
};

const FBA_ACCENT_ROTATION = [
  { accentClass: 'border-t-orange-500', headerBgClass: 'bg-orange-500/10' },
  { accentClass: 'border-t-violet-500', headerBgClass: 'bg-violet-500/10' },
  { accentClass: 'border-t-rose-500', headerBgClass: 'bg-rose-500/10' },
] as const;

function pickShopLabel(shops: LocLike[]): string {
  if (shops.length === 0) return '';
  const main = shops.find((s) => s.is_main) || shops[0];
  return String(main?.name || '').trim();
}

function kindSortKey(kind: TransferLaneKind): number {
  if (kind === 'fba') return 0;
  if (kind === 'noon') return 1;
  if (kind === 'jumia') return 2;
  return 3;
}

/**
 * Build transfer-lane columns from the logged-in user's warehouses.
 * Titles use real location names (e.g. "المحل → امازون فيزيولاين FBA").
 */
export function buildTransferLanes(locations: LocLike[]): TransferLane[] {
  const list = (locations || []).filter((loc) => loc?.id != null);
  const shops = list.filter(isShopLocation);
  const destinations = list.filter(isTransferLaneDestination);

  const shopIds = shops.map((s) => String(s.id));
  const shopLabel = pickShopLabel(shops);
  const shopLabelAr = shopLabel || 'المحل';
  const shopLabelEn = shopLabel || 'Shop';

  // Prefer known channel destinations; still include other non-shop warehouses.
  const rankedDests = [...destinations].sort((a, b) => {
    const ka = kindSortKey(classifyDestinationKind(a));
    const kb = kindSortKey(classifyDestinationKind(b));
    if (ka !== kb) return ka - kb;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
  });

  let fbaIndex = 0;
  return rankedDests.map((dest) => {
    const kind = classifyDestinationKind(dest);
    const baseStyle = KIND_STYLE[kind];
    let accentClass = baseStyle.accentClass;
    let headerBgClass = baseStyle.headerBgClass;
    if (kind === 'fba') {
      const rot = FBA_ACCENT_ROTATION[fbaIndex % FBA_ACCENT_ROTATION.length];
      accentClass = rot.accentClass;
      headerBgClass = rot.headerBgClass;
      fbaIndex += 1;
    }

    const destName = String(dest.name || '').trim() || `Location #${dest.id}`;
    const titleAr = `${shopLabelAr} → ${destName}`;
    const titleEn = `${shopLabelEn} → ${destName}`;

    return {
      id: `dest-${dest.id}`,
      titleAr,
      titleEn,
      shortAr: destName,
      shortEn: destName,
      accentClass,
      headerBgClass,
      sizeTier: baseStyle.sizeTier,
      kind,
      fromLocationIds: shopIds,
      toLocationIds: [String(dest.id)],
    };
  });
}

/**
 * @deprecated Prefer {@link buildTransferLanes}.
 */
export const TRANSFER_LANES: TransferLane[] = [];

export function batchBelongsToLane(
  batch: TransferBatch,
  lane: TransferLane,
  resolveLocationName: (id: string) => string,
): boolean {
  const { fromId, toId } = getBatchEndpoints(batch, resolveLocationName);
  const from = String(fromId || '');
  const to = String(toId || '');

  const fromOk =
    lane.fromLocationIds.length === 0
      ? true
      : Boolean(from && lane.fromLocationIds.includes(from));
  const toOk = Boolean(to && lane.toLocationIds.includes(to));

  return fromOk && toOk;
}

export function groupBatchesByLane(
  batches: TransferBatch[],
  lanes: TransferLane[],
  resolveLocationName: (id: string) => string,
): Record<string, TransferBatch[]> {
  const grouped: Record<string, TransferBatch[]> = Object.fromEntries(
    lanes.map((lane) => [lane.id, [] as TransferBatch[]])
  );

  for (const batch of batches) {
    for (const lane of lanes) {
      if (batchBelongsToLane(batch, lane, resolveLocationName)) {
        grouped[lane.id].push(batch);
        break;
      }
    }
  }

  return grouped;
}

export function getUnassignedBatches(
  batches: TransferBatch[],
  lanes: TransferLane[],
  resolveLocationName: (id: string) => string,
): TransferBatch[] {
  const assignedKeys = new Set<string>();
  const grouped = groupBatchesByLane(batches, lanes, resolveLocationName);
  for (const lane of lanes) {
    for (const batch of grouped[lane.id] || []) {
      assignedKeys.add(batch.key);
    }
  }
  return batches.filter((batch) => !assignedKeys.has(batch.key));
}
