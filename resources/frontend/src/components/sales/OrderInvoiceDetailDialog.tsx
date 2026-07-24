import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Check, ChevronsUpDown, Loader2, Pencil, Plus, Printer, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWarehouses } from '@/hooks/useWarehouses';
import api from '@/lib/api';
import { getDefaultPrintBranding, printSalesInvoiceProfessional } from '@/lib/printUtils';
import { cn, formatLatinNumber } from '@/lib/utils';

const excelTable = 'w-full border-collapse border border-border text-[11px] leading-tight';
const excelTh = 'border border-border bg-muted/90 px-2 py-1.5 text-start font-semibold whitespace-nowrap';
const excelTd = 'border border-border px-2 py-1 align-top';
const excelTdNum = 'border border-border px-2 py-1 text-end font-mono tabular-nums';
const excelTrEven = 'even:bg-muted/25';

function parseSettlementMoney(value: unknown): number {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let s = String(value).trim();
  s = s.replace(/^EGP\s*/i, '').replace(/ /g, ' ').replace(/\s/g, '').replace(/,/g, '');
  let neg = false;
  if (s.endsWith('-')) {
    neg = true;
    s = s.slice(0, -1);
  } else if (s.startsWith('(') && s.endsWith(')')) {
    neg = true;
    s = s.slice(1, -1);
  } else if (s.startsWith('-')) {
    neg = true;
    s = s.slice(1);
  }
  if (s.startsWith('+')) s = s.slice(1);
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return neg ? -Math.abs(n) : n;
}

function orderReference(order: any): string {
  return String(
    order?.platform_order_id ||
      order?.order_number ||
      order?.external_order_number ||
      (order?.id != null ? `#${order.id}` : '')
  ).trim();
}

type Props = {
  order: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startEditing?: boolean;
};

export function OrderInvoiceDetailDialog({ order, open, onOpenChange, startEditing }: Props) {
  const { t, language } = useLanguage();
  const isAr = language === 'ar';
  const queryClient = useQueryClient();
  const { data: warehouses } = useWarehouses();

  const [localOrder, setLocalOrder] = useState<any | null>(order);
  const [originalOrder, setOriginalOrder] = useState<any | null>(order);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [productSearchByRow, setProductSearchByRow] = useState<Record<number, string>>({});
  const [rowPickerOpen, setRowPickerOpen] = useState<Record<number, boolean>>({});

  useEffect(() => {
    setLocalOrder(order);
    setOriginalOrder(order);
    setIsSaving(false);
    setProductSearchByRow({});
    setRowPickerOpen({});
    if (startEditing && order && canEditOrder(order)) {
      setIsEditing(true);
    } else {
      setIsEditing(false);
    }
  }, [order?.id, open, startEditing]);

  const ref = localOrder ? orderReference(localOrder) : '';

  const { data: orderTransactionsData, isLoading: isOrderTransactionsLoading, isError: isOrderTxError, isFetched: isOrderTxFetched, error: orderTxError, refetch: refetchOrderTx } = useQuery({
    queryKey: ['sales-order-transactions', ref, order?.id],
    queryFn: () =>
      api.get('settlements/order-transactions', {
        params: {
          order_id: ref,
          ...(order?.id != null ? { inventory_order_id: order.id } : {}),
        },
      }),
    enabled: open && !!localOrder && ref.length > 0,
    staleTime: 0,
  });

  const { data: masterProductsForPicker = [] } = useQuery({
    queryKey: ['sales-invoice-edit-products'],
    queryFn: () => api.getArray('master-products?with_skus=1&limit=300'),
    enabled: isEditing,
    staleTime: 60_000,
  });

  const toNumber = (value: unknown) => {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  };

  const settlementItems = useMemo(() => {
    if (isOrderTxError) {
      const embedded = localOrder?.settlement_items ?? localOrder?.settlementItems;
      return Array.isArray(embedded) ? embedded : [];
    }
    if (isOrderTxFetched && orderTransactionsData && Array.isArray(orderTransactionsData.items)) {
      return orderTransactionsData.items;
    }
    return [];
  }, [isOrderTxError, isOrderTxFetched, orderTransactionsData, localOrder]);

  const hasGranularAmazonLines = useMemo(
    () =>
      settlementItems.some((tx: any) => {
        const d = String(tx?.description ?? '');
        return (
          d.includes('ItemPrice:') ||
          d.includes('ItemFee:') ||
          d.includes('Promotion:') ||
          d.includes('RefundPrice:') ||
          d.includes('RefundFee:')
        );
      }),
    [settlementItems]
  );

  const showSettlementRollupHint =
    !isOrderTxError &&
    isOrderTxFetched &&
    settlementItems.length > 0 &&
    !hasGranularAmazonLines &&
    Boolean(localOrder?.platform_order_id);

  const orderTxErrorText = useMemo(() => {
    if (!isOrderTxError || !orderTxError) return '';
    if (isAxiosError(orderTxError)) {
      const st = orderTxError.response?.status;
      const msg = orderTxError.response?.data && typeof orderTxError.response.data === 'object' && 'message' in orderTxError.response.data
        ? String((orderTxError.response.data as { message?: unknown }).message || '')
        : '';
      return [st ? `HTTP ${st}` : '', msg || orderTxError.message].filter(Boolean).join(' — ');
    }
    return String(orderTxError);
  }, [isOrderTxError, orderTxError]);

  const invoiceLinesSubtotal = useMemo(() => {
    if (!localOrder?.items?.length) return toNumber(localOrder?.total_amount);
    return (localOrder.items as any[]).reduce((sum, it) => {
      const line = toNumber(it.total_price);
      if (line !== 0) return sum + line;
      return sum + toNumber(it.quantity) * toNumber(it.unit_price);
    }, 0);
  }, [localOrder]);

  const settlementNetTotal = useMemo(() => {
    return settlementItems.reduce(
      (sum: number, tx: any) => sum + parseSettlementMoney(tx.amount),
      0
    );
  }, [settlementItems]);

  const formatDisplayDate = (value: unknown) => {
    const d = new Date(value as string);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(isAr ? 'ar-EG' : undefined);
  };

  const paymentLine = useMemo(() => {
    if (!localOrder) return '';
    const type = String(localOrder.payment_type || localOrder.financial_status || '—').toUpperCase();
    const paid = toNumber(localOrder.paid_amount);
    return `${type} | ${t('sales.dialog.paid')} ${formatLatinNumber(paid)} EGP`;
  }, [localOrder, t]);

  const title = localOrder ? localOrder.order_number || localOrder.platform_order_id || `#${localOrder.id}` : '';

  const canEditOrder = (o: any) => {
    const st = String(o?.status || '').toLowerCase();
    return ['pending', 'processing', 'shipped', 'sold', 'delivered', 'return_in_progress', 'returned'].includes(st);
  };

  const setLocalOrderField = (patch: Record<string, any>) => {
    setLocalOrder((prev: any) => (prev ? { ...prev, ...patch } : prev));
  };

  const setLocalOrderItem = (idx: number, patch: Record<string, any>) => {
    setLocalOrder((prev: any) => {
      if (!prev) return prev;
      const items = Array.isArray(prev.items) ? [...prev.items] : [];
      if (idx < 0 || idx >= items.length) return prev;
      items[idx] = { ...items[idx], ...patch };
      return { ...prev, items };
    });
  };

  const addNewItem = () => {
    setLocalOrder((prev: any) => {
      if (!prev) return prev;
      const items = Array.isArray(prev.items) ? [...prev.items] : [];
      return { ...prev, items: [...items, { _new: true, product_name: '', sku_code: '', quantity: 1, unit_price: 0 }] };
    });
  };

  const removeItem = (idx: number) => {
    setLocalOrder((prev: any) => {
      if (!prev) return prev;
      const items = Array.isArray(prev.items) ? [...prev.items] : [];
      return { ...prev, items: items.filter((_, i) => i !== idx) };
    });
  };

  const getPickerItems = (query: string) => {
    const q = query.trim().toLowerCase();
    const results: Array<{ id: string; label: string; sub: string; sku_id: string | null; sku_code: string; product_name: string }> = [];
    for (const p of masterProductsForPicker as any[]) {
      const pName = String(p?.internal_name || p?.name || '').trim();
      const pId = String(p?.id ?? '');
      const pSkus: any[] = p?.offers?.flatMap((o: any) => o?.skus || []) ?? p?.skus ?? [];
      if (pSkus.length > 0) {
        for (const s of pSkus) {
          const skuCode = String(s?.sku || s?.sku_code || '').trim();
          const label = pName && skuCode && skuCode.toLowerCase() !== pName.toLowerCase() ? `${pName} — ${skuCode}` : (skuCode || pName);
          if (!q || label.toLowerCase().includes(q) || skuCode.toLowerCase().includes(q) || pName.toLowerCase().includes(q)) {
            results.push({ id: `sku-${s.id}`, label, sub: skuCode, sku_id: String(s.id), sku_code: skuCode, product_name: pName });
            if (results.length >= 60) return results;
          }
        }
      } else if (!q || pName.toLowerCase().includes(q)) {
        results.push({ id: `p-${pId}`, label: pName, sub: '', sku_id: null, sku_code: '', product_name: pName });
        if (results.length >= 60) return results;
      }
    }
    return results;
  };

  const computeTotalsFromItems = (o: any) => {
    const items = Array.isArray(o?.items) ? o.items : [];
    const subtotal = items.reduce((sum: number, it: any) => {
      const q = toNumber(it?.quantity);
      const u = toNumber(it?.unit_price);
      return sum + q * u;
    }, 0);
    const tax = Math.max(0, toNumber(o?.tax_amount));
    const discountRaw = Math.max(0, toNumber(o?.discount_amount));
    const discount = Math.min(discountRaw, Math.max(0, subtotal));
    const total = Math.max(0, subtotal - discount + tax);
    const paid = Math.max(0, Math.min(toNumber(o?.paid_amount), total));
    const remaining = Math.max(0, total - paid);
    return { total, paid, remaining, subtotal, discount, tax };
  };

  const liveComputedTotals = useMemo(() => computeTotalsFromItems(localOrder), [localOrder]);

  const handleToggleEdit = () => {
    if (!localOrder) return;
    if (isEditing) {
      setLocalOrder(originalOrder);
      setIsEditing(false);
      setProductSearchByRow({});
      setRowPickerOpen({});
      return;
    }
    if (!canEditOrder(localOrder)) {
      toast.error(isAr ? 'لا يمكن تعديل هذه الفاتورة في حالتها الحالية.' : 'This invoice is locked for editing in its current status.');
      return;
    }
    setOriginalOrder(localOrder);
    setIsEditing(true);
  };

  const handleSaveEdits = async () => {
    if (!localOrder?.id) return;
    if (!canEditOrder(localOrder)) {
      toast.error(isAr ? 'لا يمكن حفظ التعديلات — الحالة مقفولة.' : 'Cannot save changes — status is locked.');
      return;
    }
    const hasEmptyItem = (localOrder.items || []).some(
      (it: any) => !it.product_name && !it._sku_id && !it.product_id && !it.sku_id
    );
    if (hasEmptyItem) {
      toast.error(isAr ? 'يوجد بند فارغ — اختر منتجًا أو احذفه.' : 'There is an empty item — pick a product or remove it.');
      return;
    }
    setIsSaving(true);
    try {
      const { total, paid, remaining, discount, tax } = computeTotalsFromItems(localOrder);
      setLocalOrderField({ total_amount: total, paid_amount: paid, remaining_amount: remaining, discount_amount: discount, tax_amount: tax });
      const payload = {
        customer_name: localOrder.customer_name ?? null,
        payment_type: localOrder.payment_type ?? null,
        tax_amount: tax,
        discount_amount: discount,
        paid_amount: paid,
        remaining_amount: remaining,
        total_amount: total,
        items: (localOrder.items || []).map((it: any) => ({
          id: it?._new ? undefined : (it?.id ?? undefined),
          product_id: it?._sku_id ?? it?.product_id ?? it?.sku_id ?? it?.sku?.id ?? null,
          sku_code: it?.sku_code ?? undefined,
          product_name: it?.product_name ?? undefined,
          quantity: toNumber(it?.quantity),
          unit_price: toNumber(it?.unit_price),
        })),
      };

      await api.put(`orders/${localOrder.id}`, payload);
      const refreshed = await api.get(`orders/${localOrder.id}`);
      setLocalOrder(refreshed);
      setOriginalOrder(refreshed);
      setIsEditing(false);
      setProductSearchByRow({});
      setRowPickerOpen({});
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      toast.success(isAr ? 'تم حفظ التعديلات' : 'Changes saved');
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || (isAr ? 'فشل حفظ التعديلات' : 'Could not save changes');
      toast.error(String(msg));
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrintInvoice = (o: any) => {
    try {
      const wh = warehouses?.find((w: any) => String(w.id) === String(o?.warehouse_id));
      const orderForPrint = { ...o, warehouse_name: wh?.name ?? o?.warehouse?.name };
      const payLabel = isAr ? 'طريقة الدفع' : 'Payment';
      const payVal = String(o?.payment_type || o?.financial_status || '—');
      const ok = printSalesInvoiceProfessional({
        rtl: isAr,
        branding: getDefaultPrintBranding(),
        order: orderForPrint,
        metaExtraLine: `${payLabel}: ${payVal}`,
        labels: {
          title: t('sales.dialog.invoiceTitle'),
          invoiceNo: isAr ? 'رقم الفاتورة' : 'Invoice no.',
          date: t('common.date'),
          customer: t('sales.dialog.customer'),
          warehouse: isAr ? 'المستودع' : 'Warehouse',
          hash: '#',
          product: t('table.product'),
          qty: t('sales.qty'),
          unitPrice: t('purchases.dialog.unitPrice'),
          lineTotal: t('purchases.dialog.total'),
          subtotal: t('purchases.dialog.subtotal'),
          discount: isAr ? 'الخصم' : 'Discount',
          tax: t('purchases.dialog.tax'),
          grandTotal: t('purchases.dialog.grandTotal'),
          notes: isAr ? 'ملاحظات' : 'Notes',
          receivedBy: isAr ? 'المستلم / المحاسب' : 'Received by',
          secondSign: isAr ? 'اعتماد العميل' : 'Customer acknowledgment',
          paid: isAr ? 'المدفوع' : 'Paid',
          remaining: isAr ? 'المتبقي' : 'Remaining',
          accountPrevious: isAr ? 'الحساب السابق' : 'Previous balance',
          accountPreviousHint: isAr ? '(غير متاح)' : '(n/a)',
        },
      });
      if (!ok) {
        toast.error(isAr ? 'تعذر الطباعة — اسمح بالنوافذ المنبثقة.' : 'Print blocked — allow popups for this site.');
      }
    } catch (e) {
      console.error(e);
      toast.error(isAr ? 'فشل تجهيز الطباعة' : 'Could not prepare print');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(900px,92vh)] w-[min(980px,calc(100vw-1.5rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="space-y-1 border-b border-border px-5 py-4 text-start">
          <DialogTitle className="font-mono text-lg">{title || '—'}</DialogTitle>
          <DialogDescription className="sr-only">
            {isAr ? 'تفاصيل الطلب ومعاملات التسوية' : 'Order details and settlement transactions'}
          </DialogDescription>
        </DialogHeader>

        {!localOrder ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">—</div>
        ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">

          {/* ── Header info grid ── */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {/* Customer */}
            <div className="rounded border border-border bg-muted/20 px-2 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('sales.dialog.customer')}
              </p>
              {isEditing ? (
                <input
                  className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/40"
                  value={String(localOrder.customer_name || '')}
                  placeholder={t('sales.walkInCustomer')}
                  onChange={(e) => setLocalOrderField({ customer_name: e.target.value })}
                />
              ) : (
                <p className="text-sm font-semibold">{localOrder.customer_name || t('sales.walkInCustomer')}</p>
              )}
            </div>

            {/* Date */}
            <div className="rounded border border-border bg-muted/20 px-2 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t('common.date')}</p>
              <p className="text-sm font-semibold">{formatDisplayDate(localOrder.created_at || localOrder.order_date)}</p>
            </div>

            {/* Payment — toggle when editing */}
            <div className="rounded border border-border bg-muted/20 px-2 py-2 sm:col-span-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('sales.dialog.payment')}
              </p>
              {isEditing ? (
                <div className="mt-1 space-y-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const total = computeTotalsFromItems(localOrder).total;
                        setLocalOrderField({ payment_type: 'cash', paid_amount: total });
                      }}
                      className={cn(
                        'flex-1 rounded border px-3 py-1.5 text-xs font-semibold transition-colors',
                        String(localOrder.payment_type || '').toLowerCase() === 'cash'
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background hover:bg-muted'
                      )}
                    >
                      {isAr ? 'كاش' : 'Cash'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocalOrderField({ payment_type: 'credit', paid_amount: 0 })}
                      className={cn(
                        'flex-1 rounded border px-3 py-1.5 text-xs font-semibold transition-colors',
                        String(localOrder.payment_type || '').toLowerCase() === 'credit'
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background hover:bg-muted'
                      )}
                    >
                      {isAr ? 'آجل' : 'Credit'}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                      {isAr ? 'المدفوع:' : 'Paid:'}
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      className="w-full rounded border border-border bg-background px-2 py-1 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/40"
                      value={String(toNumber(localOrder.paid_amount))}
                      min={0}
                      onChange={(e) =>
                        setLocalOrderField({ paid_amount: e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)) })
                      }
                    />
                    <span className="text-xs text-muted-foreground">EGP</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm font-semibold">{paymentLine}</p>
              )}
            </div>

            {/* Remaining */}
            <div className="rounded border border-border bg-muted/20 px-2 py-2 sm:col-span-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('sales.dialog.remaining')}
              </p>
              <p className="text-sm font-mono font-semibold tabular-nums">
                {formatLatinNumber(isEditing ? liveComputedTotals.remaining : toNumber(localOrder.remaining_amount))} EGP
              </p>
            </div>

            {/* Discount */}
            <div className="rounded border border-border bg-muted/20 px-2 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {isAr ? 'الخصم' : 'Discount'}
              </p>
              {isEditing ? (
                <input
                  type="number"
                  inputMode="decimal"
                  className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/40"
                  value={String(toNumber(localOrder.discount_amount))}
                  onChange={(e) =>
                    setLocalOrderField({
                      discount_amount: e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)),
                    })
                  }
                />
              ) : (
                <p className="text-sm font-mono font-semibold tabular-nums">
                  {formatLatinNumber(toNumber(localOrder.discount_amount))} EGP
                </p>
              )}
            </div>

            {/* Total */}
            <div className="rounded border border-border bg-muted/20 px-2 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('sales.dialog.total')}
              </p>
              <p className="text-sm font-mono font-semibold tabular-nums">
                {formatLatinNumber(isEditing ? liveComputedTotals.total : toNumber(localOrder.total_amount))} EGP
              </p>
            </div>
          </div>

          {/* ── Invoice lines ── */}
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-muted-foreground">
                {isAr ? 'بنود الفاتورة' : 'Invoice lines'}
              </p>
            </div>
            <div className="overflow-x-auto rounded-md border border-border bg-background shadow-inner">
              <table className={cn(excelTable, excelTrEven)}>
                <thead>
                  <tr>
                    <th className={excelTh}>#</th>
                    <th className={excelTh}>{t('table.product')}</th>
                    <th className={excelTh}>SKU</th>
                    <th className={cn(excelTh, 'text-end')}>{t('sales.qty')}</th>
                    <th className={cn(excelTh, 'text-end')}>{t('sales.unit')}</th>
                    <th className={cn(excelTh, 'text-end')}>{t('sales.dialog.total')}</th>
                    {isEditing && <th className={excelTh}></th>}
                  </tr>
                </thead>
                <tbody>
                  {(localOrder.items || []).map((item: any, idx: number) => (
                    <tr key={item.id ?? `new-${idx}`}>
                      <td className={excelTdNum}>{idx + 1}</td>

                      {/* Product name — combobox picker in edit mode */}
                      <td className={excelTd}>
                        {isEditing ? (
                          <Popover
                            open={!!rowPickerOpen[idx]}
                            onOpenChange={(o) => setRowPickerOpen((prev) => ({ ...prev, [idx]: o }))}
                          >
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className={cn(
                                  'flex min-w-[150px] w-full items-center justify-between rounded border border-border bg-background px-2 py-1 text-start text-xs outline-none hover:bg-muted focus:ring-2 focus:ring-primary/40',
                                  !item.product_name && 'text-muted-foreground'
                                )}
                              >
                                <span className="truncate max-w-[200px]">
                                  {item.product_name || (isAr ? 'اختر المنتج...' : 'Select product...')}
                                </span>
                                <ChevronsUpDown className="ms-1 h-3 w-3 shrink-0 opacity-50" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[340px] p-0" align="start">
                              <Command shouldFilter={false}>
                                <CommandInput
                                  placeholder={isAr ? 'ابحث باسم المنتج أو SKU...' : 'Search product or SKU...'}
                                  value={productSearchByRow[idx] || ''}
                                  onValueChange={(val) => setProductSearchByRow((prev) => ({ ...prev, [idx]: val }))}
                                />
                                <CommandList>
                                  <CommandEmpty>
                                    {isAr ? 'لا توجد نتائج — اكتب اسم المنتج يدوياً في حقل SKU' : 'No results — type a product name manually in the SKU field'}
                                  </CommandEmpty>
                                  <CommandGroup>
                                    {getPickerItems(productSearchByRow[idx] || '').map((row) => (
                                      <CommandItem
                                        key={row.id}
                                        value={row.id}
                                        onSelect={() => {
                                          setLocalOrderItem(idx, {
                                            product_name: row.product_name,
                                            sku_code: row.sku_code,
                                            _sku_id: row.sku_id ? Number(row.sku_id) : null,
                                          });
                                          setProductSearchByRow((prev) => ({ ...prev, [idx]: '' }));
                                          setRowPickerOpen((prev) => ({ ...prev, [idx]: false }));
                                        }}
                                        className="flex items-center justify-between py-1.5"
                                      >
                                        <div className="min-w-0">
                                          <div className="truncate text-xs font-medium">{row.label}</div>
                                          {row.sub && (
                                            <div className="font-mono text-[10px] text-muted-foreground">{row.sub}</div>
                                          )}
                                        </div>
                                        {item._sku_id != null && String(item._sku_id) === row.sku_id && (
                                          <Check className="ms-2 h-3.5 w-3.5 shrink-0 text-primary" />
                                        )}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        ) : (
                          item.product_name || item?.sku?.name || item?.sku?.sku || '—'
                        )}
                      </td>

                      {/* SKU code */}
                      <td className={cn(excelTd, 'font-mono text-[10px] whitespace-nowrap')}>
                        {isEditing ? (
                          <input
                            className="h-7 w-24 rounded border border-border bg-background px-2 font-mono text-[10px] outline-none focus:ring-2 focus:ring-primary/40"
                            value={String(item?.sku_code || '')}
                            placeholder="SKU"
                            onChange={(e) => setLocalOrderItem(idx, { sku_code: e.target.value })}
                          />
                        ) : (
                          item?.sku_code || item?.sku?.sku || item?.sku_sku || '—'
                        )}
                      </td>

                      {/* Quantity */}
                      <td className={excelTdNum}>
                        {isEditing ? (
                          <input
                            type="number"
                            inputMode="decimal"
                            className="h-7 w-20 rounded border border-border bg-background px-2 text-end font-mono tabular-nums outline-none focus:ring-2 focus:ring-primary/40"
                            value={String(toNumber(item.quantity))}
                            onChange={(e) => setLocalOrderItem(idx, { quantity: e.target.value === '' ? 0 : Number(e.target.value) })}
                          />
                        ) : (
                          formatLatinNumber(toNumber(item.quantity), { maximumFractionDigits: 3 })
                        )}
                      </td>

                      {/* Unit price */}
                      <td className={excelTdNum}>
                        {isEditing ? (
                          <input
                            type="number"
                            inputMode="decimal"
                            className="h-7 w-24 rounded border border-border bg-background px-2 text-end font-mono tabular-nums outline-none focus:ring-2 focus:ring-primary/40"
                            value={String(toNumber(item.unit_price))}
                            onChange={(e) => setLocalOrderItem(idx, { unit_price: e.target.value === '' ? 0 : Number(e.target.value) })}
                          />
                        ) : (
                          <>{formatLatinNumber(toNumber(item.unit_price))} EGP</>
                        )}
                      </td>

                      {/* Line total */}
                      <td className={excelTdNum}>
                        {formatLatinNumber(
                          isEditing
                            ? toNumber(item.quantity) * toNumber(item.unit_price)
                            : (toNumber(item.total_price) || toNumber(item.quantity) * toNumber(item.unit_price))
                        )}{' '}
                        EGP
                      </td>

                      {/* Delete button */}
                      {isEditing && (
                        <td className={cn(excelTd, 'text-center')}>
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            className="rounded p-1 text-destructive hover:bg-destructive/10"
                            title={isAr ? 'حذف البند' : 'Remove item'}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add item button */}
            {isEditing && (
              <div className="mt-2 flex justify-start">
                <button
                  type="button"
                  onClick={addNewItem}
                  className="flex items-center gap-1.5 rounded border border-dashed border-emerald-500 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {isAr ? 'إضافة بند' : 'Add item'}
                </button>
              </div>
            )}

            {/* Live totals summary when editing */}
            {isEditing && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded border border-border bg-muted/30 px-3 py-2 text-center">
                  <p className="text-[10px] text-muted-foreground">{isAr ? 'إجمالي الفاتورة' : 'Total'}</p>
                  <p className="font-semibold tabular-nums">{formatLatinNumber(liveComputedTotals.total)} EGP</p>
                </div>
                <div className="rounded border border-border bg-muted/30 px-3 py-2 text-center">
                  <p className="text-[10px] text-muted-foreground">{isAr ? 'المدفوع' : 'Paid'}</p>
                  <p className="font-semibold tabular-nums text-emerald-600">{formatLatinNumber(liveComputedTotals.paid)} EGP</p>
                </div>
                <div className="rounded border border-border bg-muted/30 px-3 py-2 text-center">
                  <p className="text-[10px] text-muted-foreground">{isAr ? 'المتبقي' : 'Remaining'}</p>
                  <p className="font-semibold tabular-nums text-amber-600">{formatLatinNumber(liveComputedTotals.remaining)} EGP</p>
                </div>
              </div>
            )}
          </div>

          {/* ── Settlement transactions ── */}
          <div>
            {isOrderTxError ? (
              <div className="mb-2 flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <p className="min-w-0 text-destructive">
                  {isAr ? 'تعذر تحميل معاملات التسوية لهذا الطلب.' : 'Could not load settlement transactions for this order.'}
                  {orderTxErrorText ? (
                    <span className="mt-1 block font-mono text-xs text-destructive/90" dir="ltr">
                      {orderTxErrorText}
                    </span>
                  ) : null}
                </p>
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => void refetchOrderTx()}>
                  {isAr ? 'إعادة المحاولة' : 'Retry'}
                </Button>
              </div>
            ) : null}
            <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
              {isAr
                ? 'هذا القسم يظهر داخل نافذة الطلب فقط. اضغط على صف الطلب لفتحه؛ بعد رفع شيت تسوية جديد يُفضّل إغلاق النافذة وفتحها من جديد أو الضغط على «إعادة المحاولة» إن ظهر خطأ.'
                : 'This block is inside the order dialog only. Click a row to open it. After importing a new settlement sheet, close and reopen or use Retry if an error appears.'}
            </p>
            {showSettlementRollupHint ? (
              <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-950 dark:text-amber-100">
                {isAr
                  ? 'الحركات المعروضة جاية من ملف تسوية مبسّط (سطر أو سطرين لكل طلب). عشان تظهر تفاصيل أمازون زي «ItemPrice: Principal» والرسوم سطر بسطر زي الصور المرجعية، ارفع تقرير التسوية الرسمي (Settlement Report) بصيغة XML من صفحة التسوية/المطابقة.'
                  : 'These lines come from a simplified settlement file (one or two rows per order). To see Amazon line-level detail (ItemPrice: Principal, fees per line like your reference screenshots), upload the official Settlement Report (XML) from Reconciliation / Settlements.'}
              </div>
            ) : null}
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-muted-foreground">
                {isAr ? 'معاملات التسوية لنفس رقم الطلب' : 'Settlement transactions (same order ID)'}
              </p>
              {settlementItems.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {isAr ? `عدد الحركات: ${formatLatinNumber(settlementItems.length, { maximumFractionDigits: 0 })}` : `Rows: ${formatLatinNumber(settlementItems.length, { maximumFractionDigits: 0 })}`}
                </p>
              )}
            </div>
            <div className="overflow-x-auto rounded-md border border-border bg-background shadow-inner">
              <table className={cn(excelTable, excelTrEven)}>
                <thead>
                  <tr>
                    <th className={excelTh}>#</th>
                    <th className={excelTh}>{isAr ? 'النوع' : 'Type'}</th>
                    <th className={excelTh}>{isAr ? 'التاريخ' : 'Date'}</th>
                    <th className={excelTh}>{isAr ? 'الوصف' : 'Description'}</th>
                    <th className={cn(excelTh, 'text-end')}>{isAr ? 'الرسوم' : 'Fees'}</th>
                    <th className={cn(excelTh, 'text-end')}>{isAr ? 'المبلغ' : 'Amount'}</th>
                  </tr>
                </thead>
                <tbody>
                  {isOrderTransactionsLoading ? (
                    <tr>
                      <td colSpan={6} className={cn(excelTd, 'py-8 text-center text-muted-foreground')}>
                        {isAr ? 'جاري تحميل الحركات...' : 'Loading transactions...'}
                      </td>
                    </tr>
                  ) : !settlementItems.length ? (
                    <tr>
                      <td colSpan={6} className={cn(excelTd, 'py-8 text-center text-muted-foreground')}>
                        {isAr
                          ? 'لا توجد حركات تسوية مرتبطة بهذا الطلب'
                          : 'No settlement transactions linked to this order'}
                      </td>
                    </tr>
                  ) : (
                    settlementItems.map((tx: any, idx: number) => (
                      <tr key={tx.id || idx}>
                        <td className={excelTdNum}>{idx + 1}</td>
                        <td className={cn(excelTd, 'font-mono text-[10px]')}>{tx.transaction_type || '—'}</td>
                        <td className={excelTd}>{tx.transaction_date ? formatDisplayDate(tx.transaction_date) : '—'}</td>
                        <td className={cn(excelTd, 'max-w-[280px] whitespace-pre-wrap break-words')} title={tx.description || ''}>
                          {tx.description || '—'}
                        </td>
                        <td className={cn(excelTdNum, parseSettlementMoney(tx.fee_amount) < 0 && 'text-destructive')}>
                          {formatLatinNumber(parseSettlementMoney(tx.fee_amount))} EGP
                        </td>
                        <td className={cn(excelTdNum, parseSettlementMoney(tx.amount) < 0 && 'text-destructive')}>
                          {formatLatinNumber(parseSettlementMoney(tx.amount))} EGP
                        </td>
                      </tr>
                    ))
                  )}
                  {!isOrderTransactionsLoading && settlementItems.length > 0 ? (
                    <tr className="bg-muted/50 font-semibold">
                      <td colSpan={5} className={cn(excelTd, 'text-end')}>
                        {isAr ? 'صافي المعاملات (مجموع المبلغ)' : 'Net (sum of amounts)'}
                      </td>
                      <td className={cn(excelTdNum, settlementNetTotal < 0 && 'text-destructive')}>
                        {formatLatinNumber(settlementNetTotal, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        )}

        {/* ── Footer ── */}
        {localOrder ? (
        <div className="flex flex-col gap-3 border-t border-border bg-muted/30 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            {!isOrderTransactionsLoading && settlementItems.length > 0 ? (
              <p className="text-base font-bold tabular-nums">
                <span className="text-muted-foreground">{t('sales.dialog.settlementNet')}: </span>
                <span className={settlementNetTotal < 0 ? 'text-destructive' : 'text-foreground'}>
                  {formatLatinNumber(settlementNetTotal, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP
                </span>
              </p>
            ) : null}
            <p className="text-sm tabular-nums text-muted-foreground">
              {t('sales.dialog.invoiceLinesSubtotal')}:{' '}
              {formatLatinNumber(invoiceLinesSubtotal, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP
              {toNumber(localOrder.total_amount) !== invoiceLinesSubtotal ? (
                <>
                  {' · '}
                  {isAr ? 'إجمالي مسجل بالنظام' : 'System recorded total'}:{' '}
                  {formatLatinNumber(toNumber(localOrder.total_amount), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP
                </>
              ) : null}
            </p>
            {!isOrderTransactionsLoading && settlementItems.length === 0 ? (
              <p className="text-base font-bold tabular-nums">
                {t('sales.dialog.total')}:{' '}
                {formatLatinNumber(toNumber(localOrder.total_amount), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={handleToggleEdit}
              disabled={!canEditOrder(localOrder) && !isEditing}
            >
              <Pencil className="h-4 w-4 me-2" />
              {isEditing ? (isAr ? 'إلغاء التعديل' : 'Cancel edit') : t('common.edit')}
            </Button>
            <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => handlePrintInvoice(localOrder)}>
              <Printer className="h-4 w-4 me-2" />
              {t('sales.dialog.printInvoice')}
            </Button>
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              onClick={() => void handleSaveEdits()}
              disabled={!isEditing || isSaving}
            >
              {isSaving ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Save className="h-4 w-4 me-2" />}
              {t('settings.saveChanges')}
            </Button>
          </div>
        </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
