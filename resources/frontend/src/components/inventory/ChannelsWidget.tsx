import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Globe, Store, Warehouse, ExternalLink, LayoutGrid, ListOrdered, CreditCard, Plus, Trash2, Pencil
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ChannelInventoryMetrics } from "@/lib/channelInventoryMetrics";
import { dedupeWarehouseSummaryRows } from "@/lib/warehouseSummaryAggregation";
import { toast } from "sonner";

import amazonLogo from "@/assets/channel-logos/amazon.png";
import noonLogo from "@/assets/channel-logos/noon.png";
import jumiaLogo from "@/assets/channel-logos/jumia.png";

const staticChannelMeta: Record<string, any> = {
    amazon: { logo: amazonLogo, color: "bg-orange-500/10 text-orange-600", path: "/channels/amazon/asins", ordersPath: "/channels/amazon/orders", paymentsPath: "/reconciliation/amazon", types: ["Amazon"] },
    noon: { logo: noonLogo, color: "bg-yellow-400/10 text-yellow-700", path: "/channels/noon", ordersPath: "/orders?channel=noon", paymentsPath: "/reconciliation/noon", types: ["Noon"] },
    jumia: { logo: jumiaLogo, color: "bg-orange-700/10 text-orange-800", path: "/channels/jumia", ordersPath: "/orders?channel=jumia", paymentsPath: "/reconciliation/jumia", types: ["Jumia"] },
    website: { icon: Globe, color: "bg-blue-500/10 text-blue-700", path: "/channels/website", ordersPath: "/orders?channel=website", paymentsPath: "/reconciliation/payment-gateway", types: ["Website"] },
    store: { icon: Store, color: "bg-green-500/10 text-green-600", path: "/channels/store", ordersPath: "/orders?channel=store", paymentsPath: "/finance/bank-accounts", types: ["POS"] },
    physical: { icon: Store, color: "bg-green-500/10 text-green-600", path: "/channels/store", ordersPath: "/orders?channel=store", paymentsPath: "/finance/bank-accounts", types: ["POS"] }
};

const defaultMeta = { icon: LayoutGrid, color: "bg-gray-500/10 text-gray-700", path: "/channels", ordersPath: "/orders", paymentsPath: "/reconciliation", types: ["Custom"] };

const normalizeType = (raw: any) => String(raw || '').trim().toLowerCase();

const isLocalStoreChannel = (channel: any): boolean => {
    const t = normalizeType(channel?.type);
    const slug = normalizeType(channel?.slug);
    const name = normalizeType(channel?.name);
    if (t === 'pos' || t === 'store' || t === 'physical') return true;
    return (
        slug.includes('store')
        || slug.includes('shop')
        || slug.includes('main')
        || name.includes('store')
        || name.includes('shop')
        || name.includes('محل')
        || name.includes('المخزن')
    );
};

/** Matches backend {@see InventoryValuationService::isPhysicalBucketLocation}. */
const isPhysicalWarehouseRow = (row: any, mainStoreLocationId = 0): boolean => {
    const rowId = Number(row?.id ?? 0);
    if (mainStoreLocationId > 0 && rowId === mainStoreLocationId) {
        return true;
    }
    const t = normalizeType(row?.type);
    const name = normalizeType(row?.name);
    return (
        t === 'physical'
        || t === 'shop'
        || t === 'store'
        || name.includes('محل')
        || name.includes('المخزن')
        || name.includes('store')
        || name.includes('shop')
    );
};

const mergeInventoryMetrics = (
    a: ChannelInventoryMetrics,
    b: ChannelInventoryMetrics
): ChannelInventoryMetrics => ({
    products: Math.max(a.products, b.products),
    pieces: Math.max(a.pieces, b.pieces),
    purchaseCost: Math.max(a.purchaseCost, b.purchaseCost),
});

const resolveChannelTypeLabel = (rawType: any, isAr: boolean): string => {
    const t = normalizeType(rawType);
    if (!t) return isAr ? 'غير محدد' : 'Unspecified';
    const map: Record<string, { ar: string; en: string }> = {
        amazon_merchant: { ar: 'أمازون تاجر', en: 'Amazon Merchant' },
        amazon_fba: { ar: 'أمازون FBA', en: 'Amazon FBA' },
        noon_merchant: { ar: 'نون تاجر', en: 'Noon Merchant' },
        noon_fbn: { ar: 'نون FBN', en: 'Noon FBN' },
        jumia_merchant: { ar: 'جوميا تاجر', en: 'Jumia Merchant' },
        jumia_fbn: { ar: 'جوميا FBN', en: 'Jumia FBN' },
        website: { ar: 'موقع إلكتروني', en: 'Website' },
        pos: { ar: 'متجر فعلي (POS)', en: 'POS' },
        custom: { ar: 'مخصص', en: 'Custom' },
    };
    const hit = map[t];
    if (hit) return isAr ? hit.ar : hit.en;
    return t.replaceAll('_', ' ');
};

const resolvePlatformKey = (channel: any): string => {
    const t = normalizeType(channel?.type);
    if (t.startsWith('amazon')) return 'amazon';
    if (t.startsWith('noon')) return 'noon';
    if (t.startsWith('jumia')) return 'jumia';
    if (t === 'website') return 'website';
    if (t === 'pos' || t === 'store' || t === 'physical') return 'store';
    const slug = normalizeType(channel?.slug);
    if (slug in staticChannelMeta) return slug;
    const name = normalizeType(channel?.name);
    if (name.includes('amazon')) return 'amazon';
    if (name.includes('noon') || name.includes('نون')) return 'noon';
    if (name.includes('jumia') || name.includes('جوميا')) return 'jumia';
    return 'custom';
};

export function ChannelsWidget() {
    const { language, t } = useLanguage();
    const isAr = language === 'ar';
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [formData, setFormData] = useState({ name: "", slug: "", type: "amazon_merchant", merchant_identifier: "", account_label: "" });
    const [editingChannel, setEditingChannel] = useState<any | null>(null);
    const [editData, setEditData] = useState({ merchant_identifier: "", account_label: "" });

    const { data: rawChannels = [], isLoading: channelsLoading } = useQuery({
        queryKey: ['channels'],
        queryFn: () => api.getArray('/channels'),
        staleTime: 120_000,
        placeholderData: (prev) => prev,
    });
    const channels = useMemo(() => rawChannels.filter((c: any) => c.is_active !== false), [rawChannels]);
    const { data: warehouses = [] } = useQuery({
        queryKey: ['warehouses'],
        queryFn: () => api.getArray('/warehouses'),
        staleTime: 120_000,
        placeholderData: (prev) => prev,
    });
    const { data: warehouseSummary = [], isLoading: summaryLoading } = useQuery({
        queryKey: ['warehouses-summary'],
        queryFn: () => api.getArray('/warehouses/summary'),
        staleTime: 120_000,
        placeholderData: (prev) => prev,
    });

    const mainStoreLocationId = useMemo(() => {
        const storeChannel = channels.find((c: any) => isLocalStoreChannel(c));
        if (!storeChannel) return 0;
        const linked = (warehouses || []).find(
            (w: any) => String(w?.channel_id ?? '') === String(storeChannel.id)
        );
        return linked ? Number(linked.id) : 0;
    }, [channels, warehouses]);

    /**
     * A channel can own more than one location row; the backend stamps the same channel-level
     * totals onto every one of them. Dedupe once here so nothing downstream double-counts a
     * multi-location channel (see {@link dedupeWarehouseSummaryRows}).
     */
    const dedupedWarehouseSummary = useMemo(
        () => dedupeWarehouseSummaryRows(warehouseSummary || []),
        [warehouseSummary]
    );

    const warehouseMetrics = useMemo(() => {
        const map: Record<string, ChannelInventoryMetrics> = {};
        dedupedWarehouseSummary.forEach((row: any) => {
            map[String(row.id)] = {
                products: Number(row?.total_items || 0),
                pieces: Number(row?.total_quantity || 0),
                purchaseCost: Number(row?.total_cost || 0),
            };
        });
        return map;
    }, [dedupedWarehouseSummary]);

    /** Per-channel rollup from cached warehouse summary (same source as top KPI card). */
    const channelMetricsFromWarehouses = useMemo(() => {
        const map: Record<string, ChannelInventoryMetrics> = {};
        (warehouses || []).forEach((w: any) => {
            const channelId = w?.channel_id;
            if (channelId == null || channelId === '') return;
            const whMetrics = warehouseMetrics[String(w.id)];
            if (!whMetrics) return;
            const key = String(channelId);
            map[key] = mergeInventoryMetrics(map[key] || { products: 0, pieces: 0, purchaseCost: 0 }, whMetrics);
        });
        return map;
    }, [warehouses, warehouseMetrics]);

    const physicalWarehouseMetrics = useMemo((): ChannelInventoryMetrics => {
        const physicalRows = dedupedWarehouseSummary.filter((row) => isPhysicalWarehouseRow(row, mainStoreLocationId));
        if (physicalRows.length === 0) {
            return { products: 0, pieces: 0, purchaseCost: 0 };
        }
        return physicalRows.reduce(
            (acc, row: any) => ({
                products: acc.products + Number(row?.total_items || 0),
                pieces: acc.pieces + Number(row?.total_quantity || 0),
                purchaseCost: acc.purchaseCost + Number(row?.total_cost || 0),
            }),
            { products: 0, pieces: 0, purchaseCost: 0 }
        );
    }, [dedupedWarehouseSummary, mainStoreLocationId]);

    /** Show platform cards as soon as channel list is known; metrics fill in when summary arrives. */
    const metricsPending = summaryLoading && warehouseSummary.length === 0;
    const showInitialSpinner = channelsLoading && channels.length === 0;

    const renderMetricValue = (value: number, className = "font-bold leading-none") => {
        if (metricsPending) {
            return <span className={`inline-block h-3.5 w-14 bg-muted/80 animate-pulse rounded ${className}`} />;
        }
        return <span className={className}>{value.toLocaleString()}</span>;
    };

    const createMutation = useMutation({
        mutationFn: (newChannel: any) => api.post('/channels', newChannel),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['channels'] });
            toast.success(isAr ? "تمت إضافة القناة بنجاح" : "Channel added successfully");
            setIsDialogOpen(false);
            setFormData({ name: "", slug: "", type: "marketplace", merchant_identifier: "", account_label: "" });
        },
        onError: () => {
            toast.error(isAr ? "فشل إضافة القناة" : "Failed to add channel");
        }
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, payload }: { id: string; payload: any }) => api.put(`/channels/${id}`, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['channels'] });
            toast.success(isAr ? "تم تحديث إعدادات الحساب" : "Account mapping updated");
            setEditingChannel(null);
        },
        onError: () => {
            toast.error(isAr ? "فشل تحديث إعدادات الحساب" : "Failed to update mapping");
        }
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => api.delete(`/channels/${id}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['channels'] });
            toast.success(isAr ? "تم حذف القناة" : "Channel deleted");
        },
        onError: () => {
            toast.error(isAr ? "فشل حذف القناة" : "Failed to delete channel");
        }
    });

    const handleSave = () => {
        const cleanName = String(formData.name || '').trim();
        const autoSlug = cleanName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]+/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const slug = String(formData.slug || '').trim() || autoSlug || `channel-${Date.now()}`;
        if (!cleanName) {
            toast.error(isAr ? "الاسم والكود مطلوبان" : "Name and slug are required");
            return;
        }
        // Keep slug internal: auto-generated from name to reduce confusion.
        createMutation.mutate({ ...formData, name: cleanName, slug });
    };

    const normalizeName = (value: any) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();

    const displayChannels = channels.length > 0
        ? channels.map((c: any) => {
            const platformKey = resolvePlatformKey(c);
            const meta = staticChannelMeta[platformKey] || defaultMeta;
            const isMerchant = normalizeType(c?.type).includes('merchant');
            const typeLabel = resolveChannelTypeLabel(c?.type, isAr);
            const channelMetric = channelMetricsFromWarehouses[String(c.id)] || { products: 0, pieces: 0, purchaseCost: 0 };
            const metrics = isLocalStoreChannel(c)
                ? mergeInventoryMetrics(channelMetric, physicalWarehouseMetrics)
                : channelMetric;
            return {
                ...c,
                ...meta,
                path: c.slug.toLowerCase() === 'amazon' ? meta.path : `/channels/${c.slug}`,
                ordersPath: c.slug.toLowerCase() === 'amazon' ? meta.ordersPath : `/orders?channel=${c.slug}`,
                paymentsPath: c.slug.toLowerCase() === 'amazon' ? meta.paymentsPath : `/reconciliation/${c.slug}`,
                // Visual identity & deduction hint
                is_merchant: isMerchant,
                type_label: typeLabel,
                // Override the tiny type chips to show meaningful mapping (merchant vs fulfillment)
                types: [typeLabel],
                metrics: {
                    products: metrics.products,
                    pieces: metrics.pieces,
                    /** Same rollup as channel detail page: qty at channel scope × master purchase cost. */
                    purchaseCost: metrics.purchaseCost,
                },
            };
        }) : [];

    const displayWarehouses = (warehouses || []).map((w: any) => {
        const metrics = warehouseMetrics[String(w.id)] || { products: 0, pieces: 0, purchaseCost: 0 };

        return {
            ...w,
            icon: Warehouse,
            color: String(w?.type || '').toLowerCase() === 'channel'
                ? "bg-orange-500/10 text-orange-600"
                : "bg-blue-500/10 text-blue-600",
            path: `/stores/${w.id}`,
            ordersPath: `/sales?warehouse=${w.id}`,
            paymentsPath: `/inventory/by/location?location=${w.id}`,
            types: [String(w?.type || 'warehouse').replace('_', ' ')],
            metrics: {
                products: metrics.products,
                pieces: metrics.pieces,
                purchaseCost: metrics.purchaseCost,
            },
        };
    });

    const channelIdSet = useMemo(() => new Set((displayChannels || []).map((c: any) => String(c.id))), [displayChannels]);
    const channelNameSet = useMemo(() => new Set((displayChannels || []).map((c: any) => normalizeName(c.name))), [displayChannels]);

    const standaloneWarehouses = useMemo(
        () => (displayWarehouses || []).filter((w: any) => {
            const byChannelId = w?.channel_id && channelIdSet.has(String(w.channel_id));
            const byNameAsChannel = channelNameSet.has(normalizeName(w?.name));
            return !byChannelId && !byNameAsChannel;
        }),
        [displayWarehouses, channelIdSet, channelNameSet]
    );

    const mergedCards = useMemo(() => {
        const channelsCards = (displayChannels || []).map((channel: any) => ({ ...channel, entity: 'channel' }));
        const warehouseCards = (standaloneWarehouses || []).map((warehouse: any) => ({ ...warehouse, entity: 'warehouse' }));
        return [...channelsCards, ...warehouseCards];
    }, [displayChannels, standaloneWarehouses]);

    const actionLabels = useMemo(() => {
        return {
            browse: isAr ? "المنتجات" : "Products",
            orders: isAr ? "الطلبات" : "Orders",
            payments: isAr ? "الحسابات" : "Accounts",
        };
    }, [isAr]);

    return (
        <div className="space-y-4 mb-4">
            <div className="flex justify-between items-end border-b pb-2">
                <div>
                    <h2 className="text-sm font-bold">{isAr ? "أماكن البيع والمخازن" : "Selling places & warehouses"}</h2>
                </div>
                <div>
                    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                        <DialogTrigger asChild>
                            <Button size="sm" variant="outline" className="h-7 text-xs px-2 gap-1 bg-white dark:bg-slate-900 border shadow-sm">
                                <Plus className="w-3 h-3" />
                                {isAr ? "إضافة مكان بيع" : "Add selling place"}
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>{isAr ? "إضافة قناة مبيعات جديدة" : "Add New Sales Channel"}</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-3 py-3">
                                <div className="space-y-1.5">
                                    <Label className="text-sm">{isAr ? "اسم القناة" : "Channel Name"}</Label>
                                    <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Amazon EG" />
                                </div>
                                {/* Slug is auto-generated from name to avoid confusing users. */}
                                <div className="space-y-1.5">
                                    <Label className="text-sm">{isAr ? "النوع" : "Type"}</Label>
                                    <Select value={formData.type} onValueChange={v => setFormData({ ...formData, type: v })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="amazon_merchant">{isAr ? "أمازون تاجر" : "Amazon Merchant"}</SelectItem>
                                            <SelectItem value="amazon_fba">{isAr ? "أمازون FBA" : "Amazon FBA"}</SelectItem>
                                            <SelectItem value="noon_merchant">{isAr ? "نون تاجر" : "Noon Merchant"}</SelectItem>
                                            <SelectItem value="noon_fbn">{isAr ? "نون FBN" : "Noon FBN"}</SelectItem>
                                            <SelectItem value="jumia_merchant">{isAr ? "جوميا تاجر" : "Jumia Merchant"}</SelectItem>
                                            <SelectItem value="jumia_fbn">{isAr ? "جوميا FBN" : "Jumia FBN"}</SelectItem>
                                            <SelectItem value="website">{isAr ? "موقع إلكتروني" : "Website (E-commerce)"}</SelectItem>
                                            <SelectItem value="pos">{isAr ? "متجر فعلي (POS)" : "Physical Store (POS)"}</SelectItem>
                                            <SelectItem value="custom">{isAr ? "مخصص" : "Custom"}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-sm">{isAr ? "معرّف التاجر" : "Merchant Identifier"}</Label>
                                    <Input value={formData.merchant_identifier} onChange={e => setFormData({ ...formData, merchant_identifier: e.target.value })} placeholder="e.g. 250037557812" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-sm">{isAr ? "اسم الحساب" : "Account Label (optional)"}</Label>
                                    <Input value={formData.account_label} onChange={e => setFormData({ ...formData, account_label: e.target.value })} placeholder="e.g. Phyzioline Amazon" />
                                </div>
                                <Button onClick={handleSave} className="w-full mt-2" size="sm" disabled={createMutation.isPending}>
                                    {createMutation.isPending ? t('common.saving') : (isAr ? "حفظ" : "Save")}
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {showInitialSpinner ? (
                <div className="flex items-center justify-center py-4">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
                </div>
            ) : mergedCards.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                    {isAr ? "لا توجد قنوات أو مخازن بعد." : "No channels or warehouses yet."}
                </p>
            ) : (
                <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {mergedCards.map((card: any) => (
                        <Card
                            key={`${card.entity}-${card.id}`}
                            className="overflow-hidden bg-white dark:bg-slate-900 shadow-sm border border-border/50 hover:border-primary/20 transition-all"
                        >
                            <CardHeader className="p-3 pb-2 space-y-0 relative">
                                <div className="flex items-start justify-between">
                                    <div className="flex flex-col gap-1">
                                        <div
                                            className={`w-9 h-9 rounded-lg flex items-center justify-center overflow-hidden ${
                                                card.logo ? "bg-white dark:bg-slate-950 border border-border/60" : card.color
                                            }`}
                                        >
                                            {card.logo ? (
                                                <img
                                                    src={card.logo}
                                                    alt={String(card.name || "")}
                                                    className="w-full h-full object-contain p-1"
                                                    loading="lazy"
                                                />
                                            ) : (
                                                <card.icon className="w-4.5 h-4.5" />
                                            )}
                                        </div>
                                        <div className="font-semibold text-[12px] leading-tight mt-1 line-clamp-2 min-h-[30px]">
                                            {card.name}
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        {card.types.map((typeValue: string) => (
                                            <span key={typeValue} className="text-[8px] bg-secondary/80 text-secondary-foreground font-medium px-1.5 py-0.5 rounded leading-none">{typeValue}</span>
                                        ))}
                                            {card.entity === 'channel' && card.is_merchant && (
                                                <span className="text-[8px] bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 font-semibold px-1.5 py-0.5 rounded leading-none">
                                                    {isAr ? "خصم من المحل" : "Store deduction"}
                                                </span>
                                            )}
                                        {card.entity === 'channel' && (
                                            <div className="flex items-center gap-1 mt-0.5">
                                                <button
                                                    type="button"
                                                    className="text-muted-foreground hover:text-foreground"
                                                    title={isAr ? "تعديل" : "Edit"}
                                                    onClick={() => { setEditingChannel(card); setEditData({ merchant_identifier: card.merchant_identifier || "", account_label: card.account_label || "" }); }}
                                                >
                                                    <Pencil className="w-3 h-3" />
                                                </button>
                                                <button
                                                    type="button"
                                                    className="text-muted-foreground hover:text-destructive"
                                                    title={isAr ? "حذف" : "Delete"}
                                                    disabled={deleteMutation.isPending}
                                                    onClick={() => {
                                                        const ok = window.confirm(isAr ? `حذف القناة "${card.name}"؟` : `Delete channel "${card.name}"?`);
                                                        if (!ok) return;
                                                        deleteMutation.mutate(String(card.id));
                                                    }}
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                {(card.account_label || card.merchant_identifier) && (
                                    <div className="mt-1 flex gap-1 items-center flex-wrap">
                                        {card.account_label && <span className="text-[8px] text-muted-foreground bg-muted/40 px-1 rounded truncate max-w-full">{card.account_label}</span>}
                                        {card.merchant_identifier && <span className="text-[8px] text-muted-foreground font-mono bg-muted/40 px-1 rounded truncate max-w-[60px]">{card.merchant_identifier}</span>}
                                    </div>
                                )}
                            </CardHeader>
                            <CardContent className="p-3 pt-0">
                                <div className="bg-muted/10 rounded-md border p-2 mb-2 text-[10px]">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex flex-col gap-0.5 min-w-0">
                                            <span className="text-[9px] text-muted-foreground">{isAr ? "منتجات" : "Products"}</span>
                                            <span className="font-bold leading-none flex items-center gap-1 flex-wrap">
                                                {renderMetricValue(Number(card.metrics?.products || 0))}
                                                {!metricsPending && (
                                                    <>
                                                        <span className="text-muted-foreground font-normal">·</span>
                                                        <span className="text-[9px] font-semibold text-muted-foreground">
                                                            {Number(card.metrics?.pieces || 0).toLocaleString()} {isAr ? "قطعة" : "pcs"}
                                                        </span>
                                                    </>
                                                )}
                                            </span>
                                        </div>
                                        <div className="flex flex-col gap-0.5 items-end shrink-0">
                                            <span className="text-[9px] text-muted-foreground">{isAr ? "التكلفة" : "Cost"}</span>
                                            {metricsPending ? (
                                                renderMetricValue(0, "font-bold leading-none text-blue-600 dark:text-blue-400")
                                            ) : (
                                                <span className="font-bold leading-none text-blue-600 dark:text-blue-400">
                                                    {Number(card.metrics?.purchaseCost || 0).toLocaleString()}{' '}
                                                    <span className="text-[8px] font-normal">EGP</span>
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-1.5 mt-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-10 px-1 flex flex-col items-center justify-center gap-0.5 bg-background hover:bg-muted font-medium text-muted-foreground hover:text-foreground"
                                        onClick={() => navigate(card.path)}
                                    >
                                        <LayoutGrid className="w-4 h-4 opacity-70" />
                                        <span className="text-[10px] leading-none">{actionLabels.browse}</span>
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-10 px-1 flex flex-col items-center justify-center gap-0.5 bg-background hover:bg-muted font-medium text-muted-foreground hover:text-foreground"
                                        onClick={() => navigate(card.ordersPath)}
                                    >
                                        <ListOrdered className="w-4 h-4 opacity-70" />
                                        <span className="text-[10px] leading-none">{actionLabels.orders}</span>
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-10 px-1 flex flex-col items-center justify-center gap-0.5 bg-background hover:bg-muted font-medium text-muted-foreground hover:text-foreground"
                                        onClick={() => navigate(card.paymentsPath)}
                                    >
                                        <CreditCard className="w-4 h-4 opacity-70" />
                                        <span className="text-[10px] leading-none">{actionLabels.payments}</span>
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            <Dialog open={!!editingChannel} onOpenChange={(open) => !open && setEditingChannel(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="text-base">{isAr ? "مُعرف المنصة" : "Market Identifier"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <div className="space-y-1.5">
                            <Label className="text-sm">{isAr ? "معرّف التاجر" : "Merchant Identifier"}</Label>
                            <Input value={editData.merchant_identifier} onChange={(e) => setEditData((p) => ({ ...p, merchant_identifier: e.target.value }))} placeholder="250037557812" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-sm">{isAr ? "اسم الحساب" : "Account Label"}</Label>
                            <Input value={editData.account_label} onChange={(e) => setEditData((p) => ({ ...p, account_label: e.target.value }))} placeholder="Amazon Seller" />
                        </div>
                        <Button className="w-full mt-2" size="sm" disabled={updateMutation.isPending || !editingChannel} onClick={() => editingChannel && updateMutation.mutate({ id: String(editingChannel.id), payload: { merchant_identifier: editData.merchant_identifier || null, account_label: editData.account_label || null } })}>
                            {updateMutation.isPending ? (isAr ? "حفظ..." : "Saving...") : (isAr ? "حفظ" : "Save")}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
