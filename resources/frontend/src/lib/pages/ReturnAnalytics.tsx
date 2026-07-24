import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, BarChart3, Boxes, Package, Percent, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useReturns } from '@/hooks/useReturns';
import { salesOrderService } from '@/lib/supabase-services';
import { useLanguage } from '@/contexts/LanguageContext';

type ReturnRow = any;
type OrderRow = any;

const OPEN_RETURN_STATUSES = new Set(['pending', 'in_transit', 'received']);

export default function ReturnAnalytics() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const isAr = language === 'ar';
  const { data: returnsPayload, isLoading: returnsLoading } = useReturns({ perPage: 500 });
  const returns = returnsPayload?.data ?? [];
  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['orders-for-return-analytics'],
    queryFn: () => salesOrderService.getAll(),
  });

  const [datePreset, setDatePreset] = useState('30d');
  const [channelFilter, setChannelFilter] = useState('all');
  const [reasonFilter, setReasonFilter] = useState('all');
  const [productFilter, setProductFilter] = useState('');

  const normalizeDate = (value: any) => {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const startDate = useMemo(() => {
    const now = new Date();
    if (datePreset === '7d') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (datePreset === '30d') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (datePreset === '90d') return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    return null;
  }, [datePreset]);

  const enrichedReturns = useMemo(() => {
    return (Array.isArray(returns) ? returns : []).map((r: ReturnRow) => {
      const quantity = Number(r.return_quantity || 1);
      const financialDeduction = Number(r.financial_deduction || 0);
      const refund = Number(r.refund_amount || 0);
      const extraShipping = Number(r.extra_shipping_fee || 0);
      const totalLoss = Math.max(0, financialDeduction + refund + extraShipping);
      const orderItems = Array.isArray(r.order?.items) ? r.order.items : [];
      const matched = orderItems.find((item: any) => (item?.sku_code || '') === (r.sku_code || '')) || orderItems[0] || null;
      const productName = r.product_name || matched?.product_name || 'Unknown Product';
      const soldQty = Number(matched?.quantity || 0);
      const channel = (r.channel || r.order?.channel || 'Unknown').toString();
      const reason = (r.reason || 'other').toString();
      const date = normalizeDate(r.return_date || r.last_update_date || r.created_at);
      return {
        ...r,
        quantity,
        soldQty,
        totalLoss,
        productName,
        channel,
        reason,
        date,
      };
    });
  }, [returns]);

  const filteredReturns = useMemo(() => {
    return enrichedReturns.filter((r: any) => {
      if (startDate && (!r.date || r.date < startDate)) return false;
      if (channelFilter !== 'all' && r.channel !== channelFilter) return false;
      if (reasonFilter !== 'all' && classifyReason(r.reason) !== reasonFilter) return false;
      if (productFilter.trim()) {
        const q = productFilter.toLowerCase();
        const inName = (r.productName || '').toLowerCase().includes(q);
        const inSku = (r.sku_code || '').toLowerCase().includes(q);
        if (!inName && !inSku) return false;
      }
      return true;
    });
  }, [enrichedReturns, startDate, channelFilter, reasonFilter, productFilter]);

  const filteredOrders = useMemo(() => {
    const allOrders = Array.isArray(orders) ? orders : [];
    return allOrders.filter((o: OrderRow) => {
      const orderDate = normalizeDate(o.order_date || o.created_at);
      if (startDate && (!orderDate || orderDate < startDate)) return false;
      if (channelFilter !== 'all') {
        const orderChannel = (o.channel?.name || o.marketplace_source || 'Unknown').toString();
        if (orderChannel !== channelFilter) return false;
      }
      return true;
    });
  }, [orders, startDate, channelFilter]);

  const kpis = useMemo(() => {
    const totalReturns = filteredReturns.length;
    const returnedUnits = filteredReturns.reduce((sum: number, r: any) => sum + Number(r.quantity || 0), 0);
    const damagedReturns = filteredReturns.filter((r: any) => r.return_type === 'damaged' || r.disposition === 'damaged').length;
    const totalLoss = filteredReturns.reduce((sum: number, r: any) => sum + Number(r.totalLoss || 0), 0);
    const returnRate = filteredOrders.length > 0 ? (totalReturns / filteredOrders.length) * 100 : 0;

    return { totalReturns, returnedUnits, damagedReturns, totalLoss, returnRate };
  }, [filteredReturns, filteredOrders]);

  const mostReturnedProducts = useMemo(() => {
    const map = new Map<string, any>();
    const soldMap = new Map<string, number>();

    filteredReturns.forEach((r: any) => {
      const key = `${r.productName}__${r.sku_code || 'NO-SKU'}`;
      const row = map.get(key) || {
        product: r.productName,
        sku: r.sku_code || '—',
        soldQty: 0,
        returnedQty: 0,
        loss: 0,
        channel: r.channel,
      };
      row.returnedQty += Number(r.quantity || 0);
      row.loss += Number(r.totalLoss || 0);
      map.set(key, row);

      const soldKey = `${r.order?.id || 'NO-ORDER'}__${r.sku_code || 'NO-SKU'}`;
      if (!soldMap.has(soldKey)) {
        soldMap.set(soldKey, Number(r.soldQty || 0));
      }
    });

    map.forEach((row) => {
      const soldTotal = Array.from(soldMap.entries())
        .filter(([k]) => k.endsWith(`__${row.sku === '—' ? 'NO-SKU' : row.sku}`))
        .reduce((sum, [, qty]) => sum + qty, 0);
      row.soldQty = soldTotal;
      row.returnRate = soldTotal > 0 ? (row.returnedQty / soldTotal) * 100 : 0;
    });

    return Array.from(map.values()).sort((a, b) => b.returnedQty - a.returnedQty).slice(0, 15);
  }, [filteredReturns]);

  const topLossProducts = useMemo(() => {
    return [...mostReturnedProducts].sort((a, b) => b.loss - a.loss).slice(0, 10);
  }, [mostReturnedProducts]);

  const reasonBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    filteredReturns.forEach((r: any) => {
      const key = classifyReason(r.reason);
      map.set(key, (map.get(key) || 0) + 1);
    });
    const total = Math.max(1, filteredReturns.length);
    return Array.from(map.entries())
      .map(([reason, count]) => ({ reason, count, percent: (count / total) * 100 }))
      .sort((a, b) => b.count - a.count);
  }, [filteredReturns]);

  const byChannel = useMemo(() => {
    const orderCountByChannel = new Map<string, number>();
    filteredOrders.forEach((o: any) => {
      const ch = (o.channel?.name || o.marketplace_source || 'Unknown').toString();
      orderCountByChannel.set(ch, (orderCountByChannel.get(ch) || 0) + 1);
    });

    const returnCountByChannel = new Map<string, number>();
    filteredReturns.forEach((r: any) => {
      returnCountByChannel.set(r.channel, (returnCountByChannel.get(r.channel) || 0) + 1);
    });

    const channels = new Set<string>([
      ...Array.from(orderCountByChannel.keys()),
      ...Array.from(returnCountByChannel.keys()),
    ]);

    return Array.from(channels).map((channel) => {
      const ordersCount = orderCountByChannel.get(channel) || 0;
      const returnsCount = returnCountByChannel.get(channel) || 0;
      return {
        channel,
        ordersCount,
        returnsCount,
        rate: ordersCount > 0 ? (returnsCount / ordersCount) * 100 : 0,
      };
    }).sort((a, b) => b.rate - a.rate);
  }, [filteredOrders, filteredReturns]);

  const trend = useMemo(() => {
    const map = new Map<string, number>();
    filteredReturns.forEach((r: any) => {
      if (!r.date) return;
      const key = r.date.toISOString().slice(0, 10);
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30);
  }, [filteredReturns]);

  const damageAnalysis = useMemo(() => {
    return mostReturnedProducts
      .filter((p: any) => p.product && p.returnedQty > 0)
      .map((p: any) => {
        const damagedQty = filteredReturns
          .filter((r: any) => (r.productName === p.product) && (r.return_type === 'damaged' || r.disposition === 'damaged'))
          .reduce((sum: number, r: any) => sum + Number(r.quantity || 0), 0);
        const pct = p.returnedQty > 0 ? (damagedQty / p.returnedQty) * 100 : 0;
        return { product: p.product, damagedQty, pct };
      })
      .filter((r) => r.damagedQty > 0)
      .sort((a, b) => b.damagedQty - a.damagedQty)
      .slice(0, 10);
  }, [mostReturnedProducts, filteredReturns]);

  const openReturns = useMemo(() => {
    const now = Date.now();
    return filteredReturns
      .filter((r: any) => OPEN_RETURN_STATUSES.has((r.return_status || '').toString()))
      .map((r: any) => {
        const d = r.date ? r.date.getTime() : now;
        const daysOpen = Math.max(0, Math.floor((now - d) / (1000 * 60 * 60 * 24)));
        return {
          id: r.id,
          orderNo: r.amazon_order_number || r.order?.order_number || '—',
          product: r.productName,
          status: r.return_status,
          daysOpen,
        };
      })
      .sort((a, b) => b.daysOpen - a.daysOpen)
      .slice(0, 20);
  }, [filteredReturns]);

  const impactOnProfit = useMemo(() => {
    return mostReturnedProducts.slice(0, 12).map((p: any) => {
      const avgUnit = filteredReturns
        .filter((r: any) => r.productName === p.product)
        .map((r: any) => Number(r.order?.items?.[0]?.unit_price || 0))
        .filter((v: number) => v > 0);
      const avgPrice = avgUnit.length ? avgUnit.reduce((a: number, b: number) => a + b, 0) / avgUnit.length : 0;
      const estimatedProfit = p.soldQty * avgPrice;
      const netProfit = estimatedProfit - p.loss;
      return {
        product: p.product,
        estimatedProfit,
        returnLoss: p.loss,
        netProfit,
      };
    }).sort((a, b) => a.netProfit - b.netProfit);
  }, [mostReturnedProducts, filteredReturns]);

  const channelOptions = useMemo(() => {
    const values = new Set<string>();
    enrichedReturns.forEach((r: any) => values.add(r.channel));
    return Array.from(values).sort();
  }, [enrichedReturns]);

  const loading = returnsLoading || ordersLoading;

  const labelReasonLocal = (key: string): string => {
    const labels: Record<string, string> = {
      damaged: t('returns.analytics.reason.damaged') || (isAr ? 'تالف' : 'Damaged'),
      wrong_item: t('returns.analytics.reason.wrongItem') || (isAr ? 'منتج خطأ' : 'Wrong Item'),
      customer_cancel: t('returns.analytics.reason.customerCancel') || (isAr ? 'إلغاء العميل' : 'Customer Cancel'),
      late_delivery: t('returns.analytics.reason.lateDelivery') || (isAr ? 'تأخير توصيل' : 'Late Delivery'),
      defective: t('returns.analytics.reason.defective') || (isAr ? 'معيب' : 'Defective'),
      other: t('returns.analytics.reason.other') || (isAr ? 'أخرى' : 'Other'),
    };
    return labels[key] || key;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('returns.analytics.title') || (isAr ? 'تحليلات المرتجعات' : 'Return Analytics')}</h1>
          <p className="text-muted-foreground text-sm">
            {t('returns.analytics.subtitle') || (isAr ? 'حلّل أسباب الخسارة ومخاطر المرتجعات والقنوات والعناصر المعلقة.' : 'Analyze return risk, loss drivers, channels, and open-cycle bottlenecks.')}
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={() => navigate('/returns')}>
          <ArrowLeft className="w-4 h-4" />
          {t('returns.analytics.back') || (isAr ? 'العودة للمرتجعات' : 'Back to Returns')}
        </Button>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground text-base">{t('common.filter') || (isAr ? 'الفلاتر' : 'Filters')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Select value={datePreset} onValueChange={setDatePreset}>
            <SelectTrigger>
              <SelectValue placeholder={t('filters.dateRange') || (isAr ? 'الفترة' : 'Date Range')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">{t('returns.analytics.filters.last7d') || (isAr ? 'آخر 7 أيام' : 'Last 7 days')}</SelectItem>
              <SelectItem value="30d">{t('returns.analytics.filters.last30d') || (isAr ? 'آخر 30 يوم' : 'Last 30 days')}</SelectItem>
              <SelectItem value="90d">{t('returns.analytics.filters.last90d') || (isAr ? 'آخر 90 يوم' : 'Last 90 days')}</SelectItem>
              <SelectItem value="all">{t('returns.analytics.filters.allTime') || (isAr ? 'كل الوقت' : 'All time')}</SelectItem>
            </SelectContent>
          </Select>

          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger>
              <SelectValue placeholder={t('returns.analytics.filters.channel') || (isAr ? 'القناة' : 'Channel')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('returns.analytics.filters.allChannels') || (isAr ? 'كل القنوات' : 'All Channels')}</SelectItem>
              {channelOptions.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={reasonFilter} onValueChange={setReasonFilter}>
            <SelectTrigger>
              <SelectValue placeholder={t('returns.analytics.filters.reason') || (isAr ? 'السبب' : 'Reason')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('returns.analytics.filters.allReasons') || (isAr ? 'كل الأسباب' : 'All Reasons')}</SelectItem>
              <SelectItem value="damaged">{t('returns.analytics.reason.damaged') || (isAr ? 'تالف' : 'Damaged')}</SelectItem>
              <SelectItem value="wrong_item">{t('returns.analytics.reason.wrongItem') || (isAr ? 'منتج خطأ' : 'Wrong Item')}</SelectItem>
              <SelectItem value="customer_cancel">{t('returns.analytics.reason.customerCancel') || (isAr ? 'إلغاء العميل' : 'Customer Cancel')}</SelectItem>
              <SelectItem value="late_delivery">{t('returns.analytics.reason.lateDelivery') || (isAr ? 'تأخير توصيل' : 'Late Delivery')}</SelectItem>
              <SelectItem value="defective">{t('returns.analytics.reason.defective') || (isAr ? 'معيب' : 'Defective')}</SelectItem>
              <SelectItem value="other">{t('returns.analytics.reason.other') || (isAr ? 'أخرى' : 'Other')}</SelectItem>
            </SelectContent>
          </Select>

          <Input
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            placeholder={t('returns.analytics.filters.productOrSku') || (isAr ? 'فلترة بالمنتج أو SKU' : 'Filter by product or SKU')}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard title={t('returns.analytics.kpi.totalReturns') || (isAr ? 'إجمالي المرتجعات' : 'Total Returns')} value={kpis.totalReturns.toLocaleString()} icon={Package} />
        <KpiCard title={t('returns.analytics.kpi.returnRate') || (isAr ? 'نسبة المرتجعات' : 'Return Rate')} value={`${kpis.returnRate.toFixed(2)}%`} icon={Percent} />
        <KpiCard title={t('returns.analytics.kpi.totalLoss') || (isAr ? 'إجمالي الخسارة' : 'Total Loss Value')} value={`${kpis.totalLoss.toLocaleString()} EGP`} icon={TrendingDown} />
        <KpiCard title={t('returns.analytics.kpi.returnedUnits') || (isAr ? 'القطع المرتجعة' : 'Returned Units')} value={kpis.returnedUnits.toLocaleString()} icon={Boxes} />
        <KpiCard title={t('returns.analytics.kpi.damagedReturns') || (isAr ? 'مرتجعات تالفة' : 'Damaged Returns')} value={kpis.damagedReturns.toLocaleString()} icon={AlertTriangle} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground text-base">{t('returns.analytics.trend.title') || (isAr ? 'المرتجعات عبر الزمن' : 'Returns Over Time')}</CardTitle>
            <CardDescription>{t('returns.analytics.trend.subtitle') || (isAr ? 'اتجاه عدد المرتجعات يوميًا.' : 'Latest daily return volume trend.')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <p className="text-muted-foreground text-sm">{t('common.loading') || (isAr ? 'جارٍ التحميل...' : 'Loading...')}</p>
            ) : trend.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('returns.analytics.empty') || (isAr ? 'لا توجد بيانات مرتجعات للفلاتر المحددة.' : 'No return data in selected filters.')}</p>
            ) : (
              trend.map((row) => {
                const max = Math.max(...trend.map((t) => t.count), 1);
                const width = `${Math.max(6, (row.count / max) * 100)}%`;
                return (
                  <div key={row.date} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-24">{row.date}</span>
                    <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                      <div className="h-2 bg-emerald-500 rounded" style={{ width }} />
                    </div>
                    <span className="text-xs text-foreground w-8 text-right">{row.count}</span>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground text-base">{t('returns.analytics.reasons.title') || (isAr ? 'توزيع أسباب المرتجعات' : 'Return Reasons Breakdown')}</CardTitle>
            <CardDescription>{t('returns.analytics.reasons.subtitle') || (isAr ? 'توزيع الأسباب كنسبة مئوية.' : 'Reason distribution by percentage.')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {reasonBreakdown.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('returns.analytics.reasons.empty') || (isAr ? 'لا توجد بيانات أسباب للفلاتر المحددة.' : 'No reason data in selected filters.')}</p>
            ) : (
              reasonBreakdown.map((row) => (
                <div key={row.reason} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-foreground">{labelReasonLocal(row.reason)}</span>
                    <span className="text-muted-foreground">{row.percent.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 rounded bg-muted overflow-hidden">
                    <div className="h-2 bg-indigo-500 rounded" style={{ width: `${Math.max(6, row.percent)}%` }} />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <DataTableCard
        title={t('returns.analytics.tables.mostReturned.title') || (isAr ? 'أكثر المنتجات مرتجعًا' : 'Most Returned Products')}
        description={t('returns.analytics.tables.mostReturned.subtitle') || (isAr ? 'مرتبة حسب أعلى كمية مرتجعة.' : 'Sorted from highest returned quantity to lowest.')}
        headers={[
          t('returns.analytics.cols.product') || (isAr ? 'المنتج' : 'Product'),
          t('returns.analytics.cols.sku') || 'SKU',
          t('returns.analytics.cols.soldQty') || (isAr ? 'المباع' : 'Sold Qty'),
          t('returns.analytics.cols.returnedQty') || (isAr ? 'المرتجع' : 'Returned Qty'),
          t('returns.analytics.cols.returnRate') || (isAr ? 'نسبة المرتجع' : 'Return Rate'),
          t('returns.analytics.cols.loss') || (isAr ? 'الخسارة' : 'Loss'),
        ]}
        rows={mostReturnedProducts.map((r: any) => [
          r.product,
          r.sku,
          r.soldQty.toLocaleString(),
          r.returnedQty.toLocaleString(),
          `${r.returnRate.toFixed(2)}%`,
          `${r.loss.toLocaleString()} EGP`,
        ])}
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <DataTableCard
          title={t('returns.analytics.tables.topLoss.title') || (isAr ? 'أعلى المنتجات خسارة' : 'Top Loss Products')}
          description={t('returns.analytics.tables.topLoss.subtitle') || (isAr ? 'المنتجات ذات أعلى خسارة مالية من المرتجعات.' : 'Products with highest monetary loss from returns.')}
          headers={[
            t('returns.analytics.cols.product') || (isAr ? 'المنتج' : 'Product'),
            t('returns.analytics.cols.returnValue') || (isAr ? 'قيمة المرتجع' : 'Return Value'),
            t('returns.analytics.cols.units') || (isAr ? 'القطع' : 'Units'),
            t('returns.analytics.cols.channel') || (isAr ? 'القناة' : 'Channel'),
          ]}
          rows={topLossProducts.map((r: any) => [
            r.product,
            `${r.loss.toLocaleString()} EGP`,
            r.returnedQty.toLocaleString(),
            r.channel || (t('common.noData') || 'Unknown'),
          ])}
        />

        <DataTableCard
          title={t('returns.analytics.tables.byChannel.title') || (isAr ? 'المرتجعات حسب القناة' : 'Returns by Channel')}
          description={t('returns.analytics.tables.byChannel.subtitle') || (isAr ? 'الطلبات والمرتجعات ونسبة المرتجعات حسب القناة.' : 'Orders, returns, and return rate by sales channel.')}
          headers={[
            t('returns.analytics.cols.channel') || (isAr ? 'القناة' : 'Channel'),
            t('returns.analytics.cols.orders') || (isAr ? 'الطلبات' : 'Orders'),
            t('returns.analytics.cols.returns') || (isAr ? 'المرتجعات' : 'Returns'),
            t('returns.analytics.cols.rate') || (isAr ? 'النسبة' : 'Rate'),
          ]}
          rows={byChannel.map((r: any) => [
            r.channel,
            r.ordersCount.toLocaleString(),
            r.returnsCount.toLocaleString(),
            `${r.rate.toFixed(2)}%`,
          ])}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <DataTableCard
          title={t('returns.analytics.tables.mostDamaged.title') || (isAr ? 'أكثر المنتجات تلفًا' : 'Most Damaged Products')}
          description={t('returns.analytics.tables.mostDamaged.subtitle') || (isAr ? 'مراجعة التغليف وجودة التعامل.' : 'Damage-heavy items to review packaging and handling quality.')}
          headers={[
            t('returns.analytics.cols.product') || (isAr ? 'المنتج' : 'Product'),
            t('returns.analytics.cols.damagedQty') || (isAr ? 'الكمية التالفة' : 'Damaged Qty'),
            t('returns.analytics.cols.damagePct') || (isAr ? 'نسبة التلف' : 'Damage %'),
          ]}
          rows={damageAnalysis.map((r) => [
            r.product,
            r.damagedQty.toLocaleString(),
            `${r.pct.toFixed(2)}%`,
          ])}
        />

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground text-base">{t('returns.analytics.open.title') || (isAr ? 'مرتجعات معلّقة' : 'Open Returns')}</CardTitle>
            <CardDescription>{t('returns.analytics.open.subtitle') || (isAr ? 'مرتجعات لم تُغلق بعد مرتبة حسب الأيام.' : 'Pending returns not closed yet, sorted by days open.')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {openReturns.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('returns.analytics.open.empty') || (isAr ? 'لا توجد مرتجعات معلّقة للفلاتر المحددة.' : 'No open returns in selected filters.')}</p>
            ) : (
              openReturns.map((r) => (
                <div key={r.id} className="flex items-center justify-between border border-border rounded px-3 py-2">
                  <div>
                    <p className="text-sm text-foreground">{r.orderNo}</p>
                    <p className="text-xs text-muted-foreground line-clamp-1 max-w-[420px]">{r.product}</p>
                  </div>
                  <div className="text-right">
                    <Badge className="bg-amber-500 text-white mb-1">{r.status}</Badge>
                    <p className="text-xs text-muted-foreground">{t('returns.analytics.open.days') || (isAr ? 'أيام معلّقة' : 'days open')}: {r.daysOpen}</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <DataTableCard
        title={t('returns.analytics.tables.profitImpact.title') || (isAr ? 'تأثير المرتجعات على الربح' : 'Return Impact on Profit')}
        description={t('returns.analytics.tables.profitImpact.subtitle') || (isAr ? 'تأثير تقديري بعد خصم خسارة المرتجعات.' : 'Estimated profit impact after subtracting return loss.')}
        headers={[
          t('returns.analytics.cols.product') || (isAr ? 'المنتج' : 'Product'),
          t('returns.analytics.cols.estProfit') || (isAr ? 'ربح تقديري' : 'Est. Profit'),
          t('returns.analytics.cols.returnsLoss') || (isAr ? 'خسارة المرتجعات' : 'Returns Loss'),
          t('returns.analytics.cols.netProfit') || (isAr ? 'صافي الربح' : 'Net Profit'),
        ]}
        rows={impactOnProfit.map((r) => [
          r.product,
          `${r.estimatedProfit.toLocaleString()} EGP`,
          `${r.returnLoss.toLocaleString()} EGP`,
          `${r.netProfit.toLocaleString()} EGP`,
        ])}
      />

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground text-base flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-500" />
            {t('returns.analytics.interpretation.title') || (isAr ? 'تفسير سريع' : 'Business Interpretation')}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>{t('returns.analytics.interpretation.p1') || (isAr ? '- المنتجات الأعلى في "المرتجع" تحتاج مراجعة وصف المنتج/التوقعات.' : '- Items with highest returned quantity should be reviewed for listing/expectations.')}</p>
          <p>{t('returns.analytics.interpretation.p2') || (isAr ? '- المنتجات الأعلى في "الخسارة" تحتاج قرار تسعير/إيقاف/تحسين تغليف.' : '- Highest loss products need pricing/stop/packaging decisions.')}</p>
          <p>{t('returns.analytics.interpretation.p3') || (isAr ? '- القنوات ذات أعلى "نسبة مرتجع" تحتاج تحسين الشحن وسياسة ما بعد البيع.' : '- Channels with highest return rate may need shipping and after-sales improvements.')}</p>
          <p>{t('returns.analytics.interpretation.p4') || (isAr ? '- أي مرتجع مفتوح بعد 7 أيام يجب تصعيده لتقليل الخسارة.' : '- Any open return older than 7 days should be escalated to reduce loss.')}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ title, value, icon: Icon }: { title: string; value: string; icon: any }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-xl font-bold text-foreground mt-1">{value}</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <Icon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DataTableCard({
  title,
  description,
  headers,
  rows,
}: {
  title: string;
  description?: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-foreground text-base">{title}</CardTitle>
        {description ? <CardDescription className="text-muted-foreground">{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data in selected filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  {headers.map((h) => (
                    <th key={h} className="py-2 pr-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={`${title}-${idx}`} className="border-b border-border/70">
                    {r.map((cell, i) => (
                      <td key={`${title}-${idx}-${i}`} className="py-2 pr-3 text-foreground">
                        <div className="max-w-[420px] truncate" title={cell}>
                          {cell}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function classifyReason(raw: string): string {
  const reason = (raw || '').toLowerCase();
  if (reason.includes('damage') || reason.includes('broken') || reason.includes('باط') || reason.includes('تالف')) return 'damaged';
  if (reason.includes('wrong') || reason.includes('different') || reason.includes('خطأ')) return 'wrong_item';
  if (reason.includes('cancel') || reason.includes('mind') || reason.includes('الغاء')) return 'customer_cancel';
  if (reason.includes('late') || reason.includes('delay') || reason.includes('متأخر')) return 'late_delivery';
  if (reason.includes('defect') || reason.includes('quality') || reason.includes('عيب')) return 'defective';
  return 'other';
}

function labelReason(key: string): string {
  const labels: Record<string, string> = {
    damaged: 'Damaged',
    wrong_item: 'Wrong Item',
    customer_cancel: 'Customer Cancel',
    late_delivery: 'Late Delivery',
    defective: 'Defective',
    other: 'Other',
  };
  return labels[key] || key;
}
