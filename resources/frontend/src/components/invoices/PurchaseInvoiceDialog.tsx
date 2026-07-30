import React, { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import axios from 'axios';
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
import { Check, ChevronsUpDown, PackageSearch, PlusCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { purchaseInvoiceService, productService, warehouseService as storeService, supplierService } from '@/lib/supabase-services';
import { useLanguage } from '@/contexts/LanguageContext';
import { fetchMergedLocationInventory } from '@/lib/warehouseInventoryFetch';
import api from '@/lib/api';
import { invalidateInventoryLiveQueries } from '@/lib/inventoryLiveQueries';
import {
    buildPickerRowFromChannelSku,
    matchesPickerQuery,
    skuMatchesSearchQuery,
    type PurchasePickerRow,
} from '@/lib/purchaseInvoicePickerUtils';

interface PurchaseInvoiceDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

type PurchaseInvoiceFormValues = {
    invoice_number: string;
    store_id: string;
    supplier_id: string;
    invoice_date: string;
    notes: string;
    payment_type: 'cash' | 'credit';
    paid_amount: number;
    items: Array<{
        product_id: string;
        sku_id: string | null;
        quantity: number;
        unit_price: number;
    }>;
};

export function PurchaseInvoiceDialog({ open, onOpenChange }: PurchaseInvoiceDialogProps) {
    const { language } = useLanguage();
    const isAr = language === 'ar';
    const queryClient = useQueryClient();
    const [productSearchByRow, setProductSearchByRow] = useState<Record<number, string>>({});
    const [isSupplierCreateOpen, setIsSupplierCreateOpen] = useState(false);
    const [isProductCreateOpen, setIsProductCreateOpen] = useState(false);
    const [targetRowIndex, setTargetRowIndex] = useState<number>(0);
    const [newSupplierName, setNewSupplierName] = useState('');
    const [newSupplierPhone, setNewSupplierPhone] = useState('');
    const [newProductName, setNewProductName] = useState('');
    const [newProductSku, setNewProductSku] = useState('');
    const [rowPickerOpen, setRowPickerOpen] = useState<Record<number, boolean>>({});
    const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
    /** When true for a row, selecting a product fills unit price from last purchase (same as hint above). */
    const [applyLastPurchasePriceByFieldId, setApplyLastPurchasePriceByFieldId] = useState<Record<string, boolean>>({});

    const { data: rawMasterProducts = [] } = useQuery({
        queryKey: ['master-products'],
        queryFn: () => productService.getAll(),
        enabled: open,
        staleTime: 0,
        refetchOnMount: 'always',
    });

    // Enrich master products with their first SKU for default selection if needed
    const masterProducts = useMemo(() => {
        return rawMasterProducts.map((p: any) => ({
            ...p,
            skus: p.offers?.flatMap((o: any) => o.skus || []) || [],
        }));
    }, [rawMasterProducts]);

    const { data: stores } = useQuery({
        queryKey: ['stores'],
        queryFn: () => storeService.getAll({ includeInactive: true }),
        enabled: open,
    });
    const { data: suppliers } = useQuery({
        queryKey: ['suppliers'],
        queryFn: () => supplierService.getAll(),
        enabled: open,
    });

    const buildDefaultValues = (): PurchaseInvoiceFormValues => ({
        invoice_number: `PUR-${Date.now()}`,
        store_id: '',
        supplier_id: '',
        invoice_date: new Date().toISOString().split('T')[0],
        notes: '',
        payment_type: 'credit',
        paid_amount: 0,
        items: [{ product_id: '', sku_id: null, quantity: 1, unit_price: 0 }],
    });

    const { register, control, handleSubmit, watch, setValue, reset, getValues } = useForm<PurchaseInvoiceFormValues>({
        defaultValues: buildDefaultValues(),
    });

    const selectedSupplier = useMemo(() => {
        const sid = String(watch('supplier_id') || '').trim();
        if (!sid) return null;
        return (suppliers || []).find((s: any) => String(s?.id) === sid) || null;
    }, [suppliers, watch('supplier_id')]);

    const { fields, append, remove } = useFieldArray({
        control,
        name: 'items'
    });

    const watchedStoreId = watch('store_id');
    const selectedStore = useMemo(
        () => (stores || []).find((s: any) => String(s.id) === String(watchedStoreId)),
        [stores, watchedStoreId]
    );

    const { data: storeInventoryRows = [], isLoading: loadingStoreInventory } = useQuery({
        queryKey: ['purchase-invoice-store-inventory', watchedStoreId, selectedStore?.channel_id],
        queryFn: () => fetchMergedLocationInventory(String(watchedStoreId), selectedStore?.channel_id ?? null),
        enabled: open && !!watchedStoreId,
    });

    const { data: storeChannelSkus = [] } = useQuery({
        queryKey: ['purchase-invoice-store-channel-skus', selectedStore?.channel_id],
        queryFn: async () => {
            const cid = selectedStore?.channel_id != null ? String(selectedStore.channel_id) : '';
            if (!cid) return [];
            return await api.getArray(`/skus?channel_id=${encodeURIComponent(cid)}`);
        },
        enabled: open && !!selectedStore?.channel_id,
        staleTime: 0,
        refetchOnMount: 'always',
    });

    const { data: pickerCatalogRaw = [] } = useQuery({
        queryKey: ['purchase-invoice-picker-catalog', watchedStoreId],
        queryFn: () => api.getArray('master-products?with_skus=1&limit=250'),
        enabled: open && !!watchedStoreId,
        staleTime: 0,
        refetchOnMount: 'always',
    });

    const [debouncedPickerSearch, setDebouncedPickerSearch] = useState('');
    useEffect(() => {
        if (!open) {
            setDebouncedPickerSearch('');
            return;
        }
        const openRowKey = Object.entries(rowPickerOpen).find(([, isOpen]) => isOpen)?.[0];
        const active =
            openRowKey != null
                ? (productSearchByRow[Number(openRowKey)] || '')
                : (Object.values(productSearchByRow).find((v) => String(v || '').trim().length > 0) || '');
        const t = window.setTimeout(() => setDebouncedPickerSearch(String(active).trim()), 280);
        return () => window.clearTimeout(t);
    }, [open, productSearchByRow, rowPickerOpen]);

    const pickerSearchQuery = debouncedPickerSearch.trim();
    const { data: channelSkuSearchHits = [] } = useQuery({
        queryKey: ['purchase-channel-sku-search', selectedStore?.channel_id, pickerSearchQuery],
        queryFn: async () => {
            const cid = selectedStore?.channel_id != null ? String(selectedStore.channel_id) : '';
            if (!cid || !pickerSearchQuery) return [];
            return api.getArray(
                `/skus?channel_id=${encodeURIComponent(cid)}&search=${encodeURIComponent(pickerSearchQuery)}`
            );
        },
        enabled: open && !!watchedStoreId && !!selectedStore?.channel_id && pickerSearchQuery.length >= 2,
        staleTime: 0,
    });
    const { data: pickerSearchRaw = [], isFetching: pickerSearchLoading } = useQuery({
        queryKey: ['purchase-picker-search', pickerSearchQuery, watchedStoreId, selectedStore?.channel_id],
        queryFn: async () => {
            const params = new URLSearchParams({
                search: pickerSearchQuery,
                limit: '80',
                with_skus: '1',
            });
            // Always search the full catalog; filter to this warehouse channel in the picker UI.
            return api.getArray(`master-products?${params.toString()}`);
        },
        enabled: open && !!watchedStoreId && pickerSearchQuery.length >= 2,
        staleTime: 0,
    });
    const pickerSearchProducts = useMemo(
        () => (pickerSearchRaw || []).map((p: any) => productService.transformMasterProduct(p)),
        [pickerSearchRaw]
    );

    const catalogProducts = useMemo(() => {
        const byId = new Map<string, any>();
        for (const p of masterProducts) {
            const id = String(p?.id ?? '').trim();
            if (id) byId.set(id, p);
        }
        for (const p of pickerCatalogRaw || []) {
            const id = String(p?.id ?? '').trim();
            if (id) byId.set(id, productService.transformMasterProduct(p));
        }
        for (const p of pickerSearchProducts) {
            const id = String(p?.id ?? '').trim();
            if (id) byId.set(id, p);
        }
        return Array.from(byId.values());
    }, [masterProducts, pickerCatalogRaw, pickerSearchProducts]);

    const storeAllowed = useMemo(() => {
        const skuIds = new Set<string>();
        const masterIds = new Set<string>();
        for (const r of storeInventoryRows) {
            const sid = String(r?.sku?.id ?? '').trim();
            if (sid) skuIds.add(sid);
            const mp = r?.sku?.offer?.master_product ?? r?.sku?.offer?.masterProduct;
            const mpid = mp?.id ?? r?.sku?.offer?.master_product_id;
            if (mpid != null && String(mpid).trim() !== '') masterIds.add(String(mpid));
        }
        for (const sk of (storeChannelSkus || [])) {
            const sid = String(sk?.id ?? '').trim();
            if (sid) skuIds.add(sid);
            const mpid =
                sk?.offer?.master_product_id ??
                sk?.offer?.masterProduct?.id ??
                sk?.offer?.master_product?.id ??
                null;
            if (mpid != null && String(mpid).trim() !== '') masterIds.add(String(mpid));
        }
        return { skuIds, masterIds };
    }, [storeInventoryRows, storeChannelSkus]);

    useEffect(() => {
        setProductSearchByRow({});
    }, [watchedStoreId]);

    useEffect(() => {
        if (!open) {
            setApplyLastPurchasePriceByFieldId({});
        }
    }, [open]);

    useEffect(() => {
        if (open) {
            // Fresh catalog + channel SKUs so products created on Master Products appear here.
            queryClient.invalidateQueries({ queryKey: ['master-products'] });
            queryClient.invalidateQueries({ queryKey: ['purchase-invoice-store-channel-skus'] });
            queryClient.invalidateQueries({ queryKey: ['purchase-picker-search'] });
        }
    }, [open, queryClient]);

    const mutation = useMutation({
        mutationFn: (data: any) => purchaseInvoiceService.create(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['purchase-invoices'] });
            queryClient.invalidateQueries({ queryKey: ['purchase-invoice-store-inventory'] });
            queryClient.invalidateQueries({ queryKey: ['purchase-invoice-store-channel-skus'] });
            queryClient.invalidateQueries({ queryKey: ['payments'] });
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            invalidateInventoryLiveQueries(queryClient, { scope: 'purchase', immediate: true });
            toast.success(isAr ? 'تم إنشاء فاتورة الشراء بنجاح' : 'Purchase invoice created successfully');
            onOpenChange(false);
            reset(buildDefaultValues());
            setProductSearchByRow({});
            setApplyLastPurchasePriceByFieldId({});
        },
        onError: (error: any) => {
            if (axios.isAxiosError(error)) {
                const rawMessage = error.response?.data?.message;
                const apiMessage = typeof rawMessage === 'string' && !rawMessage.includes('<!DOCTYPE')
                    ? rawMessage
                    : null;
                const validationErrors = error.response?.data?.errors;
                if (validationErrors && typeof validationErrors === 'object') {
                    const firstError = Object.values(validationErrors).flat()[0];
                    toast.error(String(firstError));
                    return;
                }
                if (apiMessage) {
                    toast.error(apiMessage);
                    return;
                }
            }
            toast.error(error.message || (isAr ? 'فشل إنشاء فاتورة الشراء' : 'Failed to create purchase invoice'));
        }
    });

    const createSupplierMutation = useMutation({
        mutationFn: (data: { name: string; phone?: string }) => supplierService.create(data),
        onSuccess: (created: any) => {
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            const supplierId = String(created?.id || '');
            if (supplierId) {
                setValue('supplier_id', supplierId);
            }
            setNewSupplierName('');
            setNewSupplierPhone('');
            setIsSupplierCreateOpen(false);
            toast.success(isAr ? 'تم إضافة المورد' : 'Supplier added');
        },
        onError: (error: any) => {
            toast.error(error?.message || (isAr ? 'فشل إضافة المورد' : 'Failed to add supplier'));
        },
    });

    const createProductMutation = useMutation({
        mutationFn: async (data: { name: string; sku?: string }) => {
            // Create master product + default offer + default SKU (backend does the hierarchy).
            // Important: use the same channel scope as the selected store (if linked), so SKU matching works.
            const storeType = String((selectedStore as any)?.type || '').trim().toLowerCase();
            const allowStoreChannelFallback =
                selectedStore?.channel_id == null && ['physical', 'shop', 'store'].includes(storeType);
            const listingChannelId =
                selectedStore?.channel_id != null
                    ? selectedStore.channel_id
                    : allowStoreChannelFallback
                      ? 1
                      : null;

            return await productService.create({
                internal_name: data.name,
                sku: data.sku || null,
                channel_id: listingChannelId,
                create_default_listing: true,
            });
        },
        onSuccess: (created: any) => {
            queryClient.invalidateQueries({ queryKey: ['master-products'] });
            queryClient.invalidateQueries({ queryKey: ['purchase-picker-search'] });
            queryClient.invalidateQueries({ queryKey: ['purchase-invoice-store-inventory'] });
            queryClient.invalidateQueries({ queryKey: ['purchase-invoice-store-channel-skus'] });
            const productId = String(created?.id || '');
            const createdName = String(created?.internal_name || created?.name || '').trim();
            if (createdName) {
                setProductSearchByRow((prev) => ({ ...prev, [targetRowIndex]: createdName }));
            }
            const defaultSkuId = created?.offers?.[0]?.skus?.[0]?.id != null
                ? String(created.offers[0].skus[0].id)
                : null;
            if (productId) {
                setValue(`items.${targetRowIndex}.product_id`, productId);
            }
            if (defaultSkuId) {
                setValue(`items.${targetRowIndex}.sku_id`, defaultSkuId);
            }
            setNewProductName('');
            setNewProductSku('');
            setIsProductCreateOpen(false);
            toast.success(isAr ? 'تم إضافة المنتج بنجاح' : 'Product added successfully');
        },
        onError: (error: any) => {
            toast.error(error?.response?.data?.message || (isAr ? 'فشل إضافة المنتج' : 'Failed to add product'));
        },
    });

    const ensureStoreListingSku = async (masterProductId: string, storeId: string): Promise<string | null> => {
        try {
            const res = await api.post<{ sku_id?: number | string }>(
                `master-products/${masterProductId}/ensure-channel-listing`,
                { location_id: storeId }
            );
            const skuId = res?.sku_id != null ? String(res.sku_id) : null;
            if (skuId) {
                queryClient.invalidateQueries({ queryKey: ['purchase-invoice-store-channel-skus'] });
                queryClient.invalidateQueries({ queryKey: ['purchase-invoice-store-inventory'] });
            }
            return skuId;
        } catch (error: any) {
            toast.error(
                error?.response?.data?.message ||
                    (isAr ? 'تعذّر ربط المنتج بقائمة هذا المحل' : 'Could not link product to this store listing')
            );
            return null;
        }
    };

    const onSubmit = async (data: PurchaseInvoiceFormValues) => {
        if (!data.supplier_id) {
            toast.error(isAr ? 'يرجى اختيار المورد' : 'Please select a supplier');
            return;
        }
        if (!data.store_id) {
            toast.error(isAr ? 'يرجى اختيار المستودع' : 'Please select a warehouse');
            return;
        }
        if (!Array.isArray(data.items) || data.items.length === 0) {
            toast.error(isAr ? 'يرجى إضافة بند واحد على الأقل' : 'Please add at least one item');
            return;
        }

        const invalidItemIndex = data.items.findIndex((item) => (
            !item.product_id || Number(item.quantity) <= 0 || Number(item.unit_price) < 0
        ));

        if (invalidItemIndex !== -1) {
            toast.error(
                isAr
                    ? `تحقق من بيانات البند رقم ${invalidItemIndex + 1}`
                    : `Please check item #${invalidItemIndex + 1}`
            );
            return;
        }

        const itemsToSave = [...data.items];
        for (let i = 0; i < itemsToSave.length; i++) {
            const item = itemsToSave[i];
            if (item.sku_id || !item.product_id) continue;
            const skuId = await ensureStoreListingSku(String(item.product_id), String(data.store_id));
            if (!skuId) {
                toast.error(
                    isAr
                        ? `البند رقم ${i + 1}: لم يُنشأ SKU لهذا المحل. اختر المنتج من القائمة أو أنشئ قائمة على القناة.`
                        : `Line #${i + 1}: could not create a store SKU for this product.`
                );
                return;
            }
            itemsToSave[i] = { ...item, sku_id: skuId };
            setValue(`items.${i}.sku_id`, skuId);
        }

        const totalAmount = data.items.reduce((sum, item) => {
            const qty = Number(item.quantity || 0);
            const unit = Number(item.unit_price || 0);
            return sum + (qty * unit);
        }, 0);
        if (totalAmount <= 0) {
            toast.error(isAr ? 'لا يمكن حفظ فاتورة بإجمالي صفر' : 'Cannot save an empty invoice with zero total');
            return;
        }

        const paidAmount = Math.max(0, Number(data.paid_amount || 0));
        if (paidAmount > totalAmount) {
            toast.error(isAr ? 'المبلغ المدفوع أكبر من إجمالي الفاتورة' : 'Paid amount cannot exceed invoice total');
            return;
        }

        const remainingAmount = Math.max(0, totalAmount - paidAmount);
        const paymentStatus = paidAmount >= totalAmount && totalAmount > 0
            ? 'paid'
            : paidAmount > 0
                ? 'partially_paid'
                : (data.payment_type === 'credit' ? 'confirmed' : 'pending');
        const paymentMetaLine = `[PAYMENT] type=${data.payment_type}; paid=${paidAmount.toFixed(2)}; remaining=${remainingAmount.toFixed(2)}; status=${paymentStatus}`;
        const cleanNotes = String(data.notes || '')
            .split('\n')
            .filter((line) => !line.trim().startsWith('[PAYMENT]'))
            .join('\n')
            .trim();

        mutation.mutate({
            ...data,
            items: itemsToSave,
            total_amount: totalAmount,
            remaining_amount: remainingAmount,
            payment_status: paymentStatus,
            notes: [cleanNotes, paymentMetaLine].filter(Boolean).join('\n'),
        });
    };

    const productsList = masterProducts;

    const normalizePlace = (raw: any) => String(raw || '').trim().toLowerCase();
    const placeChipClass = (place: string) => {
        const p = normalizePlace(place);
        if (p.includes('amazon') || p.includes('امازون') || p.includes('أمازون')) {
            return 'bg-orange-500/15 text-orange-700 dark:text-orange-300';
        }
        if (p.includes('noon') || p.includes('نون')) {
            return 'bg-yellow-400/20 text-yellow-800 dark:text-yellow-300';
        }
        if (p.includes('jumia') || p.includes('جوميا')) {
            return 'bg-amber-600/15 text-amber-900 dark:text-amber-300';
        }
        if (p.includes('shop') || p.includes('store') || p.includes('physical') || p.includes('المحل') || p.includes('متجر')) {
            return 'bg-emerald-600/15 text-emerald-800 dark:text-emerald-300';
        }
        return 'bg-slate-600/10 text-slate-700 dark:text-slate-300';
    };

    const appendScopedChannelSku = (
        dedup: Map<string, PurchasePickerRow>,
        allItems: PurchasePickerRow[],
        sk: any,
        storeChannelId: string | null,
        storeName: string,
        allowStoreChannelFallback: boolean,
        mainStoreChannelId: string
    ) => {
        const sid = String(sk?.id ?? '').trim();
        if (!sid || dedup.has(sid)) return;
        const skuChannel = sk?.channel_id != null ? String(sk.channel_id) : null;
        if (storeChannelId !== null && skuChannel !== storeChannelId) return;
        if (storeChannelId === null && skuChannel !== null && !(allowStoreChannelFallback && skuChannel === mainStoreChannelId)) {
            return;
        }
        const row = buildPickerRowFromChannelSku(sk, storeName, isAr);
        if (!row) return;
        dedup.set(sid, row);
        allItems.push(row);
    };

    const getFilteredSearchItems = (index: number) => {
        const query = (productSearchByRow[index] || '').trim().toLowerCase();

        const allItems: Array<{
            id: string;
            master_id: string;
            sku_id: string | null;
            sku_code: string;
            label: string;
            sub: string;
            place?: string;
            price: number;
            type: 'sku' | 'product';
        }> = [];
        const storeChannelId = selectedStore?.channel_id != null ? String(selectedStore.channel_id) : null;
        const storeName = String(selectedStore?.name || '').trim();
        const storeType = String((selectedStore as any)?.type || '').trim().toLowerCase();
        const allowStoreChannelFallback = storeChannelId === null && ['physical', 'shop', 'store'].includes(storeType);
        const mainStoreChannelId = '1';
        const isSkuInSelectedScope = (skuChannelId: any): boolean => {
            const ch = skuChannelId != null && String(skuChannelId).trim() !== '' ? String(skuChannelId) : null;
            if (storeChannelId !== null) return ch === storeChannelId;
            // Legacy physical warehouses may not have channel_id but still use the main store channel SKU (id=1).
            if (allowStoreChannelFallback && ch === mainStoreChannelId) return true;
            return ch === null;
        };

        // When a warehouse is selected, list channel SKUs + inventory + masters not yet listed on this store.
        if (watchedStoreId) {
            const dedup = new Map<string, any>();
            for (const r of storeInventoryRows || []) {
                const sku = r?.sku;
                const skuId = sku?.id != null ? String(sku.id) : '';
                if (!skuId) continue;
                if (dedup.has(skuId)) continue;
                if (!isSkuInSelectedScope(sku?.channel_id)) continue;

                const mp = sku?.offer?.master_product ?? sku?.offer?.masterProduct ?? null;
                const mpId = mp?.id ?? sku?.offer?.master_product_id ?? null;
                const masterId = mpId != null ? String(mpId) : '';
                if (!masterId) continue; // invoice requires a master product id

                const mpName = String(mp?.internal_name || '');
                const skuCode = String(sku?.sku || sku?.sku_code || '').trim();
                const label =
                    mpName && skuCode && skuCode.toLowerCase() !== mpName.toLowerCase()
                        ? `${mpName} — ${skuCode}`
                        : (skuCode || mpName || String(sku?.name || '').trim());
                const channelName = String(sku?.channel?.name || '').trim();
                const place = channelName || storeName || (isAr ? 'المستودع المحدد' : 'Selected warehouse');
                const sub = [mpName || String(sku?.name || ''), place].filter(Boolean).join(' • ');
                const price = Number(sku?.cost_price ?? 0);

                dedup.set(skuId, {
                    id: `s-${skuId}`,
                    master_id: masterId,
                    sku_id: skuId,
                    sku_code: skuCode,
                    label,
                    sub,
                    place,
                    price,
                    type: 'sku',
                    skuChannelId: sku?.channel_id != null ? String(sku.channel_id) : null,
                });
            }
            dedup.forEach((v) => allItems.push(v));

            for (const sk of storeChannelSkus || []) {
                appendScopedChannelSku(dedup, allItems, sk, storeChannelId, storeName, allowStoreChannelFallback, mainStoreChannelId);
            }

            const byNewest = [...catalogProducts].sort((a: any, b: any) => {
                const aa = new Date(a?.created_at || a?.createdAt || 0).getTime();
                const bb = new Date(b?.created_at || b?.createdAt || 0).getTime();
                return bb - aa;
            });
            let addedSkus = 0;
            for (const p of byNewest) {
                if (addedSkus >= 120) break;
                const pId = String(p?.id ?? '').trim();
                if (!pId) continue;
                const pName = String(p?.internal_name || p?.name || '').trim();
                const pSkus = Array.isArray(p?.skus) ? p.skus : [];
                const nameHit = !query || pName.toLowerCase().includes(query);
                for (const s of pSkus) {
                    if (addedSkus >= 120) break;
                    const sid = String(s?.id ?? '').trim();
                    if (!sid || dedup.has(sid)) continue;
                    const skuChannel = s?.channel_id != null ? String(s.channel_id) : null;
                    if (!isSkuInSelectedScope(skuChannel)) continue;
                    const skuCode = String(s?.sku || s?.sku_code || '').trim().toLowerCase();
                    const skuHit = !query || skuCode.includes(query) || String(s?.name || '').toLowerCase().includes(query);
                    if (!nameHit && !skuHit) continue;
                    appendScopedChannelSku(
                        dedup,
                        allItems,
                        { ...s, offer: s.offer || { master_product: { id: pId, internal_name: pName } } },
                        storeChannelId,
                        storeName,
                        allowStoreChannelFallback,
                        mainStoreChannelId
                    );
                    addedSkus++;
                }
            }

            const mastersAlreadyListed = new Set(
                allItems.filter((it) => it.type === 'sku' && it.master_id).map((it) => String(it.master_id))
            );
            for (const sk of storeChannelSkus || []) {
                const mp = sk?.offer?.master_product ?? sk?.offer?.masterProduct;
                const mpid = mp?.id ?? sk?.offer?.master_product_id;
                if (mpid != null && String(mpid).trim() !== '') {
                    mastersAlreadyListed.add(String(mpid));
                }
            }

            let unlistedAdded = 0;
            const unlistedCap = query ? 60 : 30;
            for (const p of byNewest) {
                if (unlistedAdded >= unlistedCap) break;
                const pId = String(p?.id ?? '').trim();
                if (!pId) continue;
                if (mastersAlreadyListed.has(pId)) continue;
                const pName = String(p?.internal_name || p?.name || '').trim();
                const pSkus = Array.isArray(p?.skus) ? p.skus : [];
                const hasScopedSku = pSkus.some((s: any) => isSkuInSelectedScope(s?.channel_id));
                if (hasScopedSku) continue;
                if (query && !pName.toLowerCase().includes(query)) continue;
                const key = `p-${pId}`;
                if (dedup.has(key)) continue;
                dedup.set(key, true);
                allItems.push({
                    id: key,
                    master_id: pId,
                    sku_id: null,
                    sku_code: '',
                    label: pName,
                    sub: isAr
                        ? 'بدون قائمة على المحل — يُنشأ SKU عند حفظ الفاتورة'
                        : 'No store listing yet — SKU created when you save the invoice',
                    place: storeName || (isAr ? 'المستودع المحدد' : 'Selected warehouse'),
                    price: Number(p?.cost_price ?? p?.last_purchase_price ?? 0),
                    type: 'product',
                });
                unlistedAdded++;
            }
        } else {
            // Fallback to global master-products list
            catalogProducts.forEach((p: any) => {
                const pName = String(p.internal_name || p.name || '');
                const pId = String(p.id);
                const pSkus = p.skus || [];

                // Add all its SKUs
                pSkus.forEach((s: any) => {
                    const channelName = String(s?.channel?.name || '').trim();
                    const skuChannel = s?.channel_id != null ? String(s.channel_id) : null;
                    const place = watchedStoreId
                        ? (channelName || storeName || (isAr ? 'المستودع المحدد' : 'Selected warehouse'))
                        : (channelName || (isAr ? 'بدون قناة' : 'No channel'));
                    allItems.push({
                        id: `s-${s.id}`,
                        master_id: pId,
                        sku_id: String(s.id),
                        sku_code: String(s.sku || s.sku_code || '').trim(),
                        label: s.sku || s.name || pName,
                        sub: [pName, place].filter(Boolean).join(' • '),
                        place,
                        price: Number(s.cost_price || p.cost_price || 0),
                        type: 'sku'
                    });
                });

                // Only add the master product if it has NO skus yet
                if (pSkus.length === 0) {
                    allItems.push({
                        id: `p-${pId}`,
                        master_id: pId,
                        sku_id: null,
                        label: pName,
                        sub: isAr ? 'منتج رئيسي (بدون SKU)' : 'Master Product (No SKU)',
                        price: Number(p.cost_price || 0),
                        type: 'product'
                    });
                }
            });
        }

        const channelSkuIdSet = new Set(
            (storeChannelSkus || []).map((sk: any) => String(sk?.id ?? '').trim()).filter(Boolean)
        );

        const isPickerItemAllowed = (item: PurchasePickerRow) => {
            if (item.type === 'product') return true;
            if (!item.sku_id) return false;
            const sid = String(item.sku_id);
            if (channelSkuIdSet.has(sid)) return true;
            if (storeAllowed.skuIds.has(sid)) return true;
            return isSkuInSelectedScope(item.skuChannelId);
        };

        const scoped = watchedStoreId ? allItems.filter(isPickerItemAllowed) : allItems;

        if (!query) return scoped.slice(0, 100);

        const byKey = new Map<string, PurchasePickerRow>();
        const addRow = (row: PurchasePickerRow | null) => {
            if (!row || !isPickerItemAllowed(row) || !matchesPickerQuery(row, query)) return;
            byKey.set(row.id, row);
        };

        for (const sk of storeChannelSkus || []) {
            if (!skuMatchesSearchQuery(sk, query)) continue;
            addRow(buildPickerRowFromChannelSku(sk, storeName, isAr));
        }
        for (const sk of channelSkuSearchHits || []) {
            if (!skuMatchesSearchQuery(sk, query)) continue;
            addRow(buildPickerRowFromChannelSku(sk, storeName, isAr));
        }

        const searchCatalog =
            pickerSearchProducts.length > 0 ? pickerSearchProducts : catalogProducts;
        for (const p of searchCatalog) {
            const pName = String(p?.internal_name || p?.name || '').trim();
            const pId = String(p?.id ?? '').trim();
            if (!pId) continue;
            for (const s of Array.isArray(p?.skus) ? p.skus : []) {
                addRow(
                    buildPickerRowFromChannelSku(
                        { ...s, offer: s.offer || { master_product: { id: pId, internal_name: pName } } },
                        storeName,
                        isAr
                    )
                );
            }
        }

        for (const it of scoped) {
            if (matchesPickerQuery(it, query)) {
                byKey.set(it.id, it);
            }
        }

        const mastersWithSkuRow = new Set(
            Array.from(byKey.values())
                .filter((r) => r.type === 'sku' && r.master_id)
                .map((r) => String(r.master_id))
        );
        for (const p of searchCatalog) {
            const pId = String(p?.id ?? '').trim();
            if (!pId || mastersWithSkuRow.has(pId)) continue;
            const pName = String(p?.internal_name || p?.name || '').trim();
            if (!pName.toLowerCase().includes(query)) continue;
            const pSkus = Array.isArray(p?.skus) ? p.skus : [];
            if (pSkus.some((s: any) => isSkuInSelectedScope(s?.channel_id))) continue;
            const row: PurchasePickerRow = {
                id: `p-${pId}`,
                master_id: pId,
                sku_id: null,
                sku_code: '',
                label: pName,
                sub: isAr
                    ? 'بدون قائمة على المحل — يُنشأ SKU عند حفظ الفاتورة'
                    : 'No store listing yet — SKU created when you save the invoice',
                place: storeName || (isAr ? 'المستودع المحدد' : 'Selected warehouse'),
                price: Number(p?.cost_price ?? p?.last_purchase_price ?? 0),
                type: 'product',
            };
            if (matchesPickerQuery(row, query)) {
                byKey.set(row.id, row);
            }
        }

        return Array.from(byKey.values()).slice(0, 100);
    };

    const similarChannelSkuSuggestions = useMemo(() => {
        const q = debouncedPickerSearch.trim().toLowerCase();
        if (q.length < 4 || !selectedStore?.channel_id) return [];
        const qBase = q.replace(/[-_][a-z0-9]+$/i, '');
        if (qBase.length < 4) return [];
        return (storeChannelSkus || [])
            .map((sk: any) => {
                const code = String(sk?.sku || sk?.sku_code || '').trim();
                const mp = sk?.offer?.master_product ?? sk?.offer?.masterProduct;
                const name = String(mp?.internal_name || sk?.name || '').trim();
                return { code, name, sk };
            })
            .filter(({ code }) => {
                const c = code.toLowerCase();
                const cBase = c.replace(/[-_][a-z0-9]+$/i, '');
                return c.includes(q) || (cBase === qBase && c !== q);
            })
            .slice(0, 5);
    }, [debouncedPickerSearch, storeChannelSkus, selectedStore?.channel_id]);

    const resolveLineItemLabel = (index: number): string => {
        const pid = watch(`items.${index}.product_id`);
        const sid = watch(`items.${index}.sku_id`);
        if (!watch('store_id')) {
            return isAr ? 'اختر المستودع أولاً…' : 'Select warehouse first…';
        }
        if (!pid) {
            return isAr ? 'اختر SKU محدد...' : 'Select specific SKU...';
        }

        const cachedLabel = String(productSearchByRow[index] || '').trim();
        if (cachedLabel) {
            return cachedLabel;
        }

        if (sid) {
            const invRow = (storeInventoryRows || []).find(
                (r: any) => String(r?.sku?.id ?? '') === String(sid)
            );
            const invSku = invRow?.sku;
            if (invSku) {
                const mp = invSku?.offer?.master_product ?? invSku?.offer?.masterProduct;
                const mpName = String(mp?.internal_name || '').trim();
                const skuCode = String(invSku?.sku || invSku?.sku_code || '').trim();
                if (mpName && skuCode && skuCode.toLowerCase() !== mpName.toLowerCase()) {
                    return `${mpName} — ${skuCode}`;
                }
                return skuCode || mpName || String(invSku?.name || '').trim();
            }

            const channelSku = (storeChannelSkus || []).find(
                (s: any) => String(s?.id ?? '') === String(sid)
            );
            if (channelSku) {
                const mp = channelSku?.offer?.master_product ?? channelSku?.offer?.masterProduct;
                const mpName = String(mp?.internal_name || '').trim();
                const skuCode = String(channelSku?.sku || channelSku?.sku_code || '').trim();
                if (mpName && skuCode && skuCode.toLowerCase() !== mpName.toLowerCase()) {
                    return `${mpName} — ${skuCode}`;
                }
                return skuCode || mpName || String(channelSku?.name || '').trim();
            }
        }

        const master =
            catalogProducts.find((mp: any) => String(mp.id) === String(pid))
            || masterProducts.find((mp: any) => String(mp.id) === String(pid));
        if (master) {
            const masterName = String(master.internal_name || master.name || '').trim();
            if (sid) {
                const sku = (master.skus || []).find((s: any) => String(s.id) === String(sid));
                if (sku) {
                    const skuCode = String(sku.sku || sku.sku_code || '').trim();
                    return skuCode ? `${skuCode} (${masterName})` : masterName;
                }
            }
            return masterName || (isAr ? `منتج #${pid}` : `Product #${pid}`);
        }

        return isAr ? `منتج #${pid}` : `Product #${pid}`;
    };

    const getProductLastPurchasePrice = (productId: string | undefined): number => {
        if (!productId) return 0;
        const selected = productsList.find((p: any) => String(p.id) === String(productId));
        if (!selected) return 0;
        const direct = Number(selected?.last_purchase_price || 0);
        if (direct > 0) return direct;
        const fallback = Number(selected?.cost_price || 0);
        return fallback > 0 ? fallback : 0;
    };

    const watchedItems = useWatch({ control, name: 'items' }) || [];
    const watchedPaymentType = watch('payment_type');
    const watchedPaidAmount = Number(watch('paid_amount') || 0);
    const computedTotals = useMemo(() => {
        const total = watchedItems.reduce((sum, item) => {
            const qty = Number(item?.quantity || 0);
            const unit = Number(item?.unit_price || 0);
            return sum + (qty * unit);
        }, 0);
        const paid = Math.min(Math.max(0, watchedPaidAmount), total);
        const remaining = Math.max(0, total - paid);
        return { total, paid, remaining };
    }, [watchedItems, watchedPaidAmount]);

    // When line totals update, cap advance payment so it never exceeds invoice total.
    useEffect(() => {
        const total = computedTotals.total;
        if (total <= 0) return;
        const paid = Number(getValues('paid_amount') || 0);
        if (paid > total) {
            setValue('paid_amount', total, { shouldDirty: true });
        }
    }, [computedTotals.total, getValues, setValue]);

    const handlePaymentTypeChange = (nextType: 'cash' | 'credit') => {
        setValue('payment_type', nextType);
        const total = Number(computedTotals.total || 0);
        const currentPaid = Number(getValues('paid_amount') || 0);

        // Default helpers only; do not lock user input.
        if (nextType === 'cash' && (currentPaid <= 0 || currentPaid > total)) {
            setValue('paid_amount', total, { shouldDirty: true });
            return;
        }
        if (nextType === 'credit') {
            setValue('paid_amount', 0, { shouldDirty: true });
        }
    };

    const openCreateProductDialog = (index?: number, initialName?: string) => {
        setTargetRowIndex(index ?? Math.max(0, fields.length - 1));
        if (initialName) setNewProductName(initialName);
        setIsProductCreateOpen(true);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isAr ? 'إنشاء فاتورة شراء' : 'Create Purchase Invoice'}</DialogTitle>
                    <DialogDescription>
                        {isAr ? 'إضافة مخزون جديد وتحديث رصيد المورد.' : 'Add new stock and update supplier balance.'}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>{isAr ? 'رقم الفاتورة' : 'Invoice Number'}</Label>
                            <Input {...register('invoice_number', { required: true })} />
                        </div>
                        <div className="space-y-2">
                            <Label>{isAr ? 'المستودع' : 'Store'}</Label>
                            <Select value={watch('store_id') || undefined} onValueChange={(val) => setValue('store_id', val)}>
                                <SelectTrigger>
                                    <SelectValue placeholder={isAr ? 'اختر المستودع' : 'Select Store'} />
                                </SelectTrigger>
                                <SelectContent>
                                    {stores?.map((s: any) => (
                                        <SelectItem key={s.id} value={s.id.toString()} disabled={s?.is_active === false}>
                                            {s.name}{s?.is_active === false ? (isAr ? ' (غير نشط)' : ' (inactive)') : ''}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {watch('store_id') ? (
                                loadingStoreInventory ? (
                                    <p className="text-xs text-muted-foreground">{isAr ? 'جارٍ تحميل أصناف المستودع…' : 'Loading warehouse catalog…'}</p>
                                ) : storeAllowed.skuIds.size === 0 && storeAllowed.masterIds.size === 0 ? (
                                    <p className="text-xs text-amber-700 dark:text-amber-400">
                                        {isAr
                                            ? 'لا توجد أصناف مسجلة في هذا المستودع بعد. يمكنك شراء منتج جديد أو تعديل المخزون.'
                                            : 'No SKUs are recorded for this warehouse yet.'}
                                    </p>
                                ) : (
                                    <p className="text-xs text-muted-foreground">
                                        {isAr
                                            ? `البحث يعرض المنتجات/SKU المربوطة بهذا المستودع فقط (${storeAllowed.skuIds.size} SKU).`
                                            : `Product search is limited to this warehouse (${storeAllowed.skuIds.size} SKUs).`}
                                    </p>
                                )
                            ) : (
                                <p className="text-xs text-muted-foreground">
                                    {isAr ? 'اختر المستودع أولاً لتصفية قائمة المنتجات حسب ما هو مسجل فيه.' : 'Select a warehouse to filter products by that location.'}
                                </p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label>{isAr ? 'المورد' : 'Supplier'}</Label>
                                <Button type="button" variant="outline" size="sm" onClick={() => setIsSupplierCreateOpen(true)}>
                                    <Plus className="w-3 h-3 mr-1" />
                                    {isAr ? 'إضافة مورد' : 'Add Supplier'}
                                </Button>
                            </div>
                            <Popover open={supplierPickerOpen} onOpenChange={setSupplierPickerOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        role="combobox"
                                        className={cn(
                                            "w-full justify-between h-9 text-sm font-normal",
                                            !watch('supplier_id') && "text-muted-foreground border-dashed"
                                        )}
                                    >
                                        <span className="truncate">
                                            {selectedSupplier?.name
                                                ? String(selectedSupplier.name)
                                                : (isAr ? 'اختر المورد' : 'Select Supplier')}
                                        </span>
                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[360px] p-0" align="start">
                                    <Command>
                                        <CommandInput placeholder={isAr ? 'ابحث عن المورد...' : 'Search supplier...'} />
                                        <CommandEmpty>{isAr ? 'لا يوجد مورد مطابق' : 'No supplier found.'}</CommandEmpty>
                                        <CommandList>
                                            <CommandGroup>
                                                {(suppliers || []).map((s: any) => {
                                                    const value = String(s?.id ?? '');
                                                    const isSelected = String(watch('supplier_id') || '') === value;
                                                    return (
                                                        <CommandItem
                                                            key={value}
                                                            value={`${s?.name || ''} ${value}`}
                                                            onSelect={() => {
                                                                setValue('supplier_id', value);
                                                                setSupplierPickerOpen(false);
                                                            }}
                                                        >
                                                            <Check className={cn("mr-2 h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                                                            <span className="truncate">{s?.name || value}</span>
                                                        </CommandItem>
                                                    );
                                                })}
                                            </CommandGroup>
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                        </div>
                        <div className="space-y-2">
                            <Label>{isAr ? 'التاريخ' : 'Date'}</Label>
                            <Input type="date" {...register('invoice_date')} defaultValue={new Date().toISOString().split('T')[0]} />
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-semibold">{isAr ? 'بنود الفاتورة' : 'Items'}</h3>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => openCreateProductDialog()}
                            >
                                <Plus className="w-4 h-4 mr-2" /> {isAr ? 'إضافة منتج جديد' : 'Add New Product'}
                            </Button>
                        </div>

                        <div className="rounded-lg border overflow-hidden">
                            <div className="grid grid-cols-12 gap-2 bg-muted/40 px-3 py-2 text-xs font-medium">
                                <div className="col-span-1 text-center">#</div>
                                <div className="col-span-5">{isAr ? 'المنتج' : 'Product'}</div>
                                <div className="col-span-2">{isAr ? 'الكمية' : 'Qty'}</div>
                                <div className="col-span-2">{isAr ? 'سعر الشراء' : 'Price'}</div>
                                <div className="col-span-1">{isAr ? 'الإجمالي' : 'Total'}</div>
                                <div className="col-span-1 text-center">{isAr ? 'حذف' : 'Del'}</div>
                            </div>

                            <div className="divide-y">
                                {fields.map((field, index) => (
                                    <div key={field.id} className="grid grid-cols-12 gap-2 px-3 py-3 items-center">
                                        <div className="col-span-1 text-xs text-muted-foreground text-center">{index + 1}</div>
                                        <div className="col-span-5 relative">
                                            <Popover
                                                open={!!rowPickerOpen[index]}
                                                onOpenChange={(o) => setRowPickerOpen(prev => ({ ...prev, [index]: o }))}
                                            >
                                                <PopoverTrigger asChild>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        role="combobox"
                                                        disabled={!watch('store_id')}
                                                        className={cn(
                                                            "w-full justify-between h-9 text-xs font-normal",
                                                            !watch(`items.${index}.product_id`) && "text-muted-foreground border-dashed"
                                                        )}
                                                    >
                                                        <span className="truncate max-w-[280px]">
                                                            {resolveLineItemLabel(index)}
                                                        </span>
                                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                    </Button>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-[400px] p-0" align="start">
                                                    <Command shouldFilter={false}>
                                                        <CommandInput 
                                                            placeholder={isAr ? "اكتب اسم المنتج أو الـ SKU..." : "Type product name or SKU..."} 
                                                            value={productSearchByRow[index] || ''}
                                                            onValueChange={(val) => setProductSearchByRow(prev => ({ ...prev, [index]: val }))}
                                                        />
                                                        <CommandList>
                                                            {loadingStoreInventory || (pickerSearchLoading && pickerSearchQuery.length >= 2) ? (
                                                                <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
                                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                                    {isAr ? 'جارٍ البحث…' : 'Searching…'}
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    <CommandEmpty className="p-2">
                                                                        <div className="text-sm text-muted-foreground mb-2">
                                                                            {watchedStoreId && storeAllowed.skuIds.size === 0 && storeAllowed.masterIds.size === 0
                                                                                ? isAr
                                                                                    ? 'لا توجد أصناف في هذا المستودع'
                                                                                    : 'No items in this warehouse'
                                                                                : isAr
                                                                                  ? 'لم يتم العثور على نتائج'
                                                                                  : 'No results found'}
                                                                        </div>
                                                                        {similarChannelSkuSuggestions.length > 0 && (
                                                                            <div className="mb-2 space-y-1 text-xs">
                                                                                <p className="text-muted-foreground">
                                                                                    {isAr ? 'هل تقصد:' : 'Did you mean:'}
                                                                                </p>
                                                                                {similarChannelSkuSuggestions.map((s) => (
                                                                                    <button
                                                                                        key={s.code}
                                                                                        type="button"
                                                                                        className="block w-full text-start rounded-md border border-border/60 px-2 py-1 hover:bg-muted"
                                                                                        onClick={() =>
                                                                                            setProductSearchByRow((prev) => ({
                                                                                                ...prev,
                                                                                                [index]: s.code,
                                                                                            }))
                                                                                        }
                                                                                    >
                                                                                        <span className="font-mono">{s.code}</span>
                                                                                        {s.name ? (
                                                                                            <span className="text-muted-foreground"> — {s.name}</span>
                                                                                        ) : null}
                                                                                    </button>
                                                                                ))}
                                                                            </div>
                                                                        )}
                                                                        <Button
                                                                            type="button"
                                                                            variant="secondary"
                                                                            size="sm"
                                                                            className="w-full gap-2"
                                                                            onClick={() => {
                                                                                openCreateProductDialog(index, productSearchByRow[index]);
                                                                                setRowPickerOpen(prev => ({ ...prev, [index]: false }));
                                                                            }}
                                                                        >
                                                                            <PlusCircle className="w-4 h-4 text-green-600" />
                                                                            {isAr ? "إنشاء منتج جديد بهذا الاسم؟" : "Create new product with this name?"}
                                                                        </Button>
                                                                    </CommandEmpty>
                                                                    <CommandGroup heading={isAr ? "المنتجات المطابقة" : "Matching Products"}>
                                                                        {getFilteredSearchItems(index).map((item) => (
                                                                            <CommandItem
                                                                                key={item.id}
                                                                                value={item.id}
                                                                                onSelect={() => {
                                                                                    setValue(`items.${index}.product_id`, item.master_id);
                                                                                    setValue(`items.${index}.sku_id`, item.sku_id ?? null);
                                                                                    if (applyLastPurchasePriceByFieldId[field.id]) {
                                                                                        const lp = getProductLastPurchasePrice(item.master_id);
                                                                                        if (lp > 0) {
                                                                                            setValue(`items.${index}.unit_price`, lp);
                                                                                        }
                                                                                    }
                                                                                    setProductSearchByRow(prev => ({ ...prev, [index]: item.label }));
                                                                                    setRowPickerOpen(prev => ({ ...prev, [index]: false }));
                                                                                }}
                                                                                className="flex items-center justify-between py-2"
                                                                            >
                                                                                <div className="flex flex-col min-w-0">
                                                                                    <div className="font-medium truncate">{item.label}</div>
                                                                                    <div className="text-[10px] text-muted-foreground truncate">
                                                                                        {(() => {
                                                                                            const raw = String(item.sub || '');
                                                                                            const parts = raw.split(' • ');
                                                                                            if (parts.length < 2) return raw;
                                                                                            const base = parts.slice(0, -1).join(' • ');
                                                                                            const place = parts[parts.length - 1];
                                                                                            return (
                                                                                                <>
                                                                                                    <span>{base}</span>
                                                                                                    <span className="mx-1">•</span>
                                                                                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ${placeChipClass(place)}`}>
                                                                                                        {place}
                                                                                                    </span>
                                                                                                </>
                                                                                            );
                                                                                        })()}
                                                                                    </div>
                                                                                </div>
                                                                                <div className="flex items-center gap-2">
                                                                                    <Badge variant="outline" className="text-[10px] py-0 h-4">
                                                                                        {item.type === 'sku' ? 'SKU' : 'Master'}
                                                                                    </Badge>
                                                                                    {watch(`items.${index}.product_id`) === item.master_id &&
                                                                                     watch(`items.${index}.sku_id`) === item.sku_id && (
                                                                                        <Check className="h-4 w-4 text-green-600" />
                                                                                    )}
                                                                                </div>
                                                                            </CommandItem>
                                                                        ))}
                                                                    </CommandGroup>
                                                                </>
                                                            )}
                                                        </CommandList>
                                                    </Command>
                                                </PopoverContent>
                                            </Popover>
                                        </div>
                                        <div className="col-span-2">
                                            <Input
                                                type="number"
                                                className="h-8"
                                                {...register(`items.${index}.quantity`, { required: true, valueAsNumber: true })}
                                            />
                                        </div>
                                        <div className="col-span-2 space-y-1 min-w-0">
                                            <div className="text-[10px] text-muted-foreground">
                                                {(() => {
                                                    const productId = watch(`items.${index}.product_id`);
                                                    const lastPurchase = getProductLastPurchasePrice(productId);
                                                    return lastPurchase > 0
                                                        ? (isAr ? `آخر سعر شراء: ${lastPurchase.toLocaleString()} ج.م` : `Last purchase: ${lastPurchase.toLocaleString()} EGP`)
                                                        : (isAr ? 'آخر سعر شراء: -' : 'Last purchase: -');
                                                })()}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Checkbox
                                                    id={`apply-last-price-${field.id}`}
                                                    checked={!!applyLastPurchasePriceByFieldId[field.id]}
                                                    onCheckedChange={(v) => {
                                                        const on = v === true;
                                                        setApplyLastPurchasePriceByFieldId((prev) => ({ ...prev, [field.id]: on }));
                                                        if (on) {
                                                            const pid = watch(`items.${index}.product_id`);
                                                            const lp = getProductLastPurchasePrice(pid);
                                                            if (lp > 0) {
                                                                setValue(`items.${index}.unit_price`, lp);
                                                            }
                                                        }
                                                    }}
                                                />
                                                <label
                                                    htmlFor={`apply-last-price-${field.id}`}
                                                    className="text-[11px] leading-tight cursor-pointer select-none text-muted-foreground hover:text-foreground"
                                                >
                                                    {isAr ? 'تطبيق آخر سعر شراء' : 'Apply last purchase price'}
                                                </label>
                                            </div>
                                            <Input
                                                type="number"
                                                step="0.01"
                                                className="h-8"
                                                {...register(`items.${index}.unit_price`, { required: true, valueAsNumber: true })}
                                            />
                                        </div>
                                        <div className="col-span-1 text-xs font-semibold">
                                            {(
                                                Number(watchedItems[index]?.quantity || 0) *
                                                Number(watchedItems[index]?.unit_price || 0)
                                            ).toLocaleString()}
                                        </div>
                                        <div className="col-span-1 text-center">
                                            <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => remove(index)}>
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex justify-start">
                            <Button
                                type="button"
                                onClick={() => append({ product_id: '', sku_id: null, quantity: 1, unit_price: 0 })}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                                <Plus className="w-4 h-4 mr-2" />
                                {isAr ? 'إضافة بند' : 'Add Item'}
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>{isAr ? 'ملاحظات' : 'Notes'}</Label>
                        <Input {...register('notes')} placeholder={isAr ? 'ملاحظات اختيارية...' : 'Optional notes...'} />
                    </div>

                    <div className="rounded-lg border p-4 space-y-4">
                        <h4 className="text-sm font-semibold">{isAr ? 'بيانات الدفع' : 'Payment'}</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-2">
                                <Label>{isAr ? 'نوع الدفع' : 'Payment Type'}</Label>
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        variant={watchedPaymentType === 'cash' ? 'default' : 'outline'}
                                        onClick={() => handlePaymentTypeChange('cash')}
                                        className="flex-1"
                                    >
                                        {isAr ? 'كاش' : 'Cash'}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={watchedPaymentType === 'credit' ? 'default' : 'outline'}
                                        onClick={() => handlePaymentTypeChange('credit')}
                                        className="flex-1"
                                    >
                                        {isAr ? 'آجل' : 'Credit'}
                                    </Button>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>{isAr ? 'المدفوع الآن' : 'Paid Now'}</Label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    min={0}
                                    value={Number(watch('paid_amount') || 0)}
                                    onChange={(e) => {
                                        const rawStr = e.target.value;
                                        if (rawStr === '') {
                                            setValue('paid_amount', 0, { shouldDirty: true, shouldTouch: true });
                                            return;
                                        }
                                        const raw = Number(rawStr);
                                        if (Number.isNaN(raw)) return;
                                        const cap = Number(computedTotals.total || 0);
                                        // If invoice total is still 0, do not clamp paid to 0 — user may enter a down payment before prices/lines are filled.
                                        const safe =
                                            cap > 0 ? Math.max(0, Math.min(raw, cap)) : Math.max(0, raw);
                                        setValue('paid_amount', safe, { shouldDirty: true, shouldTouch: true });
                                    }}
                                />
                                <p className="text-xs text-muted-foreground">
                                    {isAr
                                        ? (watchedPaymentType === 'cash'
                                            ? 'افتراضيًا = إجمالي الفاتورة (كاش)، ويمكنك التعديل.'
                                            : 'يمكنك إدخال أي مدفوع الآن (دفعة مقدمة) في الآجل.')
                                        : (watchedPaymentType === 'cash'
                                            ? 'Defaults to invoice total for cash, but you can edit it.'
                                            : 'You can enter any upfront paid amount for credit.')}
                                </p>
                            </div>
                            <div className="space-y-2">
                                <Label>{isAr ? 'الباقي' : 'Remaining'}</Label>
                                <Input value={computedTotals.remaining.toLocaleString()} readOnly />
                                <p className="text-xs text-muted-foreground">
                                    {isAr ? 'يتم حسابه تلقائياً.' : 'Calculated automatically.'}
                                </p>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                            <div className="rounded border bg-muted/30 p-3">
                                <p className="text-xs text-muted-foreground">{isAr ? 'إجمالي الفاتورة' : 'Invoice Total'}</p>
                                <p className="font-semibold">{computedTotals.total.toLocaleString()} EGP</p>
                            </div>
                            <div className="rounded border bg-muted/30 p-3">
                                <p className="text-xs text-muted-foreground">{isAr ? 'المدفوع' : 'Paid'}</p>
                                <p className="font-semibold text-emerald-600">{computedTotals.paid.toLocaleString()} EGP</p>
                            </div>
                            <div className="rounded border bg-muted/30 p-3">
                                <p className="text-xs text-muted-foreground">{isAr ? 'المتبقي' : 'Balance'}</p>
                                <p className="font-semibold text-amber-600">{computedTotals.remaining.toLocaleString()} EGP</p>
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            {isAr ? 'إلغاء' : 'Cancel'}
                        </Button>
                        <Button type="submit" disabled={mutation.isPending}>
                            {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            {isAr ? 'حفظ الفاتورة' : 'Save Invoice'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>

            <Dialog open={isSupplierCreateOpen} onOpenChange={setIsSupplierCreateOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{isAr ? 'إضافة مورد جديد' : 'Add New Supplier'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <Label>{isAr ? 'اسم المورد' : 'Supplier Name'}</Label>
                            <Input value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                            <Label>{isAr ? 'الهاتف' : 'Phone'}</Label>
                            <Input value={newSupplierPhone} onChange={(e) => setNewSupplierPhone(e.target.value)} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setIsSupplierCreateOpen(false)}>
                            {isAr ? 'إلغاء' : 'Cancel'}
                        </Button>
                        <Button
                            type="button"
                            disabled={createSupplierMutation.isPending || !newSupplierName.trim()}
                            onClick={() => createSupplierMutation.mutate({ name: newSupplierName.trim(), phone: newSupplierPhone.trim() || undefined })}
                        >
                            {createSupplierMutation.isPending ? (isAr ? 'جاري الحفظ...' : 'Saving...') : (isAr ? 'حفظ' : 'Save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isProductCreateOpen} onOpenChange={setIsProductCreateOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{isAr ? 'إضافة منتج جديد' : 'Add New Product'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <Label>{isAr ? 'اسم المنتج' : 'Product Name'}</Label>
                            <Input value={newProductName} onChange={(e) => setNewProductName(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                            <Label>SKU</Label>
                            <Input value={newProductSku} onChange={(e) => setNewProductSku(e.target.value)} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setIsProductCreateOpen(false)}>
                            {isAr ? 'إلغاء' : 'Cancel'}
                        </Button>
                        <Button
                            type="button"
                            disabled={createProductMutation.isPending || !newProductName.trim()}
                            onClick={() => createProductMutation.mutate({ name: newProductName.trim(), sku: newProductSku.trim() || undefined })}
                        >
                            {createProductMutation.isPending ? (isAr ? 'جاري الحفظ...' : 'Saving...') : (isAr ? 'حفظ' : 'Save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Dialog>
    );
}
