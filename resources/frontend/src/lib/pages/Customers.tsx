import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, Printer, ArrowDownWideNarrow, ArrowUpWideNarrow, Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import api from '@/lib/api';
import { customerService, salesOrderService } from '@/lib/supabase-services';
import { OrderInvoiceDetailDialog } from '@/components/sales/OrderInvoiceDetailDialog';
import { toast } from 'sonner';
import { printCustomerStatement, getDefaultPrintBranding } from '@/lib/printUtils';
import {
  formatCustomerCollectionDescription,
  formatCustomerLedgerRowDescription,
} from '@/lib/statementLedgerLabels';
import { useLanguage } from '@/contexts/LanguageContext';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ChevronsUpDown, Check } from 'lucide-react';

type SortField =
  | 'name'
  | 'total_sales'
  | 'total_received'
  | 'outstanding'
  | 'invoice_count'
  | 'avg_collection_days'
  | 'status';

function rowSummary(c: any, summaryMap: Record<string, any>) {
  return (
    summaryMap[String(c.id)] || {
      total_sales: 0,
      total_received: 0,
      outstanding: Number(c.current_balance || 0),
      invoice_count: 0,
      avg_collection_days: 0,
    }
  );
}

function statusRank(s: any): number {
  const o = Number(s.outstanding || 0);
  const rec = Number(s.total_received || 0);
  if (o <= 0) return 2;
  if (rec > 0) return 1;
  return 0;
}

function statusLabel(s: any, t: (k: string) => string): string {
  const o = Number(s.outstanding || 0);
  const rec = Number(s.total_received || 0);
  if (o <= 0) return t('customers.statusSettled');
  if (rec > 0) return t('customers.statusPartial');
  return t('customers.statusPending');
}

/** Receivable from customer (green) vs credit owed back to customer (red). */
function getCustomerOutstandingCell(summary: {
  outstanding?: number | null;
  total_sales?: number | null;
  total_received?: number | null;
}) {
  const outstanding = Number(summary.outstanding) || 0;
  const netSalesMinusReceived =
    (Number(summary.total_sales) || 0) - (Number(summary.total_received) || 0);

  if (outstanding > 0.005) {
    return {
      text: outstanding.toLocaleString(),
      className: 'text-end tabular-nums font-semibold text-green-600 dark:text-green-400',
    };
  }
  if (outstanding < -0.005) {
    return {
      text: Math.abs(outstanding).toLocaleString(),
      className: 'text-end tabular-nums font-semibold text-red-600 dark:text-red-400',
    };
  }
  if (netSalesMinusReceived < -0.005) {
    return {
      text: Math.abs(netSalesMinusReceived).toLocaleString(),
      className: 'text-end tabular-nums font-semibold text-red-600 dark:text-red-400',
    };
  }
  return {
    text: '0',
    className: 'text-end tabular-nums text-muted-foreground',
  };
}

export default function CustomersPage() {
  const { t, language } = useLanguage();
  const isAr = language === 'ar';
  const dir = isAr ? 'rtl' : 'ltr';

  const [customers, setCustomers] = useState<any[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [summaryMap, setSummaryMap] = useState<Record<string, any>>({});
  const [paginationMeta, setPaginationMeta] = useState<{ total: number; per_page: number; current_page: number; last_page: number } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false);
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);
  const [receiveCustomer, setReceiveCustomer] = useState<any | null>(null);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [receiveAccountLoading, setReceiveAccountLoading] = useState(false);
  const [receiveInvoices, setReceiveInvoices] = useState<any[]>([]);
  const [receiveOrderPickerOpen, setReceiveOrderPickerOpen] = useState(false);
  const [receiveOrderSearch, setReceiveOrderSearch] = useState('');
  const [receiveLinkedOrderId, setReceiveLinkedOrderId] = useState<string>('');
  const [orderDetail, setOrderDetail] = useState<any | null>(null);
  const [orderDetailOpen, setOrderDetailOpen] = useState(false);
  const [invoiceRowLoadingId, setInvoiceRowLoadingId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('outstanding');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [editReceiptOpen, setEditReceiptOpen] = useState(false);
  const [editingReceipt, setEditingReceipt] = useState<any | null>(null);
  const [editingReceiptId, setEditingReceiptId] = useState<string | null>(null);

  // Debounce search to avoid firing on every keystroke
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setCurrentPage(1);
    }, 400);
  };

  const loadCustomers = useCallback(async () => {
    try {
      setLoadingCustomers(true);
      const sortParam = ['outstanding', 'total_sales', 'total_received', 'invoice_count', 'name'].includes(sortField)
        ? sortField
        : 'outstanding';
      const params: Record<string, any> = {
        page: currentPage,
        per_page: 50,
        sort: sortParam,
        direction: sortDirection,
        exclude_guests: 1,
      };
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      if (startDate && endDate) {
        params.start_date = startDate;
        params.end_date = endDate;
      }
      const response = await api.get('customers/paginated-with-summary', { params });
      const items: any[] = Array.isArray(response?.data) ? response.data : [];
      setCustomers(items);
      setPaginationMeta(response?.meta || null);
      // Build summaryMap from embedded summary
      const next: Record<string, any> = {};
      items.forEach((c: any) => {
        if (c.summary) next[String(c.id)] = c.summary;
      });
      setSummaryMap(next);
    } catch {
      setCustomers([]);
      setSummaryMap({});
      setPaginationMeta(null);
    } finally {
      setLoadingCustomers(false);
    }
  }, [currentPage, debouncedSearch, sortField, sortDirection, startDate, endDate]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  // Filtering and sorting are done server-side; customers list is already the current page
  const filteredCustomers = customers;

  const handleSort = (field: SortField) => {
    if (['status', 'avg_collection_days'].includes(field)) return; // not supported server-side yet
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'name' ? 'asc' : 'desc');
    }
    setCurrentPage(1);
  };

  // Server already sorted; just use as-is
  const sortedCustomers = filteredCustomers;

  // Totals across the current visible page only (server handles sorting/filtering)
  const totals = useMemo(() => {
    return customers.reduce(
      (acc: any, c: any) => {
        const s = rowSummary(c, summaryMap);
        acc.totalSales += Number(s.total_sales || 0);
        acc.totalReceived += Number(s.total_received || 0);
        acc.outstanding += Number(s.outstanding || 0);
        acc.invoiceCount += Number(s.invoice_count || 0);
        return acc;
      },
      { totalSales: 0, totalReceived: 0, outstanding: 0, invoiceCount: 0 }
    );
  }, [customers, summaryMap]);

  const openDetails = async (customerId: string) => {
    setSelectedCustomerId(customerId);
    setDetailLoading(true);
    try {
      const data = await api.get(`customers/${customerId}/account-summary`, {
        params: startDate && endDate ? { start_date: startDate, end_date: endDate } : {},
      });
      setSelectedAccount(data);
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshCustomerSummary = async (customerId: string) => {
    // Reload the current page so summary numbers update
    await loadCustomers();
    // Also refresh detail dialog if open
    if (selectedCustomerId === String(customerId)) {
      try {
        const data = await api.get(`customers/${customerId}/account-summary`, {
          params: startDate && endDate ? { start_date: startDate, end_date: endDate } : {},
        });
        setSelectedAccount(data);
      } catch {
        // ignore
      }
    }
  };

  const openReceiveDialog = (customer: any) => {
    setReceiveCustomer(customer);
    setReceiveLinkedOrderId('');
    setReceiveOrderSearch('');
    setReceiveInvoices([]);
    setReceiveDialogOpen(true);
  };

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!receiveDialogOpen || !receiveCustomer?.id) return;
      setReceiveAccountLoading(true);
      try {
        const data = await api.get(`customers/${String(receiveCustomer.id)}/account-summary`, {
          params: startDate && endDate ? { start_date: startDate, end_date: endDate } : {},
        });
        const invoices = Array.isArray(data?.invoices) ? data.invoices : [];
        const openInvoices = invoices.filter((inv: any) => Number(inv?.remaining || 0) > 0.00001);
        if (!mounted) return;
        setReceiveInvoices(openInvoices);
      } catch {
        if (!mounted) return;
        setReceiveInvoices([]);
      } finally {
        if (mounted) setReceiveAccountLoading(false);
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [receiveDialogOpen, receiveCustomer?.id, startDate, endDate]);

  const selectedReceiveInvoice = useMemo(() => {
    if (!receiveLinkedOrderId) return null;
    return receiveInvoices.find((inv: any) => String(inv?.id) === String(receiveLinkedOrderId)) || null;
  }, [receiveInvoices, receiveLinkedOrderId]);

  const filteredReceiveInvoices = useMemo(() => {
    const q = receiveOrderSearch.trim().toLowerCase();
    if (!q) return receiveInvoices.slice(0, 200);
    return receiveInvoices
      .filter((inv: any) => {
        const num = String(inv?.invoice_number || '').toLowerCase();
        const id = String(inv?.id || '').toLowerCase();
        return num.includes(q) || id.includes(q);
      })
      .slice(0, 200);
  }, [receiveInvoices, receiveOrderSearch]);

  const submitReceive = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!receiveCustomer) return;
    const customerId = String(receiveCustomer.id);
    const formData = new FormData(e.currentTarget);
    const payload = {
      amount: Number(formData.get('amount') || 0),
      receipt_date: String(formData.get('receipt_date') || ''),
      payment_method: String(formData.get('payment_method') || '') || null,
      description: String(formData.get('description') || '') || null,
      external_reference: String(formData.get('external_reference') || '') || null,
      linked_inventory_order_id: String(formData.get('linked_inventory_order_id') || '') || null,
    };

    setReceivingId(customerId);
    try {
      await api.post(`customers/${customerId}/receive`, payload);
      toast.success(t('customers.receiveSuccess'));
      setReceiveDialogOpen(false);
      setReceiveCustomer(null);
      await refreshCustomerSummary(customerId);
    } catch {
      toast.error(t('customers.receiveError'));
    } finally {
      setReceivingId(null);
    }
  };

  const handleAddCustomer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const payload = {
      name: String(formData.get('name') || ''),
      email: String(formData.get('email') || '') || null,
      phone: String(formData.get('phone') || '') || null,
      tax_id: String(formData.get('tax_id') || '') || null,
      address: String(formData.get('address') || '') || null,
      credit_limit: Number(formData.get('credit_limit') || 0),
    };
    try {
      await customerService.create(payload);
      toast.success(t('customers.created'));
      setIsAddCustomerOpen(false);
      setCurrentPage(1);
      await loadCustomers();
    } catch {
      toast.error(t('customers.createFailed'));
    }
  };

  const openEditReceipt = (receipt: any) => {
    setEditingReceipt(receipt);
    setEditReceiptOpen(true);
  };

  const submitEditReceipt = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingReceipt) return;
    const formData = new FormData(e.currentTarget);
    const payload = {
      amount: Number(formData.get('amount') || 0),
      receipt_date: String(formData.get('receipt_date') || ''),
      payment_method: String(formData.get('payment_method') || '') || null,
      external_reference: String(formData.get('external_reference') || '') || null,
      description: String(formData.get('description') || '') || null,
    };
    setEditingReceiptId(String(editingReceipt.id));
    try {
      await api.put(`receipts/${editingReceipt.id}`, payload);
      toast.success(t('customers.receiptUpdated'));
      setEditReceiptOpen(false);
      setEditingReceipt(null);
      if (selectedCustomerId) await refreshCustomerSummary(selectedCustomerId);
    } catch {
      toast.error(t('customers.receiptUpdateFailed'));
    } finally {
      setEditingReceiptId(null);
    }
  };

  const handleDeleteReceipt = async (receipt: any) => {
    if (!window.confirm(t('customers.receiptDeleteConfirm'))) return;
    setEditingReceiptId(String(receipt.id));
    try {
      await api.delete(`receipts/${receipt.id}`);
      toast.success(t('customers.receiptDeleted'));
      if (selectedCustomerId) await refreshCustomerSummary(selectedCustomerId);
    } catch {
      toast.error(t('customers.receiptDeleteFailed'));
    } finally {
      setEditingReceiptId(null);
    }
  };

  const openOrderInvoice = async (orderId: string | number) => {
    const id = String(orderId);
    setInvoiceRowLoadingId(id);
    try {
      const o = await salesOrderService.getById(id);
      setOrderDetail(o);
      setOrderDetailOpen(true);
    } catch {
      toast.error(t('customers.invoiceLoadFailed'));
    } finally {
      setInvoiceRowLoadingId(null);
    }
  };

  const buildEnhancedLedger = (account: any) => {
    if (!account) return [];
    const invoices: any[] = Array.isArray(account.invoices) ? account.invoices : [];
    const receipts: any[] = Array.isArray(account.receipts) ? account.receipts : [];
    const returns: any[] = Array.isArray(account.returns) ? account.returns : [];

    type Entry = {
      key: string;
      date: string;
      description: string;
      debit: number;
      credit: number;
      source: 'invoice' | 'order_payment' | 'receipt' | 'return';
      source_id: string;
      items?: any[];
    };

    const entries: Entry[] = [];

    for (const inv of invoices) {
      entries.push({
        key: `inv-${inv.id}`,
        date: inv.date ?? '',
        description: 'Sales Invoice #' + inv.invoice_number,
        debit: Number(inv.total ?? 0),
        credit: 0,
        source: 'invoice',
        source_id: String(inv.id),
        items: Array.isArray(inv.items) ? inv.items : [],
      });
      const paid = Number(inv.paid ?? 0);
      if (paid > 0.00001) {
        entries.push({
          key: `pay-${inv.id}`,
          date: inv.date ?? '',
          description: formatCustomerCollectionDescription(
            String(account.customer?.name ?? ''),
            inv.invoice_number,
            isAr
          ),
          debit: 0,
          credit: paid,
          source: 'order_payment',
          source_id: String(inv.id),
        });
      }
    }

    for (const r of receipts) {
      entries.push({
        key: `rec-${r.id}`,
        date: r.date ?? '',
        description: formatCustomerCollectionDescription(
          String(account.customer?.name ?? ''),
          r.reference,
          isAr
        ),
        debit: 0,
        credit: Number(r.amount ?? 0),
        source: 'receipt',
        source_id: String(r.id),
      });
    }

    for (const ret of returns) {
      entries.push({
        key: `ret-${ret.id}`,
        date: ret.date ?? '',
        description: (isAr ? 'مرتجع - ' : 'Return #') + ret.id,
        debit: 0,
        credit: Number(ret.amount ?? 0),
        source: 'return',
        source_id: String(ret.id),
      });
    }

    entries.sort((a, b) => {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      const order = { invoice: 0, order_payment: 1, receipt: 2, return: 3 };
      return (order[a.source] ?? 4) - (order[b.source] ?? 4);
    });

    let running = 0;
    return entries.map((e, i) => {
      running += e.debit - e.credit;
      return { ...e, balance: Math.round(running * 100) / 100, seq: i + 1 };
    });
  };

  const handlePrintAccount = () => {
    if (!selectedAccount) return;
    printCustomerStatement({
      rtl: isAr,
      branding: getDefaultPrintBranding(),
      customerName: selectedAccount?.customer?.name || '',
      customerId: selectedAccount?.customer?.id,
      invoices: Array.isArray(selectedAccount.invoices) ? selectedAccount.invoices : [],
      receipts: [],
      ledger: Array.isArray(selectedAccount.ledger) ? selectedAccount.ledger : [],
    });
  };

  const sortIcon = (field: SortField) =>
    sortField === field ? sortDirection === 'desc' ? <ArrowDownWideNarrow className="w-3 h-3 ms-1" /> : <ArrowUpWideNarrow className="w-3 h-3 ms-1" /> : null;

  return (
    <div className="space-y-6" dir={dir}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('customers.title')}</h1>
          <p className="text-muted-foreground">{t('customers.subtitle')}</p>
        </div>
        <Button onClick={() => setIsAddCustomerOpen(true)}>{t('customers.addCustomer')}</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="space-y-1 pt-6">
            <p className="text-xl font-bold tabular-nums">{totals.totalSales.toLocaleString()} EGP</p>
            <p className="text-sm text-muted-foreground">{t('customers.totalSales')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-6">
            <p className="text-xl font-bold tabular-nums">{totals.totalReceived.toLocaleString()} EGP</p>
            <p className="text-sm text-muted-foreground">{t('customers.collected')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-6">
            <p className="text-xl font-bold tabular-nums">{totals.outstanding.toLocaleString()} EGP</p>
            <p className="text-sm text-muted-foreground">{t('customers.outstanding')}</p>
            <p className="text-[11px] text-muted-foreground leading-snug pt-1">{t('customers.outstandingHint')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-6">
            <p className="text-xl font-bold tabular-nums">{totals.invoiceCount}</p>
            <p className="text-sm text-muted-foreground">{t('customers.invoices')}</p>
          </CardContent>
        </Card>
      </div>

      <Alert className="border-muted bg-muted/20">
        <AlertDescription className="text-xs leading-relaxed">{t('customers.financeNote')}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>{t('customers.tableTitle')}</CardTitle>
          <div className="flex flex-wrap gap-2">
            <div className="relative w-full md:w-72">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t('customers.searchPlaceholder')}
                className="ps-9"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
            </div>
            <Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setCurrentPage(1); }} className="w-44" />
            <Input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setCurrentPage(1); }} className="w-44" />
          </div>
        </CardHeader>
        <CardContent>
          {loadingCustomers ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 font-semibold" onClick={() => handleSort('name')}>
                      {t('customers.colCustomer')}
                      {sortIcon('name')}
                    </Button>
                  </TableHead>
                  <TableHead className="text-end">
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 font-semibold" onClick={() => handleSort('total_sales')}>
                      {t('customers.colTotalSales')}
                      {sortIcon('total_sales')}
                    </Button>
                  </TableHead>
                  <TableHead className="text-end">
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 font-semibold" onClick={() => handleSort('total_received')}>
                      {t('customers.colCollected')}
                      {sortIcon('total_received')}
                    </Button>
                  </TableHead>
                  <TableHead className="text-end">
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 font-semibold" onClick={() => handleSort('outstanding')}>
                      {t('customers.colOutstanding')}
                      {sortIcon('outstanding')}
                    </Button>
                  </TableHead>
                  <TableHead className="text-end">
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 font-semibold" onClick={() => handleSort('invoice_count')}>
                      {t('customers.colInvoices')}
                      {sortIcon('invoice_count')}
                    </Button>
                  </TableHead>
                  <TableHead className="text-end">
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 font-semibold" onClick={() => handleSort('avg_collection_days')}>
                      {t('customers.colAvgCollection')}
                      {sortIcon('avg_collection_days')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 font-semibold" onClick={() => handleSort('status')}>
                      {t('customers.colStatus')}
                      {sortIcon('status')}
                    </Button>
                  </TableHead>
                  <TableHead className="w-[1%]">{t('customers.colActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCustomers.map((c: any) => {
                  const s = rowSummary(c, summaryMap);
                  const outstandingCell = getCustomerOutstandingCell(s);
                  const stLabel = statusLabel(s, t);
                  const stKey = Number(s.outstanding) <= 0 ? 'settled' : Number(s.total_received) > 0 ? 'partial' : 'pending';
                  return (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => openDetails(String(c.id))}>
                      <TableCell>{c.name}</TableCell>
                      <TableCell className="text-end tabular-nums">{Number(s.total_sales).toLocaleString()}</TableCell>
                      <TableCell className="text-end tabular-nums">{Number(s.total_received).toLocaleString()}</TableCell>
                      <TableCell className={outstandingCell.className}>{outstandingCell.text}</TableCell>
                      <TableCell className="text-end tabular-nums">{s.invoice_count}</TableCell>
                      <TableCell className="text-end tabular-nums">{s.avg_collection_days}</TableCell>
                      <TableCell>
                        <Badge variant={stKey === 'settled' ? 'secondary' : stKey === 'partial' ? 'outline' : 'destructive'}>{stLabel}</Badge>
                      </TableCell>
                      <TableCell className="text-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            openReceiveDialog(c);
                          }}
                          disabled={receivingId === String(c.id)}
                        >
                          {receivingId === String(c.id) ? <Loader2 className="w-4 h-4 animate-spin" /> : t('customers.receive')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {paginationMeta && paginationMeta.last_page > 1 && (
            <div className="flex items-center justify-between pt-3 border-t">
              <p className="text-sm text-muted-foreground">
                {t('customers.showing') || 'Showing'}{' '}
                {((paginationMeta.current_page - 1) * paginationMeta.per_page) + 1}–{Math.min(paginationMeta.current_page * paginationMeta.per_page, paginationMeta.total)}{' '}
                {t('customers.of') || 'of'} {paginationMeta.total}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1 || loadingCustomers}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm px-2 tabular-nums">
                  {currentPage} / {paginationMeta.last_page}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= paginationMeta.last_page || loadingCustomers}
                  onClick={() => setCurrentPage((p) => p + 1)}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={receiveDialogOpen}
        onOpenChange={(open) => {
          setReceiveDialogOpen(open);
          if (!open) setReceiveCustomer(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t('customers.receiveDialogTitle')}
              {receiveCustomer?.name ? ` — ${receiveCustomer.name}` : ''}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submitReceive} className="space-y-3">
            <div className="space-y-1">
              <Label>{t('customers.receiveLinkOrder')}</Label>
              <input type="hidden" name="linked_inventory_order_id" value={receiveLinkedOrderId} />
              <Popover open={receiveOrderPickerOpen} onOpenChange={setReceiveOrderPickerOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="w-full justify-between" disabled={receiveAccountLoading}>
                    <span className="truncate">
                      {receiveAccountLoading
                        ? t('customers.receiveLoadingOrders')
                        : selectedReceiveInvoice
                          ? `${selectedReceiveInvoice.invoice_number} — ${t('customers.receiveRemaining')} ${Number(selectedReceiveInvoice.remaining || 0).toLocaleString()}`
                          : t('customers.receiveNoLinkedOrder')}
                    </span>
                    <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-60" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[420px] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder={t('customers.receiveSearchOrders')}
                      value={receiveOrderSearch}
                      onValueChange={setReceiveOrderSearch}
                    />
                    <CommandEmpty>{t('customers.receiveNoOrdersMatch')}</CommandEmpty>
                    <CommandList>
                      <CommandGroup>
                        <CommandItem
                          value="__none__"
                          onSelect={() => {
                            setReceiveLinkedOrderId('');
                            setReceiveOrderPickerOpen(false);
                          }}
                        >
                          <span className="me-2 inline-flex h-4 w-4 items-center justify-center">
                            {receiveLinkedOrderId === '' ? <Check className="h-4 w-4" /> : null}
                          </span>
                          {t('customers.receiveNoLinkedOrder')}
                        </CommandItem>
                        {filteredReceiveInvoices.map((inv: any) => (
                          <CommandItem
                            key={inv.id}
                            value={String(inv.invoice_number || inv.id)}
                            onSelect={() => {
                              setReceiveLinkedOrderId(String(inv.id));
                              setReceiveOrderPickerOpen(false);
                            }}
                          >
                            <span className="me-2 inline-flex h-4 w-4 items-center justify-center">
                              {String(receiveLinkedOrderId) === String(inv.id) ? <Check className="h-4 w-4" /> : null}
                            </span>
                            <div className="flex w-full items-center justify-between gap-3">
                              <span className="truncate">{inv.invoice_number}</span>
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {t('customers.receiveRemaining')} {Number(inv.remaining || 0).toLocaleString()}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <p className="text-[11px] text-muted-foreground leading-snug">
                {t('customers.receiveLinkOrderHint')}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="amount">{t('customers.receiveAmount')}</Label>
                <Input id="amount" name="amount" type="number" step="0.01" min="0" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="receipt_date">{t('customers.receiveDate')}</Label>
                <Input
                  id="receipt_date"
                  name="receipt_date"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="payment_method">{t('customers.receiveMethod')}</Label>
              <Input id="payment_method" name="payment_method" placeholder={t('customers.receiveMethodPlaceholder')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="external_reference">{t('customers.receiveReference')}</Label>
              <Input id="external_reference" name="external_reference" placeholder={t('customers.receiveReferencePlaceholder')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="description">{t('customers.receiveNotes')}</Label>
              <Input id="description" name="description" placeholder={t('customers.receiveNotesPlaceholder')} />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setReceiveDialogOpen(false);
                  setReceiveCustomer(null);
                }}
              >
                {t('customers.cancel')}
              </Button>
              <Button type="submit" disabled={!receiveCustomer || receivingId === String(receiveCustomer?.id || '')}>
                {t('customers.receiveSave')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selectedCustomerId}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedCustomerId(null);
            setSelectedAccount(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[min(900px,92vh)] w-[min(1100px,calc(100vw-1.5rem))] max-w-none flex-col gap-3 overflow-hidden p-4 sm:p-5">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>{selectedAccount?.customer?.name || t('customers.detailsTitle')}</DialogTitle>
              {selectedAccount && (
                <Button variant="outline" size="sm" onClick={handlePrintAccount}>
                  <Printer className="w-4 h-4 me-2" />
                  {t('customers.printStatement')}
                </Button>
              )}
            </div>
          </DialogHeader>
          {detailLoading || !selectedAccount ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : (
            <Tabs defaultValue="invoices" className="flex min-h-0 flex-1 flex-col">
              <TabsList>
                <TabsTrigger value="invoices">{t('customers.tabInvoices')}</TabsTrigger>
                <TabsTrigger value="receipts">{t('customers.tabReceipts')}</TabsTrigger>
                <TabsTrigger value="ledger">{t('customers.tabLedger')}</TabsTrigger>
              </TabsList>
              <div className="min-h-0 flex-1 overflow-auto rounded-md border">
                <TabsContent value="invoices" className="m-0">
                  <p className="text-xs text-muted-foreground px-3 pt-3">{t('customers.invoiceRowHint')}</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('customers.colInvoice')}</TableHead>
                        <TableHead>{t('customers.colDate')}</TableHead>
                        <TableHead className="text-end">{t('customers.colTotalSales')}</TableHead>
                        <TableHead className="text-end">{t('customers.colPaid')}</TableHead>
                        <TableHead className="text-end">{t('customers.colRemaining')}</TableHead>
                        <TableHead>{t('customers.colStatus')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(Array.isArray(selectedAccount.invoices) ? selectedAccount.invoices : []).map((inv: any) => (
                        <TableRow
                          key={inv.id}
                          className="cursor-pointer hover:bg-muted/60"
                          onClick={() => void openOrderInvoice(inv.id)}
                        >
                          <TableCell className="font-medium text-primary underline-offset-2 hover:underline">
                            {invoiceRowLoadingId === String(inv.id) ? (
                              <span className="inline-flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                {inv.invoice_number}
                              </span>
                            ) : (
                              inv.invoice_number
                            )}
                          </TableCell>
                          <TableCell>{inv.date}</TableCell>
                          <TableCell className="text-end">{Number(inv.total).toLocaleString()}</TableCell>
                          <TableCell className="text-end">{Number(inv.paid ?? 0).toLocaleString()}</TableCell>
                          <TableCell className={`text-end tabular-nums ${Number(inv.remaining) < -0.005 ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}>
                            {Number(inv.remaining) < -0.005
                              ? `(${isAr ? 'دائن' : 'credit'}) ${Math.abs(Number(inv.remaining)).toLocaleString()}`
                              : Number(inv.remaining).toLocaleString()}
                          </TableCell>
                          <TableCell>{inv.status}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TabsContent>

                <TabsContent value="receipts" className="m-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('customers.colDate')}</TableHead>
                        <TableHead className="text-end">{t('customers.colAmount')}</TableHead>
                        <TableHead>{t('customers.colMethod')}</TableHead>
                        <TableHead>{t('customers.colReference')}</TableHead>
                        <TableHead className="w-[1%]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(Array.isArray(selectedAccount.receipts) ? selectedAccount.receipts : []).map((r: any) => (
                        <TableRow key={r.id}>
                          <TableCell>{r.date}</TableCell>
                          <TableCell className="text-end tabular-nums">{Number(r.amount).toLocaleString()}</TableCell>
                          <TableCell>{r.method || '-'}</TableCell>
                          <TableCell>{r.reference || '-'}</TableCell>
                          <TableCell>
                            <div className="flex gap-1 justify-end">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                disabled={editingReceiptId === String(r.id)}
                                onClick={() => openEditReceipt(r)}
                                title={t('customers.editReceipt')}
                              >
                                {editingReceiptId === String(r.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Pencil className="w-3 h-3" />}
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                disabled={editingReceiptId === String(r.id)}
                                onClick={() => void handleDeleteReceipt(r)}
                                title={t('customers.deleteReceipt')}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TabsContent>

                <TabsContent value="ledger" className="m-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8 text-center">{t('customers.colSeq')}</TableHead>
                        <TableHead>{t('customers.colDescription')}</TableHead>
                        <TableHead className="text-end">{t('customers.colDebit')}</TableHead>
                        <TableHead className="text-end">{t('customers.colCredit')}</TableHead>
                        <TableHead className="text-end">{t('customers.colBalance')}</TableHead>
                        <TableHead className="w-24">{t('customers.colDate')}</TableHead>
                        <TableHead className="w-[1%]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {buildEnhancedLedger(selectedAccount).flatMap((row: any) => {
                        const hasItems = Array.isArray(row.items) && row.items.length > 0;
                        const isInvoice = row.source === 'invoice';
                        const isReceipt = row.source === 'receipt';
                        const isReturn = row.source === 'return';
                        const rows = [];

                        rows.push(
                          <TableRow key={row.key} className={isInvoice ? 'font-medium bg-muted/20' : undefined}>
                            <TableCell className="text-center text-muted-foreground text-xs">{row.seq}</TableCell>
                            <TableCell className={isInvoice ? 'text-primary' : isReceipt ? 'text-emerald-700 dark:text-emerald-400' : isReturn ? 'text-amber-700 dark:text-amber-400' : ''}>
                              {row.description}
                            </TableCell>
                            <TableCell className="text-end tabular-nums">{row.debit > 0 ? Number(row.debit).toLocaleString() : ''}</TableCell>
                            <TableCell className="text-end tabular-nums">{row.credit > 0 ? Number(row.credit).toLocaleString() : ''}</TableCell>
                            <TableCell className="text-end tabular-nums font-semibold">{Number(row.balance).toLocaleString()}</TableCell>
                            <TableCell className="text-xs tabular-nums text-muted-foreground">{row.date}</TableCell>
                            <TableCell>
                              {isReceipt && (
                                <div className="flex gap-1">
                                  <Button type="button" size="icon" variant="ghost" className="h-6 w-6"
                                    disabled={editingReceiptId === row.source_id}
                                    onClick={() => {
                                      const r = (Array.isArray(selectedAccount?.receipts) ? selectedAccount.receipts : []).find((x: any) => String(x.id) === row.source_id);
                                      if (r) openEditReceipt(r);
                                    }}
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </Button>
                                  <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive"
                                    disabled={editingReceiptId === row.source_id}
                                    onClick={() => {
                                      const r = (Array.isArray(selectedAccount?.receipts) ? selectedAccount.receipts : []).find((x: any) => String(x.id) === row.source_id);
                                      if (r) void handleDeleteReceipt(r);
                                    }}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );

                        if (isInvoice && hasItems) {
                          rows.push(
                            <TableRow key={`${row.key}-items-header`} className="bg-slate-50 dark:bg-slate-900/40">
                              <TableCell className="text-center text-[10px] font-semibold text-muted-foreground">{t('customers.colSeq')}</TableCell>
                              <TableCell className="text-[10px] font-semibold text-muted-foreground">{t('customers.colProductName')}</TableCell>
                              <TableCell className="text-end text-[10px] font-semibold text-muted-foreground">{t('customers.colQty')}</TableCell>
                              <TableCell className="text-end text-[10px] font-semibold text-muted-foreground">{t('customers.colUnitPrice')}</TableCell>
                              <TableCell className="text-end text-[10px] font-semibold text-muted-foreground">{t('customers.colBalance')}</TableCell>
                              <TableCell colSpan={2} />
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
                                <TableCell colSpan={2} />
                              </TableRow>
                            );
                          });
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

      <OrderInvoiceDetailDialog
        order={orderDetail}
        open={orderDetailOpen}
        onOpenChange={(open) => {
          setOrderDetailOpen(open);
          if (!open) setOrderDetail(null);
        }}
      />

      <Dialog
        open={editReceiptOpen}
        onOpenChange={(open) => {
          setEditReceiptOpen(open);
          if (!open) setEditingReceipt(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('customers.editReceiptTitle')}
              {editingReceipt?.reference ? ` — ${editingReceipt.reference}` : ''}
            </DialogTitle>
          </DialogHeader>
          {editingReceipt && (
            <form onSubmit={submitEditReceipt} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="edit-amount">{t('customers.receiveAmount')}</Label>
                  <Input
                    id="edit-amount"
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    defaultValue={editingReceipt.amount}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-date">{t('customers.receiveDate')}</Label>
                  <Input
                    id="edit-date"
                    name="receipt_date"
                    type="date"
                    required
                    defaultValue={editingReceipt.date}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-method">{t('customers.receiveMethod')}</Label>
                <Input
                  id="edit-method"
                  name="payment_method"
                  placeholder={t('customers.receiveMethodPlaceholder')}
                  defaultValue={editingReceipt.method || ''}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-reference">{t('customers.receiveReference')}</Label>
                <Input
                  id="edit-reference"
                  name="external_reference"
                  placeholder={t('customers.receiveReferencePlaceholder')}
                  defaultValue={editingReceipt.reference || ''}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-notes">{t('customers.receiveNotes')}</Label>
                <Input
                  id="edit-notes"
                  name="description"
                  placeholder={t('customers.receiveNotesPlaceholder')}
                  defaultValue={editingReceipt.notes || ''}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setEditReceiptOpen(false); setEditingReceipt(null); }}>
                  {t('customers.cancel')}
                </Button>
                <Button type="submit" disabled={editingReceiptId === String(editingReceipt?.id)}>
                  {editingReceiptId === String(editingReceipt?.id) ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : null}
                  {t('customers.save')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isAddCustomerOpen} onOpenChange={setIsAddCustomerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('customers.addDialogTitle')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddCustomer} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="customer-name">{t('customers.fieldName')}</Label>
              <Input id="customer-name" name="name" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="customer-email">{t('customers.fieldEmail')}</Label>
                <Input id="customer-email" name="email" type="email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customer-phone">{t('customers.fieldPhone')}</Label>
                <Input id="customer-phone" name="phone" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="customer-tax">{t('customers.fieldTaxId')}</Label>
                <Input id="customer-tax" name="tax_id" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customer-limit">{t('customers.fieldCreditLimit')}</Label>
                <Input id="customer-limit" name="credit_limit" type="number" defaultValue={0} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-address">{t('customers.fieldAddress')}</Label>
              <Input id="customer-address" name="address" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddCustomerOpen(false)}>
                {t('customers.cancel')}
              </Button>
              <Button type="submit">{t('customers.save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
