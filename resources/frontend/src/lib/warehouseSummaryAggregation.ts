/**
 * Backend {@see InventoryValuationService::summarizeChannelLinkedLocations} stamps the same
 * channel-level totals onto every InventoryLocation row that belongs to that channel (a channel
 * can legitimately own more than one location row). Any naive sum across /warehouses/summary rows
 * therefore double-counts channels with >1 location. This is the single place that corrects for
 * it — every consumer of /warehouses/summary should dedupe through here before aggregating.
 */
export interface WarehouseSummaryRow {
  id: number | string;
  name?: string;
  type?: string;
  channel_id?: number | string | null;
  total_items?: number;
  total_quantity?: number;
  total_cost?: number;
  [key: string]: unknown;
}

/**
 * Collapses rows that share a non-null channel_id down to a single carrier of the (already
 * channel-level) stats, zeroing the rest. Rows are kept (not dropped) so location-keyed lookups
 * built from the raw response keep working — the duplicates just correctly read as zero instead
 * of re-adding the channel's total. Rows without a channel_id (physical warehouse buckets) are
 * untouched: those aren't stamped/duplicated by the backend.
 */
export function dedupeWarehouseSummaryRows<T extends WarehouseSummaryRow>(rows: T[]): T[] {
  const list = Array.isArray(rows) ? rows : [];
  const firstSeenIndexByChannel = new Map<string, number>();

  list.forEach((row, index) => {
    const channelId = row?.channel_id;
    if (channelId == null || channelId === '') return;
    const key = String(channelId);
    const existingIndex = firstSeenIndexByChannel.get(key);
    if (existingIndex == null || Number(row.id) < Number(list[existingIndex].id)) {
      firstSeenIndexByChannel.set(key, index);
    }
  });

  const keepIndexes = new Set(firstSeenIndexByChannel.values());

  return list.map((row, index) => {
    const channelId = row?.channel_id;
    const isDuplicateChannelRow = channelId != null && channelId !== '' && !keepIndexes.has(index);
    if (!isDuplicateChannelRow) return row;

    return {
      ...row,
      total_items: 0,
      total_quantity: 0,
      total_cost: 0,
    };
  });
}

export function sumWarehouseSummary(rows: WarehouseSummaryRow[]): {
  totalItems: number;
  totalQuantity: number;
  totalCost: number;
} {
  return dedupeWarehouseSummaryRows(rows).reduce(
    (acc, row) => ({
      totalItems: acc.totalItems + Number(row?.total_items || 0),
      totalQuantity: acc.totalQuantity + Number(row?.total_quantity || 0),
      totalCost: acc.totalCost + Number(row?.total_cost || 0),
    }),
    { totalItems: 0, totalQuantity: 0, totalCost: 0 }
  );
}
