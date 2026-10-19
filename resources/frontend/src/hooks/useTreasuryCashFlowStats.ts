import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { TreasuryStatsSlice } from '@/components/finance/TreasuryDashboard';

/**
 * Treasury position from the server ledger (CashFlowSummaryController).
 * estimated_balance = all receipts − (payments + expenses). Capital injections are already
 * receipts, so never add capital sources on top of this (that double-counts capital).
 *
 * Prefers lightweight /stats; falls back to full overview if the route is not deployed yet.
 */
export async function fetchTreasuryCashFlowStats(): Promise<{ stats: TreasuryStatsSlice }> {
  try {
    return await api.get<{ stats: TreasuryStatsSlice }>('finance/cash-flow-stats');
  } catch (primary) {
    try {
      const overview = await api.get<{ stats: TreasuryStatsSlice }>('finance/cash-flow-overview');
      if (!overview?.stats || typeof overview.stats !== 'object') {
        throw primary;
      }
      return { stats: overview.stats };
    } catch {
      throw primary;
    }
  }
}

export function useTreasuryCashFlowStats() {
  return useQuery({
    queryKey: ['finance-cash-flow-stats'],
    queryFn: fetchTreasuryCashFlowStats,
    staleTime: 30_000,
    retry: 1,
  });
}
