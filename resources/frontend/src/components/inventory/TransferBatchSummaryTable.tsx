import { useState } from 'react';
import { CheckCircle2, AlertCircle, MinusCircle, Pencil, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn, getProductImageSrc } from '@/lib/utils';
import type { FbaTransferSummaryRow } from '@/components/inventory/FbaTransferSummaryTable';
import type { TransferBatchSummary, TransferBatchSummaryRow } from '@/lib/transferBatchPreview';

const excelTable = 'w-full border-collapse border border-border text-[11px] leading-tight';
const excelTh = 'border border-border bg-muted/90 px-2 py-1.5 font-semibold whitespace-nowrap';
const excelTd = 'border border-border px-2 py-1.5 align-middle';
const excelTdNum = 'border border-border px-2 py-1.5 text-center font-mono tabular-nums';
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

function ProductSideCell({
  sku,
  name,
  imageUrl,
  sideLabel,
}: {
  sku: string;
  name: string;
  imageUrl?: string | null;
  sideLabel: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = Boolean(imageUrl) && !imgFailed;

  return (
    <div className="flex min-w-0 items-start gap-2">
      {showImg ? (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/30">
          <img
            src={getProductImageSrc(imageUrl)}
            alt=""
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
          />
        </div>
      ) : null}
      <div className="min-w-0 space-y-0.5">
        <div className="text-[9px] font-medium text-muted-foreground leading-none">{sideLabel}</div>
        <div className="truncate font-mono text-[11px] font-bold" title={sku}>
          {sku || '—'}
        </div>
        <div className="line-clamp-3 text-[10px] leading-snug text-foreground/90" title={name}>
          {name || '—'}
        </div>
      </div>
    </div>
  );
}

export function TransferBatchSummaryTable({ summary, isAr, className, onEditRow }: Props) {
  const [copied, setCopied] = useState(false);
  const shipmentId = String(summary.shipment_id || '').trim();
  const canCopy = Boolean(shipmentId && shipmentId !== '—');

  const handleCopyShipment = async () => {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(shipmentId);
      setCopied(true);
      toast.success(isAr ? 'تم نسخ رقم الشحنة' : 'Shipment number copied');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(isAr ? 'تعذر النسخ' : 'Copy failed');
    }
  };

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">{isAr ? 'رقم الشحنة:' : 'Shipment #:'}</span>
          <span className="font-mono text-sm font-bold">{shipmentId || '—'}</span>
          {canCopy ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-[10px]"
              onClick={handleCopyShipment}
            >
              {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
              {isAr ? 'نسخ' : 'Copy'}
            </Button>
          ) : null}
        </div>
        <div>
          <span className="text-muted-foreground">{isAr ? 'التاريخ:' : 'Date:'}</span>{' '}
          <span className="font-semibold">{summary.batchDateLabel}</span>
        </div>
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
              <th className={cn(excelTh, 'min-w-[220px] text-start')}>
                {isAr ? 'محوّل منه (المحل)' : 'From (Shop)'}
              </th>
              <th className={cn(excelTh, 'min-w-[220px] text-start')}>
                {isAr ? 'محوّل إليه (FBA)' : 'To (FBA)'}
              </th>
              <th className={cn(excelTh, 'w-20 text-center')}>{isAr ? 'كمية الشيت' : 'Sheet qty'}</th>
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
              const sourceName = summaryRow.source_product_name || row.product_name || '—';
              const destName = summaryRow.dest_product_name || '—';
              const sourceImage = summaryRow.source_image_url || null;
              const destImage = summaryRow.dest_image_url || null;
              const destSku =
                row.dest_sku && row.dest_sku !== '—'
                  ? row.dest_sku
                  : row.amazon_msku && row.amazon_msku !== row.source_sku
                    ? row.amazon_msku
                    : '—';

              return (
                <tr key={`${row.source_sku}-${destSku}-${i}`} className={excelTrEven}>
                  <td className={excelTd}>
                    <ProductSideCell
                      sku={row.source_sku}
                      name={sourceName}
                      imageUrl={sourceImage}
                      sideLabel={isAr ? 'SKU المحل' : 'Shop SKU'}
                    />
                  </td>
                  <td className={excelTd}>
                    <ProductSideCell
                      sku={destSku}
                      name={destName}
                      imageUrl={destImage}
                      sideLabel={isAr ? 'SKU FBA' : 'FBA SKU'}
                    />
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
              <td colSpan={2} className={cn(excelTd, 'text-end text-xs')}>
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
