import React, { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Loader2,
  BarChart3,
  Percent,
  Package,
  ShoppingCart,
  Truck,
  Store,
  Globe,
  RotateCcw,
  AlertTriangle,
  ArrowRight,
  Wallet,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  ShoppingBag,
  Table2,
} from 'lucide-react';
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
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useSupplierAccountSummaries } from '@/hooks/useSupplierAccountSummaries';
import { getSupplierOutstanding } from '@/lib/supplierOutstanding';
import { PeriodActualProfitKpis } from '@/components/finance/PeriodActualProfitKpis';

const toDateInput = (date: Date) => date.toISOString().slice(0, 10);
const toNumber = (value: any) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const formatNumber = (value: any, options?: Intl.NumberFormatOptions) =>
  toNumber(value).toLocaleString('en-US', options);
const formatDate = (value: any) => {
  const d = new Date(value || 0);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-GB');
};

/** Normalize Amazon / internal order ids for matching settlement rows (align with backend settlement normalization). */
const normalizePlatformOrderKey = (raw: unknown): string => {
  let s = String(raw ?? '').trim();
  s = s.replace(/^['"]+|['"]+$/g, '');
  return s.replace(/\s+/gu, '');
};

const normalizeSkuKey = (raw: unknown): string =>
  String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/gu, '');

const orderItemSkuKeys = (item: any): string[] => {
  const keys = new Set<string>();
  [item?.sku_code, item?.sku?.sku, item?.sku?.code].forEach((candidate) => {
    const k = normalizeSkuKey(candidate);
    if (k) keys.add(k);
  });
  return [...keys];
};

const matchSettlementSkuKey = (itemSkuKeys: string[], orderSkuMap: Record<string, any>): string | null => {
  for (const key of itemSkuKeys) {
    if (orderSkuMap[key] !== undefined) return key;
  }
  return null;
};

type SettlementSkuEconomics = { revenue: number; purchaseCost: number; matched: boolean };

const settlementAwareLineEconomics = (
  item: any,
  lineQty: number,
  purchaseUnit: number,
  orderItems: any[],
  orderSkuMap: Record<string, { net?: number; principal_qty?: number; principalQty?: number }>
): SettlementSkuEconomics => {
  const matchKey = matchSettlementSkuKey(orderItemSkuKeys(item), orderSkuMap);
  if (!matchKey || lineQty <= 0) {
    return { revenue: 0, purchaseCost: 0, matched: false };
  }

  let totalInvoiceQty = 0;
  orderItems.forEach((row) => {
    if (matchSettlementSkuKey(orderItemSkuKeys(row), orderSkuMap) === matchKey) {
      totalInvoiceQty += toNumber(row.quantity);
    }
  });
  if (totalInvoiceQty <= 0) {
    return { revenue: 0, purchaseCost: 0, matched: true };
  }

  const skuPayload = orderSkuMap[matchKey] || {};
  const skuNet = toNumber(skuPayload.net);
  const principalQty = toNumber(skuPayload.principal_qty ?? skuPayload.principalQty);
  const effectiveQty =
    principalQty > 0 ? Math.min(totalInvoiceQty, principalQty) : skuNet > 0 ? Math.min(totalInvoiceQty, 1) : 0;
  const qtyScale = effectiveQty / totalInvoiceQty;

  return {
    revenue: (lineQty / totalInvoiceQty) * skuNet,
    purchaseCost: lineQty * purchaseUnit * qtyScale,
    matched: true,
  };
};

const pickFirstPositive = (...values: any[]) => {
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

/** Align with Orders / marketplace import: cancelled rows must not affect period profit. */
const isOrderCancelledRecord = (order: any): boolean => {
  if (!order) return false;
  const st = String(order.status || '').toLowerCase();
  const fin = String(order.financial_status || order.financialStatus || '').toLowerCase();
  return st === 'cancelled' || fin === 'cancelled';
};

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

const viewTitlesEn: Record<string, string> = {
  'by-period': 'Period Profit',
  'by-sku': 'Profit by SKU',
  'by-product': 'Profit by Master Product',
  'by-channel': 'Profit by Channel',
  'capital-cycle': 'Capital Cycle Analysis',
  'roi': 'Return on Investment (ROI)',
};
const viewTitlesAr: Record<string, string> = {
  'by-period': 'أرباح فترة',
  'by-sku': 'الربح حسب SKU',
  'by-product': 'الربح حسب المنتج الرئيسي',
  'by-channel': 'الربح حسب القناة',
  'capital-cycle': 'تحليل دورة رأس المال',
  'roi': 'العائد على الاستثمار',
};

const CHANNEL_ICONS: Record<string, any> = {
  amazon: ShoppingCart,
  noon: Store,
  jumia: Globe,
  website: Globe,
  store: Store,
};

export default function ProfitEngine() {
  const { language, dir, t } = useLanguage();
  const isAr = language === 'ar';
  const location = useLocation();
  const navigate = useNavigate();
  const view = location.pathname.replace('/profit/', '');
  const title = (isAr ? viewTitlesAr : viewTitlesEn)[view || ''] || (isAr ? 'محرك الأرباح' : 'Profit Engine');
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    return toDateInput(d);
  });
  const [endDate, setEndDate] = useState<string>(() => toDateInput(new Date()));
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [importChannel, setImportChannel] = useState<string>('');
  const [importingFees, setImportingFees] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({
    key: 'net_profit',
    direction: 'desc',
  });
  const [periodSortConfig, setPeriodSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({
    key: 'net',
    direction: 'desc',
  });
  const [periodSearchTerm, setPeriodSearchTerm] = useState('');
  /** When true, the main period table lists only orders not yet marked settled (for review). Default shows settled-only rows. */
  const [periodUnsettledOnly, setPeriodUnsettledOnly] = useState(false);
  const [expandedMasterRows, setExpandedMasterRows] = useState<Record<string, boolean>>({});
  const isPeriodValid = Boolean(startDate && endDate && startDate <= endDate);

  const settlementDateParams = useMemo(
    () => (isPeriodValid ? { start_date: startDate, end_date: endDate } : {}),
    [isPeriodValid, startDate, endDate]
  );

  const needsPeriodOrders = view === 'by-period' || view === 'by-channel';
  const needsProfitSummary = isPeriodValid && view !== 'roi' && view !== 'capital-cycle';

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['profit-summary', startDate, endDate, channelFilter],
    queryFn: () => api.get('/reports/profit-summary', {
      params: {
        start_date: startDate,
        end_date: endDate,
        channel: channelFilter !== 'all' ? channelFilter : undefined,
      },
    }),
    enabled: needsProfitSummary,
    staleTime: 120_000,
  });

  const { data: bySku, isLoading: loadingSku } = useQuery({
    queryKey: ['profit-by-sku', startDate, endDate, channelFilter],
    queryFn: () => api.getArray('/reports/profit-by-sku', {
      params: {
        start_date: startDate,
        end_date: endDate,
        limit: 200,
        channel: channelFilter !== 'all' ? channelFilter : undefined,
      },
    }),
    enabled: (view === 'by-sku' || view === 'by-product' || view === 'by-channel') && isPeriodValid,
    staleTime: 120_000,
  });

  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['orders-for-profit', startDate, endDate, channelFilter],
    queryFn: () =>
      api.getArray('/orders', {
        params: {
          for_profit: 1,
          start_date: startDate,
          end_date: endDate,
          ...(channelFilter !== 'all' ? { channel: channelFilter } : {}),
        },
      }),
    enabled: needsPeriodOrders && isPeriodValid,
    staleTime: 120_000,
  });

  const { data: roiMetrics, isLoading: loadingRoiMetrics } = useQuery({
    queryKey: ['roi-metrics', startDate, endDate],
    queryFn: () =>
      api.get('/reports/roi-metrics', {
        params: { start_date: startDate, end_date: endDate },
      }),
    enabled: (view === 'roi' || view === 'capital-cycle') && isPeriodValid,
    staleTime: 120_000,
  });

  /** Sum of settlement line `amount` per marketplace order (released lines in selected period). */
  const { data: settlementOrderNetPayload, isLoading: loadingSettlementNets } = useQuery({
    queryKey: ['settlement-order-net-totals', channelFilter, startDate, endDate],
    queryFn: () =>
      api.get<{ by_order_id?: Record<string, number> }>('settlements/order-net-totals', {
        params: {
          ...settlementDateParams,
          ...(channelFilter !== 'all' ? { channel_id: channelFilter } : {}),
        },
      }),
    enabled: view === 'by-period' && isPeriodValid,
    staleTime: 300_000,
  });

  const orderNetByOrderKey = useMemo(() => {
    const raw = (settlementOrderNetPayload as { by_order_id?: Record<string, number> } | undefined)?.by_order_id ?? {};
    const out: Record<string, number> = {};
    Object.entries(raw).forEach(([k, v]) => {
      const key = normalizePlatformOrderKey(k);
      if (!key) return;
      out[key] = (out[key] ?? 0) + toNumber(v);
    });
    return out;
  }, [settlementOrderNetPayload]);

  const { data: settlementOrderSkuNetPayload } = useQuery({
    queryKey: ['settlement-order-sku-net-totals', channelFilter, startDate, endDate],
    queryFn: () =>
      api.get<{ by_order_id?: Record<string, Record<string, { net?: number; principal_qty?: number }>> }>(
        'settlements/order-sku-net-totals',
        {
          params: {
            ...settlementDateParams,
            ...(channelFilter !== 'all' ? { channel_id: channelFilter } : {}),
          },
        }
      ),
    enabled: view === 'by-period' && isPeriodValid,
    staleTime: 300_000,
  });

  const orderSkuNetByOrderKey = useMemo(() => {
    const raw =
      (settlementOrderSkuNetPayload as { by_order_id?: Record<string, Record<string, { net?: number; principal_qty?: number }>> } | undefined)
        ?.by_order_id ?? {};
    const out: Record<string, Record<string, { net?: number; principal_qty?: number }>> = {};
    Object.entries(raw).forEach(([orderId, skuMap]) => {
      const orderKey = normalizePlatformOrderKey(orderId);
      if (!orderKey || !skuMap || typeof skuMap !== 'object') return;
      out[orderKey] = out[orderKey] || {};
      Object.entries(skuMap).forEach(([sku, payload]) => {
        const skuKey = normalizeSkuKey(sku);
        if (!skuKey) return;
        const prev = out[orderKey][skuKey] || { net: 0, principal_qty: 0 };
        out[orderKey][skuKey] = {
          net: toNumber(prev.net) + toNumber(payload?.net),
          principal_qty: toNumber(prev.principal_qty) + toNumber(payload?.principal_qty),
        };
      });
    });
    return out;
  }, [settlementOrderSkuNetPayload]);

  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.getArray('/channels'),
    enabled: true,
  });

  const channelOptions = useMemo(
    () =>
      (channels || []).map((ch: any) => ({
        value: String(ch.id),
        label: ch.name || ch.slug || `Channel ${ch.id}`,
      })),
    [channels]
  );

  useEffect(() => {
    if (!channelOptions.length) return;

    if (!importChannel || !channelOptions.some((c) => c.value === importChannel)) {
      setImportChannel(channelOptions[0].value);
    }
    if (channelFilter !== 'all' && !channelOptions.some((c) => c.value === channelFilter)) {
      setChannelFilter('all');
    }
  }, [channelOptions, importChannel, channelFilter]);

  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => api.getArray('/expenses'),
    enabled: view === 'by-period' || view === 'by-channel',
    staleTime: 120_000,
  });

  const { data: receipts = [] } = useQuery({
    queryKey: ['receipts-for-profit-balance'],
    queryFn: () => api.getArray('/receipts'),
    enabled: view !== 'by-period' && view !== 'roi',
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['payments-for-profit-balance'],
    queryFn: () => api.getArray('/payments'),
    enabled: view !== 'by-period' && view !== 'roi',
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-for-profit-balance'],
    queryFn: () => api.getArray('/suppliers'),
    enabled: view !== 'by-period' && view !== 'roi',
  });

  const { summaryMap } = useSupplierAccountSummaries(suppliers);

  const { data: returns = [] } = useQuery({
    queryKey: ['returns-for-profit', startDate, endDate],
    queryFn: () => api.getArray('/returns'),
    enabled: (view === 'by-period' || view === 'by-channel') && isPeriodValid,
    staleTime: 120_000,
  });

  const { data: capitalSources = [] } = useQuery({
    queryKey: ['capital-sources'],
    queryFn: () => api.getArray('/capital-sources'),
    enabled: view === 'roi' || view === 'capital-cycle',
    staleTime: 300_000,
  });

  const { data: currentInventoryCost = 0 } = useQuery({
    queryKey: ['inventory-current-cost'],
    queryFn: async () => {
      const skus = await api.getArray('/skus');
      return (skus || []).reduce((sum: number, sku: any) => {
        const qty = pickFirstPositive(
          sku.stock,
          Array.isArray(sku.inventory)
            ? sku.inventory.reduce((s: number, i: any) => s + toNumber(i?.quantity), 0)
            : 0,
          getLinkedMasterProduct(sku)?.total_stock
        );
        const unitCost = resolvePurchaseUnitCost(sku);
        return sum + (qty * unitCost);
      }, 0);
    },
    enabled: view !== 'by-period' && view !== 'roi',
  });

  const isLoading = useMemo(() => {
    if (!isPeriodValid && view !== 'roi' && view !== 'capital-cycle') return false;
    if (view === 'roi' || view === 'capital-cycle') return loadingRoiMetrics;
    if (view === 'by-period') {
      return loadingOrders || loadingSettlementNets;
    }
    if (view === 'by-channel') return loadingOrders || loadingSku;
    if (view === 'by-sku' || view === 'by-product') return loadingSku;
    return loadingSummary;
  }, [
    view,
    isPeriodValid,
    loadingRoiMetrics,
    loadingOrders,
    loadingSettlementNets,
    loadingSku,
    loadingSummary,
  ]);

  const profitData = summary as any || {};
  const totalRevenue = Number(profitData.revenue ?? profitData.total_revenue ?? 0);
  const totalCogs = Number(profitData.cogs ?? profitData.total_cogs ?? 0);
  const totalExpenses = Number(profitData.expenses ?? profitData.total_expenses ?? 0);
  const totalOrderCosts = Number(profitData.order_costs ?? 0);
  const totalRefunds = Number(profitData.refunds ?? 0);
  const netProfit = Number(profitData.net_profit ?? 0);
  const totalExpensesCombined = totalExpenses + totalOrderCosts;

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

  // Same outstanding rule as Finance → Suppliers / Capital (account-summary), not raw DB balance.
  const suppliersDueTotal = useMemo(
    () =>
      (suppliers || []).reduce(
        (sum: number, supplier: any) => sum + Math.max(0, getSupplierOutstanding(supplier, summaryMap)),
        0
      ),
    [suppliers, summaryMap]
  );
  const netAfterSuppliers = toNumber(balanceNowData.totalBalanceNow) - toNumber(suppliersDueTotal);

  const handleImportFees = async (file: File | null) => {
    if (!file) return;
    setImportingFees(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('channel_id', importChannel);
      formData.append('channel', importChannel);
      await api.upload('/reports/platform-fees/import', formData);
      window.location.reload();
    } finally {
      setImportingFees(false);
    }
  };

  const parseDateValue = (v: any) => {
    const d = new Date(v || 0);
    return isNaN(d.getTime()) ? null : d;
  };

  const inRange = (value: any) => {
    const d = parseDateValue(value);
    if (!d) return false;
    const start = parseDateValue(startDate);
    const end = parseDateValue(endDate);
    if (!start || !end) return true;
    return d >= start && d <= end;
  };

  const normalizedReturns = useMemo(() => {
    if (Array.isArray(returns)) return returns;
    if (Array.isArray((returns as any)?.data)) return (returns as any).data;
    return [];
  }, [returns]);

  // By-channel calculation (derived from filtered by-SKU data for period consistency)
  const channelProfitData = useMemo(() => {
    if (!(view === 'by-channel' || view === 'by-period') || isLoading) return [];
    const rows = Array.isArray(bySku) ? bySku : [];
    if (!rows.length) return [];

    const grouped: Record<string, {
      name: string;
      revenue: number;
      cogs: number;
      returnsAmount: number;
      additionalCosts: number;
      quantitySold: number;
      netProfit: number;
    }> = {};

    rows.forEach((row: any) => {
      const name = row.channel_name || 'Direct / Manual';
      if (!grouped[name]) {
        grouped[name] = {
          name,
          revenue: 0,
          cogs: 0,
          returnsAmount: 0,
          additionalCosts: 0,
          quantitySold: 0,
          netProfit: 0,
        };
      }

      grouped[name].revenue += Number(row.revenue || 0);
      grouped[name].cogs += Number(row.cogs || 0);
      grouped[name].returnsAmount += Number(row.returns_amount || 0);
      grouped[name].additionalCosts += Number(row.additional_costs || 0);
      grouped[name].quantitySold += Number(row.quantity_sold || 0);
      grouped[name].netProfit += Number(row.net_profit || 0);
    });

    const total = Object.values(grouped).reduce((sum, c) => sum + c.revenue, 0);
    return Object.values(grouped)
      .map((c) => ({
        ...c,
        margin: c.revenue > 0 ? (c.netProfit / c.revenue) * 100 : 0,
        revenueShare: total > 0 ? (c.revenue / total) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [view, bySku, isLoading]);

  const channelProfitFallback = useMemo(() => {
    if (!(view === 'by-channel' || view === 'by-period')) return [];
    const orderRows = Array.isArray(orders) ? orders : [];
    const expenseRows = Array.isArray(expenses) ? expenses : [];
    const channelMap: Record<string, any> = {};

    const filteredOrders = orderRows.filter((o: any) => {
      const orderDate = o.order_date || o.created_at;
      if (!inRange(orderDate)) return false;
      if (isOrderCancelledRecord(o)) return false;
      if (channelFilter === 'all') return true;
      return String(o.channel_id || o.channel?.id || '') === String(channelFilter);
    });

    filteredOrders.forEach((order: any) => {
      const channelName = order.channel?.name || order.marketplace_source || 'Direct / Manual';
      if (!channelMap[channelName]) {
        channelMap[channelName] = {
          name: channelName,
          revenue: 0,
          cogs: 0,
          returnsAmount: 0,
          additionalCosts: 0,
          quantitySold: 0,
          netProfit: 0,
        };
      }
      channelMap[channelName].revenue += Number(order.total_amount || 0);
      const orderCosts = (Array.isArray(order.costs) ? order.costs : []).reduce(
        (s: number, c: any) => s + Math.abs(Number(c?.amount || 0)),
        0
      );
      const settlementDeductions = (Array.isArray(order.settlement_items) ? order.settlement_items : Array.isArray(order.settlementItems) ? order.settlementItems : [])
        .reduce((s: number, it: any) => {
          const amount = Number(it?.amount || 0);
          return amount < 0 ? s + Math.abs(amount) : s;
        }, 0);
      channelMap[channelName].additionalCosts += orderCosts + settlementDeductions;
      const items = Array.isArray(order.items) ? order.items : [];
      items.forEach((it: any) => {
        const qty = Number(it.quantity || 0);
        const cost = resolvePurchaseUnitCost(it);
        channelMap[channelName].quantitySold += qty;
        channelMap[channelName].cogs += qty * cost;
      });
    });

    normalizedReturns.forEach((ret: any) => {
      const basisDate = ret.return_date || ret.created_at;
      if (!inRange(basisDate)) return;
      const linkedOrder = ret.inventory_order || ret.order;
      if (linkedOrder && isOrderCancelledRecord(linkedOrder)) return;
      const channelName =
        ret.inventory_order?.channel?.name
        || ret.order?.channel?.name
        || ret.source_channel
        || 'Direct / Manual';
      if (!channelMap[channelName]) {
        channelMap[channelName] = {
          name: channelName,
          revenue: 0,
          cogs: 0,
          returnsAmount: 0,
          additionalCosts: 0,
          quantitySold: 0,
          netProfit: 0,
        };
      }
      channelMap[channelName].returnsAmount += Number(ret.refund_amount || 0);
    });

    const shippingExpenses = expenseRows
      .filter((e: any) => String(e.category || '').toLowerCase().includes('shipping'))
      .filter((e: any) => inRange(e.expense_date || e.created_at))
      .reduce((s: number, e: any) => s + Number(e.amount || 0), 0);

    const totalRevenueLocal = Object.values(channelMap).reduce((s: number, c: any) => s + c.revenue, 0);
    const rows = Object.values(channelMap).map((c: any) => {
      const shippingShare = totalRevenueLocal > 0 ? (c.revenue / totalRevenueLocal) * shippingExpenses : 0;
      c.additionalCosts += shippingShare;
      c.netProfit = c.revenue - c.cogs - c.additionalCosts - c.returnsAmount;
      c.margin = c.revenue > 0 ? (c.netProfit / c.revenue) * 100 : 0;
      c.revenueShare = totalRevenueLocal > 0 ? (c.revenue / totalRevenueLocal) * 100 : 0;
      return c;
    });

    return rows.sort((a: any, b: any) => b.revenue - a.revenue);
  }, [view, orders, expenses, normalizedReturns, startDate, endDate, channelFilter]);

  const periodNetRowsRaw = useMemo(() => {
    if (view !== 'by-period') return [];

    const orderRows = (Array.isArray(orders) ? orders : []).filter((o: any) => {
      if (!inRange(o.order_date || o.created_at)) return false;
      if (isOrderCancelledRecord(o)) return false;
      if (channelFilter === 'all') return true;
      return String(o.channel_id || o.channel?.id || '') === String(channelFilter);
    });

    const returnRows = normalizedReturns.filter((r: any) => {
      if (!inRange(r.return_date || r.created_at)) return false;
      const linkedOrder = r.inventory_order || r.order;
      if (linkedOrder && isOrderCancelledRecord(linkedOrder)) return false;
      if (channelFilter === 'all') return true;
      const rChannelId = r.inventory_order?.channel_id || r.order?.channel_id || '';
      return String(rChannelId) === String(channelFilter);
    });

    const sales: any[] = [];
    orderRows.forEach((order: any) => {
      const items = Array.isArray(order.items) ? order.items : [];
      const orderRevenueGross = items.reduce(
        (s: number, i: any) => s + Number(i.total_price || Number(i.unit_price || 0) * Number(i.quantity || 0)),
        0
      );
      const settlementLines = Array.isArray(order.settlement_items)
        ? order.settlement_items
        : Array.isArray(order.settlementItems)
          ? order.settlementItems
          : [];

      /** Sum of `amount` on eager-loaded order lines (often only reconciled/matched subset — can under-count vs full sheet). */
      const sumSettlementLinesOnOrder =
        settlementLines.length > 0
          ? settlementLines.reduce((s: number, it: any) => s + toNumber(it?.amount), 0)
          : null;

      const orderKey = normalizePlatformOrderKey(order.platform_order_id);
      let rawAmazonNet = orderKey !== '' ? orderNetByOrderKey[orderKey] : undefined;
      if (rawAmazonNet === undefined && orderKey.includes('-')) {
        const compactKey = orderKey.replace(/-/g, '');
        if (compactKey !== '') {
          rawAmazonNet = orderNetByOrderKey[compactKey];
        }
      }
      const apiOrderNet = rawAmazonNet !== undefined ? toNumber(rawAmazonNet) : null;
      // Prefer API aggregate across all settlement sheets (same as order dialog «مجموع المبلغ»). Embedded order lines are a subset and used only if API has no key yet.
      const amazonNetSum =
        apiOrderNet !== null
          ? apiOrderNet
          : sumSettlementLinesOnOrder !== null && settlementLines.length > 0
            ? sumSettlementLinesOnOrder
            : NaN;
      const useAmazonNet = Number.isFinite(amazonNetSum);
      // Drop orders whose net settlement is zero or negative — invalid for profit-by-period.
      if (useAmazonNet && amazonNetSum <= 0) {
        return;
      }
      const orderSkuMap = orderKey !== '' ? orderSkuNetByOrderKey[orderKey] || {} : {};
      const hasSkuSettlementMap = useAmazonNet && Object.keys(orderSkuMap).length > 0;
      // When using settlement net as revenue, Amazon/platform fees are already inside `amazonNetSum`.
      // Do not allocate order_costs / settlement deduction totals onto SKU lines: those imports are often
      // incomplete duplicates of fees already embedded in list prices or settlement rows — caused phantom
      // per-line "extras" (~25 EGP) that users do not recognize as real cash.
      items.forEach((item: any, idx: number) => {
        const qty = Number(item.quantity || 0);
        const sellPrice = Number(item.unit_price || item.price || 0);
        // gross_revenue = السعر المعلن (سعر العرض × الكمية)
        const grossRevenue = Number(item.total_price || qty * sellPrice);
        const purchaseUnit = resolvePurchaseUnitCost(item);
        let revenue = grossRevenue;
        let purchaseCost = qty * purchaseUnit;

        if (useAmazonNet && hasSkuSettlementMap) {
          const economics = settlementAwareLineEconomics(item, qty, purchaseUnit, items, orderSkuMap);
          revenue = economics.revenue;
          purchaseCost = economics.purchaseCost;
        } else if (useAmazonNet) {
          if (orderRevenueGross > 0) {
            revenue = (grossRevenue / orderRevenueGross) * amazonNetSum;
          } else if (items.length > 0) {
            revenue = amazonNetSum / items.length;
          } else {
            revenue = 0;
          }
        }

        // الصافي = إيراد السطر − تكلفة الشراء (بدون توزيع رسوم طلب وهمي على السطر)
        const net = revenue - purchaseCost;
        const master = getLinkedMasterProduct(item);

        sales.push({
          id: `sale-${order.id}-${item.id || idx}`,
          date: order.order_date || order.created_at,
          type: 'sale',
          orderNo: order.platform_order_id || `#${order.id}`,
          sku: item.sku?.sku || item.sku_code || '-',
          product: item.product_name || master?.internal_name || item.sku?.name || '-',
          masterProductId: master?.id ?? null,
          masterProductName: master?.internal_name ?? null,
          channel: order.channel?.name || order.marketplace_source || '-',
          qty,
          // sellPrice = سعر الوحدة المعلن
          sellPrice,
          // listGross = سعر العرض الإجمالي (السعر × الكمية)
          listGross: grossRevenue,
          purchaseCost,
          // revenue = الإجمالي الفعلي (بعد خصم رسوم المنصة من ورقة التسوية)
          revenue,
          gross_revenue: grossRevenue,
          /** Full order settlement net (sum of XML/CSV line amounts); same for every SKU row of this order. */
          order_settlement_net_full: useAmazonNet ? amazonNetSum : null,
          /** Kept for sorting / legacy: equals full order net when Amazon net is used, else null. */
          amazon_order_net: useAmazonNet ? amazonNetSum : null,
          returns: 0,
          extraCosts: 0,
          net,
          status: order.status || '-',
          settledForSummary:
            String(order.settlement_status || order.settlementStatus || '').toLowerCase() === 'settled',
        });
      });
    });

    const returnsTx = returnRows.map((ret: any, idx: number) => {
      const refundAmt = Math.abs(Number(ret.refund_amount || 0));
      // خسارة الشحن عند المرتجع: تُضاف كتكلفة إضافية على المنتج (مثل أمازون)
      const shippingLoss = Math.abs(Number(
        ret.shipping_cost_loss
        || ret.metadata?.shipping_cost_loss
        || 0
      ));
      const returnQty = Number(ret.return_quantity || 0);

      // عكس تكلفة الشراء عند المرتجع (COGS reversal):
      // عند استلام المرتجع للمخزن، تكلفة الشراء تُسترجع، فيصبح أثرها + في الصافي.
      // نُسجّلها هنا كـ purchaseCost سالب ليظهر أنها عكس تكلفة شراء.
      const linkedOrder = ret.inventory_order || ret.order || null;
      const linkedItems = Array.isArray(linkedOrder?.items) ? linkedOrder.items : [];
      const matchItem =
        linkedItems.find((it: any) => String(it?.sku?.sku || it?.sku_code || '') === String(ret.sku_code || ''))
        || linkedItems[0]
        || null;
      const purchaseUnit = resolvePurchaseUnitCost(matchItem || ret);
      const purchaseCostReversal = -(Math.abs(returnQty) * purchaseUnit);

      // الصافي = -(Refund) - خسارة الشحن - (purchaseCostReversal)
      // لأن purchaseCostReversal سالب، طرحه يُضيف تكلفة الشراء المسترجعة (يرجع الربح لصفر تقريباً)
      const netOnReturn = -(refundAmt + shippingLoss) - purchaseCostReversal;
      const linkedForSettled = ret.inventory_order || ret.order;
      const settledForSummary =
        !!linkedForSettled
        && !isOrderCancelledRecord(linkedForSettled)
        && String(linkedForSettled.settlement_status || linkedForSettled.settlementStatus || '').toLowerCase()
          === 'settled';
      return {
        id: `ret-${ret.id || idx}`,
        date: ret.return_date || ret.created_at,
        type: 'return',
        orderNo: ret.inventory_order?.platform_order_id || ret.order?.order_number || '-',
        sku: ret.sku_code || '-',
        product: ret.inventory_order?.items?.[0]?.sku?.offer?.master_product?.internal_name || '-',
        masterProductId: ret.inventory_order?.items?.[0]?.sku?.offer?.master_product?.id ?? null,
        masterProductName: ret.inventory_order?.items?.[0]?.sku?.offer?.master_product?.internal_name ?? null,
        channel: ret.inventory_order?.channel?.name || ret.source_channel || '-',
        qty: returnQty,
        sellPrice: 0,
        listGross: 0,
        purchaseCost: purchaseCostReversal,
        revenue: 0,
        gross_revenue: 0,
        amazon_order_net: null as number | null,
        returns: refundAmt,
        // خسارة الشحن كتكلفة إضافية على المرتجع
        extraCosts: shippingLoss,
        net: netOnReturn,
        status: ret.status || ret.return_status || 'pending',
        settledForSummary,
      };
    });

    return [...sales, ...returnsTx].sort((a, b) => {
      const ad = new Date(a.date || 0).getTime();
      const bd = new Date(b.date || 0).getTime();
      return bd - ad;
    });
  }, [view, orders, normalizedReturns, channelFilter, startDate, endDate, orderNetByOrderKey, orderSkuNetByOrderKey]);

  /** Visible rows: default = settled only; toggle = unsettled only (for troubleshooting). */
  const periodNetRows = useMemo(() => {
    const rows = periodNetRowsRaw;
    if (periodUnsettledOnly) {
      return rows.filter((r) => !r.settledForSummary);
    }
    return rows.filter((r) => r.settledForSummary);
  }, [periodNetRowsRaw, periodUnsettledOnly]);

  /** Channel cards on «أرباح فترة»: same totals as the master-product table (sales + return rows, refunds in Returns column). */
  const channelProfitFromPeriod = useMemo(() => {
    if (view !== 'by-period') return [];
    const rows = periodNetRows;
    if (!rows.length) return [];

    const grouped: Record<string, {
      name: string;
      revenue: number;
      cogs: number;
      returnsAmount: number;
      additionalCosts: number;
      quantitySold: number;
      netProfit: number;
    }> = {};

    for (const row of rows) {
      const name = String(row.channel || 'Direct / Manual').trim() || 'Direct / Manual';
      if (!grouped[name]) {
        grouped[name] = {
          name,
          revenue: 0,
          cogs: 0,
          returnsAmount: 0,
          additionalCosts: 0,
          quantitySold: 0,
          netProfit: 0,
        };
      }
      const g = grouped[name];
      if (row.type === 'sale') {
        g.revenue += toNumber(row.revenue);
        g.cogs += toNumber(row.purchaseCost);
        g.additionalCosts += toNumber(row.extraCosts);
        g.quantitySold += Math.abs(toNumber(row.qty));
      } else {
        // Refunds + shipping loss from returns — keep separate from sale COGS so cards stay interpretable.
        g.returnsAmount += toNumber(row.returns) + toNumber(row.extraCosts);
      }
      g.netProfit += toNumber(row.net);
    }

    const totalRev = Object.values(grouped).reduce((sum, c) => sum + c.revenue, 0);
    return Object.values(grouped)
      .map((c) => ({
        ...c,
        margin: c.revenue > 0 ? (c.netProfit / c.revenue) * 100 : 0,
        revenueShare: totalRev > 0 ? (c.revenue / totalRev) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [view, periodNetRows]);

  const channelRows =
    view === 'by-period' && channelProfitFromPeriod.length > 0
      ? channelProfitFromPeriod
      : channelProfitData.length > 0
        ? channelProfitData
        : channelProfitFallback;

  const settledPeriodProfitSummary = useMemo(() => {
    if (view !== 'by-period') return null;
    let totalNet = 0;
    let totalQty = 0;
    for (const row of periodNetRowsRaw) {
      if (!row?.settledForSummary) continue;
      totalNet += toNumber(row.net);
      totalQty += toNumber(row.qty);
    }
    return { totalNet, totalQty };
  }, [view, periodNetRowsRaw]);

  const aggregatedPeriodNetRows = useMemo(() => {
    const rows = periodNetRows || [];
    const grouped = new Map<string, any>();

    rows.forEach((row: any, idx: number) => {
      // Group by SKU and Product name to show one row per unique item
      const key = [
        row.sku || '',
        row.product || '',
      ].join('|');

      if (!grouped.has(key)) {
        const isSale = row.type === 'sale';
        grouped.set(key, {
          ...row,
          id: row.id || `agg-${idx}`,
          children: [{ ...row }], // Store original row as first child
          qty: isSale ? toNumber(row.qty) : 0,
          revenue: isSale ? toNumber(row.revenue) : 0,
          gross_revenue: isSale ? toNumber(row.gross_revenue ?? row.revenue) : 0,
          /** Σ (unit cost × qty) for sale lines — must accumulate on merge like revenue (was stuck on first row only). */
          purchaseCost: isSale ? toNumber(row.purchaseCost) : 0,
          order_settlement_net_full:
            row.order_settlement_net_full != null ? toNumber(row.order_settlement_net_full) : null,
          amazon_order_net: row.amazon_order_net != null ? toNumber(row.amazon_order_net) : null,
          returns:
            row.type === 'return'
              ? toNumber(row.returns) + toNumber(row.extraCosts)
              : toNumber(row.returns),
          extraCosts: isSale ? toNumber(row.extraCosts) : 0,
          net: toNumber(row.net),
        });
        return;
      }

      const current = grouped.get(key);
      // Add this row to the children list for expansion view
      current.children.push({ ...row });

      if (row.type === 'sale') {
        current.qty += toNumber(row.qty);
        current.revenue += toNumber(row.revenue);
        current.gross_revenue = toNumber(current.gross_revenue ?? 0) + toNumber(row.gross_revenue ?? row.revenue);
        current.purchaseCost += toNumber(row.purchaseCost);
        current.extraCosts += toNumber(row.extraCosts);
      } else if (row.type === 'return') {
        current.returns += toNumber(row.returns) + toNumber(row.extraCosts);
      }

      if (row.order_settlement_net_full != null) {
        const incoming = toNumber(row.order_settlement_net_full);
        current.order_settlement_net_full =
          current.order_settlement_net_full != null
            ? Math.max(toNumber(current.order_settlement_net_full), incoming)
            : incoming;
      }
      if (row.amazon_order_net != null) {
        const incoming = toNumber(row.amazon_order_net);
        current.amazon_order_net =
          current.amazon_order_net != null ? Math.max(toNumber(current.amazon_order_net), incoming) : incoming;
      }
      current.net += toNumber(row.net);
      grouped.set(key, current);
    });

    return Array.from(grouped.values());
  }, [periodNetRows]);

  // Capital cycle — server-side aggregates (no full order/purchase lists).
  const capitalCycleData = useMemo(() => {
    if ((view !== 'capital-cycle' && view !== 'roi') || !roiMetrics) return null;
    const m = roiMetrics as Record<string, unknown>;

    return {
      totalCapital: toNumber(m.total_capital),
      totalPurchases: toNumber(m.total_purchases),
      totalSales: toNumber(m.total_sales),
      totalExpensesAmt: toNumber(m.total_expenses),
      totalLosses: toNumber(m.total_losses),
      netProfit: toNumber(m.net_profit),
      rotationDays: toNumber(m.rotation_days),
      purchasedInventory: toNumber(m.purchased_inventory),
      cashInHand: toNumber(m.cash_in_hand),
    };
  }, [view, roiMetrics]);

  const roiData = useMemo(() => {
    if (view !== 'roi' || !roiMetrics) return null;
    const m = roiMetrics as Record<string, unknown>;
    const expensesByCategory =
      m.expenses_by_category && typeof m.expenses_by_category === 'object'
        ? (m.expenses_by_category as Record<string, number>)
        : {};

    return {
      totalCapital: toNumber(m.total_capital),
      totalSales: toNumber(m.total_sales),
      totalPurchases: toNumber(m.total_purchases),
      totalExpensesAmt: toNumber(m.total_expenses),
      totalLosses: toNumber(m.total_losses),
      totalRefunds: toNumber(m.total_refunds),
      netProfit: toNumber(m.net_profit),
      roi: toNumber(m.roi),
      grossMargin: toNumber(m.gross_margin),
      netMargin: toNumber(m.net_margin),
      expensesByCategory,
    };
  }, [view, roiMetrics]);

  const toggleSort = (key: string) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'desc' };
    });
  };

  const togglePeriodSort = (key: string) => {
    setPeriodSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'desc' };
    });
  };

  const sortedBySku = useMemo(() => {
    const rows = Array.isArray(bySku) ? [...bySku] : [];

    const getValue = (item: any, key: string): number => {
      switch (key) {
        case 'quantity_sold':
          return Number(item.quantity_sold || 0);
        case 'avg_selling_price':
          return Number(item.avg_selling_price || 0);
        case 'revenue':
          return Number(item.revenue || 0);
        case 'cogs':
          return Number(item.cogs || 0);
        case 'additional_costs':
          return Number(item.additional_costs || 0);
        case 'returns_amount':
          return Number(item.returns_amount || 0);
        case 'net_profit':
          return Number(item.net_profit || 0);
        case 'profit_per_unit':
          return Number(item.profit_per_unit ?? item.profitPerUnit ?? 0);
        case 'margin':
          return Number(item.margin || 0);
        default:
          return 0;
      }
    };

    rows.sort((a: any, b: any) => {
      const aValue = getValue(a, sortConfig.key);
      const bValue = getValue(b, sortConfig.key);
      return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
    });

    return rows;
  }, [bySku, sortConfig]);

  const renderSortIcon = (key: string, config: { key: string; direction: 'asc' | 'desc' }) => {
    if (config.key !== key) return <ArrowUpDown className="w-3.5 h-3.5 opacity-70" />;
    return config.direction === 'asc'
      ? <ArrowUp className="w-3.5 h-3.5" />
      : <ArrowDown className="w-3.5 h-3.5" />;
  };

  const sortedPeriodNetRows = useMemo(() => {
    const search = periodSearchTerm.trim().toLowerCase();
    let rows = [...aggregatedPeriodNetRows];

    // Summary fields on the aggregated row + any **child** order # (so order search keeps the whole SKU row and full drill-down).
    if (search) {
      rows = rows.filter((item: any) => {
        const summaryHaystack = [
          item.sku,
          item.product,
          item.masterProductName,
          item.masterProductId != null ? String(item.masterProductId) : '',
          item.channel,
        ]
          .map((v) => String(v ?? '').toLowerCase())
          .join(' ');
        if (summaryHaystack.includes(search)) return true;

        const children = Array.isArray(item.children) ? item.children : [];
        return children.some((c: any) =>
          String(c.orderNo ?? '')
            .toLowerCase()
            .includes(search),
        );
      });
    }

    // Stable order for grouping into master rows; column sort applies to **master** rows only (see masterGroupedPeriodRows).
    rows.sort((a: any, b: any) => {
      const ak = [String(a.masterProductName || ''), String(a.sku || ''), String(a.product || '')].join('\0');
      const bk = [String(b.masterProductName || ''), String(b.sku || ''), String(b.product || '')].join('\0');
      return ak.localeCompare(bk, 'en', { numeric: true, sensitivity: 'base' });
    });

    return rows;
  }, [aggregatedPeriodNetRows, periodSearchTerm]);

  const masterGroupedPeriodRows = useMemo(() => {
    if (view !== 'by-period') return [];

    const groups = new Map<string, any>();
    for (const row of sortedPeriodNetRows) {
      const masterId = row.masterProductId != null ? String(row.masterProductId) : '';
      const masterName = row.masterProductName || row.product || '-';
      const key = masterId !== '' ? `m:${masterId}` : `n:${masterName}`;

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          master_product_id: masterId || null,
          master_product_name: masterName,
          qty: 0,
          revenue: 0,
          gross_revenue: 0,
          purchaseCost: 0,
          returns: 0,
          extraCosts: 0,
          net: 0,
          children: [] as any[],
        });
      }

      const g = groups.get(key);
      // Rows here are already SKU-aggregated (sales-only revenue/COGS; returns rolled into `returns`).
      g.qty += toNumber(row.qty);
      g.revenue += toNumber(row.revenue);
      g.gross_revenue += toNumber(row.gross_revenue ?? row.revenue);
      g.purchaseCost += toNumber(row.purchaseCost);
      g.returns += toNumber(row.returns);
      g.extraCosts += toNumber(row.extraCosts);
      g.net += toNumber(row.net);
      g.children.push(row);
      groups.set(key, g);
    }

    return Array.from(groups.values())
      .map((g) => {
        const seenOrder = new Set<string>();
        let sheetNetByDistinctOrders = 0;
        for (const c of g.children) {
          const fullNet = c.order_settlement_net_full ?? c.amazon_order_net;
          if (c.type === 'return' || fullNet == null) continue;
          const oid = String(c.orderNo ?? '');
          if (!oid || seenOrder.has(oid)) continue;
          seenOrder.add(oid);
          sheetNetByDistinctOrders += toNumber(fullNet);
        }
        return {
          ...g,
          amazon_order_net: seenOrder.size > 0 ? sheetNetByDistinctOrders : null,
        };
      })
      .sort((a, b) => {
        const masterLatestMs = (g: any) => {
          let max = 0;
          for (const row of g.children || []) {
            max = Math.max(max, new Date(row.date || 0).getTime());
            const lines = Array.isArray(row.children) ? row.children : [];
            for (const line of lines) {
              max = Math.max(max, new Date(line.date || 0).getTime());
            }
          }
          return max;
        };

        const getMasterSortValue = (g: any, key: string): string | number => {
          switch (key) {
            case 'date':
              return masterLatestMs(g);
            case 'product':
              return String(g.master_product_name || '').toLowerCase();
            case 'qty':
            case 'purchaseCost':
            case 'revenue':
            case 'gross_revenue':
            case 'returns':
            case 'extraCosts':
            case 'net':
              return toNumber(g[key]);
            case 'amazon_order_net':
              return toNumber(g.amazon_order_net);
            default:
              return String(g[key] ?? '').toLowerCase();
          }
        };

        const aValue = getMasterSortValue(a, periodSortConfig.key);
        const bValue = getMasterSortValue(b, periodSortConfig.key);

        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return periodSortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
        }

        const result = String(aValue).localeCompare(String(bValue), 'en', { numeric: true, sensitivity: 'base' });
        return periodSortConfig.direction === 'asc' ? result : -result;
      });
  }, [view, sortedPeriodNetRows, periodSortConfig]);

  const masterGroupedBySkuRows = useMemo(() => {
    if (view !== 'by-product') return [];

    const rows = Array.isArray(sortedBySku) ? sortedBySku : [];
    const groups = new Map<string, any>();

    for (const row of rows) {
      const masterId = row.master_product_id != null ? String(row.master_product_id) : '';
      const masterName = row.master_product_name || row.product_name || '-';
      const key = masterId !== '' ? `m:${masterId}` : `n:${masterName}`;

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          master_product_id: masterId || null,
          master_product_name: masterName,
          quantity_sold: 0,
          revenue: 0,
          cogs: 0,
          returns_amount: 0,
          additional_costs: 0,
          net_profit: 0,
          children: [] as any[],
        });
      }

      const g = groups.get(key);
      g.quantity_sold += toNumber(row.quantity_sold);
      g.revenue += toNumber(row.revenue);
      g.cogs += toNumber(row.cogs);
      g.returns_amount += toNumber(row.returns_amount);
      g.additional_costs += toNumber(row.additional_costs);
      g.net_profit += toNumber(row.net_profit);
      g.children.push(row);
      groups.set(key, g);
    }

    return Array.from(groups.values()).sort((a, b) => b.net_profit - a.net_profit);
  }, [view, sortedBySku]);

  const periodDetailLoading = view === 'by-period' && (loadingOrders || loadingSettlementNets);

  if (isLoading && view !== 'by-period') {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={dir}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-muted-foreground">{isAr ? 'تحليلات الأداء المالي' : 'Financial performance analytics'}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted-foreground">
            {isAr ? 'من' : 'From'}
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 block h-9 rounded-md border border-border bg-background px-2 text-sm"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            {isAr ? 'إلى' : 'To'}
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 block h-9 rounded-md border border-border bg-background px-2 text-sm"
            />
          </label>
        </div>
      </div>

      {view === 'by-channel' && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-2 items-end">
              <label className="text-xs text-muted-foreground">
                {isAr ? 'القناة' : 'Channel'}
                <select
                  value={channelFilter}
                  onChange={(e) => setChannelFilter(e.target.value)}
                  className="mt-1 block h-9 rounded-md border border-border bg-background px-2 text-sm min-w-[170px]"
                >
                  <option value="all">{isAr ? 'كل القنوات' : 'All Channels'}</option>
                  {channelOptions.map((ch) => (
                    <option key={ch.value} value={ch.value}>{ch.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                {isAr ? 'ملف كشف الحساب' : 'Statement File'}
                <input
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls"
                  disabled={importingFees}
                  onChange={(e) => handleImportFees(e.target.files?.[0] || null)}
                  className="mt-1 block h-9 text-sm"
                />
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {!isPeriodValid && (
        <Card className="border-destructive/40">
          <CardContent className="pt-4 text-sm text-destructive">
            {isAr
              ? 'اختر نطاق تاريخ صحيح (تاريخ البداية يجب أن يكون قبل أو يساوي تاريخ النهاية).'
              : 'Please select a valid date range (From date must be before or equal To date).'}
          </CardContent>
        </Card>
      )}

      {view === 'by-period' && isPeriodValid && (
        <PeriodActualProfitKpis startDate={startDate} endDate={endDate} />
      )}

      {/* Summary Stats */}
      {view !== 'roi' && view !== 'by-period' && (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="stat-card h-full min-h-[122px]">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-green-500/10">
              <DollarSign className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{isAr ? 'إجمالي الإيراد' : 'Total Revenue'}</p>
              <p className="text-xl font-bold">{formatNumber(totalRevenue)} EGP</p>
            </div>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="stat-card h-full min-h-[122px]">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-red-500/10">
              <Package className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{isAr ? 'تكلفة البضاعة المباعة' : 'COGS'}</p>
              <p className="text-xl font-bold">{formatNumber(totalCogs)} EGP</p>
            </div>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="stat-card h-full min-h-[122px]">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-orange-500/10">
              <BarChart3 className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{isAr ? 'المصروفات' : 'Expenses'}</p>
              <p className="text-xl font-bold">{formatNumber(totalExpensesCombined)} EGP</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {isAr
                  ? `داخلي: ${formatNumber(totalExpenses)} + قنوات: ${formatNumber(totalOrderCosts)}`
                  : `Internal: ${formatNumber(totalExpenses)} + Channel: ${formatNumber(totalOrderCosts)}`}
              </p>
            </div>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="stat-card h-full min-h-[122px]">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-amber-500/10">
              <RotateCcw className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{isAr ? 'المرتجعات' : 'Returns'}</p>
              <p className="text-xl font-bold">{formatNumber(totalRefunds)} EGP</p>
            </div>
          </div>
        </motion.div>
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38 }}
          className="stat-card text-start hover:border-primary/50 transition-colors h-full min-h-[122px]"
          onClick={() => navigate('/inventory/by-location')}
        >
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-purple-500/10">
              <Package className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{isAr ? 'تكلفة المخزون الحالية' : 'Current Inventory Cost'}</p>
              <p className="text-xl font-bold">{formatNumber(currentInventoryCost)} EGP</p>
            </div>
          </div>
        </motion.button>
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.39 }}
          className="stat-card text-start hover:border-primary/50 transition-colors h-full min-h-[122px]"
          onClick={() => navigate('/finance/bank-accounts')}
        >
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-emerald-500/10">
              <Wallet className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{isAr ? 'إجمالي الرصيد الآن' : 'Total Balance Now'}</p>
              <p className="text-xl font-bold">{formatNumber(balanceNowData.totalBalanceNow)} EGP</p>
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
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.395 }}
          className="stat-card text-start hover:border-primary/50 transition-colors h-full min-h-[122px]"
          onClick={() => navigate('/suppliers')}
        >
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-rose-500/10">
              <AlertTriangle className="w-5 h-5 text-rose-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{isAr ? 'مستحقات الموردين' : 'Supplier Dues'}</p>
              <p className="text-xl font-bold">{formatNumber(suppliersDueTotal)} EGP</p>
              <p className="text-xs text-muted-foreground mt-1">
                {isAr
                  ? `الصافي بعد مستحقات الموردين: ${formatNumber(netAfterSuppliers)} EGP`
                  : `Net after supplier dues: ${formatNumber(netAfterSuppliers)} EGP`}
              </p>
            </div>
          </div>
        </motion.button>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="stat-card h-full min-h-[122px]">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-primary/10">
              <TrendingUp className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{isAr ? 'صافي الربح' : 'Net Profit'}</p>
              <p className="text-xl font-bold">{formatNumber(netProfit)} EGP</p>
            </div>
          </div>
        </motion.div>
      </div>
      )}

      {/* ===== SKU DETAILS TABLE ===== */}
      {view === 'by-sku' && (
        <div className="glass-card rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>{isAr ? 'المنتج' : 'Product'}</TableHead>
                <TableHead>{isAr ? 'القناة' : 'Channel'}</TableHead>
                <TableHead className="text-right">
                  <button type="button" onClick={() => toggleSort('quantity_sold')} className="inline-flex items-center gap-1">
                    {isAr ? 'الكمية المباعة' : 'Qty Sold'} {renderSortIcon('quantity_sold', sortConfig)}
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button type="button" onClick={() => toggleSort('avg_selling_price')} className="inline-flex items-center gap-1">
                    {isAr ? 'سعر البيع' : 'Sell Price'} {renderSortIcon('avg_selling_price', sortConfig)}
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button type="button" onClick={() => toggleSort('revenue')} className="inline-flex items-center gap-1">
                    {isAr ? 'الإيراد' : 'Revenue'} {renderSortIcon('revenue', sortConfig)}
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button type="button" onClick={() => toggleSort('cogs')} className="inline-flex items-center gap-1">
                    {isAr ? 'تكلفة الشراء' : 'Purchase Cost'} {renderSortIcon('cogs', sortConfig)}
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button type="button" onClick={() => toggleSort('returns_amount')} className="inline-flex items-center gap-1">
                    {isAr ? 'المرتجعات' : 'Returns'} {renderSortIcon('returns_amount', sortConfig)}
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button type="button" onClick={() => toggleSort('additional_costs')} className="inline-flex items-center gap-1">
                    {isAr ? 'تكاليف إضافية' : 'Extra Costs'} {renderSortIcon('additional_costs', sortConfig)}
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button type="button" onClick={() => toggleSort('net_profit')} className="inline-flex items-center gap-1">
                    {isAr ? 'الصافي' : 'Net'} {renderSortIcon('net_profit', sortConfig)}
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button type="button" onClick={() => toggleSort('profit_per_unit')} className="inline-flex items-center gap-1">
                    {isAr ? 'ربح/قطعة' : 'Profit/unit'} {renderSortIcon('profit_per_unit', sortConfig)}
                  </button>
                </TableHead>
                <TableHead className="text-right">
                  <button type="button" onClick={() => toggleSort('margin')} className="inline-flex items-center gap-1">
                    {isAr ? 'الهامش' : 'Margin'} {renderSortIcon('margin', sortConfig)}
                  </button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(sortedBySku || []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-12 text-muted-foreground">
                    {isAr ? 'لا توجد بيانات' : 'No data available'}
                  </TableCell>
                </TableRow>
              ) : (
                (sortedBySku || []).map((item: any, idx: number) => {
                  const profit = Number(item.net_profit || 0);
                  const ppu = Number(item.profit_per_unit ?? item.profitPerUnit ?? 0);
                  const margin = Number(item.margin || 0).toFixed(1);
                  return (
                    <TableRow key={idx}>
                      <TableCell className="font-mono">{item.sku_code || '-'}</TableCell>
                      <TableCell>{item.product_name || '-'}</TableCell>
                      <TableCell>{item.channel_name || '-'}</TableCell>
                      <TableCell className="text-right">{formatNumber(item.quantity_sold || 0)}</TableCell>
                      <TableCell className="text-right">{formatNumber(item.avg_selling_price || 0)} EGP</TableCell>
                      <TableCell className="text-right">{formatNumber(item.revenue || 0)} EGP</TableCell>
                      <TableCell className="text-right">{formatNumber(item.cogs || 0)} EGP</TableCell>
                      <TableCell className="text-right text-orange-500">{formatNumber(item.returns_amount || 0)} EGP</TableCell>
                      <TableCell className="text-right text-red-400">{formatNumber(item.additional_costs || 0)} EGP</TableCell>
                      <TableCell className={`text-right font-medium ${profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {formatNumber(profit)} EGP
                      </TableCell>
                      <TableCell className={`text-right text-xs font-medium ${ppu >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {formatNumber(ppu, { maximumFractionDigits: 2 })} EGP
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={Number(margin) > 20 ? 'default' : Number(margin) > 0 ? 'secondary' : 'destructive'}>
                          {margin}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ===== BY PRODUCT (MASTER PRODUCT) TABLE ===== */}
      {view === 'by-product' && (
        <div className="glass-card rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{isAr ? 'المنتج الأساسي' : 'Master Product'}</TableHead>
                <TableHead className="text-right">{isAr ? 'الكمية' : 'Qty'}</TableHead>
                <TableHead className="text-right">{isAr ? 'الإيراد' : 'Revenue'}</TableHead>
                <TableHead className="text-right">{isAr ? 'تكلفة الشراء' : 'Purchase Cost'}</TableHead>
                <TableHead className="text-right">{isAr ? 'المرتجعات' : 'Returns'}</TableHead>
                <TableHead className="text-right">{isAr ? 'تكاليف إضافية' : 'Extra Costs'}</TableHead>
                <TableHead className="text-right">{isAr ? 'الصافي' : 'Net'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {masterGroupedBySkuRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    {isAr ? 'لا توجد بيانات' : 'No data available'}
                  </TableCell>
                </TableRow>
              ) : (
                masterGroupedBySkuRows.map((g: any) => {
                  const open = !!expandedMasterRows[g.key];
                  const Icon = open ? ChevronDown : ChevronRight;
                  return (
                    <>
                      <TableRow
                        key={g.key}
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() => setExpandedMasterRows((prev) => ({ ...prev, [g.key]: !prev[g.key] }))}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4 opacity-70" />
                            <span>{g.master_product_name || '-'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{formatNumber(g.quantity_sold || 0)}</TableCell>
                        <TableCell className="text-right">{formatNumber(g.revenue || 0)} EGP</TableCell>
                        <TableCell className="text-right">{formatNumber(g.cogs || 0)} EGP</TableCell>
                        <TableCell className="text-right text-orange-500">{formatNumber(g.returns_amount || 0)} EGP</TableCell>
                        <TableCell className="text-right text-red-400">{formatNumber(g.additional_costs || 0)} EGP</TableCell>
                        <TableCell className={`text-right font-bold ${Number(g.net_profit || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {formatNumber(g.net_profit || 0)} EGP
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow key={`${g.key}-details`}>
                          <TableCell colSpan={7} className="p-0">
                            <div className="bg-muted/20 border-t px-3 py-3">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>SKU</TableHead>
                                    <TableHead>{isAr ? 'المنتج (العرض)' : 'Listing'}</TableHead>
                                    <TableHead>{isAr ? 'القناة' : 'Channel'}</TableHead>
                                    <TableHead className="text-right">{isAr ? 'الكمية' : 'Qty'}</TableHead>
                                    <TableHead className="text-right">{isAr ? 'الإيراد' : 'Revenue'}</TableHead>
                                    <TableHead className="text-right">{isAr ? 'الصافي' : 'Net'}</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {g.children.map((c: any, idx: number) => (
                                    <TableRow key={`${g.key}-c-${idx}`}>
                                      <TableCell className="font-mono text-xs">{c.sku_code || '-'}</TableCell>
                                      <TableCell className="text-sm">{c.product_name || '-'}</TableCell>
                                      <TableCell className="text-sm">{c.channel_name || '-'}</TableCell>
                                      <TableCell className="text-right">{formatNumber(c.quantity_sold || 0)}</TableCell>
                                      <TableCell className="text-right">{formatNumber(c.revenue || 0)} EGP</TableCell>
                                      <TableCell className={`text-right font-medium ${Number(c.net_profit || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                        {formatNumber(c.net_profit || 0)} EGP
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ===== BY CHANNEL VIEW ===== */}
      {(view === 'by-channel' || view === 'by-period') && (
        <>
          {view === 'by-period' && periodDetailLoading && (
            <div className="flex items-center justify-center min-h-[200px] rounded-xl border border-border/50 bg-muted/20">
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
            </div>
          )}
          {view === 'by-period' && !periodDetailLoading && isPeriodValid && settledPeriodProfitSummary && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="rounded-2xl border border-primary/15 bg-gradient-to-br from-card via-card to-teal-500/[0.07] shadow-sm ring-1 ring-border/50 overflow-hidden"
            >
              <div className="relative px-5 py-5 sm:px-6 sm:py-6">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-teal-500/80 via-primary/60 to-transparent" />
                <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch lg:justify-between">
                  <div className="space-y-3 min-w-0 flex-1">
                    <Badge variant="outline" className="text-[10px] font-medium tracking-wide border-primary/25 text-primary">
                      {t('profitPeriod.settledSummaryBadge')}
                    </Badge>
                    <h2 className="text-lg sm:text-xl font-semibold leading-snug text-foreground">
                      {t('profitPeriod.settledSummaryTitle')}
                    </h2>
                    <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
                      {isAr
                        ? `أرباح فترة للطلبات التي تمت تسويتها فقط من ${formatDate(startDate)} إلى ${formatDate(endDate)}${
                            channelFilter !== 'all'
                              ? ` — ${isAr ? 'القناة:' : 'Channel:'} ${
                                  channelOptions.find((c) => c.value === channelFilter)?.label || channelFilter
                                }`
                              : ''
                          }.`
                        : `Period profit for orders marked settled only, from ${formatDate(startDate)} to ${formatDate(endDate)}${
                            channelFilter !== 'all'
                              ? ` — channel: ${channelOptions.find((c) => c.value === channelFilter)?.label || channelFilter}`
                              : ''
                          }.`}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
                      {t('profitPeriod.settledSummaryHint')}
                    </p>
                    <p className="text-[11px] text-muted-foreground/90 border-s-2 border-primary/30 ps-3">
                      {t('profitPeriod.settledSummaryFootnote')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3 shrink-0 lg:justify-end">
                    <div className="min-w-[150px] rounded-xl border border-border/70 bg-background/80 backdrop-blur-sm px-4 py-3 shadow-sm">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                        {t('profitPeriod.settledSummaryQtyLabel')}
                      </p>
                      <p className="text-2xl font-bold tabular-nums mt-1">
                        {formatNumber(settledPeriodProfitSummary.totalQty, { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                    <div className="min-w-[170px] rounded-xl border border-border/70 bg-background/80 backdrop-blur-sm px-4 py-3 shadow-sm">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                        {t('profitPeriod.settledSummaryNetLabel')}
                      </p>
                      <p
                        className={`text-2xl font-bold tabular-nums mt-1 ${
                          settledPeriodProfitSummary.totalNet >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'
                        }`}
                      >
                        {formatNumber(settledPeriodProfitSummary.totalNet, { maximumFractionDigits: 0 })} EGP
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Channel Revenue Share Cards */}
          {!(view === 'by-period' && periodDetailLoading) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {channelRows.map((ch, idx) => {
              const Icon = CHANNEL_ICONS[ch.name.toLowerCase()] || Store;
              return (
                <motion.div
                  key={ch.name}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                >
                  <Card className="glass-card h-full">
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <div className="p-2 rounded-lg bg-primary/10">
                            <Icon className="w-4 h-4 text-primary" />
                          </div>
                          <span className="font-semibold">{ch.name}</span>
                        </div>
                        <Badge variant="outline">{ch.revenueShare.toFixed(1)}%</Badge>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{isAr ? 'الكمية المباعة' : 'Qty sold'}</span>
                          <span className="font-medium">{formatNumber(ch.quantitySold)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{isAr ? 'الإيراد' : 'Revenue'}</span>
                          <span className="font-medium text-green-500">{formatNumber(ch.revenue)} EGP</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{isAr ? 'تكلفة الشراء' : 'Purchase Cost'}</span>
                          <span className="font-medium text-red-400">-{formatNumber(ch.cogs)} EGP</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{isAr ? 'تكاليف إضافية' : 'Extra Costs'}</span>
                          <span className="font-medium text-red-400">-{formatNumber(ch.additionalCosts, { maximumFractionDigits: 0 })} EGP</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{isAr ? 'المرتجعات' : 'Returns'}</span>
                          <span className="font-medium text-orange-400">-{formatNumber(ch.returnsAmount)} EGP</span>
                        </div>
                        <div className="border-t pt-2 flex justify-between">
                          <span className="font-medium">{isAr ? 'الصافي' : 'Net'}</span>
                          <span className={`font-bold ${ch.netProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {formatNumber(ch.netProfit, { maximumFractionDigits: 0 })} EGP
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{isAr ? 'الهامش' : 'Margin'}</span>
                          <Badge variant={ch.margin > 20 ? 'default' : ch.margin > 0 ? 'secondary' : 'destructive'}>
                            {ch.margin.toFixed(1)}%
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
            {channelRows.length === 0 && (
              <div className="col-span-full text-center py-12 text-muted-foreground">
                {isAr ? 'لا توجد بيانات قنوات. يجب ربط الطلبات بقناة.' : 'No channel data available. Orders need to have a channel assigned.'}
              </div>
            )}
          </div>
          )}

          {/* Channel comparison table: only on by-channel (cards already show the same on by-period) */}
          {view === 'by-channel' && channelRows.length > 0 && (
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg">{isAr ? 'مقارنة القنوات' : 'Channel Comparison'}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{isAr ? 'القناة' : 'Channel'}</TableHead>
                      <TableHead className="text-right">{isAr ? 'الكمية المباعة' : 'Qty Sold'}</TableHead>
                      <TableHead className="text-right">{isAr ? 'الإيراد' : 'Revenue'}</TableHead>
                      <TableHead className="text-right">{isAr ? 'نسبة الإيراد' : 'Rev %'}</TableHead>
                      <TableHead className="text-right">{isAr ? 'تكلفة الشراء' : 'Purchase Cost'}</TableHead>
                      <TableHead className="text-right">{isAr ? 'المرتجعات' : 'Returns'}</TableHead>
                      <TableHead className="text-right">{isAr ? 'تكاليف إضافية' : 'Extra Costs'}</TableHead>
                      <TableHead className="text-right">{isAr ? 'الصافي' : 'Net'}</TableHead>
                      <TableHead className="text-right">{isAr ? 'الهامش' : 'Margin'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {channelRows.map((ch) => (
                      <TableRow key={ch.name}>
                        <TableCell className="font-medium">{ch.name}</TableCell>
                        <TableCell className="text-right">{formatNumber(ch.quantitySold)}</TableCell>
                        <TableCell className="text-right">{formatNumber(ch.revenue)} EGP</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 bg-muted rounded-full h-2">
                              <div
                                className="bg-primary rounded-full h-2"
                                style={{ width: `${ch.revenueShare}%` }}
                              />
                            </div>
                            <span className="text-xs">{ch.revenueShare.toFixed(1)}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-red-400">
                          -{formatNumber(ch.cogs)} EGP
                        </TableCell>
                        <TableCell className="text-right text-orange-400">
                          {toNumber(ch.returnsAmount) > 0 ? `-${formatNumber(ch.returnsAmount)}` : '0'} EGP
                        </TableCell>
                        <TableCell className="text-right text-red-400">
                          -{formatNumber(ch.additionalCosts)} EGP
                        </TableCell>
                        <TableCell className={`text-right font-medium ${ch.netProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {formatNumber(ch.netProfit, { maximumFractionDigits: 0 })} EGP
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={ch.margin > 20 ? 'default' : ch.margin > 0 ? 'secondary' : 'destructive'}>
                            {ch.margin.toFixed(1)}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {view === 'by-period' && !periodDetailLoading && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">{isAr ? 'أرباح الفترة حسب المنتج الأساسي (افتح المنتج لرؤية كل الـ SKU)' : 'Period profit by master product (expand for SKUs)'}</CardTitle>
            <p className="text-xs text-muted-foreground max-w-3xl leading-relaxed">{t('profitPeriod.revenueHint')}</p>
            <label className="mt-3 flex flex-wrap items-center gap-2 cursor-pointer text-sm text-foreground">
              <input
                type="checkbox"
                checked={periodUnsettledOnly}
                onChange={(e) => setPeriodUnsettledOnly(e.target.checked)}
                className="rounded border-border"
              />
              <span>{t('profitPeriod.unsettledToggle')}</span>
            </label>
            <p className="text-[11px] text-muted-foreground mt-1 max-w-3xl">
              {periodUnsettledOnly ? t('profitPeriod.unsettledToggleHintOn') : t('profitPeriod.unsettledToggleHintOff')}
            </p>
            <div className="pt-2">
              <input
                type="text"
                value={periodSearchTerm}
                onChange={(e) => setPeriodSearchTerm(e.target.value)}
                placeholder={t('profitPeriod.searchPlaceholder')}
                className="w-full md:w-[420px] h-9 rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button type="button" onClick={() => togglePeriodSort('date')} className="inline-flex items-center gap-1">
                      {isAr ? 'ملاحظة' : 'Note'} {renderSortIcon('date', periodSortConfig)}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button type="button" onClick={() => togglePeriodSort('product')} className="inline-flex items-center gap-1">
                      {isAr ? 'المنتج الأساسي' : 'Master Product'} {renderSortIcon('product', periodSortConfig)}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button type="button" onClick={() => togglePeriodSort('qty')} className="inline-flex items-center gap-1">
                      {isAr ? 'الكمية' : 'Qty'} {renderSortIcon('qty', periodSortConfig)}
                    </button>
                  </TableHead>
                  <TableHead className="text-right text-xs max-w-[9rem] leading-tight">
                    <button type="button" onClick={() => togglePeriodSort('revenue')} className="inline-flex items-center gap-1">
                      {t('profitPeriod.allocatedSheetNet')} {renderSortIcon('revenue', periodSortConfig)}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button type="button" onClick={() => togglePeriodSort('purchaseCost')} className="inline-flex items-center gap-1">
                      {isAr ? 'تكلفة الشراء' : 'Purchase Cost'} {renderSortIcon('purchaseCost', periodSortConfig)}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button type="button" onClick={() => togglePeriodSort('returns')} className="inline-flex items-center gap-1">
                      {isAr ? 'المرتجعات' : 'Returns'} {renderSortIcon('returns', periodSortConfig)}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button type="button" onClick={() => togglePeriodSort('extraCosts')} className="inline-flex items-center gap-1">
                      {isAr ? 'تكاليف إضافية' : 'Extra Costs'} {renderSortIcon('extraCosts', periodSortConfig)}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button type="button" onClick={() => togglePeriodSort('net')} className="inline-flex items-center gap-1">
                      {isAr ? 'الصافي' : 'Net'} {renderSortIcon('net', periodSortConfig)}
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {masterGroupedPeriodRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                      {isAr ? 'لا توجد بيانات' : 'No data available'}
                    </TableCell>
                  </TableRow>
                ) : (
                  masterGroupedPeriodRows.map((g: any) => {
                    const groupKey = String(g.key ?? '');
                    const open = !!expandedMasterRows[groupKey];
                    const Icon = ShoppingBag;

                    return (
                      <React.Fragment key={groupKey}>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/40 transition-colors"
                          onClick={() => setExpandedMasterRows((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }))}
                        >
                          <TableCell>
                            {open ? <ChevronDown className="w-4 h-4 ml-1" /> : <ChevronRight className="w-4 h-4 ml-1" />}
                          </TableCell>
                          <TableCell className="font-medium whitespace-nowrap overflow-hidden text-ellipsis max-w-[280px]" title={g.master_product_name || g.product}>
                            <div className="flex items-center gap-2">
                              <Icon className="w-4 h-4 opacity-70" />
                              <span className="truncate">{g.master_product_name || g.product || '-'}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{formatNumber(g.qty || 0)}</TableCell>
                          <TableCell className="text-right font-semibold">{formatNumber(g.revenue || 0)} EGP</TableCell>
                          <TableCell className="text-right text-muted-foreground">{formatNumber(g.purchaseCost || 0)} EGP</TableCell>
                          <TableCell className="text-right text-orange-500">{formatNumber(g.returns || 0)} EGP</TableCell>
                          <TableCell className="text-right text-red-400">{formatNumber(g.extraCosts || 0)} EGP</TableCell>
                          <TableCell className={`text-right font-bold ${Number(g.net || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {formatNumber(g.net || 0)} EGP
                          </TableCell>
                        </TableRow>

                        {open && (
                          <TableRow className="bg-muted/10">
                            <TableCell colSpan={8} className="p-0">
                              <div className="px-10 py-4">
                                <Table className="border rounded-md bg-background shadow-sm">
                                  <TableHeader className="bg-muted/30">
                                    <TableRow>
                                      <TableHead className="text-[10px]">{isAr ? 'التاريخ' : 'Date'}</TableHead>
                                      <TableHead className="text-[10px]">{isAr ? 'رقم الطلب' : 'Order #'}</TableHead>
                                      <TableHead className="text-[10px]">SKU</TableHead>
                                      <TableHead
                                        className="text-right text-[10px]"
                                        title={isAr ? 'سعر الوحدة المعلن (بدون ضرب الكمية)' : 'Unit price (listed)'}
                                      >
                                        {isAr ? 'السعر' : 'Price'}
                                      </TableHead>
                                      <TableHead
                                        className="text-right text-[10px]"
                                        title={isAr ? 'المبلغ الفعلي المُحصّل من التسوية (بعد خصم رسوم المنصة). إن لم توجد تسوية يظهر سعر العرض الإجمالي.' : 'Net received from settlement (after platform fees). If no settlement exists, falls back to listed total.'}
                                      >
                                        {isAr ? 'الإجمالي' : 'Total'}
                                      </TableHead>
                                      <TableHead
                                        className="text-right text-[10px] text-muted-foreground"
                                        title={t('profitPeriod.dropdownColPurchaseCostHint')}
                                      >
                                        {t('profitPeriod.dropdownColPurchaseCost')}
                                      </TableHead>
                                      <TableHead
                                        className="text-right text-[10px] text-orange-500"
                                        title={t('profitPeriod.drilldownReturnsHint')}
                                      >
                                        {isAr ? 'المرتجعات' : 'Returns'}
                                      </TableHead>
                                      <TableHead
                                        className="text-right text-[10px] text-amber-600/90"
                                        title={t('profitPeriod.dropdownColExtraCostsHint')}
                                      >
                                        {t('profitPeriod.dropdownColExtraCosts')}
                                      </TableHead>
                                      <TableHead
                                        className="text-right text-[10px]"
                                        title={t('profitPeriod.dropdownColNetHint')}
                                      >
                                        {t('profitPeriod.dropdownColNet')}
                                      </TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {(() => {
                                      // g.children rows are aggregated-by-SKU rows; each has `children` containing the original order lines.
                                      const detailLines = (Array.isArray(g.children) ? g.children : [])
                                        .flatMap((row: any) => (Array.isArray(row?.children) && row.children.length ? row.children : [row]));

                                      return detailLines.map((c: any, cidx: number) => {
                                      const lineListGross = toNumber(c.listGross ?? c.gross_revenue ?? 0);
                                      const lineUnitPrice = toNumber(c.sellPrice ?? 0);
                                      const lineSettlementRevenue = toNumber(c.revenue);
                                      const linePurchaseCost = toNumber(c.purchaseCost);
                                      const lineExtraCosts = toNumber(c.extraCosts);
                                      const lineNet = toNumber(c.net);
                                      const lineReturnsImpact = toNumber(c.returns) + toNumber(c.extraCosts);
                                      const hasSettlementDiff = c.type !== 'return' && Math.abs(lineSettlementRevenue - lineListGross) > 1;

                                      return (
                                        <TableRow key={`${c.id}-${cidx}`} className="hover:bg-muted/20">
                                          <TableCell className="text-[10px] py-1">{formatDate(c.date)}</TableCell>
                                          <TableCell className="font-mono text-[10px] py-1">{c.orderNo || '-'}</TableCell>
                                          <TableCell className="font-mono text-[10px] py-1">{c.sku || '-'}</TableCell>
                                          <TableCell className="text-right text-[10px] py-1">
                                            {c.type === 'return'
                                              ? <span className="text-orange-500">-{formatNumber(c.returns)}</span>
                                              : formatNumber(lineUnitPrice)}
                                          </TableCell>
                                          <TableCell className={`text-right text-[10px] py-1 ${hasSettlementDiff ? 'text-blue-500 font-bold' : 'text-muted-foreground'}`}>
                                            {c.type === 'return'
                                              ? <span className="text-muted-foreground">—</span>
                                              : formatNumber(lineSettlementRevenue)}
                                          </TableCell>
                                          <TableCell className="text-right text-[10px] py-1 text-muted-foreground">
                                            {c.type === 'return' && linePurchaseCost < 0
                                              ? <span className="text-emerald-600">+{formatNumber(Math.abs(linePurchaseCost))}</span>
                                              : formatNumber(linePurchaseCost)}
                                          </TableCell>
                                          <TableCell className="text-right text-[10px] py-1 text-orange-500 font-medium">
                                            {c.type === 'return' && lineReturnsImpact > 0
                                              ? formatNumber(lineReturnsImpact)
                                              : c.type === 'sale'
                                                ? <span className="text-muted-foreground">—</span>
                                                : formatNumber(0)}
                                          </TableCell>
                                          <TableCell className="text-right text-[10px] py-1 text-amber-600/90">
                                            {c.type === 'return' ? <span className="text-muted-foreground">—</span> : formatNumber(lineExtraCosts)}
                                          </TableCell>
                                          <TableCell className={`text-right text-[10px] py-1 font-bold ${c.type === 'return' ? 'text-muted-foreground' : lineNet >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                            {c.type === 'return'
                                              ? <span title={t('profitPeriod.returnNetInMasterHint')}>—</span>
                                              : formatNumber(lineNet)}
                                          </TableCell>
                                        </TableRow>
                                      );
                                      });
                                    })()}
                                  </TableBody>
                                </Table>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}


      {/* ===== CAPITAL CYCLE VIEW ===== */}
      {(view === 'capital-cycle' || view === 'roi') && capitalCycleData && (
        <>
          {/* Money Flow Visualization */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-primary" />
                Money Flow: Capital to Return
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center justify-center gap-3 py-6">
                {[
                  { label: 'Capital Invested', value: capitalCycleData.totalCapital, color: 'text-blue-500', bg: 'bg-blue-500/10' },
                  { label: 'Purchases (COGS)', value: capitalCycleData.totalPurchases, color: 'text-orange-500', bg: 'bg-orange-500/10' },
                  { label: 'Inventory Value', value: capitalCycleData.purchasedInventory, color: 'text-purple-500', bg: 'bg-purple-500/10' },
                  { label: 'Sales Revenue', value: capitalCycleData.totalSales, color: 'text-green-500', bg: 'bg-green-500/10' },
                  { label: 'Expenses', value: capitalCycleData.totalExpensesAmt, color: 'text-red-500', bg: 'bg-red-500/10' },
                  { label: 'Losses', value: capitalCycleData.totalLosses, color: 'text-red-400', bg: 'bg-red-400/10' },
                ].map((step, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <div className={`p-4 rounded-xl ${step.bg} text-center min-w-[120px]`}>
                      <p className="text-xs text-muted-foreground">{step.label}</p>
                      <p className={`text-lg font-bold ${step.color}`}>{formatNumber(step.value)}</p>
                    </div>
                    {idx < 5 && <ArrowRight className="w-5 h-5 text-muted-foreground hidden sm:block" />}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Capital Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="glass-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-blue-500/10">
                    <Wallet className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Cash in Hand</p>
                    <p className="text-2xl font-bold">{formatNumber(capitalCycleData.cashInHand)} EGP</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-green-500/10">
                    <TrendingUp className="w-5 h-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Net Profit</p>
                    <p className={`text-2xl font-bold ${capitalCycleData.netProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {formatNumber(capitalCycleData.netProfit)} EGP
                    </p>
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
                    <p className="text-sm text-muted-foreground">Capital Rotation</p>
                    <p className="text-2xl font-bold">{capitalCycleData.rotationDays} days</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-red-500/10">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Losses</p>
                    <p className="text-2xl font-bold text-red-500">{formatNumber(capitalCycleData.totalLosses)} EGP</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* ===== ROI VIEW ===== */}
      {view === 'roi' && roiData && (
        <>
          {/* ROI Headline */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className={`glass-card border-l-4 ${roiData.roi >= 0 ? 'border-l-green-500' : 'border-l-red-500'}`}>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-1">Return on Investment (ROI)</p>
                <p className={`text-4xl font-bold ${roiData.roi >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {roiData.roi.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">Net Profit / Total Capital</p>
              </CardContent>
            </Card>
            <Card className="glass-card border-l-4 border-l-blue-500">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-1">Gross Margin</p>
                <p className="text-4xl font-bold text-blue-500">{roiData.grossMargin.toFixed(1)}%</p>
                <p className="text-xs text-muted-foreground mt-1">(Revenue - COGS) / Revenue</p>
              </CardContent>
            </Card>
            <Card className="glass-card border-l-4 border-l-purple-500">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-1">Net Margin</p>
                <p className={`text-4xl font-bold ${roiData.netMargin >= 0 ? 'text-purple-500' : 'text-red-500'}`}>
                  {roiData.netMargin.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">Net Profit / Revenue</p>
              </CardContent>
            </Card>
          </div>

          {/* P&L Breakdown */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg">Profit & Loss Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                  <span className="font-medium text-green-500">Revenue (Sales)</span>
                  <span className="font-bold text-green-500">+{formatNumber(roiData.totalSales)} EGP</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                  <span className="text-muted-foreground">Cost of Goods Sold (COGS)</span>
                  <span className="font-medium text-red-400">-{formatNumber(roiData.totalPurchases)} EGP</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
                  <span className="font-medium text-blue-500">Gross Profit</span>
                  <span className="font-bold text-blue-500">{formatNumber(roiData.totalSales - roiData.totalPurchases)} EGP</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                  <span className="text-muted-foreground">Operating Expenses</span>
                  <span className="font-medium text-red-400">-{formatNumber(roiData.totalExpensesAmt)} EGP</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                  <span className="text-muted-foreground">Inventory Losses (Damage/Theft/Expired)</span>
                  <span className="font-medium text-red-400">-{formatNumber(roiData.totalLosses)} EGP</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                  <span className="text-muted-foreground">Returns & Refunds</span>
                  <span className="font-medium text-orange-400">-{formatNumber(roiData.totalRefunds)} EGP</span>
                </div>
                <div className={`flex justify-between items-center p-4 rounded-lg border-2 ${roiData.netProfit >= 0 ? 'bg-green-500/5 border-green-500/30' : 'bg-red-500/5 border-red-500/30'}`}>
                  <span className="font-bold text-lg">Net Profit</span>
                  <span className={`font-bold text-xl ${roiData.netProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {roiData.netProfit >= 0 ? '+' : ''}{formatNumber(roiData.netProfit)} EGP
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Expense Breakdown by Category */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg">Expense Breakdown by Category</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(roiData.expensesByCategory)
                  .sort(([, a], [, b]) => b - a)
                  .map(([category, amount]) => {
                    const pct = roiData.totalExpensesAmt > 0 ? (amount / roiData.totalExpensesAmt) * 100 : 0;
                    return (
                      <div key={category} className="flex items-center gap-4">
                        <span className="text-sm capitalize w-28 text-muted-foreground">{category}</span>
                        <div className="flex-1">
                          <div className="w-full bg-muted rounded-full h-3">
                            <div
                              className="bg-primary rounded-full h-3 transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-sm font-medium w-28 text-right">{formatNumber(amount)} EGP</span>
                        <span className="text-xs text-muted-foreground w-12 text-right">{pct.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                {Object.keys(roiData.expensesByCategory).length === 0 && (
                  <p className="text-center text-muted-foreground py-4">No expenses recorded yet</p>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
