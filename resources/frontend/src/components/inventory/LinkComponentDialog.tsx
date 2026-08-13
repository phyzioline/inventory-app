import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Search, Package, Link as LinkIcon, ArrowLeft, AlertTriangle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { offerService } from '@/lib/supabase-services';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getProductImageSrc } from '@/lib/utils';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The "kit"/carton offer that will own the new component link. */
    parentOffer: { id: string; name: string } | null;
}

/**
 * Manual "Product B = N x Product A" linking dialog. Search-then-pick, same two-step
 * shape as LinkSKUDialog, plus a quantity_per input for the ratio.
 */
export default function LinkComponentDialog({ open, onOpenChange, parentOffer }: Props) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [selectedMasterId, setSelectedMasterId] = useState<string | null>(null);
    const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
    const [quantityPer, setQuantityPer] = useState('1');

    useEffect(() => {
        if (!open) return;
        setSearch('');
        setDebouncedSearch('');
        setSelectedMasterId(null);
        setSelectedOfferId(null);
        setQuantityPer('1');
    }, [open]);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
        return () => clearTimeout(timer);
    }, [search]);

    const { data: products, isLoading: loadingProducts } = useQuery({
        queryKey: ['master-products-search-component', debouncedSearch, open],
        queryFn: () => api.getArray(`/master-products?compact=1&limit=50&search=${encodeURIComponent(debouncedSearch)}`),
        enabled: open && debouncedSearch.length >= 1 && !selectedMasterId,
    });

    const { data: offers, isLoading: loadingOffers } = useQuery({
        queryKey: ['product-offers-for-link', selectedMasterId],
        queryFn: () => api.getArray(`/inventory-offers?master_product_id=${selectedMasterId}`),
        enabled: !!selectedMasterId,
    });

    const attachMutation = useMutation({
        mutationFn: () => {
            if (!parentOffer || !selectedOfferId) return Promise.reject(new Error('missing selection'));
            return offerService.attachComponent(parentOffer.id, {
                component_offer_id: selectedOfferId,
                quantity_per: Math.max(1, parseInt(quantityPer, 10) || 1),
            });
        },
        onSuccess: () => {
            toast({ title: 'تم الربط', description: 'تم ربط المكوّن بنجاح.' });
            queryClient.invalidateQueries({ queryKey: ['offer-components', parentOffer?.id] });
            onOpenChange(false);
        },
        onError: (error: any) => {
            const msg = error?.response?.data?.message
                || Object.values(error?.response?.data?.errors || {}).flat()[0]
                || 'تعذر إنشاء الربط.';
            toast({ title: 'خطأ', description: String(msg), variant: 'destructive' });
        },
    });

    const filteredOffers = useMemo(
        () => (offers || []).filter((o: any) => !parentOffer || String(o.id) !== String(parentOffer.id)),
        [offers, parentOffer]
    );

    const selectedOffer = useMemo(
        () => filteredOffers.find((o: any) => String(o.id) === String(selectedOfferId)) || null,
        [filteredOffers, selectedOfferId]
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <LinkIcon className="w-5 h-5 text-primary" />
                        ربط مكوّن بـ {parentOffer?.name || ''}
                    </DialogTitle>
                </DialogHeader>

                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex gap-2 items-start">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                        فتحت "ربط مكوّن" من على <b>{parentOffer?.name || 'هذا المنتج'}</b> — يبقى ده هو <b>العرض الأكبر</b> (الكرتونة/الطقم) وهيفضل ثابت.
                        دلوقتي هتختار العرض <b>الأصغر</b> (زي القطعة المفردة) اللي بيتكون منه.
                        {' '}لو ده غلط (يعني {parentOffer?.name || 'هذا المنتج'} هو في الحقيقة الأصغر)، اقفل الديالوج ده وافتح "ربط مكوّن" من على المنتج الكبير بدل كدا.
                    </span>
                </div>

                <div className="flex items-center justify-center gap-3 py-1">
                    <div className="flex-1 rounded-lg border-2 border-primary bg-primary/5 px-3 py-2 text-center">
                        <p className="text-[10px] text-muted-foreground">الأكبر (ثابت)</p>
                        <p className="text-sm font-bold truncate">{parentOffer?.name || '—'}</p>
                    </div>
                    <div className="flex flex-col items-center text-muted-foreground shrink-0">
                        <ArrowLeft className="w-4 h-4" />
                        <span className="text-[10px]">= {Math.max(1, parseInt(quantityPer, 10) || 1)} ×</span>
                    </div>
                    <div className={`flex-1 rounded-lg border-2 px-3 py-2 text-center ${selectedOffer ? 'border-emerald-500 bg-emerald-500/5' : 'border-dashed border-muted-foreground/40'}`}>
                        <p className="text-[10px] text-muted-foreground">الأصغر (بتختاره)</p>
                        <p className="text-sm font-bold truncate">{selectedOffer?.name || 'لسه ما اخترتش'}</p>
                    </div>
                </div>

                <div className="space-y-4 py-4">
                    {!selectedMasterId ? (
                        <div className="space-y-3">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="ابحث عن المنتج المكوّن..."
                                    className="pl-9"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>

                            <ScrollArea className="h-[280px] border rounded-lg p-2">
                                {debouncedSearch.length < 1 ? (
                                    <p className="text-center py-8 text-muted-foreground text-sm">ابدأ الكتابة للبحث...</p>
                                ) : loadingProducts ? (
                                    <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                                ) : (products || []).length === 0 ? (
                                    <p className="text-center py-8 text-muted-foreground text-sm">لا توجد منتجات مطابقة.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {(products || []).map((p: any) => (
                                            <div
                                                key={p.id}
                                                className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer flex items-center gap-3"
                                                onClick={() => setSelectedMasterId(p.id)}
                                            >
                                                <div className="w-8 h-8 rounded border bg-white flex items-center justify-center overflow-hidden shrink-0">
                                                    {p.image_url ? <img src={getProductImageSrc(p.image_url)} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <Package className="w-3 h-3 text-slate-300" />}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium">{p.internal_name}</p>
                                                    <p className="text-[10px] text-muted-foreground">{p.original_supplier_sku || 'بدون SKU مورّد'}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </ScrollArea>
                        </div>
                    ) : (
                        <div className="space-y-4 animate-in slide-in-from-right-2 duration-200">
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-bold">اختر العرض (Offer):</p>
                                <Button variant="link" size="sm" onClick={() => { setSelectedMasterId(null); setSelectedOfferId(null); }}>تغيير المنتج</Button>
                            </div>

                            <div className="grid grid-cols-1 gap-2">
                                {loadingOffers ? (
                                    <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                                ) : filteredOffers.length === 0 ? (
                                    <p className="text-center py-4 text-muted-foreground text-sm">لا توجد عروض مناسبة لهذا المنتج.</p>
                                ) : filteredOffers.map((o: any) => (
                                    <div
                                        key={o.id}
                                        className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${selectedOfferId === o.id ? 'border-primary bg-primary/5' : 'border-transparent bg-slate-50 dark:bg-slate-800 hover:border-slate-200'}`}
                                        onClick={() => setSelectedOfferId(o.id)}
                                    >
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="font-bold">{o.name}</span>
                                            <Badge variant="outline" className="text-[10px]">{o.type}</Badge>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {selectedOfferId && (
                                <div className="space-y-2 pt-2 border-t">
                                    <Label>كام وحدة من "{selectedOffer?.name}" في كل 1 × "{parentOffer?.name}"؟</Label>
                                    <Input
                                        type="number"
                                        min={1}
                                        value={quantityPer}
                                        onChange={(e) => setQuantityPer(e.target.value)}
                                    />
                                    <div className="rounded-lg bg-primary/10 border border-primary/30 px-3 py-2 text-sm font-medium text-center">
                                        1 × {parentOffer?.name} = {Math.max(1, parseInt(quantityPer, 10) || 1)} × {selectedOffer?.name}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
                    <Button
                        disabled={!selectedOfferId || attachMutation.isPending}
                        onClick={() => attachMutation.mutate()}
                        className="min-w-[120px]"
                    >
                        {attachMutation.isPending ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <LinkIcon className="mr-2 h-4 w-4" />}
                        تأكيد الربط
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
