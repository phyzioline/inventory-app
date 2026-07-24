import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import axios from 'axios';
import { useLanguage } from '@/contexts/LanguageContext';
import { receiptService, warehouseService, supplierService } from '@/lib/supabase-services';
import { exportToExcel } from '@/lib/excelUtils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import {
  Search,
  Plus,
  Download,
  DollarSign,
  TrendingUp,
  Receipt as ReceiptIcon,
  Calendar,
  Filter,
  X,
} from 'lucide-react';

const toNumber = (value: number | string | null | undefined) => {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

type ReceiptCategory = 'customer_collection' | 'channel_collection' | 'compensation' | 'general';
type ReceiptLinkType = 'none' | 'order' | 'settlement';

function receiptLinkLabel(receipt: Record<string, unknown>): string {
  const rid = receipt.reference_id;
  const rt = String(receipt.reference_type || '');
  const ext = receipt.external_reference ? String(receipt.external_reference) : '';
  if (!rid) {
    return ext || '—';
  }
  if (rt.includes('InventoryOrder')) {
    return `#${rid}`;
  }
  if (rt.includes('Settlement')) {
    return `SET:${rid}`;
  }
  return ext || `#${rid}`;
}

export default function Receipts() {
  const { t, dir } = useLanguage();
  const queryClient = useQueryClient();
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState<string>(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  
  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    customer_name: '',
    supplier_id: '',
    warehouse_id: '',
    amount: '',
    payment_method: 'cash',
    description: '',
    receipt_date: format(new Date(), 'yyyy-MM-dd'),
    category: 'customer_collection' as ReceiptCategory,
    link_type: 'none' as ReceiptLinkType,
    linked_order_id: '',
    linked_settlement_id: '',
    linked_settlement_report_id: '',
    external_reference: '',
    apply_payment_to_order: true,
  });

  // Queries
  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ['receipts'],
    queryFn: receiptService.getAll,
  });

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: warehouseService.getAll,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: supplierService.getAll,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: receiptService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setIsDialogOpen(false);
      resetForm();
      toast.success(t('receipts.createdSuccess'));
    },
    onError: (error: unknown) => {
      if (axios.isAxiosError(error)) {
        const validationErrors = error.response?.data?.errors;
        if (validationErrors && typeof validationErrors === 'object') {
          const first = Object.values(validationErrors).flat()[0];
          if (first) {
            toast.error(String(first));
            return;
          }
        }
        const apiMessage = error.response?.data?.message;
        if (typeof apiMessage === 'string' && apiMessage.trim()) {
          toast.error(apiMessage.trim());
          return;
        }
      }
      toast.error(t('receipts.createdError'));
    },
  });

  const resetForm = () => {
    setFormData({
      customer_name: '',
      supplier_id: '',
      warehouse_id: '',
      amount: '',
      payment_method: 'cash',
      description: '',
      receipt_date: format(new Date(), 'yyyy-MM-dd'),
      category: 'customer_collection',
      link_type: 'none',
      linked_order_id: '',
      linked_settlement_id: '',
      linked_settlement_report_id: '',
      external_reference: '',
      apply_payment_to_order: true,
    });
  };

  // Filtered data
  const filteredReceipts = useMemo(() => {
    return receipts.filter((receipt) => {
      const payer = (receipt as { payer_name?: string | null; customer_name?: string | null }).payer_name
        || (receipt as { customer_name?: string | null }).customer_name;
      const extRef = String((receipt as { external_reference?: string }).external_reference || '');
      const refId = (receipt as { reference_id?: string | number }).reference_id;
      const matchesSearch =
        !searchQuery ||
        payer?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        receipt.receipt_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        receipt.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        extRef.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(refId ?? '').toLowerCase().includes(searchQuery.toLowerCase());

      const matchesWarehouse =
        warehouseFilter === 'all' || receipt.warehouse_id === warehouseFilter;
      const matchesSupplier =
        supplierFilter === 'all' || receipt.supplier_id === supplierFilter;
      const matchesPaymentMethod =
        paymentMethodFilter === 'all' || receipt.payment_method === paymentMethodFilter;

      const receiptDate = new Date(receipt.receipt_date || receipt.created_at);
      const matchesDateFrom = !dateFrom || receiptDate >= new Date(dateFrom);
      const matchesDateTo = !dateTo || receiptDate <= new Date(dateTo + 'T23:59:59');

      return matchesSearch && matchesWarehouse && matchesSupplier && matchesPaymentMethod && matchesDateFrom && matchesDateTo;
    });
  }, [receipts, searchQuery, warehouseFilter, supplierFilter, paymentMethodFilter, dateFrom, dateTo]);

  // Statistics
  const stats = useMemo(() => {
    const totalAmount = filteredReceipts.reduce((sum, r) => sum + toNumber(r.amount), 0);
    const count = filteredReceipts.length;
    const avgAmount = count > 0 ? totalAmount / count : 0;
    
    const byMethod: Record<string, number> = {};
    filteredReceipts.forEach((r) => {
      const method = r.payment_method || 'cash';
      byMethod[method] = (byMethod[method] || 0) + toNumber(r.amount);
    });

    return { totalAmount, count, avgAmount, byMethod };
  }, [filteredReceipts]);

  const receiptCategoryLabel = (cat: string | null | undefined) => {
    const key = `receipts.category.${cat || 'general'}`;
    const out = t(key);
    return out !== key ? out : cat || '—';
  };

  const handleSubmit = () => {
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      toast.error(t('validation.amountRequired'));
      return;
    }

    if (formData.link_type === 'order') {
      const oid = parseInt(String(formData.linked_order_id).trim(), 10);
      if (!Number.isFinite(oid) || oid <= 0) {
        toast.error(t('receipts.orderIdInvalid'));
        return;
      }
    }

    if (formData.link_type === 'settlement') {
      const sid = String(formData.linked_settlement_id).trim();
      const rep = String(formData.linked_settlement_report_id).trim();
      if (!sid && !rep) {
        toast.error(t('receipts.settlementMissing'));
        return;
      }
      if (sid && rep) {
        toast.error(t('receipts.settlementOneField'));
        return;
      }
    }

    const payload: Record<string, unknown> = {
      category: formData.category,
      payer_name: formData.customer_name?.trim() || null,
      warehouse_id: formData.warehouse_id || null,
      amount: parseFloat(formData.amount),
      payment_method: formData.payment_method,
      description: formData.description?.trim() || null,
      receipt_date: formData.receipt_date,
      external_reference: formData.external_reference?.trim() || null,
    };

    if (formData.link_type === 'order') {
      payload.linked_inventory_order_id = parseInt(String(formData.linked_order_id).trim(), 10);
      payload.apply_payment_to_order = formData.apply_payment_to_order;
    } else if (formData.link_type === 'settlement') {
      const sid = String(formData.linked_settlement_id).trim();
      const rep = String(formData.linked_settlement_report_id).trim();
      if (sid) {
        payload.linked_settlement_id = parseInt(sid, 10);
      } else {
        payload.linked_settlement_report_id = rep;
      }
    }

    createMutation.mutate(payload);
  };

  const handleExport = () => {
    const exportData = filteredReceipts.map((r) => ({
      [t('receipts.receiptNumber')]: r.receipt_number || '-',
      [t('common.date')]: format(new Date(r.receipt_date || r.created_at), 'yyyy-MM-dd'),
      [t('table.customer')]: (r as { payer_name?: string; customer_name?: string }).payer_name || r.customer_name || '-',
      [t('table.warehouse')]: warehouses.find((w) => w.id === r.warehouse_id)?.name || '-',
      [t('common.amount')]: r.amount,
      [t('paymentMethod.title')]: r.payment_method,
      [t('common.description')]: r.description || '-',
      [t('receipts.colCategory')]: receiptCategoryLabel((r as { category?: string }).category),
      [t('receipts.colLink')]: receiptLinkLabel(r as Record<string, unknown>),
      [t('receipts.colExternalRef')]: (r as { external_reference?: string }).external_reference || '-',
    }));
    exportToExcel(exportData, 'receipts');
  };

  const clearFilters = () => {
    setSearchQuery('');
    setWarehouseFilter('all');
    setSupplierFilter('all');
    setPaymentMethodFilter('all');
    setDateFrom(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
    setDateTo(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  };

  const getWarehouseName = (id: string | null) => 
    id ? warehouses.find((w) => w.id === id)?.name || '-' : '-';
  
  const getSupplierName = (id: string | null) => 
    id ? suppliers.find((s) => s.id === id)?.name || '-' : '-';

  const getPaymentMethodLabel = (method: string) => {
    const methodMap: Record<string, string> = {
      'cash': t('paymentMethod.cash'),
      'bank_transfer': t('paymentMethod.bankTransfer'),
      'card': t('paymentMethod.card'),
      'check': t('paymentMethod.check'),
      'online': t('paymentMethod.online'),
    };
    return methodMap[method] || method;
  };

  return (
    <div className="space-y-6" dir={dir}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('receipts.title')}</h1>
          <p className="text-muted-foreground">{t('receipts.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4 me-2" />
            {t('common.export')}
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="w-4 h-4 me-2" />
                {t('receipts.newReceipt')}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{t('receipts.createReceipt')}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{t('common.date')}</Label>
                  <Input
                    type="date"
                    value={formData.receipt_date}
                    onChange={(e) => setFormData({ ...formData, receipt_date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('receipts.categoryLabel')}</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(v) => setFormData({ ...formData, category: v as ReceiptCategory })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="customer_collection">{t('receipts.category.customer_collection')}</SelectItem>
                      <SelectItem value="channel_collection">{t('receipts.category.channel_collection')}</SelectItem>
                      <SelectItem value="compensation">{t('receipts.category.compensation')}</SelectItem>
                      <SelectItem value="general">{t('receipts.category.general')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('receipts.customerName')}</Label>
                  <Input
                    value={formData.customer_name}
                    onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                    placeholder={t('receipts.customerName')}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('filters.warehouse')}</Label>
                    <Select
                      value={formData.warehouse_id}
                      onValueChange={(v) => setFormData({ ...formData, warehouse_id: v })}
                    >
                      <SelectTrigger><SelectValue placeholder={t('common.select')} /></SelectTrigger>
                      <SelectContent>
                        {warehouses.map((w) => (
                          <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('common.amount')} *</Label>
                    <Input
                      type="number"
                      value={formData.amount}
                      onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t('paymentMethod.title')}</Label>
                  <Select
                    value={formData.payment_method}
                    onValueChange={(v) => setFormData({ ...formData, payment_method: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">{t('paymentMethod.cash')}</SelectItem>
                      <SelectItem value="bank_transfer">{t('paymentMethod.bankTransfer')}</SelectItem>
                      <SelectItem value="card">{t('paymentMethod.card')}</SelectItem>
                      <SelectItem value="check">{t('paymentMethod.check')}</SelectItem>
                      <SelectItem value="online">{t('paymentMethod.online')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 border rounded-md p-3 bg-muted/20">
                  <Label>{t('receipts.linkSection')}</Label>
                  <Select
                    value={formData.link_type}
                    onValueChange={(v) =>
                      setFormData({
                        ...formData,
                        link_type: v as ReceiptLinkType,
                        linked_order_id: '',
                        linked_settlement_id: '',
                        linked_settlement_report_id: '',
                      })
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('receipts.linkNone')}</SelectItem>
                      <SelectItem value="order">{t('receipts.linkOrder')}</SelectItem>
                      <SelectItem value="settlement">{t('receipts.linkSettlement')}</SelectItem>
                    </SelectContent>
                  </Select>
                  {formData.link_type === 'order' ? (
                    <div className="space-y-3 pt-2">
                      <div className="space-y-2">
                        <Label>{t('receipts.orderId')}</Label>
                        <Input
                          inputMode="numeric"
                          value={formData.linked_order_id}
                          onChange={(e) => setFormData({ ...formData, linked_order_id: e.target.value })}
                          placeholder="123"
                          dir="ltr"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="apply-order"
                          checked={formData.apply_payment_to_order}
                          onCheckedChange={(c) =>
                            setFormData({ ...formData, apply_payment_to_order: c === true })
                          }
                        />
                        <Label htmlFor="apply-order" className="text-sm font-normal cursor-pointer">
                          {t('receipts.applyToOrder')}
                        </Label>
                      </div>
                    </div>
                  ) : null}
                  {formData.link_type === 'settlement' ? (
                    <div className="space-y-3 pt-2">
                      <div className="space-y-2">
                        <Label>{t('receipts.settlementId')}</Label>
                        <Input
                          inputMode="numeric"
                          value={formData.linked_settlement_id}
                          onChange={(e) =>
                            setFormData({ ...formData, linked_settlement_id: e.target.value, linked_settlement_report_id: '' })
                          }
                          placeholder="12"
                          dir="ltr"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground text-center">— {t('common.or')} —</p>
                      <div className="space-y-2">
                        <Label>{t('receipts.settlementReportId')}</Label>
                        <Input
                          value={formData.linked_settlement_report_id}
                          onChange={(e) =>
                            setFormData({ ...formData, linked_settlement_report_id: e.target.value, linked_settlement_id: '' })
                          }
                          placeholder="26626421882"
                          dir="ltr"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{t('receipts.settlementHint')}</p>
                    </div>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label>{t('receipts.externalRef')}</Label>
                  <Input
                    value={formData.external_reference}
                    onChange={(e) => setFormData({ ...formData, external_reference: e.target.value })}
                    placeholder={t('receipts.externalRef')}
                    dir="ltr"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('common.description')}</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder={t('common.description')}
                    rows={2}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>{t('common.cancel')}</Button>
                <Button onClick={handleSubmit} disabled={createMutation.isPending}>
                  {createMutation.isPending ? t('common.saving') : t('common.save')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('receipts.totalReceived')}</p>
                <p className="text-2xl font-bold text-success">{stats.totalAmount.toLocaleString()} EGP</p>
              </div>
              <div className="p-3 bg-success/20 rounded-full">
                <DollarSign className="w-6 h-6 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('receipts.receiptsCount')}</p>
                <p className="text-2xl font-bold">{stats.count}</p>
              </div>
              <div className="p-3 bg-primary/20 rounded-full">
                <ReceiptIcon className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('receipts.averageAmount')}</p>
                <p className="text-2xl font-bold">{stats.avgAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} EGP</p>
              </div>
              <div className="p-3 bg-accent/20 rounded-full">
                <TrendingUp className="w-6 h-6 text-accent" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('receipts.cashPayments')}</p>
                <p className="text-2xl font-bold">{(stats.byMethod['cash'] || 0).toLocaleString()} EGP</p>
              </div>
              <div className="p-3 bg-warning/20 rounded-full">
                <Calendar className="w-6 h-6 text-warning" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="glass-card">
        <CardContent className="pt-6">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder={t('receipts.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="ps-10"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder={t('filters.warehouse')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('filters.allWarehouses')}</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={paymentMethodFilter} onValueChange={setPaymentMethodFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder={t('table.method')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('paymentMethod.allMethods')}</SelectItem>
                  <SelectItem value="cash">{t('paymentMethod.cash')}</SelectItem>
                  <SelectItem value="bank_transfer">{t('paymentMethod.bankTransfer')}</SelectItem>
                  <SelectItem value="card">{t('paymentMethod.card')}</SelectItem>
                  <SelectItem value="check">{t('paymentMethod.check')}</SelectItem>
                  <SelectItem value="online">{t('paymentMethod.online')}</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-[140px]"
              />
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-[140px]"
              />
              <Button variant="ghost" size="icon" onClick={clearFilters}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="glass-card">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('receipts.receiptNumber')}</TableHead>
                  <TableHead>{t('common.date')}</TableHead>
                  <TableHead>{t('receipts.colCategory')}</TableHead>
                  <TableHead>{t('table.customer')}</TableHead>
                  <TableHead>{t('receipts.colLink')}</TableHead>
                  <TableHead>{t('receipts.colExternalRef')}</TableHead>
                  <TableHead>{t('table.warehouse')}</TableHead>
                  <TableHead>{t('table.method')}</TableHead>
                  <TableHead className="text-end">{t('common.amount')}</TableHead>
                  <TableHead>{t('common.description')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-10">{t('common.loading')}</TableCell>
                  </TableRow>
                ) : filteredReceipts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
                      {t('receipts.noReceipts')}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredReceipts.map((receipt) => (
                    <TableRow key={receipt.id}>
                      <TableCell className="font-medium">{receipt.receipt_number || '-'}</TableCell>
                      <TableCell>{format(new Date(receipt.receipt_date || receipt.created_at), 'yyyy-MM-dd')}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {receiptCategoryLabel((receipt as { category?: string }).category)}
                      </TableCell>
                      <TableCell>
                        {(receipt as { payer_name?: string | null; customer_name?: string | null }).payer_name
                          || receipt.customer_name
                          || '-'}
                      </TableCell>
                      <TableCell className="font-mono text-sm" dir="ltr">
                        {receiptLinkLabel(receipt as Record<string, unknown>)}
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate font-mono text-sm" dir="ltr">
                        {(receipt as { external_reference?: string }).external_reference || '—'}
                      </TableCell>
                      <TableCell>{getWarehouseName(receipt.warehouse_id)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{getPaymentMethodLabel(receipt.payment_method || 'cash')}</Badge>
                      </TableCell>
                      <TableCell className="text-end font-medium text-success">
                        +{toNumber(receipt.amount).toLocaleString()} EGP
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">{receipt.description || '-'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
