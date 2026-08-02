import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import axios from 'axios';
import { useLanguage } from '@/contexts/LanguageContext';
import { employeeService, expenseService, Expense, warehouseService } from '@/lib/supabase-services';
import { exportToExcel } from '@/lib/excelUtils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Search,
  Plus,
  Download,
  Pencil,
  DollarSign,
  TrendingDown,
  Wallet,
  PieChart,
  X,
  Users,
  ChevronsUpDown,
  Check,
} from 'lucide-react';

const toNumber = (value: number | string | null | undefined) => {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

/** Operational expense categories — salaries live on /salaries */
const EXPENSE_CATEGORIES = [
  'general',
  'shipping',
  'utilities',
  'rent',
  'marketing',
  'maintenance',
  'supplies',
  'taxes',
  'insurance',
  'travel',
  'other',
];

export default function Expenses() {
  const { t, dir, language } = useLanguage();
  const isAr = language === 'ar';
  const queryClient = useQueryClient();
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>('all');
  const [beneficiaryFilter, setBeneficiaryFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState<string>(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  
  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [beneficiaryPickerOpen, setBeneficiaryPickerOpen] = useState(false);
  const [beneficiarySearch, setBeneficiarySearch] = useState('');
  const [formData, setFormData] = useState({
    category: 'general',
    warehouse_id: '',
    amount: '',
    payment_method: 'cash',
    description: '',
    vendor_name: '',
    expense_date: format(new Date(), 'yyyy-MM-dd'),
  });

  // Queries
  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses'],
    queryFn: expenseService.getAll,
  });

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: warehouseService.getAll,
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeeService.getAll(true),
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: expenseService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setIsDialogOpen(false);
      resetForm();
      toast.success(t('expenses.createdSuccess'));
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
      toast.error(t('expenses.createdError'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => expenseService.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setIsDialogOpen(false);
      setEditingExpenseId(null);
      resetForm();
      toast.success(isAr ? 'تم تحديث المصروف بنجاح' : 'Expense updated successfully');
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
      toast.error(isAr ? 'فشل تحديث المصروف' : 'Failed to update expense');
    },
  });

  const resetForm = () => {
    setFormData({
      category: 'general',
      warehouse_id: '',
      amount: '',
      payment_method: 'cash',
      description: '',
      vendor_name: '',
      expense_date: format(new Date(), 'yyyy-MM-dd'),
    });
  };

  // Filtered data (salaries excluded — managed on /salaries)
  const operationalExpenses = useMemo(
    () => expenses.filter((expense) => expense.category !== 'salaries'),
    [expenses]
  );

  const beneficiaryOptions = useMemo(() => {
    const set = new Set<string>();
    employees.forEach((emp: { name?: string }) => {
      const name = String(emp.name || '').trim();
      if (name) set.add(name);
    });
    operationalExpenses.forEach((expense) => {
      const beneficiary = String(expense.vendor_name || '').trim();
      if (beneficiary) set.add(beneficiary);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [employees, operationalExpenses]);

  const filteredBeneficiaryOptions = useMemo(() => {
    const q = beneficiarySearch.trim().toLowerCase();
    if (!q) return beneficiaryOptions;
    return beneficiaryOptions.filter((name) => name.toLowerCase().includes(q));
  }, [beneficiaryOptions, beneficiarySearch]);

  const filteredExpenses = useMemo(() => {
    return operationalExpenses.filter((expense) => {
      const matchesSearch =
        !searchQuery ||
        expense.vendor_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        expense.expense_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        expense.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        expense.category?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesWarehouse =
        warehouseFilter === 'all' || expense.warehouse_id === warehouseFilter;
      const matchesCategory =
        categoryFilter === 'all' || expense.category === categoryFilter;
      const matchesPaymentMethod =
        paymentMethodFilter === 'all' || expense.payment_method === paymentMethodFilter;
      const matchesBeneficiary =
        beneficiaryFilter === 'all' || (expense.vendor_name || '').trim() === beneficiaryFilter;

      const expenseDate = new Date(expense.expense_date || expense.created_at);
      const matchesDateFrom = !dateFrom || expenseDate >= new Date(dateFrom);
      const matchesDateTo = !dateTo || expenseDate <= new Date(dateTo + 'T23:59:59');

      return matchesSearch && matchesWarehouse && matchesCategory && matchesPaymentMethod && matchesBeneficiary && matchesDateFrom && matchesDateTo;
    });
  }, [operationalExpenses, searchQuery, warehouseFilter, categoryFilter, paymentMethodFilter, beneficiaryFilter, dateFrom, dateTo]);

  const selectedBeneficiarySummary = useMemo(() => {
    if (beneficiaryFilter === 'all') return null;
    const transactions = filteredExpenses.length;
    const total = filteredExpenses.reduce((sum, e) => sum + toNumber(e.amount), 0);
    return {
      beneficiary: beneficiaryFilter,
      transactions,
      total,
    };
  }, [beneficiaryFilter, filteredExpenses]);

  // Statistics
  const stats = useMemo(() => {
    const totalAmount = filteredExpenses.reduce((sum, e) => sum + toNumber(e.amount), 0);
    const count = filteredExpenses.length;
    const avgAmount = count > 0 ? totalAmount / count : 0;
    
    const byCategory: Record<string, number> = {};
    filteredExpenses.forEach((e) => {
      const category = e.category || 'general';
      byCategory[category] = (byCategory[category] || 0) + toNumber(e.amount);
    });

    // Find top category
    const topCategory = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];

    return { totalAmount, count, avgAmount, byCategory, topCategory };
  }, [filteredExpenses]);

  const handleSubmit = () => {
    if (!formData.category) {
      toast.error(t('validation.required'));
      return;
    }
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      toast.error(t('validation.amountRequired'));
      return;
    }
    if (!formData.expense_date) {
      toast.error(t('validation.required'));
      return;
    }

    const payload = {
      category: formData.category,
      warehouse_id: formData.warehouse_id || undefined,
      amount: parseFloat(formData.amount),
      payment_method: formData.payment_method,
      description: formData.description || undefined,
      vendor_name: formData.vendor_name || undefined,
      expense_date: formData.expense_date,
    };

    if (editingExpenseId) {
      updateMutation.mutate({ id: editingExpenseId, payload });
      return;
    }

    createMutation.mutate(payload);
  };

  const openCreateDialog = () => {
    setEditingExpenseId(null);
    resetForm();
    setBeneficiarySearch('');
    setIsDialogOpen(true);
  };

  const openEditDialog = (expense: Expense) => {
    setEditingExpenseId(expense.id);
    const vendorName = expense.vendor_name || '';
    setFormData({
      category: expense.category || 'general',
      warehouse_id: expense.warehouse_id || '',
      amount: toNumber(expense.amount).toString(),
      payment_method: expense.payment_method || 'cash',
      description: expense.description || '',
      vendor_name: vendorName,
      expense_date: format(new Date(expense.expense_date || expense.created_at), 'yyyy-MM-dd'),
    });
    setBeneficiarySearch(vendorName);
    setIsDialogOpen(true);
  };

  const handleExport = () => {
    const exportData = filteredExpenses.map((e) => ({
      [t('expenses.expenseNumber')]: e.expense_number || '-',
      [t('common.date')]: format(new Date(e.expense_date || e.created_at), 'yyyy-MM-dd'),
      [t('table.category')]: getCategoryLabel(e.category),
      [isAr ? 'المستفيد' : 'Beneficiary']: e.vendor_name || '-',
      [t('table.warehouse')]: warehouses.find((w) => w.id === e.warehouse_id)?.name || '-',
      [t('common.amount')]: e.amount,
      [t('paymentMethod.title')]: e.payment_method,
      [t('common.description')]: e.description || '-',
    }));
    exportToExcel(exportData, 'expenses');
  };

  const clearFilters = () => {
    setSearchQuery('');
    setWarehouseFilter('all');
    setCategoryFilter('all');
    setPaymentMethodFilter('all');
    setBeneficiaryFilter('all');
    setDateFrom(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
    setDateTo(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  };

  const getWarehouseName = (id: string | null) => 
    id ? warehouses.find((w) => w.id === id)?.name || '-' : '-';

  const getCategoryLabel = (category: string) => {
    const categoryMap: Record<string, string> = {
      'general': t('category.general'),
      'shipping': t('category.shipping'),
      'utilities': t('category.utilities'),
      'rent': t('category.rent'),
      'salaries': t('category.salaries'),
      'marketing': t('category.marketing'),
      'maintenance': t('category.maintenance'),
      'supplies': t('category.supplies'),
      'taxes': t('category.taxes'),
      'insurance': t('category.insurance'),
      'travel': t('category.travel'),
      'other': t('category.other'),
    };
    return categoryMap[category] || category;
  };

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

  const getDeductionSourceLabel = (method: string | null | undefined) => {
    const normalized = String(method || '').toLowerCase();
    if (normalized === 'cash') {
      return isAr ? 'الخزنة (نقدي)' : 'Cash Box';
    }
    if (normalized === 'bank_transfer' || normalized === 'check' || normalized === 'online') {
      return isAr ? 'الحساب البنكي' : 'Bank Account';
    }
    if (normalized === 'card') {
      return isAr ? 'حساب البطاقة/البنك' : 'Card/Bank Account';
    }
    return isAr ? 'غير محدد' : 'Unspecified';
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      shipping: 'bg-blue-500/10 text-blue-500',
      utilities: 'bg-yellow-500/10 text-yellow-500',
      rent: 'bg-purple-500/10 text-purple-500',
      salaries: 'bg-green-500/10 text-green-500',
      marketing: 'bg-pink-500/10 text-pink-500',
      maintenance: 'bg-orange-500/10 text-orange-500',
      taxes: 'bg-red-500/10 text-red-500',
    };
    return colors[category] || 'bg-muted text-muted-foreground';
  };

  return (
    <div className="space-y-6" dir={dir}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('expenses.title')}</h1>
          <p className="text-muted-foreground">{t('expenses.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/salaries">
              <Users className="w-4 h-4 me-2" />
              {t('expenses.manageSalaries')}
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4 me-2" />
            {t('common.export')}
          </Button>
          <Dialog
            open={isDialogOpen}
            onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) {
                setEditingExpenseId(null);
                resetForm();
                setBeneficiaryPickerOpen(false);
                setBeneficiarySearch('');
              }
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" onClick={openCreateDialog}>
                <Plus className="w-4 h-4 me-2" />
                {t('expenses.newExpense')}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{editingExpenseId ? t('common.edit') : t('expenses.recordExpense')}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <Label>{t('common.date')}</Label>
                    <Input
                      type="date"
                      value={formData.expense_date}
                      onChange={(e) => setFormData({ ...formData, expense_date: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('table.category')} *</Label>
                    <Select
                      value={formData.category}
                      onValueChange={(v) => setFormData({ ...formData, category: v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {EXPENSE_CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat}>{getCategoryLabel(cat)}</SelectItem>
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
                  <Label>{isAr ? 'المستفيد' : 'Beneficiary'}</Label>
                  <Popover open={beneficiaryPickerOpen} onOpenChange={setBeneficiaryPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        className="w-full justify-between font-normal"
                      >
                        <span className={cn('truncate', !formData.vendor_name && 'text-muted-foreground')}>
                          {formData.vendor_name || (isAr ? 'اسم المستفيد' : 'Beneficiary name')}
                        </span>
                        <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-60" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder={t('salaries.searchBeneficiary')}
                          value={beneficiarySearch}
                          onValueChange={(value) => {
                            setBeneficiarySearch(value);
                            setFormData({ ...formData, vendor_name: value });
                          }}
                        />
                        <CommandEmpty>{t('salaries.noBeneficiaryMatch')}</CommandEmpty>
                        <CommandList>
                          <CommandGroup>
                            {filteredBeneficiaryOptions.map((name) => (
                              <CommandItem
                                key={name}
                                value={name}
                                onSelect={() => {
                                  setFormData({ ...formData, vendor_name: name });
                                  setBeneficiarySearch(name);
                                  setBeneficiaryPickerOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    'me-2 h-4 w-4',
                                    formData.vendor_name === name ? 'opacity-100' : 'opacity-0'
                                  )}
                                />
                                {name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
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
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">{isAr ? 'سيتم الخصم من: ' : 'Will be deducted from: '}</span>
                  <span className="font-semibold">{getDeductionSourceLabel(formData.payment_method)}</span>
                </div>
                <div className="space-y-2">
                  <Label>{t('common.description')}</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder={t('expenses.expenseDetails')}
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
                <p className="text-sm text-muted-foreground">{t('expenses.totalExpenses')}</p>
                <p className="text-2xl font-bold text-destructive">{stats.totalAmount.toLocaleString()} EGP</p>
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
                <p className="text-sm text-muted-foreground">{t('expenses.expenseCount')}</p>
                <p className="text-2xl font-bold">{stats.count}</p>
              </div>
              <div className="p-3 bg-primary/20 rounded-full">
                <Wallet className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('expenses.averageExpense')}</p>
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
                <p className="text-sm text-muted-foreground">{t('expenses.topCategory')}</p>
                <p className="text-2xl font-bold">{stats.topCategory ? getCategoryLabel(stats.topCategory[0]) : '-'}</p>
              </div>
              <div className="p-3 bg-warning/20 rounded-full">
                <PieChart className="w-6 h-6 text-warning" />
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
                  placeholder={t('expenses.searchPlaceholder')}
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
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder={t('table.category')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('category.allCategories')}</SelectItem>
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>{getCategoryLabel(cat)}</SelectItem>
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
              <Select value={beneficiaryFilter} onValueChange={setBeneficiaryFilter}>
                <SelectTrigger className="w-[170px]">
                  <SelectValue placeholder={isAr ? 'المستفيد' : 'Beneficiary'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isAr ? 'كل المستفيدين' : 'All Beneficiaries'}</SelectItem>
                  {beneficiaryOptions.map((beneficiary) => (
                    <SelectItem key={beneficiary} value={beneficiary}>
                      {beneficiary}
                    </SelectItem>
                  ))}
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

      {selectedBeneficiarySummary && (
        <Card className="glass-card">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge variant="secondary">
                {isAr ? 'المستفيد' : 'Beneficiary'}: {selectedBeneficiarySummary.beneficiary}
              </Badge>
              <Badge variant="outline">
                {isAr ? 'عدد المعاملات' : 'Transactions'}: {selectedBeneficiarySummary.transactions}
              </Badge>
              <Badge className="bg-destructive/10 text-destructive">
                {isAr ? 'إجمالي المصروفات' : 'Total Expenses'}: {selectedBeneficiarySummary.total.toLocaleString()} EGP
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card className="glass-card">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('expenses.expenseNumber')}</TableHead>
                  <TableHead>{t('common.date')}</TableHead>
                  <TableHead>{t('table.category')}</TableHead>
                  <TableHead>{isAr ? 'المستفيد' : 'Beneficiary'}</TableHead>
                  <TableHead>{t('table.warehouse')}</TableHead>
                  <TableHead>{t('table.method')}</TableHead>
                  <TableHead className="text-end">{t('common.amount')}</TableHead>
                  <TableHead className="text-end">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10">{t('common.loading')}</TableCell>
                  </TableRow>
                ) : filteredExpenses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                      {t('expenses.noExpenses')}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredExpenses.map((expense) => (
                    <TableRow key={expense.id}>
                      <TableCell className="font-medium">{expense.expense_number || '-'}</TableCell>
                      <TableCell>{format(new Date(expense.expense_date || expense.created_at), 'yyyy-MM-dd')}</TableCell>
                      <TableCell>
                        <Badge className={getCategoryColor(expense.category)}>{getCategoryLabel(expense.category)}</Badge>
                      </TableCell>
                      <TableCell>{expense.vendor_name || '-'}</TableCell>
                      <TableCell>{getWarehouseName(expense.warehouse_id)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{getPaymentMethodLabel(expense.payment_method || 'cash')}</Badge>
                      </TableCell>
                      <TableCell className="text-end font-medium text-destructive">
                        -{toNumber(expense.amount).toLocaleString()} EGP
                      </TableCell>
                      <TableCell className="text-end">
                        <Button variant="outline" size="sm" onClick={() => openEditDialog(expense)} className="gap-1">
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
