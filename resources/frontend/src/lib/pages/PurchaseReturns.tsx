import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, RotateCcw, Plus, Search, Eye, ExternalLink, Pencil } from 'lucide-react';
import { toast } from 'sonner';

type PurchaseBatch = any;
type PurchaseReturn = any;

const toNumber = (v: any) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function formatBatchInvoiceDate(raw: unknown, locale: string): string {
  if (raw == null || raw === '') return '';
  const s = String(raw);
  const ymd = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

function purchaseBatchSelectLabel(batch: any, isAr: boolean): string {
  const invNo = batch?.invoice_number || batch?.batch_number || `#${batch?.id ?? ''}`;
  const supplier = String(batch?.supplier_name_raw || batch?.vendor?.name || '').trim();
  const supplierPart = supplier || (isAr ? 'مورد غير محدد' : 'Unknown supplier');
  const dateStr = formatBatchInvoiceDate(batch?.invoice_date, isAr ? 'ar-EG' : 'en-GB');
  const sep = isAr ? ' · ' : ' — ';
  const parts = [invNo, supplierPart];
  if (dateStr) parts.push(dateStr);
  return parts.join(sep);
}

function refundMethodLabel(method: string, isAr: boolean): string {
  const m = String(method || 'credit_note').toLowerCase();
  if (m === 'cash') return isAr ? 'نقدي' : 'Cash';
  if (m === 'bank_transfer') return isAr ? 'تحويل بنكي' : 'Bank transfer';
  return isAr ? 'خصم من مستحقات المورد' : 'Credit note';
}

export default function PurchaseReturns() {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isEditingReturn, setIsEditingReturn] = useState(false);
  const [selectedReturnId, setSelectedReturnId] = useState<string | null>(null);
  const [editReturnDate, setEditReturnDate] = useState('');
  const [editRefundMethod, setEditRefundMethod] = useState<'credit_note' | 'cash' | 'bank_transfer'>('credit_note');
  const [editReason, setEditReason] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editLines, setEditLines] = useState<
    Array<{
      id?: number;
      purchase_batch_item_id?: number | null;
      sku_id: number;
      sku_code: string;
      label: string;
      quantity: string;
      unit_price: string;
    }>
  >([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [refundMethod, setRefundMethod] = useState<'credit_note' | 'cash' | 'bank_transfer'>('credit_note');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [qtyByItemId, setQtyByItemId] = useState<Record<string, string>>({});

  const { data: returnsPage, isLoading: loadingReturns } = useQuery({
    queryKey: ['purchase-returns'],
    queryFn: () => api.get('/purchase-returns'),
  });

  const returns: PurchaseReturn[] = useMemo(() => {
    if (Array.isArray(returnsPage)) return returnsPage;
    if (Array.isArray((returnsPage as any)?.data)) return (returnsPage as any).data;
    if (Array.isArray((returnsPage as any)?.data?.data)) return (returnsPage as any).data.data;
    return Array.isArray((returnsPage as any)?.data) ? (returnsPage as any).data : [];
  }, [returnsPage]);

  const { data: batches = [], isLoading: loadingBatches } = useQuery({
    queryKey: ['purchase-batches-for-returns'],
    queryFn: () => api.getArray('/purchases/smart-import/batches', { params: { per_page: 200 } }),
    enabled: open,
  });

  const { data: batchDetail, isLoading: loadingBatchDetail } = useQuery({
    queryKey: ['purchase-batch-detail', selectedBatchId],
    queryFn: () => api.get(`/purchases/smart-import/batches/${selectedBatchId}`),
    enabled: open && Boolean(selectedBatchId),
  });

  const { data: returnDetail, isLoading: loadingReturnDetail } = useQuery({
    queryKey: ['purchase-return-detail', selectedReturnId],
    queryFn: () => api.get(`/purchase-returns/${selectedReturnId}`),
    enabled: detailsOpen && Boolean(selectedReturnId),
  });

  const selectedReturn: any = returnDetail || null;
  const returnItems: any[] = Array.isArray(selectedReturn?.items) ? selectedReturn.items : [];
  const linkedBatchId = String(selectedReturn?.purchase_batch_id ?? selectedReturn?.batch?.id ?? '');

  const { data: linkedBatchDetail, isLoading: loadingLinkedBatch } = useQuery({
    queryKey: ['purchase-batch-for-return-edit', linkedBatchId],
    queryFn: () => api.get(`/purchases/smart-import/batches/${linkedBatchId}`),
    enabled: detailsOpen && isEditingReturn && Boolean(linkedBatchId),
  });

  const linkedBatch: any = (linkedBatchDetail as any)?.batch || linkedBatchDetail || null;
  const linkedBatchItems: any[] = Array.isArray(linkedBatch?.items) ? linkedBatch.items : [];

  const returnLineLabel = (it: any) =>
    it?.batch_item?.master_product?.internal_name
    || it?.batchItem?.master_product?.internal_name
    || it?.sku?.offer?.master_product?.internal_name
    || it?.sku?.name
    || '—';

  const populateEditFromReturn = (row: any) => {
    const items = Array.isArray(row?.items) ? row.items : [];
    setEditReturnDate(String(row?.return_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10));
    setEditRefundMethod((row?.refund_method || 'credit_note') as 'credit_note' | 'cash' | 'bank_transfer');
    setEditReason(String(row?.reason || ''));
    setEditNotes(String(row?.notes || ''));
    setEditLines(
      items.map((it: any) => ({
        id: Number(it.id),
        purchase_batch_item_id: it.purchase_batch_item_id ? Number(it.purchase_batch_item_id) : null,
        sku_id: Number(it.sku_id),
        sku_code: String(it?.sku?.sku || ''),
        label: returnLineLabel(it),
        quantity: String(toNumber(it.quantity)),
        unit_price: String(toNumber(it.unit_price)),
      }))
    );
  };

  const startEditingReturn = (row?: any) => {
    const source = row || selectedReturn;
    if (!source) return;
    populateEditFromReturn(source);
    setIsEditingReturn(true);
  };

  const addBatchLineToEdit = (batchItem: any) => {
    const batchItemId = Number(batchItem.id);
    const skuId = Number(batchItem.sku_id ?? batchItem.sku?.id ?? 0);
    if (!skuId) {
      toast.error(isAr ? 'البند غير مربوط بـ SKU' : 'Line is not linked to a SKU');
      return;
    }
    if (editLines.some((l) => l.purchase_batch_item_id === batchItemId)) {
      toast.error(isAr ? 'البند مضاف بالفعل' : 'Item already on this return');
      return;
    }
    setEditLines((prev) => [
      ...prev,
      {
        purchase_batch_item_id: batchItemId,
        sku_id: skuId,
        sku_code: String(batchItem?.sku?.sku || ''),
        label:
          batchItem?.master_product?.internal_name
          || batchItem?.sku?.offer?.masterProduct?.internal_name
          || batchItem?.raw_description
          || batchItem?.sku?.sku
          || '—',
        quantity: '',
        unit_price: String(toNumber(batchItem.unit_price)),
      },
    ]);
  };

  const updateEditLine = (index: number, patch: Partial<(typeof editLines)[number]>) => {
    setEditLines((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeEditLine = (index: number) => {
    setEditLines((prev) => prev.filter((_, i) => i !== index));
  };

  const editGrandTotal = useMemo(
    () =>
      editLines.reduce(
        (sum, line) => sum + toNumber(line.quantity) * toNumber(line.unit_price),
        0
      ),
    [editLines]
  );

  const editingReturnLoadedIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!detailsOpen || !isEditingReturn || !selectedReturn) return;
    const id = Number(selectedReturn.id);
    const items = Array.isArray(selectedReturn.items) ? selectedReturn.items : [];
    if (!id || items.length === 0) return;
    if (editingReturnLoadedIdRef.current === id && editLines.length > 0) return;
    populateEditFromReturn(selectedReturn);
    editingReturnLoadedIdRef.current = id;
  }, [detailsOpen, isEditingReturn, selectedReturn, returnDetail, editLines.length]);

  const selectedBatch: PurchaseBatch | null = (batchDetail as any)?.batch || batchDetail || null;
  const batchItems: any[] = Array.isArray(selectedBatch?.items) ? selectedBatch.items : [];

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedReturnId) {
        throw new Error(isAr ? 'لا يوجد مرتجع محدد' : 'No return selected');
      }
      const items = editLines
        .map((line) => {
          const qty = toNumber(line.quantity);
          if (qty <= 0) return null;
          return {
            id: line.id,
            purchase_batch_item_id: line.purchase_batch_item_id ?? undefined,
            sku_id: line.sku_id,
            quantity: qty,
            unit_price: toNumber(line.unit_price),
          };
        })
        .filter(Boolean);
      if (!items.length) {
        throw new Error(isAr ? 'أضف بنداً واحداً على الأقل بكمية أكبر من صفر' : 'Add at least one line with quantity > 0');
      }
      return api.put(`/purchase-returns/${selectedReturnId}`, {
        return_date: editReturnDate,
        refund_method: editRefundMethod,
        reason: editReason || undefined,
        notes: editNotes || undefined,
        items,
      });
    },
    onSuccess: (updated: any) => {
      toast.success(isAr ? 'تم تحديث مرتجع المشتريات' : 'Purchase return updated');
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
      qc.invalidateQueries({ queryKey: ['purchase-return-detail', selectedReturnId] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['master-products'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      if (updated) {
        populateEditFromReturn(updated);
      }
      setIsEditingReturn(false);
    },
    onError: (err: any) => {
      toast.error(String(err?.response?.data?.message || err?.message || 'Failed'));
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBatchId) {
        throw new Error(isAr ? 'اختر فاتورة شراء أولاً' : 'Select a purchase invoice first');
      }

      const items = batchItems
        .map((it) => {
          const qty = toNumber(qtyByItemId[String(it.id)]);
          if (qty <= 0) return null;
          const skuId = it.sku_id ?? it.sku?.id;
          if (!skuId) return null;
          return {
            purchase_batch_item_id: it.id,
            sku_id: skuId,
            quantity: qty,
            unit_price: toNumber(it.unit_price),
          };
        })
        .filter(Boolean);

      if (!items.length) {
        throw new Error(isAr ? 'حدد كميات المرتجع' : 'Select return quantities');
      }

      return api.post('/purchase-returns', {
        purchase_batch_id: Number(selectedBatchId),
        return_date: returnDate,
        refund_method: refundMethod,
        reason: reason || undefined,
        notes: notes || undefined,
        items,
      });
    },
    onSuccess: () => {
      toast.success(isAr ? 'تم إنشاء مرتجع المشتريات' : 'Purchase return created');
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      setOpen(false);
      setSelectedBatchId('');
      setQtyByItemId({});
      setReason('');
      setNotes('');
      setRefundMethod('credit_note');
    },
    onError: (err: any) => {
      toast.error(String(err?.response?.data?.message || err?.message || 'Failed'));
    },
  });

  const openReturnDetails = (row: any, startEdit = false) => {
    setSelectedReturnId(String(row.id));
    editingReturnLoadedIdRef.current = null;
    setEditLines([]);
    setIsEditingReturn(startEdit);
    setDetailsOpen(true);
  };

  const openLinkedPurchaseInvoice = (batchId: string | number | null | undefined) => {
    const id = String(batchId ?? '').trim();
    if (!id) {
      toast.error(isAr ? 'لا توجد فاتورة شراء مرتبطة' : 'No linked purchase invoice');
      return;
    }
    setDetailsOpen(false);
    navigate(`/purchases?batch=${encodeURIComponent(id)}`);
  };

  const filteredReturns = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return returns;
    return returns.filter((r: any) => {
      const id = String(r.id ?? '');
      const no = String(r.return_number ?? '');
      const inv = String(r.batch?.invoice_number ?? r.batch?.batch_number ?? '');
      const sup = String(r.batch?.supplier_name_raw ?? r.vendor?.name ?? r.supplier?.name ?? '');
      return [id, no, inv, sup].some((v) => v.toLowerCase().includes(q));
    });
  }, [returns, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{isAr ? 'مرتجع مشتريات' : 'Purchase Returns'}</h1>
          <p className="text-muted-foreground">
            {isAr ? 'خصم مخزون + تخفيض مستحقات المورد (ومقبوضات لو فيه استرداد)' : 'Stock out + reduce supplier payables (and receipt if refunded)'}
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          {isAr ? 'مرتجع جديد' : 'New Return'}
        </Button>
      </div>

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>{isAr ? 'كل مرتجعات المشتريات' : 'All Purchase Returns'}</CardTitle>
          <CardDescription>{isAr ? 'يمكن البحث برقم المرتجع/الفاتورة/المورد' : 'Search by return/invoice/supplier'}</CardDescription>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={isAr ? 'بحث...' : 'Search...'} />
          </div>
        </CardHeader>
        <CardContent>
          {loadingReturns ? (
            <div className="flex items-center justify-center min-h-[200px]">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : filteredReturns.length === 0 ? (
            <div className="text-sm text-muted-foreground">{isAr ? 'لا يوجد مرتجعات مشتريات بعد' : 'No purchase returns yet'}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{isAr ? 'المرتجع' : 'Return'}</TableHead>
                    <TableHead>{isAr ? 'فاتورة' : 'Invoice'}</TableHead>
                    <TableHead>{isAr ? 'المورد' : 'Supplier'}</TableHead>
                    <TableHead>{isAr ? 'التاريخ' : 'Date'}</TableHead>
                    <TableHead>{isAr ? 'الطريقة' : 'Method'}</TableHead>
                    <TableHead className="text-right">{isAr ? 'الإجمالي' : 'Total'}</TableHead>
                    <TableHead className="text-center w-[130px]">{isAr ? 'إجراءات' : 'Actions'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReturns.map((r: any) => {
                    const batchId = r.purchase_batch_id ?? r.batch?.id;
                    const invNo = r.batch?.invoice_number || r.batch?.batch_number || '-';
                    return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openReturnDetails(r)}
                    >
                      <TableCell className="font-medium text-primary">{r.return_number || `#${r.id}`}</TableCell>
                      <TableCell>
                        {batchId ? (
                          <button
                            type="button"
                            className="font-mono text-xs text-primary hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              openLinkedPurchaseInvoice(batchId);
                            }}
                          >
                            {invNo}
                          </button>
                        ) : (
                          <span className="font-mono text-xs">{invNo}</span>
                        )}
                      </TableCell>
                      <TableCell>{r.batch?.supplier_name_raw || r.vendor?.name || r.supplier?.name || '-'}</TableCell>
                      <TableCell>{String(r.return_date || '').slice(0, 10) || '-'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{refundMethodLabel(r.refund_method, isAr)}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{toNumber(r.grand_total).toLocaleString()} {r.currency || 'EGP'}</TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title={isAr ? 'عرض التفاصيل' : 'View details'} onClick={() => openReturnDetails(r)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title={isAr ? 'تعديل المرتجع' : 'Edit return'}
                            onClick={() => openReturnDetails(r, true)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          {batchId ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title={isAr ? 'فتح فاتورة الشراء' : 'Open purchase invoice'}
                              onClick={() => openLinkedPurchaseInvoice(batchId)}
                            >
                              <ExternalLink className="w-4 h-4" />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={detailsOpen}
        onOpenChange={(v) => {
          setDetailsOpen(v);
          if (!v) {
            setSelectedReturnId(null);
            setIsEditingReturn(false);
            editingReturnLoadedIdRef.current = null;
            setEditLines([]);
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedReturn?.return_number || (isAr ? 'تفاصيل المرتجع' : 'Return details')}</DialogTitle>
            <DialogDescription>
              {isEditingReturn
                ? (isAr
                  ? 'عدّل الكميات وطريقة الاسترداد — يتم تعديل المخزون والمقبوضات تلقائياً.'
                  : 'Edit quantities and refund method — stock and receipts adjust automatically.')
                : (isAr
                  ? 'مرتجع المشتريات مرتبط بفاتورة الشراء — يمكنك التعديل هنا أو فتح الفاتورة الأصلية.'
                  : 'Linked to the purchase invoice — edit here or open the original invoice.')}
            </DialogDescription>
          </DialogHeader>

          {loadingReturnDetail ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : selectedReturn ? (
            <div className="space-y-4">
              {isEditingReturn ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>{isAr ? 'تاريخ المرتجع' : 'Return date'}</Label>
                      <Input type="date" value={editReturnDate} onChange={(e) => setEditReturnDate(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>{isAr ? 'طريقة الاسترداد' : 'Refund method'}</Label>
                      <Select value={editRefundMethod} onValueChange={(v: any) => setEditRefundMethod(v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="credit_note">{isAr ? 'خصم من مستحقات المورد' : 'Credit note'}</SelectItem>
                          <SelectItem value="cash">{isAr ? 'نقدي' : 'Cash'}</SelectItem>
                          <SelectItem value="bank_transfer">{isAr ? 'تحويل بنكي' : 'Bank transfer'}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>{isAr ? 'الإجمالي (محسوب)' : 'Total (computed)'}</Label>
                      <div className="h-10 flex items-center font-semibold px-3 rounded-md border bg-muted/30">
                        {editGrandTotal.toLocaleString()} {selectedReturn.currency || 'EGP'}
                      </div>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>{isAr ? 'السبب' : 'Reason'}</Label>
                      <Input value={editReason} onChange={(e) => setEditReason(e.target.value)} />
                    </div>
                    <div className="space-y-2 md:col-span-3">
                      <Label>{isAr ? 'ملاحظات' : 'Notes'}</Label>
                      <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
                    </div>
                  </div>

                  <div className="rounded border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{isAr ? 'الصنف' : 'Item'}</TableHead>
                          <TableHead className="text-right">{isAr ? 'كمية المرتجع' : 'Return qty'}</TableHead>
                          <TableHead className="text-right">{isAr ? 'سعر' : 'Unit'}</TableHead>
                          <TableHead className="text-right">{isAr ? 'الإجمالي' : 'Line total'}</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {editLines.map((line, idx) => (
                          <TableRow key={line.id ?? `new-${idx}`}>
                            <TableCell>
                              <div className="font-medium">{line.label}</div>
                              <div className="text-xs font-mono text-muted-foreground">{line.sku_code || '—'}</div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                inputMode="decimal"
                                className="w-28 ms-auto text-right h-8"
                                value={line.quantity}
                                onChange={(e) => updateEditLine(idx, { quantity: e.target.value })}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                inputMode="decimal"
                                className="w-28 ms-auto text-right h-8"
                                value={line.unit_price}
                                onChange={(e) => updateEditLine(idx, { unit_price: e.target.value })}
                              />
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {(toNumber(line.quantity) * toNumber(line.unit_price)).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeEditLine(idx)}>
                                ×
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {linkedBatchId ? (
                    <div className="rounded border">
                      <div className="px-3 py-2 border-b text-sm font-medium">
                        {isAr ? 'إضافة بند من فاتورة الشراء' : 'Add line from purchase invoice'}
                      </div>
                      <div className="max-h-[200px] overflow-auto">
                        {loadingLinkedBatch ? (
                          <div className="p-4 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
                        ) : (
                          <Table>
                            <TableBody>
                              {linkedBatchItems
                                .filter((bi: any) => !editLines.some((l) => l.purchase_batch_item_id === Number(bi.id)))
                                .map((bi: any) => (
                                  <TableRow key={bi.id}>
                                    <TableCell className="text-sm">
                                      {bi?.master_product?.internal_name || bi?.raw_description || bi?.sku?.sku || '—'}
                                    </TableCell>
                                    <TableCell className="text-right text-xs text-muted-foreground">
                                      {toNumber(bi.received_quantity ?? bi.quantity).toLocaleString()}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <Button type="button" size="sm" variant="outline" onClick={() => addBatchLineToEdit(bi)}>
                                        {isAr ? 'إضافة' : 'Add'}
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))}
                            </TableBody>
                          </Table>
                        )}
                      </div>
                    </div>
                  ) : null}

                  <p className="text-xs text-muted-foreground">
                    {isAr
                      ? 'ملاحظة: زيادة كمية المرتجع تخصم من المخزون؛ تقليلها أو حذف البند يعيد الكمية للمخزن. لا يمكن تغيير فاتورة الشراء من هنا — استخدم زر فتح الفاتورة.'
                      : 'Note: increasing return qty deducts stock; decreasing or removing a line restores stock. To change the purchase invoice itself, use Open purchase invoice.'}
                  </p>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div className="rounded border p-2">
                      <p className="text-muted-foreground text-xs">{isAr ? 'فاتورة الشراء' : 'Purchase invoice'}</p>
                      <p className="font-mono font-medium">
                        {selectedReturn.batch?.invoice_number || selectedReturn.batch?.batch_number || '—'}
                      </p>
                    </div>
                    <div className="rounded border p-2">
                      <p className="text-muted-foreground text-xs">{isAr ? 'المورد' : 'Supplier'}</p>
                      <p className="font-medium">
                        {selectedReturn.batch?.supplier_name_raw || selectedReturn.vendor?.name || selectedReturn.supplier?.name || '—'}
                      </p>
                    </div>
                    <div className="rounded border p-2">
                      <p className="text-muted-foreground text-xs">{isAr ? 'التاريخ' : 'Date'}</p>
                      <p className="font-medium">{String(selectedReturn.return_date || '').slice(0, 10)}</p>
                    </div>
                    <div className="rounded border p-2">
                      <p className="text-muted-foreground text-xs">{isAr ? 'الإجمالي' : 'Total'}</p>
                      <p className="font-semibold">
                        {toNumber(selectedReturn.grand_total).toLocaleString()} {selectedReturn.currency || 'EGP'}
                      </p>
                    </div>
                  </div>

                  <div className="rounded border p-2 text-sm">
                    <span className="text-muted-foreground">{isAr ? 'طريقة الاسترداد: ' : 'Refund method: '}</span>
                    {refundMethodLabel(selectedReturn.refund_method, isAr)}
                  </div>

                  {(selectedReturn.reason || selectedReturn.notes) && (
                    <div className="text-sm space-y-1 rounded border p-3 bg-muted/30">
                      {selectedReturn.reason ? (
                        <p><span className="text-muted-foreground">{isAr ? 'السبب: ' : 'Reason: '}</span>{selectedReturn.reason}</p>
                      ) : null}
                      {selectedReturn.notes ? (
                        <p><span className="text-muted-foreground">{isAr ? 'ملاحظات: ' : 'Notes: '}</span>{selectedReturn.notes}</p>
                      ) : null}
                    </div>
                  )}

                  <div className="rounded border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{isAr ? 'الصنف' : 'Item'}</TableHead>
                          <TableHead className="text-right">{isAr ? 'الكمية المرتجعة' : 'Return qty'}</TableHead>
                          <TableHead className="text-right">{isAr ? 'سعر' : 'Unit'}</TableHead>
                          <TableHead className="text-right">{isAr ? 'الإجمالي' : 'Line total'}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {returnItems.map((it: any) => (
                          <TableRow key={it.id}>
                            <TableCell>
                              <div className="font-medium">{returnLineLabel(it)}</div>
                              <div className="text-xs font-mono text-muted-foreground">{it?.sku?.sku || '—'}</div>
                            </TableCell>
                            <TableCell className="text-right">{toNumber(it.quantity).toLocaleString()}</TableCell>
                            <TableCell className="text-right">{toNumber(it.unit_price).toLocaleString()}</TableCell>
                            <TableCell className="text-right font-medium">{toNumber(it.total_price).toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </div>
          ) : null}

          <DialogFooter className="flex-wrap gap-2">
            {isEditingReturn ? (
              <>
                <Button variant="outline" onClick={() => { setIsEditingReturn(false); if (selectedReturn) populateEditFromReturn(selectedReturn); }}>
                  {isAr ? 'إلغاء التعديل' : 'Cancel edit'}
                </Button>
                <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : null}
                  {isAr ? 'حفظ التغييرات' : 'Save changes'}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setDetailsOpen(false)}>
                  {isAr ? 'إغلاق' : 'Close'}
                </Button>
                <Button variant="secondary" onClick={() => startEditingReturn()}>
                  <Pencil className="w-4 h-4 me-2" />
                  {isAr ? 'تعديل' : 'Edit'}
                </Button>
                {selectedReturn?.purchase_batch_id || selectedReturn?.batch?.id ? (
                  <Button onClick={() => openLinkedPurchaseInvoice(selectedReturn.purchase_batch_id ?? selectedReturn.batch?.id)}>
                    <ExternalLink className="w-4 h-4 me-2" />
                    {isAr ? 'فتح فاتورة الشراء' : 'Open purchase invoice'}
                  </Button>
                ) : null}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5" />
              {isAr ? 'إنشاء مرتجع مشتريات' : 'Create Purchase Return'}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2 md:col-span-2">
              <Label>{isAr ? 'فاتورة الشراء' : 'Purchase Invoice'}</Label>
              {loadingBatches ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> {isAr ? 'تحميل...' : 'Loading...'}
                </div>
              ) : (
                <Select value={selectedBatchId} onValueChange={setSelectedBatchId}>
                  <SelectTrigger>
                    <SelectValue placeholder={isAr ? 'اختر الفاتورة' : 'Select invoice'} />
                  </SelectTrigger>
                  <SelectContent>
                    {(batches || []).map((b: any) => (
                      <SelectItem key={String(b.id)} value={String(b.id)}>
                        {purchaseBatchSelectLabel(b, isAr)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label>{isAr ? 'تاريخ المرتجع' : 'Return date'}</Label>
              <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>{isAr ? 'طريقة الاسترداد' : 'Refund method'}</Label>
              <Select value={refundMethod} onValueChange={(v: any) => setRefundMethod(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit_note">{isAr ? 'خصم من مستحقات المورد (Credit Note)' : 'Credit note'}</SelectItem>
                  <SelectItem value="cash">{isAr ? 'نقدي' : 'Cash'}</SelectItem>
                  <SelectItem value="bank_transfer">{isAr ? 'تحويل بنكي' : 'Bank transfer'}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>{isAr ? 'السبب (اختياري)' : 'Reason (optional)'}</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={isAr ? 'مثال: عيب تصنيع / مقاس...' : 'e.g. defect / wrong spec...'} />
            </div>

            <div className="space-y-2 md:col-span-3">
              <Label>{isAr ? 'ملاحظات (اختياري)' : 'Notes (optional)'}</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={isAr ? 'أي تفاصيل إضافية...' : 'Any extra details...'} />
            </div>
          </div>

          <div className="border rounded-lg">
            <div className="px-4 py-2 border-b text-sm font-semibold">
              {isAr ? 'بنود الفاتورة — اختر كميات المرتجع' : 'Invoice items — select return quantities'}
            </div>
            <div className="max-h-[360px] overflow-auto">
              {loadingBatchDetail ? (
                <div className="p-6 flex items-center justify-center text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> {isAr ? 'تحميل البنود...' : 'Loading items...'}
                </div>
              ) : !selectedBatchId ? (
                <div className="p-6 text-sm text-muted-foreground">{isAr ? 'اختر فاتورة لعرض البنود' : 'Select an invoice to see items'}</div>
              ) : batchItems.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">{isAr ? 'لا يوجد بنود' : 'No items'}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{isAr ? 'الصنف' : 'Item'}</TableHead>
                      <TableHead className="text-right">{isAr ? 'الكمية' : 'Qty'}</TableHead>
                      <TableHead className="text-right">{isAr ? 'سعر' : 'Unit'}</TableHead>
                      <TableHead className="text-right">{isAr ? 'مرتجع' : 'Return qty'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batchItems.map((it: any) => (
                      <TableRow key={String(it.id)}>
                        <TableCell>
                          <div className="font-medium">
                            {it?.sku?.offer?.masterProduct?.internal_name || it?.master_product?.internal_name || it.raw_description || it.sku?.sku || '-'}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">{it?.sku?.sku || it?.sku_code || '-'}</div>
                        </TableCell>
                        <TableCell className="text-right">{toNumber(it.received_quantity ?? it.quantity).toLocaleString()}</TableCell>
                        <TableCell className="text-right">{toNumber(it.unit_price).toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            inputMode="decimal"
                            className="w-28 ms-auto text-right"
                            value={qtyByItemId[String(it.id)] ?? ''}
                            onChange={(e) => setQtyByItemId((prev) => ({ ...prev, [String(it.id)]: e.target.value }))}
                            placeholder="0"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {isAr ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {isAr ? 'تسجيل المرتجع' : 'Create return'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

