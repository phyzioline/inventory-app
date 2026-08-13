import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, X, Pencil, Check } from 'lucide-react';
import { offerService } from '@/lib/supabase-services';
import { useToast } from '@/hooks/use-toast';

interface Props {
    offer: { id: string; name: string };
}

/**
 * Renders "= N x ComponentName" rows for an offer's own components, with inline
 * quantity edit and delete. Also surfaces (read-only) where this offer is used as
 * someone else's component, for context.
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
        <div className="flex flex-wrap items-center gap-1.5">
            {components.map((c: any) => (
                <div key={c.id} className="inline-flex items-center gap-1">
                    {editingId === c.id ? (
                        <div className="inline-flex items-center gap-1">
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
                        </div>
                    ) : (
                        <Badge
                            variant="outline"
                            className="text-[11px] gap-1 pr-1 cursor-pointer group"
                            onClick={() => { setEditingId(c.id); setEditQty(String(c.quantity_per)); }}
                        >
                            = {c.quantity_per} × {c.component_offer?.master_product?.internal_name || c.component_offer?.name || '—'}
                            <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60" />
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(c.id); }}
                                className="opacity-60 hover:opacity-100"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </Badge>
                    )}
                </div>
            ))}
            {usedIn.map((u: any) => (
                <Badge key={u.id} variant="secondary" className="text-[11px]">
                    مكوّن ضمن {u.parent_offer?.master_product?.internal_name || u.parent_offer?.name || '—'} (× {u.quantity_per})
                </Badge>
            ))}
        </div>
    );
}
