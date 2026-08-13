import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, X, Check } from 'lucide-react';
import { offerService } from '@/lib/supabase-services';
import { useToast } from '@/hooks/use-toast';

interface Props {
    offer: { id: string; name: string };
}

function sumOfferStock(offer: any): number {
    const skus = Array.isArray(offer?.skus) ? offer.skus : [];
    return skus.reduce((total: number, sku: any) => {
        const rows = Array.isArray(sku?.inventory) ? sku.inventory : [];
        return total + rows.reduce((s: number, row: any) => s + Number(row?.quantity || 0), 0);
    }, 0);
}

/**
 * Shows this offer's own components as a small connected tree branch (a colored
 * trunk line with each linked product's name + stock hanging off it), so the
 * relationship is visible at a glance without opening a dialog. Also surfaces
 * (read-only) where this offer is used as someone else's component.
 */
export default function CompositionBadgeList({ offer }: Props) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editQty, setEditQty] = useState('1');

    const { data, isLoading } = useQuery({
        queryKey: ['offer-components', offer.id],
        queryFn: () => offerService.getComponents(offer.id),
        enabled: !!offer.id,
    });

    const components: any[] = data?.components || [];
    const usedIn: any[] = data?.used_in || [];

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['offer-components', offer.id] });

    const updateMutation = useMutation({
        mutationFn: (payload: { id: string; quantity_per: number }) =>
            offerService.updateComponent(payload.id, { quantity_per: payload.quantity_per }),
        onSuccess: () => {
            invalidate();
            setEditingId(null);
            toast({ title: 'تم التحديث', description: 'تم تحديث الكمية.' });
        },
        onError: () => toast({ title: 'خطأ', description: 'تعذر تحديث الكمية.', variant: 'destructive' }),
    });

    const deleteMutation = useMutation({
        mutationFn: (compositionId: string) => offerService.detachComponent(compositionId),
        onSuccess: () => {
            invalidate();
            toast({ title: 'تم الحذف', description: 'تم فك الربط.' });
        },
        onError: () => toast({ title: 'خطأ', description: 'تعذر فك الربط.', variant: 'destructive' }),
    });

    if (isLoading) {
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />;
    }

    if (components.length === 0 && usedIn.length === 0) {
        return null;
    }

    return (
        <div className="space-y-2">
            {components.length > 0 && (
                <div className="border-r-2 border-primary/40 pr-3 mr-1 py-0.5 space-y-1.5">
                    {components.map((c: any) => {
                        const name = c.component_offer?.master_product?.internal_name || c.component_offer?.name || '—';
                        const stock = sumOfferStock(c.component_offer);
                        return (
                            <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-2 py-1 text-xs">
                                {editingId === c.id ? (
                                    <>
                                        <Input
                                            type="number"
                                            min={1}
                                            value={editQty}
                                            onChange={(e) => setEditQty(e.target.value)}
                                            className="h-6 w-14 text-xs px-1.5"
                                        />
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-6 w-6"
                                            disabled={updateMutation.isPending}
                                            onClick={() => updateMutation.mutate({ id: c.id, quantity_per: Math.max(1, parseInt(editQty, 10) || 1) })}
                                        >
                                            <Check className="h-3 w-3" />
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <Badge
                                            variant="outline"
                                            className="text-[10px] shrink-0 cursor-pointer"
                                            title="اضغط لتعديل الكمية"
                                            onClick={() => { setEditingId(c.id); setEditQty(String(c.quantity_per)); }}
                                        >
                                            = {c.quantity_per} ×
                                        </Badge>
                                        <span className="font-medium">{name}</span>
                                        <Badge variant="secondary" className="text-[10px]">المخزون: {stock}</Badge>
                                        <button
                                            type="button"
                                            title="فك الربط"
                                            onClick={() => deleteMutation.mutate(c.id)}
                                            className="opacity-50 hover:opacity-100 mr-auto"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
            {usedIn.map((u: any) => (
                <Badge key={u.id} variant="secondary" className="text-[11px]">
                    مكوّن ضمن {u.parent_offer?.master_product?.internal_name || u.parent_offer?.name || '—'} (× {u.quantity_per})
                </Badge>
            ))}
        </div>
    );
}
