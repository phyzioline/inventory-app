import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Loader2, Search, UserPlus, FileSpreadsheet, Printer, ArrowRight, ChevronsUpDown, Check, PlusCircle, ArrowLeft } from 'lucide-react';
import { clearQuotationDraft, loadQuotationDraft, saveQuotationDraft } from '@/lib/quotationDraftStorage';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import api from '@/lib/api';
import { useProducts } from '@/hooks/useProducts';
import { useCustomers } from '@/hooks/useCustomers';
import { useLanguage } from '@/contexts/LanguageContext';
import { buildQuotationPrintLabels, getDefaultPrintBranding, printQuotationProfessional } from '@/lib/printUtils';
import { useConvertQuotation } from '@/hooks/useQuotations';
import { useWarehouses } from '@/hooks/useWarehouses';
import { productService } from '@/lib/supabase-services';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

interface QuotationItem {
    id: string;
    product_id: string;
    sku_id: string | number | null;
    name: string;
    sku: string;
    image: string | null;
    quantity: number;
    unit_price: number;
    total: number;
    description?: string;
}

interface QuotationEditorProps {
    mode?: 'dialog' | 'page';
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onClose?: () => void;
    quotationId?: string | null;
}

function resolvePrimarySkuId(product: any): string | number | null {
    const direct = product?.skus?.[0]?.id;
    if (direct != null && direct !== '') return direct;
    const fromOffer = product?.offers?.[0]?.skus?.[0]?.id;
    if (fromOffer != null && fromOffer !== '') return fromOffer;
    return null;
}

function formatSaveError(error: any): string {
    const data = error?.response?.data;
    if (typeof data?.message === 'string' && data.message) return data.message;
    if (data?.errors && typeof data.errors === 'object') {
        const parts = Object.values(data.errors).flat().filter(Boolean) as string[];
        if (parts.length) return parts.join(' ');
    }
    return error?.message || 'Failed to create quotation';
}

function normalizeProductImageSrc(raw: unknown): string | null {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const value = raw.trim();
    if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) {
        return value;
    }
    if (value.startsWith('//')) {
        return `${window.location.protocol}${value}`;
    }
    if (value.startsWith('/')) {
        return `${window.location.origin}${value}`;
    }
    return value;
}

function resolveQuotationItemImage(item: any, products: any[] = []): string | null {
    const sku = item?.sku;
    const offer = sku?.offer;
    const master = offer?.master_product ?? offer?.masterProduct;
    const masterId = master?.id ?? offer?.master_product_id;

    const fromApi = normalizeProductImageSrc(
        sku?.image_url ||
            master?.image_url ||
            master?.image ||
            sku?.image ||
            item?.image_url,
    );
    if (fromApi) return fromApi;

    if (masterId != null) {
        const local = (products || []).find((p: any) => String(p?.id) === String(masterId));
        if (local) {
            return normalizeProductImageSrc(local.image_url || local.image);
        }
    }

    return null;
}

export function QuotationEditor({
    mode = 'dialog',
    open = false,
    onOpenChange,
    onClose,
    quotationId = null,
}: QuotationEditorProps) {
    const { t, dir } = useLanguage();
    const rtl = dir === 'rtl';
    const isAr = rtl;
    const isPageMode = mode === 'page';
    const isActive = isPageMode || open;
    const queryClient = useQueryClient();
    const { data: products = [] } = useProducts();
    const { data: customers = [], isLoading: customersLoading } = useCustomers({ enabled: isActive });
    const { data: warehouses = [] } = useWarehouses();
    const { mutate: convertToOrder, isPending: isConverting } = useConvertQuotation();

    const [customerId, setCustomerId] = useState('');
    const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
    const [customerPickQuery, setCustomerPickQuery] = useState('');
    const [customerName, setCustomerName] = useState('');
    const [customerEmail, setCustomerEmail] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [items, setItems] = useState<QuotationItem[]>([]);
    const [savedQuotation, setSavedQuotation] = useState<{ id: string; status: string; reference_number?: string } | null>(null);
    const [editingQuotationId, setEditingQuotationId] = useState<string | null>(null);
    const [loadingQuotation, setLoadingQuotation] = useState(false);
    const [storeId, setStoreId] = useState('');
    const [isProductCreateOpen, setIsProductCreateOpen] = useState(false);
    const [newProductName, setNewProductName] = useState('');
    const [newProductSku, setNewProductSku] = useState('');

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

    const wasOpenRef = useRef(false);
    const loadedQuotationIdRef = useRef<string | null>(null);
    const draftRestoredRef = useRef(false);

    const persistDraftToLocal = useCallback(() => {
        if (quotationId) return;
        if (!customerName.trim() && items.length === 0 && !storeId) {
            clearQuotationDraft();
            return;
        }
        saveQuotationDraft({
            customerId,
            customerName,
            customerEmail,
            customerPhone,
            storeId,
            items,
            editingQuotationId,
            savedQuotation,
            updatedAt: new Date().toISOString(),
        });
    }, [customerId, customerEmail, customerName, customerPhone, editingQuotationId, items, quotationId, savedQuotation, storeId]);

    const applyDraft = useCallback((draft: ReturnType<typeof loadQuotationDraft>) => {
        if (!draft) return;
        setCustomerId(draft.customerId || '');
        setCustomerName(draft.customerName || '');
        setCustomerEmail(draft.customerEmail || '');
        setCustomerPhone(draft.customerPhone || '');
        setStoreId(draft.storeId || '');
        setItems(Array.isArray(draft.items) ? draft.items : []);
        setEditingQuotationId(draft.editingQuotationId);
        setSavedQuotation(draft.savedQuotation);
        if (draft.editingQuotationId) {
            loadedQuotationIdRef.current = draft.editingQuotationId;
        }
    }, []);

    const selectedStore = useMemo(
        () => (warehouses || []).find((w: any) => String(w.id) === String(storeId)),
        [warehouses, storeId],
    );

    const isConverted = savedQuotation?.status === 'converted';
    const isEditable = !isConverted && (!savedQuotation || !!editingQuotationId);

    const resetForm = useCallback(() => {
        setCustomerId('');
        setCustomerPickerOpen(false);
        setCustomerPickQuery('');
        setCustomerName('');
        setCustomerEmail('');
        setCustomerPhone('');
        setItems([]);
        setSearchQuery('');
        setSearchResults([]);
        setSavedQuotation(null);
        setEditingQuotationId(null);
        setStoreId('');
        setIsProductCreateOpen(false);
        setNewProductName('');
        setNewProductSku('');
        loadedQuotationIdRef.current = null;
    }, []);

    const loadQuotation = useCallback(async (id: string) => {
        setLoadingQuotation(true);
        try {
            const q: any = await api.get(`quotations/${id}`);
            setEditingQuotationId(String(q.id));
            loadedQuotationIdRef.current = String(q.id);
            setSavedQuotation({
                id: String(q.id),
                status: String(q.status ?? 'draft'),
                reference_number: q.reference_number,
            });
            setCustomerId(q.customer_id != null ? String(q.customer_id) : '');
            setCustomerName(String(q.customer_name || q.customer?.name || ''));
            setCustomerEmail(String(q.customer?.email || ''));
            setCustomerPhone(String(q.customer?.phone || ''));
            setItems(
                (Array.isArray(q.items) ? q.items : []).map((item: any) => {
                    const sku = item.sku || {};
                    const offer = sku?.offer;
                    const master = offer?.master_product ?? offer?.masterProduct;
                    const masterId = master?.id ?? offer?.master_product_id;
                    return {
                        id: String(item.id),
                        product_id: masterId != null ? String(masterId) : String(item.sku_id),
                        sku_id: item.sku_id ?? null,
                        name: String(
                            sku?.name ||
                                master?.internal_name ||
                                sku?.sku ||
                                item.description ||
                                'Product',
                        ),
                        sku: String(sku?.sku || 'N/A'),
                        image: resolveQuotationItemImage(item, products),
                        quantity: Number(item.quantity) || 1,
                        unit_price: Number(item.unit_price) || 0,
                        total: Number(item.total) || Number(item.quantity) * Number(item.unit_price) || 0,
                    };
                }),
            );
        } catch {
            toast.error(t('quotations.loadFailed') || (isAr ? 'تعذر تحميل عرض السعر' : 'Failed to load quotation'));
            if (isPageMode) {
                onClose?.();
            } else {
                onOpenChange?.(false);
            }
        } finally {
            setLoadingQuotation(false);
        }
    }, [isAr, isPageMode, onClose, onOpenChange, products, t]);

    useEffect(() => {
        if (!isActive) {
            wasOpenRef.current = false;
            return;
        }
        if (!wasOpenRef.current) {
            if (quotationId) {
                if (loadedQuotationIdRef.current !== quotationId) {
                    void loadQuotation(quotationId);
                }
            } else if (isPageMode && !draftRestoredRef.current) {
                const draft = loadQuotationDraft();
                if (draft && (draft.customerName.trim() || draft.items.length > 0)) {
                    applyDraft(draft);
                    draftRestoredRef.current = true;
                    toast.info(t('quotations.draftRestored') || (isAr ? 'تم استرجاع آخر مسودة كنت تعمل عليها' : 'Restored your last draft'));
                } else {
                    resetForm();
                }
            } else if (!isPageMode) {
                resetForm();
            }
        }
        wasOpenRef.current = isActive;
    }, [isActive, quotationId, isPageMode, resetForm, loadQuotation, applyDraft, t, isAr]);

    useEffect(() => {
        if (!isActive || quotationId) return;
        const timer = window.setTimeout(() => persistDraftToLocal(), 600);
        return () => window.clearTimeout(timer);
    }, [isActive, quotationId, persistDraftToLocal, customerId, customerName, customerEmail, customerPhone, items, storeId, editingQuotationId, savedQuotation]);

    const filteredCustomers = useMemo(() => {
        const q = customerPickQuery.trim().toLowerCase();
        const list = Array.isArray(customers) ? customers : [];
        if (!q) return list.slice(0, 15);
        return list
            .filter((c: any) => {
                const name = String(c?.name ?? '').toLowerCase();
                const email = String(c?.email ?? '').toLowerCase();
                const phone = String(c?.phone ?? '').toLowerCase();
                return name.includes(q) || email.includes(q) || phone.includes(q);
            })
            .slice(0, 30);
    }, [customers, customerPickQuery]);

    const selectRegisteredCustomer = (c: any) => {
        setCustomerId(String(c.id));
        setCustomerName(String(c.name ?? ''));
        setCustomerEmail(String(c.email ?? ''));
        setCustomerPhone(String(c.phone ?? ''));
        setCustomerPickQuery('');
        setCustomerPickerOpen(false);
    };

    const clearRegisteredCustomer = () => {
        setCustomerId('');
        setCustomerPickQuery('');
        setCustomerPickerOpen(false);
    };

    const searchProducts = async (query: string) => {
        const q = query.trim().toLowerCase();
        if (q.length < 1) {
            setSearchResults([]);
            return;
        }
        setIsSearching(true);
        try {
            const localResults = (products || []).filter((p: any) => {
                const name = String(p?.name || p?.internal_name || '').toLowerCase();
                const sku = String(p?.sku || '').toLowerCase();
                return name.includes(q) || sku.includes(q);
            });

            if (localResults.length > 0) {
                setSearchResults(localResults.slice(0, 50));
                return;
            }

            const remoteResults = await api.getArray(`master-products?search=${encodeURIComponent(query)}`);
            setSearchResults(remoteResults || []);
        } catch (e) {
            console.error(e);
            setSearchResults([]);
        } finally {
            setIsSearching(false);
        }
    };

    const getProductPrice = (product: any) => {
        if (product.selling_price) return parseFloat(product.selling_price);
        if (product.skus && product.skus.length > 0 && product.skus[0].selling_price) {
            return parseFloat(product.skus[0].selling_price);
        }
        if (product.offers && product.offers.length > 0) {
            const firstOffer = product.offers[0];
            if (firstOffer.skus && firstOffer.skus.length > 0 && firstOffer.skus[0].selling_price) {
                return parseFloat(firstOffer.skus[0].selling_price);
            }
            if (firstOffer.price) return parseFloat(firstOffer.price);
        }
        if (product.default_price) return parseFloat(product.default_price);
        return 0;
    };

    const getProductSku = (product: any) => {
        if (product.sku) return product.sku;
        if (product.skus?.[0]?.sku) return product.skus[0].sku;
        if (product.offers?.[0]?.skus?.[0]?.sku) return product.offers[0].skus[0].sku;
        return 'N/A';
    };

    const getProductImage = (product: any) => {
        return normalizeProductImageSrc(product?.image_url || product?.image);
    };

    const getProductLabel = (product: any) => {
        return product.name || product.internal_name || product.product_name_en || 'Unnamed Product';
    };

    const addItem = (product: any) => {
        const productId = String(product.id);
        const skuId = resolvePrimarySkuId(product);
        const existing = items.find((i) => i.product_id === productId);
        if (existing) {
            updateQuantity(productId, existing.quantity + 1);
        } else {
            const price = getProductPrice(product);
            setItems([
                ...items,
                {
                    id: Math.random().toString(36).slice(2, 11),
                    product_id: productId,
                    sku_id: skuId ?? null,
                    name: getProductLabel(product),
                    sku: getProductSku(product),
                    image: getProductImage(product),
                    quantity: 1,
                    unit_price: price,
                    total: price,
                    description: product.description || '',
                },
            ]);
        }
        setSearchQuery('');
        setSearchResults([]);
    };

    const updateQuantity = (productId: string, qty: number) => {
        setItems(
            items.map((i) => {
                if (i.product_id === productId) {
                    const newQty = Math.max(1, qty);
                    return { ...i, quantity: newQty, total: newQty * i.unit_price };
                }
                return i;
            })
        );
    };

    const updatePrice = (productId: string, price: number) => {
        setItems(
            items.map((i) => {
                if (i.product_id === productId) {
                    return { ...i, unit_price: price, total: i.quantity * price };
                }
                return i;
            })
        );
    };

    const removeItem = (productId: string) => {
        setItems(items.filter((i) => i.product_id !== productId));
    };

    const totalAmount = items.reduce((sum, item) => sum + item.total, 0);

    const quotationDate = () => new Date().toISOString().slice(0, 10);

    const buildPayloadItems = async () => {
        const resolved: Array<{
            sku_id: string | number;
            product_id: string;
            quantity: number;
            unit_price: number;
        }> = [];

        for (let i = 0; i < items.length; i += 1) {
            const item = items[i];
            let skuId = item.sku_id;
            if (!skuId && item.product_id) {
                if (!storeId) {
                    toast.error(
                        t('quotations.selectWarehouseFirst') ||
                            (isAr ? 'اختر المستودع لربط المنتجات الجديدة' : 'Select a warehouse to link new products'),
                    );
                    throw new Error('missing_store');
                }
                skuId = await ensureStoreListingSku(String(item.product_id), storeId);
                if (!skuId) {
                    throw new Error('missing_sku');
                }
            }
            if (!skuId) {
                toast.error(
                    t('quotations.noSkuForProduct') ||
                        (isAr ? 'أحد المنتجات بلا SKU — اختر المستودع أو أضف قائمة على القناة' : 'A product has no SKU'),
                );
                throw new Error('missing_sku');
            }
            resolved.push({
                sku_id: skuId,
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: item.unit_price,
            });
        }
        return resolved;
    };

    const ensureStoreListingSku = async (masterProductId: string, locationId: string): Promise<string | number | null> => {
        try {
            const res = await api.post<{ sku_id?: number | string }>(
                `master-products/${masterProductId}/ensure-channel-listing`,
                { location_id: locationId },
            );
            return res?.sku_id != null ? res.sku_id : null;
        } catch (error: any) {
            toast.error(
                error?.response?.data?.message ||
                    (isAr ? 'تعذّر ربط المنتج بقائمة هذا المحل' : 'Could not link product to this store listing'),
            );
            return null;
        }
    };

    const createProductMutation = useMutation({
        mutationFn: async (data: { name: string; sku?: string }) => {
            if (!storeId) {
                throw new Error(isAr ? 'اختر المستودع أولاً' : 'Select warehouse first');
            }
            const storeType = String((selectedStore as any)?.type || '').trim().toLowerCase();
            const allowStoreChannelFallback =
                selectedStore?.channel_id == null && ['physical', 'shop', 'store'].includes(storeType);
            const listingChannelId =
                selectedStore?.channel_id != null
                    ? selectedStore.channel_id
                    : allowStoreChannelFallback
                      ? 1
                      : null;

            return productService.create({
                internal_name: data.name,
                sku: data.sku || null,
                channel_id: listingChannelId,
                create_default_listing: true,
            });
        },
        onSuccess: async (created: any) => {
            queryClient.invalidateQueries({ queryKey: ['master-products'] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
            const productId = String(created?.id || '');
            const defaultSkuId = created?.offers?.[0]?.skus?.[0]?.id ?? null;
            let skuId = defaultSkuId;
            if (productId && storeId && !skuId) {
                skuId = await ensureStoreListingSku(productId, storeId);
            }
            const price = getProductPrice(created);
            if (productId) {
                setItems((prev) => [
                    ...prev,
                    {
                        id: Math.random().toString(36).slice(2, 11),
                        product_id: productId,
                        sku_id: skuId,
                        name: String(created?.internal_name || created?.name || newProductName),
                        sku: String(created?.offers?.[0]?.skus?.[0]?.sku || newProductSku || 'N/A'),
                        image: getProductImage(created),
                        quantity: 1,
                        unit_price: price,
                        total: price,
                    },
                ]);
            }
            setNewProductName('');
            setNewProductSku('');
            setIsProductCreateOpen(false);
            setSearchQuery('');
            setSearchResults([]);
            toast.success(isAr ? 'تم إضافة المنتج بنجاح' : 'Product added successfully');
        },
        onError: (error: any) => {
            toast.error(error?.response?.data?.message || error?.message || (isAr ? 'فشل إضافة المنتج' : 'Failed to add product'));
        },
    });

    const mutation = useMutation({
        mutationFn: async () => {
            const payloadItems = await buildPayloadItems();
            const body = {
                ...(customerId.trim() ? { customer_id: customerId.trim() } : {}),
                customer_name: customerName,
                customer_email: customerEmail,
                customer_phone: customerPhone,
                quotation_date: quotationDate(),
                items: payloadItems,
                discount_amount: 0,
                tax_amount: 0,
            };

            if (editingQuotationId) {
                return api.put(`quotations/${editingQuotationId}`, body);
            }
            return api.post('quotations', body);
        },
        onSuccess: (data: any) => {
            queryClient.invalidateQueries({ queryKey: ['quotations'] });
            queryClient.invalidateQueries({ queryKey: ['customers'] });
            const cid = data?.customer_id ?? data?.customer?.id;
            if (cid != null && String(cid).trim() !== '') {
                setCustomerId(String(cid));
            }
            toast.success(editingQuotationId ? (t('quotations.updateSuccess') || 'Quotation updated.') : t('quotations.createSuccess'));
            setSavedQuotation({
                id: String(data?.id ?? editingQuotationId ?? ''),
                status: String(data?.status ?? 'draft'),
                reference_number: data?.reference_number,
            });
            if (!editingQuotationId && data?.id) {
                setEditingQuotationId(String(data.id));
            }
            clearQuotationDraft();
            setAutoSaveStatus('saved');
        },
        onError: (error: any) => {
            if (error?.message === 'missing_store' || error?.message === 'missing_sku') return;
            toast.error(formatSaveError(error));
        },
    });

    const canSave = items.length > 0 && !!customerName.trim() && isEditable;

    const autoSaveBeforeAction = useCallback(
        async (opts?: { silent?: boolean }): Promise<string | null> => {
            if (!canSave || !isEditable) {
                persistDraftToLocal();
                return savedQuotation?.id ?? editingQuotationId ?? null;
            }
            setAutoSaveStatus('saving');
            try {
                const data: any = await mutation.mutateAsync();
                setAutoSaveStatus('saved');
                if (!opts?.silent) {
                    toast.success(t('quotations.autoSaved') || (isAr ? 'تم الحفظ تلقائياً' : 'Saved automatically'));
                }
                return String(data?.id ?? editingQuotationId ?? savedQuotation?.id ?? '');
            } catch (error: any) {
                if (error?.message === 'missing_store' || error?.message === 'missing_sku') {
                    persistDraftToLocal();
                    return null;
                }
                persistDraftToLocal();
                setAutoSaveStatus('idle');
                return null;
            }
        },
        [canSave, isEditable, mutation, persistDraftToLocal, savedQuotation?.id, editingQuotationId, t, isAr],
    );

    const handlePrint = async () => {
        if (items.length === 0) return;
        const quoteId = await autoSaveBeforeAction({ silent: true });
        const labels = buildQuotationPrintLabels(t);
        const tryOpen = (quotation: any, opts?: { itemsOverride?: any[]; metaExtraLine?: string }) => {
            const ok = printQuotationProfessional({
                rtl,
                branding: getDefaultPrintBranding(),
                quotation,
                itemsOverride: opts?.itemsOverride,
                metaExtraLine: opts?.metaExtraLine,
                labels,
            });
            if (!ok) {
                toast.error(rtl ? 'تعذر الطباعة — اسمح بالنوافذ المنبثقة.' : 'Print blocked — allow popups for this site.');
            }
        };

        if (quoteId) {
            try {
                const quotation = await api.get(`quotations/${quoteId}`);
                tryOpen(quotation);
            } catch {
                toast.error('Failed to print quotation');
            }
            return;
        }

        const draftRef = rtl ? 'مسودة' : 'DRAFT';
        tryOpen(
            {
                reference_number: draftRef,
                quotation_date: new Date().toISOString(),
                customer_name: customerName,
                status: 'draft',
                discount_amount: 0,
                tax_amount: 0,
                total_amount: totalAmount,
                notes: [customerEmail, customerPhone].filter(Boolean).join(' · ') || '',
            },
            {
                itemsOverride: items.map((i) => ({
                    name: i.name,
                    sku: i.sku,
                    quantity: i.quantity,
                    unit_price: i.unit_price,
                    total: i.total,
                })),
                metaExtraLine: t('quotations.printDraftLine'),
            }
        );
    };

    const handleConvert = async () => {
        const quoteId = await autoSaveBeforeAction({ silent: true });
        if (!quoteId) return;
        if (savedQuotation?.status === 'converted') return;
        convertToOrder(quoteId, {
            onSuccess: () => {
                setSavedQuotation((prev) => (prev ? { ...prev, status: 'converted' } : { id: quoteId, status: 'converted' }));
                clearQuotationDraft();
            },
        });
    };

    const handleClose = async () => {
        if (isEditable && canSave) {
            await autoSaveBeforeAction({ silent: true });
        } else {
            persistDraftToLocal();
        }
        if (isPageMode) {
            onClose?.();
            return;
        }
        resetForm();
        onOpenChange?.(false);
    };

    const handleDialogOpenChange = (next: boolean) => {
        if (!next) {
            void handleClose();
            return;
        }
        onOpenChange?.(next);
    };

    const openCreateProductDialog = () => {
        if (!storeId) {
            toast.error(t('quotations.selectWarehouseFirst') || (isAr ? 'اختر المستودع أولاً' : 'Select warehouse first'));
            return;
        }
        setNewProductName(searchQuery.trim());
        setIsProductCreateOpen(true);
    };

    const editorHeader = (
        <div className="p-6 border-b border-border bg-muted/40 flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-start sticky top-0 z-10 backdrop-blur-md shrink-0">
            <div className="flex items-start gap-3 min-w-0">
                {isPageMode ? (
                    <Button type="button" variant="ghost" size="icon" className="shrink-0 mt-0.5" onClick={() => void handleClose()}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                ) : null}
                <div className="min-w-0">
                    {isPageMode ? (
                        <div className="space-y-1 text-start">
                            <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
                                <FileSpreadsheet className="w-6 h-6 text-emerald-600 shrink-0" />
                                {editingQuotationId ? (t('quotations.editDialogTitle') || (isAr ? 'تعديل عرض السعر' : 'Edit quotation')) : t('quotations.dialogTitle')}
                            </h1>
                            <p className="text-muted-foreground text-sm">
                                {editingQuotationId ? (t('quotations.editDialogSubtitle') || (isAr ? 'عدّل الأصناف والكميات والأسعار.' : 'Adjust items, quantities, and prices.')) : t('quotations.dialogSubtitle')}
                            </p>
                        </div>
                    ) : (
                        <DialogHeader className="space-y-1 text-start p-0 sm:text-start">
                            <DialogTitle className="flex items-center gap-2 text-xl font-bold text-foreground">
                                <FileSpreadsheet className="w-6 h-6 text-emerald-600 shrink-0" />
                                {editingQuotationId ? (t('quotations.editDialogTitle') || (isAr ? 'تعديل عرض السعر' : 'Edit quotation')) : t('quotations.dialogTitle')}
                            </DialogTitle>
                            <p className="text-muted-foreground text-sm mt-1">
                                {editingQuotationId ? (t('quotations.editDialogSubtitle') || (isAr ? 'عدّل الأصناف والكميات والأسعار.' : 'Adjust items, quantities, and prices.')) : t('quotations.dialogSubtitle')}
                            </p>
                        </DialogHeader>
                    )}
                    {autoSaveStatus === 'saving' ? (
                        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {t('quotations.autoSaving') || (isAr ? 'جاري الحفظ التلقائي…' : 'Auto-saving…')}
                        </p>
                    ) : autoSaveStatus === 'saved' ? (
                        <p className="text-xs text-emerald-600 mt-2">{t('quotations.autoSavedHint') || (isAr ? 'تم الحفظ تلقائياً' : 'Auto-saved')}</p>
                    ) : null}
                </div>
            </div>
            <div className="flex flex-col items-start sm:items-end shrink-0">
                <span className="text-muted-foreground text-xs uppercase font-bold tracking-wider">{t('quotations.totalLabel')}</span>
                <span className="text-3xl font-bold text-foreground tracking-tight">
                    {totalAmount.toLocaleString(rtl ? 'ar-EG' : 'en-US')}{' '}
                    <span className="text-sm text-emerald-600 font-normal">EGP</span>
                </span>
            </div>
        </div>
    );

    const editorBody = (
        <>
            {savedQuotation && (
                <div className={cn('rounded-lg border border-emerald-600/30 bg-emerald-500/10 px-4 py-3 text-sm text-foreground', isPageMode ? 'mx-6 mt-4' : 'mx-6 mt-4')}>
                    {editingQuotationId ? (t('quotations.editingHint') || (isAr ? 'تعديل عرض السعر' : 'Editing quotation')) : t('quotations.savedHint')}
                    {savedQuotation.reference_number ? (
                        <span className="ms-2 font-mono text-emerald-700 dark:text-emerald-400">#{savedQuotation.reference_number}</span>
                    ) : null}
                </div>
            )}

            <div className={cn('grid grid-cols-1 lg:grid-cols-4 gap-0 flex-1 min-h-0', isPageMode ? 'overflow-hidden' : 'min-h-[500px]')}>
                    <div className="lg:col-span-1 border-b lg:border-b-0 lg:border-e border-border bg-muted/20 p-6 space-y-8">
                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                                <UserPlus className="w-4 h-4" />
                                {t('quotations.customerSection')}
                            </h3>
                            <div className="space-y-3">
                                <div className="space-y-1.5">
                                    <Label className="text-xs text-muted-foreground">{t('quotations.pickRegisteredCustomer')}</Label>
                                    <Popover
                                        open={customerPickerOpen}
                                        onOpenChange={(next) => {
                                            if (isEditable) setCustomerPickerOpen(next);
                                        }}
                                    >
                                        <PopoverTrigger asChild>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                role="combobox"
                                                aria-expanded={customerPickerOpen}
                                                disabled={!isEditable}
                                                className={cn(
                                                    'h-10 w-full justify-between bg-background font-normal border-border',
                                                    !customerId && 'text-muted-foreground'
                                                )}
                                            >
                                                <span className="truncate text-start">
                                                    {customerId
                                                        ? customerName.trim() || `#${customerId}`
                                                        : t('quotations.customerComboboxPlaceholder')}
                                                </span>
                                                <div className="flex shrink-0 items-center gap-1">
                                                    {customerId ? (
                                                        <Check className="h-4 w-4 text-emerald-600" aria-hidden />
                                                    ) : null}
                                                    <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
                                                </div>
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-[min(100vw-2rem,var(--radix-popover-trigger-width))] max-w-[420px] p-0" align="start">
                                            <Command shouldFilter={false}>
                                                <CommandInput
                                                    placeholder={t('quotations.searchCustomerPlaceholder')}
                                                    value={customerPickQuery}
                                                    onValueChange={setCustomerPickQuery}
                                                />
                                                <CommandList>
                                                    {customersLoading ? (
                                                        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                            …
                                                        </div>
                                                    ) : filteredCustomers.length === 0 ? (
                                                        <CommandEmpty className="py-3 text-center text-sm text-muted-foreground">
                                                            {customers.length === 0
                                                                ? t('quotations.noCustomersInDirectory')
                                                                : t('quotations.noCustomersMatch')}
                                                        </CommandEmpty>
                                                    ) : (
                                                        <CommandGroup heading={t('quotations.matchingCustomers')}>
                                                            {filteredCustomers.map((c: any) => (
                                                                <CommandItem
                                                                    key={c.id}
                                                                    value={`${c.id}-${c.name}`}
                                                                    onSelect={() => selectRegisteredCustomer(c)}
                                                                    className="flex cursor-pointer flex-col items-start gap-0.5 py-2"
                                                                >
                                                                    <span className="font-medium text-foreground">{c.name}</span>
                                                                    <span className="text-xs text-muted-foreground">
                                                                        {[c.phone, c.email].filter(Boolean).join(' · ') || '—'}
                                                                    </span>
                                                                </CommandItem>
                                                            ))}
                                                        </CommandGroup>
                                                    )}
                                                </CommandList>
                                            </Command>
                                        </PopoverContent>
                                    </Popover>
                                    {customerId ? (
                                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-600/30 bg-emerald-500/10 px-2 py-1.5 text-xs text-foreground">
                                            <span className="text-emerald-800 dark:text-emerald-300">{t('quotations.linkedCustomerBadge')}</span>
                                            {isEditable && (
                                                <button
                                                    type="button"
                                                    className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
                                                    onClick={clearRegisteredCustomer}
                                                >
                                                    {t('quotations.clearCustomerPick')}
                                                </button>
                                            )}
                                        </div>
                                    ) : null}
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="name" className="text-xs text-muted-foreground">
                                        {t('quotations.customerNameRequired')}
                                    </Label>
                                    <Input
                                        id="name"
                                        value={customerName}
                                        onChange={(e) => setCustomerName(e.target.value)}
                                        placeholder={t('quotations.customerName')}
                                        className="bg-background border-border"
                                        disabled={!isEditable}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="phone" className="text-xs text-muted-foreground">
                                        {t('quotations.phone')}
                                    </Label>
                                    <Input
                                        id="phone"
                                        value={customerPhone}
                                        onChange={(e) => setCustomerPhone(e.target.value)}
                                        placeholder="01xxxxxxxxx"
                                        className="bg-background border-border"
                                        disabled={!isEditable}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="email" className="text-xs text-muted-foreground">
                                        {t('quotations.email')}
                                    </Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        value={customerEmail}
                                        onChange={(e) => setCustomerEmail(e.target.value)}
                                        placeholder="email@example.com"
                                        className="bg-background border-border"
                                        disabled={!isEditable}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                                <Search className="w-4 h-4" />
                                {t('quotations.addProducts')}
                            </h3>
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">{t('quotations.warehouse') || (isAr ? 'المستودع / مكان الإضافة' : 'Warehouse / listing location')}</Label>
                                <Select value={storeId || undefined} onValueChange={setStoreId} disabled={!isEditable}>
                                    <SelectTrigger className="bg-background border-border">
                                        <SelectValue placeholder={t('quotations.selectWarehouse') || (isAr ? 'اختر المستودع' : 'Select warehouse')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(warehouses || []).map((w: any) => (
                                            <SelectItem key={w.id} value={String(w.id)} disabled={w?.is_active === false}>
                                                {w.name}{w?.is_active === false ? (isAr ? ' (غير نشط)' : ' (inactive)') : ''}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-[10px] text-muted-foreground">
                                    {storeId
                                        ? (t('quotations.warehouseHint') || (isAr ? 'مطلوب لإضافة منتج جديد وربطه بالقناة' : 'Required for new products and channel listing'))
                                        : (t('quotations.selectWarehouseFirst') || (isAr ? 'اختر المستودع أولاً لإضافة منتج جديد' : 'Select warehouse first to add a new product'))}
                                </p>
                            </div>
                            <div className="relative">
                                <Input
                                    value={searchQuery}
                                    onChange={(e) => {
                                        setSearchQuery(e.target.value);
                                        searchProducts(e.target.value);
                                    }}
                                    placeholder={t('quotations.searchProducts')}
                                    className="bg-background border-border"
                                    autoComplete="off"
                                    disabled={!isEditable}
                                />
                                {isSearching && <p className="text-xs text-muted-foreground mt-1">…</p>}
                                {isEditable && searchQuery.trim().length > 0 && searchResults.length === 0 && !isSearching && (
                                    <div className="mt-2">
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="sm"
                                            className="w-full gap-2"
                                            onClick={openCreateProductDialog}
                                        >
                                            <PlusCircle className="w-4 h-4 text-green-600" />
                                            {t('quotations.createNewProduct') || (isAr ? 'إنشاء منتج جديد بهذا الاسم؟' : 'Create new product with this name?')}
                                        </Button>
                                    </div>
                                )}
                                {searchResults.length > 0 && isEditable && (
                                    <div className="absolute top-full left-0 right-0 z-50 mt-2 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
                                        {searchResults.map((p) => {
                                            const price = getProductPrice(p);
                                            return (
                                                <button
                                                    key={p.id}
                                                    type="button"
                                                    onClick={() => addItem(p)}
                                                    className="flex w-full items-center justify-between gap-2 border-b border-border px-4 py-3 text-start transition-colors last:border-0 hover:bg-muted/60"
                                                >
                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate text-sm font-medium text-foreground">{getProductLabel(p)}</div>
                                                        <div className="mt-0.5 text-xs text-muted-foreground">
                                                            <span className="rounded bg-muted px-1.5 font-mono">{getProductSku(p)}</span>
                                                        </div>
                                                    </div>
                                                    <div className="shrink-0 text-xs font-bold text-emerald-600">
                                                        {price > 0 ? price.toLocaleString(rtl ? 'ar-EG' : 'en-US') : '0'} EGP
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="lg:col-span-3 flex flex-col bg-background">
                        <div className="flex-1 overflow-auto">
                            {items.length === 0 ? (
                                <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-4 p-12 text-muted-foreground">
                                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                                        <FileSpreadsheet className="h-8 w-8 opacity-40" />
                                    </div>
                                    <p className="text-sm text-center">{t('quotations.emptyLines')}</p>
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader className="bg-muted/50 sticky top-0 z-0">
                                        <TableRow className="border-border hover:bg-transparent">
                                            <TableHead className="w-[80px] text-foreground">{t('quotations.col.image')}</TableHead>
                                            <TableHead className="w-[120px] text-foreground">{t('quotations.col.sku')}</TableHead>
                                            <TableHead className="text-foreground">{t('quotations.col.product')}</TableHead>
                                            <TableHead className="w-[120px] text-end text-foreground">{t('quotations.col.unitPrice')}</TableHead>
                                            <TableHead className="w-[100px] text-center text-foreground">{t('quotations.col.qty')}</TableHead>
                                            <TableHead className="w-[120px] text-end text-foreground">{t('quotations.col.lineTotal')}</TableHead>
                                            <TableHead className="w-[50px]" />
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {items.map((item) => (
                                            <TableRow key={item.id} className="border-border hover:bg-muted/40 group">
                                                <TableCell>
                                                    <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-md bg-muted">
                                                        {item.image ? (
                                                            <img
                                                                src={item.image}
                                                                alt=""
                                                                className="h-full w-full object-cover"
                                                                referrerPolicy="no-referrer"
                                                                onError={(e) => {
                                                                    e.currentTarget.style.display = 'none';
                                                                }}
                                                            />
                                                        ) : (
                                                            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="font-mono text-xs text-muted-foreground">{item.sku}</TableCell>
                                                <TableCell className="font-medium">
                                                    <div className="text-sm text-foreground">{item.name}</div>
                                                </TableCell>
                                                <TableCell className="text-end">
                                                    <Input
                                                        type="number"
                                                        value={item.unit_price}
                                                        onChange={(e) => updatePrice(item.product_id, parseFloat(e.target.value) || 0)}
                                                        className="ms-auto h-8 w-24 border-border bg-background text-end text-foreground"
                                                        disabled={!isEditable}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex justify-center">
                                                        <Input
                                                            type="number"
                                                            value={item.quantity}
                                                            onChange={(e) => updateQuantity(item.product_id, parseInt(e.target.value, 10) || 1)}
                                                            className="h-8 w-16 border-border bg-background text-center text-foreground"
                                                            disabled={!isEditable}
                                                        />
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-end font-bold text-emerald-600 dark:text-emerald-400">
                                                    {item.total.toLocaleString(rtl ? 'ar-EG' : 'en-US')}
                                                </TableCell>
                                                <TableCell>
                                                    {isEditable && (
                                                        <button
                                                            type="button"
                                                            onClick={() => removeItem(item.product_id)}
                                                            className="rounded p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </div>

                        <div className="flex-col gap-3 border-t border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between flex shrink-0">
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="gap-2 border-border"
                                    title={t('quotations.printHelp')}
                                    onClick={() => void handlePrint()}
                                    disabled={items.length === 0}
                                >
                                    <Printer className="h-4 w-4" />
                                    {t('quotations.print')}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="gap-2 border-emerald-600/40 bg-emerald-600/5 text-emerald-800 hover:bg-emerald-600/10 dark:text-emerald-400"
                                    onClick={() => void handleConvert()}
                                    disabled={!savedQuotation?.id || savedQuotation.status === 'converted' || isConverting}
                                >
                                    {isConverting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                                    {t('quotations.convert')}
                                </Button>
                            </div>
                            <div className="flex flex-wrap justify-end gap-2">
                                <Button type="button" variant="outline" className="border-border" onClick={() => void handleClose()}>
                                    {isPageMode ? (t('quotations.back') || (isAr ? 'رجوع' : 'Back')) : savedQuotation ? t('quotations.close') : t('quotations.cancel')}
                                </Button>
                                {isEditable && (
                                    <Button
                                        type="button"
                                        onClick={() => mutation.mutate()}
                                        disabled={mutation.isPending || !canSave}
                                        className="min-w-[140px] bg-emerald-600 hover:bg-emerald-500"
                                    >
                                        {mutation.isPending ? (
                                            <>
                                                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                                                {t('quotations.saving')}
                                            </>
                                        ) : editingQuotationId ? (
                                            t('quotations.update') || (isAr ? 'حفظ التعديلات' : 'Save changes')
                                        ) : (
                                            t('quotations.save')
                                        )}
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
        </>
    );

    const productCreateDialog = (
        <Dialog open={isProductCreateOpen} onOpenChange={setIsProductCreateOpen}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('quotations.addNewProductTitle') || (isAr ? 'إضافة منتج جديد' : 'Add New Product')}</DialogTitle>
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
                    {selectedStore ? (
                        <p className="text-xs text-muted-foreground">
                            {isAr ? 'سيُضاف المنتج إلى: ' : 'Product will be listed at: '}
                            <span className="font-medium text-foreground">{selectedStore.name}</span>
                        </p>
                    ) : null}
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setIsProductCreateOpen(false)}>
                        {isAr ? 'إلغاء' : 'Cancel'}
                    </Button>
                    <Button
                        type="button"
                        disabled={createProductMutation.isPending || !newProductName.trim() || !storeId}
                        onClick={() => createProductMutation.mutate({ name: newProductName.trim(), sku: newProductSku.trim() || undefined })}
                    >
                        {createProductMutation.isPending ? (isAr ? 'جاري الحفظ...' : 'Saving...') : (isAr ? 'حفظ' : 'Save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );

    if (loadingQuotation) {
        if (isPageMode) {
            return (
                <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background">
                    <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
                    <p className="text-sm text-muted-foreground">{t('quotations.loadingOne') || (isAr ? 'جارٍ التحميل…' : 'Loading…')}</p>
                </div>
            );
        }
        return (
            <Dialog open={open} onOpenChange={handleDialogOpenChange}>
                <DialogContent className="max-w-md">
                    <div className="flex flex-col items-center gap-3 py-10">
                        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
                        <p className="text-sm text-muted-foreground">{t('quotations.loadingOne') || (isAr ? 'جارٍ التحميل…' : 'Loading…')}</p>
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    if (isPageMode) {
        return (
            <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground overflow-hidden">
                {editorHeader}
                <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
                    {editorBody}
                </div>
                {productCreateDialog}
            </div>
        );
    }

    return (
        <Dialog open={open} onOpenChange={handleDialogOpenChange}>
            <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto bg-card text-card-foreground border-border p-0 gap-0">
                {editorHeader}
                {editorBody}
            </DialogContent>
            {productCreateDialog}
        </Dialog>
    );
}

/** @deprecated Use QuotationEditor with mode="page" or navigate to /quotations/new */
export function QuotationDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; quotationId?: string | null }) {
    return <QuotationEditor mode="dialog" {...props} />;
}
