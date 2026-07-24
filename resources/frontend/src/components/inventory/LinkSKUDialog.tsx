import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Search, Package, Link as LinkIcon, Plus } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getProductImageSrc } from '@/lib/utils';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sku: any;
}

export default function LinkSKUDialog({ open, onOpenChange, sku }: Props) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [selectedMasterId, setSelectedMasterId] = useState<string | null>(null);
    const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search.trim());
        }, 250);
        return () => clearTimeout(timer);
    }, [search]);

    const { data: products, isLoading: loadingProducts } = useQuery({
        queryKey: ['master-products-search', debouncedSearch, open],
        queryFn: () =>
            api.getArray(
                `/master-products?compact=1&include_channels=1&limit=50&search=${encodeURIComponent(debouncedSearch)}`
            ),
        enabled: open && debouncedSearch.length >= 1 && !selectedMasterId,
    });

    const { data: offers, isLoading: loadingOffers } = useQuery({
        queryKey: ['product-offers', selectedMasterId],
        queryFn: () => api.getArray(`/inventory-offers?master_product_id=${selectedMasterId}`),
        enabled: !!selectedMasterId,
    });

    const linkMutation = useMutation({
        mutationFn: (offerId: string) => {
            return api.put(`/skus/${sku.id}`, { offer_id: offerId });
        },
        onSuccess: () => {
            toast({
                title: 'تم الربط بنجاح',
                description: 'تم ربط المنتج بالمنتج الرئيسي وتفعيل المزامنة.',
            });
            queryClient.invalidateQueries({ queryKey: ['channel-skus'] });
            onOpenChange(false);
        },
    });

    const sortedProducts = useMemo(() => {
        const rows = Array.isArray(products) ? [...products] : [];
        rows.sort((a: any, b: any) => {
            const aStore = Boolean(a?.has_store_sku);
            const bStore = Boolean(b?.has_store_sku);
            if (aStore !== bStore) return aStore ? -1 : 1;
            const aCh = Array.isArray(a?.channels) ? a.channels.length : 0;
            const bCh = Array.isArray(b?.channels) ? b.channels.length : 0;
            if (aCh !== bCh) return bCh - aCh;
            return String(a?.internal_name || '').localeCompare(String(b?.internal_name || ''), undefined, { sensitivity: 'base' });
        });
        return rows;
    }, [products]);

    const badgeMeta = (ch: any) => {
        const name = String(ch?.name || '').toLowerCase();
        const slug = String(ch?.slug || '').toLowerCase();
        const hay = `${name} ${slug}`;
        if (hay.includes('fba') || hay.includes('afn')) {
            return { label: 'FBA', className: 'bg-orange-500/10 text-orange-700 border-orange-500/20 dark:text-orange-300' };
        }
        if (hay.includes('fbm') || hay.includes('mfn') || hay.includes('merchant') || hay.includes('تاجر')) {
            return { label: 'تاجر', className: 'bg-sky-500/10 text-sky-700 border-sky-500/20 dark:text-sky-300' };
        }
        if (hay.includes('store') || hay.includes('shop') || hay.includes('main') || hay.includes('المحل') || hay.includes('physical')) {
            return { label: 'المحل', className: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300' };
        }
        return { label: ch?.name || 'قناة', className: 'bg-slate-500/10 text-slate-700 border-slate-500/20 dark:text-slate-300' };
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <LinkIcon className="w-5 h-5 text-primary" />
                        ربط بمنتج رئيسي
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border border-border/50 flex items-center gap-3">
                        <div className="w-10 h-10 rounded border bg-white flex items-center justify-center">
                            {sku?.image_url ? <img src={getProductImageSrc(sku.image_url)} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <Package className="w-4 h-4" />}
                        </div>
                        <div>
                            <p className="text-sm font-bold">{sku?.name}</p>
                            <p className="text-[10px] font-mono text-muted-foreground uppercase">{sku?.sku}</p>
                        </div>
                    </div>

                    {!selectedMasterId ? (
                        <div className="space-y-3">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="ابحث عن منتج بالاسم أو SKU المورد..."
                                    className="pl-9"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>

                            <ScrollArea className="h-[300px] border rounded-lg p-2">
                                {debouncedSearch.length < 1 ? (
                                    <p className="text-center py-8 text-muted-foreground text-sm">
                                        ابدأ الكتابة للبحث السريع...
                                    </p>
                                ) : loadingProducts ? (
                                    <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                                ) : (products || []).length === 0 ? (
                                    <p className="text-center py-8 text-muted-foreground text-sm">لا توجد منتجات مطابقة.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {sortedProducts.map((p: any) => (
                                            <div
                                                key={p.id}
                                                className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer flex items-center justify-between group"
                                                onClick={() => setSelectedMasterId(p.id)}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded border bg-white flex items-center justify-center overflow-hidden">
                                                        {p.image_url ? <img src={getProductImageSrc(p.image_url)} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <Package className="w-3 h-3 text-slate-300" />}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-medium">{p.internal_name}</p>
                                                        <p className="text-[10px] text-muted-foreground">{p.original_supplier_sku || 'No SKU'}</p>
                                                        <div className="mt-1 flex flex-wrap gap-1">
                                                            {Boolean(p?.has_store_sku) ? (
                                                                <Badge variant="outline" className="text-[10px] border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                                                                    المنتج الأساسي (المحل)
                                                                </Badge>
                                                            ) : null}
                                                            {Array.isArray(p?.channels) && p.channels.length > 0 ? (
                                                                p.channels.slice(0, 6).map((ch: any) => {
                                                                    const meta = badgeMeta(ch);
                                                                    return (
                                                                        <Badge key={String(ch?.id ?? meta.label)} variant="outline" className={`text-[10px] ${meta.className}`}>
                                                                            {meta.label}
                                                                        </Badge>
                                                                    );
                                                                })
                                                            ) : (
                                                                <Badge variant="outline" className="text-[10px] text-slate-500">
                                                                    بدون قنوات بيع
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100">اختر</Button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </ScrollArea>
                        </div>
                    ) : (
                        <div className="space-y-4 animate-in slide-in-from-right-2 duration-200">
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-bold">اختر البديل (Variation):</p>
                                <Button variant="link" size="sm" onClick={() => setSelectedMasterId(null)}>تغيير المنتج</Button>
                            </div>

                            <div className="grid grid-cols-1 gap-2">
                                {loadingOffers ? (
                                    <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                                ) : (offers || []).map((o: any) => (
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
                                <Button variant="outline" className="border-dashed py-6 gap-2" onClick={() => {
                                    // Logic to create new variation would go here
                                    toast({ title: 'قريباً', description: 'إضافة بديل جديد من هنا ستتوفر قريباً.' });
                                }}>
                                    <Plus className="w-4 h-4" />
                                    إضافة بديل (Offer) جديد
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
                    <Button
                        disabled={!selectedOfferId || linkMutation.isPending}
                        onClick={() => linkMutation.mutate(selectedOfferId!)}
                        className="min-w-[120px]"
                    >
                        {linkMutation.isPending ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <LinkIcon className="mr-2 h-4 w-4" />}
                        تأكيد الربط
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
