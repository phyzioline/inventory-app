import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, PackageOpen, PackagePlus, ArrowRight } from 'lucide-react';
import api from '@/lib/api';
import { offerService } from '@/lib/supabase-services';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
    buildCompositionSkuLocationOptions,
    pickCompositionDestOption,
    pickCompositionSourceOption,
} from '@/lib/compositionStockOptions';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The offer this action was launched from — may be the parent (kit) or a linked component. */
    offer: { id: string; name: string } | null;
}

function stockQtyBadgeClass(qty: number): string {
    if (qty > 0) return 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800';
    return 'bg-muted text-muted-foreground';
}

/**
 * Manual stock conversion between two linked offers: Unpack (1 parent unit -> ratio
 * component units) or Pack (ratio component units -> 1 parent unit), using the real
 * SkuInventory rows on each side. Not automatic — the user picks quantity and confirms.
 */
export default function UnpackStockDialog({ open, onOpenChange, offer }: Props) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<'unpack' | 'pack'>('unpack');
    const [selectedLinkId, setSelectedLinkId] = useState<string>('');
    const [parentSelection, setParentSelection] = useState('');
    const [componentSelection, setComponentSelection] = useState('');
    const [quantity, setQuantity] = useState('1');
    const destTouchedRef = useRef(false);

    const { data: componentsData, isLoading: loadingLinks } = useQuery({
        queryKey: ['offer-components', offer?.id],
        queryFn: () => offerService.getComponents(offer!.id),
        enabled: open && !!offer?.id,
    });

    // This offer can be either the kit (has its own components) or a component of
    // another kit (used_in) — normalize both into the same "link" shape so either
    // launch point works from the same dialog.
    const links = useMemo(() => {
        const asParent = (componentsData?.components || []).map((c: any) => ({
            id: c.id,
            parentOfferId: offer?.id,
            parentOfferName: offer?.name,
            componentOfferId: c.component_offer_id,
            componentOfferName: c.component_offer?.master_product?.internal_name || c.component_offer?.name,
            ratio: c.quantity_per,
        }));
        const asComponent = (componentsData?.used_in || []).map((u: any) => ({
            id: u.id,
            parentOfferId: u.parent_offer_id,
            parentOfferName: u.parent_offer?.master_product?.internal_name || u.parent_offer?.name,
            componentOfferId: offer?.id,
            componentOfferName: offer?.name,
            ratio: u.quantity_per,
        }));
        return [...asParent, ...asComponent];
    }, [componentsData, offer]);

    useEffect(() => {
        if (!open) return;
        setActiveTab('unpack');
        destTouchedRef.current = false;
        setSelectedLinkId('');
        setParentSelection('');
        setComponentSelection('');
        setQuantity('1');
    }, [open, offer?.id]);

    useEffect(() => {
        if (!selectedLinkId && links.length > 0) {
            setSelectedLinkId(links[0].id);
        }
    }, [links, selectedLinkId]);

    const activeLink = links.find((l) => String(l.id) === String(selectedLinkId)) || null;

    const { data: parentOfferDetail, isLoading: loadingParent } = useQuery({
        queryKey: ['offer-detail', activeLink?.parentOfferId],
        queryFn: () => api.get(`/inventory-offers/${activeLink!.parentOfferId}`),
        enabled: open && !!activeLink?.parentOfferId,
    });

    const { data: componentOfferDetail, isLoading: loadingComponent } = useQuery({
        queryKey: ['offer-detail', activeLink?.componentOfferId],
        queryFn: () => api.get(`/inventory-offers/${activeLink!.componentOfferId}`),
        enabled: open && !!activeLink?.componentOfferId,
    });

    const parentOptions = useMemo(() => buildCompositionSkuLocationOptions(parentOfferDetail), [parentOfferDetail]);
    const componentOptions = useMemo(() => buildCompositionSkuLocationOptions(componentOfferDetail), [componentOfferDetail]);

    useEffect(() => {
        destTouchedRef.current = false;
        setParentSelection('');
        setComponentSelection('');
    }, [activeTab, selectedLinkId]);

    useEffect(() => {
        if (!open || !activeLink) return;
        if (activeTab === 'unpack') {
            const src = parentSelection
                ? parentOptions.find((o) => o.value === parentSelection) ?? null
                : pickCompositionSourceOption(parentOptions);
            if (!parentSelection && src) {
                setParentSelection(src.value);
                return;
            }
            if (!destTouchedRef.current && src) {
                const dest = pickCompositionDestOption(componentOptions, src.locationId);
                if (dest && dest.value !== componentSelection) {
                    setComponentSelection(dest.value);
                }
            }
            return;
        }
        const src = componentSelection
            ? componentOptions.find((o) => o.value === componentSelection) ?? null
            : pickCompositionSourceOption(componentOptions);
        if (!componentSelection && src) {
            setComponentSelection(src.value);
            return;
        }
        if (!destTouchedRef.current && src) {
            const dest = pickCompositionDestOption(parentOptions, src.locationId);
            if (dest && dest.value !== parentSelection) {
                setParentSelection(dest.value);
            }
        }
    }, [open, activeTab, activeLink, parentOptions, componentOptions, parentSelection, componentSelection]);

    const parentPick = parentOptions.find((o) => o.value === parentSelection) || null;
    const componentPick = componentOptions.find((o) => o.value === componentSelection) || null;
    const ratio = Number(activeLink?.ratio || 1);
    const qtyNum = Math.max(0, parseInt(quantity, 10) || 0);

    const preview = activeTab === 'unpack'
        ? { valid: qtyNum > 0, resultQty: qtyNum * ratio, resultLabel: activeLink?.componentOfferName }
        : { valid: qtyNum > 0 && qtyNum % ratio === 0, resultQty: Math.floor(qtyNum / ratio), resultLabel: activeLink?.parentOfferName };

    const mutation = useMutation({
        mutationFn: () => {
            if (!activeLink || !parentPick || !componentPick) return Promise.reject(new Error('missing selection'));
            const payload = {
                component_offer_id: activeLink.componentOfferId,
                parent_sku_id: parentPick.skuId,
                parent_location_id: parentPick.locationId,
                component_sku_id: componentPick.skuId,
                component_location_id: componentPick.locationId,
                quantity: qtyNum,
            };
            return activeTab === 'unpack'
                ? offerService.unpack(activeLink.parentOfferId, payload)
                : offerService.pack(activeLink.parentOfferId, payload);
        },
        onSuccess: () => {
            toast({
                title: activeTab === 'unpack' ? 'تم الفك' : 'تم التجميع',
                description: 'تم تحديث المخزون بنجاح.',
            });
            queryClient.invalidateQueries({ queryKey: ['master-products'] });
            queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
            queryClient.invalidateQueries({ queryKey: ['offer-detail', activeLink?.parentOfferId] });
            queryClient.invalidateQueries({ queryKey: ['offer-detail', activeLink?.componentOfferId] });
            queryClient.invalidateQueries({ queryKey: ['offer-components', offer?.id] });
            onOpenChange(false);
        },
        onError: (error: any) => {
            const msg = error?.response?.data?.message
                || Object.values(error?.response?.data?.errors || {}).flat()[0]
                || 'تعذرت العملية.';
            toast({ title: 'خطأ', description: String(msg), variant: 'destructive' });
        },
    });

    const isLoading = loadingLinks || loadingParent || loadingComponent;
    const sourcePick = activeTab === 'unpack' ? parentPick : componentPick;
    const destPick = activeTab === 'unpack' ? componentPick : parentPick;
    const insufficient = !!sourcePick && qtyNum > sourcePick.qty;
    const crossWarehouse = !!sourcePick && !!destPick && sourcePick.locationId !== destPick.locationId;

    const setSourceSelection = (value: string) => {
        destTouchedRef.current = false;
        if (activeTab === 'unpack') setParentSelection(value);
        else setComponentSelection(value);
    };
    const setDestSelection = (value: string) => {
        destTouchedRef.current = true;
        if (activeTab === 'unpack') setComponentSelection(value);
        else setParentSelection(value);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {activeTab === 'unpack' ? <PackageOpen className="w-5 h-5 text-primary" /> : <PackagePlus className="w-5 h-5 text-primary" />}
                        فك / تجميع المخزون
                    </DialogTitle>
                </DialogHeader>

                {links.length === 0 && !loadingLinks ? (
                    <p className="text-center py-8 text-sm text-muted-foreground">
                        لا يوجد ربط تركيب لهذا العرض بعد. اضغط "ربط مكوّن" أولاً وحدد المنتج التاني والكمية، وبعدها هتقدر تفك أو تجمّع المخزون بينهم من هنا.
                    </p>
                ) : (
                    <div className="space-y-4 py-2">
                        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'unpack' | 'pack')}>
                            <TabsList className="grid grid-cols-2">
                                <TabsTrigger value="unpack">فك (Unpack)</TabsTrigger>
                                <TabsTrigger value="pack">تجميع (Pack)</TabsTrigger>
                            </TabsList>
                        </Tabs>

                        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                            {activeTab === 'unpack'
                                ? 'فك: بتاخد كمية من مخزون المنتج المجمّع (زي الكرتونة) وتحوّلها لقطع في مخزون المنتج المفرد المربوط بيه.'
                                : 'تجميع: العكس — بتاخد قطع من مخزون المنتج المفرد وتجمّعها لتكوين وحدات من المنتج المجمّع (زي تكوين كراتين من قطع فضلت).'}
                            {' '}الافتراضي نفس المخزن على المصدر والوجهة (مثلاً المحل → المحل).
                        </div>

                        {links.length > 1 && (
                            <div className="space-y-1.5">
                                <Label>الربط</Label>
                                <Select value={String(selectedLinkId)} onValueChange={setSelectedLinkId}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {links.map((l) => (
                                            <SelectItem key={l.id} value={String(l.id)}>
                                                {l.parentOfferName} = {l.ratio} × {l.componentOfferName}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {isLoading ? (
                            <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                        ) : activeLink ? (
                            <>
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    {activeTab === 'unpack' ? (
                                        <>{activeLink.parentOfferName} <ArrowRight className="h-3.5 w-3.5" /> {activeLink.componentOfferName} (× {ratio})</>
                                    ) : (
                                        <>{activeLink.componentOfferName} (× {ratio}) <ArrowRight className="h-3.5 w-3.5" /> {activeLink.parentOfferName}</>
                                    )}
                                </div>

                                <div className="space-y-1.5">
                                    <Label>{activeTab === 'unpack' ? `المصدر (${activeLink.parentOfferName})` : `المصدر (${activeLink.componentOfferName})`}</Label>
                                    <Select
                                        value={activeTab === 'unpack' ? parentSelection : componentSelection}
                                        onValueChange={setSourceSelection}
                                    >
                                        <SelectTrigger><SelectValue placeholder="اختر SKU وموقع" /></SelectTrigger>
                                        <SelectContent>
                                            {(activeTab === 'unpack' ? parentOptions : componentOptions).map((o) => (
                                                <SelectItem key={o.value} value={o.value}>
                                                    <span className="flex items-center gap-2">
                                                        {o.label}
                                                        <Badge variant="outline" className={cn('text-[10px] font-mono', stockQtyBadgeClass(o.qty))}>{o.qty}</Badge>
                                                    </span>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-1.5">
                                    <Label>{activeTab === 'unpack' ? `الوجهة (${activeLink.componentOfferName})` : `الوجهة (${activeLink.parentOfferName})`}</Label>
                                    <Select
                                        value={activeTab === 'unpack' ? componentSelection : parentSelection}
                                        onValueChange={setDestSelection}
                                    >
                                        <SelectTrigger><SelectValue placeholder="اختر SKU وموقع" /></SelectTrigger>
                                        <SelectContent>
                                            {(activeTab === 'unpack' ? componentOptions : parentOptions).map((o) => (
                                                <SelectItem key={o.value} value={o.value}>
                                                    <span className="flex items-center gap-2">
                                                        {o.label}
                                                        <Badge variant="outline" className={cn('text-[10px] font-mono', stockQtyBadgeClass(o.qty))}>{o.qty}</Badge>
                                                    </span>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-1.5">
                                    <Label>الكمية {activeTab === 'unpack' ? `(من ${activeLink.parentOfferName})` : `(من ${activeLink.componentOfferName})`}</Label>
                                    <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                                    {insufficient && (
                                        <p className="text-xs text-destructive">المخزون غير كافٍ (المتاح: {sourcePick?.qty}).</p>
                                    )}
                                    {activeTab === 'pack' && qtyNum > 0 && qtyNum % ratio !== 0 && (
                                        <p className="text-xs text-destructive">يجب أن تكون الكمية من مضاعفات {ratio}.</p>
                                    )}
                                </div>

                                <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
                                    {preview.valid ? (
                                        <span>→ ينتج <b>{preview.resultQty}</b> × {preview.resultLabel}</span>
                                    ) : (
                                        <span className="text-muted-foreground">أدخل كمية صالحة لمعاينة الناتج.</span>
                                    )}
                                    {sourcePick && destPick && (
                                        <p className="text-xs text-muted-foreground">
                                            من <b>{sourcePick.locationName}</b> → إلى <b>{destPick.locationName}</b>
                                        </p>
                                    )}
                                </div>
                                {crossWarehouse && (
                                    <p className="text-xs text-amber-700 dark:text-amber-400">
                                        تحذير: المصدر والوجهة مخازن مختلفة. الكمية هتتنقل بين المخزنين دول مش على نفس مكان العرض.
                                    </p>
                                )}
                            </>
                        ) : null}
                    </div>
                )}

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
                    <Button
                        disabled={!activeLink || !preview.valid || insufficient || mutation.isPending || !parentPick || !componentPick}
                        onClick={() => mutation.mutate()}
                        className="min-w-[120px]"
                    >
                        {mutation.isPending ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
                        تأكيد
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
