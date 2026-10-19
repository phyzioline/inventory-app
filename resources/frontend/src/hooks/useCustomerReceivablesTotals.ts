import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

/** Server-side aggregate over all (non-Guest) customers — same numbers as the Customers page cards. */
export type CustomerDirectoryTotals = {
  customers: number;
  customers_owing: number;
  total_sales: number;
  total_received: number;
  /** Sum of positive balances only — what customers owe us. */
  receivable: number;
  /** Sum of negative balances (≤ 0) — what we owe customers. */
  credit: number;
  net_outstanding: number;
  invoice_count: number;
};

export function useCustomerReceivablesTotals(options?: { startDate?: string; endDate?: string }) {
  const startDate = options?.startDate ?? '';
  const endDate = options?.endDate ?? '';
  const params = startDate && endDate ? { start_date: startDate, end_date: endDate } : {};

  return useQuery({
    queryKey: ['customer-receivables-totals', startDate, endDate],
    queryFn: () => api.get<CustomerDirectoryTotals>('customers/receivables-summary', { params }),
    staleTime: 2 * 60 * 1000,
  });
}
