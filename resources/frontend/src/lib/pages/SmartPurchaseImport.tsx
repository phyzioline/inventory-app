import { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';
import {
  Upload,
  FileText,
  Brain,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Package,
  Pencil,
  Trash2,
  Plus,
  Eye,
  ArrowRight,
  ArrowLeft,
  Download,
  RefreshCw,
  Sparkles,
  Truck,
  ClipboardCheck,
  Check,
  ChevronsUpDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface BatchItem {
  id: number;
  raw_description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  product_matched: boolean;
  master_product_id: number | null;
  sku_id: number | null;
  received_quantity: number | null;
  variance_quantity: number | null;
  variance_notes: string | null;
  master_product?: { id: number; internal_name: string } | null;
  sku?: { id: number; sku: string } | null;
  is_verified?: boolean;
}

interface Batch {
  id: number;
  batch_number: string;
  status: string;
  supplier_name_raw: string | null;
  supplier_matched: boolean;
  vendor_id: number | null;
  vendor?: { id: number; name: string } | null;
  invoice_number: string | null;
  invoice_date: string | null;
  currency: string;
  subtotal: number;
  tax_amount: number;
  grand_total: number;
  location_id?: number | null;
  items: BatchItem[];
  items_count?: number;
  upload?: any;
  notes?: string | null;
}

function parsePaymentMeta(rawNotes: unknown): {
  paid: number | null;
  remaining: number | null;
  type: 'cash' | 'credit' | null;
  status: string | null;
} {
  const notes = String(rawNotes || '');
  const line = notes.split(/\r?\n/).find((l) => l.trim().startsWith('[PAYMENT]')) || '';
  const paidMatch = line.match(/paid=([0-9]+(?:\.[0-9]+)?)/i);
  const remainingMatch = line.match(/remaining=([0-9]+(?:\.[0-9]+)?)/i);
  const typeMatch = line.match(/type=(cash|credit)/i);
  const statusMatch = line.match(/status=([a-z_]+)/i);
  return {
    paid: paidMatch ? Number(paidMatch[1]) : null,
    remaining: remainingMatch ? Number(remainingMatch[1]) : null,
    type: (typeMatch?.[1]?.toLowerCase() === 'cash' || typeMatch?.[1]?.toLowerCase() === 'credit'
      ? (typeMatch[1].toLowerCase() as 'cash' | 'credit')
      : null),
    status: statusMatch?.[1]?.toLowerCase() || null,
  };
}

/** Resolve display name for SKU rows (channel listing name, API product_name, or master). */
function masterNameFromSku(s: any): string {
  const mp = s?.offer?.master_product ?? s?.offer?.masterProduct;
  return String(s?.product_name || s?.name || mp?.internal_name || '').trim();
}

/** Match user search against sku code, listing name, master name, marketplace id; digits-only for PHY vs PH style. */
function skuMatchesSearch(s: any, rawQ: string): boolean {
  const q = rawQ.trim().toLowerCase();
  if (!q) return true;
  const mp = s?.offer?.master_product ?? s?.offer?.masterProduct;
  const blobs = [
    s?.sku,
    s?.sku_code,
    s?.name,
    s?.product_name,
    s?.marketplace_id,
    mp?.internal_name,
    String(s?.id ?? ''),
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());
  if (blobs.some((b) => b.includes(q))) return true;
  const qDigits = q.replace(/\D/g, '');
  if (qDigits.length >= 2) {
    const skuDigits = String(s?.sku ?? '').replace(/\D/g, '');
    if (skuDigits.includes(qDigits)) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════

export default function SmartPurchaseImport() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState('upload');
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            {t('smartImport.title')}
          </h1>
          <p className="text-muted-foreground">{t('smartImport.subtitle')}</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-3 w-full max-w-lg">
          <TabsTrigger value="upload" className="gap-2">
            <Upload className="w-4 h-4" />
            {t('smartImport.upload')}
          </TabsTrigger>
          <TabsTrigger value="batches" className="gap-2">
            <ClipboardCheck className="w-4 h-4" />
            {t('smartImport.batches')}
          </TabsTrigger>
          <TabsTrigger value="review" className="gap-2" disabled={!selectedBatchId}>
            <Eye className="w-4 h-4" />
            {t('smartImport.review')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload">
          <UploadSection onBatchCreated={(id) => {
            setSelectedBatchId(id);
            setActiveTab('review');
            queryClient.invalidateQueries({ queryKey: ['purchase-batches'] });
          }} />
        </TabsContent>

        <TabsContent value="batches">
          <BatchListSection onSelectBatch={(id) => {
            setSelectedBatchId(id);
            setActiveTab('review');
          }} />
        </TabsContent>

        <TabsContent value="review">
          {selectedBatchId && (
            <BatchReviewSection
              batchId={selectedBatchId}
              onBack={() => setActiveTab('batches')}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Upload Section
// ═══════════════════════════════════════════════════════════════

function UploadSection({ onBatchCreated }: { onBatchCreated: (id: number) => void }) {
  const { t } = useLanguage();
  const [dragActive, setDragActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');

  const handleDownloadTemplate = useCallback(() => {
    const headers = [
      'رقم الفاتورة',
      'تاريخ الفاتورة',
      'اسم المورد',
      'SKU',
      'وصف المنتج',
      'الكمية',
      'سعر الشراء',
      'العملة',
      'ملاحظات',
    ];

    const worksheet = XLSX.utils.aoa_to_sheet([
      headers,
      ['', '', '', '', '', '', '', 'EGP', ''],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Template');
    XLSX.writeFile(workbook, 'smart-purchase-import-template.xlsx');
  }, []);

  const handleFile = useCallback(async (file: File) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
    const ext = file.name.split('.').pop()?.toLowerCase();
    const allowedExts = ['pdf', 'jpg', 'jpeg', 'png', 'xlsx', 'xls'];

    if (!allowedExts.includes(ext || '')) {
      toast.error(t('smartImport.invalidFile'));
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast.error('File too large. Max 20MB.');
      return;
    }

    setProcessing(true);
    setProgress(10);
    setProgressLabel(t('smartImport.stepUpload'));

    try {
      const formData = new FormData();
      formData.append('file', file);

      setProgress(30);
      setProgressLabel(t('smartImport.stepExtract'));

      const response = await api.upload('/purchases/smart-import/upload', formData);

      setProgress(80);
      setProgressLabel(t('smartImport.stepAI'));

      // Small delay for UX
      await new Promise(r => setTimeout(r, 500));

      setProgress(100);
      setProgressLabel(t('smartImport.stepDone'));

      toast.success(t('smartImport.success'));

      if (response.batch?.id) {
        onBatchCreated(response.batch.id);
      }
    } catch (error: any) {
      const msg = error?.response?.data?.message || error?.message || 'Upload failed';
      toast.error(msg);
    } finally {
      setTimeout(() => {
        setProcessing(false);
        setProgress(0);
        setProgressLabel('');
      }, 1000);
    }
  }, [onBatchCreated, t]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t('smartImport.templateHint')}</p>
        <Button type="button" variant="outline" className="gap-2" onClick={handleDownloadTemplate}>
          <Download className="w-4 h-4" />
          {t('smartImport.downloadTemplate')}
        </Button>
      </div>

      {/* Pipeline Diagram */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: Upload, label: t('smartImport.stepUpload'), color: 'text-blue-500', active: progress >= 10 },
          { icon: FileText, label: t('smartImport.stepExtract'), color: 'text-purple-500', active: progress >= 30 },
          { icon: Brain, label: t('smartImport.stepAI'), color: 'text-orange-500', active: progress >= 80 },
          { icon: CheckCircle2, label: t('smartImport.stepDone'), color: 'text-green-500', active: progress >= 100 },
        ].map((step, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className={`stat-card flex items-center gap-3 transition-all ${step.active ? 'border-primary/30 bg-primary/5' : ''}`}
          >
            <step.icon className={`w-5 h-5 ${step.active ? step.color : 'text-muted-foreground/50'}`} />
            <span className={`text-sm font-medium ${step.active ? '' : 'text-muted-foreground/50'}`}>{step.label}</span>
          </motion.div>
        ))}
      </div>

      {/* Upload Area */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <div
          className={`border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer
            ${dragActive ? 'border-primary bg-primary/5 scale-[1.02]' : 'border-border hover:border-primary/50 hover:bg-muted/30'}
            ${processing ? 'pointer-events-none opacity-60' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => {
            if (processing) return;
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.pdf,.jpg,.jpeg,.png,.xlsx,.xls';
            input.onchange = (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) handleFile(file);
            };
            input.click();
          }}
        >
          {processing ? (
            <div className="space-y-4">
              <Loader2 className="w-12 h-12 mx-auto animate-spin text-primary" />
              <p className="text-lg font-medium">{progressLabel}</p>
              <Progress value={progress} className="w-64 mx-auto" />
              <p className="text-sm text-muted-foreground">{t('smartImport.processing')}</p>
            </div>
          ) : (
            <>
              <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-lg font-medium mb-2">{t('smartImport.dropzone')}</p>
              <p className="text-sm text-muted-foreground mb-4">{t('smartImport.dropzoneHint')}</p>
              <div className="flex gap-2 justify-center flex-wrap">
                <Badge variant="outline">PDF</Badge>
                <Badge variant="outline">JPG/PNG</Badge>
                <Badge variant="outline">XLSX</Badge>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Batch List Section
// ═══════════════════════════════════════════════════════════════

function BatchListSection({ onSelectBatch }: { onSelectBatch: (id: number) => void }) {
  const { t } = useLanguage();

  const { data: response, isLoading } = useQuery({
    queryKey: ['purchase-batches'],
    queryFn: () => api.get('/purchases/smart-import/batches'),
  });

  const batches: Batch[] = response?.data || [];

  const statusColors: Record<string, string> = {
    draft: 'bg-yellow-500/10 text-yellow-500',
    review: 'bg-blue-500/10 text-blue-500',
    approved: 'bg-green-500/10 text-green-500',
    receiving: 'bg-purple-500/10 text-purple-500',
    received: 'bg-emerald-500/10 text-emerald-500',
    cancelled: 'bg-red-500/10 text-red-500',
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Batch #</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>Invoice #</TableHead>
            <TableHead>Items</TableHead>
            <TableHead>Total</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>{t('common.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                <Package className="w-12 h-12 mx-auto mb-2 opacity-30" />
                {t('smartImport.noBatches')}
              </TableCell>
            </TableRow>
          ) : (
            batches.map((batch) => (
              <TableRow key={batch.id} className="cursor-pointer hover:bg-muted/30" onClick={() => onSelectBatch(batch.id)}>
                <TableCell className="font-mono text-sm">{batch.batch_number}</TableCell>
                <TableCell>
                  {batch.vendor?.name || batch.supplier_name_raw || '—'}
                  {!batch.supplier_matched && batch.supplier_name_raw && (
                    <Badge variant="destructive" className="ml-2 text-xs">Unmatched</Badge>
                  )}
                </TableCell>
                <TableCell>{batch.invoice_number || '—'}</TableCell>
                <TableCell>{batch.items_count ?? batch.items?.length ?? 0}</TableCell>
                <TableCell className="font-medium">{Number(batch.grand_total).toLocaleString()} {batch.currency}</TableCell>
                <TableCell>
                  <Badge className={statusColors[batch.status] || ''}>{batch.status}</Badge>
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" className="gap-1">
                    <Eye className="w-4 h-4" /> View
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Batch Review Section
// ═══════════════════════════════════════════════════════════════

function BatchReviewSection({ batchId, onBack }: { batchId: number; onBack: () => void }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [editingItem, setEditingItem] = useState<BatchItem | null>(null);
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [supplierNameDraft, setSupplierNameDraft] = useState('');
  const [paymentType, setPaymentType] = useState<'cash' | 'credit'>('credit');
  const [paidAmountDraft, setPaidAmountDraft] = useState('');
  const [receiveMode, setReceiveMode] = useState(false);
  const [receiveLocationId, setReceiveLocationId] = useState('');
  const [receivedQtys, setReceivedQtys] = useState<Record<number, number>>({});

  // Fetch batch details
  const { data: batch, isLoading } = useQuery<Batch>({
    queryKey: ['purchase-batch', batchId],
    queryFn: () => api.get(`/purchases/smart-import/batches/${batchId}`),
  });

  // Fetch warehouses/locations for receiving
  const { data: locations } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.getArray('/warehouses'),
  });

  // Fetch suppliers for matching
  const { data: vendors } = useQuery({
    queryKey: ['vendors'],
    queryFn: () => api.getArray('/vendors'),
  });

  // Fetch master products for matching
  const { data: allProducts = [] } = useQuery({
    queryKey: ['master-products'],
    queryFn: () => api.getArray('/master-products'),
  });

  const selectedReceiveLocation = useMemo(
    () => (locations || []).find((l: any) => String(l.id) === String(receiveLocationId)),
    [locations, receiveLocationId]
  );
  const receiveChannelId = selectedReceiveLocation?.channel_id != null && selectedReceiveLocation?.channel_id !== ''
    ? String(selectedReceiveLocation.channel_id)
    : '';

  const { data: allSkus = [] } = useQuery({
    queryKey: ['all-skus-lookup', receiveChannelId],
    queryFn: async () => {
      if (receiveChannelId) {
        const scoped = await api.getArray(`/skus?channel_id=${encodeURIComponent(receiveChannelId)}`);
        if (scoped.length > 0) return scoped;
      }
      return api.getArray('/skus');
    },
  });

  const [skuPickerOpenByRow, setSkuPickerOpenByRow] = useState<Record<number, boolean>>({});
  const [skuSearchByRow, setSkuSearchByRow] = useState<Record<number, string>>({});

  // Mutations
  const cancelMutation = useMutation({
    mutationFn: () => api.post(`/purchases/smart-import/batches/${batchId}/cancel`),
    onSuccess: () => {
      toast.success('Batch cancelled');
      queryClient.invalidateQueries({ queryKey: ['purchase-batch', batchId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-batches'] });
    },
  });

  const updateBatchMutation = useMutation({
    mutationFn: (data: any) => api.put(`/purchases/smart-import/batches/${batchId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-batch', batchId] });
      toast.success('Batch updated');
    },
  });

  const paymentMetaMutation = useMutation({
    mutationFn: (payload: { payment_type: 'cash' | 'credit'; paid_amount?: number }) =>
      api.post(`/purchases/smart-import/batches/${batchId}/payment-meta`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-batch', batchId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-batches'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update payment'),
  });

  const saveReceiveLocation = (locationId: string) => {
    setReceiveLocationId(locationId);
    updateBatchMutation.mutate({ location_id: Number(locationId) });
  };

  const updateItemMutation = useMutation({
    mutationFn: (data: any) => api.put(`/purchases/smart-import/batches/${batchId}`, { items: [data] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-batch', batchId] });
      setEditingItem(null);
      toast.success('Item updated');
    },
  });

  const addItemMutation = useMutation({
    mutationFn: (data: any) => api.post(`/purchases/smart-import/batches/${batchId}/add-item`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-batch', batchId] });
      setIsAddItemOpen(false);
      toast.success('Item added');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to add item'),
  });

  const removeItemMutation = useMutation({
    mutationFn: (itemId: number) => api.delete(`/purchases/smart-import/batches/${batchId}/items/${itemId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-batch', batchId] });
      toast.success('Item removed');
    },
  });

  const toggleVerifyMutation = useMutation({
    mutationFn: ({ itemId, verified }: { itemId: number; verified: boolean }) =>
      api.put(`/purchases/smart-import/batches/${batchId}`, {
        items: [{ id: itemId, is_verified: verified }]
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-batch', batchId] });
    },
  });

  const receiveMutation = useMutation({
    mutationFn: (data: any) => api.post(`/purchases/smart-import/batches/${batchId}/receive`, data),
    onSuccess: (resp: any) => {
      const autoCreatedCount = Array.isArray(resp?.auto_created_items) ? resp.auto_created_items.length : 0;
      if (autoCreatedCount > 0) {
        toast.success(`Batch received! Inventory updated. Auto-created ${autoCreatedCount} new product(s).`);
      } else {
        toast.success('Batch received! Inventory updated.');
      }
      queryClient.invalidateQueries({ queryKey: ['purchase-batch', batchId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-batches'] });
      setReceiveMode(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed'),
  });

  const handleReceive = async () => {
    if (!receiveLocationId) {
      toast.error('Please select a warehouse location');
      return;
    }

    const items = (batch?.items || []).map(item => ({
      id: item.id,
      received_quantity: receivedQtys[item.id] ?? item.quantity,
    }));

    const grandTotal = Number(batch?.grand_total || 0);
    const creditPaid = Math.min(Math.max(0, Number(paidAmountDraft) || 0), grandTotal);

    try {
      // Persist payment meta BEFORE approval so vendor outstanding is calculated correctly.
      await api.post(`/purchases/smart-import/batches/${batchId}/payment-meta`, {
        payment_type: paymentType,
        ...(paymentType === 'credit' ? { paid_amount: creditPaid } : {}),
      });

      // One-step confirmation: if still draft/review, approve then receive immediately.
      if (batch?.status !== 'approved' && batch?.status !== 'received') {
        await api.post(`/purchases/smart-import/batches/${batchId}/approve`);
      }
      receiveMutation.mutate({ location_id: Number(receiveLocationId), items });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed');
    }
  };

  useEffect(() => {
    if (batch?.location_id && !receiveLocationId) {
      setReceiveLocationId(String(batch.location_id));
    }
  }, [batch?.location_id, receiveLocationId]);

  useEffect(() => {
    if (!batch) return;
    const meta = parsePaymentMeta(batch.notes);
    if (meta.type) setPaymentType(meta.type);
    const total = Number(batch.grand_total || 0);
    let paid = meta.paid;
    if (paid === null) {
      paid = meta.type === 'cash' && total > 0 ? total : 0;
    }
    setPaidAmountDraft(String(paid ?? 0));
  }, [batch?.id, batch?.notes, batch?.grand_total]);

  if (isLoading || !batch) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const unmatchedItems = batch.items.filter(i => !i.product_matched).length;
  const isEditable = batch.status === 'draft' || batch.status === 'review';
  const supplierDisplayName = batch.vendor?.name || batch.supplier_name_raw || 'Unknown Supplier';
  const canEditPayment = batch.status !== 'cancelled';
  const grandTotal = Number(batch.grand_total || 0);
  const paidAmountResolved =
    paymentType === 'cash'
      ? grandTotal
      : Math.min(Math.max(0, Number(paidAmountDraft) || 0), grandTotal);
  const remainingAmount = Math.max(0, grandTotal - paidAmountResolved);

  const persistCreditPaid = () => {
    if (!canEditPayment || paymentType !== 'credit') return;
    paymentMetaMutation.mutate({
      payment_type: 'credit',
      paid_amount: Math.min(Math.max(0, Number(paidAmountDraft) || 0), grandTotal),
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h2 className="text-xl font-bold">Batch: {batch.batch_number}</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              {supplierDisplayName}
              {batch.invoice_number && ` — Invoice #${batch.invoice_number}`}
            </span>
          </div>
        </div>
        <Badge className={batch.status === 'received' ? 'bg-green-500/10 text-green-500' : batch.status === 'approved' ? 'bg-blue-500/10 text-blue-500' : 'bg-yellow-500/10 text-yellow-500'}>
          {batch.status.toUpperCase()}
        </Badge>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Grand Total</p>
            <p className="text-xl font-bold">{Number(batch.grand_total).toLocaleString()} {batch.currency}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Items</p>
            <p className="text-xl font-bold">{batch.items.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Matched Products</p>
            <p className="text-xl font-bold text-green-500">{batch.items.filter(i => i.product_matched).length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Unmatched</p>
            <p className={`text-xl font-bold ${unmatchedItems > 0 ? 'text-red-500' : 'text-green-500'}`}>{unmatchedItems}</p>
          </CardContent>
        </Card>
      </div>

      {/* Payment: cash vs credit + paid / remaining (same API as purchase invoices) */}
      <Card className="border-primary/20">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-base">{t('smartImport.paymentTitle')}</CardTitle>
          <p className="text-xs text-muted-foreground font-normal">{t('smartImport.paymentHint')}</p>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <div className="flex flex-col lg:flex-row lg:items-end gap-4 flex-wrap">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('smartImport.paymentMethod')}</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="default"
                  variant={paymentType === 'cash' ? 'default' : 'outline'}
                  className="min-w-[100px]"
                  disabled={!canEditPayment || paymentMetaMutation.isPending}
                  onClick={() => {
                    setPaymentType('cash');
                    paymentMetaMutation.mutate({ payment_type: 'cash' });
                  }}
                >
                  {t('smartImport.cash')}
                </Button>
                <Button
                  type="button"
                  size="default"
                  variant={paymentType === 'credit' ? 'default' : 'outline'}
                  className="min-w-[100px]"
                  disabled={!canEditPayment || paymentMetaMutation.isPending}
                  onClick={() => {
                    setPaymentType('credit');
                    const paid = Math.min(Math.max(0, Number(paidAmountDraft) || 0), grandTotal);
                    paymentMetaMutation.mutate({ payment_type: 'credit', paid_amount: paid });
                  }}
                >
                  {t('smartImport.credit')}
                </Button>
              </div>
            </div>
            <div className="space-y-2 flex-1 min-w-[180px] max-w-xs">
              <Label htmlFor="smart-import-paid">{t('smartImport.paidAmount')}</Label>
              <Input
                id="smart-import-paid"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                disabled={!canEditPayment || paymentType === 'cash' || paymentMetaMutation.isPending}
                value={paymentType === 'cash' ? String(grandTotal) : paidAmountDraft}
                onChange={(e) => setPaidAmountDraft(e.target.value)}
                onBlur={() => persistCreditPaid()}
                className="text-right font-mono"
              />
            </div>
            <div className="space-y-2 min-w-[160px]">
              <Label className="text-xs font-semibold">{t('smartImport.remaining')}</Label>
              <div
                className={cn(
                  'rounded-md border px-3 py-2 text-right font-mono text-sm font-semibold',
                  remainingAmount > 0
                    ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900'
                    : 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-900'
                )}
              >
                {remainingAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {batch.currency}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Warnings */}
      {isEditable && (
        <div className="space-y-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">
                {batch.supplier_matched ? 'Supplier linked' : `Unmatched Supplier: "${batch.supplier_name_raw || 'Unknown'}"`}
              </p>
              <p className="text-xs text-muted-foreground">Write supplier name manually or link it to an existing supplier</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-2">
            <Input
              value={supplierNameDraft || batch.supplier_name_raw || ''}
              placeholder="Type supplier name..."
              onChange={(e) => setSupplierNameDraft(e.target.value)}
            />
            <Button
              variant="outline"
              onClick={() =>
                updateBatchMutation.mutate({
                  supplier_name_raw: (supplierNameDraft || batch.supplier_name_raw || '').trim() || null,
                })
              }
              disabled={updateBatchMutation.isPending}
            >
              Save Supplier Name
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Select onValueChange={(val) => updateBatchMutation.mutate({ vendor_id: Number(val) })}>
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder="Link to existing supplier" />
              </SelectTrigger>
              <SelectContent>
                {(vendors || []).map((v: any) => (
                  <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {batch.vendor_id ? (
              <Button
                variant="ghost"
                onClick={() => updateBatchMutation.mutate({ vendor_id: null })}
                disabled={updateBatchMutation.isPending}
              >
                Unlink
              </Button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Label className="min-w-[120px]">المستودع للاستلام</Label>
            <Select value={receiveLocationId} onValueChange={saveReceiveLocation}>
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="اختر المستودع قبل التأكيد" />
              </SelectTrigger>
              <SelectContent>
                {(locations || []).map((loc: any) => (
                  <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              تحديد المستودع هنا يضبط ربط SKU الصحيح قبل الاستلام.
            </p>
          </div>
        </div>
      )}

      {/* Items Table */}
      <div className="glass-card rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
                <TableHead>الوصف</TableHead>
                <TableHead>SKU</TableHead>
               <TableHead>Product / SKU</TableHead>
               <TableHead className="text-center w-16">Verify</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              {receiveMode && <TableHead className="text-right">Received</TableHead>}
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead className="text-right">Total</TableHead>
              {isEditable && !receiveMode && <TableHead className="w-24">{t('common.actions')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {batch.items.map((item, idx) => (
              <TableRow key={item.id} className={!item.product_matched ? 'bg-red-500/5' : ''}>
                <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                <TableCell className="max-w-[200px] truncate">{item.raw_description}</TableCell>
                <TableCell className="font-mono text-xs">{item.sku?.sku || '—'}</TableCell>
                <TableCell>
                  <Popover
                    open={!!skuPickerOpenByRow[item.id]}
                    onOpenChange={(open) => setSkuPickerOpenByRow(prev => ({ ...prev, [item.id]: open }))}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                          "w-full justify-between h-auto py-1 px-2 text-xs font-normal",
                          !item.product_matched && "border-red-500/50 text-red-600 bg-red-50"
                        )}
                        disabled={!isEditable}
                      >
                        <div className="flex flex-col items-start truncate overflow-hidden">
                          {item.product_matched ? (
                            <>
                              <span className="font-semibold truncate w-full text-left">
                                {item.master_product?.internal_name || '—'}
                              </span>
                              {item.sku && <span className="text-[10px] opacity-70 font-mono truncate w-full text-left">{item.sku.sku}</span>}
                            </>
                          ) : (
                            <span className="italic">Click to match product/SKU</span>
                          )}
                        </div>
                        <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0" align="start">
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder="Search product or SKU..."
                          value={skuSearchByRow[item.id] || ''}
                          onValueChange={(val) => setSkuSearchByRow(prev => ({ ...prev, [item.id]: val }))}
                        />
                        <CommandList>
                          <CommandEmpty>No results found.</CommandEmpty>
                          <CommandGroup heading="Suggestions">
                            {(allSkus || [])
                              .filter((s) => skuMatchesSearch(s, skuSearchByRow[item.id] || ''))
                              .slice(0, 50)
                              .map((sku: any) => {
                                const mp = sku.offer?.master_product ?? sku.offer?.masterProduct;
                                const masterId = mp?.id ?? sku.offer?.master_product_id ?? sku.offer?.masterProduct?.id;
                                return (
                              <CommandItem
                                key={sku.id}
                                value={String(sku.id)}
                                onSelect={() => {
                                  updateItemMutation.mutate({
                                    id: item.id,
                                    master_product_id: masterId ?? null,
                                    sku_id: sku.id,
                                  });
                                  setSkuPickerOpenByRow(prev => ({ ...prev, [item.id]: false }));
                                }}
                                className="flex flex-col items-start py-2"
                              >
                                <div className="flex items-center w-full">
                                  <Check className={cn("mr-2 h-4 w-4", item.sku_id === sku.id ? "opacity-100" : "opacity-0")} />
                                  <div className="truncate flex-1">
                                    <div className="font-medium text-sm">{masterNameFromSku(sku) || '—'}</div>
                                    <div className="text-xs text-muted-foreground font-mono">{sku.sku}</div>
                                  </div>
                                </div>
                              </CommandItem>
                            );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </TableCell>
                <TableCell className="text-center">
                  <Button
                    size="icon"
                    variant="ghost"
                    className={cn(
                      "h-8 w-8",
                      item.is_verified ? "text-green-500 hover:text-green-600 bg-green-50" : "text-muted-foreground"
                    )}
                    onClick={() => toggleVerifyMutation.mutate({ itemId: item.id, verified: !item.is_verified })}
                    disabled={!isEditable}
                  >
                    <ClipboardCheck className={cn("w-4 h-4", item.is_verified && "animate-pulse")} />
                  </Button>
                </TableCell>
                <TableCell className="text-right font-mono">{Number(item.quantity)}</TableCell>
                {receiveMode && (
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      className="w-20 text-right ml-auto"
                      defaultValue={item.quantity}
                      onChange={(e) => setReceivedQtys(prev => ({ ...prev, [item.id]: Number(e.target.value) }))}
                    />
                  </TableCell>
                )}
                <TableCell className="text-right font-mono">{Number(item.unit_price).toLocaleString()}</TableCell>
                <TableCell className="text-right font-mono font-medium">{Number(item.total_price).toLocaleString()}</TableCell>
                {isEditable && !receiveMode && (
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingItem(item)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-red-500 hover:text-red-600"
                        onClick={() => removeItemMutation.mutate(item.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Receiving - Location selector */}
      {receiveMode && (
        <div className="flex items-center gap-4 p-4 rounded-lg bg-primary/5 border border-primary/20">
          <Truck className="w-5 h-5 text-primary" />
          <Label className="flex-shrink-0">Receive to:</Label>
          <Select value={receiveLocationId} onValueChange={saveReceiveLocation}>
            <SelectTrigger className="w-[250px]">
              <SelectValue placeholder="Select warehouse" />
            </SelectTrigger>
            <SelectContent>
              {(locations || []).map((loc: any) => (
                <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            اختيار المستودع هنا يحدد الـSKU الصحيح قبل ترحيل المخزون.
          </p>
          <Button onClick={handleReceive} disabled={receiveMutation.isPending} className="gap-2">
            {receiveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Confirm Received
          </Button>
          <Button variant="outline" onClick={() => setReceiveMode(false)}>Cancel</Button>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 justify-end">
        {isEditable && (
          <Button variant="outline" className="gap-2" onClick={() => setIsAddItemOpen(true)}>
            <Plus className="w-4 h-4" /> Add Item
          </Button>
        )}
        {(batch.status === 'draft' || batch.status === 'review') && (
          <>
            <Button variant="outline" className="gap-2 text-red-500" onClick={() => cancelMutation.mutate()}>
              <XCircle className="w-4 h-4" /> Cancel Batch
            </Button>
            <Button className="gap-2" onClick={() => {
              setReceiveMode(true);
              const qtys: Record<number, number> = {};
              batch.items.forEach(i => { qtys[i.id] = Number(i.quantity); });
              setReceivedQtys(qtys);
            }}>
              <Truck className="w-4 h-4" /> Confirm & Receive
            </Button>
          </>
        )}
        {batch.status === 'approved' && (
          <Button className="gap-2" onClick={() => {
            setReceiveMode(true);
            // Pre-fill received quantities
            const qtys: Record<number, number> = {};
            batch.items.forEach(i => { qtys[i.id] = Number(i.quantity); });
            setReceivedQtys(qtys);
          }}>
            <Truck className="w-4 h-4" /> Receive Items
          </Button>
        )}
        {batch.status === 'received' && (
          <Badge className="bg-green-500/10 text-green-500 text-base px-4 py-2">
            <CheckCircle2 className="w-5 h-5 mr-2" /> Fully Received
          </Badge>
        )}
      </div>

      {/* Edit Item Dialog */}
      {editingItem && (
        <EditItemDialog
          item={editingItem}
          products={allProducts || []}
          onClose={() => setEditingItem(null)}
          onSave={(data) => updateItemMutation.mutate(data)}
          saving={updateItemMutation.isPending}
        />
      )}

      {isAddItemOpen && (
        <AddItemDialog
          products={allProducts || []}
          onClose={() => setIsAddItemOpen(false)}
          onSave={(data) => addItemMutation.mutate(data)}
          saving={addItemMutation.isPending}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Edit Item Dialog
// ═══════════════════════════════════════════════════════════════

function EditItemDialog({ item, products, onClose, onSave, saving }: {
  item: BatchItem;
  products: any[];
  onClose: () => void;
  onSave: (data: any) => void;
  saving: boolean;
}) {
  const [qty, setQty] = useState(String(item.quantity));
  const [price, setPrice] = useState(String(item.unit_price));
  const [productId, setProductId] = useState(String(item.master_product_id || ''));
  const [desc, setDesc] = useState(item.raw_description || '');

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Line Item</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Description</Label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Link to Master Product</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger>
                <SelectValue placeholder="Select product (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {products.map((p: any) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.internal_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Unit Price</Label>
              <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </div>
          <div className="p-3 rounded-lg bg-muted/50">
            <span className="text-sm text-muted-foreground">Line Total: </span>
            <span className="font-bold">{(Number(qty) * Number(price)).toLocaleString()} EGP</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave({
            id: item.id,
            raw_description: desc,
            master_product_id: productId && productId !== 'none' ? Number(productId) : null,
            quantity: Number(qty),
            unit_price: Number(price),
          })} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddItemDialog({ products, onClose, onSave, saving }: {
  products: any[];
  onClose: () => void;
  onSave: (data: any) => void;
  saving: boolean;
}) {
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('0');
  const [productId, setProductId] = useState('none');
  const [desc, setDesc] = useState('');

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Line Item</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Description</Label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Item description" />
          </div>
          <div className="space-y-2">
            <Label>Link to Master Product (Optional)</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger>
                <SelectValue placeholder="Select product (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {products.map((p: any) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.internal_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} min={0.01} />
            </div>
            <div className="space-y-2">
              <Label>Unit Price</Label>
              <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} min={0} />
            </div>
          </div>
          <div className="p-3 rounded-lg bg-muted/50">
            <span className="text-sm text-muted-foreground">Line Total: </span>
            <span className="font-bold">{(Number(qty) * Number(price)).toLocaleString()} EGP</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSave({
              raw_description: desc.trim(),
              master_product_id: productId !== 'none' ? Number(productId) : null,
              quantity: Number(qty),
              unit_price: Number(price),
            })}
            disabled={saving || !desc.trim() || Number(qty) <= 0}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Add Item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
