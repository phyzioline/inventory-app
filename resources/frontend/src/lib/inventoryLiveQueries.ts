import type { QueryClient } from '@tanstack/react-query';
import { broadcastInventoryCatalogUpdated } from '@/lib/inventoryCatalogBroadcast';

/**
 * React Query roots that show stock / channel KPI / listing data.
 * Keep in sync with useInventoryRealtime invalidation.
 */
export const INVENTORY_LIVE_QUERY_PREFIXES = [
  'warehouses-summary',
  'warehouses',
  'channel-skus',
  'channel-sku-summary',
  'channel-by-slug',
  'channels-metrics',
  'channels-all-skus-metrics',
  'master-products',
  'all-skus-lookup',
  'dashboard-metrics',
  'inventory-by-location',
  'inventory',
  'skus',
  'purchases-summary-by-location',
  'stock-movements',
  'transfers',
  'transactions',
] as const;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastInvalidateAt = 0;

type InvalidateOptions = {
  scope?: string;
  /** Skip debounce (local mutation just finished). */
  immediate?: boolean;
  /**
   * Also notify other browser tabs via BroadcastChannel.
   * Must be false inside realtime / BroadcastChannel listeners to avoid loops.
   */
  broadcast?: boolean;
};

export function invalidateInventoryLiveQueries(
  queryClient: QueryClient,
  options?: InvalidateOptions
): void {
  const shouldBroadcast = options?.broadcast !== false;

  const run = () => {
    lastInvalidateAt = Date.now();
    for (const key of INVENTORY_LIVE_QUERY_PREFIXES) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
    if (shouldBroadcast) {
      broadcastInventoryCatalogUpdated(options?.scope ?? 'stock');
    }
  };

  if (options?.immediate) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    run();
    return;
  }

  // Batch imports fire many stock.updated events — coalesce into one refetch wave.
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (Date.now() - lastInvalidateAt < 350) {
      return;
    }
    run();
  }, 700);
}
