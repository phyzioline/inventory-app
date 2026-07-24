import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Loader2, Printer, ArrowDownWideNarrow, ArrowUpWideNarrow, Pencil, Trash2, HandCoins } from 'lucide-react';
import { useCreateSupplier, useSuppliers, useUpdateSupplier, useDeleteSupplier } from '@/hooks/useSuppliers';
import { useSupplierAccountSummaries, type SupplierAccountSummary } from '@/hooks/useSupplierAccountSummaries';
import { useLanguage } from '@/contexts/LanguageContext';
import api from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { getDefaultPrintBranding, printSupplierStatement } from '@/lib/printUtils';
import { getSupplierAccountView, getSupplierOutstanding } from '@/lib/supplierOutstanding';
import {
  formatSupplierLedgerRowDescription,
  formatSupplierPaymentDescription,
} from '@/lib/statementLedgerLabels';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';

type SupplierAccount = {
  supplier: any;
  summary: SupplierAccountSummary;
  invoices: any[];
  payments: any[];
  ledger: any[];
};

/** Payable to supplier (red) vs credit in our favor (green). */
function getOutstandingCell(summary: SupplierAccountSummary) {
  const outstanding = Number(summary.outstanding) || 0;
  const netPurchasesMinusPaid =
    (Number(summary.total_purchases) || 0) - (Number(summary.total_paid) || 0);

  if (outstanding > 0.005) {
    return {
      text: outstanding.toLocaleString(),
      className: 'text-right font-semibold text-red-600 dark:text-red-400',
    };
  }
  if (outstanding < -0.005) {
    return {
      text: Math.abs(outstanding).toLocaleString(),
      className: 'text-right font-semibold text-green-600 dark:text-green-400',
    };
  }
  if (netPurchasesMinusPaid < -0.005) {
    return {
      text: Math.abs(netPurchasesMinusPaid).toLocaleString(),
      className: 'text-right font-semibold text-green-600 dark:text-green-400',
    };
  }
  return {
    text: '0',
    className: 'text-right text-muted-foreground',
  };
}

export default function SuppliersPage() {
  const { language, dir, t } = useLanguage();
  const isAr = language === 'ar';
  const queryClient = useQueryClient();

  const purchaseBatchStatusLabel = (raw: string | null | undefined) => {
    const s = String(raw || '').toLowerCase();
    const key: Record<string, string> = {
      paid: 'purchases.status.paid',
      partially_paid: 'purchases.status.partiallyPaid',
      confirmed: 'purchases.payment.credit',
      draft: 'purchases.status.draft',
      review: 'purchases.status.review',
      cancelled: 'purchases.status.cancelled',
      pending: 'purchases.status.partiallyPaid',
    };
    return t(key[s] || 'purchases.status.confirmed');
  };
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data: suppliers = [], isLoading, refetch } = useSuppliers();
  const createSupplier = useCreateSupplier();
  const updateSupplier = useUpdateSupplier();
  const deleteSupplier = useDeleteSupplier();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'partial' | 'unpaid'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isAddSupplierOpen, setIsAddSupplierOpen] = useState(false);
  const [isEditSupplierOpen, setIsEditSupplierOpen] = useState(false);
  const [isSettleDialogOpen, setIsSettleDialogOpen] = useState(false);
  const { summaryMap, summariesReady, setSummaryMap } = useSupplierAccountSummaries(suppliers, { startDate, endDate });
  const navigate = useNavigate();
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<SupplierAccount | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<any | null>(null);
  const [settlingSupplier, setSettlingSupplier] = useState<any | null>(null);
  const [settleForm, setSettleForm] = useState({
    amount: '',
    payment_method: 'cash',
    payment_date: todayIso,
    notes: '',
  });
  const [sortField, setSortField] = useState<'total_purchases' | 'total_paid' | 'outstanding' | 'invoice_count' | 'avg_payment_days' | null>(null);
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc');
  const [statementIncludeLineItems, setStatementIncludeLineItems] = useState(true);
  const [expandedLedgerRows, setExpandedLedgerRows] = useState<Set<string>>(new Set());

  const filteredSuppliers = useMemo(() => {
    return suppliers.filter((s: any) => {
      if (!s || s.id == null || String(s.id).trim() === '') return false;
      const q = search.trim().toLowerCase();
      const matchSearch = !q || s.name?.toLowerCase().includes(q) || s.email?.toLowerCase().includes(q);
      const outstanding = getSupplierOutstanding(s, summaryMap);
      const summary = getSupplierAccountView(s, summaryMap);
      const status = outstanding <= 0 ? 'paid' : summary.total_paid > 0 ? 'partial' : 'unpaid';
      const matchStatus = statusFilter === 'all' || status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [suppliers, search, statusFilter, summaryMap]);

  const totals = useMemo(() => {
    return filteredSuppliers.reduce(
      (acc: any, s: any) => {
        const summary = getSupplierAccountView(s, summaryMap);
        acc.totalPurchases += Number(summary.total_purchases || 0);
        acc.totalPaid += Number(summary.total_paid || 0);
        acc.outstanding += Number(summary.outstanding || 0);
        acc.invoiceCount += Number(summary.invoice_count || 0);
        return acc;
      },
      { totalPurchases: 0, totalPaid: 0, outstanding: 0, invoiceCount: 0 }
    );
  }, [filteredSuppliers, summaryMap]);

  const summariesPending = !summariesReady && suppliers.length > 0;

  const sortedSuppliers = useMemo(() => {
    const rows = [...filteredSuppliers];
    if (!sortField) return rows;

    rows.sort((a: any, b: any) => {
      const aSummary = getSupplierAccountView(a, summaryMap);
      const bSummary = getSupplierAccountView(b, summaryMap);
      const aValue = Number((aSummary as any)[sortField] || 0);
      const bValue = Number((bSummary as any)[sortField] || 0);
      return sortDirection === 'desc' ? bValue - aValue : aValue - bValue;
    });

    return rows;
  }, [filteredSuppliers, summaryMap, sortField, sortDirection]);

  const openDetails = async (supplierId: string) => {
    setSelectedSupplierId(supplierId);
    setDetailLoading(true);
    try {
      const data = await api.get(`suppliers/${supplierId}/account-summary`, {
        params: startDate && endDate ? { start_date: startDate, end_date: endDate } : {},
      });
      setSelectedAccount(data);
    } catch (error: any) {
      setSelectedAccount(null);
      setSelectedSupplierId(null);
      toast.error(error?.response?.data?.message || (isAr ? 'تعذر تحميل تفاصيل المورد' : 'Failed to load supplier details'));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleAddSupplier = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createSupplier.mutate({
      name: String(formData.get('name') || ''),
      email: String(formData.get('email') || '') || null,
      phone: String(formData.get('phone') || '') || null,
      address: String(formData.get('address') || '') || null,
      balance: 0,
      is_active: true,
    }, {
      onSuccess: async () => {
        setIsAddSupplierOpen(false);
        await refetch();
      },
    });
  };

  const handleSort = (field: 'total_purchases' | 'total_paid' | 'outstanding' | 'invoice_count' | 'avg_payment_days') => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
      return;
    }
    setSortField(field);
    setSortDirection('desc');
  };

  const openEditSupplier = (supplier: any) => {
    setEditingSupplier(supplier);
    setIsEditSupplierOpen(true);
  };

  const handleEditSupplier = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingSupplier?.id) return;
    const formData = new FormData(e.currentTarget);
    const name = String(formData.get('name') || '').trim();
    if (!name) return;
    updateSupplier.mutate(
      {
        id: String(editingSupplier.id),
        updates: { name },
      },
      {
        onSuccess: async () => {
          setIsEditSupplierOpen(false);
          setEditingSupplier(null);
          await refetch();
        },
      }
    );
  };

  const handleDeleteSupplier = (supplier: any) => {
    if (!supplier?.id) return;
    const ok = window.confirm(isAr ? `حذف المورد "${supplier.name}"؟` : `Delete supplier "${supplier.name}"?`);
    if (!ok) return;
    deleteSupplier.mutate(String(supplier.id), {
      onSuccess: async () => {
        await refetch();
      },
    });
  };

  const settleMutation = useMutation({
    mutationFn: async (payload: {
      supplierId: string;
      amount: number;
      payment_method: string;
      payment_date: string;
      notes?: string;
    }) => {
      return api.post('payments', {
        payment_number: null,
        payee_type: 'App\\Models\\Inventory\\Supplier',
        payee_id: Number(payload.supplierId),
        supplier_id: Number(payload.supplierId),
        payee_name: settlingSupplier?.name || null,
        amount: payload.amount,
        payment_method: payload.payment_method,
        payment_date: payload.payment_date,
        notes: payload.notes || null,
        description: payload.notes || null,
        status: 'completed',
      });
    },
    onSuccess: async (_data, variables) => {
      try {
        const refreshed = await api.get(`suppliers/${variables.supplierId}/account-summary`, {
          params: startDate && endDate ? { start_date: startDate, end_date: endDate } : {},
        });
        setSummaryMap((prev) => ({ ...prev, [variables.supplierId]: refreshed.summary }));
        if (selectedSupplierId === variables.supplierId) {
          setSelectedAccount(refreshed);
        }
      } catch {
        await refetch();
      }

      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers-for-profit-balance'] });

      setIsSettleDialogOpen(false);
      setSettlingSupplier(null);
      setSettleForm({
        amount: '',
        payment_method: 'cash',
        payment_date: todayIso,
        notes: '',
      });
      toast.success(isAr ? 'تمت تسوية رصيد المورد وتحديث رأس المال.' : 'Supplier balance settled and capital updated.');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || (isAr ? 'فشل في تسوية رصيد المورد' : 'Failed to settle supplier balance');
      toast.error(message);
    },
  });

  const openSettleDialog = async (supplier: any) => {
    if (!supplier?.id) return;
    setSettlingSupplier(supplier);
    setIsSettleDialogOpen(true);
    setSettleForm({
      amount: '',
      payment_method: 'cash',
      payment_date: todayIso,
      notes: '',
    });
    try {
      const data = await api.get(`suppliers/${supplier.id}/account-summary`, {
        params: startDate && endDate ? { start_date: startDate, end_date: endDate } : {},
      });
      const outstanding = Math.max(0, Number(data.summary?.outstanding ?? getSupplierOutstanding(supplier, summaryMap)));
      setSummaryMap((prev) => ({ ...prev, [String(supplier.id)]: data.summary }));
      setSettleForm({
        amount: outstanding > 0 ? String(outstanding) : '',
        payment_method: 'cash',
        payment_date: todayIso,
        notes: '',
      });
    } catch {
      const outstanding = Math.max(0, getSupplierOutstanding(supplier, summaryMap));
      setSettleForm({
        amount: outstanding > 0 ? String(outstanding) : '',
        payment_method: 'cash',
        payment_date: todayIso,
        notes: '',
      });
    }
  };

  const handleSettleSubmit = () => {
    if (!settlingSupplier?.id) return;
    const outstanding = Math.max(0, getSupplierOutstanding(settlingSupplier, summaryMap));
    const amount = Number(settleForm.amount || 0);
    if (!amount || amount <= 0) {
      toast.error(isAr ? 'ادخل مبلغ صحيح' : 'Enter a valid amount');
      return;
    }
    if (outstanding > 0 && amount > outstanding) {
      toast.error(isAr ? 'المبلغ لا يمكن أن يتجاوز الرصيد المستحق للمورد' : 'Amount cannot exceed supplier outstanding balance');
      return;
    }
    settleMutation.mutate({
      supplierId: String(settlingSupplier.id),
      amount,
      payment_method: settleForm.payment_method,
      payment_date: settleForm.payment_date || todayIso,
      notes: settleForm.notes,
    });
  };

  const goToPurchaseBatch = (batchId: string | number) => {
    if (batchId === undefined || batchId === null || String(batchId).trim() === '') return;
    setSelectedSupplierId(null);
    setSelectedAccount(null);
    navigate(`/purchases?batch=${encodeURIComponent(String(batchId))}`);
  };

  const toggleLedgerRow = (key: string) => {
    setExpandedLedgerRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const buildEnhancedSupplierLedger = (account: SupplierAccount | null) => {
    if (!account) return [];
    const invoices: any[] = Array.isArray(account.invoices) ? account.invoices : [];
    const payments: any[] = Array.isArray(account.payments) ? account.payments : [];

    type Entry = {
      key: string;
      date: string;
      description: string;
      debit: number;
      credit: number;
      source: 'invoice' | 'payment';
      source_id: string;
      items?: any[];
      invoiceTotal?: number;
      invoiceRemaining?: number;
    };

    const entries: Entry[] = [];

    for (const inv of invoices) {
      entries.push({
        key: `inv-${inv.id}`,
        date: inv.date ?? '',
        description: 'Purchase Invoice #' + (inv.invoice_number ?? inv.id),
        debit: Number(inv.total ?? 0),
        credit: 0,
        source: 'invoice',
        source_id: String(inv.id),
        items: Array.isArray(inv.items) ? inv.items : [],
        invoiceTotal: Number(inv.total ?? 0),
        invoiceRemaining: Number(inv.remaining ?? 0),
      });
    }

    for (const pay of payments) {
      entries.push({
        key: `pay-${pay.id}`,
        date: pay.date ?? '',
        description: formatSupplierPaymentDescription(
          String(account.supplier?.name ?? ''),
          pay.reference,
          isAr
        ),
        debit: 0,
        credit: Number(pay.amount ?? 0),
        source: 'payment',
        source_id: String(pay.id),
      });
    }

    entries.sort((a, b) => {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return (a.source === 'invoice' ? 0 : 1) - (b.source === 'invoice' ? 0 : 1);
    });

    let running = 0;
    return entries.map((e, i) => {
      running += e.debit - e.credit;
      return { ...e, balance: Math.round(running * 100) / 100, seq: i + 1 };
    });
  };

  const handlePrintAccount = () => {
    if (!selectedAccount) return;
    try {
      const ok = printSupplierStatement({
        rtl: isAr,
        branding: getDefaultPrintBranding(),
        supplierName: String(selectedAccount.supplier?.name || ''),
        supplierCode: selectedAccount.supplier?.id != null ? String(selectedAccount.supplier.id) : undefined,
        dateFrom: startDate || undefined,
        dateTo: endDate || undefined,
        ledger: selectedAccount.ledger || [],
        invoices: selectedAccount.invoices || [],
        includeLineItems: statementIncludeLineItems,
      });
      if (!ok) {
        toast.error(isAr ? 'تعذر الطباعة — اسمح بالنوافذ المنبثقة أو أعد المحاولة.' : 'Print failed — allow popups or try again.');
      }
    } catch (e) {
      console.error(e);
      toast.error(isAr ? 'فشل تجهيز كشف الحساب' : 'Could not prepare statement');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={dir}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{isAr ? 'الموردين' : 'Suppliers'}</h1>
          <p className="text-muted-foreground">{isAr ? 'عرض محاسبي: فواتير ومدفوعات ودفتر حساب' : 'Accounting view: invoices, payments, and ledger'}</p>
        </div>
        <Button onClick={() => setIsAddSupplierOpen(true)}>{isAr ? 'إضافة مورد' : 'Add Supplier'}</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">{isAr ? 'إجمالي المشتريات' : 'Total Purchases'}</p><p className="text-xl font-bold">{summariesPending ? '—' : `${totals.totalPurchases.toLocaleString()} EGP`}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">{isAr ? 'إجمالي المدفوع' : 'Total Paid'}</p><p className="text-xl font-bold">{summariesPending ? '—' : `${totals.totalPaid.toLocaleString()} EGP`}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">{isAr ? 'الرصيد المستحق' : 'Outstanding'}</p><p className="text-xl font-bold">{summariesPending ? '—' : `${totals.outstanding.toLocaleString()} EGP`}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">{isAr ? 'عدد الفواتير' : 'Invoices'}</p><p className="text-xl font-bold">{summariesPending ? '—' : totals.invoiceCount}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <CardTitle>{isAr ? 'جدول الموردين' : 'Suppliers Table'}</CardTitle>
          <div className="flex flex-wrap gap-2">
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={isAr ? 'بحث عن مورد...' : 'Search supplier...'} />
            </div>
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
              <option value="all">{isAr ? 'كل الحالات' : 'All statuses'}</option>
              <option value="paid">{isAr ? 'مسدد' : 'Paid'}</option>
              <option value="partial">{isAr ? 'جزئي' : 'Partial'}</option>
              <option value="unpaid">{isAr ? 'غير مسدد' : 'Unpaid'}</option>
            </select>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-44" />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-44" />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{isAr ? 'المورد' : 'Supplier'}</TableHead>
                <TableHead className="text-right">
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => handleSort('total_purchases')}>
                    {isAr ? 'إجمالي المشتريات' : 'Total Purchases'} {sortField === 'total_purchases' ? (sortDirection === 'desc' ? <ArrowDownWideNarrow className="w-3 h-3 ms-1" /> : <ArrowUpWideNarrow className="w-3 h-3 ms-1" />) : null}
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => handleSort('total_paid')}>
                    {isAr ? 'المدفوع' : 'Paid'} {sortField === 'total_paid' ? (sortDirection === 'desc' ? <ArrowDownWideNarrow className="w-3 h-3 ms-1" /> : <ArrowUpWideNarrow className="w-3 h-3 ms-1" />) : null}
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => handleSort('outstanding')}>
                    {isAr ? 'الرصيد المستحق' : 'Outstanding'} {sortField === 'outstanding' ? (sortDirection === 'desc' ? <ArrowDownWideNarrow className="w-3 h-3 ms-1" /> : <ArrowUpWideNarrow className="w-3 h-3 ms-1" />) : null}
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => handleSort('invoice_count')}>
                    {isAr ? 'الفواتير' : 'Invoices'} {sortField === 'invoice_count' ? (sortDirection === 'desc' ? <ArrowDownWideNarrow className="w-3 h-3 ms-1" /> : <ArrowUpWideNarrow className="w-3 h-3 ms-1" />) : null}
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => handleSort('avg_payment_days')}>
                    {isAr ? 'متوسط أيام السداد' : 'Avg Payment Days'} {sortField === 'avg_payment_days' ? (sortDirection === 'desc' ? <ArrowDownWideNarrow className="w-3 h-3 ms-1" /> : <ArrowUpWideNarrow className="w-3 h-3 ms-1" />) : null}
                  </Button>
                </TableHead>
                <TableHead>{isAr ? 'الحالة' : 'Status'}</TableHead>
                <TableHead className="text-right">{isAr ? 'الإجراءات' : 'Actions'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!summariesReady && suppliers.length > 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin inline-block align-middle me-2" />
                    {isAr ? 'جاري تحميل أرصدة الموردين…' : 'Loading supplier balances…'}
                  </TableCell>
                </TableRow>
              ) : null}
              {summariesReady && sortedSuppliers.map((s: any) => {
                const summary = getSupplierAccountView(s, summaryMap);
                const outstandingCell = getOutstandingCell(summary);
                const status = Number(summary.outstanding) <= 0 ? 'paid' : Number(summary.total_paid) > 0 ? 'partial' : 'unpaid';
                return (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => openDetails(String(s.id))}>
                    <TableCell>{s.name}</TableCell>
                    <TableCell className="text-right">{Number(summary.total_purchases).toLocaleString()}</TableCell>
                    <TableCell className="text-right">{Number(summary.total_paid).toLocaleString()}</TableCell>
                    <TableCell className={outstandingCell.className}>{outstandingCell.text}</TableCell>
                    <TableCell className="text-right">{summary.invoice_count}</TableCell>
                    <TableCell className="text-right">{summary.avg_payment_days}</TableCell>
                    <TableCell>
                      <Badge variant={status === 'paid' ? 'secondary' : status === 'partial' ? 'outline' : 'destructive'}>
                        {status === 'paid' ? (isAr ? 'مسدد' : 'Paid') : status === 'partial' ? (isAr ? 'جزئي' : 'Partial') : (isAr ? 'غير مسدد' : 'Unpaid')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditSupplier(s);
                          }}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            openSettleDialog(s);
                          }}
                          title={isAr ? 'تسوية رصيد' : 'Settle Balance'}
                        >
                          <HandCoins className="w-4 h-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSupplier(s);
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selectedSupplierId} onOpenChange={(open) => { if (!open) { setSelectedSupplierId(null); setSelectedAccount(null); } }}>
        <DialogContent className="flex max-h-[min(780px,90vh)] w-[min(900px,calc(100vw-1rem))] max-w-none flex-col gap-3 overflow-hidden p-3 sm:p-4">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>{selectedAccount?.supplier?.name || (isAr ? 'تفاصيل المورد' : 'Supplier Details')}</DialogTitle>
              {selectedAccount && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => openSettleDialog(selectedAccount.supplier)}>
                    <HandCoins className="w-4 h-4 mr-2" />
                    {isAr ? 'تسوية رصيد' : 'Settle Balance'}
                  </Button>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                    <Checkbox
                      checked={statementIncludeLineItems}
                      onCheckedChange={(v) => setStatementIncludeLineItems(v === true)}
                    />
                    {isAr ? 'عرض أصناف الفواتير' : 'Show invoice lines'}
                  </label>
                  <Button variant="outline" size="sm" onClick={handlePrintAccount}>
                    <Printer className="w-4 h-4 mr-2" />
                    {isAr ? 'طباعة كشف الحساب' : 'Print Statement'}
                  </Button>
                </div>
              )}
            </div>
          </DialogHeader>
          {detailLoading || !selectedAccount ? (
            <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : (
            <Tabs defaultValue="invoices" className="flex min-h-0 flex-1 flex-col">
              <TabsList>
                <TabsTrigger value="invoices">{isAr ? 'الفواتير' : 'Invoices'}</TabsTrigger>
                <TabsTrigger value="payments">{isAr ? 'المدفوعات' : 'Payments'}</TabsTrigger>
                <TabsTrigger value="ledger">{isAr ? 'دفتر الحساب' : 'Ledger'}</TabsTrigger>
              </TabsList>

              <div className="min-h-0 flex-1 overflow-auto rounded-md border">
                <TabsContent value="invoices" className="m-0">
                  <Table>
                    <TableHeader><TableRow><TableHead>#</TableHead><TableHead>{isAr ? 'التاريخ' : 'Date'}</TableHead><TableHead className="text-right">{isAr ? 'الإجمالي' : 'Total'}</TableHead><TableHead className="text-right">{isAr ? 'المتبقي' : 'Remaining'}</TableHead><TableHead>{isAr ? 'الحالة' : 'Status'}</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {selectedAccount.invoices.map((inv: any) => (
                        <TableRow key={inv.id}>
                          <TableCell>
                            <button
                              type="button"
                              className="text-primary font-medium underline decoration-dotted underline-offset-2 hover:text-primary/90 text-start max-w-[220px] truncate"
                              title={isAr ? 'فتح فاتورة الشراء' : 'Open purchase invoice'}
                              onClick={() => goToPurchaseBatch(inv.id)}
                            >
                              {inv.invoice_number}
                            </button>
                          </TableCell>
                          <TableCell>{inv.date}</TableCell>
                          <TableCell className="text-right">{Number(inv.total).toLocaleString()}</TableCell>
                          <TableCell className="text-right">{Number(inv.remaining).toLocaleString()}</TableCell>
                          <TableCell>{purchaseBatchStatusLabel(inv.status)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TabsContent>

                <TabsContent value="payments" className="m-0">
                  <Table>
                    <TableHeader><TableRow><TableHead>{isAr ? 'التاريخ' : 'Date'}</TableHead><TableHead className="text-right">{isAr ? 'المبلغ' : 'Amount'}</TableHead><TableHead>{isAr ? 'الطريقة' : 'Method'}</TableHead><TableHead>{isAr ? 'المرجع' : 'Reference'}</TableHead><TableHead>{isAr ? 'الحالة' : 'Status'}</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {selectedAccount.payments.map((pay: any) => (
                        <TableRow key={pay.id}>
                          <TableCell>{pay.date}</TableCell>
                          <TableCell className="text-right">{Number(pay.amount).toLocaleString()}</TableCell>
                          <TableCell>{pay.method || '-'}</TableCell>
                          <TableCell>{pay.reference || '-'}</TableCell>
                          <TableCell>{pay.status}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TabsContent>

                <TabsContent value="ledger" className="m-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8 text-center">{isAr ? 'م' : '#'}</TableHead>
                        <TableHead>{isAr ? 'البيان' : 'Description'}</TableHead>
                        <TableHead className="text-end">{isAr ? 'مدين' : 'Debit'}</TableHead>
                        <TableHead className="text-end">{isAr ? 'دائن' : 'Credit'}</TableHead>
                        <TableHead className="text-end">{isAr ? 'الرصيد' : 'Balance'}</TableHead>
                        <TableHead className="w-24">{isAr ? 'التاريخ' : 'Date'}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {buildEnhancedSupplierLedger(selectedAccount).flatMap((row: any) => {
                        const hasItems = Array.isArray(row.items) && row.items.length > 0;
                        const isInv = row.source === 'invoice';
                        const rows = [];

                        rows.push(
                          <TableRow key={row.key} className={isInv ? 'font-medium bg-muted/20' : undefined}>
                            <TableCell className="text-center text-muted-foreground text-xs">{row.seq}</TableCell>
                            <TableCell className={isInv ? 'text-primary' : 'text-emerald-700 dark:text-emerald-400'}>
                              {formatSupplierLedgerRowDescription(
                                row,
                                String(selectedAccount?.supplier?.name ?? ''),
                                isAr
                              )}
                            </TableCell>
                            <TableCell className="text-end tabular-nums">{row.debit > 0 ? Number(row.debit).toLocaleString() : ''}</TableCell>
                            <TableCell className="text-end tabular-nums">{row.credit > 0 ? Number(row.credit).toLocaleString() : ''}</TableCell>
                            <TableCell className="text-end tabular-nums font-semibold">{Number(row.balance).toLocaleString()}</TableCell>
                            <TableCell className="text-xs tabular-nums text-muted-foreground">{row.date}</TableCell>
                          </TableRow>
                        );

                        if (isInv && hasItems) {
                          rows.push(
                            <TableRow key={`${row.key}-hdr`} className="bg-slate-50 dark:bg-slate-900/40">
                              <TableCell className="text-center text-[10px] font-semibold text-muted-foreground">{isAr ? 'م' : '#'}</TableCell>
                              <TableCell className="text-[10px] font-semibold text-muted-foreground">{isAr ? 'الصنف' : 'Product'}</TableCell>
                              <TableCell className="text-end text-[10px] font-semibold text-muted-foreground">{isAr ? 'الكمية' : 'Qty'}</TableCell>
                              <TableCell className="text-end text-[10px] font-semibold text-muted-foreground">{isAr ? 'السعر' : 'Price'}</TableCell>
                              <TableCell className="text-end text-[10px] font-semibold text-muted-foreground">{isAr ? 'الإجمالي' : 'Total'}</TableCell>
                              <TableCell />
                            </TableRow>
                          );
                          row.items.forEach((item: any, idx: number) => {
                            rows.push(
                              <TableRow key={`${row.key}-item-${idx}`} className="bg-slate-50/70 dark:bg-slate-900/30 text-xs">
                                <TableCell className="text-center text-muted-foreground">{idx + 1}</TableCell>
                                <TableCell className="text-muted-foreground">{item.product_name || item.sku_code || '-'}</TableCell>
                                <TableCell className="text-end tabular-nums text-muted-foreground">{Number(item.quantity).toLocaleString()}</TableCell>
                                <TableCell className="text-end tabular-nums text-muted-foreground">{Number(item.unit_price).toLocaleString()}</TableCell>
                                <TableCell className="text-end tabular-nums text-muted-foreground">{Number(item.total_price).toLocaleString()}</TableCell>
                                <TableCell />
                              </TableRow>
                            );
                          });
                          rows.push(
                            <TableRow key={`${row.key}-sub`} className="bg-muted/30 text-xs font-semibold border-b-2">
                              <TableCell colSpan={2} className="text-end text-muted-foreground">
                                {isAr ? `الإجمالي: ${Number(row.invoiceTotal).toLocaleString()} — المتبقي: ${Number(row.invoiceRemaining).toLocaleString()}` : `Total: ${Number(row.invoiceTotal).toLocaleString()} — Remaining: ${Number(row.invoiceRemaining).toLocaleString()}`}
                              </TableCell>
                              <TableCell colSpan={4} />
                            </TableRow>
                          );
                        }

                        return rows;
                      })}
                    </TableBody>
                  </Table>
                </TabsContent>
              </div>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isAddSupplierOpen} onOpenChange={setIsAddSupplierOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isAr ? 'إضافة مورد' : 'Add Supplier'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddSupplier} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supplier-name">{isAr ? 'الاسم' : 'Name'}</Label>
              <Input id="supplier-name" name="name" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="supplier-email">{isAr ? 'البريد الإلكتروني' : 'Email'}</Label>
                <Input id="supplier-email" name="email" type="email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="supplier-phone">{isAr ? 'الهاتف' : 'Phone'}</Label>
                <Input id="supplier-phone" name="phone" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-address">{isAr ? 'العنوان' : 'Address'}</Label>
              <Input id="supplier-address" name="address" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddSupplierOpen(false)}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
              <Button type="submit" disabled={createSupplier.isPending}>
                {createSupplier.isPending ? (isAr ? 'جاري الحفظ...' : 'Saving...') : (isAr ? 'حفظ المورد' : 'Save Supplier')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditSupplierOpen} onOpenChange={setIsEditSupplierOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isAr ? 'تعديل اسم المورد' : 'Edit Supplier Name'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSupplier} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-supplier-name">{isAr ? 'الاسم' : 'Name'}</Label>
              <Input id="edit-supplier-name" name="name" defaultValue={editingSupplier?.name || ''} required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditSupplierOpen(false)}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
              <Button type="submit" disabled={updateSupplier.isPending}>
                {updateSupplier.isPending ? (isAr ? 'جاري الحفظ...' : 'Saving...') : (isAr ? 'حفظ' : 'Save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isSettleDialogOpen} onOpenChange={setIsSettleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isAr ? 'تسوية رصيد المورد' : 'Settle Supplier Balance'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border p-3 text-sm bg-muted/20">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{isAr ? 'المورد' : 'Supplier'}</span>
                <span className="font-medium">{settlingSupplier?.name || '-'}</span>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-muted-foreground">{isAr ? 'الرصيد المستحق' : 'Outstanding'}</span>
                <span className="font-semibold text-orange-600">
                  {Math.max(0, getSupplierOutstanding(settlingSupplier, summaryMap)).toLocaleString()} EGP
                </span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {isAr
                  ? 'يتم تسجيل هذه التسوية كدفعة مكتملة وسيتم خصمها من صافي رأس المال.'
                  : 'This settlement is recorded as a completed payment and will reduce net capital.'}
              </div>
            </div>
            <div className="space-y-2">
              <Label>{isAr ? 'المبلغ' : 'Amount'}</Label>
              <Input
                type="number"
                value={settleForm.amount}
                onChange={(e) => setSettleForm((prev) => ({ ...prev, amount: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{isAr ? 'طريقة الدفع' : 'Payment Method'}</Label>
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm w-full"
                  value={settleForm.payment_method}
                  onChange={(e) => setSettleForm((prev) => ({ ...prev, payment_method: e.target.value }))}
                >
                  <option value="cash">{isAr ? 'نقدي' : 'Cash'}</option>
                  <option value="bank_transfer">{isAr ? 'تحويل بنكي' : 'Bank Transfer'}</option>
                  <option value="card">{isAr ? 'بطاقة' : 'Card'}</option>
                  <option value="check">{isAr ? 'شيك' : 'Check'}</option>
                  <option value="online">{isAr ? 'إلكتروني' : 'Online'}</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>{isAr ? 'تاريخ الدفع' : 'Payment Date'}</Label>
                <Input
                  type="date"
                  value={settleForm.payment_date}
                  onChange={(e) => setSettleForm((prev) => ({ ...prev, payment_date: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{isAr ? 'ملاحظات' : 'Notes'}</Label>
              <Input
                value={settleForm.notes}
                onChange={(e) => setSettleForm((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder={isAr ? 'ملاحظة / مرجع اختياري' : 'Optional note / reference'}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsSettleDialogOpen(false)}>
              {isAr ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button type="button" onClick={handleSettleSubmit} disabled={settleMutation.isPending}>
              {settleMutation.isPending ? (isAr ? 'جاري الحفظ...' : 'Saving...') : (isAr ? 'تأكيد التسوية' : 'Confirm Settlement')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
