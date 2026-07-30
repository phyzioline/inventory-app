import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { motion } from 'framer-motion';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type AlertRow = {
  id: number;
  product: string;
  sku: string;
  current: number;
  minimum: number;
  reorder_point: number;
  suggested_reorder_qty: number;
  status: string;
};

export default function LowStockAlerts() {
  const { language, dir } = useLanguage();
  const isAr = language === 'ar';

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['low-stock-alerts'],
    queryFn: async () => {
      const res = await axios.get('/api/inventory/alerts/low-stock', { params: { limit: 100 } });
      return res.data as { count: number; data: AlertRow[] };
    },
  });

  const rows = data?.data ?? [];

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
          <Button asChild variant="secondary">
            <Link to="/purchases">{isAr ? 'المشتريات' : 'Purchases'}</Link>
          </Button>
        </div>
      </motion.div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base">
            {isAr ? `عدد التنبيهات: ${data?.count ?? 0}` : `Alerts: ${data?.count ?? 0}`}
          </CardTitle>
          <CardDescription>
            {isAr
              ? 'الحد من عمود min_stock أو مواصفات المنتج (min_stock / reorder_point).'
              : 'Threshold from min_stock column or product specs (min_stock / reorder_point).'}
          </CardDescription>
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
