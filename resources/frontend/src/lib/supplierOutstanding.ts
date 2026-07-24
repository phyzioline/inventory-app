import type { SupplierAccountSummary } from '@/hooks/useSupplierAccountSummaries';

const emptySummary = (): SupplierAccountSummary => ({
  total_purchases: 0,
  total_paid: 0,
  outstanding: 0,
  invoice_count: 0,
  avg_payment_days: 0,
});

/**
 * Outstanding balance for one supplier — same rule as Finance → Suppliers and Settings → Suppliers:
 * prefer `suppliers/:id/account-summary` (when loaded into summaryMap), else DB `balance`.
 */
export function getSupplierOutstanding(
  supplier: { id: string | number; balance?: number | null; current_balance?: number | null } | null | undefined,
  summaryMap: Record<string, SupplierAccountSummary>
): number {
  if (!supplier || supplier.id === null || supplier.id === undefined || supplier.id === '') {
    return 0;
  }
  const summary = summaryMap[String(supplier.id)];
  if (summary && Number.isFinite(Number(summary.outstanding))) {
    return Number(summary.outstanding);
  }
  const b = Number(supplier.balance ?? supplier.current_balance ?? 0);
  return Number.isFinite(b) ? b : 0;
}

/** Full KPI row for tables / totals when summary may still be loading (fallback to balance only). */
export function getSupplierAccountView(
  supplier: { id: string | number; balance?: number | null; current_balance?: number | null } | null | undefined,
  summaryMap: Record<string, SupplierAccountSummary>
): SupplierAccountSummary {
  if (!supplier || supplier.id === null || supplier.id === undefined || supplier.id === '') {
    return emptySummary();
  }
  const s = summaryMap[String(supplier.id)];
  if (s) {
    return {
      total_purchases: Number(s.total_purchases) || 0,
      total_paid: Number(s.total_paid) || 0,
      outstanding: Number(s.outstanding) || 0,
      invoice_count: Number(s.invoice_count) || 0,
      avg_payment_days: Number(s.avg_payment_days) || 0,
    };
  }
  const base = emptySummary();
  base.outstanding = getSupplierOutstanding(supplier, summaryMap);
  return base;
}
