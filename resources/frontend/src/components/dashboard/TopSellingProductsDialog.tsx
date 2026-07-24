import { useState, useMemo, lazy, Suspense } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTopSellingProducts, TopSellingProduct } from '@/hooks/useTopSellingProducts';
import { useWarehouses } from '@/hooks/useWarehouses';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { TrendingUp, Download, ChevronLeft, ChevronRight, Trophy } from 'lucide-react';
import * as XLSX from 'xlsx';

const ITEMS_PER_PAGE = 10;
const PIE_COLORS = [
  'hsl(173, 80%, 40%)', // primary
  'hsl(199, 89%, 48%)', // info
  'hsl(38, 92%, 50%)',  // warning
  'hsl(142, 76%, 36%)', // success
  'hsl(0, 72%, 51%)',   // destructive
  'hsl(280, 65%, 60%)', // purple
];

type DatePreset = 'today' | 'this_month' | 'last_30' | 'custom';

function getWarehouseLabel(type: string): string {
  const map: Record<string, string> = {
    'store': 'Store',
    'shop': 'Store',
    'amazon_fba': 'Amazon FBA',
    'marketplace': 'Marketplace',
    'fbm': 'FBM',
  };
  return map[type] || type;
}

function getWarehouseLabelAr(type: string): string {
  const map: Record<string, string> = {
    'store': 'المتجر',
    'shop': 'المتجر',
    'amazon_fba': 'أمازون FBA',
    'marketplace': 'سوق إلكتروني',
    'fbm': 'FBM',
  };
  return map[type] || type;
}

interface TopSellingProductsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TopSellingProductsDialog({ open, onOpenChange }: TopSellingProductsDialogProps) {
  const { t, language } = useLanguage();
  const isAr = language === 'ar';
  
  const [datePreset, setDatePreset] = useState<DatePreset>('last_30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [page, setPage] = useState(0);

  const { data: warehouses } = useWarehouses();

  // Calculate date range
  const { dateFrom, dateTo } = useMemo(() => {
    const now = new Date();
    switch (datePreset) {
      case 'today': {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return { dateFrom: start.toISOString(), dateTo: now.toISOString() };
      }
      case 'this_month': {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        return { dateFrom: start.toISOString(), dateTo: now.toISOString() };
      }
      case 'last_30': {
        const start = new Date(now);
        start.setDate(start.getDate() - 30);
        return { dateFrom: start.toISOString(), dateTo: now.toISOString() };
      }
      case 'custom':
        return {
          dateFrom: customFrom ? new Date(customFrom).toISOString() : undefined,
          dateTo: customTo ? new Date(customTo + 'T23:59:59').toISOString() : undefined,
        };
      default:
        return { dateFrom: undefined, dateTo: undefined };
    }
  }, [datePreset, customFrom, customTo]);

  const { data: products, isLoading } = useTopSellingProducts({
    dateFrom,
    dateTo,
    warehouseFilter,
  });

  const totalProfit = useMemo(() => products?.reduce((s, p) => s + p.total_profit, 0) || 0, [products]);
  const totalQuantity = useMemo(() => products?.reduce((s, p) => s + p.total_quantity_sold, 0) || 0, [products]);

  // Pagination
  const totalPages = Math.ceil((products?.length || 0) / ITEMS_PER_PAGE);
  const paginatedProducts = useMemo(() => {
    const start = page * ITEMS_PER_PAGE;
    return products?.slice(start, start + ITEMS_PER_PAGE) || [];
  }, [products, page]);

  // Chart data: top 10 for bar chart
  const barChartData = useMemo(() => {
    return (products?.slice(0, 10) || []).map(p => ({
      name: p.product_name.length > 15 ? p.product_name.slice(0, 15) + '...' : p.product_name,
      quantity: p.total_quantity_sold,
      profit: p.total_profit,
    }));
  }, [products]);

  // Pie chart: sales by warehouse type
  const pieChartData = useMemo(() => {
    const byType = new Map<string, number>();
    for (const p of products || []) {
      const label = isAr ? getWarehouseLabelAr(p.warehouse_type) : getWarehouseLabel(p.warehouse_type);
      byType.set(label, (byType.get(label) || 0) + p.total_quantity_sold);
    }
    return Array.from(byType.entries()).map(([name, value]) => ({ name, value }));
  }, [products, isAr]);

  // Export to Excel
  const handleExport = () => {
    if (!products?.length) return;
    const wsData = products.map((p, i) => ({
      '#': i + 1,
      [isAr ? 'اسم المنتج' : 'Product Name']: p.product_name,
      'SKU': p.product_sku || '-',
      [isAr ? 'مكان البيع' : 'Sales Channel']: isAr ? getWarehouseLabelAr(p.warehouse_type) : getWarehouseLabel(p.warehouse_type),
      [isAr ? 'الكمية المباعة' : 'Qty Sold']: p.total_quantity_sold,
      [isAr ? 'سعر البيع' : 'Selling Price']: p.selling_price,
      [isAr ? 'التكلفة' : 'Cost']: p.cost_price,
      [isAr ? 'إجمالي الأرباح' : 'Total Profit']: Math.round(p.total_profit),
      [isAr ? 'نسبة الربح %' : 'Margin %']: Math.round(p.profit_margin * 100) / 100,
    }));
    const ws = XLSX.utils.json_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isAr ? 'الأكثر مبيعاً' : 'Top Selling');
    XLSX.writeFile(wb, `top-selling-products-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Trophy className="w-6 h-6 text-warning" />
            {isAr ? 'المنتجات الأكثر مبيعًا' : 'Top Selling Products'}
          </DialogTitle>
        </DialogHeader>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
            <CardContent className="p-4 text-center">
              <p className="text-sm text-muted-foreground">{isAr ? 'إجمالي الأرباح' : 'Total Profit'}</p>
              <p className="text-2xl font-bold text-primary">{Math.round(totalProfit).toLocaleString()} EGP</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-info/10 to-info/5 border-info/20">
            <CardContent className="p-4 text-center">
              <p className="text-sm text-muted-foreground">{isAr ? 'إجمالي المبيعات' : 'Total Quantity Sold'}</p>
              <p className="text-2xl font-bold text-info">{totalQuantity.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-success/10 to-success/5 border-success/20">
            <CardContent className="p-4 text-center">
              <p className="text-sm text-muted-foreground">{isAr ? 'عدد المنتجات' : 'Products Count'}</p>
              <p className="text-2xl font-bold text-success">{products?.length || 0}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <Select value={datePreset} onValueChange={(v) => { setDatePreset(v as DatePreset); setPage(0); }}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">{isAr ? 'اليوم' : 'Today'}</SelectItem>
              <SelectItem value="this_month">{isAr ? 'هذا الشهر' : 'This Month'}</SelectItem>
              <SelectItem value="last_30">{isAr ? 'آخر 30 يوم' : 'Last 30 Days'}</SelectItem>
              <SelectItem value="custom">{isAr ? 'مخصص' : 'Custom'}</SelectItem>
            </SelectContent>
          </Select>

          {datePreset === 'custom' && (
            <div className="flex gap-2">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                className="px-3 py-2 rounded-md border border-input bg-background text-sm" />
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                className="px-3 py-2 rounded-md border border-input bg-background text-sm" />
            </div>
          )}

          <Select value={warehouseFilter} onValueChange={(v) => { setWarehouseFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder={isAr ? 'مكان البيع' : 'Sales Channel'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isAr ? 'الكل' : 'All'}</SelectItem>
              {warehouses?.map(w => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={handleExport} className="gap-2 ms-auto">
            <Download className="w-4 h-4" />
            {isAr ? 'تصدير Excel' : 'Export Excel'}
          </Button>
        </div>

        {/* Charts */}
        {!isLoading && products && products.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Bar Chart - Top 10 */}
            <Card>
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold mb-3 text-muted-foreground">
                  {isAr ? 'أعلى 10 منتجات مبيعًا' : 'Top 10 Best Sellers'}
                </h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={barChartData} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 30%, 18%)" />
                    <XAxis type="number" tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 11 }} />
                    <YAxis dataKey="name" type="category" width={100} tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'hsl(222, 47%, 8%)', border: '1px solid hsl(222, 30%, 18%)', borderRadius: '8px' }}
                      labelStyle={{ color: 'hsl(210, 40%, 98%)' }}
                    />
                    <Bar dataKey="quantity" fill="hsl(173, 80%, 40%)" radius={[0, 4, 4, 0]} name={isAr ? 'الكمية' : 'Quantity'} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Pie Chart - By Channel */}
            <Card>
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold mb-3 text-muted-foreground">
                  {isAr ? 'توزيع المبيعات حسب مكان البيع' : 'Sales Distribution by Channel'}
                </h3>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={pieChartData}
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {pieChartData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: 'hsl(222, 47%, 8%)', border: '1px solid hsl(222, 30%, 18%)', borderRadius: '8px' }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Data Table */}
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-12 text-center">#</TableHead>
                <TableHead>{isAr ? 'اسم المنتج' : 'Product Name'}</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>{isAr ? 'مكان البيع' : 'Channel'}</TableHead>
                <TableHead className="text-center">{isAr ? 'الكمية المباعة' : 'Qty Sold'}</TableHead>
                <TableHead className="text-center">{isAr ? 'سعر البيع' : 'Price'}</TableHead>
                <TableHead className="text-center">{isAr ? 'التكلفة' : 'Cost'}</TableHead>
                <TableHead className="text-center">{isAr ? 'إجمالي الأرباح' : 'Profit'}</TableHead>
                <TableHead className="text-center">{isAr ? 'نسبة الربح %' : 'Margin %'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : paginatedProducts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    {isAr ? 'لا توجد بيانات' : 'No data found'}
                  </TableCell>
                </TableRow>
              ) : (
                paginatedProducts.map((p, i) => (
                  <TableRow key={`${p.product_id}_${p.warehouse_name}_${i}`} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="text-center font-medium text-muted-foreground">
                      {page * ITEMS_PER_PAGE + i + 1}
                    </TableCell>
                    <TableCell className="font-medium">{p.product_name}</TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-2 py-0.5 rounded">{p.product_sku || '-'}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {isAr ? getWarehouseLabelAr(p.warehouse_type) : getWarehouseLabel(p.warehouse_type)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center font-semibold">{p.total_quantity_sold}</TableCell>
                    <TableCell className="text-center">{p.selling_price.toLocaleString()} EGP</TableCell>
                    <TableCell className="text-center">{p.cost_price.toLocaleString()} EGP</TableCell>
                    <TableCell className="text-center">
                      <span className={p.total_profit >= 0 ? 'text-success' : 'text-destructive'}>
                        {Math.round(p.total_profit).toLocaleString()} EGP
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={p.profit_margin >= 20 ? 'default' : p.profit_margin >= 0 ? 'secondary' : 'destructive'}>
                        {Math.round(p.profit_margin * 100) / 100}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {isAr ? `عرض ${page * ITEMS_PER_PAGE + 1} إلى ${Math.min((page + 1) * ITEMS_PER_PAGE, products?.length || 0)} من ${products?.length || 0}` 
                : `Showing ${page * ITEMS_PER_PAGE + 1} to ${Math.min((page + 1) * ITEMS_PER_PAGE, products?.length || 0)} of ${products?.length || 0}`}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="flex items-center text-sm px-3">{page + 1} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
