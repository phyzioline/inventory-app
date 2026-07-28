import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  BarChart3,
  DollarSign,
  Landmark,
  Package,
  RotateCcw,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import api from '@/lib/api';
import { useCustomerAccountSummaries } from '@/hooks/useCustomerAccountSummaries';
import { useSupplierAccountSummaries } from '@/hooks/useSupplierAccountSummaries';
import { getSupplierOutstanding } from '@/lib/supplierOutstanding';
import { sumWarehouseSummary } from '@/lib/warehouseSummaryAggregation';

const toDateInput = (date: Date) => date.toISOString().slice(0, 10);
/** Backend requires dates; use a fixed early start so bank snapshot = all history through today. */
const PROFIT_SUMMARY_ALL_TIME_START = '1970-01-01';
const toNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const formatNumber = (value: unknown, options?: Intl.NumberFormatOptions) =>
  toNumber(value).toLocaleString('en-US', options);

const pickFirstPositive = (...values: unknown[]) => {
  for (const value of values) {
    const n = toNumber(value);
    if (n > 0) return n;
  }
  return 0;
};

const getLinkedMasterProduct = (row: any) =>
  row?.sku?.offer?.master_product
  || row?.sku?.offer?.masterProduct
  || row?.offer?.master_product
  || row?.offer?.masterProduct
  || row?.master_product
  || row?.masterProduct
  || null;

const resolvePurchaseUnitCost = (row: any): number => {
  const fromApi = toNumber(row.effective_purchase_unit_cost ?? row.effectivePurchaseUnitCost);
  if (fromApi > 0) return fromApi;

  const master = getLinkedMasterProduct(row);
  if (master) {
    const masterCost = pickFirstPositive(
      master?.last_purchase_price,
      master?.cost_price,
      master?.avg_purchase_price,
      master?.specifications?.cost_price
    );
    if (masterCost > 0) return masterCost;
  }
  return pickFirstPositive(
    row?.sku?.last_purchase_price,
    row?.sku?.cost_price,
    row?.last_purchase_price,
    row?.cost_price
  );
};

type Props = {
  /** When false, only the 8 KPI cards are shown (used if caller handles receivables elsewhere). */
  showReceivablesRow?: boolean;
  /** Called before scrolling to the cash-flow summary (e.g. switch to the Cash flow tab). */
  onBeforeScrollToCashFlow?: () => void;
};

const FLOW_SUMMARY_ANCHOR = 'bank-accounts-flow-summary';

export function ProfitSnapshotKpis({ showReceivablesRow = true, onBeforeScrollToCashFlow }: Props) {
  const { t, language } = useLanguage();
  const isAr = language === 'ar';
  const navigate = useNavigate();
  const channelFilter = 'all';

  const scrollToCashFlowSummary = useCallback(() => {
    onBeforeScrollToCashFlow?.();
    window.setTimeout(() => {
      document.getElementById(FLOW_SUMMARY_ANCHOR)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }, [onBeforeScrollToCashFlow]);

  const profitSummaryEndDate = toDateInput(new Date());

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['profit-summary', 'all-time', profitSummaryEndDate, channelFilter],
    queryFn: () =>
      api.get('/reports/profit-summary', {
        params: {
          start_date: PROFIT_SUMMARY_ALL_TIME_START,
          end_date: profitSummaryEndDate,
          channel: undefined,
        },
      }),
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['orders-for-profit', profitSummaryEndDate],
    queryFn: () =>
      api.getArray('/orders', {
        params: {
          for_profit: 1,
          start_date: PROFIT_SUMMARY_ALL_TIME_START,
          end_date: profitSummaryEndDate,
        },
      }),
    staleTime: 120_000,
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => api.getArray('/expenses'),
  });

  const { data: receipts = [] } = useQuery({
    queryKey: ['receipts-for-profit-balance'],
    queryFn: () => api.getArray('/receipts'),
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['payments-for-profit-balance'],
    queryFn: () => api.getArray('/payments'),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-for-profit-balance'],
    queryFn: () => api.getArray('/suppliers'),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers-for-profit-receivables'],
    queryFn: () => api.getArray('/customers'),
  });

  const { summaryMap } = useSupplierAccountSummaries(suppliers);
  const { summaryMap: customerSummaryMap } = useCustomerAccountSummaries(customers);

  const { data: capitalSources = [] } = useQuery({
    queryKey: ['capital-sources'],
    queryFn: () => api.getArray('/capital-sources'),
  });

  const { data: warehouseSummaryRows = [], isLoading: loadingInventory } = useQuery({
    queryKey: ['warehouses-summary'],
    queryFn: () => api.getArray('/warehouses/summary'),
    staleTime: 120_000,
  });

  const currentInventoryCost = useMemo(
    () => sumWarehouseSummary(Array.isArray(warehouseSummaryRows) ? warehouseSummaryRows : []).totalCost,
    [warehouseSummaryRows]
  );

  const profitData = (summary as any) || {};
  const totalRevenue = toNumber(profitData.revenue ?? profitData.total_revenue ?? 0);
  const totalCogs = toNumber(profitData.cogs ?? profitData.total_cogs ?? 0);
  const totalExpenses = toNumber(profitData.expenses ?? profitData.total_expenses ?? 0);
  const totalOrderCosts = toNumber(profitData.order_costs ?? 0);
  const totalRefunds = toNumber(profitData.refunds ?? 0);
  const netProfit = toNumber(profitData.net_profit ?? 0);
  const totalExpensesCombined = totalExpenses + totalOrderCosts;

  const isLocalSalesChannel = (o: any) => {
    const ch = String(o?.channel?.slug || o?.channel?.name || o?.marketplace_source || '').toLowerCase();
    return (
      ch.includes('store')
      || ch.includes('shop')
      || ch.includes('المحل')
      || ch.includes('physical')
      || ch.includes('محل')
    );
  };

  const receivablesBreakdown = useMemo(() => {
    const orderRows = Array.isArray(orders) ? orders : [];
    const customerRows = Array.isArray(customers) ? customers : [];

    // Same as Customers page «المستحق»: sum of account-summary outstanding per contact.
    let customerReceivable = customerRows.reduce((sum: number, c: any) => {
      const summary = customerSummaryMap[String(c.id)];
      return sum + Math.max(0, toNumber(summary?.outstanding));
    }, 0);
    let platformPending = 0;

    orderRows.forEach((o: any) => {
      const status = String(o?.status || '').toLowerCase();
      const soldLike = ['completed', 'processing', 'shipped', 'delivered'].includes(status);
      if (!soldLike) return;

      const settlement = String(o?.settlement_status || o?.settlementStatus || '').toLowerCase();
      const financial = String(o?.financial_status || o?.financialStatus || '').toLowerCase();
      const payment = String(o?.payment_status || o?.paymentStatus || '').toLowerCase();
      const unpaidLike =
        settlement.includes('pending')
        || financial.includes('pending')
        || payment === 'pending'
        || payment === 'unpaid'
        || payment === 'partial';

      if (!unpaidLike) return;

      const amt = toNumber(o.total_amount);
      if (!isLocalSalesChannel(o)) {
        platformPending += amt;
      }
    });

    return {
      customerReceivable,
      platformPending,
      total: customerReceivable + platformPending,
    };
  }, [orders, customers, customerSummaryMap]);

  const balanceNowData = useMemo(() => {
    const totalCapital = (capitalSources || []).reduce((s: number, c: any) => s + toNumber(c.amount), 0);
    const totalReceipts = (receipts || []).reduce((s: number, r: any) => s + toNumber(r.amount), 0);
    const totalPayments = (payments || []).reduce((s: number, p: any) => s + toNumber(p.amount), 0);
    const totalExpensesAll = (expenses || []).reduce((s: number, e: any) => s + toNumber(e.amount), 0);
    const cashInSystem = totalCapital + totalReceipts - totalPayments - totalExpensesAll;

    const awaitingCollection = (orders || [])
      .filter((order: any) => {
        const status = String(order?.status || '').toLowerCase();
        const soldLike = ['completed', 'processing', 'shipped', 'delivered'].includes(status);
        if (!soldLike) return false;
        const settlement = String(order?.settlement_status || order?.settlementStatus || '').toLowerCase();
        const financial = String(order?.financial_status || order?.financialStatus || '').toLowerCase();
        const payment = String(order?.payment_status || order?.paymentStatus || '').toLowerCase();
        return settlement.includes('pending') || financial.includes('pending') || payment === 'pending' || payment === 'unpaid';
      })
      .reduce((s: number, order: any) => s + toNumber(order.total_amount), 0);

    return {
      cashInSystem,
      awaitingCollection,
      totalBalanceNow: cashInSystem + awaitingCollection,
    };
  }, [capitalSources, receipts, payments, expenses, orders]);

  const suppliersDueTotal = useMemo(
    () =>
      (suppliers || []).reduce(
        (sum: number, supplier: any) => sum + Math.max(0, getSupplierOutstanding(supplier, summaryMap)),
        0
      ),
    [suppliers, summaryMap]
  );
  const netAfterSuppliers = toNumber(balanceNowData.totalBalanceNow) - toNumber(suppliersDueTotal);

  const loading = loadingSummary || loadingInventory;

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-muted/50" />
          ))}
        </div>
      ) : (
        <>
          {showReceivablesRow && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="stat-card h-full min-h-[130px]">
                <div className="flex items-start gap-3">
                  <div className="p-3 rounded-xl bg-cyan-500/10">
                    <Users className="w-5 h-5 text-cyan-600" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-xl font-bold tabular-nums">{formatNumber(receivablesBreakdown.customerReceivable)} EGP</p>
                    <p className="text-xs text-muted-foreground leading-snug">{t('bankAccounts.snapshotReceivablesLocalCardTitle')}</p>
                    <p className="text-[11px] text-muted-foreground leading-snug pt-1 border-t border-border/60">
                      {t('bankAccounts.snapshotReceivablesVsCustomersHint')}
                    </p>
                  </div>
                </div>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.03 }}
                className="stat-card h-full min-h-[130px]"
              >
                <div className="flex items-start gap-3">
                  <div className="p-3 rounded-xl bg-indigo-500/10">
                    <Wallet className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-xl font-bold tabular-nums">{formatNumber(receivablesBreakdown.platformPending)} EGP</p>
                    <p className="text-xs text-muted-foreground leading-snug">{t('bankAccounts.snapshotReceivablesPlatformCardTitle')}</p>
                    <p className="text-[11px] text-muted-foreground leading-snug pt-1">
                      {t('bankAccounts.snapshotReceivablesPlatformsLine')}
                    </p>
                  </div>
                </div>
              </motion.div>
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.06 }}
                className="stat-card text-start hover:border-primary/50 transition-colors h-full min-h-[130px]"
                onClick={scrollToCashFlowSummary}
              >
                <div className="flex items-start gap-3">
                  <div className="p-3 rounded-xl bg-emerald-500/10">
                    <Landmark className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-xl font-bold tabular-nums">{formatNumber(balanceNowData.cashInSystem)} EGP</p>
                    <p className="text-xs text-muted-foreground">{t('bankAccounts.snapshotCashBankTitle')}</p>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{t('bankAccounts.snapshotCashBankHint')}</p>
                  </div>
                </div>
              </motion.button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 gap-4">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="stat-card h-full min-h-[122px]">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-green-500/10">
                  <DollarSign className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="text-xl font-bold tabular-nums">{formatNumber(totalRevenue)} EGP</p>
                  <p className="text-xs text-muted-foreground">{t('bankAccounts.snapshotRevenue')}</p>
                </div>
              </div>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="stat-card h-full min-h-[122px]">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-red-500/10">
                  <Package className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <p className="text-xl font-bold tabular-nums">{formatNumber(totalCogs)} EGP</p>
                  <p className="text-xs text-muted-foreground">{t('bankAccounts.snapshotCogs')}</p>
                </div>
              </div>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="stat-card h-full min-h-[122px]">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-orange-500/10">
                  <BarChart3 className="w-5 h-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-xl font-bold tabular-nums">{formatNumber(totalExpensesCombined)} EGP</p>
                  <p className="text-xs text-muted-foreground">{t('bankAccounts.snapshotExpenses')}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {totalOrderCosts > 0
                      ? (isAr
                        ? `داخلي: ${formatNumber(totalExpenses)} + قنوات: ${formatNumber(totalOrderCosts)}`
                        : `Internal: ${formatNumber(totalExpenses)} + Channel: ${formatNumber(totalOrderCosts)}`)
                      : (isAr
                        ? `مصروفات تشغيل؛ رسوم القنوات تُحسب داخل الإيراد عند وجود شيت تسوية`
                        : `Operating expenses; channel fees are inside settlement revenue when linked`)}
                  </p>
                </div>
              </div>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="stat-card h-full min-h-[122px]">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-amber-500/10">
                  <RotateCcw className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <p className="text-xl font-bold tabular-nums">{formatNumber(totalRefunds)} EGP</p>
                  <p className="text-xs text-muted-foreground">{t('bankAccounts.snapshotReturns')}</p>
                </div>
              </div>
            </motion.div>
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 }}
              className="stat-card text-start hover:border-primary/50 transition-colors h-full min-h-[122px]"
              onClick={() => navigate('/inventory/by-location')}
            >
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-purple-500/10">
                  <Package className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                  <p className="text-xl font-bold tabular-nums">{formatNumber(currentInventoryCost)} EGP</p>
                  <p className="text-xs text-muted-foreground">{t('bankAccounts.snapshotInventory')}</p>
                </div>
              </div>
            </motion.button>
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="stat-card text-start hover:border-primary/50 transition-colors h-full min-h-[122px]"
              onClick={scrollToCashFlowSummary}
            >
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-emerald-500/10">
                  <Wallet className="w-5 h-5 text-emerald-500" />
                </div>
                <div>
                  <p className="text-xl font-bold tabular-nums">{formatNumber(balanceNowData.totalBalanceNow)} EGP</p>
                  <p className="text-xs text-muted-foreground">{t('bankAccounts.snapshotTotalBalance')}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {isAr
                      ? `النقد/البنك: ${formatNumber(balanceNowData.cashInSystem)} + تحت التحصيل: ${formatNumber(balanceNowData.awaitingCollection)}`
                      : `Cash/Bank: ${formatNumber(balanceNowData.cashInSystem)} + Awaiting: ${formatNumber(balanceNowData.awaitingCollection)}`}
                  </p>
                </div>
              </div>
            </motion.button>
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.22 }}
              className="stat-card text-start hover:border-primary/50 transition-colors h-full min-h-[122px]"
              onClick={() => navigate('/customers-suppliers')}
            >
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-rose-500/10">
                  <AlertTriangle className="w-5 h-5 text-rose-500" />
                </div>
                <div>
                  <p className="text-xl font-bold tabular-nums">{formatNumber(suppliersDueTotal)} EGP</p>
                  <p className="text-xs text-muted-foreground">{t('bankAccounts.snapshotSupplierDues')}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {isAr
                      ? `الصافي بعد مستحقات الموردين: ${formatNumber(netAfterSuppliers)} EGP`
                      : `Net after supplier dues: ${formatNumber(netAfterSuppliers)} EGP`}
                  </p>
                </div>
              </div>
            </motion.button>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="stat-card h-full min-h-[122px]">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-primary/10">
                  <TrendingUp className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xl font-bold tabular-nums">{formatNumber(netProfit)} EGP</p>
                  <p className="text-xs text-muted-foreground">{t('bankAccounts.snapshotNetProfit')}</p>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </div>
  );
}
