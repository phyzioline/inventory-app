import { useMemo } from 'react';
import { ArrowRight, Calendar, MapPin, Package } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn, getProductImageSrc } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TransferBatch } from '@/lib/transferBatchUtils';
import { buildTransferBatchPreview } from '@/lib/transferBatchPreview';

type Props = {
  open: boolean;
  batch: TransferBatch | null;
  txById: Map<string, any>;
  resolveLocationName: (id: string) => string;
  onOpenChange: (open: boolean) => void;
  onSelectItem?: (txId: string) => void;
};

const excelTable = 'w-full border-collapse border border-border text-xs leading-tight';
const excelTh = 'border border-border bg-muted/90 px-2 py-1.5 font-semibold whitespace-nowrap';
const excelTd = 'border border-border px-2 py-1.5 align-middle';
const excelTdNum = 'border border-border px-2 py-1.5 text-center font-mono tabular-nums';

export function TransferBatchPreviewDialog({
  open,
  batch,
  txById,
  resolveLocationName,
  onOpenChange,
  onSelectItem,
}: Props) {
  const { language, dir } = useLanguage();
  const isAr = language === 'ar';
  const rtl = dir === 'rtl';

  const preview = useMemo(() => {
    if (!batch) return null;
    return buildTransferBatchPreview(batch, resolveLocationName, txById);
  }, [batch, resolveLocationName, txById]);

  const created = preview?.meta.createdAt ? new Date(preview.meta.createdAt) : null;
  const createdLabel =
    created && !Number.isNaN(created.getTime())
      ? created.toLocaleString(isAr ? 'ar-EG' : 'en-US', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[96vh] max-h-[96vh] w-[99vw] max-w-[99vw] flex-col gap-3 overflow-hidden p-3 sm:p-4">
        <DialogHeader className="shrink-0 space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4 text-primary" />
            {isAr ? 'ملخص معاينة التحويل' : 'Transfer preview summary'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isAr
              ? 'المنتجات والكميات التي تم تحويلها في هذه الدفعة.'
              : 'Products and quantities transferred in this batch.'}
          </DialogDescription>
        </DialogHeader>

        {preview ? (
          <>
            <div className="grid shrink-0 grid-cols-1 gap-2 md:grid-cols-4">
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  {isAr ? 'التاريخ' : 'Date'}
                </div>
                <div className="text-sm font-semibold">{createdLabel}</div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" />
                  {isAr ? 'المسار' : 'Route'}
                </div>
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <span className="truncate" title={preview.meta.fromName}>
                    {preview.meta.fromName}
                  </span>
                  <ArrowRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground', rtl && 'rotate-180')} />
                  <span className="truncate" title={preview.meta.toName}>
                    {preview.meta.toName}
                  </span>
                </div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="mb-1 text-xs text-muted-foreground">{isAr ? 'الإجمالي' : 'Totals'}</div>
                <div className="text-sm font-semibold">
                  {preview.meta.itemCount} {isAr ? 'منتج' : 'products'} · {preview.meta.totalQty}{' '}
                  {isAr ? 'وحدة' : 'units'}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="mb-1 text-xs text-muted-foreground">
                  {preview.meta.shipmentId ? (isAr ? 'شحنة FBA' : 'FBA shipment') : isAr ? 'ملاحظات' : 'Notes'}
                </div>
                {preview.meta.shipmentId ? (
                  <div className="space-y-0.5 text-sm">
                    <div className="font-mono font-semibold">{preview.meta.shipmentId}</div>
                    {preview.meta.shipToFc ? (
                      <div className="text-xs text-muted-foreground">FC: {preview.meta.shipToFc}</div>
                    ) : null}
                  </div>
                ) : (
                  <div className="line-clamp-2 text-sm text-muted-foreground">
                    {preview.meta.userNotes || '—'}
                  </div>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-md border">
              <table className={excelTable}>
                <thead className="sticky top-0 z-10 bg-background">
                  <tr>
                    <th className={cn(excelTh, 'w-[56px] text-center')}>{isAr ? 'صورة' : 'Image'}</th>
                    <th className={cn(excelTh, 'min-w-[110px] text-start')}>{isAr ? 'SKU المحل' : 'Shop SKU'}</th>
                    <th className={cn(excelTh, 'w-8 text-center')} />
                    <th className={cn(excelTh, 'min-w-[110px] text-start')}>{isAr ? 'SKU الوجهة' : 'Dest SKU'}</th>
                    <th className={cn(excelTh, 'min-w-[180px] text-start')}>{isAr ? 'المنتج' : 'Product'}</th>
                    <th className={cn(excelTh, 'w-20 text-center')}>{isAr ? 'الكمية' : 'Qty'}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr
                      key={row.id}
                      className={cn('even:bg-muted/15', onSelectItem && 'cursor-pointer hover:bg-muted/40')}
                      onClick={() => onSelectItem?.(row.id)}
                    >
                      <td className={cn(excelTd, 'text-center')}>
                        <div className="mx-auto flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
                          {row.imageUrl ? (
                            <img
                              src={getProductImageSrc(row.imageUrl)}
                              alt=""
                              className="h-full w-full object-cover"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          ) : (
                            <Package className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </td>
                      <td className={cn(excelTd, 'font-mono text-[11px]')}>{row.sourceSku}</td>
                      <td className={cn(excelTd, 'text-center text-muted-foreground')}>
                        <ArrowRight className={cn('mx-auto h-3.5 w-3.5', rtl && 'rotate-180')} />
                      </td>
                      <td className={cn(excelTd, 'font-mono text-[11px]')}>{row.destSku}</td>
                      <td className={cn(excelTd, 'max-w-[240px] truncate text-[11px]')} title={row.productName}>
                        {row.productName}
                      </td>
                      <td className={excelTdNum}>
                        <Badge variant="outline" className="font-bold tabular-nums">
                          {row.quantity}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 bg-muted/95 font-semibold">
                  <tr>
                    <td colSpan={5} className={cn(excelTd, 'text-end text-xs')}>
                      {isAr ? 'الإجمالي' : 'Total'}
                    </td>
                    <td className={cn(excelTdNum, 'text-green-700')}>{preview.meta.totalQty}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ) : null}

        <DialogFooter className="shrink-0 border-t pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {isAr ? 'إغلاق' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
