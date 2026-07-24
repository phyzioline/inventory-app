import { useMemo, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn, getProductImageSrc } from '@/lib/utils';
import {
  formatReturnReasonLabel,
  isCustomerDidNotReceive,
  isFbaNotPhysicallyReturned,
  isMerchantReturn,
  orderNumberForCopy,
  type ReturnRowLike,
} from '@/components/returns/returnDisplayUtils';
import { rowReimbursementCategory } from '@/components/returns/returnReimbursementUtils';
import { ReimbursementBadge } from '@/components/returns/ReimbursementBadge';

type Props = {
  returns: ReturnRowLike[];
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

export function AmazonClaimsHub({ returns, isAr, t }: Props) {
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

  const renderTable = (rows: ReturnRowLike[], showCopy = false) => (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="text-left text-muted-foreground border-b border-border text-[11px] uppercase tracking-wide">
            <th className="py-2 pr-3 w-12">{t('returns.table.image') || (isAr ? 'صورة' : 'Image')}</th>
            <th className="py-2 pr-3">{t('returns.claimsHub.orderNumber') || (isAr ? 'رقم الطلب' : 'Order #')}</th>
            <th className="py-2 pr-3">{t('returns.table.sku') || 'SKU'}</th>
            <th className="py-2 pr-3">{t('returns.table.reason') || (isAr ? 'سبب الإرجاع' : 'Reason')}</th>
            <th className="py-2 pr-3">{t('returns.table.reimbursement') || 'Reimbursement'}</th>
            {showCopy ? (
              <th className="py-2 pr-3 text-right">{t('returns.claimsHub.copy') || (isAr ? 'نسخ' : 'Copy')}</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={showCopy ? 6 : 5} className="py-6 text-center text-muted-foreground text-sm">
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
              ? 'مرتجعات FBA والتاجر وعدم الاستلام — انسخ رقم الطلب لمطالبة SAFE-T أو التعويض'
              : 'FBA, merchant, and non-receipt returns — copy order numbers for SAFE-T or reimbursement claims')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="fba">
          <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
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
