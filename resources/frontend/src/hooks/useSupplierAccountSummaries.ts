import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export type SupplierAccountSummary = {
  total_purchases: number;
  total_paid: number;
  outstanding: number;
  invoice_count: number;
  avg_payment_days: number;
};

function fallbackSummary(balance?: number | null): SupplierAccountSummary {
  return {
    total_purchases: 0,
    total_paid: 0,
    outstanding: Number(balance ?? 0),
    invoice_count: 0,
    avg_payment_days: 0,
  };
}

/**
 * All supplier KPI blocks in one request (`suppliers/account-summaries`) — the same
 * figures as each `suppliers/:id/account-summary` → `summary`. One request per supplier
 * used to fill the server's worker pool (2026-11-23).
 */
async function fetchSupplierSummaries(
  params: Record<string, string>
): Promise<Record<string, SupplierAccountSummary>> {
  const data = await api.get('suppliers/account-summaries', { params });
  return (data?.summaries ?? {}) as Record<string, SupplierAccountSummary>;
}

export function useSupplierAccountSummaries(
  suppliers: { id: string | number; balance?: number | null }[] | undefined,
  options?: { startDate?: string; endDate?: string }
) {
  const startDate = options?.startDate ?? '';
  const endDate = options?.endDate ?? '';
  const params = startDate && endDate ? { start_date: startDate, end_date: endDate } : {};

  const list = (suppliers ?? []).filter(
    (s): s is NonNullable<typeof s> =>
      Boolean(s && s.id !== null && s.id !== undefined && String(s.id).trim() !== '')
  );

  const result = useQuery({
    queryKey: ['supplier-account-summary', 'all', startDate, endDate],
    queryFn: () => fetchSupplierSummaries(params),
    enabled: list.length > 0,
    staleTime: 2 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  const summaryMap: Record<string, SupplierAccountSummary> = {};
  list.forEach((s) => {
    const id = String(s.id);
    summaryMap[id] = result.data?.[id] ?? fallbackSummary(s.balance);
  });

  const summariesReady = list.length === 0 || !result.isLoading;

  return {
    summaryMap,
    summariesReady,
    setSummaryMap: (_: Record<string, SupplierAccountSummary>) => {},
  };
}
