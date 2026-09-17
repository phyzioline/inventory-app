import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { ar } from 'date-fns/locale';
import { motion } from 'framer-motion';
import { AlertTriangle, Loader2, Printer } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

const ALL_VALUE = 'all';

export default function LowStockAlerts() {
  const { language, dir } = useLanguage();
  const isAr = language === 'ar';

  const [channelId, setChannelId] = useState<number | null>(null);
  const [vendorId, setVendorId] = useState<number | null>(null);

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
          title: isAr ? `عدد الأصناف: ${rows.length}` : `Items: ${rows.length}`,
          columns: [
            isAr ? 'المنتج' : 'Product',
            'SKU',
            isAr ? 'الحالي' : 'Current',
            isAr ? 'الحد' : 'Minimum',
            isAr ? 'مقترح الطلب' : 'Reorder qty',
            isAr ? 'المورد' : 'Vendor',
          ],
          rows: rows.map((row) => [
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
          <Button variant="outline" onClick={handlePrint} disabled={rows.length === 0}>
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
                {isAr ? `عدد التنبيهات: ${data?.count ?? 0}` : `Alerts: ${data?.count ?? 0}`}
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
                  <TableHead>{isAr ? 'المنتج' : 'Product'}</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>{isAr ? 'الحالي' : 'Current'}</TableHead>
                  <TableHead>{isAr ? 'الحد' : 'Minimum'}</TableHead>
                  <TableHead>{isAr ? 'مقترح الطلب' : 'Reorder qty'}</TableHead>
                  <TableHead>{isAr ? 'المورد' : 'Vendor'}</TableHead>
                  <TableHead>{isAr ? 'آخر حركة' : 'Last movement'}</TableHead>
                  <TableHead>{isAr ? 'الحالة' : 'Status'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
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
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
