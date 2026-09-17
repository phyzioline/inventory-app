import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { ar } from 'date-fns/locale';
import { motion } from 'framer-motion';
import { AlertTriangle, ArrowUpDown, Loader2, Printer } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { printReport } from '@/lib/printUtils';

type AlertRow = {
  id: number;
  product: string;
  sku: string;
  current: number;
  minimum: number;
  reorder_point: number;
  suggested_reorder_qty: number;
  status: string;
  last_movement_at: string | null;
  vendors: string | null;
};

type ChannelOption = { id: number; name: string };
type VendorOption = { id: number; name: string };

type SortField = 'product' | 'sku' | 'current' | 'minimum' | 'suggested_reorder_qty' | 'vendors' | 'last_movement_at' | 'status';

const ALL_VALUE = 'all';

export default function LowStockAlerts() {
  const { language, dir } = useLanguage();
  const isAr = language === 'ar';

  const [channelId, setChannelId] = useState<number | null>(null);
  const [vendorId, setVendorId] = useState<number | null>(null);

  // Excel-style per-column filter row + click-to-sort headers (same pattern as Orders.tsx).
  const [columnFilters, setColumnFilters] = useState({ product: '', sku: '', vendor: '', status: '' });
  const [sortField, setSortField] = useState<SortField>('current');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const { data: channels } = useQuery({
    queryKey: ['channels-for-low-stock'],
    queryFn: () => api.getArray('channels') as Promise<ChannelOption[]>,
  });

  const { data: vendors } = useQuery({
    queryKey: ['vendors-for-low-stock'],
    queryFn: () => api.getArray('vendors') as Promise<VendorOption[]>,
  });

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['low-stock-alerts', channelId, vendorId],
    queryFn: async () => {
      const res = await api.get<{ count: number; data: AlertRow[] }>('alerts/low-stock', {
        params: {
          limit: 100,
          channel_id: channelId ?? undefined,
          vendor_id: vendorId ?? undefined,
        },
      });
      return res;
    },
  });

  const rows = data?.data ?? [];

  const selectedChannelName = useMemo(
    () => channels?.find((c) => c.id === channelId)?.name ?? null,
    [channels, channelId]
  );
  const selectedVendorName = useMemo(
    () => vendors?.find((v) => v.id === vendorId)?.name ?? null,
    [vendors, vendorId]
  );

  const sortIndicator = (field: SortField) => (sortField === field ? (sortDirection === 'asc' ? '↑' : '↓') : '');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDirection(field === 'product' || field === 'sku' || field === 'vendors' ? 'asc' : 'desc');
  };

  const visibleRows = useMemo(() => {
    const productFilter = columnFilters.product.trim().toLowerCase();
    const skuFilter = columnFilters.sku.trim().toLowerCase();
    const vendorFilter = columnFilters.vendor.trim().toLowerCase();

    const filtered = rows.filter((row) => {
      if (productFilter && !row.product.toLowerCase().includes(productFilter)) return false;
      if (skuFilter && !row.sku.toLowerCase().includes(skuFilter)) return false;
      if (vendorFilter && !(row.vendors || '').toLowerCase().includes(vendorFilter)) return false;
      if (columnFilters.status && row.status !== columnFilters.status) return false;
      return true;
    });

    const dir = sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortField) {
        case 'product':
          return a.product.localeCompare(b.product) * dir;
        case 'sku':
          return a.sku.localeCompare(b.sku) * dir;
        case 'vendors':
          return (a.vendors || '').localeCompare(b.vendors || '') * dir;
        case 'status':
          return a.status.localeCompare(b.status) * dir;
        case 'last_movement_at': {
          const av = a.last_movement_at ? new Date(a.last_movement_at).getTime() : 0;
          const bv = b.last_movement_at ? new Date(b.last_movement_at).getTime() : 0;
          return (av - bv) * dir;
        }
        default:
          return ((a[sortField] as number) - (b[sortField] as number)) * dir;
      }
    });
  }, [rows, columnFilters, sortField, sortDirection]);

  const formatLastMovement = (value: string | null) => {
    if (!value) return isAr ? 'لا توجد حركة مسجلة' : 'No recorded movement';
    try {
      return formatDistanceToNow(new Date(value), { addSuffix: true, locale: isAr ? ar : undefined });
    } catch {
      return '—';
    }
  };

  const handlePrint = () => {
    const titleParts = [isAr ? 'تنبيهات نقص المخزون' : 'Low-stock alerts'];
    if (selectedChannelName) titleParts.push(selectedChannelName);
    if (selectedVendorName) titleParts.push(`${isAr ? 'المورد' : 'Vendor'}: ${selectedVendorName}`);

    printReport({
      title: titleParts.join(' — '),
      rtl: isAr,
      sections: [
        {
          title: isAr ? `عدد الأصناف: ${visibleRows.length}` : `Items: ${visibleRows.length}`,
          columns: [
            isAr ? 'المنتج' : 'Product',
            'SKU',
            isAr ? 'الحالي' : 'Current',
            isAr ? 'الحد' : 'Minimum',
            isAr ? 'مقترح الطلب' : 'Reorder qty',
            isAr ? 'المورد' : 'Vendor',
          ],
          rows: visibleRows.map((row) => [
            row.product,
            row.sku,
            row.current,
            row.minimum,
            row.suggested_reorder_qty,
            row.vendors || (isAr ? 'غير مرتبط' : 'Unlinked'),
          ]),
        },
      ],
    });
  };

  return (
    <div className="space-y-6" dir={dir}>
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <AlertTriangle className="w-6 h-6 text-amber-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{isAr ? 'تنبيهات نقص المخزون' : 'Low-stock alerts'}</h1>
            <p className="text-muted-foreground">
              {isAr
                ? 'منتجات تحت الحد الأدنى مع كمية إعادة الطلب المقترحة.'
                : 'Products under minimum with suggested reorder quantities.'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : isAr ? 'تحديث' : 'Refresh'}
          </Button>
          <Button variant="outline" onClick={handlePrint} disabled={visibleRows.length === 0}>
            <Printer className="w-4 h-4 me-2" />
            {isAr ? 'طباعة' : 'Print'}
          </Button>
          <Button asChild variant="secondary">
            <Link to="/purchases">{isAr ? 'المشتريات' : 'Purchases'}</Link>
          </Button>
        </div>
      </motion.div>

      <Tabs
        value={channelId === null ? ALL_VALUE : String(channelId)}
        onValueChange={(v) => setChannelId(v === ALL_VALUE ? null : Number(v))}
      >
        <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
          <TabsTrigger value={ALL_VALUE} className="text-xs sm:text-sm">
            {isAr ? 'الكل' : 'All'}
          </TabsTrigger>
          {(channels ?? []).map((channel) => (
            <TabsTrigger key={channel.id} value={String(channel.id)} className="text-xs sm:text-sm">
              {channel.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base">
                {isAr ? `عدد التنبيهات: ${visibleRows.length}` : `Alerts: ${visibleRows.length}`}
              </CardTitle>
              <CardDescription>
                {isAr
                  ? 'الحد من عمود min_stock أو مواصفات المنتج (min_stock / reorder_point).'
                  : 'Threshold from min_stock column or product specs (min_stock / reorder_point).'}
              </CardDescription>
            </div>
            <Select
              value={vendorId === null ? ALL_VALUE : String(vendorId)}
              onValueChange={(v) => setVendorId(v === ALL_VALUE ? null : Number(v))}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder={isAr ? 'كل الموردين' : 'All vendors'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>{isAr ? 'كل الموردين' : 'All vendors'}</SelectItem>
                {(vendors ?? []).map((vendor) => (
                  <SelectItem key={vendor.id} value={String(vendor.id)}>
                    {vendor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : isError ? (
            <p className="text-destructive text-sm">{isAr ? 'فشل التحميل' : 'Failed to load'}</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {isAr ? 'لا توجد نواقص حالياً.' : 'No low-stock items right now.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort('product')}>
                    <span className="inline-flex items-center gap-1">
                      {isAr ? 'المنتج' : 'Product'} <ArrowUpDown className="w-3 h-3" /> {sortIndicator('product')}
                    </span>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort('sku')}>
                    <span className="inline-flex items-center gap-1">
                      SKU <ArrowUpDown className="w-3 h-3" /> {sortIndicator('sku')}
                    </span>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort('current')}>
                    <span className="inline-flex items-center gap-1">
                      {isAr ? 'الحالي' : 'Current'} <ArrowUpDown className="w-3 h-3" /> {sortIndicator('current')}
                    </span>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort('minimum')}>
                    <span className="inline-flex items-center gap-1">
                      {isAr ? 'الحد' : 'Minimum'} <ArrowUpDown className="w-3 h-3" /> {sortIndicator('minimum')}
                    </span>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort('suggested_reorder_qty')}>
                    <span className="inline-flex items-center gap-1">
                      {isAr ? 'مقترح الطلب' : 'Reorder qty'} <ArrowUpDown className="w-3 h-3" /> {sortIndicator('suggested_reorder_qty')}
                    </span>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort('vendors')}>
                    <span className="inline-flex items-center gap-1">
                      {isAr ? 'المورد' : 'Vendor'} <ArrowUpDown className="w-3 h-3" /> {sortIndicator('vendors')}
                    </span>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort('last_movement_at')}>
                    <span className="inline-flex items-center gap-1">
                      {isAr ? 'آخر حركة' : 'Last movement'} <ArrowUpDown className="w-3 h-3" /> {sortIndicator('last_movement_at')}
                    </span>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort('status')}>
                    <span className="inline-flex items-center gap-1">
                      {isAr ? 'الحالة' : 'Status'} <ArrowUpDown className="w-3 h-3" /> {sortIndicator('status')}
                    </span>
                  </TableHead>
                </TableRow>
                <TableRow>
                  <TableHead className="py-2">
                    <Input
                      className="h-8 text-xs"
                      placeholder={isAr ? 'فلتر المنتج' : 'Filter product'}
                      value={columnFilters.product}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, product: e.target.value }))}
                    />
                  </TableHead>
                  <TableHead className="py-2">
                    <Input
                      className="h-8 text-xs"
                      placeholder={isAr ? 'فلتر SKU' : 'Filter SKU'}
                      value={columnFilters.sku}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, sku: e.target.value }))}
                    />
                  </TableHead>
                  <TableHead className="py-2 text-xs text-muted-foreground">—</TableHead>
                  <TableHead className="py-2 text-xs text-muted-foreground">—</TableHead>
                  <TableHead className="py-2 text-xs text-muted-foreground">—</TableHead>
                  <TableHead className="py-2">
                    <Input
                      className="h-8 text-xs"
                      placeholder={isAr ? 'فلتر المورد' : 'Filter vendor'}
                      value={columnFilters.vendor}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, vendor: e.target.value }))}
                    />
                  </TableHead>
                  <TableHead className="py-2 text-xs text-muted-foreground">—</TableHead>
                  <TableHead className="py-2">
                    <select
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      value={columnFilters.status}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, status: e.target.value }))}
                    >
                      <option value="">{isAr ? 'كل الحالات' : 'All statuses'}</option>
                      <option value="low_stock">{isAr ? 'منخفض' : 'Low'}</option>
                      <option value="out_of_stock">{isAr ? 'نفد' : 'Out'}</option>
                    </select>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
                      {isAr ? 'لا توجد نتائج مطابقة للفلاتر.' : 'No rows match the current filters.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Link className="font-medium text-primary hover:underline" to={`/master-products/${row.id}`}>
                          {row.product}
                        </Link>
                      </TableCell>
                      <TableCell>{row.sku}</TableCell>
                      <TableCell>{row.current}</TableCell>
                      <TableCell>{row.minimum}</TableCell>
                      <TableCell className="font-semibold">{row.suggested_reorder_qty}</TableCell>
                      <TableCell>
                        {row.vendors ? (
                          row.vendors
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground font-normal">
                            {isAr ? 'غير مرتبط' : 'Unlinked'}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatLastMovement(row.last_movement_at)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.status === 'out_of_stock' ? 'destructive' : 'secondary'}>
                          {row.status === 'out_of_stock'
                            ? isAr
                              ? 'نفد'
                              : 'Out'
                            : isAr
                              ? 'منخفض'
                              : 'Low'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
