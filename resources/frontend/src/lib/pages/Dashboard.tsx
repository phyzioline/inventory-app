import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { StatCard } from '@/components/dashboard/StatCard';
import { SalesChart } from '@/components/dashboard/SalesChart';
import { TopProductsTable } from '@/components/dashboard/TopProductsTable';
import { SalesChannelsStatus } from '@/components/dashboard/SalesChannelsStatus';
import { RecentTransactions } from '@/components/dashboard/RecentTransactions';
import { LowStockAlerts } from '@/components/dashboard/LowStockAlerts';
import { TopSellingProductsDialog } from '@/components/dashboard/TopSellingProductsDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { QuickShopSaleDialog } from '@/components/sales/QuickShopSaleDialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import FbaRequestTransferDialog from '@/components/inventory/FbaRequestTransferDialog';
import {
  DollarSign,
  TrendingUp,
  Package,
  Clock,
  Trophy,
  Landmark,
  Layers,
  ShoppingCart,
  ClipboardList,
  HandCoins,
  ArrowDownLeft,
  ArrowUpRight,
  Users,
  Building2,
  RotateCcw,
  SlidersHorizontal,
  ArrowLeftRight,
  Wallet,
  Boxes,
} from 'lucide-react';

export default function Dashboard() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showTopSelling, setShowTopSelling] = useState(false);
  const [showQuickShopSale, setShowQuickShopSale] = useState(false);
  const [showFbaRequest, setShowFbaRequest] = useState(false);
  const [dateRange, setDateRange] = useState<'today' | 'yesterday' | '7d' | '30d' | 'custom'>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const isAr = language === 'ar';

  const toDateKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const parseBusinessDate = (value: any): Date | null => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  /** Laravel inventory orders use platform_order_id; legacy UI used order_number. */
  const displayOrderRef = useCallback((o: any) => {
    const raw =
      o?.platform_order_id
      ?? o?.external_order_number
      ?? o?.order_number
      ?? o?.amazon_order_number;
    if (raw != null && String(raw).trim() !== '') return String(raw).trim();
    if (o?.id != null) return `#${o.id}`;
    return '—';
  }, []);

  const displayCustomerName = useCallback(
    (o: any) => {
      if (typeof o?.customer_name === 'string' && o.customer_name.trim()) return o.customer_name.trim();
      const c = o?.customer;
      if (typeof c === 'string' && c.trim()) return c.trim();
      if (c && typeof c === 'object' && typeof (c as any).name === 'string' && (c as any).name.trim()) {
        return (c as any).name.trim();
      }
      return isAr ? 'غير معروف' : 'Unknown';
    },
    [isAr],
  );

  const normalizeOrderStatus = useCallback((o: any): string => {
    const s = o?.status;
    if (typeof s === 'string' && s.trim()) return s.trim().toLowerCase().replace(/\s+/g, '_');
    if (s && typeof s === 'object') {
      const v = (s as any).value ?? (s as any).code ?? (s as any).name;
      if (typeof v === 'string' && v.trim()) return v.trim().toLowerCase().replace(/\s+/g, '_');
    }
    return 'pending';
  }, []);

  const isoDate = (d: Date) => toDateKey(d);
  const { startDate, endDate, isRangeValid } = useMemo(() => {
    const now = new Date();
    const today = isoDate(now);
    if (dateRange === 'today') {
      return { startDate: today, endDate: today, isRangeValid: true };
    }
    if (dateRange === 'yesterday') {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const ys = isoDate(y);
      return { startDate: ys, endDate: ys, isRangeValid: true };
    }
    if (dateRange === '7d') {
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      return { startDate: isoDate(from), endDate: today, isRangeValid: true };
    }
    if (dateRange === '30d') {
      const from = new Date(now);
      from.setDate(from.getDate() - 29);
      return { startDate: isoDate(from), endDate: today, isRangeValid: true };
    }
    if (dateRange === 'custom') {
      const ok = Boolean(customFrom && customTo && customFrom <= customTo);
      return { startDate: customFrom || today, endDate: customTo || today, isRangeValid: ok };
    }
    return { startDate: today, endDate: today, isRangeValid: true };
  }, [dateRange, customFrom, customTo]);

  const {
    data: dashboardMetrics,
    isPending: dashboardMetricsPending,
    isError: dashboardMetricsError,
  } = useQuery({
    queryKey: ['dashboard-metrics', startDate, endDate],
    queryFn: () => api.get('/reports/dashboard-metrics', {
      params: { start_date: startDate, end_date: endDate },
    }),
    enabled: isRangeValid,
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });

  // Official Net Profit should match ProfitEngine (/reports/profit-summary).
  const {
    data: profitSummary,
    isSuccess: profitSummaryLoaded,
    isPending: profitSummaryPending,
    isError: profitSummaryError,
  } = useQuery({
    queryKey: ['dashboard-profit-summary', startDate, endDate],
    queryFn: () => api.get('/reports/profit-summary', {
      params: { start_date: startDate, end_date: endDate },
    }),
    enabled: isRangeValid,
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });

  // Per-channel net profit (same engine as أرباح الفترة) — replaces the old 25% sales heuristic.
  const { data: profitBySkuRows = [] } = useQuery({
    queryKey: ['dashboard-profit-by-sku', startDate, endDate],
    queryFn: () => api.getArray('/reports/profit-by-sku', {
      params: { start_date: startDate, end_date: endDate, limit: 500 },
    }),
    enabled: isRangeValid,
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });

  const officialNetProfit = Number(
    (profitSummary as any)?.net_profit ??
    (profitSummary as any)?.summary?.net_profit ??
    (profitSummary as any)?.data?.net_profit ??
    0
  );
  const hasOfficialNetProfit = profitSummaryLoaded && profitSummary != null;
  const netProfitInPeriod = hasOfficialNetProfit ? officialNetProfit : 0;

  const metricsOrders = (dashboardMetrics as any)?.orders ?? {};
  const totalSalesInPeriod = Number(metricsOrders.total_sales ?? 0);
  const periodOrderCount = Number(metricsOrders.count ?? 0);
  const pendingOrders = Number(metricsOrders.pending_count ?? 0);
  const productCount = Number((dashboardMetrics as any)?.product_count ?? 0);
  const lowStockItems = Array.isArray((dashboardMetrics as any)?.low_stock_alerts)
    ? (dashboardMetrics as any).low_stock_alerts
    : [];

  // Money waiting to be transferred (Mock for now or sum pending payouts if available)
  const pendingPayouts = 0;

  const salesChartData = (Array.isArray(metricsOrders.sales_by_date) ? metricsOrders.sales_by_date : [])
    .slice(-30)
    .map((row: { date: string; sales: number }) => ({
      name: new Date(`${row.date}T00:00:00`).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' }),
      sales: Number(row.sales ?? 0),
      purchases: 0,
    }));

  const recentTransactions = useMemo(
    () =>
      (Array.isArray(metricsOrders.recent) ? metricsOrders.recent : []).map((o: any) => ({
        id: `sale-${o.id}`,
        type: 'sale' as const,
        description: `${isAr ? 'طلب' : 'Order'} #${displayOrderRef(o)}`,
        amount: Number(o.total_amount || 0),
        customer: displayCustomerName(o),
        time: (() => {
          const d = parseBusinessDate(o.order_date) || new Date();
          return d.toLocaleDateString(isAr ? 'ar-EG' : 'en-US');
        })(),
        status: normalizeOrderStatus(o),
      })),
    [metricsOrders.recent, isAr, displayOrderRef, displayCustomerName, normalizeOrderStatus],
  );

  const topProducts = useMemo(() => {
    const rows = Array.isArray(profitBySkuRows) ? profitBySkuRows : [];
    return [...rows]
      .sort((a: any, b: any) => Number(b.revenue ?? 0) - Number(a.revenue ?? 0))
      .slice(0, 6)
      .map((row: any, i: number) => ({
        id: row.sku_code ?? row.sku_id ?? `sku-${i}`,
        name: String(row.product_name ?? row.master_product_name ?? row.sku_code ?? '—'),
        sku: String(row.sku_code ?? '—'),
        sales: Math.round(Number(row.quantity_sold ?? 0)),
        revenue: Number(row.revenue ?? 0),
        trend: Number(row.margin ?? 0),
      }));
  }, [profitBySkuRows]);

  const salesChannels = useMemo(() => {
    const engineProfitByChannel = (Array.isArray(profitBySkuRows) ? profitBySkuRows : []).reduce(
      (acc: Record<string, number>, row: any) => {
        const name = String(row.channel_name || '').trim() || (isAr ? 'قناة غير معروفة' : 'Unknown Channel');
        acc[name] = (acc[name] || 0) + Number(row.net_profit || 0);
        return acc;
      },
      {}
    );

    const byChannel = (Array.isArray(metricsOrders.by_channel) ? metricsOrders.by_channel : []).map((channel: any) => ({
      ...channel,
      profit: engineProfitByChannel[channel.name] ?? 0,
    }));

    return byChannel.sort((a: any, b: any) => b.sales - a.sales);
  }, [metricsOrders.by_channel, profitBySkuRows, isAr]);

  const periodLabel = (() => {
    if (dateRange === 'today') return isAr ? 'اليوم' : 'Today';
    if (dateRange === 'yesterday') return isAr ? 'أمس' : 'Yesterday';
    if (dateRange === '7d') return isAr ? 'آخر 7 أيام' : 'Last 7 Days';
    if (dateRange === '30d') return isAr ? 'آخر 30 يوم' : 'Last 30 Days';
    return isAr ? 'فترة مخصصة' : 'Custom Period';
  })();

  const quickActions = useMemo(() => ([
    {
      key: 'shop-sale',
      title: isAr ? 'بيع من المحل' : 'Shop Sale',
      subtitle: isAr ? 'فاتورة سريعة مباشرة' : 'Quick direct invoice',
      icon: ShoppingCart,
      tone: 'from-emerald-500/15 to-teal-500/10',
      onClick: () => setShowQuickShopSale(true),
    },
    {
      key: 'sales-invoices',
      title: isAr ? 'فواتير البيع' : 'Sales Invoices',
      subtitle: isAr ? 'كل فواتير المبيعات' : 'All sales invoices',
      icon: ArrowUpRight,
      tone: 'from-sky-500/15 to-indigo-500/10',
      onClick: () => navigate('/sales'),
    },
    {
      key: 'purchases',
      title: isAr ? 'المشتريات' : 'Purchases',
      subtitle: isAr ? 'فواتير الموردين' : 'Supplier invoices',
      icon: ClipboardList,
      tone: 'from-orange-500/15 to-amber-500/10',
      onClick: () => navigate('/purchases'),
    },
    {
      key: 'cash-receipt',
      title: isAr ? 'قبض نقدية' : 'Cash Receipt',
      subtitle: isAr ? 'تحصيل من العملاء' : 'Collect from customers',
      icon: ArrowDownLeft,
      tone: 'from-violet-500/15 to-fuchsia-500/10',
      onClick: () => navigate('/finance/receipts'),
    },
    {
      key: 'cash-payment',
      title: isAr ? 'سداد نقدية' : 'Cash Payment',
      subtitle: isAr ? 'سداد للموردين/مصروفات' : 'Pay suppliers/expenses',
      icon: HandCoins,
      tone: 'from-rose-500/15 to-red-500/10',
      onClick: () => navigate('/finance/payments'),
    },
    {
      key: 'expenses',
      title: isAr ? 'مصاريف' : 'Expenses',
      subtitle: isAr ? 'مصروفات التشغيل' : 'Operating expenses',
      icon: Landmark,
      tone: 'from-slate-500/15 to-zinc-500/10',
      onClick: () => navigate('/expenses'),
    },
    {
      key: 'treasury',
      title: isAr ? 'الخزنة والمالية' : 'Treasury & Finance',
      subtitle: isAr ? 'الصافي المتاح، الوارد والصادر' : 'Net available, cash in & out',
      icon: Wallet,
      tone: 'from-blue-600/15 to-indigo-500/10',
      onClick: () => navigate('/finance/capital'),
    },
    {
      key: 'customers',
      title: isAr ? 'العملاء (أرصدة)' : 'Customers (Balances)',
      subtitle: isAr ? 'مين عليه فلوس؟' : 'Who owes you?',
      icon: Users,
      tone: 'from-blue-500/15 to-cyan-500/10',
      onClick: () => navigate('/customers'),
    },
    {
      key: 'suppliers',
      title: isAr ? 'الموردين (أرصدة)' : 'Suppliers (Balances)',
      subtitle: isAr ? 'مين ليه فلوس؟' : 'Who you owe?',
      icon: Building2,
      tone: 'from-amber-500/15 to-yellow-500/10',
      onClick: () => navigate('/suppliers'),
    },
    {
      key: 'profit-period',
      title: isAr ? 'أرباح فترة' : 'Period Profit',
      subtitle: isAr ? 'تحليل الربح للفترة' : 'Profit analytics',
      icon: TrendingUp,
      tone: 'from-green-500/15 to-emerald-500/10',
      onClick: () => navigate('/profit/by-period'),
    },
    {
      key: 'profit-products',
      title: isAr ? 'أرباح منتجات' : 'Product Profit',
      subtitle: isAr ? 'حسب المنتج الرئيسي' : 'By master product',
      icon: Package,
      tone: 'from-teal-500/15 to-sky-500/10',
      onClick: () => navigate('/profit/by-product'),
    },
    {
      key: 'returns',
      title: isAr ? 'المرتجعات' : 'Returns',
      subtitle: isAr ? 'مرتجعات وخسائر بيع' : 'Returns & refunds',
      icon: RotateCcw,
      tone: 'from-amber-500/15 to-orange-500/10',
      onClick: () => navigate('/returns'),
    },
    {
      key: 'losses',
      title: isAr ? 'خسائر/تسويات مخزون' : 'Inventory Adjustments',
      subtitle: isAr ? 'هالك/تالف/تسويات' : 'Damage/expiry/adjust',
      icon: SlidersHorizontal,
      tone: 'from-purple-500/15 to-indigo-500/10',
      onClick: () => navigate('/inventory/adjustments'),
    },
    {
      key: 'transfers',
      title: isAr ? 'تحويلات المخزون' : 'Stock Transfers',
      subtitle: isAr ? 'بين المستودعات' : 'Between warehouses',
      icon: ArrowLeftRight,
      tone: 'from-cyan-500/15 to-sky-500/10',
      onClick: () => navigate('/inventory/transfers'),
    },
    {
      key: 'fba-request',
      title: isAr ? 'ترحيل طلب FBA' : 'FBA Shipment Transfer',
      subtitle: isAr ? 'رفع ملف أمازون ونقل للمخزون' : 'Amazon TSV → FBA warehouse',
      icon: Boxes,
      tone: 'from-orange-500/15 to-amber-500/10',
      onClick: () => setShowFbaRequest(true),
    },
  ]), [isAr, navigate]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
          <p className="text-muted-foreground">{t('dashboard.welcome')}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Select value={dateRange} onValueChange={(v: any) => setDateRange(v)}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder={isAr ? 'الفترة الزمنية' : 'Date range'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">{isAr ? 'اليوم' : 'Today'}</SelectItem>
                <SelectItem value="yesterday">{isAr ? 'أمس' : 'Yesterday'}</SelectItem>
                <SelectItem value="7d">{isAr ? 'آخر 7 أيام' : 'Last 7 Days'}</SelectItem>
                <SelectItem value="30d">{isAr ? 'آخر 30 يوم' : 'Last 30 Days'}</SelectItem>
                <SelectItem value="custom">{isAr ? 'مخصص' : 'Custom'}</SelectItem>
              </SelectContent>
            </Select>
            {dateRange === 'custom' ? (
              <>
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-[150px]" />
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-[150px]" />
              </>
            ) : null}
          </div>
          <Button onClick={() => setShowTopSelling(true)} className="gap-2 bg-gradient-to-r from-warning/90 to-warning hover:from-warning hover:to-warning/90 text-warning-foreground">
            <Trophy className="w-4 h-4" />
            {isAr ? 'المنتجات الأكثر مبيعًا' : 'Top Selling Products'}
          </Button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="w-4 h-4" />
            <span>{new Date().toLocaleDateString(isAr ? 'ar-EG' : 'en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}</span>
          </div>
        </div>
      </div>

      <TopSellingProductsDialog open={showTopSelling} onOpenChange={setShowTopSelling} />
      <QuickShopSaleDialog open={showQuickShopSale} onOpenChange={setShowQuickShopSale} />
      <FbaRequestTransferDialog
        open={showFbaRequest}
        onOpenChange={setShowFbaRequest}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['transfers'] });
          queryClient.invalidateQueries({ queryKey: ['transactions'] });
          queryClient.invalidateQueries({ queryKey: ['inventory-by-location'] });
        }}
      />

      {/* Quick Actions */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base">
                {isAr ? 'اختصارات سريعة' : 'Quick Actions'}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {isAr ? 'أهم العمليات في مكان واحد لتسهيل الاستخدام' : 'Common actions in one place'}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate('/reports')}>
              {isAr ? 'التقارير' : 'Reports'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {quickActions.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={a.onClick}
                className={`group text-start rounded-xl border bg-background/70 hover:bg-background transition-colors p-3 shadow-sm hover:shadow-md`}
              >
                <div className={`rounded-lg p-2.5 w-fit bg-gradient-to-br ${a.tone} mb-2`}>
                  <a.icon className="w-5 h-5 text-foreground/80" />
                </div>
                <div className="space-y-0.5">
                  <div className="text-sm font-bold leading-tight">
                    {a.title}
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-snug">
                    {a.subtitle}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title={isAr ? `إجمالي المبيعات (${periodLabel})` : `Sales (${periodLabel})`}
          value={
            dashboardMetricsPending
              ? (isAr ? 'جاري التحميل…' : 'Loading…')
              : dashboardMetricsError
                ? (isAr ? 'غير متاح' : 'N/A')
                : `${totalSalesInPeriod.toLocaleString()} EGP`
          }
          change={
            dashboardMetricsError
              ? (isAr ? 'تعذر تحميل البيانات' : 'Could not load data')
              : (isAr ? `${periodOrderCount} طلب` : `${periodOrderCount} orders`)
          }
          changeType={dashboardMetricsError ? 'neutral' : 'positive'}
          icon={DollarSign}
          delay={0}
        />
        <StatCard
          title={isAr ? `صافي الربح (${periodLabel})` : `Net Profit (${periodLabel})`}
          value={
            !isRangeValid
              ? `0 EGP`
              : profitSummaryPending
                ? (isAr ? 'جاري التحميل…' : 'Loading…')
                : profitSummaryError
                  ? (isAr ? 'غير متاح' : 'N/A')
                  : `${netProfitInPeriod.toLocaleString()} EGP`
          }
          change={
            profitSummaryLoaded
              ? (isAr ? 'رسمي (محرك الأرباح)' : 'Official (Profit Engine)')
              : profitSummaryPending
                ? (isAr ? 'مزامنة مع الخادم' : 'Syncing with server')
                : profitSummaryError
                  ? (isAr ? 'تعذر تحميل /reports/profit-summary' : 'Could not load profit summary')
                  : (isAr ? '—' : '—')
          }
          changeType={profitSummaryError ? 'neutral' : netProfitInPeriod >= 0 ? 'positive' : 'negative'}
          icon={TrendingUp}
          delay={0.1}
        />
        <StatCard
          title={isAr ? 'المنتجات قربت تخلص' : "Low Stock Alerts"}
          value={`${lowStockItems.length}`}
          change={isAr ? 'منتجات تحتاج إعادة توريد' : 'Items need restocking'}
          changeType={lowStockItems.length > 0 ? "negative" : "positive"}
          icon={Package}
          delay={0.2}
        />
        <StatCard
          title={isAr ? 'الفلوس المنتظرة' : "Pending Payouts"}
          value={`${pendingPayouts.toLocaleString()} EGP`}
          change={isAr ? 'بانتظار التحويل' : 'Awaiting transfer'}
          changeType="neutral"
          icon={Landmark}
          delay={0.3}
        />
      </div>

      {/* Charts Row — directly under main KPIs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <SalesChart data={salesChartData} />
        </div>
        <div>
          <SalesChannelsStatus channels={salesChannels as any[]} isError={dashboardMetricsError} />
        </div>
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard
          title={isAr ? 'إجمالي المنتجات' : 'Total Products'}
          value={dashboardMetricsPending ? '…' : `${productCount}`}
          change={isAr ? 'الكتالوج الرئيسي' : 'Master Catalog'}
          changeType="neutral"
          icon={Layers}
          iconColor="text-primary"
          delay={0.4}
        />
        <StatCard
          title={t('dashboard.pendingOrders')}
          value={`${pendingOrders}`}
          change={isAr ? 'بانتظار المعالجة' : 'Awaiting processing'}
          changeType="neutral"
          icon={Clock}
          iconColor="text-info"
          delay={0.5}
        />
      </div>

      {/* Tables Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <TopProductsTable products={topProducts} />
        <RecentTransactions transactions={recentTransactions} />
      </div>

      {/* Alerts */}
      <LowStockAlerts alerts={lowStockItems} />
    </div>
  );
}
