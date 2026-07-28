import type { TransferBatch } from '@/lib/transferBatchUtils';
import { getBatchEndpoints } from '@/lib/transferBatchUtils';

export type TransferLaneId = 'fba-phyzioline' | 'art-fba' | 'noon' | 'jumia';

export interface TransferLane {
  id: TransferLaneId;
  titleAr: string;
  titleEn: string;
  shortAr: string;
  shortEn: string;
  accentClass: string;
  headerBgClass: string;
  /** large = FBA lanes with many transfers; compact = Noon/Jumia */
  sizeTier: 'large' | 'compact';
  matchesFrom: (name: string) => boolean;
  matchesTo: (name: string) => boolean;
}

const normalize = (value: string) => String(value || '').trim().toLowerCase();

export const isShopLocationName = (name: string) => {
  const n = normalize(name);
  return /محل/.test(n) || n === 'shop' || n.includes('store');
};

export const TRANSFER_LANES: TransferLane[] = [
  {
    id: 'fba-phyzioline',
    titleAr: 'محل → امازون فيزيولاين FBA',
    titleEn: 'Shop → FBA Phyzioline',
    shortAr: 'FBA Phyzioline',
    shortEn: 'FBA Phyzioline',
    accentClass: 'border-t-orange-500',
    headerBgClass: 'bg-orange-500/10',
    sizeTier: 'large',
    matchesFrom: isShopLocationName,
    matchesTo: (name) => {
      const n = normalize(name);
      return (n.includes('فيزيول') || n.includes('phyziol')) && n.includes('fba');
    },
  },
  {
    id: 'art-fba',
    titleAr: 'محل → ارت FBA',
    titleEn: 'Shop → Art FBA',
    shortAr: 'ارت FBA',
    shortEn: 'Art FBA',
    accentClass: 'border-t-violet-500',
    headerBgClass: 'bg-violet-500/10',
    sizeTier: 'large',
    matchesFrom: isShopLocationName,
    matchesTo: (name) => {
      const n = normalize(name);
      if (n.includes('فيزيول') || n.includes('phyziol')) return false;
      return (n.includes('ارت') || n.includes('art')) && n.includes('fba');
    },
  },
  {
    id: 'noon',
    titleAr: 'محل → نون',
    titleEn: 'Shop → Noon',
    shortAr: 'نون',
    shortEn: 'Noon',
    accentClass: 'border-t-amber-500',
    headerBgClass: 'bg-amber-500/10',
    sizeTier: 'compact',
    matchesFrom: isShopLocationName,
    matchesTo: (name) => {
      const n = normalize(name);
      return n.includes('نون') || n.includes('noon');
    },
  },
  {
    id: 'jumia',
    titleAr: 'محل → جوميا',
    titleEn: 'Shop → Jumia',
    shortAr: 'جوميا',
    shortEn: 'Jumia',
    accentClass: 'border-t-sky-500',
    headerBgClass: 'bg-sky-500/10',
    sizeTier: 'compact',
    matchesFrom: isShopLocationName,
    matchesTo: (name) => {
      const n = normalize(name);
      return n.includes('جوميا') || n.includes('jumia');
    },
  },
];

export function buildLaneLocationIds(
  locations: any[],
  matcher: (name: string) => boolean,
): Set<string> {
  const ids = new Set<string>();
  for (const loc of locations || []) {
    if (loc?.id == null) continue;
    if (matcher(String(loc.name || ''))) {
      ids.add(String(loc.id));
    }
  }
  return ids;
}

export function batchBelongsToLane(
  batch: TransferBatch,
  lane: TransferLane,
  shopLocationIds: Set<string>,
  destinationLocationIds: Set<string>,
  resolveLocationName: (id: string) => string,
): boolean {
  const { fromName, toName, fromId, toId } = getBatchEndpoints(batch, resolveLocationName);

  const fromOk =
    (fromId && shopLocationIds.has(fromId)) || lane.matchesFrom(fromName);
  const toOk =
    (toId && destinationLocationIds.has(toId)) || lane.matchesTo(toName);

  return fromOk && toOk;
}

export function groupBatchesByLane(
  batches: TransferBatch[],
  locations: any[],
  resolveLocationName: (id: string) => string,
): Record<TransferLaneId, TransferBatch[]> {
  const shopIds = buildLaneLocationIds(locations, isShopLocationName);
  const grouped = Object.fromEntries(
    TRANSFER_LANES.map((lane) => [lane.id, [] as TransferBatch[]]),
  ) as Record<TransferLaneId, TransferBatch[]>;

  for (const batch of batches) {
    for (const lane of TRANSFER_LANES) {
      const destIds = buildLaneLocationIds(locations, lane.matchesTo);
      if (batchBelongsToLane(batch, lane, shopIds, destIds, resolveLocationName)) {
        grouped[lane.id].push(batch);
        break;
      }
    }
  }

  return grouped;
}
