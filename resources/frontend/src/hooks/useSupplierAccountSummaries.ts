import { useQueries } from '@tanstack/react-query';
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

async function fetchSupplierSummary(
  id: string | number,
  params: Record<string, string>
): Promise<SupplierAccountSummary> {
  const data = await api.get(`suppliers/${id}/account-summary`, { params });
  return data.summary as SupplierAccountSummary;
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

  const results = useQueries({
    queries: list.map((s) => ({
      queryKey: ['supplier-account-summary', String(s.id), startDate, endDate],
      queryFn: () => fetchSupplierSummary(s.id, params),
      staleTime: 2 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      placeholderData: fallbackSummary(s.balance),
      retry: 1,
    })),
  });

  const summaryMap: Record<string, SupplierAccountSummary> = {};
  results.forEach((result, i) => {
    const id = String(list[i].id);
    summaryMap[id] = (result.data as SupplierAccountSummary) ?? fallbackSummary(list[i].balance);
  });

  const summariesReady = list.length === 0 || results.every((r) => !r.isLoading);

  return {
    summaryMap,
    summariesReady,
    setSummaryMap: (_: Record<string, SupplierAccountSummary>) => {},
  };
}
