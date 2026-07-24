import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  BarChart3,
  Search,
  Download,
  Filter,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Package,
  ShoppingCart,
  Truck,
  Calendar,
  RefreshCw
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { useWarehouses } from '@/hooks/useWarehouses';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useProducts } from '@/hooks/useProducts';
import { usePurchaseInvoices } from '@/hooks/usePurchases';
import { useSalesOrders } from '@/hooks/useSales';
import { useMarginAlerts } from '@/hooks/useMarginAlerts';
import { useReturnRates } from '@/hooks/useReturnRates';
import { useReturns } from '@/hooks/useReturns';
import { useDeadStock as getDeadStock } from '@/hooks/useDeadStock';
import { exportToExcel } from '@/lib/excelUtils';

type ReportType = 'sales' | 'purchases' | 'inventory' | 'returns' | 'profit' | 'dead-stock' | 'margin-alerts' | 'return-rates';
type DateRange = { from: Date | undefined; to: Date | undefined };

const CHART_COLORS = [
  'hsl(173, 80%, 40%)',
  'hsl(199, 89%, 48%)',
  'hsl(142, 76%, 36%)',
  'hsl(38, 92%, 50%)',
  'hsl(280, 65%, 60%)',
];

export default function Reports() {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const reportType = (searchParams.get('type') as ReportType) || 'sales';
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [productFilter, setProductFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState<DateRange>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date())
  });
  const reportTypeLabels: Record<ReportType, string> = {
    sales: t('reports.sales'),
    purchases: t('reports.purchases'),
    inventory: t('reports.inventory'),
    returns: t('reports.returns'),
    profit: t('reports.profit'),
    'dead-stock': t('reports.deadStock90'),
    'margin-alerts': t('reports.lowMarginAlerts'),
    'return-rates': t('reports.returnRatesBySku'),
  };
  const toNumber = (value: unknown) => {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  };

  const handleReportTypeChange = (value: ReportType) => {
    setSearchParams({ type: value });
  };

  // Data hooks
  const { data: warehouses = [] } = useWarehouses();
  const { data: suppliers = [] } = useSuppliers();
  const { data: products = [] } = useProducts();
  const { data: purchases = [] } = usePurchaseInvoices();
  const { data: salesData = [] } = useSalesOrders();
  const sales = Array.isArray(salesData) ? salesData : [];
  const { data: returnsPayload } = useReturns();
  const returns = returnsPayload?.data ?? [];
  const { data: deadStock = [] } = getDeadStock(90);
  const { data: marginAlerts = [] } = useMarginAlerts(0.20);
  const { data: returnRates = [] } = useReturnRates();

  // Quick date presets
  const datePresets = [
    { label: t('reports.today'), from: new Date(), to: new Date() },
    { label: t('reports.last7Days'), from: subDays(new Date(), 7), to: new Date() },
    { label: t('reports.last30Days'), from: subDays(new Date(), 30), to: new Date() },
    { label: t('reports.thisMonth'), from: startOfMonth(new Date()), to: endOfMonth(new Date()) },
    { label: t('reports.lastMonth'), from: startOfMonth(subMonths(new Date(), 1)), to: endOfMonth(subMonths(new Date(), 1)) },
  ];

  // Calculate summary statistics
  const stats = useMemo(() => {
    const filteredSales = sales.filter(s => {
      const date = new Date(s.created_at);
      const inDateRange = (!dateRange.from || date >= dateRange.from) && (!dateRange.to || date <= dateRange.to);
      const inWarehouse = warehouseFilter === 'all' || s.warehouse_id === warehouseFilter;
      return inDateRange && inWarehouse;
    });

    const filteredPurchases = purchases.filter(p => {
      const date = new Date(p.created_at);
      const inDateRange = (!dateRange.from || date >= dateRange.from) && (!dateRange.to || date <= dateRange.to);
      const inWarehouse = warehouseFilter === 'all' || p.warehouse_id === warehouseFilter;
      const inSupplier = supplierFilter === 'all' || p.supplier_id === supplierFilter;
      return inDateRange && inWarehouse && inSupplier;
    });

    const totalSales = filteredSales.reduce((sum, s) => sum + toNumber(s.total_amount), 0);
    const totalPurchases = filteredPurchases.reduce((sum, p) => sum + toNumber(p.total_amount), 0);
    const totalReturns = returns.filter(r => {
      const date = new Date(r.created_at);
      return (!dateRange.from || date >= dateRange.from) && (!dateRange.to || date <= dateRange.to);
    }).reduce((sum, r) => sum + toNumber(r.refund_amount), 0);

    const profit = totalSales - totalPurchases - totalReturns;

    return {
      totalSales,
      totalPurchases,
      totalReturns,
      profit,
      salesCount: filteredSales.length,
      purchasesCount: filteredPurchases.length,
      returnsCount: returns.length,
      averageOrderValue: filteredSales.length > 0 ? totalSales / filteredSales.length : 0
    };
  }, [sales, purchases, returns, dateRange, warehouseFilter, supplierFilter]);

  // Generate chart data
  const chartData = useMemo(() => {
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = subDays(new Date(), 6 - i);
      const dateStr = format(date, 'yyyy-MM-dd');
      const dayLabel = format(date, 'EEE');

      const daySales = sales
        .filter(s => format(new Date(s.created_at), 'yyyy-MM-dd') === dateStr)
        .reduce((sum, s) => sum + toNumber(s.total_amount), 0);

      const dayPurchases = purchases
        .filter(p => format(new Date(p.created_at), 'yyyy-MM-dd') === dateStr)
        .reduce((sum, p) => sum + toNumber(p.total_amount), 0);

      return { name: dayLabel, sales: daySales, purchases: dayPurchases };
    });

    return last7Days;
  }, [sales, purchases]);

  // Category distribution for pie chart
  const categoryData = useMemo(() => {
    const statusCounts: Record<string, number> = {};
    sales.forEach(s => {
      const status = s.status || 'pending';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    return Object.entries(statusCounts).map(([name, value]) => ({ name, value }));
  }, [sales]);

  // Filter report data based on type
  const reportData = useMemo(() => {
    let data: any[] = [];

    switch (reportType) {
      case 'sales':
        data = sales.map(s => ({
          id: s.id,
          date: format(new Date(s.created_at), 'yyyy-MM-dd'),
          reference: s.order_number,
          customer: s.customer_name || 'Walk-in',
          warehouse: warehouses.find(w => w.id === s.warehouse_id)?.name || '-',
          amount: toNumber(s.total_amount),
          status: s.status
        }));
        break;
      case 'purchases':
        data = purchases.map(p => ({
          id: p.id,
          date: format(new Date(p.created_at), 'yyyy-MM-dd'),
          reference: p.invoice_number,
          supplier: suppliers.find(s => s.id === p.supplier_id)?.name || '-',
          warehouse: warehouses.find(w => w.id === p.warehouse_id)?.name || '-',
          amount: toNumber(p.total_amount),
          status: p.status
        }));
        break;
      case 'inventory':
        data = products.map(p => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category?.name || '-',
          lastPurchasePrice: p.last_purchase_price || 0,
          avgPurchasePrice: p.avg_purchase_price || 0,
          sellingPrice: p.selling_price || 0
        }));
        break;
      case 'returns':
        data = returns.map(r => ({
          id: r.id,
          date: format(new Date(r.created_at), 'yyyy-MM-dd'),
          reference: r.return_number,
          type: r.return_type,
          reason: r.reason || '-',
          amount: toNumber(r.refund_amount),
          status: r.return_status
        }));
        break;
      case 'profit':
        // Aggregate by day
        const profitByDay: Record<string, { sales: number; purchases: number; returns: number }> = {};
        sales.forEach(s => {
          const day = format(new Date(s.created_at), 'yyyy-MM-dd');
          if (!profitByDay[day]) profitByDay[day] = { sales: 0, purchases: 0, returns: 0 };
          profitByDay[day].sales += toNumber(s.total_amount);
        });
        purchases.forEach(p => {
          const day = format(new Date(p.created_at), 'yyyy-MM-dd');
          if (!profitByDay[day]) profitByDay[day] = { sales: 0, purchases: 0, returns: 0 };
          profitByDay[day].purchases += toNumber(p.total_amount);
        });
        returns.forEach(r => {
          const day = format(new Date(r.created_at), 'yyyy-MM-dd');
          if (!profitByDay[day]) profitByDay[day] = { sales: 0, purchases: 0, returns: 0 };
          profitByDay[day].returns += toNumber(r.refund_amount);
        });
        data = Object.entries(profitByDay).map(([date, values]) => ({
          date,
          sales: values.sales,
          purchases: values.purchases,
          returns: values.returns,
          profit: values.sales - values.purchases - values.returns
        })).sort((a, b) => b.date.localeCompare(a.date));
        break;
      case 'dead-stock':
        data = deadStock.map(d => ({
          id: d.id,
          sku: d.code,
          name: d.name,
          current_stock: d.current_stock,
          cost_price: d.cost_price,
          value_tied_up: d.value_tied_up
        })).sort((a, b) => b.value_tied_up - a.value_tied_up);
        break;
      case 'margin-alerts':
        data = marginAlerts.map(m => ({
          id: m.id,
          sku: m.code,
          name: m.name,
          selling_price: m.selling_price,
          cost_price: m.cost_price,
          margin_percent: m.margin_percent
        })).sort((a, b) => a.margin_percent - b.margin_percent);
        break;
      case 'return-rates':
        data = returnRates.map(r => ({
          id: r.id,
          sku: r.code,
          name: r.name,
          total_sold: r.total_sold,
          total_returned: r.total_returned,
          return_rate: r.return_rate
        })).sort((a, b) => b.return_rate - a.return_rate);
        break;
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      data = data.filter(item =>
        Object.values(item).some(val =>
          String(val).toLowerCase().includes(query)
        )
      );
    }

    return data;
  }, [reportType, sales, purchases, products, returns, warehouses, suppliers, searchQuery]);

  const handleExport = () => {
    exportToExcel(reportData, `${reportType}_report_${format(new Date(), 'yyyy-MM-dd')}`, `${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Report`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <BarChart3 className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t('reports.title')}</h1>
            <p className="text-muted-foreground">{t('reports.subtitle')}</p>
          </div>
        </div>
        <Button onClick={handleExport}>
          <Download className="w-4 h-4 mr-2" />
          {t('reports.exportExcel')}
        </Button>
      </motion.div>

      {/* Filters and Search */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex flex-col lg:flex-row gap-4">
              {/* Search */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={t('reports.searchReports')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Report Type */}
              <Select value={reportType} onValueChange={handleReportTypeChange}>
                <SelectTrigger className="w-full lg:w-40">
                  <SelectValue placeholder={t('reports.reportType')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sales">{t('reports.sales')}</SelectItem>
                  <SelectItem value="purchases">{t('reports.purchases')}</SelectItem>
                  <SelectItem value="inventory">{t('reports.inventory')}</SelectItem>
                  <SelectItem value="returns">{t('reports.returns')}</SelectItem>
                  <SelectItem value="profit">{t('reports.profit')}</SelectItem>
                  <SelectItem value="dead-stock">{t('reports.deadStock90')}</SelectItem>
                  <SelectItem value="margin-alerts">{t('reports.lowMarginAlerts')}</SelectItem>
                  <SelectItem value="return-rates">{t('reports.returnRatesBySku')}</SelectItem>
                </SelectContent>
              </Select>

              {/* Warehouse Filter */}
              <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
                <SelectTrigger className="w-full lg:w-40">
                  <SelectValue placeholder={t('filters.warehouse')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('filters.allWarehouses')}</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Supplier Filter */}
              {reportType === 'purchases' && (
                <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                  <SelectTrigger className="w-full lg:w-40">
                    <SelectValue placeholder={t('filters.supplier')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('filters.allSuppliers')}</SelectItem>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Date Range */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full lg:w-auto justify-start">
                    <Calendar className="w-4 h-4 mr-2" />
                    {dateRange.from ? (
                      dateRange.to ? (
                        <>
                          {format(dateRange.from, 'LLL dd')} - {format(dateRange.to, 'LLL dd')}
                        </>
                      ) : (
                        format(dateRange.from, 'LLL dd, y')
                      )
                    ) : (
                      t('reports.pickDateRange')
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <div className="p-3 border-b space-y-2">
                    <p className="text-sm font-medium">{t('reports.quickSelect')}</p>
                    <div className="flex flex-wrap gap-2">
                      {datePresets.map((preset) => (
                        <Button
                          key={preset.label}
                          variant="outline"
                          size="sm"
                          onClick={() => setDateRange({ from: preset.from, to: preset.to })}
                        >
                          {preset.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <CalendarComponent
                    mode="range"
                    selected={{ from: dateRange.from, to: dateRange.to }}
                    onSelect={(range) => setDateRange({ from: range?.from, to: range?.to })}
                    numberOfMonths={2}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Summary Statistics */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <Card className="stat-card cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onClick={() => handleReportTypeChange('sales')}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('reports.totalSales')}</p>
                <p className="text-2xl font-bold">{toNumber(stats.totalSales).toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">{stats.salesCount} {t('reports.orders')}</p>
              </div>
              <div className="p-3 rounded-lg bg-success/10">
                <TrendingUp className="w-5 h-5 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="stat-card cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onClick={() => handleReportTypeChange('purchases')}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('reports.totalPurchases')}</p>
                <p className="text-2xl font-bold">{toNumber(stats.totalPurchases).toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">{stats.purchasesCount} {t('reports.invoices')}</p>
              </div>
              <div className="p-3 rounded-lg bg-info/10">
                <ShoppingCart className="w-5 h-5 text-info" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="stat-card cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onClick={() => handleReportTypeChange('returns')}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('reports.returns')}</p>
                <p className="text-2xl font-bold">{toNumber(stats.totalReturns).toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">{stats.returnsCount} {t('reports.returns')}</p>
              </div>
              <div className="p-3 rounded-lg bg-warning/10">
                <RefreshCw className="w-5 h-5 text-warning" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="stat-card cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onClick={() => handleReportTypeChange('profit')}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('reports.netProfit')}</p>
                <p className={`text-2xl font-bold ${stats.profit >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {toNumber(stats.profit).toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('reports.aov')}: {toNumber(stats.averageOrderValue).toFixed(2)}
                </p>
              </div>
              <div className={`p-3 rounded-lg ${stats.profit >= 0 ? 'bg-success/10' : 'bg-destructive/10'}`}>
                {toNumber(stats.profit) >= 0 ? (
                  <TrendingUp className="w-5 h-5 text-success" />
                ) : (
                  <TrendingDown className="w-5 h-5 text-destructive" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Charts */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
      >
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">{t('reports.salesVsPurchases')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Bar dataKey="sales" fill="hsl(173, 80%, 40%)" name={t('reports.salesLabel')} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="purchases" fill="hsl(199, 89%, 48%)" name={t('reports.purchasesLabel')} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">{t('reports.orderStatusDistribution')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {categoryData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Report Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
      >
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">{`${reportTypeLabels[reportType]} ${t('reports.reportSuffix')}`}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {reportType === 'sales' && (
                      <>
                        <TableHead>{t('common.date')}</TableHead>
                        <TableHead>{t('reports.orderNumber')}</TableHead>
                        <TableHead>{t('table.customer')}</TableHead>
                        <TableHead>{t('table.warehouse')}</TableHead>
                        <TableHead className="text-right">{t('common.amount')}</TableHead>
                        <TableHead>{t('common.status')}</TableHead>
                      </>
                    )}
                    {reportType === 'purchases' && (
                      <>
                        <TableHead>{t('common.date')}</TableHead>
                        <TableHead>{t('reports.invoiceNumber')}</TableHead>
                        <TableHead>{t('filters.supplier')}</TableHead>
                        <TableHead>{t('table.warehouse')}</TableHead>
                        <TableHead className="text-right">{t('common.amount')}</TableHead>
                        <TableHead>{t('common.status')}</TableHead>
                      </>
                    )}
                    {reportType === 'inventory' && (
                      <>
                        <TableHead>SKU</TableHead>
                        <TableHead>{t('reports.productName')}</TableHead>
                        <TableHead>{t('table.category')}</TableHead>
                        <TableHead className="text-right">{t('reports.lastPurchase')}</TableHead>
                        <TableHead className="text-right">{t('reports.avgPurchase')}</TableHead>
                        <TableHead className="text-right">{t('reports.sellingPrice')}</TableHead>
                      </>
                    )}
                    {reportType === 'returns' && (
                      <>
                        <TableHead>{t('common.date')}</TableHead>
                        <TableHead>{t('reports.returnNumber')}</TableHead>
                        <TableHead>{t('common.type')}</TableHead>
                        <TableHead>{t('reports.reason')}</TableHead>
                        <TableHead className="text-right">{t('common.amount')}</TableHead>
                        <TableHead>{t('common.status')}</TableHead>
                      </>
                    )}
                    {reportType === 'profit' && (
                      <>
                        <TableHead>{t('common.date')}</TableHead>
                        <TableHead className="text-right">{t('reports.salesLabel')}</TableHead>
                        <TableHead className="text-right">{t('reports.purchasesLabel')}</TableHead>
                        <TableHead className="text-right">{t('reports.returnsLabel')}</TableHead>
                        <TableHead className="text-right">{t('reports.profitLabel')}</TableHead>
                      </>
                    )}
                    {reportType === 'dead-stock' && (
                      <>
                        <TableHead>SKU</TableHead>
                        <TableHead>{t('reports.productName')}</TableHead>
                        <TableHead className="text-right">{t('reports.currentStock')}</TableHead>
                        <TableHead className="text-right">{t('reports.unitCost')}</TableHead>
                        <TableHead className="text-right">{t('reports.valueTiedUp')}</TableHead>
                      </>
                    )}
                    {reportType === 'margin-alerts' && (
                      <>
                        <TableHead>SKU</TableHead>
                        <TableHead>{t('reports.productName')}</TableHead>
                        <TableHead className="text-right">{t('reports.costPrice')}</TableHead>
                        <TableHead className="text-right">{t('reports.sellingPrice')}</TableHead>
                        <TableHead className="text-right">{t('reports.marginPercent')}</TableHead>
                      </>
                    )}
                    {reportType === 'return-rates' && (
                      <>
                        <TableHead>SKU</TableHead>
                        <TableHead>{t('reports.productName')}</TableHead>
                        <TableHead className="text-right">{t('reports.soldQty')}</TableHead>
                        <TableHead className="text-right">{t('reports.returnedQty')}</TableHead>
                        <TableHead className="text-right">{t('reports.returnRatePercent')}</TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData.slice(0, 50).map((item, index) => (
                    <TableRow key={item.id || index}>
                      {reportType === 'sales' && (
                        <>
                          <TableCell>{item.date}</TableCell>
                          <TableCell className="font-medium">{item.reference}</TableCell>
                          <TableCell>{item.customer}</TableCell>
                          <TableCell>{item.warehouse}</TableCell>
                          <TableCell className="text-right">{toNumber(item.amount).toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">{item.status}</Badge>
                          </TableCell>
                        </>
                      )}
                      {reportType === 'purchases' && (
                        <>
                          <TableCell>{item.date}</TableCell>
                          <TableCell className="font-medium">{item.reference}</TableCell>
                          <TableCell>{item.supplier}</TableCell>
                          <TableCell>{item.warehouse}</TableCell>
                          <TableCell className="text-right">{toNumber(item.amount).toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">{item.status}</Badge>
                          </TableCell>
                        </>
                      )}
                      {reportType === 'inventory' && (
                        <>
                          <TableCell className="font-medium">{item.sku}</TableCell>
                          <TableCell>{item.name}</TableCell>
                          <TableCell>{item.category}</TableCell>
                          <TableCell className="text-right">{toNumber(item.lastPurchasePrice).toFixed(2)}</TableCell>
                          <TableCell className="text-right">{toNumber(item.avgPurchasePrice).toFixed(2)}</TableCell>
                          <TableCell className="text-right">{toNumber(item.sellingPrice).toFixed(2)}</TableCell>
                        </>
                      )}
                      {reportType === 'returns' && (
                        <>
                          <TableCell>{item.date}</TableCell>
                          <TableCell className="font-medium">{item.reference}</TableCell>
                          <TableCell className="capitalize">{item.type}</TableCell>
                          <TableCell>{item.reason}</TableCell>
                          <TableCell className="text-right">{toNumber(item.amount).toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">{item.status}</Badge>
                          </TableCell>
                        </>
                      )}
                      {reportType === 'profit' && (
                        <>
                          <TableCell>{item.date}</TableCell>
                          <TableCell className="text-right text-success">{toNumber(item.sales).toFixed(2)}</TableCell>
                          <TableCell className="text-right text-info">{toNumber(item.purchases).toFixed(2)}</TableCell>
                          <TableCell className="text-right text-warning">{toNumber(item.returns).toFixed(2)}</TableCell>
                          <TableCell className={`text-right font-medium ${item.profit >= 0 ? 'text-success' : 'text-destructive'}`}>
                            {toNumber(item.profit).toFixed(2)}
                          </TableCell>
                        </>
                      )}
                      {reportType === 'dead-stock' && (
                        <>
                          <TableCell className="font-medium">{item.sku}</TableCell>
                          <TableCell>{item.name}</TableCell>
                          <TableCell className="text-right">{item.current_stock}</TableCell>
                          <TableCell className="text-right">{toNumber(item.cost_price).toFixed(2)}</TableCell>
                          <TableCell className="text-right font-medium text-destructive">{toNumber(item.value_tied_up).toFixed(2)}</TableCell>
                        </>
                      )}
                      {reportType === 'margin-alerts' && (
                        <>
                          <TableCell className="font-medium">{item.sku}</TableCell>
                          <TableCell>{item.name}</TableCell>
                          <TableCell className="text-right">{toNumber(item.cost_price).toFixed(2)}</TableCell>
                          <TableCell className="text-right">{toNumber(item.selling_price).toFixed(2)}</TableCell>
                          <TableCell className="text-right font-medium text-warning">{toNumber(item.margin_percent).toFixed(1)}%</TableCell>
                        </>
                      )}
                      {reportType === 'return-rates' && (
                        <>
                          <TableCell className="font-medium">{item.sku}</TableCell>
                          <TableCell>{item.name}</TableCell>
                          <TableCell className="text-right">{item.total_sold}</TableCell>
                          <TableCell className="text-right">{item.total_returned}</TableCell>
                          <TableCell className="text-right font-medium text-destructive">{toNumber(item.return_rate).toFixed(1)}%</TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {reportData.length > 50 && (
                <p className="text-sm text-muted-foreground mt-4 text-center">
                  {t('reports.showingRecords')} {reportData.length} {t('reports.exportToSeeAll')}
                </p>
              )}
              {reportData.length === 0 && (
                <div className="h-40 flex items-center justify-center text-muted-foreground">
                  {t('reports.noDataForFilters')}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div >
  );
}
