import { useQueries } from '@tanstack/react-query';
import api from '@/lib/api';

export type CustomerAccountSummary = {
  total_sales: number;
  total_received: number;
  outstanding: number;
  invoice_count: number;
  avg_collection_days: number;
};

function fallbackSummary(balance?: number | null): CustomerAccountSummary {
  return {
    total_sales: 0,
    total_received: 0,
    outstanding: Number(balance ?? 0),
    invoice_count: 0,
    avg_collection_days: 0,
  };
}

async function fetchCustomerSummary(
  id: string | number,
  params: Record<string, string>
): Promise<CustomerAccountSummary> {
  const data = await api.get(`customers/${id}/account-summary`, { params });
  return data.summary as CustomerAccountSummary;
}

export function useCustomerAccountSummaries(
  customers: { id: string | number; current_balance?: number | null }[] | undefined,
  options?: { startDate?: string; endDate?: string }
) {
  const startDate = options?.startDate ?? '';
  const endDate = options?.endDate ?? '';
  const params = startDate && endDate ? { start_date: startDate, end_date: endDate } : {};

  const list = (customers ?? []).filter(
    (c): c is NonNullable<typeof c> =>
      Boolean(c && c.id !== null && c.id !== undefined && String(c.id).trim() !== '')
  );

  const results = useQueries({
    queries: list.map((c) => ({
      queryKey: ['customer-account-summary', String(c.id), startDate, endDate],
      queryFn: () => fetchCustomerSummary(c.id, params),
      staleTime: 2 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      placeholderData: fallbackSummary(c.current_balance),
      retry: 1,
    })),
  });

  const summaryMap: Record<string, CustomerAccountSummary> = {};
  results.forEach((result, i) => {
    const id = String(list[i].id);
    summaryMap[id] = (result.data as CustomerAccountSummary) ?? fallbackSummary(list[i].current_balance);
  });

  const summariesReady = list.length === 0 || results.every((r) => !r.isLoading);

  return {
    summaryMap,
    summariesReady,
    setSummaryMap: (_: Record<string, CustomerAccountSummary>) => {},
  };
}
