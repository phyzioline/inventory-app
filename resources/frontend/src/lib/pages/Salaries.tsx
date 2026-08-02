import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import axios from 'axios';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  employeeService,
  expenseService,
  type Employee,
  type Expense,
} from '@/lib/supabase-services';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import {
  Plus,
  Users,
  Wallet,
  Banknote,
  Pencil,
  UserPlus,
  Download,
} from 'lucide-react';

const toNumber = (value: number | string | null | undefined) => {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

export default function Salaries() {
  const { t, dir, language } = useLanguage();
  const isAr = language === 'ar';
  const queryClient = useQueryClient();

  const [employeeDialogOpen, setEmployeeDialogOpen] = useState(false);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [payingEmployee, setPayingEmployee] = useState<Employee | null>(null);

  const [employeeForm, setEmployeeForm] = useState({
    name: '',
    job_title: '',
    phone: '',
    base_salary: '',
    notes: '',
    is_active: true,
  });

  const [payForm, setPayForm] = useState({
    amount: '',
    expense_date: format(new Date(), 'yyyy-MM-dd'),
    payment_method: 'cash',
    description: '',
  });

  const { data: employees = [], isLoading: employeesLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeeService.getAll(),
  });

  const { data: expenses = [], isLoading: expensesLoading } = useQuery({
    queryKey: ['expenses'],
    queryFn: expenseService.getAll,
  });

  const salaryPayments = useMemo(
    () =>
      (expenses as Expense[])
        .filter((e) => e.category === 'salaries')
        .sort(
          (a, b) =>
            new Date(b.expense_date || b.created_at || 0).getTime() -
            new Date(a.expense_date || a.created_at || 0).getTime()
        ),
    [expenses]
  );

  const employeeStats = useMemo(() => {
    const map: Record<
      string,
      { totalPaid: number; lastPayment: string | null; lastAmount: number }
    > = {};

    for (const payment of salaryPayments) {
      const name = String(payment.vendor_name || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!map[key]) {
        map[key] = { totalPaid: 0, lastPayment: null, lastAmount: 0 };
      }
      map[key].totalPaid += toNumber(payment.amount);
      if (!map[key].lastPayment) {
        map[key].lastPayment = payment.expense_date || payment.created_at || null;
        map[key].lastAmount = toNumber(payment.amount);
      }
    }

    return map;
  }, [salaryPayments]);

  const totalSalariesPaid = useMemo(
    () => salaryPayments.reduce((sum, e) => sum + toNumber(e.amount), 0),
    [salaryPayments]
  );

  const resetEmployeeForm = () => {
    setEmployeeForm({
      name: '',
      job_title: '',
      phone: '',
      base_salary: '',
      notes: '',
      is_active: true,
    });
    setEditingEmployee(null);
  };

  const openAddEmployee = () => {
    resetEmployeeForm();
    setEmployeeDialogOpen(true);
  };

  const openEditEmployee = (employee: Employee) => {
    setEditingEmployee(employee);
    setEmployeeForm({
      name: employee.name || '',
      job_title: employee.job_title || '',
      phone: employee.phone || '',
      base_salary: employee.base_salary != null ? String(employee.base_salary) : '',
      notes: employee.notes || '',
      is_active: employee.is_active !== false,
    });
    setEmployeeDialogOpen(true);
  };

  const openPayDialog = (employee: Employee) => {
    setPayingEmployee(employee);
    setPayForm({
      amount: employee.base_salary != null ? String(employee.base_salary) : '',
      expense_date: format(new Date(), 'yyyy-MM-dd'),
      payment_method: 'cash',
      description: isAr ? `راتب — ${employee.name}` : `Salary — ${employee.name}`,
    });
    setPayDialogOpen(true);
  };

  const saveEmployeeMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: employeeForm.name.trim(),
        job_title: employeeForm.job_title.trim() || null,
        phone: employeeForm.phone.trim() || null,
        base_salary: employeeForm.base_salary ? parseFloat(employeeForm.base_salary) : null,
        notes: employeeForm.notes.trim() || null,
        is_active: employeeForm.is_active,
      };
      if (editingEmployee) {
        return employeeService.update(editingEmployee.id, payload);
      }
      return employeeService.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setEmployeeDialogOpen(false);
      resetEmployeeForm();
      toast.success(t('salaries.createdSuccess'));
    },
    onError: (error: unknown) => {
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
      toast.error(t('salaries.createdError'));
    },
  });

  const paySalaryMutation = useMutation({
    mutationFn: async () => {
      if (!payingEmployee) throw new Error('No employee');
      return expenseService.create({
        category: 'salaries',
        amount: parseFloat(payForm.amount),
        payment_method: payForm.payment_method,
        description: payForm.description || undefined,
        vendor_name: payingEmployee.name,
        expense_date: payForm.expense_date,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setPayDialogOpen(false);
      setPayingEmployee(null);
      toast.success(t('salaries.paidSuccess'));
    },
    onError: (error: unknown) => {
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
      toast.error(t('salaries.paidError'));
    },
  });

  const importMutation = useMutation({
    mutationFn: employeeService.importFromExpenses,
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      const count = Number(data?.created ?? 0);
      toast.success(t('salaries.importSuccess').replace('{count}', String(count)));
    },
    onError: () => toast.error(t('salaries.importError')),
  });

  const handleSaveEmployee = () => {
    if (!employeeForm.name.trim()) {
      toast.error(t('validation.required'));
      return;
    }
    saveEmployeeMutation.mutate();
  };

  const handlePaySalary = () => {
    if (!payForm.amount || parseFloat(payForm.amount) <= 0) {
      toast.error(t('validation.amountRequired'));
      return;
    }
    if (!payForm.expense_date) {
      toast.error(t('validation.required'));
      return;
    }
    paySalaryMutation.mutate();
  };

  const getPaymentMethodLabel = (method: string) => {
    const methodMap: Record<string, string> = {
      cash: t('paymentMethod.cash'),
      bank_transfer: t('paymentMethod.bankTransfer'),
      card: t('paymentMethod.card'),
      check: t('paymentMethod.check'),
      online: t('paymentMethod.online'),
    };
    return methodMap[method] || method;
  };

  const getDeductionSourceLabel = (method: string) => {
    const normalized = String(method || '').toLowerCase();
    if (normalized === 'cash') return isAr ? 'الخزنة (نقدي)' : 'Cash Box';
    if (normalized === 'bank_transfer' || normalized === 'check' || normalized === 'online') {
      return isAr ? 'الحساب البنكي' : 'Bank Account';
    }
    if (normalized === 'card') return isAr ? 'حساب البطاقة/البنك' : 'Card/Bank Account';
    return isAr ? 'غير محدد' : 'Unspecified';
  };

  return (
    <div className="space-y-6" dir={dir}>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('salaries.title')}</h1>
          <p className="text-muted-foreground">{t('salaries.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => importMutation.mutate()}
            disabled={importMutation.isPending}
          >
            <Download className="w-4 h-4 me-2" />
            {t('salaries.importFromExpenses')}
          </Button>
          <Button size="sm" onClick={openAddEmployee}>
            <UserPlus className="w-4 h-4 me-2" />
            {t('salaries.addEmployee')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('salaries.employeeCount')}</p>
                <p className="text-2xl font-bold">{employees.length}</p>
              </div>
              <div className="p-3 bg-primary/20 rounded-full">
                <Users className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('salaries.totalSalaries')}</p>
                <p className="text-2xl font-bold text-destructive">
                  {totalSalariesPaid.toLocaleString()} EGP
                </p>
              </div>
              <div className="p-3 bg-destructive/20 rounded-full">
                <Banknote className="w-6 h-6 text-destructive" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('salaries.payments')}</p>
                <p className="text-2xl font-bold">{salaryPayments.length}</p>
              </div>
              <div className="p-3 bg-accent/20 rounded-full">
                <Wallet className="w-6 h-6 text-accent" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardContent className="pt-6 space-y-4">
          <h2 className="text-lg font-semibold">{t('salaries.employees')}</h2>
          {employeesLoading ? (
            <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
          ) : employees.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">{t('salaries.noEmployees')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('salaries.employeeName')}</TableHead>
                    <TableHead>{t('salaries.jobTitle')}</TableHead>
                    <TableHead>{t('salaries.baseSalary')}</TableHead>
                    <TableHead>{t('salaries.lastPayment')}</TableHead>
                    <TableHead>{t('salaries.totalPaid')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead>{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((employee: Employee) => {
                    const stats = employeeStats[String(employee.name || '').trim().toLowerCase()];
                    return (
                      <TableRow key={employee.id}>
                        <TableCell className="font-medium">{employee.name}</TableCell>
                        <TableCell>{employee.job_title || '—'}</TableCell>
                        <TableCell>
                          {employee.base_salary != null
                            ? `${toNumber(employee.base_salary).toLocaleString()} EGP`
                            : '—'}
                        </TableCell>
                        <TableCell>
                          {stats?.lastPayment
                            ? `${format(new Date(stats.lastPayment), 'yyyy-MM-dd')} (${stats.lastAmount.toLocaleString()})`
                            : '—'}
                        </TableCell>
                        <TableCell>
                          {stats ? `${stats.totalPaid.toLocaleString()} EGP` : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={employee.is_active !== false ? 'default' : 'secondary'}>
                            {employee.is_active !== false ? t('salaries.active') : t('salaries.inactive')}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => openPayDialog(employee)}
                              disabled={employee.is_active === false}
                            >
                              <Plus className="w-4 h-4 me-1" />
                              {t('salaries.paySalary')}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => openEditEmployee(employee)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
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

      <Card className="glass-card">
        <CardContent className="pt-6 space-y-4">
          <h2 className="text-lg font-semibold">{t('salaries.payments')}</h2>
          {expensesLoading ? (
            <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
          ) : salaryPayments.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">{t('salaries.noPayments')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('expenses.expenseNumber')}</TableHead>
                    <TableHead>{t('common.date')}</TableHead>
                    <TableHead>{t('salaries.employeeName')}</TableHead>
                    <TableHead>{t('paymentMethod.title')}</TableHead>
                    <TableHead>{t('common.amount')}</TableHead>
                    <TableHead>{t('common.description')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salaryPayments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>{payment.expense_number || '—'}</TableCell>
                      <TableCell>
                        {format(new Date(payment.expense_date || payment.created_at || 0), 'yyyy-MM-dd')}
                      </TableCell>
                      <TableCell className="font-medium">{payment.vendor_name || '—'}</TableCell>
                      <TableCell>{getPaymentMethodLabel(payment.payment_method || 'cash')}</TableCell>
                      <TableCell className="text-destructive font-semibold">
                        −{toNumber(payment.amount).toLocaleString()} EGP
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate">{payment.description || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={employeeDialogOpen}
        onOpenChange={(open) => {
          setEmployeeDialogOpen(open);
          if (!open) resetEmployeeForm();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingEmployee ? t('salaries.editEmployee') : t('salaries.addEmployee')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('salaries.employeeName')} *</Label>
              <Input
                value={employeeForm.name}
                onChange={(e) => setEmployeeForm({ ...employeeForm, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('salaries.jobTitle')}</Label>
                <Input
                  value={employeeForm.job_title}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, job_title: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('salaries.phone')}</Label>
                <Input
                  value={employeeForm.phone}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, phone: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('salaries.baseSalary')}</Label>
              <Input
                type="number"
                value={employeeForm.base_salary}
                onChange={(e) => setEmployeeForm({ ...employeeForm, base_salary: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('common.description')}</Label>
              <Textarea
                value={employeeForm.notes}
                onChange={(e) => setEmployeeForm({ ...employeeForm, notes: e.target.value })}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmployeeDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSaveEmployee} disabled={saveEmployeeMutation.isPending}>
              {saveEmployeeMutation.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={payDialogOpen}
        onOpenChange={(open) => {
          setPayDialogOpen(open);
          if (!open) setPayingEmployee(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('salaries.payFor')} {payingEmployee?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('common.date')} *</Label>
                <Input
                  type="date"
                  value={payForm.expense_date}
                  onChange={(e) => setPayForm({ ...payForm, expense_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('common.amount')} *</Label>
                <Input
                  type="number"
                  value={payForm.amount}
                  onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('paymentMethod.title')}</Label>
              <Select
                value={payForm.payment_method}
                onValueChange={(v) => setPayForm({ ...payForm, payment_method: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">{t('paymentMethod.cash')}</SelectItem>
                  <SelectItem value="bank_transfer">{t('paymentMethod.bankTransfer')}</SelectItem>
                  <SelectItem value="card">{t('paymentMethod.card')}</SelectItem>
                  <SelectItem value="check">{t('paymentMethod.check')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{isAr ? 'سيتم الخصم من: ' : 'Will be deducted from: '}</span>
              <span className="font-semibold">{getDeductionSourceLabel(payForm.payment_method)}</span>
              <p className="text-xs text-muted-foreground mt-1">{t('salaries.amountHint')}</p>
            </div>
            <div className="space-y-2">
              <Label>{t('common.description')}</Label>
              <Textarea
                value={payForm.description}
                onChange={(e) => setPayForm({ ...payForm, description: e.target.value })}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handlePaySalary} disabled={paySalaryMutation.isPending}>
              {paySalaryMutation.isPending ? t('common.saving') : t('salaries.paySalary')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
