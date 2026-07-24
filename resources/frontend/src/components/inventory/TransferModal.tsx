import { useEffect, useMemo, useState } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { fetchMergedLocationInventory, resolveInventoryRowQty } from '@/lib/warehouseInventoryFetch';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Loader2, ArrowRight, Plus, Trash2, ChevronsUpDown, Check, Package, Search } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { Badge } from '@/components/ui/badge';

interface TransferModalProps {
    isOpen: boolean;
    onClose: () => void;
    defaultSourceId?: string;
}

function digitsOnly(value: unknown): string {
    return String(value ?? '').replace(/\D/g, '');
}

type TransferRow = {
    id: string;
    sku_id: string;
    quantity: number;
    to_sku_id?: string;
};

function makeRowId(): string {
    // Enough uniqueness for client-side row keys (no need for crypto UUID here).
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function stockQtyBadgeClass(qty: number): string {
    if (qty > 0) return 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800';
    if (qty < 0) return 'bg-destructive/10 text-destructive border-destructive/40';
    return 'bg-muted text-muted-foreground';
}

/** Where stock "sits" for UI tagging — المحل vs marketplace seller vs FBA. */
export type TransferStockKind = 'shop' | 'merchant' | 'fba';

export function getTransferStockKind(item: any, location: any): TransferStockKind {
    const loc = location || {};
    const type = String(loc.type || '').toLowerCase();
    const name = String(loc.name || '').toLowerCase();
    const rowId = String(item?.id ?? '');
    const isSyntheticChannel = rowId.startsWith('channel-sku-');

    if (type === 'amazon_fba') return 'fba';
    if (/\bfba\b/i.test(name) || /\bamazon\b.*\bfba\b/i.test(name)) return 'fba';

    if (type === 'channel' || type === 'marketplace') return 'merchant';
    if (type === 'store' && loc.channel_id) return 'merchant';

    if (isSyntheticChannel && loc.channel_id) return 'merchant';

    return 'shop';
}

function transferStockKindBadgeClass(kind: TransferStockKind): string {
    switch (kind) {
        case 'fba':
            return 'border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100';
        case 'merchant':
            return 'border-violet-300 bg-violet-100 text-violet-950 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-100';
        default:
            return 'border-emerald-300 bg-emerald-100 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100';
    }
}

function truncateStockKindBadgeText(raw: string, max = 22): string {
    const s = raw.trim();
    if (!s) return '';
    if (s.length <= max) return s;
    return `${s.slice(0, Math.max(1, max - 1))}…`;
}

/** Badge text: shop vs channel listing vs FBA. For marketplaces, prefer warehouse name (e.g. نون) over generic "merchant". */
function transferStockKindLabel(
    kind: TransferStockKind,
    isAr: boolean,
    location?: { name?: string } | null
): string {
    const locLabel = truncateStockKindBadgeText(String(location?.name ?? ''));
    if (kind === 'merchant' && locLabel) return locLabel;

    if (isAr) {
        switch (kind) {
            case 'fba':
                return 'FBA';
            case 'merchant':
                return 'قناة';
            default:
                return 'المحل';
        }
    }
    switch (kind) {
        case 'fba':
            return 'FBA';
        case 'merchant':
            return 'Channel';
        default:
            return 'Shop';
    }
}

function StockKindTag({
    kind,
    isAr,
    location,
}: {
    kind: TransferStockKind;
    isAr: boolean;
    /** When set, marketplace (`merchant`) rows show this name (e.g. destination "نون") instead of a generic label. */
    location?: { name?: string } | null;
}) {
    return (
        <Badge
            variant="outline"
            className={cn(
                'shrink-0 px-1.5 py-0 text-[10px] font-semibold tracking-tight',
                kind === 'fba' ? 'uppercase' : '',
                transferStockKindBadgeClass(kind)
            )}
        >
            {transferStockKindLabel(kind, isAr, location)}
        </Badge>
    );
}

export default function TransferModal({ isOpen, onClose, defaultSourceId }: TransferModalProps) {
    const queryClient = useQueryClient();
    const { t, language } = useLanguage();
    const isAr = language === 'ar';
    const [pickerOpen, setPickerOpen] = useState(false);
    const [sourceSkuFilter, setSourceSkuFilter] = useState('');
    const [destSkuFilter, setDestSkuFilter] = useState('');
    const [pendingSkuId, setPendingSkuId] = useState('');
    const [pendingDestSkuId, setPendingDestSkuId] = useState('');
    const [pendingQty, setPendingQty] = useState(1);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [transferRows, setTransferRows] = useState<TransferRow[]>([]);
    const [destSkuPickerOpen, setDestSkuPickerOpen] = useState<Record<string, boolean>>({});
    const [pendingDestPickerOpen, setPendingDestPickerOpen] = useState(false);
    const [formData, setFormData] = useState({
        from_location_id: defaultSourceId || '',
        to_location_id: '',
        notes: '',
    });

    useEffect(() => {
        if (!isOpen) return;
        api.post('/channels/sync-locations', {}).catch(() => null);
        queryClient.invalidateQueries({ queryKey: ['locations'] });
        setFormData({
            from_location_id: defaultSourceId || '',
            to_location_id: '',
            notes: '',
        });
        setPendingSkuId('');
        setPendingDestSkuId('');
        setPendingQty(1);
        setTransferRows([]);
        setDestSkuPickerOpen({});
        setSourceSkuFilter('');
        setDestSkuFilter('');
        setPendingDestPickerOpen(false);
    }, [isOpen, defaultSourceId]);

    // Fetch Locations
    const { data: locations = [] } = useQuery({
        queryKey: ['locations'],
        queryFn: () => api.getArray('warehouses'),
        enabled: isOpen,
    });

    const fromLocation = useMemo(
        () => (locations || []).find((l: any) => String(l.id) === String(formData.from_location_id)),
        [locations, formData.from_location_id]
    );
    const toLocation = useMemo(
        () => (locations || []).find((l: any) => String(l.id) === String(formData.to_location_id)),
        [locations, formData.to_location_id]
    );

    const fromChannelId = fromLocation?.channel_id != null ? String(fromLocation.channel_id) : '';
    const toChannelId = toLocation?.channel_id != null ? String(toLocation.channel_id) : '';

    // Fetch source inventory (all pages) + channel SKUs when warehouse is linked to a channel (e.g. FBA)
    const { data: sourceInventory = [], isLoading: loadingSource } = useQuery({
        queryKey: ['transfer-source-inventory', formData.from_location_id, fromChannelId],
        queryFn: () => fetchMergedLocationInventory(String(formData.from_location_id), fromChannelId || null),
        enabled: isOpen && !!formData.from_location_id,
    });

    // Fetch ALL destination inventory (for manual SKU search)
    const { data: destInventory = [], isLoading: loadingDest } = useQuery({
        queryKey: ['transfer-dest-inventory', formData.to_location_id, toChannelId],
        queryFn: () => fetchMergedLocationInventory(String(formData.to_location_id), toChannelId || null),
        enabled: isOpen && !!formData.to_location_id,
    });

    // All destination SKUs (all of them, searchable)
    const allDestSkus = useMemo(() => {
        return (destInventory || []).map((item: any) => ({
            sku_id: String(item?.sku?.id || ''),
            sku_code: item?.sku?.sku || '',
            name: item?.sku?.offer?.master_product?.internal_name ||
                item?.sku?.offer?.masterProduct?.internal_name ||
                item?.sku?.name ||
                item?.sku?.offer?.name ||
                '',
            master_product_id: String(
                item?.sku?.offer?.master_product?.id ||
                item?.sku?.offer?.masterProduct?.id ||
                item?.sku?.offer?.master_product_id ||
                ''
            ),
            available: resolveInventoryRowQty(item),
            image: item?.sku?.offer?.master_product?.image_url || item?.sku?.offer?.masterProduct?.image_url || '',
            stockKind: getTransferStockKind(item, toLocation),
        })).filter((s: any) => s.sku_id);
    }, [destInventory, toLocation]);

    // Source SKU options (include zero stock so search works; add is blocked unless qty > 0)
    const skuOptions = useMemo(() => {
        const options = (sourceInventory || [])
            .filter((item: any) => item?.sku?.id)
            .map((item: any) => ({
                sku_id: String(item.sku.id),
                sku_code: item.sku?.sku || '',
                name:
                    item.sku?.offer?.master_product?.internal_name ||
                    item.sku?.offer?.masterProduct?.internal_name ||
                    item.sku?.name ||
                    item.sku?.offer?.name ||
                    t('adjustments.unknownItem'),
                master_product_id: String(
                    item?.sku?.offer?.master_product?.id ||
                    item?.sku?.offer?.masterProduct?.id ||
                    item?.sku?.offer?.master_product_id ||
                    ''
                ),
                available: resolveInventoryRowQty(item),
                image:
                    item.sku?.offer?.master_product?.image ||
                    item.sku?.offer?.masterProduct?.image ||
                    item.sku?.offer?.master_product?.image_url ||
                    item.sku?.offer?.masterProduct?.image_url ||
                    item.sku?.product?.image ||
                    item.sku?.image ||
                    '',
                stockKind: getTransferStockKind(item, fromLocation),
                _invRowId: String(item?.id ?? ''),
            }));

        const dedup = new Map<string, any>();
        const rowScore = (r: any) =>
            Number(r.available || 0) * 10 + (String(r._invRowId || '').startsWith('channel-sku-') ? 0 : 5);

        for (const row of options) {
            const prev = dedup.get(row.sku_id);
            if (!prev) {
                dedup.set(row.sku_id, row);
                continue;
            }
            if (rowScore(row) > rowScore(prev)) {
                dedup.set(row.sku_id, row);
            }
        }

        const cleaned = Array.from(dedup.values()).map(({ _invRowId: _x, ...rest }) => rest);

        return cleaned.sort((a, b) => {
            if (b.available !== a.available) return b.available - a.available;
            return String(a.name).localeCompare(String(b.name), isAr ? 'ar' : undefined);
        });
    }, [sourceInventory, fromLocation, t, isAr]);

    const filteredSkuOptions = useMemo(() => {
        const q = sourceSkuFilter.trim();
        if (!q) return skuOptions;
        const ql = q.toLowerCase();
        return skuOptions.filter(
            (s: any) =>
                String(s.sku_code).toLowerCase().includes(ql) ||
                String(s.name).toLowerCase().includes(ql) ||
                String(s.sku_code).includes(q) ||
                String(s.name).includes(q)
        );
    }, [skuOptions, sourceSkuFilter]);

    useEffect(() => {
        if (!pickerOpen) setSourceSkuFilter('');
    }, [pickerOpen]);

    useEffect(() => {
        if (!pendingDestPickerOpen) setDestSkuFilter('');
    }, [pendingDestPickerOpen]);

    const selectedSku = useMemo(
        () => skuOptions.find((s: any) => s.sku_id === pendingSkuId),
        [skuOptions, pendingSkuId]
    );

    const allocatedQtyBySourceSku = useMemo(() => {
        const map = new Map<string, number>();
        for (const row of transferRows) {
            const key = String(row.sku_id);
            map.set(key, (map.get(key) || 0) + Number(row.quantity || 0));
        }
        return map;
    }, [transferRows]);

    const rowsWithDetails = useMemo(() => {
        return transferRows.map((row) => {
            const match = skuOptions.find((s: any) => s.sku_id === row.sku_id);
            const destMatch = allDestSkus.find((s: any) => s.sku_id === row.to_sku_id);
            const sourceAvailable = Number(match?.available || 0);
            const allocatedForSku = Number(allocatedQtyBySourceSku.get(String(row.sku_id)) || 0);
            const remainingForThisSku = Math.max(0, sourceAvailable - (allocatedForSku - Number(row.quantity || 0)));
            return {
                ...row,
                sku_code: match?.sku_code || '—',
                name: match?.name || t('adjustments.unknownItem'),
                master_product_id: match?.master_product_id || '',
                // Remaining available for THIS row, considering other rows using the same source SKU.
                available: remainingForThisSku,
                image: match?.image || '',
                dest_sku_code: destMatch?.sku_code || '',
                dest_name: destMatch?.name || '',
            };
        });
    }, [transferRows, skuOptions, allDestSkus, allocatedQtyBySourceSku, t]);

    const suggestedDestSkusByMasterProduct = useMemo(() => {
        const index = new Map<string, any[]>();
        for (const dsku of allDestSkus) {
            const mpid = String(dsku.master_product_id || '').trim();
            if (!mpid) continue;
            const arr = index.get(mpid) || [];
            arr.push(dsku);
            index.set(mpid, arr);
        }
        return index;
    }, [allDestSkus]);

    const getSuggestedDestSkus = (masterProductId: string, sourceSkuId: string) => {
        const mpid = String(masterProductId || '').trim();
        if (!mpid) return [];
        const rows = suggestedDestSkusByMasterProduct.get(mpid) || [];
        return rows.filter((r: any) => String(r.sku_id) !== String(sourceSkuId));
    };

    /** SKUs on destination channel linked to the same master product as the selected source SKU (may be empty if catalog mapping differs). */
    const suggestedDestOnly = useMemo(() => {
        if (!formData.to_location_id || !selectedSku?.master_product_id) return [];
        return getSuggestedDestSkus(selectedSku.master_product_id, selectedSku.sku_id);
    }, [formData.to_location_id, selectedSku?.master_product_id, selectedSku?.sku_id, suggestedDestSkusByMasterProduct]);

    /**
     * Full destination picker list: suggested (same master product) first, then every other SKU at destination.
     * This fixes empty search when channels use different master-product links for the same real item.
     */
    const pendingDestPickerOptions = useMemo(() => {
        if (!formData.to_location_id || !selectedSku) return [];
        const out: any[] = [];
        const seen = new Set<string>();
        for (const s of suggestedDestOnly) {
            const id = String(s.sku_id);
            if (!seen.has(id)) {
                seen.add(id);
                out.push(s);
            }
        }
        for (const s of allDestSkus) {
            const id = String(s.sku_id);
            if (!seen.has(id)) {
                seen.add(id);
                out.push(s);
            }
        }
        return out;
    }, [formData.to_location_id, selectedSku, suggestedDestOnly, allDestSkus]);

    const suggestedDestIdSet = useMemo(
        () => new Set(suggestedDestOnly.map((s: any) => String(s.sku_id))),
        [suggestedDestOnly]
    );

    const filteredPendingDestOptions = useMemo(() => {
        const q = destSkuFilter.trim();
        const base = pendingDestPickerOptions;
        if (!q) return base;
        const ql = q.toLowerCase();
        const qDigits = digitsOnly(q);
        return base.filter((s: any) => {
            const code = String(s.sku_code ?? '');
            const name = String(s.name ?? '');
            if (code.toLowerCase().includes(ql) || name.toLowerCase().includes(ql)) return true;
            if (code.includes(q) || name.includes(q)) return true;
            if (qDigits.length >= 2) {
                const hay = digitsOnly(code) + digitsOnly(name);
                if (hay.includes(qDigits)) return true;
            }
            return false;
        });
    }, [pendingDestPickerOptions, destSkuFilter]);

    useEffect(() => {
        if (!isOpen) return;
        if (!formData.to_location_id) {
            setPendingDestSkuId('');
            return;
        }
        // Don't auto-select destination SKU.
        // We require explicit selection to prevent accidental transfers to the wrong listing.
        if (
            pendingDestSkuId &&
            !pendingDestPickerOptions.some((o: any) => String(o.sku_id) === String(pendingDestSkuId))
        ) {
            setPendingDestSkuId('');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, formData.to_location_id, pendingDestPickerOptions.length]);

    const addRow = () => {
        if (!pendingSkuId) return;
        if (pendingQty <= 0) {
            toast.error(t('transfers.modal.validationQtyInvalid'));
            return;
        }
        const pendingSku = skuOptions.find((s: any) => s.sku_id === pendingSkuId);
        if (pendingSku && Number(pendingSku.available || 0) <= 0) {
            toast.error(
                isAr
                    ? 'لا يوجد مخزون في المصدر لهذا الصنف. تأكد من تسجيل المخزون أو اختر موقع المصدر الصحيح.'
                    : 'No stock at source for this SKU. Record stock first or pick another source location.'
            );
            return;
        }
        const sourceAvailable = Number(pendingSku?.available || 0);
        const alreadyAllocated = Number(allocatedQtyBySourceSku.get(String(pendingSkuId)) || 0);
        const remainingNow = Math.max(0, sourceAvailable - alreadyAllocated);
        if (pendingSku && pendingQty > remainingNow) {
            toast.error(t('transfers.modal.validationQtyExceeds'));
            return;
        }
        const suggestions =
            formData.to_location_id && pendingSku?.master_product_id
                ? getSuggestedDestSkus(pendingSku.master_product_id, pendingSkuId)
                : [];
        const resolvedDestSkuId = pendingDestSkuId || undefined;

        // If destination is a channel location (e.g. FBA), we must pick a destination SKU explicitly.
        if (toChannelId && !resolvedDestSkuId) {
            toast.error(isAr ? 'اختر SKU الوجهة أولاً قبل الإضافة.' : 'Select a destination SKU before adding.');
            return;
        }

        // Merge only if the same source SKU is being transferred to the SAME destination SKU.
        // Otherwise, allow multiple rows for the same source SKU (e.g. distribute across offers A/B).
        const mergeIndex = transferRows.findIndex(
            (r) =>
                String(r.sku_id) === String(pendingSkuId) &&
                String(r.to_sku_id || '') === String(resolvedDestSkuId || '')
        );

        if (mergeIndex >= 0) {
            setTransferRows((prev) =>
                prev.map((r, idx) =>
                    idx === mergeIndex
                        ? { ...r, quantity: Math.max(1, Number(r.quantity || 0) + Number(pendingQty || 0)) }
                        : r
                )
            );
        } else {
            setTransferRows((prev) => [
                ...prev,
                { id: makeRowId(), sku_id: pendingSkuId, quantity: Math.max(1, pendingQty), to_sku_id: resolvedDestSkuId },
            ]);
        }
        setPendingSkuId('');
        setPendingDestSkuId('');
        setPendingQty(1);
    };

    // When destination changes (or destination inventory loads), auto-suggest dest SKU if there is a single clear match.
    useEffect(() => {
        if (!isOpen) return;
        if (!formData.to_location_id) return;
        if (loadingDest) return;
        setTransferRows((prev) =>
            prev.map((r) => {
                if (r.to_sku_id) return r;
                const src = skuOptions.find((s: any) => s.sku_id === r.sku_id);
                if (!src?.master_product_id) return r;
                const suggestions = getSuggestedDestSkus(src.master_product_id, r.sku_id);
                if (suggestions.length !== 1) return r;
                return { ...r, to_sku_id: String(suggestions[0].sku_id) };
            })
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, formData.to_location_id, loadingDest, allDestSkus.length, skuOptions.length]);

    const removeRow = (sku_id: string) => {
        setTransferRows((prev) => prev.filter((row) => row.id !== sku_id));
    };

    const updateRowQty = (sku_id: string, value: number) => {
        setTransferRows((prev) =>
            prev.map((row) => (row.id === sku_id ? { ...row, quantity: Math.max(0, value || 0) } : row))
        );
    };

    const setRowDestSku = (sku_id: string, to_sku_id: string) => {
        setTransferRows((prev) =>
            prev.map((row) => (row.id === sku_id ? { ...row, to_sku_id } : row))
        );
    };

    const postBatch = async (items: Array<{ id: string; sku_id: string; quantity: number; to_sku_id?: string }>) => {
        return await api.post('transactions/transfer-batch', {
            from_location_id: formData.from_location_id,
            to_location_id: formData.to_location_id,
            notes: formData.notes || null,
            items: items.map((row) => ({
                client_transfer_id: row.id,
                sku_id: row.sku_id,
                to_sku_id: row.to_sku_id || null,
                quantity: row.quantity,
            })),
        });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.from_location_id || !formData.to_location_id) {
            toast.error(t('transfers.modal.validationRequired'));
            return;
        }
        if (formData.from_location_id === formData.to_location_id) {
            toast.error(t('transfers.modal.validationSameLocation'));
            return;
        }
        if (transferRows.length === 0) {
            toast.error(t('transfers.modal.validationNoItems'));
            return;
        }
        const invalidRow = rowsWithDetails.find((row) => Number(row.quantity || 0) <= 0);
        if (invalidRow) {
            toast.error(t('transfers.modal.validationQtyInvalid'));
            return;
        }
        const exceededRow = rowsWithDetails.find((row) => Number(row.quantity || 0) > Number(row.available || 0));
        if (exceededRow) {
            toast.error(t('transfers.modal.validationQtyExceeds'));
            return;
        }

        setIsSubmitting(true);
        // Atomic batch: either all rows transfer, or API returns per-row issues (no partial transfers).
        postBatch(transferRows.map(({ id, sku_id, quantity, to_sku_id }) => ({ id, sku_id, quantity, to_sku_id })))
            .then(() => {
                queryClient.invalidateQueries({ queryKey: ['inventory-by-location'] });
                queryClient.invalidateQueries({ queryKey: ['transactions'] });
                queryClient.invalidateQueries({ queryKey: ['transfers'] });
                queryClient.invalidateQueries({ queryKey: ['warehouses-summary'] });
                queryClient.invalidateQueries({ queryKey: ['channels-all-skus-metrics'] });
                toast.success(`${t('transfers.modal.successMany')} (${transferRows.length})`);
                onClose();
            })
            .catch((error: any) => {
                const msg = error?.response?.data?.message || t('transfers.modal.failed');
                const detail = String(error?.response?.data?.error || '').trim();
                const issues = error?.response?.data?.issues;
                const insufficient = error?.response?.data?.insufficient;
                if (Array.isArray(issues) && issues.length) {
                    const first = String(issues[0]?.message || '').trim();
                    toast.error(first ? `${msg}: ${first}` : `${msg} (${issues.length})`);
                } else if (Array.isArray(insufficient) && insufficient.length) {
                    toast.error(`${msg} (${insufficient.length})`);
                } else if (detail) {
                    toast.error(`${msg}: ${detail}`);
                } else {
                    toast.error(msg);
                }
            })
            .finally(() => {
                setIsSubmitting(false);
            });
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="flex w-[calc(100vw-0.5rem)] max-w-[min(1920px,calc(100vw-0.5rem))] max-h-[95vh] flex-col gap-4 overflow-y-auto overflow-x-hidden p-4 sm:p-6 sm:max-w-none">
                <DialogHeader>
                    <DialogTitle>{t('transfers.modal.title')}</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4 py-2">
                    {/* Locations Row */}
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-end">
                        <div className="space-y-2">
                            <Label>{t('transfers.modal.fromLocation')}</Label>
                            <Select
                                value={formData.from_location_id}
                                onValueChange={(v) => {
                                    setFormData({ ...formData, from_location_id: v });
                                    setTransferRows([]);
                                    setPendingSkuId('');
                                }}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder={t('transfers.modal.source')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {(locations || []).filter((loc: any) => loc?.is_active !== false).map((loc: any) => (
                                        <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {formData.from_location_id && (
                                <p className="text-xs text-muted-foreground">
                                    {loadingSource
                                        ? isAr
                                            ? 'جارٍ تحميل...'
                                            : 'Loading...'
                                        : (() => {
                                            const inStock = skuOptions.filter((s: any) => Number(s.available || 0) > 0).length;
                                            return isAr
                                                ? `${inStock} بمخزون · ${skuOptions.length} صنف (يظهر حتى بمخزون 0 للبحث)`
                                                : `${inStock} in stock · ${skuOptions.length} SKUs (listed incl. 0 for search)`;
                                        })()}
                                </p>
                            )}
                        </div>

                        <div className="flex justify-center pb-2">
                            <ArrowRight className="text-muted-foreground w-6 h-6" />
                        </div>

                        <div className="space-y-2">
                            <Label>{t('transfers.modal.toLocation')}</Label>
                            <Select
                                value={formData.to_location_id}
                                onValueChange={(v) => {
                                    setFormData({ ...formData, to_location_id: v });
                                    // Clear dest SKU selections when destination changes
                                    setTransferRows(prev => prev.map(r => ({ ...r, to_sku_id: undefined })));
                                    setPendingDestSkuId('');
                                }}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder={t('transfers.modal.destination')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {(locations || []).filter((loc: any) => loc?.is_active !== false).map((loc: any) => (
                                        <SelectItem key={loc.id} value={String(loc.id)} disabled={String(loc.id) === formData.from_location_id}>{loc.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {formData.to_location_id && (
                                <p className="text-xs text-muted-foreground">
                                    {loadingDest ? (isAr ? 'جارٍ تحميل...' : 'Loading...') : `${allDestSkus.length} ${isAr ? 'SKU في الوجهة' : 'SKUs at destination'}`}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_460px] 2xl:grid-cols-[1fr_520px] items-start">
                        <div className="flex min-h-0 flex-col gap-4 min-w-0">
                            <div className="space-y-2">
                                <Label>{t('transfers.modal.batchNotes')}</Label>
                                <Textarea
                                    placeholder={t('transfers.modal.batchNotesPlaceholder')}
                                    value={formData.notes}
                                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                />
                            </div>

                            {/* Transfer Rows Table — scroll for many lines; wide dialog for RTL columns */}
                            <div className="min-h-0 flex-1 overflow-auto rounded-md border max-h-[min(560px,52vh)]">
                                <Table className="min-w-[860px]">
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('table.product')}</TableHead>
                                    <TableHead>{isAr ? 'SKU (المصدر)' : 'Source SKU'}</TableHead>
                                    <TableHead className="min-w-[220px]">
                                        <div className="flex items-center gap-1">
                                            <Search className="w-3 h-3" />
                                            {isAr ? 'SKU الوجهة (اقتراحات + بحث)' : 'Dest. SKU (suggest + search)'}
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right whitespace-nowrap">{t('transfers.modal.available')}</TableHead>
                                    <TableHead className="min-w-[8rem] w-[9rem] shrink-0">
                                        {t('transfers.modal.transferQty')}
                                    </TableHead>
                                    <TableHead className="w-[72px] shrink-0 text-right">{t('transfers.modal.actions')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rowsWithDetails.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                                            <Package className="w-8 h-8 mx-auto mb-2 opacity-20" />
                                            {t('transfers.modal.validationNoItems')}
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    rowsWithDetails.map((row) => (
                                        <TableRow key={row.id}>
                                            <TableCell>
                                                <div className="flex items-center gap-3 min-w-[180px] max-w-[280px]">
                                                    <div className="h-10 w-10 rounded border bg-muted/40 overflow-hidden flex items-center justify-center shrink-0">
                                                        {row.image ? (
                                                            <img src={row.image} alt={row.name} className="h-full w-full object-cover" />
                                                        ) : (
                                                            <Package className="h-4 w-4 text-muted-foreground" />
                                                        )}
                                                    </div>
                                                    <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="font-mono text-sm">{row.sku_code}</TableCell>

                                            {/* Destination SKU - Manual Search */}
                                            <TableCell className="min-w-[220px]">
                                                {!formData.to_location_id ? (
                                                    <span className="text-xs text-muted-foreground">{isAr ? 'اختر الوجهة أولاً' : 'Select dest. first'}</span>
                                                ) : loadingDest ? (
                                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                                ) : (
                                                    <Popover
                                                        open={!!destSkuPickerOpen[row.id]}
                                                        onOpenChange={(o) => setDestSkuPickerOpen(prev => ({ ...prev, [row.id]: o }))}
                                                    >
                                                        <PopoverTrigger asChild>
                                                            <Button type="button" variant="outline" size="sm" className={cn('w-full justify-between text-xs h-9',
                                                                row.to_sku_id ? 'border-teal-400 text-teal-700 bg-teal-50' : 'border-dashed'
                                                            )}>
                                                                <span className="flex min-w-0 flex-1 items-center gap-1 font-mono">
                                                                    {row.to_sku_id ? (
                                                                        <StockKindTag
                                                                            kind={
                                                                                allDestSkus.find(
                                                                                    (d: any) =>
                                                                                        String(d.sku_id) === String(row.to_sku_id)
                                                                                )?.stockKind || 'shop'
                                                                            }
                                                                            isAr={isAr}
                                                                            location={toLocation}
                                                                        />
                                                                    ) : null}
                                                                    <span className="min-w-0 truncate">
                                                                        {row.to_sku_id
                                                                            ? row.dest_sku_code || row.to_sku_id
                                                                            : isAr
                                                                              ? '🔍 ابحث عن SKU الوجهة...'
                                                                              : '🔍 Search dest. SKU...'}
                                                                    </span>
                                                                </span>
                                                                <ChevronsUpDown className="h-3 w-3 opacity-40 shrink-0 ml-1" />
                                                            </Button>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-[min(560px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] p-0" align="start">
                                                            <Command>
                                                                <CommandInput
                                                                    placeholder={isAr ? 'ابحث بـ SKU أو اسم المنتج...' : 'Search by SKU or product name...'}
                                                                />
                                                                <CommandList>
                                                                    <CommandEmpty>
                                                                        {isAr ? 'لا يوجد SKU مطابق' : 'No matching SKU'}
                                                                    </CommandEmpty>
                                                                    {(() => {
                                                                        const suggestions = getSuggestedDestSkus(row.master_product_id, row.sku_id);
                                                                        return suggestions.length ? (
                                                                            <CommandGroup heading={isAr ? 'اقتراحات (نفس المنتج الأساسي في الوجهة)' : 'Suggestions (same master product)'} >
                                                                                {suggestions.map((dsku: any) => (
                                                                                    <CommandItem
                                                                                        key={`suggest-${dsku.sku_id}`}
                                                                                        value={`${dsku.sku_code} ${dsku.name}`}
                                                                                        className="items-start py-2"
                                                                                        onSelect={() => {
                                                                                            setRowDestSku(row.id, dsku.sku_id);
                                                                                            setDestSkuPickerOpen(prev => ({ ...prev, [row.id]: false }));
                                                                                        }}
                                                                                    >
                                                                                        <Check className={cn('mr-2 mt-0.5 h-4 w-4 shrink-0', row.to_sku_id === dsku.sku_id ? 'opacity-100' : 'opacity-0')} />
                                                                                        <div className="flex flex-1 min-w-0 items-start gap-2">
                                                                                            <StockKindTag kind={dsku.stockKind || 'shop'} isAr={isAr} location={toLocation} />
                                                                                            <div className="min-w-0 flex-1">
                                                                                                <div className="font-mono text-xs font-bold break-all">{dsku.sku_code}</div>
                                                                                                <div className="text-xs text-muted-foreground line-clamp-2 whitespace-normal break-words leading-snug">{dsku.name}</div>
                                                                                            </div>
                                                                                        </div>
                                                                                        <Badge variant="outline" className={cn('ml-2 shrink-0 text-xs font-mono', stockQtyBadgeClass(Number(dsku.available || 0)))}>
                                                                                            {dsku.available}
                                                                                        </Badge>
                                                                                    </CommandItem>
                                                                                ))}
                                                                            </CommandGroup>
                                                                        ) : null;
                                                                    })()}

                                                                    <CommandGroup heading={isAr ? `${allDestSkus.length} SKU في الوجهة (كل الأصناف)` : `${allDestSkus.length} SKUs at destination (all)`}>
                                                                        {allDestSkus.map((dsku: any) => (
                                                                            <CommandItem
                                                                                key={dsku.sku_id}
                                                                                value={`${dsku.sku_code} ${dsku.name}`}
                                                                                className="items-start py-2"
                                                                                onSelect={() => {
                                                                                    setRowDestSku(row.id, dsku.sku_id);
                                                                                    setDestSkuPickerOpen(prev => ({ ...prev, [row.id]: false }));
                                                                                }}
                                                                            >
                                                                                <Check className={cn('mr-2 mt-0.5 h-4 w-4 shrink-0', row.to_sku_id === dsku.sku_id ? 'opacity-100' : 'opacity-0')} />
                                                                                <div className="flex flex-1 min-w-0 items-start gap-2">
                                                                                    <StockKindTag kind={dsku.stockKind || 'shop'} isAr={isAr} location={toLocation} />
                                                                                    <div className="min-w-0 flex-1">
                                                                                        <div className="font-mono text-xs font-bold break-all">{dsku.sku_code}</div>
                                                                                        <div className="text-xs text-muted-foreground line-clamp-2 whitespace-normal break-words leading-snug">{dsku.name}</div>
                                                                                    </div>
                                                                                </div>
                                                                                <Badge variant="outline" className={cn('ml-2 shrink-0 text-xs font-mono', stockQtyBadgeClass(Number(dsku.available || 0)))}>
                                                                                    {dsku.available}
                                                                                </Badge>
                                                                            </CommandItem>
                                                                        ))}
                                                                    </CommandGroup>
                                                                </CommandList>
                                                            </Command>
                                                        </PopoverContent>
                                                    </Popover>
                                                )}
                                                {row.to_sku_id && row.dest_name && (
                                                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{row.dest_name}</p>
                                                )}
                                            </TableCell>

                                            <TableCell
                                                className={cn(
                                                    'text-right font-mono whitespace-nowrap',
                                                    Number(row.available) < 0 ? 'text-destructive font-semibold' : '',
                                                )}
                                            >
                                                {row.available}
                                            </TableCell>
                                            <TableCell className="min-w-[7.5rem] max-w-[10rem] shrink-0 align-middle">
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    inputMode="numeric"
                                                    value={row.quantity}
                                                    onChange={(e) => updateRowQty(row.id, parseInt(e.target.value, 10) || 0)}
                                                    className={cn(
                                                        'h-9 min-w-[7rem] w-full tabular-nums text-center font-mono text-sm',
                                                        '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                                                        Number(row.quantity) > Number(row.available) ? 'border-destructive' : ''
                                                    )}
                                                />
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(row.id)}>
                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                                </Table>
                    </div>
                        </div>

                        {/* Right panel — wider column so SKU dropdowns show longer Arabic names */}
                        <div className="min-w-0 w-full rounded-lg border bg-card p-3 space-y-3">
                            <div className="text-sm font-semibold">
                                {isAr ? 'اختيار الأصناف' : 'Pick SKUs'}
                            </div>

                            <div className="space-y-2">
                                <Label>{isAr ? 'SKU (من الموقع)' : 'Source SKU'}</Label>
                                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            role="combobox"
                                            className="w-full justify-between gap-2"
                                            disabled={!formData.from_location_id}
                                        >
                                            <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-start">
                                                {selectedSku?.stockKind ? (
                                                    <StockKindTag kind={selectedSku.stockKind} isAr={isAr} location={fromLocation} />
                                                ) : null}
                                                <span className="min-w-0 truncate">
                                                    {selectedSku
                                                        ? `${selectedSku.sku_code} - ${selectedSku.name}`
                                                        : formData.from_location_id
                                                          ? t('transfers.modal.searchSelectProduct')
                                                          : t('transfers.modal.selectSourceFirst')}
                                                </span>
                                            </span>
                                            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[min(560px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] p-0" align="start">
                                        <Command shouldFilter={false}>
                                            <CommandInput
                                                placeholder={t('transfers.modal.searchPlaceholder')}
                                                value={sourceSkuFilter}
                                                onValueChange={setSourceSkuFilter}
                                            />
                                            <CommandList>
                                                <CommandEmpty>{t('transfers.modal.noProductFound')}</CommandEmpty>
                                                <CommandGroup>
                                                    {filteredSkuOptions.slice(0, 500).map((sku: any) => {
                                                        const isSelected = pendingSkuId === sku.sku_id;
                                                        const avail = Number(sku.available || 0);
                                                        return (
                                                            <CommandItem
                                                                key={sku.sku_id}
                                                                value={`${sku.sku_id}`}
                                                                keywords={[sku.sku_code, sku.name]}
                                                                className="items-start py-2"
                                                                onSelect={() => {
                                                                    setPendingSkuId(sku.sku_id);
                                                                    setPendingDestSkuId('');
                                                                    setPickerOpen(false);
                                                                }}
                                                            >
                                                                <Check className={cn('mr-2 mt-0.5 h-4 w-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
                                                                <div className="flex min-w-0 flex-1 items-start gap-2">
                                                                    <StockKindTag kind={sku.stockKind || 'shop'} isAr={isAr} location={fromLocation} />
                                                                    <span className="min-w-0 flex-1 whitespace-normal break-words text-start leading-snug line-clamp-2">
                                                                        {sku.sku_code} — {sku.name}
                                                                    </span>
                                                                </div>
                                                                <Badge variant="outline" className={cn('ml-2 shrink-0 font-mono', stockQtyBadgeClass(avail))}>
                                                                    {sku.available}
                                                                </Badge>
                                                            </CommandItem>
                                                        );
                                                    })}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                                {!formData.from_location_id ? (
                                    <p className="text-xs text-muted-foreground">{isAr ? 'اختر موقع (من) أولاً.' : 'Pick source location first.'}</p>
                                ) : null}
                            </div>

                            <div className="space-y-2">
                                <Label>{isAr ? 'SKU (إلى الموقع - نفس المنتج الأساسي)' : 'Destination SKU (same master product)'}</Label>
                                <Popover open={pendingDestPickerOpen} onOpenChange={setPendingDestPickerOpen}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            role="combobox"
                                            className="w-full justify-between gap-2"
                                            disabled={!formData.to_location_id || !selectedSku?.master_product_id || loadingDest}
                                        >
                                            <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-start font-mono">
                                                {pendingDestSkuId ? (
                                                    <StockKindTag
                                                        kind={
                                                            allDestSkus.find((d: any) => String(d.sku_id) === String(pendingDestSkuId))
                                                                ?.stockKind || 'shop'
                                                        }
                                                        isAr={isAr}
                                                        location={toLocation}
                                                    />
                                                ) : null}
                                                <span className="min-w-0 truncate">
                                                    {pendingDestSkuId
                                                        ? allDestSkus.find((d: any) => String(d.sku_id) === String(pendingDestSkuId))
                                                              ?.sku_code || pendingDestSkuId
                                                        : isAr
                                                          ? 'ابحث/اختر SKU الوجهة...'
                                                          : 'Search / select dest SKU...'}
                                                </span>
                                            </span>
                                            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[min(560px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] p-0" align="start">
                                        <Command shouldFilter={false}>
                                            <CommandInput
                                                placeholder={isAr ? 'ابحث بـ SKU أو الاسم...' : 'Search by SKU or name...'}
                                                value={destSkuFilter}
                                                onValueChange={setDestSkuFilter}
                                            />
                                            <CommandList>
                                                <CommandEmpty>{isAr ? 'لا يوجد مطابق' : 'No match found'}</CommandEmpty>
                                                {(() => {
                                                    const sug = filteredPendingDestOptions.filter((d: any) =>
                                                        suggestedDestIdSet.has(String(d.sku_id))
                                                    );
                                                    const rest = filteredPendingDestOptions.filter(
                                                        (d: any) => !suggestedDestIdSet.has(String(d.sku_id))
                                                    );
                                                    return (
                                                        <>
                                                            {sug.length > 0 ? (
                                                                <CommandGroup
                                                                    heading={
                                                                        isAr
                                                                            ? 'مرتبط بنفس المنتج الأساسي في الوجهة'
                                                                            : 'Same master product at destination'
                                                                    }
                                                                >
                                                                    {sug.slice(0, 200).map((dsku: any) => (
                                                                        <CommandItem
                                                                            key={`pending-dest-sug-${dsku.sku_id}`}
                                                                            value={`${dsku.sku_id}-${dsku.sku_code}`}
                                                                            keywords={[dsku.sku_code, dsku.name]}
                                                                            className="items-start py-2"
                                                                            onSelect={() => {
                                                                                setPendingDestSkuId(String(dsku.sku_id));
                                                                                setPendingDestPickerOpen(false);
                                                                            }}
                                                                        >
                                                                            <Check
                                                                                className={cn(
                                                                                    'mr-2 mt-0.5 h-4 w-4 shrink-0',
                                                                                    String(pendingDestSkuId) === String(dsku.sku_id)
                                                                                        ? 'opacity-100'
                                                                                        : 'opacity-0'
                                                                                )}
                                                                            />
                                                                            <div className="flex flex-1 min-w-0 items-start gap-2">
                                                                                <StockKindTag kind={dsku.stockKind || 'shop'} isAr={isAr} location={toLocation} />
                                                                                <div className="min-w-0 flex-1">
                                                                                    <div className="font-mono text-xs font-bold break-all">
                                                                                        {dsku.sku_code}
                                                                                    </div>
                                                                                    <div className="text-xs text-muted-foreground line-clamp-2 whitespace-normal break-words leading-snug">
                                                                                        {dsku.name}
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                            <Badge variant="outline" className={cn('ml-2 shrink-0 text-xs font-mono', stockQtyBadgeClass(Number(dsku.available || 0)))}>
                                                                                {dsku.available}
                                                                            </Badge>
                                                                        </CommandItem>
                                                                    ))}
                                                                </CommandGroup>
                                                            ) : null}
                                                            {rest.length > 0 ? (
                                                                <CommandGroup
                                                                    heading={
                                                                        isAr
                                                                            ? `كل أصناف الوجهة (${rest.length})`
                                                                            : `All destination SKUs (${rest.length})`
                                                                    }
                                                                >
                                                                    {rest.slice(0, 400).map((dsku: any) => (
                                                                        <CommandItem
                                                                            key={`pending-dest-all-${dsku.sku_id}`}
                                                                            value={`${dsku.sku_id}-${dsku.sku_code}`}
                                                                            keywords={[dsku.sku_code, dsku.name]}
                                                                            className="items-start py-2"
                                                                            onSelect={() => {
                                                                                setPendingDestSkuId(String(dsku.sku_id));
                                                                                setPendingDestPickerOpen(false);
                                                                            }}
                                                                        >
                                                                            <Check
                                                                                className={cn(
                                                                                    'mr-2 mt-0.5 h-4 w-4 shrink-0',
                                                                                    String(pendingDestSkuId) === String(dsku.sku_id)
                                                                                        ? 'opacity-100'
                                                                                        : 'opacity-0'
                                                                                )}
                                                                            />
                                                                            <div className="flex flex-1 min-w-0 items-start gap-2">
                                                                                <StockKindTag kind={dsku.stockKind || 'shop'} isAr={isAr} location={toLocation} />
                                                                                <div className="min-w-0 flex-1">
                                                                                    <div className="font-mono text-xs font-bold break-all">
                                                                                        {dsku.sku_code}
                                                                                    </div>
                                                                                    <div className="text-xs text-muted-foreground line-clamp-2 whitespace-normal break-words leading-snug">
                                                                                        {dsku.name}
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                            <Badge variant="outline" className={cn('ml-2 shrink-0 text-xs font-mono', stockQtyBadgeClass(Number(dsku.available || 0)))}>
                                                                                {dsku.available}
                                                                            </Badge>
                                                                        </CommandItem>
                                                                    ))}
                                                                </CommandGroup>
                                                            ) : null}
                                                        </>
                                                    );
                                                })()}
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                                {!formData.to_location_id ? (
                                    <p className="text-xs text-muted-foreground">{isAr ? 'اختر موقع (إلى) أولاً.' : 'Pick destination location first.'}</p>
                                ) : !selectedSku ? (
                                    <p className="text-xs text-muted-foreground">{isAr ? 'اختر SKU من المصدر أولاً.' : 'Pick a source SKU first.'}</p>
                                ) : suggestedDestOnly.length === 0 && allDestSkus.length > 0 ? (
                                    <p className="text-xs text-muted-foreground">
                                        {isAr
                                            ? 'لا يوجد تطابق تلقائي لنفس المنتج الأساسي على الوجهة — استخدم البحث لاختيار أي SKU في القناة.'
                                            : 'No auto-match by master product on destination — search to pick any SKU in that channel.'}
                                    </p>
                                ) : null}
                            </div>

                            <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                                <div className="space-y-2">
                                    <Label>{t('sales.qty')}</Label>
                                    <Input
                                        type="number"
                                        min="1"
                                        inputMode="numeric"
                                        value={pendingQty}
                                        onChange={(e) => setPendingQty(parseInt(e.target.value, 10) || 0)}
                                        placeholder={t('sales.qty')}
                                        className="min-w-[5.5rem] tabular-nums text-center font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    />
                                </div>
                                <Button type="button" onClick={addRow} disabled={!pendingSkuId || !formData.from_location_id} className="gap-2 h-10">
                                    <Plus className="w-4 h-4" />
                                    {t('transfers.modal.add')}
                                </Button>
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="shrink-0 gap-2 border-t border-border/60 pt-4 sm:justify-end">
                        <Button type="button" variant="outline" onClick={onClose}>{t('transfers.modal.cancel')}</Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting && <Loader2 className={cn('h-4 w-4 animate-spin', isAr ? 'ml-2' : 'mr-2')} />}
                            {isSubmitting ? t('transfers.modal.transferring') : t('transfers.modal.confirmTransfer')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
