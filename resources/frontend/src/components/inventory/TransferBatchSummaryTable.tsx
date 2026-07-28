import { CheckCircle2, AlertCircle, MinusCircle, Pencil, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn, getProductImageSrc } from '@/lib/utils';
import type { FbaTransferSummaryRow } from '@/components/inventory/FbaTransferSummaryTable';
import type { TransferBatchSummary, TransferBatchSummaryRow } from '@/lib/transferBatchPreview';

const excelTable = 'w-full border-collapse border border-border text-[11px] leading-tight';
const excelTh = 'border border-border bg-muted/90 px-2 py-1.5 font-semibold whitespace-nowrap';
const excelTd = 'border border-border px-2 py-1 align-middle';
const excelTdNum = 'border border-border px-2 py-1 text-center font-mono tabular-nums';
const excelTrEven = 'even:bg-muted/20';

type Props = {
  summary: TransferBatchSummary;
  isAr: boolean;
  className?: string;
  onEditRow?: (txId: string) => void;
};

function statusLabel(status: FbaTransferSummaryRow['status'], isAr: boolean): string {
  if (status === 'transferred') return isAr ? 'تم التحويل' : 'Transferred';
  if (status === 'skipped') return isAr ? 'تخطي (0)' : 'Skipped (0)';
  return isAr ? 'غير مربوط' : 'Not linked';
}

function statusIcon(status: FbaTransferSummaryRow['status']) {
  if (status === 'transferred') return <CheckCircle2 className="inline-block h-3.5 w-3.5 text-green-600" />;
  if (status === 'skipped') return <MinusCircle className="inline-block h-3.5 w-3.5 text-muted-foreground" />;
  return <AlertCircle className="inline-block h-3.5 w-3.5 text-red-600" />;
}

function SkuCell({ sku, imageUrl }: { sku: string; imageUrl?: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/30">
        {imageUrl ? (
          <img
            src={getProductImageSrc(imageUrl)}
            alt=""
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <Package className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </div>
      <span className="truncate font-mono text-[10px]">{sku}</span>
    </div>
  );
}

export function TransferBatchSummaryTable({ summary, isAr, className, onEditRow }: Props) {
  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <div>
          <span className="text-muted-foreground">{isAr ? 'المسار:' : 'Route:'}</span>{' '}
          <span className="font-semibold">
            {summary.fromName} → {summary.toName}
          </span>
        </div>
        {summary.ship_to_fc ? (
          <div>
            <span className="text-muted-foreground">FC:</span>{' '}
            <span className="font-mono">{summary.ship_to_fc}</span>
          </div>
        ) : null}
        <div>
          <span className="text-muted-foreground">{isAr ? 'صفوف:' : 'Rows:'}</span> <strong>{summary.rows.length}</strong>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <table className={excelTable}>
          <thead className="sticky top-0 z-10 bg-background">
            <tr>
              <th className={cn(excelTh, 'min-w-[130px] text-start')}>{isAr ? 'التاريخ' : 'Date'}</th>
              <th className={cn(excelTh, 'min-w-[140px] text-start')}>{isAr ? 'رقم الشحنة' : 'Shipment #'}</th>
              <th className={cn(excelTh, 'min-w-[110px] text-start')}>MSKU</th>
              <th className={cn(excelTh, 'min-w-[130px] text-start')}>{isAr ? 'SKU المحل' : 'Shop SKU'}</th>
              <th className={cn(excelTh, 'min-w-[130px] text-start')}>{isAr ? 'SKU FBA' : 'FBA SKU'}</th>
              <th className={cn(excelTh, 'min-w-[140px] text-start')}>{isAr ? 'المنتج' : 'Product'}</th>
              <th className={cn(excelTh, 'w-20 text-center')}>{isAr ? 'المطلوب' : 'Required'}</th>
              <th className={cn(excelTh, 'w-20 text-center')}>{isAr ? 'المحوّل' : 'Transferred'}</th>
              <th className={cn(excelTh, 'w-20 text-center')}>{isAr ? 'الفرق' : 'Diff'}</th>
              <th className={cn(excelTh, 'w-24 text-center')}>{isAr ? 'الحالة' : 'Status'}</th>
              {onEditRow ? (
                <th className={cn(excelTh, 'w-20 text-center')}>{isAr ? 'تعديل' : 'Edit'}</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row, i) => {
              const diff = row.required - row.actual;
              const summaryRow = row as TransferBatchSummaryRow;
              const txId = summaryRow.tx_id;
              return (
                <tr key={`${row.amazon_msku}-${i}`} className={excelTrEven}>
                  <td className={cn(excelTd, 'text-[10px] whitespace-nowrap')}>{summary.batchDateLabel}</td>
                  <td className={cn(excelTd, 'font-mono text-[10px] font-semibold')}>{summary.shipment_id}</td>
                  <td className={excelTd}>
                    <div className="font-mono text-[10px] font-semibold">{row.amazon_msku}</div>
                  </td>
                  <td className={excelTd}>
                    <SkuCell sku={row.source_sku} imageUrl={summaryRow.source_image_url} />
                  </td>
                  <td className={excelTd}>
                    <SkuCell sku={row.dest_sku} imageUrl={summaryRow.dest_image_url} />
                  </td>
                  <td className={cn(excelTd, 'max-w-[180px] truncate text-[10px]')} title={row.product_name}>
                    {row.product_name}
                  </td>
                  <td className={excelTdNum}>{row.required}</td>
                  <td className={cn(excelTdNum, row.actual > 0 ? 'font-semibold text-green-700' : '')}>{row.actual}</td>
                  <td
                    className={cn(
                      excelTdNum,
                      diff > 0 ? 'font-semibold text-amber-700' : diff < 0 ? 'font-semibold text-red-600' : '',
                    )}
                  >
                    {diff}
                  </td>
                  <td className={cn(excelTd, 'whitespace-nowrap text-center text-[10px]')}>
                    <span className="inline-flex items-center gap-1">
                      {statusIcon(row.status)}
                      {statusLabel(row.status, isAr)}
                    </span>
                  </td>
                  {onEditRow ? (
                    <td className={cn(excelTd, 'text-center')}>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 px-2 text-[10px]"
                        disabled={!txId}
                        onClick={() => txId && onEditRow(txId)}
                      >
                        <Pencil className="h-3 w-3" />
                        {isAr ? 'تعديل' : 'Edit'}
                      </Button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 bg-muted/95 font-semibold">
            <tr>
              <td colSpan={6} className={cn(excelTd, 'text-end text-xs')}>
                {isAr ? 'الإجمالي' : 'Total'}
              </td>
              <td className={excelTdNum}>{summary.totalRequired}</td>
              <td className={cn(excelTdNum, 'text-green-700')}>{summary.totalActual}</td>
              <td
                className={cn(
                  excelTdNum,
                  summary.totalDiff > 0 ? 'text-amber-700' : summary.totalDiff < 0 ? 'text-red-600' : '',
                )}
              >
                {summary.totalDiff}
              </td>
              <td className={excelTd} colSpan={onEditRow ? 2 : 1} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
