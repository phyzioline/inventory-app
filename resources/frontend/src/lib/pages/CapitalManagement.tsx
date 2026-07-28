import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  PiggyBank,
  Plus,
  Search,
  Loader2,
  Wallet,
  TrendingUp,
  ArrowDownCircle,
  DollarSign,
  AlertTriangle,
  RotateCcw,
  Truck,
  Store,
  BarChart3,
  Landmark,
  Shield,
  Scale,
  Ban,
  HandCoins,
  Globe,
  Receipt,
  CreditCard,
  ShoppingCart,
  ArrowUpCircle,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { purchaseInvoiceService } from '@/lib/supabase-services';
import { useCustomerAccountSummaries } from '@/hooks/useCustomerAccountSummaries';
import { useCustomers } from '@/hooks/useCustomers';
import { useSupplierAccountSummaries } from '@/hooks/useSupplierAccountSummaries';
import { useSuppliers } from '@/hooks/useSuppliers';
import { getSupplierOutstanding } from '@/lib/supplierOutstanding';
import { sumWarehouseSummary } from '@/lib/warehouseSummaryAggregation';
import { toast } from 'sonner';
import { TreasuryDashboard, type TreasuryStatsSlice, type TreasuryExtraRow } from '@/components/finance/TreasuryDashboard';
import { treasuryExtraOutbound } from '@/components/finance/treasuryRegistry';

const toNum = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const roundMoney = (n: number) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
};

/** Prefer lightweight /stats; fall back to full overview if route not deployed yet (same stats shape). */
async function fetchTreasuryCashFlowStats(): Promise<{ stats: TreasuryStatsSlice }> {
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

const pickFirstPositive = (...values: unknown[]) => {
  for (const value of values) {
    const n = toNum(value);
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
  const fromApi = toNum(row.effective_purchase_unit_cost ?? row.effectivePurchaseUnitCost);
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

export default function CapitalManagement() {
  const { dir, language } = useLanguage();
  const isAr = language === 'ar';
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    type: 'personal',
    amount: '',
    ownership_percentage: '100',
    receipt_date: '',
  });

  // Data queries
  const { data: sources = [], isLoading: loadingSources } = useQuery({
    queryKey: ['capital-sources'],
    queryFn: () => api.getArray('/capital-sources'),
  });

  const { data: orders = [], isPending: ordersCapitalPending } = useQuery({
    queryKey: ['orders-capital'],
    queryFn: () => api.getArray('/orders'),
  });

  const { data: purchases = [], isPending: purchasesCapitalPending } = useQuery({
    queryKey: ['purchases-capital'],
    // Use the same normalized purchase source used by Purchase Invoices page.
    queryFn: () => purchaseInvoiceService.getAll(),
  });

  const { data: expenses = [], isPending: expensesCapitalPending } = useQuery({
    queryKey: ['expenses-capital'],
    queryFn: () => api.getArray('/expenses'),
  });

  const { data: receipts = [], isPending: receiptsCapitalPending } = useQuery({
    queryKey: ['receipts-capital'],
    queryFn: () => api.getArray('/receipts'),
  });

  const { data: payments = [], isPending: paymentsCapitalPending } = useQuery({
    queryKey: ['payments-capital'],
    queryFn: () => api.getArray('/payments'),
  });

  const { data: returns = [], isPending: returnsCapitalPending } = useQuery({
    queryKey: ['returns-capital'],
    queryFn: () => api.getArray('/returns'),
  });

  const { data: adjustments = [], isPending: adjustmentsCapitalPending } = useQuery({
    queryKey: ['adjustments-capital'],
    queryFn: () => api.getArray('/adjustments'),
  });

  const { data: channels = [] } = useQuery({
    queryKey: ['channels-capital'],
    queryFn: () => api.getArray('/channels'),
  });

  /** Same aggregates as cash-flow overview.stats (incl. implicit purchase settlements) — lightweight endpoint for treasury truth. */
  const {
    data: cashFlowStats,
    dataUpdatedAt: cashFlowUpdatedAt,
    isFetching: cashFlowFetching,
    refetch: refetchCashFlow,
    isPending: cashFlowStatsPending,
    isError: cashFlowStatsError,
  } = useQuery({
    queryKey: ['finance-cash-flow-stats'],
    queryFn: fetchTreasuryCashFlowStats,
    staleTime: 30_000,
    retry: 1,
  });

  const { data: treasuryPanels, isPending: treasuryPanelsPending } = useQuery({
    queryKey: ['treasury-panels'],
    queryFn: () =>
      api.get<{
        operational_net: number;
        total_receipts?: number;
        total_outflow?: number;
        inbound_items: Array<{
          type: string;
          id: string;
          name_ar: string;
          name_en: string;
          amount: number;
          path: string;
        }>;
        inbound_displayed_total: number;
      }>('finance/treasury-panels'),
    staleTime: 30_000,
    retry: 1,
  });

  const { data: sulfaSummary } = useQuery({
    queryKey: ['finance-sulfas-summary'],
    queryFn: () => api.get<{ sulfa_borrow_total?: number }>('finance/sulfas/summary'),
    staleTime: 30_000,
    retry: 1,
  });

  /** Same rollup as Master Products / warehouse cards — avoids double-counting sku.stock vs location rows. */
  const { data: warehouseSummaryRows = [], isPending: inventoryCostPending } = useQuery({
    queryKey: ['warehouses-summary'],
    queryFn: () => api.getArray('/warehouses/summary'),
    staleTime: 120_000,
  });

  const currentInventoryCost = useMemo(
    () => sumWarehouseSummary(Array.isArray(warehouseSummaryRows) ? warehouseSummaryRows : []).totalCost,
    [warehouseSummaryRows]
  );

  const { data: suppliers = [], isPending: suppliersCapitalPending } = useSuppliers();
  const { data: customers = [], isPending: customersCapitalPending } = useCustomers();

  const { summaryMap, summariesReady } = useSupplierAccountSummaries(suppliers);
  const { summaryMap: customerSummaryMap, summariesReady: customerSummariesReady } =
    useCustomerAccountSummaries(customers);

  const financialSnapshotPending =
    ordersCapitalPending ||
    purchasesCapitalPending ||
    expensesCapitalPending ||
    receiptsCapitalPending ||
    paymentsCapitalPending ||
    returnsCapitalPending ||
    adjustmentsCapitalPending ||
    suppliersCapitalPending ||
    customersCapitalPending ||
    inventoryCostPending;

  const supplierSummariesPending = suppliers.length > 0 && !summariesReady;
  const customerSummariesPending = customers.length > 0 && !customerSummariesReady;

  /** Customers page «المستحق» — sum of account-summary outstanding (invoice remaining). */
  const customersOutstandingTotal = useMemo(() => {
    return (Array.isArray(customers) ? customers : []).reduce((sum: number, c: any) => {
      const summary = customerSummaryMap[String(c.id)];
      return sum + Math.max(0, toNum(summary?.outstanding));
    }, 0);
  }, [customers, customerSummaryMap]);

  /** Cash not yet collected: customer ledger (shop) + marketplace orders pending settlement/payment. */
  const externalReceivables = useMemo(() => {
    const customerReceivable = customersOutstandingTotal;
    let platformPending = 0;
    (Array.isArray(orders) ? orders : []).forEach((o: any) => {
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

      const amt = toNum(o.total_amount);
      if (!isLocalSalesChannel(o)) {
        platformPending += amt;
      }
    });

    return {
      customerReceivable,
      platformPending,
      total: customerReceivable + platformPending,
    };
  }, [orders, customersOutstandingTotal]);

  const invalidateTreasuryQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ['capital-sources'] });
    void queryClient.invalidateQueries({ queryKey: ['finance-cash-flow-stats'] });
    void queryClient.invalidateQueries({ queryKey: ['finance-cash-flow-overview'] });
    void queryClient.invalidateQueries({ queryKey: ['treasury-panels'] });
    void queryClient.invalidateQueries({ queryKey: ['receipts-capital'] });
    void queryClient.invalidateQueries({ queryKey: ['receipts-for-profit-balance'] });
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/capital-sources', data),
    onSuccess: () => {
      invalidateTreasuryQueries();
      setIsDialogOpen(false);
      setFormData({ name: '', type: 'personal', amount: '', ownership_percentage: '100', receipt_date: '' });
      toast.success(isAr ? 'تمت الإضافة وإنشاء مقبوض رأس المال' : 'Capital source added with receipt');
    },
    onError: (err: any) => {
      const serverMessage = err.response?.data?.message || err.response?.data?.error;
      toast.error(serverMessage || (isAr ? 'فشل إضافة مصدر رأس المال' : 'Failed to add capital source'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string | number) => api.delete(`/capital-sources/${id}`),
    onSuccess: () => {
      invalidateTreasuryQueries();
      setDeletingSourceId(null);
      toast.success(isAr ? 'تم الحذف (ومقبوض رأس المال المرتبط إن وُجد)' : 'Deleted (linked capital receipt removed if any)');
    },
    onError: (err: any) => {
      setDeletingSourceId(null);
      const serverMessage = err.response?.data?.message || err.response?.data?.error;
      toast.error(serverMessage || (isAr ? 'تعذر الحذف' : 'Could not delete'));
    },
  });

  // ===== COMPREHENSIVE FINANCIAL CALCULATIONS =====
  const financials = useMemo(() => {
    // Capital
    const totalCapital = sources.reduce((s: number, c: any) => s + Number(c.amount || 0), 0);

    const orderCountsForRevenue = (o: any) => {
      const st = String(o?.status || '').toLowerCase();
      const financial = String(o?.financial_status || o?.financialStatus || '').toLowerCase();
      // Exclude cancelled/rejected/zeroed
      if (['cancelled', 'rejected'].includes(st)) return false;
      if (financial === 'cancelled') return false;
      // Count only sold-like lifecycle (matches receivable logic)
      return ['completed', 'processing', 'shipped', 'delivered', 'sold', 'returned', 'return_in_progress'].includes(st);
    };

    // Revenue (exclude cancelled/drafts)
    const revenueOrders = (Array.isArray(orders) ? orders : []).filter(orderCountsForRevenue);
    const totalRevenue = revenueOrders.reduce((s: number, o: any) => s + Number(o.total_amount || 0), 0);

    // COGS / Purchases
    const purchaseCountsForCogs = (p: any) => {
      const st = String(p?.status || p?.backend_status || '').toLowerCase();
      return !['cancelled', 'draft', 'review'].includes(st);
    };
    const countedPurchases = (Array.isArray(purchases) ? purchases : []).filter(purchaseCountsForCogs);
    const totalPurchases = countedPurchases.reduce((s: number, p: any) => s + Number(p.total_amount || 0), 0);

    // Expenses by category
    const expensesByCategory: Record<string, number> = {};
    let totalExpenses = 0;
    expenses.forEach((e: any) => {
      const cat = e.category || 'other';
      const amt = Number(e.amount || 0);
      expensesByCategory[cat] = (expensesByCategory[cat] || 0) + amt;
      totalExpenses += amt;
    });

    const shippingExpenses = expensesByCategory['shipping'] || 0;
    const marketingExpenses = expensesByCategory['marketing'] || 0;
    const rentExpenses = expensesByCategory['rent'] || 0;
    const salariesExpenses = expensesByCategory['salaries'] || 0;
    const otherExpenses = totalExpenses - shippingExpenses - marketingExpenses - rentExpenses - salariesExpenses;

    // Returns & Refunds
    const returnsArr = Array.isArray(returns) ? returns : [];
    const totalRefunds = returnsArr.reduce((s: number, r: any) => s + Number(r.refund_amount || 0), 0);
    const totalReturnsCount = returnsArr.length;
    const damagedReturns = returnsArr.filter((r: any) => r.return_type === 'damaged');
    const damagedAmount = damagedReturns.reduce((s: number, r: any) => s + Number(r.refund_amount || 0), 0);

    // Inventory Adjustments (Losses)
    const adjArr = Array.isArray(adjustments) ? adjustments : [];
    const totalLossAmount = adjArr.reduce((s: number, a: any) => s + Number(a.total_loss_amount || 0), 0);
    const lossesByType: Record<string, { count: number; amount: number }> = {};
    adjArr.forEach((a: any) => {
      const type = a.type || 'UNKNOWN';
      if (!lossesByType[type]) lossesByType[type] = { count: 0, amount: 0 };
      lossesByType[type].count += 1;
      lossesByType[type].amount += Number(a.total_loss_amount || 0);
    });

    // Cash flow
    const totalReceipts = receipts.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
    const totalPayments = payments.reduce((s: number, p: any) => s + Number(p.amount || 0), 0);

    // Supplier payables — same rule as Finance → Suppliers / Settings (account-summary + shared helper).
    const supplierPayables = (Array.isArray(suppliers) ? suppliers : []).reduce(
      (sum: number, sup: any) => sum + Math.max(0, getSupplierOutstanding(sup, summaryMap)),
      0
    );

    // Channel breakdown
    const channelBreakdown: Record<string, {
      name: string;
      revenue: number;
      orders: number;
      shippingFees: number;
      platformFees: number;
      returns: number;
      returnAmount: number;
    }> = {};

    revenueOrders.forEach((order: any) => {
      const chName = order.channel?.name || order.marketplace_source || 'Direct';
      if (!channelBreakdown[chName]) {
        channelBreakdown[chName] = { name: chName, revenue: 0, orders: 0, shippingFees: 0, platformFees: 0, returns: 0, returnAmount: 0 };
      }
      channelBreakdown[chName].revenue += Number(order.total_amount || 0);
      channelBreakdown[chName].orders += 1;
      channelBreakdown[chName].shippingFees += Number(order.shipping_fee || 0);
      channelBreakdown[chName].platformFees += Number(order.platform_fee || order.commission || 0);
    });

    returnsArr.forEach((ret: any) => {
      const chName = ret.order?.channel?.name || ret.marketplace_source || 'Direct';
      if (channelBreakdown[chName]) {
        channelBreakdown[chName].returns += 1;
        channelBreakdown[chName].returnAmount += Number(ret.refund_amount || 0);
      }
    });

    const channelArray = Object.values(channelBreakdown).sort((a, b) => b.revenue - a.revenue);

    // Profit calculations
    const grossProfit = totalRevenue - totalPurchases;
    const netProfit = grossProfit - totalExpenses - totalLossAmount - totalRefunds;
    const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
    const roi = totalCapital > 0 ? (netProfit / totalCapital) * 100 : 0;

    /** Tangible net capital: stock at cost + receivables (incl. pending settlement) − supplier payables. */
    const inventoryValue = toNum(currentInventoryCost);
    const externalReceivablesTotal = externalReceivables.total;
    const netRealCapital = inventoryValue + externalReceivablesTotal - supplierPayables;
    const frozenCapital = inventoryValue;
    const pendingPlatformBalance = externalReceivables.platformPending;

    return {
      totalCapital,
      totalRevenue,
      totalPurchases,
      totalExpenses,
      shippingExpenses,
      marketingExpenses,
      rentExpenses,
      salariesExpenses,
      otherExpenses,
      expensesByCategory,
      totalRefunds,
      totalReturnsCount,
      damagedAmount,
      damagedReturns: damagedReturns.length,
      totalLossAmount,
      lossesByType,
      totalReceipts,
      totalPayments,
      supplierPayables,
      channelArray,
      grossProfit,
      netProfit,
      grossMargin,
      netMargin,
      roi,
      netRealCapital,
      inventoryValue,
      frozenCapital,
      pendingPlatformBalance,
      externalReceivablesTotal,
      customerReceivable: externalReceivables.customerReceivable,
      platformPendingReceivable: externalReceivables.platformPending,
    };
  }, [
    sources,
    orders,
    purchases,
    expenses,
    receipts,
    payments,
    returns,
    adjustments,
    suppliers,
    summaryMap,
    currentInventoryCost,
    externalReceivables,
  ]);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'sources' || tab === 'capital') {
      setActiveTab('capital');
    }
  }, [searchParams]);

  const treasuryStatsResolved = useMemo((): TreasuryStatsSlice => {
    const raw = cashFlowStats?.stats;
    if (raw && typeof raw === 'object') {
      return {
        total_capital: toNum((raw as TreasuryStatsSlice).total_capital),
        total_receipts: toNum((raw as TreasuryStatsSlice).total_receipts),
        total_payments: toNum((raw as TreasuryStatsSlice).total_payments),
        total_expenses: toNum((raw as TreasuryStatsSlice).total_expenses),
        total_outflow: toNum((raw as TreasuryStatsSlice).total_outflow),
        estimated_balance: toNum((raw as TreasuryStatsSlice).estimated_balance),
        purchase_paid_total: toNum((raw as TreasuryStatsSlice).purchase_paid_total),
      };
    }
    // Do not infer total_outflow from screen receipts (would drop purchase_paid_total). Wait for /finance/cash-flow-stats.
    return {
      total_capital: financials.totalCapital,
      total_receipts: 0,
      total_payments: 0,
      total_expenses: 0,
      total_outflow: 0,
      estimated_balance: 0,
      purchase_paid_total: 0,
    };
  }, [cashFlowStats, financials.totalCapital]);

  const treasuryInboundRows = useMemo((): TreasuryExtraRow[] => {
    const items = treasuryPanels?.inbound_items;
    if (items && items.length > 0) {
      return items.map((it) => ({
        id: it.id,
        labelAr: it.name_ar,
        labelEn: it.name_en,
        value: Number(it.amount ?? 0),
        path: it.path,
        isSection: it.type === 'section',
        icon:
          it.type === 'section'
            ? Receipt
            : it.type === 'sulfa'
              ? HandCoins
              : it.type === 'local_shop'
                ? Store
                : it.type === 'channel'
                  ? Globe
                  : Receipt,
      }));
    }
    const totalR = roundMoney(treasuryStatsResolved.total_receipts);
    const sulfaB = roundMoney(toNum(sulfaSummary?.sulfa_borrow_total));
    const receiptsWithoutSulfa = roundMoney(Math.max(0, totalR - sulfaB));
    const receiptsLabelAr = sulfaB > 0.00001 ? 'المقبوضات (غير السُلفة)' : 'المقبوضات';
    const receiptsLabelEn = sulfaB > 0.00001 ? 'Receipts (excl. sulfa)' : 'Receipts';
    return [
      {
        id: 'receipts_ex_sulfa',
        labelAr: receiptsLabelAr,
        labelEn: receiptsLabelEn,
        value: receiptsWithoutSulfa,
        path: '/finance/receipts',
        icon: Receipt,
      },
      {
        id: 'section_sulfa',
        labelAr: 'السُلفة',
        labelEn: 'Sulfa',
        value: 0,
        path: '',
        isSection: true,
        icon: Receipt,
      },
      {
        id: 'sulfa',
        labelAr: 'سُلفة (تمويل)',
        labelEn: 'Sulfa (borrowing)',
        value: sulfaB,
        path: '/finance/sulfa',
        icon: HandCoins,
      },
    ];
  }, [treasuryPanels, treasuryStatsResolved.total_receipts, sulfaSummary]);

  /** Same five-way split as the P&L «Operating expenses» block; falls back to one «المصروفات» line from cash-flow stats when needed. */
  const treasuryExpenseCategoryRows = useMemo((): TreasuryExtraRow[] | undefined => {
    const defs: TreasuryExtraRow[] = [
      {
        id: 'exp_shipping',
        labelAr: 'الشحن والتوصيل',
        labelEn: 'Shipping & Delivery',
        value: roundMoney(financials.shippingExpenses),
        path: '/expenses',
        icon: Truck,
      },
      {
        id: 'exp_marketing',
        labelAr: 'التسويق والإعلانات',
        labelEn: 'Marketing & Ads',
        value: roundMoney(financials.marketingExpenses),
        path: '/expenses',
        icon: BarChart3,
      },
      {
        id: 'exp_rent',
        labelAr: 'الإيجار والمرافق',
        labelEn: 'Rent & Utilities',
        value: roundMoney(financials.rentExpenses),
        path: '/expenses',
        icon: Landmark,
      },
      {
        id: 'exp_salaries',
        labelAr: 'الرواتب والأجور',
        labelEn: 'Salaries & Wages',
        value: roundMoney(financials.salariesExpenses),
        path: '/expenses',
        icon: Wallet,
      },
      {
        id: 'exp_other',
        labelAr: 'مصروفات أخرى',
        labelEn: 'Other Expenses',
        value: roundMoney(financials.otherExpenses),
        path: '/expenses',
        icon: DollarSign,
      },
    ];
    const positive = defs.filter((d) => d.value > 0.00001);
    if (positive.length > 0) return positive;
    const serverExp = roundMoney(treasuryStatsResolved.total_expenses);
    if (serverExp > 0.00001) {
      return [
        {
          id: 'expenses',
          labelAr: 'المصروفات',
          labelEn: 'Expenses',
          value: serverExp,
          path: '/expenses',
          icon: Wallet,
          titleHint: isAr
            ? 'لم يُحمّل تفصيل الفئات من قائمة المصروفات؛ يُعرض إجمالي المصروفات من التدفق النقدي.'
            : 'Category breakdown from the expenses list is unavailable; showing total expenses from cash-flow stats.',
        },
      ];
    }
    return undefined;
  }, [financials, treasuryStatsResolved.total_expenses, isAr]);

  /** Same source as outbound boxes + cash-flow API: receipts − outflow always ties to footer totals. */
  const operationalNetDisplay = useMemo(
    () => roundMoney(treasuryStatsResolved.total_receipts - treasuryStatsResolved.total_outflow),
    [treasuryStatsResolved.total_receipts, treasuryStatsResolved.total_outflow]
  );

  /** Full receipts total (not only the sum of breakdown rows) so net = inbound total − outbound total. */
  const inboundDisplayedTotalResolved = useMemo(
    () => roundMoney(treasuryStatsResolved.total_receipts),
    [treasuryStatsResolved.total_receipts]
  );

  const handleTreasuryRefresh = () => {
    void refetchCashFlow();
    void queryClient.invalidateQueries({ queryKey: ['finance-cash-flow-stats'] });
    void queryClient.invalidateQueries({ queryKey: ['finance-cash-flow-overview'] });
    void queryClient.invalidateQueries({ queryKey: ['capital-sources'] });
    void queryClient.invalidateQueries({ queryKey: ['receipts-capital'] });
    void queryClient.invalidateQueries({ queryKey: ['payments-capital'] });
    void queryClient.invalidateQueries({ queryKey: ['expenses-capital'] });
    void queryClient.invalidateQueries({ queryKey: ['purchases-capital'] });
    void queryClient.invalidateQueries({ queryKey: ['treasury-panels'] });
    void queryClient.invalidateQueries({ queryKey: ['finance-sulfas-summary'] });
  };

  const handleSubmit = () => {
    if (!formData.name || !formData.amount) {
      toast.error('Name and amount are required');
      return;
    }
    const payload: Record<string, unknown> = {
      name: formData.name,
      type: formData.type,
      amount: parseFloat(formData.amount),
      ownership_percentage: parseFloat(formData.ownership_percentage),
    };
    if (formData.receipt_date?.trim()) {
      payload.receipt_date = formData.receipt_date.trim();
    }
    createMutation.mutate(payload);
  };

  const handleDeleteSource = (source: { id: string | number; name?: string }) => {
    const label = source.name || String(source.id);
    const ok = window.confirm(
      isAr
        ? `حذف «${label}»؟\nسيُحذف مصدر رأس المال وإيصال المقبوضات المرتبط به (إن وُجد).\nيمكنك إعادة إضافته بتاريخ قديم ليظهر في الخزنة والمقبوضات.`
        : `Delete "${label}"?\nThis removes the capital source and its linked receipt (if any).\nYou can re-add it with an older deposit date.`
    );
    if (!ok) return;
    setDeletingSourceId(String(source.id));
    deleteMutation.mutate(source.id);
  };

  /** Only block on lightweight treasury truth — heavy lists (orders, purchases, N+1 summaries) load in background. */
  if (cashFlowStatsPending) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3 text-muted-foreground">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
        <p className="text-sm">
          {isAr ? 'جاري تحميل بيانات الخزنة…' : 'Loading treasury data…'}
        </p>
      </div>
    );
  }

  if (cashFlowStatsError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 text-center px-4" dir={dir}>
        <AlertTriangle className="w-12 h-12 text-destructive shrink-0" aria-hidden />
        <p className="text-sm text-muted-foreground max-w-md">
          {isAr
            ? 'تعذر تحميل أرقام الخزنة من الخادم (ملخص التدفق النقدي). اضغط لإعادة المحاولة.'
            : 'Could not load treasury cash-flow stats from the server. Tap to retry.'}
        </p>
        <Button type="button" variant="secondary" onClick={() => void refetchCashFlow()}>
          {isAr ? 'إعادة المحاولة' : 'Retry'}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={dir}>
      {/* Header (capital quick actions live under the Capital Sources tab only) */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">
          {isAr ? 'لوحة الخزنة والمالية' : 'Treasury & finance dashboard'}
        </h1>
        <p className="text-muted-foreground text-sm sm:text-base">
          {isAr
            ? 'رصيد الخزنة، الوارد، والصادر — مربوط بنفس منطق التدفق النقدي في النظام، مع تحليلات رأس المال والربحية في التبويبات أدناه.'
            : 'Treasury inflows/outflows — same cash-flow rules as Bank Accounts; capital and profitability details remain in the tabs below.'}
        </p>
        <p className="text-xs text-amber-800 dark:text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded-md px-3 py-2 max-w-3xl">
          {isAr
            ? 'تنبيه: الخزنة تعرض أرقام كل الفترة (بدون فلتر تاريخ). شاشة «المدفوعات» فيها فلتر تواريخ — إذا كان مضبوطاً على 2026 فقط مثلاً، «إجمالي المدفوع» هناك قد يكون أكبر أو أصغر من رقم الخزنة.'
            : 'Note: Treasury shows all-time figures (no date filter). The Payments screen has a date range — if it is set to 2026 only, «Total paid» there may differ from treasury.'}
        </p>
      </div>

      <TreasuryDashboard
        isAr={isAr}
        dir={dir}
        stats={treasuryStatsResolved}
        operationalNet={operationalNetDisplay}
        inboundRows={treasuryInboundRows}
        inboundDisplayedTotal={inboundDisplayedTotalResolved}
        inboundLoading={treasuryPanelsPending}
        approximate={false}
        lastUpdatedMs={cashFlowUpdatedAt}
        onRefresh={handleTreasuryRefresh}
        isRefreshing={cashFlowFetching}
        extraOutbound={treasuryExtraOutbound}
        expenseCategoryRows={treasuryExpenseCategoryRows}
        customerShopReceivable={financials.customerReceivable}
        customerReceivableFromLedger
        supplierPayablesBalance={financials.supplierPayables}
      />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">{isAr ? 'نظرة عامة' : 'Overview'}</TabsTrigger>
          <TabsTrigger value="pnl">{isAr ? 'تفصيل المصروفات' : 'Expense breakdown'}</TabsTrigger>
          <TabsTrigger value="losses">{isAr ? 'الخسائر والتلفيات' : 'Losses & Damages'}</TabsTrigger>
          <TabsTrigger value="channels">{isAr ? 'حسب القناة' : 'By Channel'}</TabsTrigger>
          <TabsTrigger value="capital">{isAr ? 'مصادر رأس المال' : 'Capital Sources'}</TabsTrigger>
        </TabsList>

        {/* ===== OVERVIEW TAB ===== */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          {(financialSnapshotPending || loadingSources) && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
              {isAr ? 'جاري تحميل تفاصيل اللوحة المالية…' : 'Loading financial details…'}
            </p>
          )}
          {/* Net Real Capital Banner */}
          <Card className="glass-card border-2 border-primary/30">
            <CardContent className="pt-6">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="p-4 rounded-2xl bg-primary/10">
                    <Shield className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{isAr ? 'صافي رأس المال الحقيقي' : 'Net Real Capital'}</p>
                    <p className="text-3xl font-bold">{financials.netRealCapital.toLocaleString()} EGP</p>
                    <p className="text-xs text-muted-foreground">
                      {isAr
                        ? 'قيمة المخزون (كل المخازن) + مستحقات (عملاء ومنصات قيد التسوية) − مستحقات الموردين'
                        : 'Inventory at cost (all warehouses) + receivables (customers & pending settlements) − supplier payables'}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                      {isAr ? (
                        <>
                          مخزون: {financials.inventoryValue.toLocaleString()} · مستحقات:{' '}
                          {financials.externalReceivablesTotal.toLocaleString()}
                          {' '}(محل {financials.customerReceivable.toLocaleString()} / منصات{' '}
                          {financials.platformPendingReceivable.toLocaleString()}) · على الموردين:{' '}
                          {financials.supplierPayables.toLocaleString()}
                        </>
                      ) : (
                        <>
                          Stock: {financials.inventoryValue.toLocaleString()} · Receivables:{' '}
                          {financials.externalReceivablesTotal.toLocaleString()}
                          {' '}(shop {financials.customerReceivable.toLocaleString()} / platforms{' '}
                          {financials.platformPendingReceivable.toLocaleString()}) · Payables:{' '}
                          {financials.supplierPayables.toLocaleString()}
                        </>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex gap-6 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">ROI</p>
                    <p className={`text-xl font-bold ${financials.roi >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {financials.roi.toFixed(1)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{isAr ? 'هامش صافي الربح' : 'Net Margin'}</p>
                    <p className={`text-xl font-bold ${financials.netMargin >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {financials.netMargin.toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Treasury-aligned summary: cash outflow parts = total_outflow; separate reference tiles */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground px-1">
              {isAr
                ? 'صرف الخزنة النقدي (يطابق «إجمالي الصادر» في لوحة الخزنة أعلاه)'
                : 'Treasury cash outflow (matches «Total outbound» in the treasury row above)'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Card className="glass-card border-l-4 border-l-rose-600">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-rose-500/15 text-rose-600 shrink-0">
                      <ArrowUpCircle className="w-5 h-5" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{isAr ? 'إجمالي الصادر النقدي' : 'Total cash outbound'}</p>
                      <p className="text-xl font-bold text-rose-600 tabular-nums">
                        {roundMoney(treasuryStatsResolved.total_outflow).toLocaleString()} EGP
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                        {isAr
                          ? '= المصروفات + إجمالي المدفوع (شاشة المدفوعات، بدون تكرار).'
                          : '= Expenses + total paid (Payments screen, counted once).'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="glass-card border-l-4 border-l-rose-500/70">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-rose-500/10 text-rose-600 shrink-0">
                      <Wallet className="w-5 h-5" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{isAr ? 'المصروفات (مسجّلة)' : 'Expenses (recorded)'}</p>
                      <p className="text-xl font-bold tabular-nums">
                        {roundMoney(treasuryStatsResolved.total_expenses).toLocaleString()} EGP
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                        {isAr ? 'تفصيل الفئات من تبويب «تفصيل المصروفات».' : 'Category detail under the Expense breakdown tab.'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="glass-card border-l-4 border-l-rose-500/70">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-rose-500/10 text-rose-600 shrink-0">
                      <CreditCard className="w-5 h-5" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{isAr ? 'إجمالي المدفوع' : 'Total paid'}</p>
                      <p className="text-xl font-bold tabular-nums">
                        {roundMoney(treasuryStatsResolved.total_payments).toLocaleString()} EGP
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                        {isAr
                          ? 'كل المدفوعات المكتملة من بداية السجل — بدون فلتر تاريخ (قارن مع شاشة المدفوعات بعد ضبط التواريخ).'
                          : 'All completed payments, all-time — no date filter (compare with Payments after setting dates).'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            <p className="text-xs text-muted-foreground px-1 pt-1 flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
              <span className="font-medium text-foreground/80">{isAr ? 'تحقق سريع:' : 'Quick check:'}</span>
              <span>
                {roundMoney(treasuryStatsResolved.total_expenses).toLocaleString()} +{' '}
                {roundMoney(treasuryStatsResolved.total_payments).toLocaleString()} ={' '}
                {roundMoney(
                  treasuryStatsResolved.total_expenses +
                    treasuryStatsResolved.total_payments +
                    treasuryStatsResolved.purchase_paid_total
                ).toLocaleString()}
              </span>
              <span className="text-muted-foreground">≈</span>
              <span>{roundMoney(treasuryStatsResolved.total_outflow).toLocaleString()} EGP</span>
            </p>
          </div>

          <p className="text-sm font-medium text-muted-foreground px-1 mt-6">
            {isAr
              ? 'مرجعي — ربحية وميزانية (لا يُضاف لإجمالي الصادر أعلاه)'
              : 'Reference — P&L / balance sheet (not added to total outbound above)'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card className="glass-card border-l-4 border-l-red-500">
              <CardContent className="pt-6">
                <p className="text-xs text-muted-foreground">{isAr ? 'إجمالي الخسائر (تلف/سرقة/منتهي)' : 'Total Losses (Damage/Theft/Expired)'}</p>
                <p className="text-xl font-bold text-red-500">{financials.totalLossAmount.toLocaleString()} EGP</p>
                <p className="text-xs text-muted-foreground mt-1">{Object.values(financials.lossesByType).reduce((s, l) => s + l.count, 0)} {isAr ? 'تسوية' : 'adjustments'}</p>
                <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
                  {isAr ? 'يُحسب في صافي الربح — ليس بندًا إضافيًا في صادر الخزنة.' : 'In net profit — not an extra treasury outflow line.'}
                </p>
              </CardContent>
            </Card>
            <Card className="glass-card border-l-4 border-l-orange-500">
              <CardContent className="pt-6">
                <p className="text-xs text-muted-foreground">{isAr ? 'المرتجعات والاستردادات' : 'Returns & Refunds'}</p>
                <p className="text-xl font-bold text-orange-500">{financials.totalRefunds.toLocaleString()} EGP</p>
                <p className="text-xs text-muted-foreground mt-1">{financials.totalReturnsCount} {isAr ? 'مرتجع' : 'returns'} ({financials.damagedReturns} {isAr ? 'تالف' : 'damaged'})</p>
                <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
                  {isAr ? 'يُحسب في صافي الربح — ليس بندًا إضافيًا في صادر الخزنة.' : 'In net profit — not an extra treasury outflow line.'}
                </p>
              </CardContent>
            </Card>
            <Card className="glass-card border-l-4 border-l-yellow-500/80 bg-muted/20">
              <CardContent className="pt-6">
                <p className="text-xs text-muted-foreground">{isAr ? 'مستحقات الموردين (ديون)' : 'Supplier payables (AP)'}</p>
                <p className="text-xl font-bold text-yellow-600 inline-flex items-center gap-2 tabular-nums">
                  {financials.supplierPayables.toLocaleString()} EGP
                  {supplierSummariesPending && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" aria-hidden />
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                  {supplierSummariesPending
                    ? (isAr ? 'جاري مزامنة أرصدة الموردين…' : 'Syncing supplier balances…')
                    : isAr
                      ? 'رصيد مستحق — يُطرح من «صافي رأس المال الحقيقي» فقط؛ ليس صرفًا نقديًا في إجمالي الصادر.'
                      : 'Outstanding AP — subtracted in net real capital only; not cash outflow in total outbound.'}
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ===== Expense breakdown tab (revenue vs purchases + expense categories) ===== */}
        <TabsContent value="pnl" className="space-y-6 mt-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg">{isAr ? 'تفصيل المصروفات' : 'Expense breakdown'}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {/* Revenue */}
                <div className="flex justify-between items-center p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                  <span className="font-semibold text-green-500">{isAr ? 'الإيرادات (المبيعات)' : 'Revenue (Sales)'}</span>
                  <span className="font-bold text-green-500 text-lg">+{financials.totalRevenue.toLocaleString()} EGP</span>
                </div>

                {/* COGS */}
                <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                  <span className="text-muted-foreground ps-4">{isAr ? '(-) تكلفة البضاعة المباعة' : '(-) Cost of Goods Sold'}</span>
                  <span className="font-medium text-red-400">-{financials.totalPurchases.toLocaleString()} EGP</span>
                </div>

                {/* Gross Profit */}
                <div className="flex justify-between items-center p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
                  <span className="font-semibold text-blue-500">{isAr ? '= مجمل الربح' : '= Gross Profit'}</span>
                  <span className={`font-bold text-lg ${financials.grossProfit >= 0 ? 'text-blue-500' : 'text-red-500'}`}>
                    {financials.grossProfit.toLocaleString()} EGP
                    <span className="text-xs text-muted-foreground ms-2">({financials.grossMargin.toFixed(1)}%)</span>
                  </span>
                </div>

                {/* Operating Expenses */}
                <div className="ps-4 space-y-1 pt-2">
                  <p className="text-sm font-medium text-muted-foreground mb-2">{isAr ? 'المصروفات التشغيلية:' : 'Operating Expenses:'}</p>
                  {[
                    { label: isAr ? 'الشحن والتوصيل' : 'Shipping & Delivery', value: financials.shippingExpenses, icon: Truck },
                    { label: isAr ? 'التسويق والإعلانات' : 'Marketing & Ads', value: financials.marketingExpenses, icon: BarChart3 },
                    { label: isAr ? 'الإيجار والمرافق' : 'Rent & Utilities', value: financials.rentExpenses, icon: Landmark },
                    { label: isAr ? 'الرواتب والأجور' : 'Salaries & Wages', value: financials.salariesExpenses, icon: Wallet },
                    { label: isAr ? 'مصروفات أخرى' : 'Other Expenses', value: financials.otherExpenses, icon: DollarSign },
                  ].filter(e => e.value > 0).map((exp) => {
                    const ExpIcon = exp.icon;
                    const pct = financials.totalExpenses > 0 ? ((exp.value / financials.totalExpenses) * 100).toFixed(1) : '0';
                    return (
                      <div key={exp.label} className="flex justify-between items-center p-2 rounded-lg bg-muted/30">
                        <span className="flex items-center gap-2 text-sm text-muted-foreground">
                          <ExpIcon className="w-3.5 h-3.5" />
                          {exp.label}
                          <Badge variant="outline" className="text-[10px]">{pct}%</Badge>
                        </span>
                        <span className="text-sm text-red-400">-{exp.value.toLocaleString()} EGP</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                  <span className="text-muted-foreground ps-4">{isAr ? '(-) إجمالي المصروفات التشغيلية' : '(-) Total Operating Expenses'}</span>
                  <span className="font-medium text-red-400">-{financials.totalExpenses.toLocaleString()} EGP</span>
                </div>

                {/* Losses */}
                <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                  <span className="text-muted-foreground ps-4">{isAr ? '(-) خسائر المخزون (تلف/سرقة/منتهي)' : '(-) Inventory Losses (Damage/Theft/Expired)'}</span>
                  <span className="font-medium text-red-400">-{financials.totalLossAmount.toLocaleString()} EGP</span>
                </div>

                {/* Returns */}
                <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                  <span className="text-muted-foreground ps-4">{isAr ? '(-) المرتجعات والاستردادات' : '(-) Returns & Refunds'}</span>
                  <span className="font-medium text-orange-400">-{financials.totalRefunds.toLocaleString()} EGP</span>
                </div>

                {/* Net Profit */}
                <div className={`flex justify-between items-center p-4 rounded-lg border-2 ${financials.netProfit >= 0 ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-red-500/5 border-red-500/30'}`}>
                  <span className="font-bold text-lg">{isAr ? '= صافي الربح' : '= Net Profit'}</span>
                  <span className={`font-bold text-xl ${financials.netProfit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {financials.netProfit >= 0 ? '+' : ''}{financials.netProfit.toLocaleString()} EGP
                    <span className="text-xs text-muted-foreground ms-2">({financials.netMargin.toFixed(1)}%)</span>
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== LOSSES & DAMAGES TAB ===== */}
        <TabsContent value="losses" className="space-y-6 mt-6">
          {/* Losses Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="glass-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-red-500/10">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{isAr ? 'إجمالي خسائر المخزون' : 'Total Inventory Losses'}</p>
                    <p className="text-xl font-bold text-red-500">{financials.totalLossAmount.toLocaleString()} EGP</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-orange-500/10">
                    <RotateCcw className="w-5 h-5 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{isAr ? 'المرتجعات والاستردادات' : 'Returns & Refunds'}</p>
                    <p className="text-xl font-bold text-orange-500">{financials.totalRefunds.toLocaleString()} EGP</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-purple-500/10">
                    <Ban className="w-5 h-5 text-purple-500" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{isAr ? 'المنتجات التالفة' : 'Damaged Products'}</p>
                    <p className="text-xl font-bold text-purple-500">{financials.damagedAmount.toLocaleString()} EGP</p>
                    <p className="text-xs text-muted-foreground">{financials.damagedReturns} {isAr ? 'عنصر' : 'items'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-yellow-500/10">
                    <Scale className="w-5 h-5 text-yellow-500" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{isAr ? 'إجمالي تأثير الخسائر' : 'Combined Loss Impact'}</p>
                    <p className="text-xl font-bold text-yellow-500">
                      {(financials.totalLossAmount + financials.totalRefunds).toLocaleString()} EGP
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {financials.totalRevenue > 0
                        ? `${(((financials.totalLossAmount + financials.totalRefunds) / financials.totalRevenue) * 100).toFixed(1)}% ${isAr ? 'من الإيراد' : 'of revenue'}`
                        : `0% ${isAr ? 'من الإيراد' : 'of revenue'}`}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Loss Breakdown by Type */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg">{isAr ? 'تفصيل تسويات المخزون' : 'Inventory Adjustment Breakdown'}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(financials.lossesByType).length === 0 ? (
                  <p className="text-center text-muted-foreground py-6">{isAr ? 'لا توجد تسويات مخزون مسجلة بعد' : 'No inventory adjustments recorded yet'}</p>
                ) : (
                  Object.entries(financials.lossesByType).map(([type, data]) => {
                    const pct = financials.totalLossAmount > 0 ? (data.amount / financials.totalLossAmount) * 100 : 0;
                    const typeColors: Record<string, string> = {
                      DAMAGE: 'bg-red-500',
                      LOST: 'bg-orange-500',
                      THEFT: 'bg-purple-500',
                      EXPIRED: 'bg-blue-500',
                      CORRECTION: 'bg-gray-500',
                    };
                    return (
                      <div key={type} className="flex items-center gap-4">
                        <Badge className={`${typeColors[type] || 'bg-gray-500'} text-white w-24 justify-center`}>
                          {type}
                        </Badge>
                        <div className="flex-1">
                          <div className="w-full bg-muted rounded-full h-3">
                            <div
                              className={`${typeColors[type] || 'bg-gray-500'} rounded-full h-3 transition-all`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-sm font-medium w-20 text-right">{data.count} items</span>
                        <span className="text-sm font-bold text-red-500 w-32 text-right">{data.amount.toLocaleString()} EGP</span>
                        <span className="text-xs text-muted-foreground w-12 text-right">{pct.toFixed(1)}%</span>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== BY CHANNEL TAB ===== */}
        <TabsContent value="channels" className="space-y-6 mt-6">
          {financials.channelArray.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Store className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>{isAr ? 'لا توجد بيانات قنوات حالياً. اربط القنوات بطلباتك لعرض التحليل.' : 'No channel data available. Assign channels to your orders to see breakdowns.'}</p>
            </div>
          ) : (
            <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-lg">{isAr ? 'مقارنة أداء القنوات' : 'Channel Performance Comparison'}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{isAr ? 'القناة' : 'Channel'}</TableHead>
                        <TableHead className="text-right">{isAr ? 'الطلبات' : 'Orders'}</TableHead>
                        <TableHead className="text-right">{isAr ? 'الإيراد' : 'Revenue'}</TableHead>
                        <TableHead className="text-right">{isAr ? 'نسبة المساهمة %' : 'Share %'}</TableHead>
                        <TableHead className="text-right">{isAr ? 'الرسوم' : 'Fees'}</TableHead>
                        <TableHead className="text-right">{isAr ? 'المرتجعات' : 'Returns'}</TableHead>
                        <TableHead className="text-right">{isAr ? 'معدل المرتجعات' : 'Return Rate'}</TableHead>
                        <TableHead className="text-right">{isAr ? 'الصافي بعد الرسوم' : 'Net After Fees'}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {financials.channelArray.map((ch) => {
                        const revPct = financials.totalRevenue > 0 ? (ch.revenue / financials.totalRevenue) * 100 : 0;
                        const returnRate = ch.orders > 0 ? (ch.returns / ch.orders) * 100 : 0;
                        const netAfterFees = ch.revenue - ch.platformFees - ch.shippingFees - ch.returnAmount;
                        return (
                          <TableRow key={ch.name}>
                            <TableCell className="font-medium">{ch.name}</TableCell>
                            <TableCell className="text-right">{ch.orders}</TableCell>
                            <TableCell className="text-right text-green-500 font-medium">{ch.revenue.toLocaleString()}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-12 bg-muted rounded-full h-2">
                                  <div className="bg-primary rounded-full h-2" style={{ width: `${revPct}%` }} />
                                </div>
                                {revPct.toFixed(1)}%
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-red-400">
                              {(ch.platformFees + ch.shippingFees).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right text-orange-400">
                              {ch.returnAmount > 0 ? ch.returnAmount.toLocaleString() : '-'}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant={returnRate > 10 ? 'destructive' : returnRate > 5 ? 'secondary' : 'outline'}>
                                {returnRate.toFixed(1)}%
                              </Badge>
                            </TableCell>
                            <TableCell className={`text-right font-bold ${netAfterFees >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {netAfterFees.toLocaleString()} EGP
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
          )}
        </TabsContent>

        {/* ===== CAPITAL SOURCES TAB ===== */}
        <TabsContent value="capital" className="space-y-6 mt-6">
          <Card className="glass-card border-primary/25 w-full max-w-md">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <PiggyBank className="w-5 h-5 text-primary shrink-0" />
                  </div>
                  <span className="font-semibold text-sm truncate">
                    {isAr ? 'إدارة رأس المال' : 'Capital management'}
                  </span>
                </div>
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="gap-1 shrink-0 h-8 px-2.5">
                      <Plus className="w-4 h-4" />
                      {isAr ? 'إضافة' : 'Add'}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>{isAr ? 'إضافة مصدر رأس مال' : 'Add Capital Source'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>{isAr ? 'اسم المصدر' : 'Source Name'}</Label>
                        <Input
                          placeholder={isAr ? 'مثال: شريك أ، قرض، مدخرات' : 'e.g. Partner A, Loan, Savings'}
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>{isAr ? 'النوع' : 'Type'}</Label>
                          <Select value={formData.type} onValueChange={(v) => setFormData({ ...formData, type: v })}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="personal">{isAr ? 'شخصي' : 'Personal'}</SelectItem>
                              <SelectItem value="partner">{isAr ? 'شريك' : 'Partner'}</SelectItem>
                              <SelectItem value="loan">{isAr ? 'قرض' : 'Loan'}</SelectItem>
                              <SelectItem value="investor">{isAr ? 'مستثمر' : 'Investor'}</SelectItem>
                              <SelectItem value="retained_earnings">{isAr ? 'أرباح محتجزة' : 'Retained Earnings'}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>{isAr ? 'المبلغ' : 'Amount'}</Label>
                          <Input
                            type="number"
                            placeholder="0.00"
                            value={formData.amount}
                            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>{isAr ? 'نسبة الملكية %' : 'Ownership %'}</Label>
                        <Input
                          type="number"
                          placeholder="100"
                          value={formData.ownership_percentage}
                          onChange={(e) => setFormData({ ...formData, ownership_percentage: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{isAr ? 'تاريخ الإيداع (في المقبوضات)' : 'Deposit date (receipt)'}</Label>
                        <Input
                          type="date"
                          value={formData.receipt_date}
                          onChange={(e) => setFormData({ ...formData, receipt_date: e.target.value })}
                        />
                        <p className="text-[11px] text-muted-foreground leading-snug">
                          {isAr
                            ? 'اختياري — للإدخالات القديمة قبل الخزنة ضع تاريخ بداية النشاط (مثلاً 2025-01-01). يُنشأ إيصال مقبوضات تلقائياً بهذا التاريخ.'
                            : 'Optional — for legacy capital use your business start date (e.g. 2025-01-01). A receipt is created automatically.'}
                        </p>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                        {isAr ? 'إلغاء' : 'Cancel'}
                      </Button>
                      <Button onClick={handleSubmit} disabled={createMutation.isPending}>
                        {createMutation.isPending ? (isAr ? 'جاري الحفظ...' : 'Saving...') : (isAr ? 'حفظ' : 'Save')}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
              <p className="text-xs text-muted-foreground">{isAr ? 'إجمالي رأس المال' : 'Total capital'}</p>
              <p className="text-2xl font-bold tabular-nums">
                {treasuryStatsResolved.total_capital.toLocaleString()} EGP
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="glass-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-green-500/10">
                    <TrendingUp className="w-5 h-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{isAr ? 'مصادر رأس المال' : 'Capital Sources'}</p>
                    <p className="text-2xl font-bold">{sources.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-orange-500/10">
                    <ArrowDownCircle className="w-5 h-5 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{isAr ? 'مستحقات الموردين' : 'Supplier Payables'}</p>
                    <p className="text-2xl font-bold text-orange-500 inline-flex items-center gap-2">
                      {financials.supplierPayables.toLocaleString()} EGP
                      {supplierSummariesPending && (
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground shrink-0" aria-hidden />
                      )}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={isAr ? 'ابحث في مصادر رأس المال...' : 'Search capital sources...'}
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <Card className="glass-card">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{isAr ? 'الاسم' : 'Name'}</TableHead>
                    <TableHead>{isAr ? 'النوع' : 'Type'}</TableHead>
                    <TableHead className="text-right">{isAr ? 'المبلغ' : 'Amount'}</TableHead>
                    <TableHead className="text-right">{isAr ? 'نسبة الملكية %' : 'Ownership %'}</TableHead>
                    <TableHead>{isAr ? 'الحالة' : 'Status'}</TableHead>
                    <TableHead className="w-[88px] text-center">{isAr ? 'إجراءات' : 'Actions'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sources.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                        {isAr ? 'لا توجد مصادر رأس مال مضافة بعد. اضغط "إضافة مصدر رأس مال" للبدء.' : 'No capital sources added yet. Click "Add Capital Source" to begin.'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    sources
                      .filter((c: any) => c.name?.toLowerCase().includes(search.toLowerCase()))
                      .map((source: any) => (
                        <TableRow key={source.id}>
                          <TableCell className="font-medium">{source.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">{source.type}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium">{Number(source.amount || 0).toLocaleString()} EGP</TableCell>
                          <TableCell className="text-right">{source.ownership_percentage || 100}%</TableCell>
                          <TableCell>
                            <Badge variant="default">{isAr ? 'نشط' : 'Active'}</Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                              title={isAr ? 'حذف' : 'Delete'}
                              disabled={deletingSourceId === String(source.id) || deleteMutation.isPending}
                              onClick={() => handleDeleteSource(source)}
                            >
                              {deletingSourceId === String(source.id) ? (
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                              ) : (
                                <Trash2 className="h-4 w-4" aria-hidden />
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
