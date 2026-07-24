import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Loader2, PlusCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import api from '@/lib/api';
import { toast } from 'sonner';
import { productService } from '@/lib/supabase-services';
import { fetchMergedLocationInventory } from '@/lib/warehouseInventoryFetch';
import {
    buildPickerRowFromChannelSku,
    matchesPickerQuery,
    skuMatchesSearchQuery,
} from '@/lib/purchaseInvoicePickerUtils';

export type PurchasePickerSelection = {
    masterProductId: string;
    skuId: string | null;
    skuCode: string;
    label: string;
    rawDescription: string;
    lastPurchasePrice: number;
};

type WarehouseOption = {
    id: string;
    name?: string;
    channel_id?: string | null;
    type?: string;
};

type PickerRow = {
    id: string;
    master_id: string;
    sku_id: string | null;
    sku_code: string;
    label: string;
    sub: string;
    place?: string;
    price: number;
    type: 'sku' | 'product';
    skuChannelId?: string | null;
};

type Props = {
    locationId: string;
    warehouses: WarehouseOption[];
    masterProductId: string;
    skuId: string | null;
    onSelect: (pick: PurchasePickerSelection) => void;
    enabled?: boolean;
    onRequestCreateProduct?: (searchText: string) => void;
    triggerClassName?: string;
};

function placeChipClass(place: string) {
    const p = String(place || '').trim().toLowerCase();
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
}

function appendScopedChannelSku(
    dedup: Map<string, PickerRow>,
    allItems: PickerRow[],
    sk: any,
    storeChannelId: string | null,
    storeName: string,
    allowStoreChannelFallback: boolean,
    mainStoreChannelId: string,
    isAr: boolean
) {
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
}

export default function PurchaseProductPicker({
    locationId,
    warehouses,
    masterProductId,
    skuId,
    onSelect,
    enabled = true,
    onRequestCreateProduct,
    triggerClassName,
}: Props) {
    const { language } = useLanguage();
    const isAr = language === 'ar';
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    const selectedStore = useMemo(
        () => (warehouses || []).find((s) => String(s.id) === String(locationId)),
        [warehouses, locationId]
    );

    const { data: rawMasterProducts = [] } = useQuery({
        queryKey: ['master-products'],
        queryFn: () => productService.getAll(),
        enabled: enabled && !!locationId,
        staleTime: 0,
        refetchOnMount: 'always',
    });

    const masterProducts = useMemo(
        () =>
            (rawMasterProducts || []).map((p: any) => ({
                ...p,
                skus: p.offers?.flatMap((o: any) => o.skus || []) || p.skus || [],
            })),
        [rawMasterProducts]
    );

    const { data: storeInventoryRows = [], isLoading: loadingStoreInventory } = useQuery({
        queryKey: ['purchase-invoice-store-inventory', locationId, selectedStore?.channel_id],
        queryFn: () => fetchMergedLocationInventory(String(locationId), selectedStore?.channel_id ?? null),
        enabled: enabled && !!locationId,
    });

    const { data: storeChannelSkus = [] } = useQuery({
        queryKey: ['purchase-invoice-store-channel-skus', selectedStore?.channel_id],
        queryFn: async () => {
            const cid = selectedStore?.channel_id != null ? String(selectedStore.channel_id) : '';
            if (!cid) return [];
            return api.getArray(`/skus?channel_id=${encodeURIComponent(cid)}`);
        },
        enabled: enabled && !!selectedStore?.channel_id,
        staleTime: 0,
        refetchOnMount: 'always',
    });

    const { data: pickerCatalogRaw = [] } = useQuery({
        queryKey: ['purchase-invoice-picker-catalog', locationId],
        queryFn: () => api.getArray('master-products?with_skus=1&limit=250'),
        enabled: enabled && !!locationId,
        staleTime: 0,
        refetchOnMount: 'always',
    });

    useEffect(() => {
        if (!enabled || !open) return;
        const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 280);
        return () => window.clearTimeout(t);
    }, [search, enabled, open]);

    const pickerSearchQuery = debouncedSearch;
    const { data: channelSkuSearchHits = [] } = useQuery({
        queryKey: ['purchase-channel-sku-search', selectedStore?.channel_id, pickerSearchQuery],
        queryFn: async () => {
            const cid = selectedStore?.channel_id != null ? String(selectedStore.channel_id) : '';
            if (!cid || !pickerSearchQuery) return [];
            return api.getArray(
                `/skus?channel_id=${encodeURIComponent(cid)}&search=${encodeURIComponent(pickerSearchQuery)}`
            );
        },
        enabled: enabled && !!locationId && open && !!selectedStore?.channel_id && pickerSearchQuery.length >= 2,
        staleTime: 0,
    });
    const { data: pickerSearchRaw = [], isFetching: pickerSearchLoading } = useQuery({
        queryKey: ['purchase-picker-search', pickerSearchQuery, locationId, selectedStore?.channel_id],
        queryFn: async () => {
            const params = new URLSearchParams({
                search: pickerSearchQuery,
                limit: '80',
                with_skus: '1',
            });
            return api.getArray(`master-products?${params.toString()}`);
        },
        enabled: enabled && !!locationId && open && pickerSearchQuery.length >= 2,
        staleTime: 0,
    });

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
        for (const p of (pickerSearchRaw || []).map((x: any) => productService.transformMasterProduct(x))) {
            const id = String(p?.id ?? '').trim();
            if (id) byId.set(id, p);
        }
        return Array.from(byId.values());
    }, [masterProducts, pickerCatalogRaw, pickerSearchRaw]);

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
        for (const sk of storeChannelSkus || []) {
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
        if (enabled && open) {
            queryClient.invalidateQueries({ queryKey: ['master-products'] });
            queryClient.invalidateQueries({ queryKey: ['purchase-invoice-store-channel-skus'] });
        }
    }, [enabled, open, queryClient]);

    const filteredItems = useMemo(() => {
        const query = search.trim().toLowerCase();
        const allItems: PickerRow[] = [];
        const storeChannelId = selectedStore?.channel_id != null ? String(selectedStore.channel_id) : null;
        const storeName = String(selectedStore?.name || '').trim();
        const storeType = String(selectedStore?.type || '').trim().toLowerCase();
        const allowStoreChannelFallback = storeChannelId === null && ['physical', 'shop', 'store'].includes(storeType);
        const mainStoreChannelId = '1';
        const isSkuInSelectedScope = (skuChannelId: any): boolean => {
            const ch = skuChannelId != null && String(skuChannelId).trim() !== '' ? String(skuChannelId) : null;
            if (storeChannelId !== null) return ch === storeChannelId;
            if (allowStoreChannelFallback && ch === mainStoreChannelId) return true;
            return ch === null;
        };

        if (locationId) {
            const dedup = new Map<string, PickerRow>();
            const productKeys = new Set<string>();
            for (const r of storeInventoryRows || []) {
                const sku = r?.sku;
                const skuIdStr = sku?.id != null ? String(sku.id) : '';
                if (!skuIdStr || dedup.has(skuIdStr)) continue;
                if (!isSkuInSelectedScope(sku?.channel_id)) continue;
                const mp = sku?.offer?.master_product ?? sku?.offer?.masterProduct ?? null;
                const mpId = mp?.id ?? sku?.offer?.master_product_id ?? null;
                const masterId = mpId != null ? String(mpId) : '';
                if (!masterId) continue;
                const mpName = String(mp?.internal_name || '');
                const skuCode = String(sku?.sku || sku?.sku_code || '').trim();
                const label =
                    mpName && skuCode && skuCode.toLowerCase() !== mpName.toLowerCase()
                        ? `${mpName} — ${skuCode}`
                        : (skuCode || mpName || String(sku?.name || '').trim());
                const channelName = String(sku?.channel?.name || '').trim();
                const place = channelName || storeName || (isAr ? 'المستودع المحدد' : 'Selected warehouse');
                dedup.set(skuIdStr, {
                    id: `s-${skuIdStr}`,
                    master_id: masterId,
                    sku_id: skuIdStr,
                    sku_code: skuCode,
                    label,
                    sub: [mpName || String(sku?.name || ''), place].filter(Boolean).join(' • '),
                    place,
                    price: Number(sku?.cost_price ?? 0),
                    type: 'sku',
                    skuChannelId: sku?.channel_id != null ? String(sku.channel_id) : null,
                });
            }
            dedup.forEach((v) => allItems.push(v));
            for (const sk of storeChannelSkus || []) {
                appendScopedChannelSku(dedup, allItems, sk, storeChannelId, storeName, allowStoreChannelFallback, mainStoreChannelId, isAr);
            }
            const byNewest = [...catalogProducts].sort((a: any, b: any) => {
                const aa = new Date(a?.created_at || 0).getTime();
                const bb = new Date(b?.created_at || 0).getTime();
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
                    if (!isSkuInSelectedScope(s?.channel_id)) continue;
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
                        mainStoreChannelId,
                        isAr
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
                if (pSkus.some((s: any) => isSkuInSelectedScope(s?.channel_id))) continue;
                if (query && !pName.toLowerCase().includes(query)) continue;
                const key = `p-${pId}`;
                if (productKeys.has(key)) continue;
                productKeys.add(key);
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
            catalogProducts.forEach((p: any) => {
                const pName = String(p.internal_name || p.name || '');
                const pId = String(p.id);
                const pSkus = p.skus || [];
                pSkus.forEach((s: any) => {
                    const channelName = String(s?.channel?.name || '').trim();
                    const skuChannel = s?.channel_id != null ? String(s.channel_id) : null;
                    const place = locationId
                        ? (channelName || storeName || (isAr ? 'المستودع المحدد' : 'Selected warehouse'))
                        : (channelName || (isAr ? 'بدون قناة' : 'No channel'));
                    const skuCode = String(s.sku || s.sku_code || '').trim();
                    const label =
                        pName && skuCode && skuCode.toLowerCase() !== pName.toLowerCase()
                            ? `${pName} — ${skuCode}`
                            : (skuCode || pName);
                    allItems.push({
                        id: `s-${s.id}`,
                        master_id: pId,
                        sku_id: String(s.id),
                        sku_code: skuCode,
                        label,
                        sub: [pName, place].filter(Boolean).join(' • '),
                        place,
                        price: Number(s.cost_price || p.cost_price || 0),
                        type: 'sku',
                    });
                });
            });
        }

        const channelSkuIdSet = new Set(
            (storeChannelSkus || []).map((sk: any) => String(sk?.id ?? '').trim()).filter(Boolean)
        );
        const isPickerItemAllowed = (item: PickerRow) => {
            if (item.type === 'product') return true;
            if (!item.sku_id) return false;
            const sid = String(item.sku_id);
            if (channelSkuIdSet.has(sid)) return true;
            if (storeAllowed.skuIds.has(sid)) return true;
            return isSkuInSelectedScope(item.skuChannelId);
        };

        const scoped = locationId ? allItems.filter(isPickerItemAllowed) : allItems;

        if (!query) return scoped.slice(0, 100);

        const byKey = new Map<string, PickerRow>();
        const addRow = (row: PickerRow | null) => {
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

        for (const p of catalogProducts) {
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
        for (const p of catalogProducts) {
            const pId = String(p?.id ?? '').trim();
            if (!pId || mastersWithSkuRow.has(pId)) continue;
            const pName = String(p?.internal_name || p?.name || '').trim();
            if (!pName.toLowerCase().includes(query)) continue;
            const pSkus = Array.isArray(p?.skus) ? p.skus : [];
            if (pSkus.some((s: any) => isSkuInSelectedScope(s?.channel_id))) continue;
            const row: PickerRow = {
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
    }, [
        search,
        locationId,
        storeInventoryRows,
        storeChannelSkus,
        channelSkuSearchHits,
        catalogProducts,
        selectedStore,
        storeAllowed,
        isAr,
    ]);

    const similarChannelSkuSuggestions = useMemo(() => {
        const q = debouncedSearch.trim().toLowerCase();
        if (q.length < 4 || !selectedStore?.channel_id) return [];
        const qBase = q.replace(/[-_][a-z0-9]+$/i, '');
        if (qBase.length < 4) return [];
        return (storeChannelSkus || [])
            .map((sk: any) => {
                const code = String(sk?.sku || sk?.sku_code || '').trim();
                const mp = sk?.offer?.master_product ?? sk?.offer?.masterProduct;
                const name = String(mp?.internal_name || sk?.name || '').trim();
                const cBase = code.toLowerCase().replace(/[-_][a-z0-9]+$/i, '');
                if (!code || cBase !== qBase) return null;
                if (code.toLowerCase() === q) return null;
                return { code, name };
            })
            .filter(Boolean)
            .slice(0, 5) as { code: string; name: string }[];
    }, [debouncedSearch, storeChannelSkus, selectedStore?.channel_id]);

    const triggerLabel = useMemo(() => {
        if (!locationId) return isAr ? 'اختر المستودع أولاً…' : 'Select warehouse first…';
        if (!masterProductId) return isAr ? 'اختر SKU محدد…' : 'Select specific SKU…';
        const master = catalogProducts.find((p: any) => String(p.id) === String(masterProductId));
        if (!master) return `#${masterProductId}`;
        if (skuId) {
            const sku = (master.skus || []).find((s: any) => String(s.id) === String(skuId));
            return sku ? `${sku.sku} (${master.internal_name || master.name})` : (master.internal_name || master.name);
        }
        return master.internal_name || master.name || `#${masterProductId}`;
    }, [locationId, masterProductId, skuId, catalogProducts, isAr]);

    const getLastPurchasePrice = (mpId: string) => {
        const p = catalogProducts.find((x: any) => String(x.id) === String(mpId));
        if (!p) return 0;
        const direct = Number(p?.last_purchase_price || 0);
        if (direct > 0) return direct;
        return Number(p?.cost_price || 0) > 0 ? Number(p.cost_price) : 0;
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    disabled={!locationId}
                    className={cn(
                        'w-full justify-between h-7 text-xs font-normal',
                        !masterProductId && 'text-muted-foreground border-dashed',
                        triggerClassName
                    )}
                >
                    <span className="truncate max-w-[min(38vw,280px)]">{triggerLabel}</span>
                    <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[400px] p-0" align="start">
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder={isAr ? 'اكتب اسم المنتج أو الـ SKU…' : 'Type product name or SKU…'}
                        value={search}
                        onValueChange={setSearch}
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
                                        {isAr ? 'لم يتم العثور على نتائج' : 'No results found'}
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
                                                    onClick={() => setSearch(s.code)}
                                                >
                                                    <span className="font-mono">{s.code}</span>
                                                    {s.name ? (
                                                        <span className="text-muted-foreground"> — {s.name}</span>
                                                    ) : null}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {onRequestCreateProduct ? (
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="sm"
                                            className="w-full gap-2"
                                            onClick={() => {
                                                onRequestCreateProduct(search);
                                                setOpen(false);
                                            }}
                                        >
                                            <PlusCircle className="w-4 h-4 text-green-600" />
                                            {isAr ? 'إنشاء منتج جديد بهذا الاسم؟' : 'Create new product with this name?'}
                                        </Button>
                                    ) : null}
                                </CommandEmpty>
                                <CommandGroup heading={isAr ? 'المنتجات المطابقة' : 'Matching Products'}>
                                    {filteredItems.map((item) => (
                                        <CommandItem
                                            key={item.id}
                                            value={item.id}
                                            onSelect={() => {
                                                const mp = catalogProducts.find((p: any) => String(p.id) === item.master_id);
                                                const rawDescription = String(
                                                    mp?.internal_name || mp?.name || item.label || ''
                                                ).trim();
                                                onSelect({
                                                    masterProductId: item.master_id,
                                                    skuId: item.sku_id,
                                                    skuCode: item.sku_code || item.label,
                                                    label: item.label,
                                                    rawDescription,
                                                    lastPurchasePrice: getLastPurchasePrice(item.master_id) || item.price,
                                                });
                                                setSearch(item.label);
                                                setOpen(false);
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
                                                                <span
                                                                    className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ${placeChipClass(place)}`}
                                                                >
                                                                    {place}
                                                                </span>
                                                            </>
                                                        );
                                                    })()}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Badge variant="outline" className="text-[10px] py-0 h-4">
                                                    SKU
                                                </Badge>
                                                {String(masterProductId) === item.master_id &&
                                                    String(skuId || '') === String(item.sku_id || '') && (
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
    );
}
