import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { useForm, useFieldArray } from 'react-hook-form';
import { toast } from 'sonner';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { salesInvoiceService, productService, warehouseService as storeService, customerService } from '@/lib/supabase-services';

interface SalesInvoiceDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function SalesInvoiceDialog({ open, onOpenChange }: SalesInvoiceDialogProps) {
    const queryClient = useQueryClient();

    const { data: products } = useQuery({ queryKey: ['products'], queryFn: () => productService.getAll() });
    const { data: stores } = useQuery({ queryKey: ['stores'], queryFn: () => storeService.getAll() });
    const { data: customers } = useQuery({ queryKey: ['customers'], queryFn: () => customerService.getAll() });

    const { register, control, handleSubmit, setValue, reset } = useForm({
        defaultOptions: {
            defaultValues: {
                invoice_number: `SAL-${Date.now()}`,
                items: [{ product_id: '', quantity: 1, unit_price: 0 }]
            }
        }
    } as any);

    const { fields, append, remove } = useFieldArray({
        control,
        name: 'items'
    });

    const mutation = useMutation({
        mutationFn: (data: any) => salesInvoiceService.create(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sales-invoices'] });
            toast.success('Sales invoice created successfully');
            onOpenChange(false);
            reset();
        },
        onError: (error: any) => {
            toast.error(error.message || 'Failed to create sales invoice');
        }
    });

    const onSubmit = (data: any) => {
        mutation.mutate(data);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Create Sales Invoice</DialogTitle>
                    <DialogDescription>Sell items, reduce stock and update customer balance.</DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Invoice Number</Label>
                            <Input {...register('invoice_number', { required: true })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Store (Source)</Label>
                            <Select onValueChange={(val) => setValue('store_id', val)}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select Store" />
                                </SelectTrigger>
                                <SelectContent>
                                    {stores?.map((s: any) => (
                                        <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Customer</Label>
                            <Select onValueChange={(val) => setValue('customer_id', val)}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select Customer" />
                                </SelectTrigger>
                                <SelectContent>
                                    {customers?.map((s: any) => (
                                        <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Date</Label>
                            <Input type="date" {...register('invoice_date')} defaultValue={new Date().toISOString().split('T')[0]} />
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-semibold">Items</h3>
                            <Button type="button" variant="outline" size="sm" onClick={() => append({ product_id: '', quantity: 1, unit_price: 0 })}>
                                <Plus className="w-4 h-4 mr-2" /> Add Item
                            </Button>
                        </div>

                        {fields.map((field, index) => (
                            <div key={field.id} className="grid grid-cols-12 gap-2 items-end border-b pb-4">
                                <div className="col-span-5 space-y-1">
                                    <Label className="text-xs">Product</Label>
                                    <Select onValueChange={(val) => setValue(`items.${index}.product_id`, val)}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select Product" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {products?.items?.map((p: any) => (
                                                <SelectItem key={p.id} value={p.id.toString()}>{p.name} ({p.sku})</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="col-span-2 space-y-1">
                                    <Label className="text-xs">Qty</Label>
                                    <Input type="number" {...register(`items.${index}.quantity`, { required: true, valueAsNumber: true })} />
                                </div>
                                <div className="col-span-3 space-y-1">
                                    <Label className="text-xs">Selling Price</Label>
                                    <Input type="number" step="0.01" {...register(`items.${index}.unit_price`, { required: true, valueAsNumber: true })} />
                                </div>
                                <div className="col-span-2">
                                    <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => remove(index)}>
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="space-y-2">
                        <Label>Notes</Label>
                        <Input {...register('notes')} placeholder="Optional notes..." />
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button type="submit" disabled={mutation.isPending}>
                            {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Create Invoice
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
