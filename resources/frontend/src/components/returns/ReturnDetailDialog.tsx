import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { returnService } from '@/lib/supabase-services';
import { formatLatinNumber } from '@/lib/utils';

type Props = {
  open: boolean;
  returnId: string | null;
  onOpenChange: (open: boolean) => void;
};

export function ReturnDetailDialog({ open, returnId, onOpenChange }: Props) {
  const { language } = useLanguage();
  const isAr = language === 'ar';

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['return-detail', returnId],
    queryFn: () => returnService.getById(returnId!),
    enabled: open && !!returnId,
  });

  const order = (data as any)?.inventory_order;
  const items = Array.isArray(order?.items) ? order.items : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[min(90vh,800px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isAr ? 'تفاصيل المرتجع' : 'Return details'}
            {data?.id != null ? (
              <span className="ms-2 font-mono text-sm text-muted-foreground">#{data.id}</span>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {isAr ? 'البيانات المسجلة على السيرفر لهذا المرتجع.' : 'Server record for this return.'}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">
            {(error as Error)?.message || (isAr ? 'تعذر التحميل' : 'Failed to load')}
          </p>
        ) : data ? (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">{isAr ? 'الحالة' : 'Status'}</p>
                <Badge variant="outline" className="mt-0.5">
                  {String(data.status || '—')}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{isAr ? 'التصرف (المخزون)' : 'Disposition'}</p>
                <p className="font-medium">{String(data.disposition || '—')}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{isAr ? 'كمية المرتجع' : 'Return quantity'}</p>
                <p className="font-mono tabular-nums">{formatLatinNumber(data.return_quantity ?? 1, { maximumFractionDigits: 0 })}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">SKU</p>
                <p className="font-mono text-xs">{String(data.sku_code || '—')}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">{isAr ? 'السبب' : 'Reason'}</p>
                <p className="whitespace-pre-wrap">{String(data.reason || '—')}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{isAr ? 'مبلغ الاسترداد' : 'Refund amount'}</p>
                <p className="font-mono tabular-nums">{formatLatinNumber(data.refund_amount ?? 0)} EGP</p>
              </div>
              {data.loss_amount != null && Number(data.loss_amount) > 0 ? (
                <div>
                  <p className="text-xs text-muted-foreground">{isAr ? 'خسارة تقديرية' : 'Est. loss'}</p>
                  <p className="font-mono tabular-nums">{formatLatinNumber(data.loss_amount)} EGP</p>
                </div>
              ) : null}
            </div>

            {order ? (
              <div className="rounded-md border border-border">
                <p className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold">
                  {isAr ? 'الطلب المرتبط' : 'Linked order'}
                </p>
                <div className="space-y-1 px-3 py-2 text-xs">
                  <p>
                    <span className="text-muted-foreground">#</span>{' '}
                    <span className="font-mono">{String(order.platform_order_id || order.order_number || order.id)}</span>
                  </p>
                  {order.customer_name ? (
                    <p>
                      <span className="text-muted-foreground">{isAr ? 'العميل' : 'Customer'}:</span>{' '}
                      {order.customer_name}
                    </p>
                  ) : null}
                </div>
                {items.length > 0 ? (
                  <table className="w-full border-t border-border text-xs">
                    <thead>
                      <tr className="bg-muted/30 text-muted-foreground">
                        <th className="px-2 py-1.5 text-start font-medium">{isAr ? 'المنتج' : 'Product'}</th>
                        <th className="px-2 py-1.5 text-end font-medium">SKU</th>
                        <th className="px-2 py-1.5 text-end font-medium">{isAr ? 'الكمية' : 'Qty'}</th>
                        <th className="px-2 py-1.5 text-end font-medium">{isAr ? 'السعر' : 'Price'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it: any, i: number) => (
                        <tr key={it.id || i} className="border-t border-border/80">
                          <td className="px-2 py-1.5 align-top">{it.product_name || it?.sku?.name || '—'}</td>
                          <td className="px-2 py-1.5 text-end font-mono">{it?.sku?.sku || it.sku_code || '—'}</td>
                          <td className="px-2 py-1.5 text-end tabular-nums">
                            {formatLatinNumber(it.quantity ?? 0, { maximumFractionDigits: 3 })}
                          </td>
                          <td className="px-2 py-1.5 text-end tabular-nums">
                            {formatLatinNumber(it.unit_price ?? 0)} EGP
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-3 py-2 text-xs text-muted-foreground">{isAr ? 'لا بنود في الطلب' : 'No line items'}</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{isAr ? 'لا يوجد طلب مرتبط' : 'No linked order'}</p>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
