import { useMemo, useState } from 'react';
import { Copy, Check, Printer, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn, formatDate, getProductImageSrc } from '@/lib/utils';
import {
  bestReturnDate,
  formatReturnReasonLabel,
  isCustomerDidNotReceive,
  isFbaNotPhysicallyReturned,
  isMerchantReturn,
  orderNumberForCopy,
  type ReturnRowLike,
} from '@/components/returns/returnDisplayUtils';
import { rowReimbursementCategory } from '@/components/returns/returnReimbursementUtils';
import { ReimbursementBadge } from '@/components/returns/ReimbursementBadge';

export type RemovalShortfallRow = {
  id?: number | string;
  sku_code?: string | null;
  fnsku?: string | null;
  disposition?: string | null;
  product_image_url?: string | null;
  product_name?: string | null;
  expected_quantity?: number | null;
  received_quantity?: number | null;
  shortfall_quantity?: number | null;
  shipped_quantity?: number | null;
  requested_quantity?: number | null;
  received_at?: string | null;
  removal_order?: { removal_order_id?: string | null } | null;
  removalOrder?: { removal_order_id?: string | null } | null;
};

type Props = {
  returns: ReturnRowLike[];
  removalShortfalls?: RemovalShortfallRow[];
  shortfallsLoading?: boolean;
  isAr: boolean;
  t: (key: string) => string;
};

function ProductThumb({ src, alt }: { src?: string | null; alt?: string }) {
  const imgSrc = getProductImageSrc(src || '');
  return (
    <div className="w-8 h-8 rounded border border-border bg-muted/30 flex items-center justify-center overflow-hidden shrink-0">
      {imgSrc ? (
        <img src={imgSrc} alt={alt || ''} className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <span className="text-[9px] text-muted-foreground">—</span>
      )}
    </div>
  );
}

function CopyOrderButton({ orderNumber, isAr }: { orderNumber: string; isAr: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!orderNumber) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(orderNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 text-[10px] gap-1"
      onClick={(e) => {
        e.stopPropagation();
        void handleCopy();
      }}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied
        ? isAr
          ? 'تم النسخ'
          : 'Copied'
        : isAr
          ? 'نسخ رقم الطلب'
          : 'Copy order #'}
    </Button>
  );
}

function removalOrderId(row: RemovalShortfallRow): string {
  return String(row.removal_order?.removal_order_id || row.removalOrder?.removal_order_id || '').trim();
}

function printRemovalShortfallClaimSheet(rows: RemovalShortfallRow[], isAr: boolean) {
  const title = isAr ? 'مطالبة نقص استلام إزالة أمازون' : 'Amazon removal shortfall claim';
  const headers = isAr
    ? ['رقم الإزالة', 'SKU', 'FNSKU', 'متوقع', 'مستلم', 'ناقص', 'Disposition']
    : ['Removal #', 'SKU', 'FNSKU', 'Expected', 'Received', 'Shortfall', 'Disposition'];

  const bodyRows = rows
    .map((r) => {
      const cells = [
        removalOrderId(r) || '—',
        r.sku_code || '—',
        r.fnsku || '—',
        String(r.expected_quantity ?? '—'),
        String(r.received_quantity ?? '—'),
        String(r.shortfall_quantity ?? '—'),
        r.disposition || '—',
      ];
      return `<tr>${cells.map((c) => `<td style="border:1px solid #ccc;padding:6px;font-size:12px;">${String(c).replace(/</g, '&lt;')}</td>`).join('')}</tr>`;
    })
    .join('');

  const html = `<!DOCTYPE html><html lang="${isAr ? 'ar' : 'en'}" dir="${isAr ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"/><title>${title}</title>
    <style>body{font-family:system-ui,sans-serif;padding:24px}h1{font-size:18px;margin-bottom:8px}p{color:#555;font-size:12px}table{border-collapse:collapse;width:100%;margin-top:16px}th{border:1px solid #ccc;padding:6px;background:#f5f5f5;font-size:11px}</style>
    </head><body><h1>${title}</h1><p>${isAr ? 'للاستخدام في رفع مطالبة تعويض PDF' : 'For Amazon reimbursement / claim PDF upload'}</p>
    <table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${bodyRows}</tbody></table>
    </body></html>`;

  const win = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

export function AmazonClaimsHub({
  returns,
  removalShortfalls = [],
  shortfallsLoading = false,
  isAr,
  t,
}: Props) {
  const [fbaReadyOnly, setFbaReadyOnly] = useState(true);

  const buckets = useMemo(() => {
    const fba = returns.filter((r) => isFbaNotPhysicallyReturned(r));
    const merchant = returns.filter((r) => isMerchantReturn(r));
    const dnr = returns.filter((r) => isCustomerDidNotReceive(r));
    return { fba, merchant, dnr };
  }, [returns]);

  const fbaRows = useMemo(() => {
    if (!fbaReadyOnly) {
      return buckets.fba;
    }
    return buckets.fba.filter((r) => rowReimbursementCategory(r as Record<string, unknown>) === 'ready');
  }, [buckets.fba, fbaReadyOnly]);

  const shortfallRows = useMemo(
    () =>
      (removalShortfalls || []).filter((r) => Number(r.shortfall_quantity ?? 0) > 0),
    [removalShortfalls],
  );

  const renderTable = (rows: ReturnRowLike[], showCopy = false) => (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full min-w-[880px] text-sm">
        <thead>
          <tr className="text-left text-muted-foreground border-b border-border text-[11px] uppercase tracking-wide">
            <th className="py-2 pr-3 w-12">{t('returns.table.image') || (isAr ? 'صورة' : 'Image')}</th>
            <th className="py-2 pr-3">{t('returns.claimsHub.orderNumber') || (isAr ? 'رقم الطلب' : 'Order #')}</th>
            <th className="py-2 pr-3">{t('returns.table.sku') || 'SKU'}</th>
            <th className="py-2 pr-3">{t('returns.table.reason') || (isAr ? 'سبب الإرجاع' : 'Reason')}</th>
            <th className="py-2 pr-3">{t('returns.table.date') || (isAr ? 'التاريخ' : 'Date')}</th>
            <th className="py-2 pr-3">{t('returns.table.quantity') || (isAr ? 'الكمية' : 'Qty')}</th>
            <th className="py-2 pr-3">{t('returns.table.reimbursement') || 'Reimbursement'}</th>
            {showCopy ? (
              <th className="py-2 pr-3 text-right">{t('returns.claimsHub.copy') || (isAr ? 'نسخ' : 'Copy')}</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={showCopy ? 8 : 7} className="py-6 text-center text-muted-foreground text-sm">
                {t('returns.claimsHub.empty') || (isAr ? 'لا توجد حالات في هذا التبويب' : 'No rows in this tab')}
              </td>
            </tr>
          ) : (
            rows.slice(0, 100).map((r) => {
              const orderNum = orderNumberForCopy(r);
              return (
                <tr key={String(r.id ?? orderNum)} className="border-b border-border/60 hover:bg-muted/20">
                  <td className="py-2 pr-3">
                    <ProductThumb src={r.product_image_url} alt={r.product_name || r.sku_code || ''} />
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{orderNum || '—'}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.sku_code || '—'}</td>
                  <td className="py-2 pr-3 text-xs max-w-[200px] truncate" title={r.reason || undefined}>
                    {formatReturnReasonLabel(r.reason, isAr)}
                  </td>
                  <td className="py-2 pr-3 text-xs whitespace-nowrap">{formatDate(bestReturnDate(r) || undefined)}</td>
                  <td className="py-2 pr-3 text-xs text-center">{r.return_quantity ?? 1}</td>
                  <td className="py-2 pr-3">
                    <ReimbursementBadge rows={[r as Record<string, unknown>]} isAr={isAr} t={t} mode="row" />
                  </td>
                  {showCopy ? (
                    <td className="py-2 pr-3 text-right">
                      <CopyOrderButton orderNumber={orderNum} isAr={isAr} />
                    </td>
                  ) : null}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <Card className="bg-card border-border border-emerald-500/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg text-foreground">
          {t('returns.claimsHub.title') || (isAr ? 'يلا نجيب فلوس من أمازون' : 'Amazon claims hub')}
        </CardTitle>
        <CardDescription>
          {t('returns.claimsHub.subtitle') ||
            (isAr
              ? 'أو التعويض SAFE-T والتاجر وعدم الاستلام — ونقص استلام الإزالة للمطالبة'
              : 'FBA, merchant, non-receipt, and removal shortfalls — copy / print for claims')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="shortfall">
          <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
            <TabsTrigger value="shortfall" className="text-xs sm:text-sm">
              {t('returns.claimsHub.tabShortfall') || (isAr ? 'نقص استلام الإزالة' : 'Removal shortfall')}
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                ({shortfallRows.length})
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="fba" className="text-xs sm:text-sm">
              {t('returns.claimsHub.tabFba') || (isAr ? 'FBA لم تُرجع' : 'FBA not returned')}
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                ({fbaRows.length})
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="merchant" className="text-xs sm:text-sm">
              {t('returns.claimsHub.tabMerchant') || (isAr ? 'مرتجعات التاجر' : 'Merchant returns')}
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                ({buckets.merchant.length})
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="dnr" className="text-xs sm:text-sm">
              {t('returns.claimsHub.tabDnr') || (isAr ? 'عدم استلام العميل' : 'Customer did not receive')}
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                ({buckets.dnr.length})
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="shortfall" className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground max-w-xl">
                {t('returns.claimsHub.shortfallHint') ||
                  (isAr
                    ? 'الفرق بين المتوقع في شيت الإزالة والكمية اللي استلمتها فعلياً — اطبعه لرفع مطالبة تعويض'
                    : 'Difference between sheet expected qty and what you actually received — print for reimbursement')}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={shortfallRows.length === 0}
                onClick={() => printRemovalShortfallClaimSheet(shortfallRows, isAr)}
              >
                <Printer className="w-3.5 h-3.5" />
                {t('returns.claimsHub.printShortfall') || (isAr ? 'طباعة للمطالبة' : 'Print for claim')}
              </Button>
            </div>
            <div className="overflow-x-auto -mx-1">
              <table className="w-full min-w-[960px] text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border text-[11px] uppercase tracking-wide">
                    <th className="py-2 pr-3 w-12">{t('returns.table.image') || (isAr ? 'صورة' : 'Image')}</th>
                    <th className="py-2 pr-3">{t('returns.claimsHub.removalOrder') || (isAr ? 'رقم الإزالة' : 'Removal #')}</th>
                    <th className="py-2 pr-3">SKU</th>
                    <th className="py-2 pr-3">{t('returns.claimsHub.expected') || (isAr ? 'متوقع' : 'Expected')}</th>
                    <th className="py-2 pr-3">{t('returns.claimsHub.received') || (isAr ? 'مستلم' : 'Received')}</th>
                    <th className="py-2 pr-3">{t('returns.claimsHub.shortfall') || (isAr ? 'ناقص' : 'Shortfall')}</th>
                    <th className="py-2 pr-3">{t('returns.table.date') || (isAr ? 'التاريخ' : 'Date')}</th>
                    <th className="py-2 pr-3 text-right">{t('returns.claimsHub.copy') || (isAr ? 'نسخ' : 'Copy')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shortfallsLoading ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-muted-foreground">
                        <Loader2 className="w-5 h-5 animate-spin inline-block" />
                      </td>
                    </tr>
                  ) : shortfallRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-muted-foreground text-sm">
                        {t('returns.claimsHub.emptyShortfall') ||
                          (isAr ? 'لا يوجد نقص استلام إزالة بعد' : 'No removal shortfalls yet')}
                      </td>
                    </tr>
                  ) : (
                    shortfallRows.slice(0, 200).map((r) => {
                      const oid = removalOrderId(r);
                      return (
                        <tr key={String(r.id ?? oid)} className="border-b border-border/60 hover:bg-muted/20">
                          <td className="py-2 pr-3">
                            <ProductThumb src={r.product_image_url} alt={r.product_name || r.sku_code || ''} />
                          </td>
                          <td className="py-2 pr-3 font-mono text-xs">{oid || '—'}</td>
                          <td className="py-2 pr-3 font-mono text-xs">{r.sku_code || '—'}</td>
                          <td className="py-2 pr-3 text-xs text-center font-mono">{r.expected_quantity ?? '—'}</td>
                          <td className="py-2 pr-3 text-xs text-center font-mono">{r.received_quantity ?? '—'}</td>
                          <td className="py-2 pr-3 text-xs text-center font-mono font-semibold text-amber-700 dark:text-amber-300">
                            {r.shortfall_quantity ?? '—'}
                          </td>
                          <td className="py-2 pr-3 text-xs whitespace-nowrap">
                            {formatDate(r.received_at || undefined)}
                          </td>
                          <td className="py-2 pr-3 text-right">
                            <CopyOrderButton orderNumber={oid} isAr={isAr} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="fba" className="mt-4 space-y-3">
            <button
              type="button"
              className={cn(
                'text-xs rounded-md border px-2 py-1 transition-colors',
                fbaReadyOnly
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-border text-muted-foreground',
              )}
              onClick={() => setFbaReadyOnly((v) => !v)}
            >
              {fbaReadyOnly
                ? t('returns.claimsHub.fbaReadyOnly') || (isAr ? 'جاهز للمطالبة فقط' : 'Ready to claim only')
                : t('returns.claimsHub.fbaAll') || (isAr ? 'عرض الكل' : 'Show all')}
            </button>
            {renderTable(fbaRows)}
          </TabsContent>

          <TabsContent value="merchant" className="mt-4">
            {renderTable(buckets.merchant)}
          </TabsContent>

          <TabsContent value="dnr" className="mt-4">
            {renderTable(buckets.dnr, true)}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
