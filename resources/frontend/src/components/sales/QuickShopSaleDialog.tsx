import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Loader2, ShoppingCart, ChevronsUpDown, Check, UserPlus, Printer, RotateCcw } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useWarehouses } from '@/hooks/useWarehouses';
import { useCreateSalesOrder } from '@/hooks/useSales';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn, formatLatinNumber, formatProductLabel } from '@/lib/utils';
import { customerService, productService } from '@/lib/supabase-services';
import { Checkbox } from '@/components/ui/checkbox';
import {
  fetchMergedLocationInventory,
  resolveInventoryRowMasterProductId,
  resolveInventoryRowQty,
} from '@/lib/warehouseInventoryFetch';
import { getDefaultPrintBranding, printSalesInvoiceProfessional } from '@/lib/printUtils';

interface QuickShopSaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FormData {
  customer_id: string;
  customer_name: string;
  customer_phone?: string;
  shipping_address?: string;
  notes?: string;
  warehouse_id: string;
  payment_type: 'cash' | 'credit';
  paid_amount: number;
  discount_amount?: number;
  items: Array<{ product_id: string; quantity: number; unit_price: number }>;
}

interface ShopSaleDraft {
  form: FormData;
  selectedWarehouseId: string;
  vatEnabled: boolean;
  discountAmountInput: number;
  savedAt: number;
}

const DRAFT_STORAGE_KEY = 'phyzioline:quick-shop-sale-draft';

const EMPTY_FORM: FormData = {
  customer_id: '',
  customer_name: '',
  customer_phone: '',
  shipping_address: '',
  notes: '',
  warehouse_id: '',
  payment_type: 'cash',
  paid_amount: 0,
  items: [{ product_id: '', quantity: 1, unit_price: 0 }],
};

function readShopSaleDraft(): ShopSaleDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ShopSaleDraft;
    if (!parsed?.form || !Array.isArray(parsed.form.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeShopSaleDraft(draft: ShopSaleDraft): void {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Ignore quota / private mode failures — sale can still proceed.
  }
}

function clearShopSaleDraft(): void {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function isMeaningfulDraft(form: FormData, warehouseId: string, discount: number, vat: boolean): boolean {
  if (warehouseId) return true;
  if (form.customer_id || form.customer_name) return true;
  if (String(form.customer_phone || '').trim()) return true;
  if (String(form.shipping_address || '').trim()) return true;
  if (String(form.notes || '').trim()) return true;
  if (discount > 0 || vat) return true;
  if (form.payment_type !== 'cash') return true;
  return form.items.some(
    (item) => Boolean(item.product_id) || Number(item.quantity) !== 1 || Number(item.unit_price) > 0
  );
}

function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function productMatchesSearch(product: any, skuCode: string | null | undefined, rawQ: string): boolean {
  const q = rawQ.trim().toLowerCase();
  if (!q) return true;

  const label = String(formatProductLabel(product) || '').toLowerCase();
  const internalName = String(product?.internal_name || '').toLowerCase();
  const supplierSku = String(product?.original_supplier_sku || '').toLowerCase();
  const barcode = String(product?.specifications?.barcode || '').toLowerCase();
  const sku = String(skuCode || '').toLowerCase();
  const id = String(product?.id ?? '').toLowerCase();

  const haystacks = [label, internalName, supplierSku, barcode, sku, id].filter(Boolean);
  if (haystacks.some((h) => h.includes(q))) return true;

  // Digits-only match helps: PH007 vs PHY007, barcode fragments, etc.
  const qDigits = digitsOnly(q);
  if (qDigits.length >= 2) {
    const skuDigits = digitsOnly(sku);
    const supplierDigits = digitsOnly(supplierSku);
    const barcodeDigits = digitsOnly(barcode);
    if (skuDigits.includes(qDigits) || supplierDigits.includes(qDigits) || barcodeDigits.includes(qDigits)) return true;
  }

  return false;
}

export function QuickShopSaleDialog({ open, onOpenChange }: QuickShopSaleDialogProps) {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const queryClient = useQueryClient();
  const createOrder = useCreateSalesOrder();
  const { data: warehouses } = useWarehouses();

  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [productPickerOpenByRow, setProductPickerOpenByRow] = useState<Record<number, boolean>>({});
  const [productSearchByRow, setProductSearchByRow] = useState<Record<number, string>>({});
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [vatEnabled, setVatEnabled] = useState(false);
  const [discountAmountInput, setDiscountAmountInput] = useState(0);
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false);
  const skipNextPersistRef = useRef(false);
  const draftHydratedRef = useRef(false);
  const wasOpenRef = useRef(false);

  const selectedWarehouse = useMemo(
    () => (warehouses || []).find((w: any) => String(w.id) === String(selectedWarehouseId)),
    [warehouses, selectedWarehouseId]
  );

  // Fetch customers
  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => customerService.getAll(),
    enabled: open,
  });

  // Fetch warehouse inventory (+ channel SKUs for channel-linked locations) when warehouse selected
  const { data: warehouseInventory = [], isLoading: loadingInventory } = useQuery({
    queryKey: [
      'warehouse-inventory-quick-sale',
      selectedWarehouseId,
      selectedWarehouse?.channel_id ?? '',
    ],
    queryFn: () =>
      fetchMergedLocationInventory(String(selectedWarehouseId), selectedWarehouse?.channel_id ?? null),
    enabled: !!selectedWarehouseId && open,
  });

  // Map of master_product_id -> { available, sellingPrice, sku }
  const warehouseStockMap = useMemo(() => {
    if (!selectedWarehouseId || !warehouseInventory.length) return null;
    const map = new Map<string, { available: number; sellingPrice: number; skuCode: string }>();
    for (const item of warehouseInventory) {
      const qty = resolveInventoryRowQty(item);
      if (qty <= 0) continue;
      const mpId = resolveInventoryRowMasterProductId(item);
      if (!mpId) continue;
      const existing = map.get(mpId);
      if (!existing || qty > existing.available) {
        map.set(mpId, {
          available: qty,
          sellingPrice: Number(item?.sku?.selling_price || 0),
          skuCode: String(item?.sku?.sku || ''),
        });
      }
    }
    return map;
  }, [warehouseInventory, selectedWarehouseId]);

  // Fetch master products filtered by warehouse
  const { data: allProducts = [] } = useQuery({
    queryKey: ['master-products'],
    queryFn: () => productService.getAll(),
    enabled: open,
  });

  const availableProducts = useMemo(() => {
    if (!warehouseStockMap) return allProducts;
    return allProducts.filter((p: any) => warehouseStockMap.has(String(p.id)));
  }, [allProducts, warehouseStockMap]);

  const { register, control, handleSubmit, watch, setValue, reset, getValues } = useForm<FormData>({
    defaultValues: EMPTY_FORM,
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const watchedForm = watch();
  const items = watchedForm.items || [];
  const paymentType = watchedForm.payment_type;
  const paidAmountInput = Number(watchedForm.paid_amount ?? 0);
  const subtotalAmount = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
  const discountAmount = Math.min(Math.max(0, Number(discountAmountInput || 0)), Math.max(0, subtotalAmount));
  const taxableBase = Math.max(0, subtotalAmount - discountAmount);
  const taxAmount = vatEnabled ? Math.round(taxableBase * 0.14 * 100) / 100 : 0;
  const totalAmount = taxableBase + taxAmount;
  const paidAmount = paymentType === 'cash' ? totalAmount : Math.min(Math.max(0, paidAmountInput), totalAmount);
  const remainingAmount = Math.max(0, totalAmount - paidAmount);

  const persistDraft = useCallback((form: FormData, warehouseId: string, vat: boolean, discount: number) => {
    if (!isMeaningfulDraft(form, warehouseId, discount, vat)) {
      clearShopSaleDraft();
      setHasRestoredDraft(false);
      return;
    }
    writeShopSaleDraft({
      form,
      selectedWarehouseId: warehouseId,
      vatEnabled: vat,
      discountAmountInput: discount,
      savedAt: Date.now(),
    });
    setHasRestoredDraft(true);
  }, []);

  const resetLocalUi = useCallback(() => {
    setIsAddingCustomer(false);
    setNewCustomerName('');
    setNewCustomerPhone('');
    setCustomerPickerOpen(false);
    setProductPickerOpenByRow({});
    setProductSearchByRow({});
  }, []);

  const clearDraftAndForm = useCallback(() => {
    skipNextPersistRef.current = true;
    clearShopSaleDraft();
    reset(EMPTY_FORM);
    setSelectedWarehouseId('');
    setVatEnabled(false);
    setDiscountAmountInput(0);
    setHasRestoredDraft(false);
    resetLocalUi();
  }, [reset, resetLocalUi]);

  // Restore draft when dialog opens; keep it when closed (until Complete Sale).
  useEffect(() => {
    if (!open) {
      draftHydratedRef.current = false;
      resetLocalUi();
      return;
    }
    if (draftHydratedRef.current) return;
    draftHydratedRef.current = true;

    const draft = readShopSaleDraft();
    if (!draft) {
      setHasRestoredDraft(false);
      return;
    }

    skipNextPersistRef.current = true;
    reset({
      ...EMPTY_FORM,
      ...draft.form,
      items:
        draft.form.items?.length > 0
          ? draft.form.items.map((item) => ({
              product_id: String(item.product_id || ''),
              quantity: Number(item.quantity) || 1,
              unit_price: Number(item.unit_price) || 0,
            }))
          : EMPTY_FORM.items,
    });
    setSelectedWarehouseId(String(draft.selectedWarehouseId || draft.form.warehouse_id || ''));
    setVatEnabled(Boolean(draft.vatEnabled));
    setDiscountAmountInput(Number(draft.discountAmountInput) || 0);
    setHasRestoredDraft(true);
  }, [open, reset, resetLocalUi]);

  // Auto-update paid amount for cash
  useEffect(() => {
    if (paymentType === 'cash') {
      setValue('paid_amount', totalAmount, { shouldDirty: true });
    }
  }, [paymentType, totalAmount, setValue]);

  // Autosave draft while editing; also flush if the page unmounts while open.
  useEffect(() => {
    if (!open) return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      persistDraft(getValues(), selectedWarehouseId, vatEnabled, discountAmountInput);
    }, 300);
    return () => {
      window.clearTimeout(timer);
      if (!skipNextPersistRef.current) {
        persistDraft(getValues(), selectedWarehouseId, vatEnabled, discountAmountInput);
      }
    };
  }, [open, watchedForm, selectedWarehouseId, vatEnabled, discountAmountInput, persistDraft, getValues]);

  // Flush draft only on open → closed (never on initial mount).
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    persistDraft(getValues(), selectedWarehouseId, vatEnabled, discountAmountInput);
  }, [open, persistDraft, getValues, selectedWarehouseId, vatEnabled, discountAmountInput]);

  const createCustomerMutation = useMutation({
    mutationFn: (data: { name: string; phone?: string }) => customerService.create(data),
    onSuccess: (created: any) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setValue('customer_id', String(created?.id || ''));
      setValue('customer_name', created?.name || newCustomerName);
      setIsAddingCustomer(false);
      setNewCustomerName('');
      setNewCustomerPhone('');
      toast.success(isAr ? 'تم إضافة العميل' : 'Customer added');
    },
    onError: () => toast.error(isAr ? 'فشل إضافة العميل' : 'Failed to add customer'),
  });

  const handleProductSelect = (index: number, productId: string) => {
    setValue(`items.${index}.product_id`, productId);
    const stockInfo = warehouseStockMap?.get(String(productId));
    const product = allProducts.find((p: any) => String(p.id) === productId);
    const price = stockInfo?.sellingPrice || Number(product?.selling_price || 0);
    if (price) setValue(`items.${index}.unit_price`, price);
  };

  const selectedCustomer = useMemo(() => {
    const cid = watch('customer_id');
    return customers.find((c: any) => String(c.id) === cid);
  }, [watch('customer_id'), customers]);

  // Auto-fill phone/address from selected customer (still editable)
  useEffect(() => {
    const phone = String((selectedCustomer as any)?.phone || '').trim();
    const addr = String((selectedCustomer as any)?.address || '').trim();
    if (phone) setValue('customer_phone', phone, { shouldDirty: true });
    if (addr) setValue('shipping_address', addr, { shouldDirty: true });
  }, [selectedCustomer, setValue]);

  const onSubmit = (data: FormData) => {
    if (!data.warehouse_id) {
      toast.error(isAr ? 'اختر المستودع أولاً' : 'Please select a warehouse');
      return;
    }
    if (data.items.some(item => !item.product_id || item.quantity <= 0)) {
      toast.error(isAr ? 'تحقق من بنود الطلب' : 'Please check order items');
      return;
    }
    if (totalAmount <= 0) {
      toast.error(isAr ? 'الإجمالي لا يمكن أن يكون صفراً' : 'Total cannot be zero');
      return;
    }

    const cid = String(data.customer_id || '').trim();
    createOrder.mutate({
      order_number: `SHOP-${Date.now().toString(36).toUpperCase()}`,
      warehouse_id: data.warehouse_id,
      credit_warehouse_id: data.warehouse_id,
      fulfillment_warehouse_id: data.warehouse_id,
      ...(cid ? { customer_id: cid } : {}),
      customer_name: (selectedCustomer as any)?.name || data.customer_name || (isAr ? 'عميل مباشر' : 'Walk-in'),
      customer_phone: String(data.customer_phone || (selectedCustomer as any)?.phone || '').trim() || undefined,
      shipping_address: String(data.shipping_address || (selectedCustomer as any)?.address || '').trim() || undefined,
      notes: String(data.notes || '').trim() || undefined,
      marketplace_source: 'direct',
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
        toast.success(isAr ? '✅ تم إنشاء طلب البيع' : '✅ Sale created successfully');
        clearDraftAndForm();
        onOpenChange(false);
      },
    });
  };

  const handlePrint = () => {
    const data = getValues();
    const invoiceNo = `SHOP-${Date.now().toString(36).toUpperCase()}`;
    const wh = (warehouses || []).find((w: any) => String(w.id) === String(selectedWarehouseId || data.warehouse_id));
    const customerName =
      (selectedCustomer as any)?.name || data.customer_name || (isAr ? 'عميل مباشر' : 'Walk-in');
    const customerPhone = String(data.customer_phone || (selectedCustomer as any)?.phone || '').trim();
    const customerAddress = String(data.shipping_address || (selectedCustomer as any)?.address || '').trim();
    const note = String(data.notes || '').trim();
    const items = data.items.map((item) => {
      const product = allProducts.find((p: any) => String(p.id) === item.product_id);
      const stockInfo = warehouseStockMap?.get(item.product_id);
      const lineTotal = Number(item.quantity) * Number(item.unit_price);
      return {
        product_name: product?.internal_name || product?.name || '—',
        sku: stockInfo?.skuCode || '—',
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: lineTotal,
      };
    });
    const orderPayload = {
      order_number: invoiceNo,
      created_at: new Date().toISOString(),
      customer_name: customerName,
      customer_phone: customerPhone || undefined,
      shipping_address: customerAddress || undefined,
      notes: note || undefined,
      warehouse_name: wh?.name || '—',
      payment_type: data.payment_type,
      total_amount: totalAmount,
      subtotal: subtotalAmount,
      tax_amount: taxAmount,
      discount_amount: discountAmount,
      paid_amount: paidAmount,
      remaining_amount: remainingAmount,
      items,
    };
    const payLabel = isAr ? 'طريقة الدفع' : 'Payment';
    const printed = printSalesInvoiceProfessional({
      rtl: isAr,
      branding: getDefaultPrintBranding(),
      order: orderPayload,
      metaExtraLine: `${payLabel}: ${String(data.payment_type || '—')}`,
      labels: {
        title: isAr ? 'فاتورة مبيعات' : 'Sales invoice',
        invoiceNo: isAr ? 'رقم الفاتورة' : 'Invoice no.',
        date: isAr ? 'التاريخ' : 'Date',
        customer: isAr ? 'العميل' : 'Customer',
        warehouse: isAr ? 'المستودع' : 'Warehouse',
        hash: '#',
        product: isAr ? 'المنتج' : 'Product',
        qty: isAr ? 'الكمية' : 'Qty',
        unitPrice: isAr ? 'سعر الوحدة' : 'Unit price',
        lineTotal: isAr ? 'الإجمالي' : 'Line total',
        subtotal: isAr ? 'الإجمالي الفرعي' : 'Subtotal',
        discount: isAr ? 'الخصم' : 'Discount',
        tax: isAr ? 'الضريبة' : 'Tax',
        grandTotal: isAr ? 'الإجمالي الكلي' : 'Grand total',
        notes: isAr ? 'ملاحظات' : 'Notes',
        receivedBy: isAr ? 'المستلم / المحاسب' : 'Received by',
        secondSign: isAr ? 'اعتماد العميل' : 'Customer acknowledgment',
        paid: isAr ? 'المدفوع' : 'Paid',
        remaining: isAr ? 'المتبقي' : 'Remaining',
        accountPrevious: isAr ? 'الحساب السابق' : 'Previous balance',
        accountPreviousHint: isAr ? '(غير متاح)' : '(n/a)',
      },
    });
    if (!printed) {
      toast.error(isAr ? 'تعذر فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة.' : 'Could not open print window — allow popups for this site.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'fixed inset-0 left-0 top-0 z-50 flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0',
          'flex-col gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none sm:rounded-none',
          'data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100',
          'data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-top-0',
          'data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0',
        )}
      >
        {/* Colorful Header */}
        <div className="shrink-0 bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-4 text-white sm:px-6 sm:py-5">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-white flex flex-wrap items-center gap-2 text-xl font-bold sm:text-2xl">
              <ShoppingCart className="w-6 h-6" />
              {isAr ? '🛒 بيع المحل' : '🛒 Shop Sale'}
              {hasRestoredDraft && (
                <Badge className="bg-white/20 text-white border-white/30 font-normal text-xs">
                  {isAr ? 'مسودة محفوظة' : 'Draft saved'}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription className="text-emerald-100 text-sm">
              {isAr
                ? 'مبيعات مباشرة من المحل — الفاتورة تُحفظ تلقائياً حتى تضغط إتمام البيع'
                : 'Quick shop sale — draft autosaves until you complete the sale'}
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-5 sm:px-6 sm:py-5">

          {/* Row 1: Warehouse + Customer */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Warehouse */}
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-emerald-700">{isAr ? '🏪 المستودع' : '🏪 Warehouse'}</Label>
              <Select
                value={selectedWarehouseId}
                onValueChange={(val) => {
                  setSelectedWarehouseId(val);
                  setValue('warehouse_id', val);
                  fields.forEach((_, i) => setValue(`items.${i}.product_id`, ''));
                  setProductSearchByRow({});
                }}
              >
                <SelectTrigger className="border-emerald-200 focus:ring-emerald-400">
                  <SelectValue placeholder={isAr ? 'اختر المحل / المستودع' : 'Select warehouse'} />
                </SelectTrigger>
                <SelectContent>
                  {(warehouses || []).filter((w: any) => w?.is_active !== false).map((w: any) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedWarehouseId && (
                <p className="text-xs text-muted-foreground">
                  {loadingInventory ? (isAr ? 'جارٍ تحميل...' : 'Loading...') : `${availableProducts.length} ${isAr ? 'صنف متاح' : 'items in stock'}`}
                </p>
              )}
            </div>

            {/* Customer */}
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-emerald-700">{isAr ? '👤 العميل' : '👤 Customer'}</Label>
              {!isAddingCustomer ? (
                <div className="flex gap-2">
                  <Popover open={customerPickerOpen} onOpenChange={setCustomerPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" className="flex-1 justify-between border-emerald-200" role="combobox">
                        <span className="truncate">
                          {(selectedCustomer as any)?.name || watch('customer_name') || (isAr ? 'اختر العميل...' : 'Select customer...')}
                        </span>
                        <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[260px] p-0">
                      <Command>
                        <CommandInput placeholder={isAr ? 'ابحث عن عميل...' : 'Search customer...'} />
                        <CommandList>
                          <CommandEmpty>
                            <div className="py-2 text-center">
                              <p className="text-sm text-muted-foreground">{isAr ? 'لا يوجد عميل' : 'No customer found'}</p>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="mt-1 text-emerald-600"
                                onClick={() => { setIsAddingCustomer(true); setCustomerPickerOpen(false); }}
                              >
                                <UserPlus className="w-3 h-3 mr-1" />
                                {isAr ? 'تسجيل عميل جديد' : 'Add New Customer'}
                              </Button>
                            </div>
                          </CommandEmpty>
                          <CommandGroup>
                            {/* Walk-in option */}
                            <CommandItem
                              value="walk-in"
                              onSelect={() => {
                                setValue('customer_id', '');
                                setValue('customer_name', isAr ? 'عميل مباشر' : 'Walk-in');
                                setCustomerPickerOpen(false);
                              }}
                            >
                              <Check className={cn('mr-2 h-4 w-4', !watch('customer_id') ? 'opacity-100' : 'opacity-0')} />
                              <span className="text-muted-foreground">{isAr ? 'بدون عميل (مباشر)' : 'Walk-in (no customer)'}</span>
                            </CommandItem>
                            {customers.map((c: any) => (
                              <CommandItem
                                key={c.id}
                                value={`${c.name} ${c.phone || ''}`}
                                onSelect={() => {
                                  setValue('customer_id', String(c.id));
                                  setValue('customer_name', c.name);
                                  setCustomerPickerOpen(false);
                                }}
                              >
                                <Check className={cn('mr-2 h-4 w-4', watch('customer_id') === String(c.id) ? 'opacity-100' : 'opacity-0')} />
                                <div>
                                  <div className="font-medium">{c.name}</div>
                                  {c.phone && <div className="text-xs text-muted-foreground">{c.phone}</div>}
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                    onClick={() => setIsAddingCustomer(true)}
                    title={isAr ? 'إضافة عميل جديد' : 'Add new customer'}
                  >
                    <UserPlus className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="border border-emerald-300 rounded-md p-3 bg-emerald-50/50 space-y-2">
                  <p className="text-xs font-semibold text-emerald-700">{isAr ? 'تسجيل عميل جديد' : 'Add New Customer'}</p>
                  <Input
                    placeholder={isAr ? 'اسم العميل *' : 'Customer name *'}
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <Input
                    placeholder={isAr ? 'رقم الهاتف (اختياري)' : 'Phone (optional)'}
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 h-7 text-xs"
                      disabled={!newCustomerName.trim() || createCustomerMutation.isPending}
                      onClick={() => createCustomerMutation.mutate({ name: newCustomerName.trim(), phone: newCustomerPhone.trim() || undefined })}
                    >
                      {createCustomerMutation.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                      {isAr ? 'حفظ' : 'Save'}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setIsAddingCustomer(false)}>
                      {isAr ? 'إلغاء' : 'Cancel'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Payment Section */}
          <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">{isAr ? 'طريقة الدفع' : 'Payment'}</Label>
              <Select value={paymentType} onValueChange={(val: 'cash' | 'credit') => setValue('payment_type', val)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">{isAr ? '💵 كاش' : '💵 Cash'}</SelectItem>
                  <SelectItem value="credit">{isAr ? '📋 آجل' : '📋 Credit'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">{isAr ? 'تم دفع' : 'Paid'}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                disabled={paymentType === 'cash'}
                className="h-8 text-sm"
                {...register('paid_amount', { valueAsNumber: true })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">{isAr ? 'المتبقي' : 'Remaining'}</Label>
              <div className={cn('h-8 flex items-center px-3 rounded-md border text-sm font-mono font-bold',
                remainingAmount > 0 ? 'bg-red-50 text-red-600 border-red-200' : 'bg-green-50 text-green-600 border-green-200'
              )}>
                {remainingAmount.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Optional customer phone/address + invoice note */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">{isAr ? 'هاتف العميل (اختياري)' : 'Customer phone (optional)'}</Label>
              <Input
                className="h-8 text-sm"
                placeholder={isAr ? 'مثال: 0100…' : 'e.g. 0100…'}
                {...register('customer_phone')}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">{isAr ? 'عنوان العميل (اختياري)' : 'Customer address (optional)'}</Label>
              <Input
                className="h-8 text-sm"
                placeholder={isAr ? 'العنوان…' : 'Address…'}
                {...register('shipping_address')}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-semibold">{isAr ? 'ملاحظة على الفاتورة (اختياري)' : 'Invoice note (optional)'}</Label>
            <Textarea
              rows={2}
              placeholder={isAr ? 'تظهر في آخر الفاتورة قبل بيانات الشركة…' : 'Appears at the bottom before company footer…'}
              {...register('notes')}
            />
          </div>

          <Separator />

          {/* Items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-bold text-emerald-700">{isAr ? '🧾 بنود الطلب' : '🧾 Order Items'}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                onClick={() => append({ product_id: '', quantity: 1, unit_price: 0 })}
              >
                <Plus className="w-3 h-3 mr-1" />
                {isAr ? 'إضافة بند' : 'Add Item'}
              </Button>
            </div>

            {fields.map((field, index) => {
              const selectedId = watch(`items.${index}.product_id`) || '';
              const selectedProduct = allProducts.find((p: any) => String(p.id) === selectedId);
              const stockInfo = warehouseStockMap?.get(selectedId);
              return (
                <div key={field.id} className="flex gap-2 items-start bg-white dark:bg-slate-950 border rounded-lg p-2.5 shadow-sm">
                  {/* Product Picker */}
                  <div className="flex-1 min-w-0">
                    <Popover
                      open={!!productPickerOpenByRow[index]}
                      onOpenChange={(s) => setProductPickerOpenByRow(prev => ({ ...prev, [index]: s }))}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className={cn('w-full justify-between h-9 text-sm', !selectedId && 'text-muted-foreground')}
                          disabled={!selectedWarehouseId}
                        >
                          <span className="truncate">
                            {selectedProduct
                              ? formatProductLabel(selectedProduct)
                              : (selectedWarehouseId ? (isAr ? 'اختر المنتج...' : 'Select product...') : (isAr ? 'اختر المستودع أولاً' : 'Select warehouse first'))}
                          </span>
                          <ChevronsUpDown className="h-4 w-4 opacity-40 shrink-0" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[340px] p-0">
                        <Command shouldFilter={false}>
                          <CommandInput
                            placeholder={isAr ? 'ابحث بالاسم أو SKU أو باركود...' : 'Search name, SKU, barcode...'}
                            value={productSearchByRow[index] || ''}
                            onValueChange={(val) => setProductSearchByRow((prev) => ({ ...prev, [index]: val }))}
                          />
                          <CommandList>
                            <CommandEmpty>
                              {isAr
                                ? (selectedWarehouseId
                                  ? (loadingInventory ? 'جارٍ تحميل مخزون المحل...' : 'لا توجد نتائج / لا يوجد مخزون مطابق')
                                  : 'اختر المستودع أولاً')
                                : (selectedWarehouseId
                                  ? (loadingInventory ? 'Loading stock...' : 'No results / no matching stock')
                                  : 'Select warehouse first')}
                            </CommandEmpty>
                            <CommandGroup>
                              {availableProducts
                                .filter((p: any) => productMatchesSearch(p, warehouseStockMap?.get(String(p.id))?.skuCode, productSearchByRow[index] || ''))
                                .slice(0, 300)
                                .map((p: any) => {
                                const stock = warehouseStockMap?.get(String(p.id));
                                return (
                                  <CommandItem
                                    key={p.id}
                                    value={formatProductLabel(p)}
                                    onSelect={() => {
                                      handleProductSelect(index, String(p.id));
                                      setProductPickerOpenByRow(prev => ({ ...prev, [index]: false }));
                                    }}
                                  >
                                    <Check className={cn('mr-2 h-4 w-4 shrink-0', selectedId === String(p.id) ? 'opacity-100' : 'opacity-0')} />
                                    <span className="flex-1 truncate">{formatProductLabel(p)}</span>
                                    {stock && (
                                      <Badge variant="outline" className="ml-2 bg-green-50 text-green-700 border-green-200 text-xs font-mono shrink-0">
                                        {stock.available}
                                      </Badge>
                                    )}
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {selectedId && stockInfo && (
                      <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                        {isAr ? 'متاح:' : 'In stock:'} <span className="text-green-600 font-bold">{stockInfo.available}</span>
                        {stockInfo.skuCode && <span className="ml-2 opacity-60">{stockInfo.skuCode}</span>}
                      </p>
                    )}
                  </div>
                  {/* Qty */}
                  <div className="w-16 shrink-0">
                    <Input
                      type="number"
                      min="1"
                      max={stockInfo?.available}
                      className={cn('h-9 text-center text-sm font-bold',
                        stockInfo && Number(watch(`items.${index}.quantity`)) > stockInfo.available
                          ? 'border-red-400 text-red-600'
                          : ''
                      )}
                      {...register(`items.${index}.quantity`, { required: true, valueAsNumber: true, min: 1 })}
                    />
                  </div>
                  {/* Price */}
                  <div className="w-24 shrink-0">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      className="h-9 text-sm"
                      {...register(`items.${index}.unit_price`, { required: true, valueAsNumber: true })}
                    />
                  </div>
                  {/* Subtotal */}
                  <div className="w-20 shrink-0 flex items-center justify-end">
                    <span className="text-sm font-bold text-emerald-700">
                      {formatLatinNumber((items[index]?.quantity || 0) * (items[index]?.unit_price || 0))}
                    </span>
                  </div>
                  {/* Remove */}
                  {fields.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-destructive shrink-0" onClick={() => remove(index)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Total */}
          <div className="flex justify-end">
            <div className="bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-200 rounded-xl px-5 py-3 text-right">
              <div className="flex items-center justify-end gap-2 mb-2">
                <Checkbox
                  checked={vatEnabled}
                  onCheckedChange={(v) => setVatEnabled(Boolean(v))}
                  id="shop-sale-vat"
                />
                <Label htmlFor="shop-sale-vat" className="text-xs font-semibold text-emerald-800 cursor-pointer">
                  {isAr ? 'إضافة VAT 14%' : 'Add VAT 14%'}
                </Label>
              </div>
              <div className="flex items-center justify-end gap-2 mb-2">
                <Label className="text-xs font-semibold text-emerald-800">{isAr ? 'خصم' : 'Discount'}</Label>
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
              <p className="text-xs text-muted-foreground font-medium">{isAr ? 'الإجمالي' : 'Total'}</p>
              <p className="text-2xl font-black text-emerald-700">{formatLatinNumber(totalAmount)} <span className="text-base font-normal">{isAr ? 'ج.م' : 'EGP'}</span></p>
              {vatEnabled && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  {isAr ? 'ضريبة' : 'Tax'}: <span className="font-mono font-semibold">{formatLatinNumber(taxAmount)}</span>
                </p>
              )}
              {discountAmount > 0 && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  {isAr ? 'خصم' : 'Discount'}: <span className="font-mono font-semibold">{formatLatinNumber(discountAmount)}</span>
                </p>
              )}
            </div>
          </div>
          </div>

          <DialogFooter className="shrink-0 gap-2 border-t bg-background px-4 py-3 sm:px-6 sm:flex-row sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {isAr ? 'إغلاق (حفظ المسودة)' : 'Close (keep draft)'}
              </Button>
              {hasRestoredDraft && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    clearDraftAndForm();
                    toast.message(isAr ? 'تم مسح المسودة' : 'Draft cleared');
                  }}
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  {isAr ? 'مسح وابدأ من جديد' : 'Discard draft'}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                className="border-emerald-200 text-emerald-700 font-bold"
                onClick={handlePrint}
              >
                <Printer className="w-4 h-4 mr-2" />
                {isAr ? 'طباعة' : 'Print'}
              </Button>
              <Button
                type="submit"
                disabled={createOrder.isPending}
                className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold px-6"
              >
                {createOrder.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                <ShoppingCart className="w-4 h-4 mr-2" />
                {isAr ? 'إتمام البيع' : 'Complete Sale'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
