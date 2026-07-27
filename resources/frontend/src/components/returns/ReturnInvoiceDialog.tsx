import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, Package, AlertTriangle, DollarSign, ChevronsUpDown, Check } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Card, CardContent } from '@/components/ui/card';
import { useSalesOrders } from '@/hooks/useSales';
import { returnService } from '@/lib/supabase-services';
import { useLanguage } from '@/contexts/LanguageContext';

interface ReturnInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function orderRef(order: any): string {
  return String(order?.order_number || order?.platform_order_id || order?.id || '');
}

function buildOrderSearchIndex(order: any): { searchBlob: string; productLabels: string[]; productSummary: string } {
  const items = Array.isArray(order?.items) ? order.items : [];
  const productLabels: string[] = [];
  const parts: string[] = [
    orderRef(order),
    String(order?.id ?? ''),
    order?.customer_name,
    order?.external_order_number,
    order?.platform_order_id,
    order?.order_number,
  ]
    .filter((x) => x != null && String(x).trim() !== '')
    .map((x) => String(x).toLowerCase());

  for (const it of items) {
    const name =
      String(it?.product_name || '').trim() ||
      String(it?.sku?.offer?.masterProduct?.internal_name || '').trim() ||
      String(it?.sku?.name || '').trim() ||
      String(it?.raw_description || '').trim();
    const sku =
      String(it?.sku_code || '').trim() ||
      String(it?.sku?.sku || '').trim() ||
      String(it?.sku?.marketplace_id || '').trim();
    const line = [name, sku ? `SKU: ${sku}` : ''].filter(Boolean).join(' · ');
    if (line) {
      productLabels.push(line);
      parts.push(name.toLowerCase(), digitsOnly(name), sku.toLowerCase(), digitsOnly(sku));
    }
  }

  const uniq = [...new Set(productLabels)];
  const summary =
    uniq.length === 0
      ? ''
      : uniq.length === 1
        ? uniq[0]
        : `${uniq[0]} · ${uniq[1]}${uniq.length > 2 ? ` (+${uniq.length - 2})` : ''}`;

  return {
    searchBlob: parts.join(' '),
    productLabels: uniq,
    productSummary: summary,
  };
}

function orderMatchesSearch(order: any, index: ReturnType<typeof buildOrderSearchIndex>, rawQ: string): boolean {
  const q = rawQ.trim().toLowerCase();
  if (!q) return true;
  if (index.searchBlob.includes(q)) return true;
  const qDigits = digitsOnly(q);
  if (qDigits.length >= 2 && digitsOnly(index.searchBlob).includes(qDigits)) return true;
  for (const label of index.productLabels) {
    if (label.toLowerCase().includes(q)) return true;
  }
  return false;
}

export function ReturnInvoiceDialog({ open, onOpenChange }: ReturnInvoiceDialogProps) {
  const queryClient = useQueryClient();
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const { data: orders } = useSalesOrders();

  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [orderPickerOpen, setOrderPickerOpen] = useState(false);
  const [orderSearch, setOrderSearch] = useState('');
  const [returnType, setReturnType] = useState<'stock' | 'damaged'>('stock');
  const [reason, setReason] = useState('');
  const [amazonOrderNumber, setAmazonOrderNumber] = useState('');
  const [refundAmount, setRefundAmount] = useState<number>(0);
  const [refundMethod, setRefundMethod] = useState<'credit_note' | 'cash' | 'bank_transfer'>('credit_note');

  const selectedOrder = orders?.find((o) => String(o.id) === String(selectedOrderId));

  // Default the refund to the full order amount so a missed edit can't silently leave the
  // customer's balance and treasury untouched — an explicit action is required to zero it out.
  useEffect(() => {
    if (selectedOrder) {
      setRefundAmount(Number(selectedOrder.total_amount) || 0);
    }
  }, [selectedOrderId]);

  // Filter orders that can be returned (not already returned)
  const returnableOrders = orders?.filter(
    (o) => o.status !== 'returned' && o.status !== 'return_in_progress'
  );

  const orderIndexes = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildOrderSearchIndex>>();
    for (const o of returnableOrders || []) {
      map.set(String(o.id), buildOrderSearchIndex(o));
    }
    return map;
  }, [returnableOrders]);

  const filteredReturnableOrders = useMemo(() => {
    if (!returnableOrders?.length) return [];
    return returnableOrders.filter((o) => {
      const idx = orderIndexes.get(String(o.id)) || buildOrderSearchIndex(o);
      return orderMatchesSearch(o, idx, orderSearch);
    });
  }, [returnableOrders, orderIndexes, orderSearch]);

  useEffect(() => {
    if (!orderPickerOpen) {
      setOrderSearch('');
    }
  }, [orderPickerOpen]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedOrderId) throw new Error('Please select an order');
      
      const lines = Array.isArray(selectedOrder?.items) ? selectedOrder.items : [];
      const sumQty = lines.reduce((s: number, it: any) => s + Number(it?.quantity || 0), 0) || 1;

      return returnService.create({
        order_id: selectedOrderId,
        return_type: returnType,
        reason,
        amazon_order_number: amazonOrderNumber || undefined,
        refund_amount: refundAmount,
        refund_method: refundAmount > 0 ? refundMethod : 'credit_note',
        return_quantity: Math.max(1, sumQty),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success('Return invoice created successfully');
      handleClose();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create return');
    },
  });

  const handleClose = () => {
    setSelectedOrderId('');
    setOrderPickerOpen(false);
    setOrderSearch('');
    setReturnType('stock');
    setReason('');
    setAmazonOrderNumber('');
    setRefundAmount(0);
    setRefundMethod('credit_note');
    onOpenChange(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[min(960px,calc(100vw-2rem))] gap-3 p-5 overflow-x-hidden">
        <DialogHeader className="space-y-1 pb-0">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <RotateCcw className="w-5 h-5 text-primary shrink-0" />
            Create Return Invoice
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Process a return and generate an invoice. Select an order and specify return details.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 min-w-0">
          {/* Order Selection — searchable by order #, SKU, product name */}
          <div className="space-y-2 min-w-0">
            <Label>{isAr ? 'اختر الطلب للمرتجع' : 'Select Order to Return'}</Label>
            <Popover open={orderPickerOpen} onOpenChange={setOrderPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={orderPickerOpen}
                  className="w-full justify-between min-h-11 h-auto py-2 font-normal overflow-hidden"
                >
                  <span className="flex flex-col items-start gap-0.5 text-left rtl:text-right w-full min-w-0 overflow-hidden">
                    {selectedOrder ? (
                      <>
                        <span className="font-medium w-full break-all leading-snug">
                          {orderRef(selectedOrder)} · {selectedOrder.customer_name || (isAr ? 'عميل' : 'Guest')}
                        </span>
                        {(orderIndexes.get(String(selectedOrder.id))?.productSummary || buildOrderSearchIndex(selectedOrder).productSummary) ? (
                          <span className="text-xs text-muted-foreground line-clamp-1 w-full break-words">
                            {(orderIndexes.get(String(selectedOrder.id)) || buildOrderSearchIndex(selectedOrder)).productSummary}
                          </span>
                        ) : null}
                        <span className="text-xs text-muted-foreground">
                          {Number(selectedOrder.total_amount || 0).toLocaleString()} EGP
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        {isAr ? 'ابحث برقم الطلب أو الـ SKU أو اسم المنتج...' : 'Search by order #, SKU, or product...'}
                      </span>
                    )}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50 rtl:ml-0 rtl:mr-2" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[320px] max-w-[calc(100vw-2rem)] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder={isAr ? 'رقم الطلب، SKU، اسم الصنف...' : 'Order #, SKU, product name...'}
                    value={orderSearch}
                    onValueChange={setOrderSearch}
                  />
                  <CommandList className="max-h-[min(280px,40vh)]">
                    <CommandEmpty>
                      {isAr ? 'لا توجد نتائج' : 'No matching orders'}
                    </CommandEmpty>
                    <CommandGroup>
                      {filteredReturnableOrders.map((order) => {
                        const idx = orderIndexes.get(String(order.id)) || buildOrderSearchIndex(order);
                        const oid = String(order.id);
                        return (
                          <CommandItem
                            key={oid}
                            value={oid}
                            onSelect={() => {
                              setSelectedOrderId(oid);
                              setOrderPickerOpen(false);
                            }}
                            className="flex flex-col items-start gap-1 py-2.5 min-w-0"
                          >
                            <div className="flex w-full items-start justify-between gap-2 min-w-0">
                              <span className="font-medium leading-tight break-all">{orderRef(order)}</span>
                              {String(selectedOrderId) === oid ? (
                                <Check className="h-4 w-4 shrink-0 text-primary" />
                              ) : null}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {order.customer_name || (isAr ? 'عميل' : 'Guest')} ·{' '}
                              {Number(order.total_amount || 0).toLocaleString()} EGP
                            </span>
                            {idx.productSummary ? (
                              <span className="text-xs text-foreground/90 line-clamp-2 w-full break-words">{idx.productSummary}</span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground italic">
                                {isAr ? 'لا توجد بنود مرتبطة في العرض — جرّب رقم الطلب' : 'No line items in list view — try order #'}
                              </span>
                            )}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="grid lg:grid-cols-2 gap-4 min-w-0">
            <div className="space-y-3 min-w-0">
              {selectedOrder && (
                <Card className="bg-muted/30">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-semibold text-sm">Order Summary</h4>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {selectedOrder.marketplace_source?.replace('_', ' ').toUpperCase() || 'DIRECT'}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm min-w-0">
                      <div className="min-w-0">
                        <span className="text-muted-foreground text-xs">Order Number:</span>
                        <p className="font-medium break-all">{selectedOrder.order_number}</p>
                      </div>
                      <div className="min-w-0">
                        <span className="text-muted-foreground text-xs">Customer:</span>
                        <p className="font-medium truncate">{selectedOrder.customer_name || 'Walk-in Customer'}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs">Total Amount:</span>
                        <p className="font-medium text-primary">{selectedOrder.total_amount.toLocaleString()} EGP</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs">Status:</span>
                        <p className="font-medium capitalize">{selectedOrder.status?.replace('_', ' ')}</p>
                      </div>
                      {selectedOrder.external_order_number && (
                        <div className="col-span-2 min-w-0">
                          <span className="text-muted-foreground text-xs">External Order #:</span>
                          <p className="font-medium break-all">{selectedOrder.external_order_number}</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="space-y-1.5">
                <Label className="text-sm">Marketplace Order Reference (Optional)</Label>
                <Input
                  value={amazonOrderNumber}
                  onChange={(e) => setAmazonOrderNumber(e.target.value)}
                  placeholder="e.g., 114-1234567-1234567"
                />
                <p className="text-[11px] text-muted-foreground">
                  Enter the Amazon/Noon/Jumia order ID for tracking
                </p>
              </div>
            </div>

            <div className="space-y-3 min-w-0">
              <div className="space-y-2">
                <Label className="text-sm">Return Type</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setReturnType('stock')}
                    className={`p-3 rounded-lg border-2 transition-all ${
                      returnType === 'stock'
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <Package className={`w-5 h-5 mx-auto mb-1.5 ${returnType === 'stock' ? 'text-primary' : 'text-muted-foreground'}`} />
                    <p className="font-medium text-xs sm:text-sm">Return to Stock</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                      Items will be added back to inventory
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setReturnType('damaged')}
                    className={`p-3 rounded-lg border-2 transition-all ${
                      returnType === 'damaged'
                        ? 'border-destructive bg-destructive/10'
                        : 'border-border hover:border-destructive/50'
                    }`}
                  >
                    <AlertTriangle className={`w-5 h-5 mx-auto mb-1.5 ${returnType === 'damaged' ? 'text-destructive' : 'text-muted-foreground'}`} />
                    <p className="font-medium text-xs sm:text-sm">Damaged/Write-off</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                      Items will not be restocked
                    </p>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center gap-2 text-sm">
                  <DollarSign className="w-4 h-4" />
                  Refund Amount
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                />
                {selectedOrder && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setRefundAmount(selectedOrder.total_amount)}
                  >
                    Set to full amount ({selectedOrder.total_amount.toLocaleString()} EGP)
                  </Button>
                )}
                {refundAmount > 0 ? (
                  <Select value={refundMethod} onValueChange={(v) => setRefundMethod(v as typeof refundMethod)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="credit_note">
                        {isAr ? 'خصم من حساب العميل (بدون صرف من الخزينة)' : 'Credit note (no treasury movement)'}
                      </SelectItem>
                      <SelectItem value="cash">{isAr ? 'كاش من الخزينة' : 'Cash refund'}</SelectItem>
                      <SelectItem value="bank_transfer">{isAr ? 'تحويل بنكي' : 'Bank transfer'}</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-destructive">
                    {isAr
                      ? 'لن يتم تعديل رصيد العميل أو الخزينة لهذا المرتجع — تأكد أن هذا مقصود'
                      : "This return won't adjust the customer balance or treasury — confirm this is intentional."}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">Return Reason</Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe the reason for return..."
                  rows={2}
                  className="min-h-[4.5rem] resize-none"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="pt-1 sm:space-x-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={mutation.isPending || !selectedOrderId}
              className="min-w-[140px]"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Create Return
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
