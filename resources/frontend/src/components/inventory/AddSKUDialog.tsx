import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    offerId?: string;
    skuId?: string;
    initialData?: any;
    /** Pre-select sales channel when opening after "first offer" wizard. */
    presetChannelId?: string;
}

export default function AddSKUDialog({ open, onOpenChange, offerId, skuId, initialData, presetChannelId }: Props) {
    const { t, language } = useLanguage();
    const isAr = language === 'ar';
    const queryClient = useQueryClient();
    const [formData, setFormData] = useState({
        sku: initialData?.sku || '',
        name: initialData?.name || '',
        image_url: initialData?.image_url || '',
        marketplace_id: initialData?.marketplace_id || '',
        channel_id: initialData?.channel_id?.toString() || '',
        cost_price: initialData?.cost_price?.toString() || '',
        is_active: initialData?.is_active ?? true,
        offer_id: offerId || initialData?.offer_id || '',
    });

    const { data: channels = [] } = useQuery({
        queryKey: ['channels'],
        queryFn: () => api.getArray('/channels')
    });

    useEffect(() => {
        if (open) {
            const channelDefault =
                initialData?.channel_id?.toString()
                || (presetChannelId ? String(presetChannelId) : '');
            setFormData({
                sku: initialData?.sku || '',
                name: initialData?.name || '',
                image_url: initialData?.image_url || '',
                marketplace_id: initialData?.marketplace_id || '',
                channel_id: channelDefault,
                cost_price: initialData?.cost_price?.toString() || '',
                is_active: initialData?.is_active ?? true,
                offer_id: offerId || initialData?.offer_id || '',
            });
        }
    }, [open, initialData, offerId, presetChannelId]);

    const mutation = useMutation({
        mutationFn: async (data: any) => {
            const base = {
                ...data,
                offer_id: data.offer_id ? String(data.offer_id) : undefined,
                channel_id: data.channel_id ? String(data.channel_id) : null,
                cost_price: data.cost_price === '' || data.cost_price == null ? 0 : Number(data.cost_price),
            };
            if (skuId) {
                return api.put(`/skus/${skuId}`, base);
            }
            /** New listing: selling price is filled from order imports, not manual entry. */
            return api.post('/skus', {
                ...base,
                selling_price: 0,
                offer_id: offerId || base.offer_id,
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['master-products'] });
            queryClient.invalidateQueries({ queryKey: ['channel-skus'] });
            queryClient.invalidateQueries({ queryKey: ['warehouses-summary'] });
            queryClient.invalidateQueries({ queryKey: ['channels-all-skus-metrics'] });
            toast.success(isAr ? 'تم حفظ SKU بنجاح' : 'SKU saved successfully');
            onOpenChange(false);
            if (!skuId) resetForm();
        },
        onError: (error: any) => {
            const data = error?.response?.data;
            const raw = data?.errors
                ? Object.values(data.errors).flat().join(' | ')
                : (data?.message || error?.message || '');
            const details =
                /cost_price.*cannot be null/i.test(String(raw))
                    ? (isAr
                        ? 'التكلفة التقديرية اختيارية — أعد المحاولة. إن استمر الخطأ حدّث الصفحة.'
                        : 'Estimated cost is optional — try again. Refresh the page if the error persists.')
                    : (raw || (isAr ? 'فشل حفظ SKU' : 'Failed to save SKU'));
            toast.error(details);
        },
    });

    const resetForm = () => {
        setFormData({
            sku: '',
            name: '',
            image_url: '',
            marketplace_id: '',
            channel_id: '',
            cost_price: '',
            is_active: true,
            offer_id: offerId || '',
        });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        mutation.mutate(formData);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{skuId ? 'Edit SKU' : 'Add New SKU'}</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <Label htmlFor="sku">SKU Code *</Label>
                        <Input
                            id="sku"
                            value={formData.sku}
                            onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                            placeholder="e.g., PHY-ANKLE-001"
                            required
                        />
                    </div>

                    <div>
                        <Label htmlFor="name">{isAr ? 'اسم المنتج على المنصة (اختياري)' : 'Platform Product Name (Optional)'}</Label>
                        <Input
                            id="name"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder={isAr ? "اسم المنتج كما يظهر على المنصة" : "Product title as shown on platform"}
                        />
                    </div>

                    <div>
                        <Label htmlFor="image_url">{isAr ? 'رابط صورة الـ SKU (اختياري)' : 'SKU Image URL (Optional)'}</Label>
                        <Input
                            id="image_url"
                            value={formData.image_url}
                            onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                            placeholder="https://..."
                        />
                    </div>

                    <div>
                        <Label htmlFor="channel">{isAr ? 'المنصة / القناة *' : 'Platform / Channel *'}</Label>
                        <Select
                            value={formData.channel_id}
                            onValueChange={(value) => setFormData({ ...formData, channel_id: value })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={isAr ? "اختر المنصة" : "Select platform"} />
                            </SelectTrigger>
                            <SelectContent>
                                {channels.map((channel: any) => (
                                    <SelectItem key={channel.id} value={channel.id.toString()}>
                                        {channel.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div>
                        <Label htmlFor="marketplace_id">Marketplace ID (ASIN/Product ID)</Label>
                        <Input
                            id="marketplace_id"
                            value={formData.marketplace_id}
                            onChange={(e) => setFormData({ ...formData, marketplace_id: e.target.value })}
                            placeholder="e.g., B08XYZ123 (for Amazon)"
                        />
                    </div>

                    <div>
                        <Label htmlFor="cost_price">
                            {isAr ? 'تكلفة تقديرية (ج.م) — اختياري' : 'Estimated cost (EGP) — optional'}
                        </Label>
                        <Input
                            id="cost_price"
                            type="number"
                            step="0.01"
                            value={formData.cost_price}
                            onChange={(e) => setFormData({ ...formData, cost_price: e.target.value })}
                            placeholder="0.00"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                            {isAr
                                ? 'يمكن تركها فارغة — التكلفة الفعلية تُسجَّل من فاتورة الشراء، وسعر البيع في عروض الأسعار من إعدادات المحل/المنصة.'
                                : 'Leave blank if unknown — purchase invoices record real cost; quotes use the store/channel selling price.'}
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="is_active"
                            checked={formData.is_active}
                            onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                            className="w-4 h-4"
                        />
                        <Label htmlFor="is_active" className="cursor-pointer">Active SKU</Label>
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={mutation.isPending}>
                            {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            {skuId ? 'Save Changes' : 'Add SKU'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
