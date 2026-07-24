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
    Globe,
    ShoppingCart,
    Store,
    Warehouse,
    ExternalLink,
    LayoutGrid,
    ListOrdered,
    CreditCard,
    Plus,
    Pencil,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { type ChannelInventoryMetrics } from "@/lib/channelInventoryMetrics";
import { toast } from "sonner";

const staticChannelMeta: Record<string, any> = {
    amazon: {
        icon: ShoppingCart,
        color: "bg-orange-500/10 text-orange-600",
        path: "/channels/amazon/asins",
        ordersPath: "/channels/amazon/orders",
        paymentsPath: "/reconciliation/amazon",
        types: ["FBA", "FBM"]
    },
    noon: {
        icon: Globe,
        color: "bg-yellow-400/10 text-yellow-600",
        path: "/channels/noon",
        ordersPath: "/orders?channel=noon",
        paymentsPath: "/reconciliation/noon",
        types: ["Normal"]
    },
    jumia: {
        icon: Globe,
        color: "bg-orange-700/10 text-orange-800",
        path: "/channels/jumia",
        ordersPath: "/orders?channel=jumia",
        paymentsPath: "/reconciliation/jumia",
        types: ["Normal"]
    },
    website: {
        icon: Globe,
        color: "bg-blue-500/10 text-blue-600",
        path: "/channels/website",
        ordersPath: "/orders?channel=website",
        paymentsPath: "/reconciliation/payment-gateway",
        types: ["Ecommerce"]
    },
    store: {
        icon: Store,
        color: "bg-green-500/10 text-green-600",
        path: "/channels/store",
        ordersPath: "/orders?channel=store",
        paymentsPath: "/finance/bank-accounts",
        types: ["POS"]
    },
    physical: {
        icon: Store,
        color: "bg-green-500/10 text-green-600",
        path: "/channels/store",
        ordersPath: "/orders?channel=store",
        paymentsPath: "/finance/bank-accounts",
        types: ["POS"]
    }
};

const defaultMeta = {
    icon: Globe,
    color: "bg-gray-500/10 text-gray-600",
    path: "/channels",
    ordersPath: "/orders",
    paymentsPath: "/reconciliation",
    types: ["Custom"]
};

const channelTypeOptions: Array<{ id: string; labelAr: string; labelEn: string; platform: 'amazon' | 'noon' | 'jumia' | 'website' | 'pos' | 'custom'; mode?: 'merchant' | 'fba' | 'fbn' | 'other' }> = [
    { id: 'amazon_merchant', labelAr: 'أمازون تاجر', labelEn: 'Amazon Merchant', platform: 'amazon', mode: 'merchant' },
    { id: 'amazon_fba', labelAr: 'أمازون FBA', labelEn: 'Amazon FBA', platform: 'amazon', mode: 'fba' },
    { id: 'noon_merchant', labelAr: 'نون تاجر', labelEn: 'Noon Merchant', platform: 'noon', mode: 'merchant' },
    { id: 'noon_fbn', labelAr: 'نون FBN', labelEn: 'Noon FBN', platform: 'noon', mode: 'fbn' },
    { id: 'jumia_merchant', labelAr: 'جوميا تاجر', labelEn: 'Jumia Merchant', platform: 'jumia', mode: 'merchant' },
    { id: 'jumia_fbn', labelAr: 'جوميا FBN', labelEn: 'Jumia FBN', platform: 'jumia', mode: 'fbn' },
    { id: 'website', labelAr: 'موقع إلكتروني', labelEn: 'Website (E-commerce)', platform: 'website', mode: 'other' },
    { id: 'pos', labelAr: 'متجر فعلي (POS)', labelEn: 'Physical Store (POS)', platform: 'pos', mode: 'other' },
    { id: 'custom', labelAr: 'مخصص', labelEn: 'Custom', platform: 'custom', mode: 'other' },
];

function normalizeType(raw: any): string {
    return String(raw || '').trim().toLowerCase();
}

function resolveChannelTypeLabel(rawType: any, isAr: boolean): string {
    const t = normalizeType(rawType);
    const found = channelTypeOptions.find((x) => x.id === t);
    if (found) return isAr ? found.labelAr : found.labelEn;
    if (!t) return isAr ? 'غير محدد' : 'Unspecified';
    return t.replaceAll('_', ' ');
}

function resolveChannelPlatformKey(channel: any): string {
    const t = normalizeType(channel?.type);
    if (t.startsWith('amazon')) return 'amazon';
    if (t.startsWith('noon')) return 'noon';
    if (t.startsWith('jumia')) return 'jumia';
    if (t === 'website') return 'website';
    if (t === 'pos' || t === 'store' || t === 'physical') return 'store';
    const slug = normalizeType(channel?.slug);
    if (staticChannelMeta[slug]) return slug;
    const name = normalizeType(channel?.name);
    if (name.includes('amazon')) return 'amazon';
    if (name.includes('noon') || name.includes('نون')) return 'noon';
    if (name.includes('jumia') || name.includes('جوميا')) return 'jumia';
    return 'custom';
}

export default function Channels() {
    const { language, t } = useLanguage();
    const isAr = language === 'ar';
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [formData, setFormData] = useState({ name: "", slug: "", type: "amazon_merchant", merchant_identifier: "", account_label: "" });
    const [editingChannel, setEditingChannel] = useState<any | null>(null);
    const [editData, setEditData] = useState({ merchant_identifier: "", account_label: "", type: "" });

    const { data: channels = [], isLoading } = useQuery({
        queryKey: ['channels'],
        queryFn: () => api.getArray('/channels')
    });
    const { data: warehouses = [] } = useQuery({
        queryKey: ['warehouses'],
        queryFn: () => api.getArray('/warehouses'),
    });
    const { data: warehouseSummary = [] } = useQuery({
        queryKey: ['warehouses-summary'],
        queryFn: () => api.getArray('/warehouses/summary'),
    });
    const { data: purchaseByLocation = [] } = useQuery({
        queryKey: ['purchases-summary-by-location'],
        queryFn: () => api.getArray('/purchases/smart-import/summary/by-location'),
    });
    const { data: channelMetrics = {} } = useQuery<Record<string, ChannelInventoryMetrics>>({
        queryKey: ['channels-metrics'],
        queryFn: () => api.get('/channels/metrics'),
    });

    const warehouseMetrics = useMemo(() => {
        const map: Record<string, ChannelInventoryMetrics> = {};
        (warehouseSummary || []).forEach((row: any) => {
            map[String(row.id)] = {
                products: Number(row?.total_items || 0),
                pieces: Number(row?.total_quantity || 0),
                purchaseCost: Number(row?.total_cost || 0),
            };
        });
        return map;
    }, [warehouseSummary]);

    const purchaseTotalsByLocation = useMemo(() => {
        const map: Record<string, number> = {};
        (purchaseByLocation || []).forEach((row: any) => {
            map[String(row?.location_id)] = Number(row?.total_purchase || 0);
        });
        return map;
    }, [purchaseByLocation]);

    const createMutation = useMutation({
        mutationFn: (newChannel: any) => api.post('/channels', newChannel),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['channels'] });
            toast.success(isAr ? "تمت إضافة القناة بنجاح" : "Channel added successfully");
            setIsDialogOpen(false);
            setFormData({ name: "", slug: "", type: "amazon_merchant", merchant_identifier: "", account_label: "" });
        },
        onError: (err: any) => {
            const message =
                err?.response?.data?.message ||
                (typeof err?.response?.data === 'string' ? err.response.data : null) ||
                (isAr ? "فشل إضافة القناة" : "Failed to add channel");
            toast.error(message);
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

    const handleSave = () => {
        const cleanName = String(formData.name || '').trim();
        const autoSlug = cleanName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]+/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const slug = String(formData.slug || '').trim() || autoSlug || `channel-${Date.now()}`;
        if (!cleanName) {
            toast.error(isAr ? "الاسم والكود مطلوبان" : "Name and slug are required");
            return;
        }
        createMutation.mutate({ ...formData, name: cleanName, slug });
    };

    const normalizeName = (value: any) =>
        String(value || '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();

    const displayChannels = channels.length > 0
        ? channels.map((c: any) => {
            const platformKey = resolveChannelPlatformKey(c);
            const meta = staticChannelMeta[platformKey] || staticChannelMeta[c.slug?.toLowerCase?.() || ''] || defaultMeta;
            const linkedLocation = (warehouses || []).find((w: any) => String(w?.channel_id || '') === String(c.id));
            const fallbackByName = !linkedLocation
                ? (warehouses || []).find((w: any) => normalizeName(w?.name) === normalizeName(c?.name))
                : null;
            return {
                ...c,
                ...meta,
                type_label: resolveChannelTypeLabel(c.type, isAr),
                is_merchant: normalizeType(c?.type).includes('merchant'),
                // Ensure custom channels have working paths
                path: c.slug.toLowerCase() === 'amazon' ? meta.path : `/channels/${c.slug}`,
                ordersPath: c.slug.toLowerCase() === 'amazon' ? meta.ordersPath : `/orders?channel=${c.slug}`,
                paymentsPath: c.slug.toLowerCase() === 'amazon' ? meta.paymentsPath : `/reconciliation/${c.slug}`,
                metrics: {
                    products: channelMetrics[String(c.id)]?.products || 0,
                    pieces: channelMetrics[String(c.id)]?.pieces || 0,
                    purchaseCost: channelMetrics[String(c.id)]?.purchaseCost || 0,
                },
            };
        })
        : [];

    const displayWarehouses = (warehouses || []).map((w: any) => ({
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
            products: warehouseMetrics[String(w.id)]?.products || 0,
            pieces: warehouseMetrics[String(w.id)]?.pieces || 0,
            purchaseCost: warehouseMetrics[String(w.id)]?.purchaseCost || 0,
        },
    }));

    const channelIdSet = useMemo(
        () => new Set((displayChannels || []).map((c: any) => String(c.id))),
        [displayChannels]
    );
    const channelNameSet = useMemo(
        () => new Set((displayChannels || []).map((c: any) => normalizeName(c.name))),
        [displayChannels]
    );

    const standaloneWarehouses = useMemo(
        () =>
            (displayWarehouses || []).filter((w: any) => {
                const byChannelId = w?.channel_id && channelIdSet.has(String(w.channel_id));
                const byNameAsChannel = channelNameSet.has(normalizeName(w?.name));
                return !byChannelId && !byNameAsChannel;
            }),
        [displayWarehouses, channelIdSet, channelNameSet]
    );

    const mergedCards = useMemo(() => {
        const channelsCards = (displayChannels || []).map((channel: any) => ({
            ...channel,
            entity: 'channel',
        }));
        const warehouseCards = (standaloneWarehouses || []).map((warehouse: any) => ({
            ...warehouse,
            entity: 'warehouse',
        }));
        return [...channelsCards, ...warehouseCards];
    }, [displayChannels, standaloneWarehouses]);

    return (
        <div className="p-6 space-y-6">
            <div className="flex justify-between items-start">
                <div>
                    <h1 className="text-3xl font-bold">{isAr ? "قنوات البيع" : "Sales Channels"}</h1>
                    <p className="text-muted-foreground">
                        {isAr ? "إدارة جميع المنصات والربط مع المنتجات الرئيسية" : "Manage all platforms and mapping with Master Products"}
                    </p>
                </div>
                <div className="flex gap-2">
                    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                        <DialogTrigger asChild>
                            <Button className="gap-2">
                                <Plus className="w-4 h-4" />
                                {isAr ? "إضافة قناة جديدة" : "Add New Channel"}
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>{isAr ? "إضافة قناة مبيعات جديدة" : "Add New Sales Channel"}</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                    <Label>{isAr ? "اسم القناة" : "Channel Name"}</Label>
                                    <Input
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        placeholder="e.g. Amazon EG"
                                    />
                                </div>
                                {/* Slug is auto-generated from name to avoid confusing users. */}
                                <div className="space-y-2">
                                    <Label>{isAr ? "نوع القناة (منطق الخصم)" : "Channel Type (deduction logic)"}</Label>
                                    <Select value={formData.type} onValueChange={v => setFormData({ ...formData, type: v })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {channelTypeOptions.map((opt) => (
                                                <SelectItem key={opt.id} value={opt.id}>
                                                    {isAr ? opt.labelAr : opt.labelEn}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>{isAr ? "معرّف التاجر (Amazon Merchant ID)" : "Merchant Identifier"}</Label>
                                    <Input
                                        value={formData.merchant_identifier}
                                        onChange={e => setFormData({ ...formData, merchant_identifier: e.target.value })}
                                        placeholder="e.g. 250037557812"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>{isAr ? "اسم الحساب (اختياري)" : "Account Label (optional)"}</Label>
                                    <Input
                                        value={formData.account_label}
                                        onChange={e => setFormData({ ...formData, account_label: e.target.value })}
                                        placeholder="e.g. Phyzioline Amazon"
                                    />
                                </div>
                                <Button onClick={handleSave} className="w-full" disabled={createMutation.isPending}>
                                    {createMutation.isPending ? t('common.saving') : (isAr ? "حفظ القناة" : "Save Channel")}
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
            ) : (
                <div className="space-y-4">
                    <h2 className="text-lg font-semibold">{isAr ? "القنوات والمستودعات" : "Channels & Warehouses"}</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {mergedCards.map((card: any) => (
                            <Card key={`${card.entity}-${card.id}`} className="overflow-hidden hover:shadow-lg transition-shadow border-2 border-transparent hover:border-primary/20">
                                <CardHeader className="flex flex-row items-center space-y-0 pb-2">
                                    <div className="flex-1">
                                        <CardTitle className="text-xl flex items-center gap-2">
                                            <div className={`p-2 rounded-lg ${card.color}`}>
                                                <card.icon className="w-5 h-5" />
                                            </div>
                                            {card.name}
                                        </CardTitle>
                                        <CardDescription className="mt-1">
                                            <Badge variant={card.is_merchant ? "default" : "secondary"} className="mr-1 text-[10px]">
                                                {card.type_label || '—'}
                                            </Badge>
                                            {card.is_merchant && (
                                                <Badge variant="outline" className="mr-1 text-[10px]">
                                                    {isAr ? "خصم من المحل" : "Deducts from Store"}
                                                </Badge>
                                            )}
                                            {(card.account_label || card.merchant_identifier) && (
                                                <div className="mt-2 flex flex-col gap-1">
                                                    {card.account_label && (
                                                        <span className="text-[11px] text-muted-foreground">{isAr ? "الحساب:" : "Account:"} {card.account_label}</span>
                                                    )}
                                                    {card.merchant_identifier && (
                                                        <span className="text-[11px] font-mono text-muted-foreground">MID: {card.merchant_identifier}</span>
                                                    )}
                                                </div>
                                            )}
                                        </CardDescription>
                                    </div>
                                    <div className="flex gap-1">
                                        {card.entity === 'channel' && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => {
                                                    setEditingChannel(card);
                                                    setEditData({
                                                        merchant_identifier: card.merchant_identifier || "",
                                                        account_label: card.account_label || "",
                                                        type: normalizeType(card.type) || "",
                                                    });
                                                }}
                                            >
                                                <Pencil className="w-4 h-4" />
                                            </Button>
                                        )}
                                        <Button variant="ghost" size="icon" onClick={() => navigate(card.path)}>
                                            <ExternalLink className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <div className="mb-3 rounded-md border bg-muted/20 px-3 py-2 text-xs space-y-1">
                                        <div className="flex items-center justify-between">
                                            <span className="text-muted-foreground">{isAr ? "منتجات" : "Products"}</span>
                                            <span className="font-semibold">
                                                {Number(card.metrics?.products || 0).toLocaleString()}
                                                <span className="text-muted-foreground font-normal mx-1">·</span>
                                                {Number(card.metrics?.pieces || 0).toLocaleString()} {isAr ? "قطعة" : "pcs"}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-muted-foreground">{isAr ? "تكلفة الشراء" : "Purchase Cost"}</span>
                                            <span className="font-semibold">{Number(card.metrics?.purchaseCost || 0).toLocaleString()} EGP</span>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 mt-4">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="flex flex-col h-auto py-2 gap-1 text-[10px]"
                                            onClick={() => navigate(card.path)}
                                        >
                                            <LayoutGrid className="w-4 h-4" />
                                            {isAr ? "المنتجات" : "Products"}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="flex flex-col h-auto py-2 gap-1 text-[10px]"
                                            onClick={() => navigate(card.ordersPath)}
                                        >
                                            <ListOrdered className="w-4 h-4" />
                                            {isAr ? "الطلبات" : "Orders"}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="flex flex-col h-auto py-2 gap-1 text-[10px]"
                                            onClick={() => navigate(card.paymentsPath)}
                                        >
                                            <CreditCard className="w-4 h-4" />
                                            {isAr ? "التسويات" : "Money"}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
            )}

            <Dialog open={!!editingChannel} onOpenChange={(open) => !open && setEditingChannel(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{isAr ? "إعداد ربط حساب القناة" : "Channel Account Mapping"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-3">
                        <div className="space-y-2">
                            <Label>{isAr ? "نوع القناة (منطق الخصم)" : "Channel Type (deduction logic)"}</Label>
                            <Select
                                value={editData.type || normalizeType(editingChannel?.type) || ''}
                                onValueChange={(v) => setEditData((p) => ({ ...p, type: v }))}
                            >
                                <SelectTrigger><SelectValue placeholder={isAr ? 'اختر النوع' : 'Select type'} /></SelectTrigger>
                                <SelectContent>
                                    {channelTypeOptions.map((opt) => (
                                        <SelectItem key={opt.id} value={opt.id}>
                                            {isAr ? opt.labelAr : opt.labelEn}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {!!(editData.type || editingChannel?.type) && (
                                <p className="text-[11px] text-muted-foreground">
                                    {normalizeType(editData.type || editingChannel?.type).includes('merchant')
                                        ? (isAr ? 'قناة تاجر: الطلبات تخصم من رصيد المحل الأساسي.' : 'Merchant channel: orders deduct from main store stock.')
                                        : (isAr ? 'قناة مستودع: الخصم من مستودع القناة.' : 'Fulfillment channel: deducts from channel warehouse.')}
                                </p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label>{isAr ? "معرّف التاجر (Merchant ID)" : "Merchant Identifier"}</Label>
                            <Input
                                value={editData.merchant_identifier}
                                onChange={(e) => setEditData((p) => ({ ...p, merchant_identifier: e.target.value }))}
                                placeholder="250037557812"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>{isAr ? "اسم الحساب" : "Account Label"}</Label>
                            <Input
                                value={editData.account_label}
                                onChange={(e) => setEditData((p) => ({ ...p, account_label: e.target.value }))}
                                placeholder="Phyzioline Amazon / Ard Amazon"
                            />
                        </div>
                        <Button
                            className="w-full"
                            disabled={updateMutation.isPending || !editingChannel}
                            onClick={() => editingChannel && updateMutation.mutate({
                                id: String(editingChannel.id),
                                payload: {
                                    type: editData.type || null,
                                    merchant_identifier: editData.merchant_identifier || null,
                                    account_label: editData.account_label || null,
                                },
                            })}
                        >
                            {updateMutation.isPending ? (isAr ? "جارٍ الحفظ..." : "Saving...") : (isAr ? "حفظ الربط" : "Save Mapping")}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
