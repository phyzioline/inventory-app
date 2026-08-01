import { cn } from '@/lib/utils';
import { CheckCircle2, AlertCircle, MinusCircle } from 'lucide-react';

export type FbaTransferSummaryRow = {
  amazon_msku: string;
  asin?: string;
  source_sku: string;
  dest_sku: string;
  product_name: string;
  required: number;
  actual: number;
  status: 'transferred' | 'skipped' | 'unlinked';
};

export type FbaTransferSummary = {
  shipment_id: string;
  shipment_name?: string;
  ship_to_fc?: string;
  rows: FbaTransferSummaryRow[];
  totalRequired: number;
  totalActual: number;
  totalDiff: number;
};

const excelTable = 'w-full border-collapse border border-border text-[11px] leading-tight';
const excelTh = 'border border-border bg-muted/90 px-2 py-1.5 font-semibold whitespace-nowrap';
const excelTd = 'border border-border px-2 py-1 align-middle';
const excelTdNum = 'border border-border px-2 py-1 text-center font-mono tabular-nums';
const excelTrEven = 'even:bg-muted/20';

type Props = {
  summary: FbaTransferSummary;
  isAr: boolean;
  className?: string;
};

function statusLabel(status: FbaTransferSummaryRow['status'], isAr: boolean): string {
  if (status === 'transferred') return isAr ? 'تم التحويل' : 'Transferred';
  if (status === 'skipped') return isAr ? 'تخطي (0)' : 'Skipped (0)';
  return isAr ? 'غير مربوط' : 'Not linked';
}

function statusIcon(status: FbaTransferSummaryRow['status']) {
  if (status === 'transferred') return <CheckCircle2 className="h-3.5 w-3.5 text-green-600 inline-block" />;
  if (status === 'skipped') return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground inline-block" />;
  return <AlertCircle className="h-3.5 w-3.5 text-red-600 inline-block" />;
}

export function buildFbaTransferSummary(
  matched: Array<{
    amazon_msku: string;
    asin: string;
    quantity: number;
    file_quantity?: number;
    system_sku: string;
    dest_sku_code?: string | null;
    product_name: string;
  }>,
  unmatched: Array<{ amazon_msku: string; asin: string; quantity: number }>,
  shipment: { shipment_id?: string; shipment_name?: string; ship_to_fc?: string } | null
): FbaTransferSummary {
  const rows: FbaTransferSummaryRow[] = [];

  for (const row of matched) {
    const required = row.file_quantity ?? row.quantity;
    const actual = row.quantity > 0 ? row.quantity : 0;
    rows.push({
      amazon_msku: row.amazon_msku,
      asin: row.asin,
      source_sku: row.system_sku,
      dest_sku: row.dest_sku_code || '—',
      product_name: row.product_name,
      required,
      actual,
      status: actual > 0 ? 'transferred' : 'skipped',
    });
  }

  for (const row of unmatched) {
    rows.push({
      amazon_msku: row.amazon_msku,
      asin: row.asin,
      source_sku: '—',
      dest_sku: row.amazon_msku,
      product_name: '—',
      required: row.quantity,
      actual: 0,
      status: 'unlinked',
    });
  }

  const totalRequired = rows.reduce((s, r) => s + r.required, 0);
  const totalActual = rows.reduce((s, r) => s + r.actual, 0);

  return {
    shipment_id: shipment?.shipment_id || '—',
    shipment_name: shipment?.shipment_name,
    ship_to_fc: shipment?.ship_to_fc,
    rows,
    totalRequired,
    totalActual,
    totalDiff: totalRequired - totalActual,
  };
}

export function FbaTransferSummaryTable({ summary, isAr, className }: Props) {
  return (
    <div className={cn('flex flex-col min-h-0', className)}>
      <div className="shrink-0 mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {summary.shipment_id && (
          <div>
            <span className="text-muted-foreground">{isAr ? 'الشحنة:' : 'Shipment:'}</span>{' '}
            <span className="font-mono font-semibold">{summary.shipment_id}</span>
          </div>
        )}
        {summary.ship_to_fc && (
          <div>
            <span className="text-muted-foreground">FC:</span>{' '}
            <span className="font-mono">{summary.ship_to_fc}</span>
          </div>
        )}
        <div>
          <span className="text-muted-foreground">{isAr ? 'صفوف:' : 'Rows:'}</span>{' '}
          <strong>{summary.rows.length}</strong>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto border rounded-md">
        <table className={excelTable}>
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={cn(excelTh, 'text-start min-w-[120px]')}>MSKU</th>
              <th className={cn(excelTh, 'text-start min-w-[100px]')}>{isAr ? 'SKU المحل' : 'Shop SKU'}</th>
              <th className={cn(excelTh, 'text-start min-w-[100px]')}>{isAr ? 'SKU FBA' : 'FBA SKU'}</th>
              <th className={cn(excelTh, 'text-start min-w-[140px]')}>{isAr ? 'المنتج' : 'Product'}</th>
              <th className={cn(excelTh, 'text-center w-20')}>{isAr ? 'كمية الشيت' : 'Sheet qty'}</th>
              <th className={cn(excelTh, 'text-center w-20')}>{isAr ? 'المحوّل' : 'Transferred'}</th>
              <th className={cn(excelTh, 'text-center w-20')}>{isAr ? 'الفرق' : 'Diff'}</th>
              <th className={cn(excelTh, 'text-center w-24')}>{isAr ? 'الحالة' : 'Status'}</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row, i) => {
              const diff = row.required - row.actual;
              return (
                <tr key={`${row.amazon_msku}-${i}`} className={excelTrEven}>
                  <td className={excelTd}>
                    <div className="font-mono font-semibold text-[10px]">{row.amazon_msku}</div>
                    {row.asin ? <div className="text-[9px] text-muted-foreground font-mono">{row.asin}</div> : null}
                  </td>
                  <td className={cn(excelTd, 'font-mono text-[10px]')}>{row.source_sku}</td>
                  <td className={cn(excelTd, 'font-mono text-[10px]')}>{row.dest_sku}</td>
                  <td className={cn(excelTd, 'text-[10px] max-w-[160px] truncate')} title={row.product_name}>
                    {row.product_name}
                  </td>
                  <td className={excelTdNum}>{row.required}</td>
                  <td className={cn(excelTdNum, row.actual > 0 ? 'text-green-700 font-semibold' : '')}>
                    {row.actual}
                  </td>
                  <td
                    className={cn(
                      excelTdNum,
                      diff > 0 ? 'text-amber-700 font-semibold' : diff < 0 ? 'text-red-600 font-semibold' : ''
                    )}
                  >
                    {diff}
                  </td>
                  <td className={cn(excelTd, 'text-center text-[10px] whitespace-nowrap')}>
                    <span className="inline-flex items-center gap-1">
                      {statusIcon(row.status)}
                      {statusLabel(row.status, isAr)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 bg-muted/95 font-semibold">
            <tr>
              <td colSpan={4} className={cn(excelTd, 'text-end text-xs')}>
                {isAr ? 'الإجمالي' : 'Total'}
              </td>
              <td className={excelTdNum}>{summary.totalRequired}</td>
              <td className={cn(excelTdNum, 'text-green-700')}>{summary.totalActual}</td>
              <td
                className={cn(
                  excelTdNum,
                  summary.totalDiff > 0 ? 'text-amber-700' : summary.totalDiff < 0 ? 'text-red-600' : ''
                )}
              >
                {summary.totalDiff}
              </td>
              <td className={excelTd} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
