import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import axios from 'axios';
import { useLanguage } from '@/contexts/LanguageContext';
import { paymentService, Payment, warehouseService, supplierService } from '@/lib/supabase-services';
import { exportToExcel } from '@/lib/excelUtils';
import { supplierNamesMatch } from '@/lib/supplierIdentity';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import {
  Search,
  Plus,
  Download,
  Pencil,
  DollarSign,
  TrendingDown,
  CreditCard,
  Calendar,
  X,
} from 'lucide-react';

const toNumber = (value: number | string | null | undefined) => {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

export default function Payments() {
  const { t, dir, language } = useLanguage();
  const isAr = language === 'ar';
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
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    supplier_id: '',
    warehouse_id: '',
    amount: '',
    payment_method: 'cash',
    description: '',
    payment_date: format(new Date(), 'yyyy-MM-dd'),
  });

  // Queries
  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['payments'],
    queryFn: paymentService.getAll,
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
    mutationFn: paymentService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers-for-profit-balance'] });
      setIsDialogOpen(false);
      resetForm();
      toast.success(t('payments.createdSuccess'));
    },
    onError: (error: any) => {
      if (axios.isAxiosError(error)) {
        const apiMessage = error.response?.data?.message;
        const validationErrors = error.response?.data?.errors;
        if (validationErrors && typeof validationErrors === 'object') {
          const firstError = Object.values(validationErrors).flat()[0];
          toast.error(String(firstError));
          return;
        }
        if (apiMessage) {
          toast.error(apiMessage);
          return;
        }
      }
      toast.error(t('payments.createdError'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => paymentService.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers-for-profit-balance'] });
      setIsDialogOpen(false);
      setEditingPaymentId(null);
      resetForm();
      toast.success(isAr ? 'تم تحديث الدفعة بنجاح' : 'Payment updated successfully');
    },
    onError: (error: any) => {
      if (axios.isAxiosError(error)) {
        const apiMessage = error.response?.data?.message;
        const validationErrors = error.response?.data?.errors;
        if (validationErrors && typeof validationErrors === 'object') {
          const firstError = Object.values(validationErrors).flat()[0];
          toast.error(String(firstError));
          return;
        }
        if (apiMessage) {
          toast.error(apiMessage);
          return;
        }
      }
      toast.error(isAr ? 'فشل تحديث الدفعة' : 'Failed to update payment');
    },
  });

  const resetForm = () => {
    setFormData({
      supplier_id: '',
      warehouse_id: '',
      amount: '',
      payment_method: 'cash',
      description: '',
      payment_date: format(new Date(), 'yyyy-MM-dd'),
    });
  };

  // Filtered data
  const filteredPayments = useMemo(() => {
    const matchesSupplierFilter = (
      payment: Payment & { supplier_id?: string | number; payee_name?: string | null },
      filterSupplierId: string
    ) => {
      if (filterSupplierId === 'all') {
        return true;
      }
      if (String(payment.payee_id || payment.supplier_id) === String(filterSupplierId)) {
        return true;
      }
      const selected = suppliers.find((s) => String(s.id) === String(filterSupplierId));
      const payeeName = String(payment.payee_name ?? '').trim();
      return !!selected && payeeName !== '' && supplierNamesMatch(payeeName, selected.name);
    };

    return payments.filter((payment) => {
      const supplier =
        suppliers.find((s) => String(s.id) === String(payment.payee_id || payment.supplier_id)) ??
        suppliers.find(
          (s) =>
            String(s.name).trim() !== '' &&
            supplierNamesMatch(s.name, payment.payee_name ?? '')
        );
      const matchesSearch =
        !searchQuery ||
        supplier?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        payment.payment_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        payment.notes?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesWarehouse =
        warehouseFilter === 'all' || payment.warehouse_id === warehouseFilter;
      const matchesSupplier = matchesSupplierFilter(payment, supplierFilter);
      const matchesPaymentMethod =
        paymentMethodFilter === 'all' || payment.payment_method === paymentMethodFilter;

      const paymentDate = new Date(payment.payment_date || payment.created_at);
      const matchesDateFrom = !dateFrom || paymentDate >= new Date(dateFrom);
      const matchesDateTo = !dateTo || paymentDate <= new Date(dateTo + 'T23:59:59');

      return matchesSearch && matchesWarehouse && matchesSupplier && matchesPaymentMethod && matchesDateFrom && matchesDateTo;
    });
  }, [payments, suppliers, searchQuery, warehouseFilter, supplierFilter, paymentMethodFilter, dateFrom, dateTo]);

  // Statistics: only completed/confirmed — pending is not cash-out yet; avoids misleading totals.
  const stats = useMemo(() => {
    const rows = filteredPayments.filter((p) => {
      const s = String((p as any).status ?? 'completed').toLowerCase();
      return s === 'completed' || s === 'confirmed';
    });
    const totalAmount = rows.reduce((sum, p) => sum + Math.abs(toNumber(p.amount)), 0);
    const count = rows.length;
    const avgAmount = count > 0 ? totalAmount / count : 0;

    const byMethod: Record<string, number> = {};
    rows.forEach((p) => {
      const method = p.payment_method || 'cash';
      byMethod[method] = (byMethod[method] || 0) + Math.abs(toNumber(p.amount));
    });

    return { totalAmount, count, avgAmount, byMethod };
  }, [filteredPayments]);

  const handleSubmit = () => {
    if (!formData.supplier_id) {
      toast.error(t('payments.selectSupplier'));
      return;
    }
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      toast.error(t('validation.amountRequired'));
      return;
    }

    const payload = {
      payment_number: null,
      payee_type: 'App\\Models\\Inventory\\Supplier',
      payee_id: formData.supplier_id || null,
      supplier_id: formData.supplier_id || null,
      payee_name: suppliers.find((s) => String(s.id) === String(formData.supplier_id))?.name || null,
      warehouse_id: formData.warehouse_id || null,
      amount: parseFloat(formData.amount),
      payment_method: formData.payment_method,
      notes: formData.description || null,
      description: formData.description || null,
      payment_date: formData.payment_date,
      status: 'completed',
    };

    if (editingPaymentId) {
      updateMutation.mutate({ id: editingPaymentId, payload });
      return;
    }

    createMutation.mutate(payload);
  };

  const openCreateDialog = () => {
    setEditingPaymentId(null);
    resetForm();
    setIsDialogOpen(true);
  };

  const openEditDialog = (payment: Payment) => {
    setEditingPaymentId(payment.id);
    setFormData({
      supplier_id: String(payment.payee_id || payment.supplier_id || ''),
      warehouse_id: payment.warehouse_id || '',
      amount: toNumber(payment.amount).toString(),
      payment_method: payment.payment_method || 'cash',
      description: payment.notes || payment.description || '',
      payment_date: format(new Date(payment.payment_date || payment.created_at), 'yyyy-MM-dd'),
    });
    setIsDialogOpen(true);
  };

  const handleExport = () => {
    const exportData = filteredPayments.map((p) => ({
      [t('payments.paymentNumber')]: p.payment_number || '-',
      [t('common.date')]: format(new Date(p.payment_date || p.created_at), 'yyyy-MM-dd'),
      [t('filters.supplier')]: suppliers.find((s) => String(s.id) === String(p.payee_id || p.supplier_id))?.name || p.payee_name || '-',
      [t('table.warehouse')]: warehouses.find((w) => w.id === p.warehouse_id)?.name || '-',
      [t('common.amount')]: p.amount,
      [t('paymentMethod.title')]: p.payment_method,
      [t('common.description')]: p.notes || p.description || '-',
    }));
    exportToExcel(exportData, 'payments');
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
    id ? suppliers.find((s) => String(s.id) === String(id))?.name || '-' : '-';

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
          <h1 className="text-2xl font-bold text-foreground">{t('payments.title')}</h1>
          <p className="text-muted-foreground">{t('payments.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4 me-2" />
            {t('common.export')}
          </Button>
          <Dialog
            open={isDialogOpen}
            onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) {
                setEditingPaymentId(null);
                resetForm();
              }
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" onClick={openCreateDialog}>
                <Plus className="w-4 h-4 me-2" />
                {t('payments.newPayment')}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{editingPaymentId ? t('common.edit') : t('payments.recordPayment')}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{t('common.date')}</Label>
                  <Input
                    type="date"
                    value={formData.payment_date}
                    onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('filters.supplier')}</Label>
                  <Select
                    value={formData.supplier_id}
                    onValueChange={(v) => setFormData({ ...formData, supplier_id: v })}
                  >
                    <SelectTrigger><SelectValue placeholder={t('payments.selectSupplier')} /></SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
                  {createMutation.isPending || updateMutation.isPending ? t('common.saving') : t('common.save')}
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
                <p className="text-sm text-muted-foreground">{t('payments.totalPaid')}</p>
                <p className="text-2xl font-bold text-destructive">{stats.totalAmount.toLocaleString()} EGP</p>
                <p className="text-xs text-muted-foreground mt-2 leading-snug">{t('payments.totalPaidHint')}</p>
              </div>
              <div className="p-3 bg-destructive/20 rounded-full">
                <DollarSign className="w-6 h-6 text-destructive" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('payments.paymentsCount')}</p>
                <p className="text-2xl font-bold">{stats.count}</p>
              </div>
              <div className="p-3 bg-primary/20 rounded-full">
                <CreditCard className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('payments.averageAmount')}</p>
                <p className="text-2xl font-bold">{stats.avgAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} EGP</p>
              </div>
              <div className="p-3 bg-accent/20 rounded-full">
                <TrendingDown className="w-6 h-6 text-accent" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('payments.bankTransfers')}</p>
                <p className="text-2xl font-bold">{(stats.byMethod['bank_transfer'] || 0).toLocaleString()} EGP</p>
                <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{t('payments.bankTransfersHint')}</p>
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
                  placeholder={t('payments.searchPlaceholder')}
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
              <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder={t('filters.supplier')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('filters.allSuppliers')}</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={paymentMethodFilter} onValueChange={setPaymentMethodFilter}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder={t('table.method')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('paymentMethod.allMethods')}</SelectItem>
                  <SelectItem value="cash">{t('paymentMethod.cash')}</SelectItem>
                  <SelectItem value="bank_transfer">{t('paymentMethod.bankTransfer')}</SelectItem>
                  <SelectItem value="card">{t('paymentMethod.card')}</SelectItem>
                  <SelectItem value="check">{t('paymentMethod.check')}</SelectItem>
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
                  <TableHead>{t('payments.paymentNumber')}</TableHead>
                  <TableHead>{t('common.date')}</TableHead>
                  <TableHead>{t('filters.supplier')}</TableHead>
                  <TableHead>{t('table.warehouse')}</TableHead>
                  <TableHead>{t('table.method')}</TableHead>
                  <TableHead className="text-end">{t('common.amount')}</TableHead>
                  <TableHead>{t('common.description')}</TableHead>
                  <TableHead className="text-end">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10">{t('common.loading')}</TableCell>
                  </TableRow>
                ) : filteredPayments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                      {t('payments.noPayments')}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredPayments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell className="font-medium">{payment.payment_number || '-'}</TableCell>
                      <TableCell>{format(new Date(payment.payment_date || payment.created_at), 'yyyy-MM-dd')}</TableCell>
                      <TableCell>{getSupplierName(payment.payee_id || payment.supplier_id)}</TableCell>
                      <TableCell>{getWarehouseName(payment.warehouse_id)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{getPaymentMethodLabel(payment.payment_method || 'cash')}</Badge>
                      </TableCell>
                      <TableCell className="text-end font-medium text-destructive">
                        -{toNumber(payment.amount).toLocaleString()} EGP
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">{payment.notes || payment.description || '-'}</TableCell>
                      <TableCell className="text-end">
                        <Button variant="outline" size="sm" onClick={() => openEditDialog(payment)} className="gap-1">
                          <Pencil className="w-3.5 h-3.5" />
                          {t('common.edit')}
                        </Button>
                      </TableCell>
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
