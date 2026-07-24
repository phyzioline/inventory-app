import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Loader2, Package, ChevronsUpDown, Check, AlertCircle } from 'lucide-react';
import { useForm, useFieldArray } from 'react-hook-form';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { useProducts } from '@/hooks/useProducts';
import { useWarehouses } from '@/hooks/useWarehouses';
import { useCreateSalesOrder } from '@/hooks/useSales';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn, formatLatinNumber, formatProductLabel } from '@/lib/utils';
import api from '@/lib/api';

interface CreateSalesOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MARKETPLACE_OPTIONS = [
  { value: 'direct', label: 'Direct Sale' },
  { value: 'amazon_fba', label: 'Amazon FBA' },
  { value: 'amazon_store', label: 'Amazon Store' },
  { value: 'noon', label: 'Noon' },
  { value: 'jumia', label: 'Jumia' },
];

interface FormData {
  order_number: string;
  warehouse_id: string;
  credit_warehouse_id: string;
  fulfillment_warehouse_id: string;
  payment_type: 'cash' | 'credit';
  paid_amount: number;
  vat_enabled?: boolean;
  discount_amount?: number;
  customer_name: string;
  marketplace_source: string;
  external_order_number: string;
  items: Array<{
    product_id: string;
    quantity: number;
    unit_price: number;
  }>;
}

export function CreateSalesOrderDialog({ open, onOpenChange }: CreateSalesOrderDialogProps) {
  const { t, language } = useLanguage();
  const { data: products } = useProducts();
  const { data: warehouses } = useWarehouses();
  const createOrder = useCreateSalesOrder();
  const [productPickerOpenByRow, setProductPickerOpenByRow] = useState<Record<number, boolean>>({});
  const [autoPullFromSource, setAutoPullFromSource] = useState(false);
  const [selectedFulfillmentWarehouseId, setSelectedFulfillmentWarehouseId] = useState<string>('');
  const [differentFulfillment, setDifferentFulfillment] = useState(false);
  const [customCreditWallet, setCustomCreditWallet] = useState(false);
  const [vatEnabled, setVatEnabled] = useState(false);
  const [discountAmountInput, setDiscountAmountInput] = useState(0);

  // Fetch inventory for the selected fulfillment warehouse
  const { data: warehouseInventory = [], isLoading: loadingInventory } = useQuery({
    queryKey: ['warehouse-inventory-for-sales', selectedFulfillmentWarehouseId],
    queryFn: () => api.getArray(`warehouses/${selectedFulfillmentWarehouseId}/inventory?per_page=500`),
    enabled: !!selectedFulfillmentWarehouseId,
  });

  // Build a map of master_product_id -> { available, skuId } from warehouse inventory
  const warehouseStockMap = useMemo(() => {
    if (!selectedFulfillmentWarehouseId || !warehouseInventory.length) return null;
    const map = new Map<string, { available: number; skuId: string; sellingPrice: number }>();
    for (const item of warehouseInventory) {
      const qty = Number(item?.quantity || 0);
      if (qty <= 0) continue;
      const mpId = String(
        item?.sku?.offer?.master_product_id ||
        item?.sku?.offer?.masterProduct?.id ||
        item?.sku?.offer?.master_product?.id ||
        ''
      );
      if (!mpId) continue;
      const existing = map.get(mpId);
      if (!existing || qty > existing.available) {
        map.set(mpId, {
          available: qty,
          skuId: String(item?.sku?.id || ''),
          sellingPrice: Number(item?.sku?.selling_price || 0),
        });
      }
    }
    return map;
  }, [warehouseInventory, selectedFulfillmentWarehouseId]);

  // Products filtered to warehouse stock (or all products if no warehouse selected)
  const availableProducts = useMemo(() => {
    if (!warehouseStockMap) return products || [];
    return (products || []).filter(p => warehouseStockMap.has(String(p.id)));
  }, [products, warehouseStockMap]);

  const { register, control, handleSubmit, setValue, watch, reset } = useForm<FormData>({
    defaultValues: {
      order_number: `ORD-${Date.now().toString(36).toUpperCase()}`,
      warehouse_id: '',
      credit_warehouse_id: '',
      fulfillment_warehouse_id: '',
      payment_type: 'cash',
      paid_amount: 0,
      customer_name: '',
      marketplace_source: 'direct',
      external_order_number: '',
      items: [{ product_id: '', quantity: 1, unit_price: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'items',
  });

  const items = watch('items');
  const selectedMarketplace = watch('marketplace_source');
  const paymentType = watch('payment_type');
  const warehouseId = watch('warehouse_id');
  const paidAmountInput = Number(watch('paid_amount') ?? 0);
  const subtotalAmount = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
  const discountAmount = Math.min(Math.max(0, Number(discountAmountInput || 0)), Math.max(0, subtotalAmount));
  const taxableBase = Math.max(0, subtotalAmount - discountAmount);
  const taxAmount = vatEnabled ? Math.round(taxableBase * 0.14 * 100) / 100 : 0;
  const totalAmount = taxableBase + taxAmount;
  const paidAmount = Math.min(Math.max(0, Number.isFinite(paidAmountInput) ? paidAmountInput : 0), Math.max(0, totalAmount));
  const remainingAmount = Math.max(0, totalAmount - paidAmount);

  useEffect(() => {
    if (paymentType === 'cash') {
      setValue('paid_amount', totalAmount, { shouldDirty: true, shouldValidate: true });
      return;
    }

    if (paidAmountInput > totalAmount) {
      setValue('paid_amount', totalAmount, { shouldDirty: true, shouldValidate: true });
    }
  }, [paymentType, totalAmount, paidAmountInput, setValue]);

  useEffect(() => {
    if (!warehouseId) return;
    if (differentFulfillment) return;
    setValue('fulfillment_warehouse_id', warehouseId);
    setSelectedFulfillmentWarehouseId(warehouseId);
  }, [warehouseId, differentFulfillment, setValue]);

  useEffect(() => {
    if (paymentType !== 'credit') {
      setCustomCreditWallet(false);
      setValue('credit_warehouse_id', '');
    }
  }, [paymentType, setValue]);

  const localizedMarketplaceOptions = useMemo(
    () =>
      MARKETPLACE_OPTIONS.map((opt) => ({
        ...opt,
        label: language === 'ar'
          ? ({
            direct: 'بيع مباشر',
            amazon_fba: 'أمازون FBA',
            amazon_store: 'متجر أمازون',
            noon: 'نون',
            jumia: 'جوميا',
          } as Record<string, string>)[opt.value] || opt.label
          : opt.label,
      })),
    [language]
  );

  const onSubmit = (data: FormData) => {
    if (!data.warehouse_id) {
      toast.error(language === 'ar' ? 'من فضلك اختر مستودع' : 'Please select a warehouse');
      return;
    }
    if (data.items.some(item => !item.product_id)) {
      toast.error(language === 'ar' ? 'من فضلك اختر منتج لكل بند' : 'Please select products for all items');
      return;
    }

    createOrder.mutate({
      order_number: data.order_number,
      warehouse_id: data.warehouse_id,
      credit_warehouse_id: data.credit_warehouse_id || data.warehouse_id,
      fulfillment_warehouse_id: data.fulfillment_warehouse_id || data.warehouse_id,
      customer_name: data.customer_name || undefined,
      marketplace_source: data.marketplace_source,
      external_order_number: data.external_order_number || undefined,
      auto_pull_from_source: autoPullFromSource,
      payment_type: data.payment_type,
      paid_amount: paidAmount,
      remaining_amount: remainingAmount,
      total_amount: totalAmount,
      tax_amount: taxAmount,
      discount_amount: discountAmount,
      subtotal: subtotalAmount,
      items: data.items,
    }, {
      onSuccess: () => {
        onOpenChange(false);
        reset();
        setAutoPullFromSource(false);
        setDifferentFulfillment(false);
        setCustomCreditWallet(false);
        setSelectedFulfillmentWarehouseId('');
        setVatEnabled(false);
        setDiscountAmountInput(0);
      },
    });
  };

  const handleProductSelect = (index: number, productId: string) => {
    setValue(`items.${index}.product_id`, productId);
    // Use warehouse inventory price if available, otherwise fall back to master product price
    const stockInfo = warehouseStockMap?.get(String(productId));
    const product = products?.find(p => p.id === productId);
    const price = stockInfo?.sellingPrice || product?.selling_price || 0;
    if (price) {
      setValue(`items.${index}.unit_price`, price);
    }
  };

  const getProductAvailableStock = (productId: string): number | null => {
    if (!warehouseStockMap) return null;
    return warehouseStockMap.get(String(productId))?.available ?? null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(920px,92vh)] w-[min(1180px,calc(100vw-1.5rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="space-y-2 border-b border-border px-6 py-4 text-start">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Package className="h-5 w-5 text-primary" />
              {language === 'ar' ? 'إنشاء طلب بيع' : 'Create Sales Order'}
            </DialogTitle>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {t('sales.manualOrder.badge')}
            </span>
          </div>
          <DialogDescription className="text-start text-sm leading-relaxed">
            {t('sales.manualOrder.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-4">
            <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">
              <p className="font-medium text-foreground">{t('sales.manualOrder.intro')}</p>
              <ol className="mt-3 list-decimal space-y-1 ps-5">
                <li>{t('sales.manualOrder.step1')}</li>
                <li>{t('sales.manualOrder.step2')}</li>
                <li>{t('sales.manualOrder.step3')}</li>
              </ol>
            </div>

            <div>
              <h3 className="mb-3 text-base font-semibold">{t('sales.manualOrder.sectionIdentity')}</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'رقم الطلب' : 'Order Number'}</Label>
                  <Input {...register('order_number', { required: true })} />
                </div>
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'مصدر البيع (القناة)' : 'Source Channel'}</Label>
                  <Select
                    value={watch('marketplace_source')}
                    onValueChange={(val) => {
                      setValue('marketplace_source', val);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={language === 'ar' ? 'اختر القناة' : 'Select Channel'} />
                    </SelectTrigger>
                    <SelectContent>
                      {localizedMarketplaceOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>{language === 'ar' ? 'رقم الطلب الخارجي (أمازون/نون/جوميا)' : 'External Order # (Amazon/Noon/Jumia)'}</Label>
                  <Input
                    {...register('external_order_number')}
                    placeholder={t('sales.manualOrder.externalPlaceholder')}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>{language === 'ar' ? 'اسم العميل' : 'Customer Name'}</Label>
                  <Input {...register('customer_name')} placeholder={language === 'ar' ? 'عميل مباشر' : 'Walk-in Customer'} />
                </div>
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="mb-3 text-base font-semibold">{t('sales.manualOrder.sectionWarehouses')}</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'مستودع المصدر (مالك البيع)' : 'Source Warehouse (Sale Owner)'}</Label>
                  <Select
                    value={warehouseId || undefined}
                    onValueChange={(val) => {
                      setValue('warehouse_id', val);
                      if (!differentFulfillment) {
                        setValue('fulfillment_warehouse_id', val);
                        setSelectedFulfillmentWarehouseId(val);
                        fields.forEach((_, i) => setValue(`items.${i}.product_id`, ''));
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={language === 'ar' ? 'اختر المستودع' : 'Select Warehouse'} />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses?.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name} ({w.type})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={differentFulfillment}
                      onCheckedChange={(c) => {
                        const on = c === true;
                        setDifferentFulfillment(on);
                        if (!on && warehouseId) {
                          setValue('fulfillment_warehouse_id', warehouseId);
                          setSelectedFulfillmentWarehouseId(warehouseId);
                          fields.forEach((_, i) => setValue(`items.${i}.product_id`, ''));
                        }
                      }}
                    />
                    <span>{t('sales.manualOrder.diffFulfillment')}</span>
                  </label>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>{language === 'ar' ? 'مستودع التنفيذ (الشحن من المخزون)' : 'Fulfillment Warehouse (Ships Stock)'}</Label>
                  <Select
                    disabled={!differentFulfillment}
                    value={watch('fulfillment_warehouse_id') || undefined}
                    onValueChange={(val) => {
                      setValue('fulfillment_warehouse_id', val);
                      setSelectedFulfillmentWarehouseId(val);
                      fields.forEach((_, i) => setValue(`items.${i}.product_id`, ''));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          differentFulfillment
                            ? language === 'ar'
                              ? 'اختر مستودع التنفيذ'
                              : 'Select fulfillment warehouse'
                            : language === 'ar'
                              ? 'يتبع مستودع المصدر'
                              : 'Matches source warehouse'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses?.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedFulfillmentWarehouseId && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      {loadingInventory
                        ? language === 'ar'
                          ? 'جارٍ تحميل المخزون...'
                          : 'Loading inventory...'
                        : `${availableProducts.length} ${language === 'ar' ? 'منتج متاح في هذا المخزن' : 'products available in this warehouse'}`}
                    </p>
                  )}
                </div>
                {paymentType === 'credit' && (
                  <>
                    <div className="flex items-end pb-2 md:col-span-2">
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox
                          checked={customCreditWallet}
                          onCheckedChange={(c) => {
                            const on = c === true;
                            setCustomCreditWallet(on);
                            if (!on) {
                              setValue('credit_warehouse_id', '');
                            }
                          }}
                        />
                        <span>{t('sales.manualOrder.customCredit')}</span>
                      </label>
                    </div>
                    {customCreditWallet && (
                      <div className="space-y-2 md:col-span-2">
                        <Label>{language === 'ar' ? 'ترحيل الرصيد إلى' : 'Credit Wallet To'}</Label>
                        <Select
                          value={watch('credit_warehouse_id') || undefined}
                          onValueChange={(val) => setValue('credit_warehouse_id', val)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={language === 'ar' ? 'اختر المستودع' : 'Select Warehouse'} />
                          </SelectTrigger>
                          <SelectContent>
                            {warehouses?.map((w) => (
                              <SelectItem key={w.id} value={w.id}>
                                {w.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {(selectedMarketplace === 'amazon_store' || selectedMarketplace === 'amazon_fba') && (
              <div className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-medium">{t('sales.manualOrder.autoPullTitle')}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{t('sales.manualOrder.autoPullHelp')}</p>
                </div>
                <Button
                  type="button"
                  variant={autoPullFromSource ? 'default' : 'outline'}
                  className="shrink-0 sm:self-center"
                  onClick={() => setAutoPullFromSource((v) => !v)}
                >
                  {autoPullFromSource
                    ? language === 'ar'
                      ? 'مفعل'
                      : 'On'
                    : language === 'ar'
                      ? 'تفعيل'
                      : 'Turn on'}
                </Button>
              </div>
            )}

            <Separator />

            <div>
              <h3 className="mb-3 text-base font-semibold">{t('sales.manualOrder.sectionPayment')}</h3>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'طريقة الدفع' : 'Payment Type'}</Label>
                  <Select
                    value={watch('payment_type')}
                    onValueChange={(val: 'cash' | 'credit') => setValue('payment_type', val)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">{language === 'ar' ? 'كاش' : 'Cash'}</SelectItem>
                      <SelectItem value="credit">{language === 'ar' ? 'آجل' : 'Credit'}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'تم دفع كام' : 'Paid Amount'}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max={Math.max(0, totalAmount)}
                    disabled={paymentType === 'cash'}
                    {...register('paid_amount', { valueAsNumber: true })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'المتبقي' : 'Remaining Amount'}</Label>
                  <Input value={remainingAmount.toFixed(2)} readOnly />
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3 text-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox checked={vatEnabled} onCheckedChange={(v) => setVatEnabled(Boolean(v))} />
                    <span className="font-medium">{language === 'ar' ? 'إضافة VAT 14%' : 'Add VAT 14%'}</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">{language === 'ar' ? 'خصم' : 'Discount'}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max={Math.max(0, subtotalAmount)}
                      value={String(discountAmountInput ?? 0)}
                      onChange={(e) => setDiscountAmountInput(Number(e.target.value || 0))}
                      className="h-8 w-28 text-sm font-mono"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>{language === 'ar' ? 'الإجمالي الفرعي' : 'Subtotal'}</span>
                    <span className="font-mono">{subtotalAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{language === 'ar' ? 'الخصم' : 'Discount'}</span>
                    <span className="font-mono">{discountAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{language === 'ar' ? 'الضريبة' : 'Tax'}</span>
                    <span className="font-mono">{taxAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between col-span-2 text-foreground">
                    <span className="font-semibold">{language === 'ar' ? 'الإجمالي بعد الضريبة' : 'Total (incl. tax)'}</span>
                    <span className="font-mono font-semibold">{totalAmount.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{t('sales.manualOrder.sectionLines')}</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append({ product_id: '', quantity: 1, unit_price: 0 })}
                >
                  <Plus className="w-4 h-4 mr-2" /> {language === 'ar' ? 'إضافة بند' : 'Add Item'}
                </Button>
              </div>

              {fields.map((field, index) => (
              <div key={field.id} className="space-y-1 border-b border-border/50 pb-4">
                <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-5 space-y-1">
                  <Label className="text-xs">{language === 'ar' ? 'المنتج' : 'Product'}</Label>
                  <Popover
                    open={!!productPickerOpenByRow[index]}
                    onOpenChange={(openState) =>
                      setProductPickerOpenByRow((prev) => ({ ...prev, [index]: openState }))
                    }
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        className="w-full justify-between"
                      >
                        {(() => {
                          const selectedId = watch(`items.${index}.product_id`) || '';
                          const selected = (products || []).find((p) => p.id === selectedId);
                          return selected
                            ? formatProductLabel(selected)
                            : (language === 'ar' ? 'ابحث واختر المنتج' : 'Search and select product');
                        })()}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                      <Command>
                        <CommandInput placeholder={language === 'ar' ? 'ابحث باسم المنتج أو SKU' : 'Search by name or SKU'} />
                        <CommandList>
                          <CommandEmpty>
                            {selectedFulfillmentWarehouseId
                              ? (language === 'ar' ? 'لا يوجد مخزون في هذا المستودع' : 'No stock in this warehouse')
                              : (language === 'ar' ? 'لا يوجد منتج مطابق' : 'No product found')
                            }
                          </CommandEmpty>
                          <CommandGroup>
                            {availableProducts.slice(0, 300).map((p) => {
                              const selectedId = watch(`items.${index}.product_id`) || '';
                              const isSelected = selectedId === p.id;
                              const availableStock = getProductAvailableStock(p.id);
                              return (
                                <CommandItem
                                  key={p.id}
                                  value={formatProductLabel(p)}
                                  onSelect={() => {
                                    handleProductSelect(index, p.id);
                                    setProductPickerOpenByRow((prev) => ({ ...prev, [index]: false }));
                                  }}
                                >
                                  <Check className={cn('mr-2 h-4 w-4', isSelected ? 'opacity-100' : 'opacity-0')} />
                                  <span className="flex-1">{formatProductLabel(p)}</span>
                                  {availableStock !== null && (
                                    <span className={cn('ml-2 text-xs font-mono px-1.5 py-0.5 rounded', availableStock > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
                                      {availableStock}
                                    </span>
                                  )}
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">{language === 'ar' ? 'الكمية' : 'Qty'}</Label>
                  <Input
                    type="number"
                    min="1"
                    {...register(`items.${index}.quantity`, { required: true, valueAsNumber: true })}
                  />
                </div>
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs">{language === 'ar' ? 'سعر الوحدة' : 'Unit Price'}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    {...register(`items.${index}.unit_price`, { required: true, valueAsNumber: true })}
                  />
                </div>
                <div className="col-span-2 flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {formatLatinNumber((items[index]?.quantity || 0) * (items[index]?.unit_price || 0))}
                  </span>
                  {fields.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => remove(index)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                </div>
                {(() => {
                  const pid = watch(`items.${index}.product_id`) || '';
                  if (!pid) return null;
                  const avail = getProductAvailableStock(pid);
                  if (avail === null) {
                    return (
                      <p className="text-xs text-muted-foreground">
                        {selectedFulfillmentWarehouseId
                          ? language === 'ar'
                            ? 'لا تتوفر كمية لهذا المنتج في مستودع التنفيذ الحالي.'
                            : 'No on-hand quantity for this product in the current fulfillment warehouse.'
                          : language === 'ar'
                            ? 'اختر مستودع المصدر/التنفيذ لعرض الكمية المتاحة.'
                            : 'Pick warehouses above to show available quantity.'}
                      </p>
                    );
                  }
                  return (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{t('sales.manualOrder.currentQty')}:</span>{' '}
                      <span className={cn('font-mono tabular-nums', avail > 0 ? 'text-green-700' : 'text-destructive')}>
                        {formatLatinNumber(avail, { maximumFractionDigits: 0 })}
                      </span>
                    </p>
                  );
                })()}
              </div>
              ))}

              <div className="flex justify-end">
              <div className="text-right">
                <span className="text-muted-foreground">Total: </span>
                <span className="text-xl font-bold text-primary">
                  {formatLatinNumber(totalAmount)} EGP
                </span>
              </div>
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-border bg-background px-6 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button type="submit" disabled={createOrder.isPending}>
              {createOrder.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {language === 'ar' ? 'إنشاء الطلب' : 'Create Order'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
