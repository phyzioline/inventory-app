import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useLanguage } from '@/contexts/LanguageContext';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { ProfitSnapshotKpis } from '@/components/finance/ProfitSnapshotKpis';
import {
  Landmark,
  Plus,
  Wallet,
  TrendingUp,
  TrendingDown,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  Building2,
  Search,
} from 'lucide-react';

type LedgerAccountRow = {
  id: number;
  name: string;
  account_type: string;
  opening_balance: number;
  receipts_in: number;
  payments_out: number;
  expenses_out: number;
  computed_balance: number;
};

type CashFlowOverview = {
  stats: {
    total_capital: number;
    total_receipts: number;
    total_payments: number;
    total_expenses: number;
    total_outflow: number;
    net_cash_flow: number;
    estimated_balance: number;
    bank_in: number;
    bank_out: number;
    cash_in: number;
    cash_out: number;
    purchase_paid_cash: number;
    purchase_paid_non_cash: number;
    purchase_paid_total: number;
  };
  movements: Array<{
    id: string | number;
    date: string;
    type: string;
    description: string;
    method: string;
    amount: number;
    reference: string | null;
    finance_account_id?: number | null;
  }>;
  ledger_accounts?: LedgerAccountRow[];
  ledger_excludes_implicit_purchase_settlements?: boolean;
};

export default function BankAccounts() {
  const { t, dir, language } = useLanguage();
  const isAr = language === 'ar';
  const queryClient = useQueryClient();
  const [mainTab, setMainTab] = useState('cashflow');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    bank_name: '',
    account_number: '',
    account_type: 'checking',
    currency: 'EGP',
    current_balance: '',
  });

  const goToCashFlowTab = useCallback(() => setMainTab('cashflow'), []);

  const { data: overview, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['finance-cash-flow-overview'],
    queryFn: () => api.get<CashFlowOverview>('finance/cash-flow-overview'),
    staleTime: 60_000,
    retry: 1,
  });

  const loadErrorDetail = useMemo(() => {
    if (!isAxiosError(error)) return null;
    const parts: string[] = [];
    const st = error.response?.status;
    if (st) {
      parts.push(`HTTP ${st}`);
    }
    const msg = error.response?.data && typeof error.response.data === 'object' && 'message' in error.response.data
      ? (error.response.data as { message?: unknown }).message
      : undefined;
    if (typeof msg === 'string' && msg.trim()) {
      parts.push(msg.trim());
    } else if (error.message) {
      parts.push(error.message);
    }
    if (st === 404) {
      parts.push(t('bankAccounts.error404Hint'));
    }
    return parts.length ? parts.join(' — ') : null;
  }, [error, t]);

  const cashStats = overview?.stats;
  const recentTransactions = overview?.movements ?? [];
  const ledgerAccounts = overview?.ledger_accounts ?? [];

  const accountNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const a of ledgerAccounts) {
      m.set(a.id, a.name);
    }
    return m;
  }, [ledgerAccounts]);

  const filteredTransactions = useMemo(() => {
    if (!searchQuery) return recentTransactions;
    const query = searchQuery.toLowerCase();
    return recentTransactions.filter((tx) =>
      String(tx.description || '').toLowerCase().includes(query) ||
      String(tx.reference || '').toLowerCase().includes(query) ||
      String(tx.method || '').toLowerCase().includes(query) ||
      String(tx.type || '').toLowerCase().includes(query)
    );
  }, [recentTransactions, searchQuery]);

  const movementTypeLabel = (type: string) => {
    if (type === 'receipt') return t('bankAccounts.typeIncome');
    if (type === 'payment') return t('bankAccounts.typePayment');
    if (type === 'expense') return t('bankAccounts.typeExpense');
    if (type === 'purchase_paid') return t('bankAccounts.typePurchasePaid');
    return type;
  };

  const movementDescription = (tx: (typeof recentTransactions)[number]) => {
    if (tx.type === 'purchase_paid') {
      const ref = tx.reference ? String(tx.reference) : '—';
      return `${t('bankAccounts.purchasePaidLine')} (${ref})`;
    }
    return tx.description || '—';
  };

  const methodLabel = (raw: string) => {
    const m = String(raw || 'cash').toLowerCase().replace(/_/g, ' ');
    const key = `bankAccounts.method.${m.replace(/ /g, '_')}`;
    const translated = t(key);
    return translated !== key ? translated : m;
  };

  const handleSubmit = () => {
    toast.success(t('bankAccounts.accountAdded'));
    setIsDialogOpen(false);
    void queryClient.invalidateQueries({ queryKey: ['finance-cash-flow-overview'] });
    void queryClient.invalidateQueries({ queryKey: ['finance-cash-flow-stats'] });
  };

  const searchIconClass = isAr ? 'absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' : 'absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground';
  const searchInputPad = isAr ? 'pr-9' : 'pl-9';

  const flowLoadErrorBlock = isError ? (
    <Alert variant="destructive" className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <AlertTitle>{t('bankAccounts.loadError')}</AlertTitle>
        {loadErrorDetail ? (
          <AlertDescription className="break-words font-mono text-xs" dir="ltr">
            {loadErrorDetail}
          </AlertDescription>
        ) : null}
        <p className="text-xs opacity-90">{t('bankAccounts.offlineStatsHint')}</p>
      </div>
      <Button type="button" variant="secondary" size="sm" className="shrink-0 inline-flex items-center gap-2" onClick={() => void refetch()} disabled={isFetching}>
        {isFetching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {t('bankAccounts.retry')}
      </Button>
    </Alert>
  ) : null;

  const flowSkeleton = (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="h-28 glass-card" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="h-48 glass-card" />
        <Card className="h-48 glass-card" />
      </div>
      <Card className="h-64 glass-card" />
      <div className="flex justify-center py-6 text-muted-foreground text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('bankAccounts.loading')}
      </div>
    </div>
  );

  const renderBankCashSummaries = (stats: NonNullable<typeof cashStats>) => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="w-5 h-5 text-blue-500" />
            {t('bankAccounts.bankSummary')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
              <span className="text-sm text-muted-foreground">{t('bankAccounts.receivedViaBank')}</span>
              <span className="font-bold text-green-500">+{stats.bank_in.toLocaleString()} EGP</span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
              <span className="text-sm text-muted-foreground">{t('bankAccounts.sentViaBank')}</span>
              <span className="font-bold text-red-500">-{stats.bank_out.toLocaleString()} EGP</span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-lg bg-primary/5 border border-primary/20">
              <span className="text-sm font-medium">{t('bankAccounts.netBankFlow')}</span>
              <span className={`font-bold ${(stats.bank_in - stats.bank_out) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {(stats.bank_in - stats.bank_out).toLocaleString()} EGP
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Wallet className="w-5 h-5 text-emerald-500" />
            {t('bankAccounts.cashSummary')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
              <span className="text-sm text-muted-foreground">{t('bankAccounts.cashReceived')}</span>
              <span className="font-bold text-green-500">+{stats.cash_in.toLocaleString()} EGP</span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
              <span className="text-sm text-muted-foreground">{t('bankAccounts.cashSpent')}</span>
              <span className="font-bold text-red-500">-{stats.cash_out.toLocaleString()} EGP</span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-lg bg-primary/5 border border-primary/20">
              <span className="text-sm font-medium">{t('bankAccounts.netCashSummary')}</span>
              <span className={`font-bold ${(stats.cash_in - stats.cash_out) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {(stats.cash_in - stats.cash_out).toLocaleString()} EGP
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderLedgerTable = () => {
    if (ledgerAccounts.length === 0) return null;
    return (
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">{t('bankAccounts.ledgerTableTitle')}</CardTitle>
          {overview?.ledger_excludes_implicit_purchase_settlements ? (
            <p className="text-xs text-muted-foreground leading-relaxed">{t('bankAccounts.ledgerPurchaseSettlementNote')}</p>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('bankAccounts.ledgerColAccount')}</TableHead>
                  <TableHead>{t('bankAccounts.ledgerColType')}</TableHead>
                  <TableHead className="text-end">{t('bankAccounts.ledgerColOpening')}</TableHead>
                  <TableHead className="text-end">{t('bankAccounts.ledgerColReceipts')}</TableHead>
                  <TableHead className="text-end">{t('bankAccounts.ledgerColPayments')}</TableHead>
                  <TableHead className="text-end">{t('bankAccounts.ledgerColExpenses')}</TableHead>
                  <TableHead className="text-end">{t('bankAccounts.ledgerColBalance')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledgerAccounts.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{row.account_type}</TableCell>
                    <TableCell className="text-end tabular-nums">{row.opening_balance.toLocaleString()}</TableCell>
                    <TableCell className="text-end tabular-nums text-green-600">+{row.receipts_in.toLocaleString()}</TableCell>
                    <TableCell className="text-end tabular-nums text-red-600">-{row.payments_out.toLocaleString()}</TableCell>
                    <TableCell className="text-end tabular-nums text-red-600">-{row.expenses_out.toLocaleString()}</TableCell>
                    <TableCell className="text-end font-medium tabular-nums">{row.computed_balance.toLocaleString()} EGP</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderMovementsTable = () => (
    <Card className="glass-card">
      <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4">
        <CardTitle className="text-lg">{t('bankAccounts.recentMovements')}</CardTitle>
        <div className="relative w-full sm:max-w-xs">
          <Search className={searchIconClass} />
          <Input
            placeholder={t('bankAccounts.searchMovements')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`${searchInputPad} h-9`}
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('bankAccounts.colDate')}</TableHead>
                <TableHead>{t('bankAccounts.colReference')}</TableHead>
                <TableHead>{t('bankAccounts.colDescription')}</TableHead>
                  <TableHead>{t('bankAccounts.colMethod')}</TableHead>
                  <TableHead>{t('bankAccounts.colFinanceAccount')}</TableHead>
                  <TableHead>{t('bankAccounts.colType')}</TableHead>
                  <TableHead className="text-end">{t('bankAccounts.colAmount')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                    {t('bankAccounts.emptyMovements')}
                  </TableCell>
                </TableRow>
              ) : (
                filteredTransactions.map((tx) => (
                  <TableRow key={`${tx.type}-${tx.id}`}>
                    <TableCell className="text-sm">
                      {tx.date && !Number.isNaN(new Date(tx.date).getTime())
                        ? new Date(tx.date).toLocaleDateString(isAr ? 'ar-EG' : 'en-US')
                        : '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{tx.reference || '—'}</TableCell>
                    <TableCell className="max-w-[250px] truncate text-sm">{movementDescription(tx)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize">
                        {methodLabel(tx.method || 'cash')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {tx.finance_account_id != null
                        ? (accountNameById.get(tx.finance_account_id) ?? `#${tx.finance_account_id}`)
                        : t('bankAccounts.financeAccountUnknown')}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          tx.type === 'receipt'
                            ? 'bg-green-500/10 text-green-500'
                            : tx.type === 'payment'
                              ? 'bg-blue-500/10 text-blue-500'
                              : tx.type === 'purchase_paid'
                                ? 'bg-violet-500/10 text-violet-600'
                                : 'bg-red-500/10 text-red-500'
                        }
                      >
                        {movementTypeLabel(tx.type)}
                      </Badge>
                    </TableCell>
                    <TableCell className={`text-end font-medium ${tx.amount >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {tx.amount >= 0 ? '+' : ''}{tx.amount.toLocaleString()} EGP
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );

  const renderThreeFlowCards = (stats: NonNullable<typeof cashStats>) => (
    <div id="bank-accounts-flow-summary" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 scroll-mt-4">
      <Card className="glass-card border-l-4 border-l-green-500">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{t('bankAccounts.totalIn')}</p>
              <p className="text-2xl font-bold text-green-500">+{stats.total_receipts.toLocaleString()} EGP</p>
              <p className="text-xs text-muted-foreground mt-1">{t('bankAccounts.totalInHint')}</p>
            </div>
            <div className="p-3 bg-green-500/20 rounded-full">
              <ArrowDownRight className="w-6 h-6 text-green-500" />
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="glass-card border-l-4 border-l-red-500">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{t('bankAccounts.totalOut')}</p>
              <p className="text-2xl font-bold text-red-500">-{stats.total_outflow.toLocaleString()} EGP</p>
              <p className="text-xs text-muted-foreground mt-1">{t('bankAccounts.totalOutHint')}</p>
            </div>
            <div className="p-3 bg-red-500/20 rounded-full">
              <ArrowUpRight className="w-6 h-6 text-red-500" />
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className={`glass-card border-l-4 sm:col-span-2 lg:col-span-1 ${stats.net_cash_flow >= 0 ? 'border-l-emerald-500' : 'border-l-orange-500'}`}>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{t('bankAccounts.netFlow')}</p>
              <p className={`text-2xl font-bold ${stats.net_cash_flow >= 0 ? 'text-emerald-500' : 'text-orange-500'}`}>
                {stats.net_cash_flow >= 0 ? '+' : ''}{stats.net_cash_flow.toLocaleString()} EGP
              </p>
              <p className="text-xs text-muted-foreground mt-1">{t('bankAccounts.netFlowHint')}</p>
            </div>
            <div className={`p-3 rounded-full ${stats.net_cash_flow >= 0 ? 'bg-emerald-500/20' : 'bg-orange-500/20'}`}>
              {stats.net_cash_flow >= 0
                ? <TrendingUp className="w-6 h-6 text-emerald-500" />
                : <TrendingDown className="w-6 h-6 text-orange-500" />}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderBalanceTopCards = (stats: NonNullable<typeof cashStats>) => {
    const netBank = stats.bank_in - stats.bank_out;
    const netCash = stats.cash_in - stats.cash_out;
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="glass-card border-l-4 border-l-blue-500">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('bankAccounts.balanceMovementNetBank')}</p>
                <p className={`text-2xl font-bold ${netBank >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {netBank.toLocaleString()} EGP
                </p>
                <p className="text-xs text-muted-foreground mt-1">{t('bankAccounts.netBankFlow')}</p>
              </div>
              <div className="p-3 bg-blue-500/15 rounded-full">
                <Building2 className="w-6 h-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card border-l-4 border-l-emerald-500">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('bankAccounts.balanceMovementNetCash')}</p>
                <p className={`text-2xl font-bold ${netCash >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {netCash.toLocaleString()} EGP
                </p>
                <p className="text-xs text-muted-foreground mt-1">{t('bankAccounts.netCashSummary')}</p>
              </div>
              <div className="p-3 bg-emerald-500/15 rounded-full">
                <Wallet className="w-6 h-6 text-emerald-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card border-l-4 border-l-primary sm:col-span-2 lg:col-span-1">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('bankAccounts.balanceIndicativeTitle')}</p>
                <p className="text-2xl font-bold">{stats.estimated_balance.toLocaleString()} EGP</p>
                <p className="text-xs text-muted-foreground mt-1">{t('bankAccounts.balanceIndicativeHint')}</p>
              </div>
              <div className="p-3 bg-primary/20 rounded-full">
                <Landmark className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="space-y-6" dir={dir}>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('bankAccounts.title')}</h1>
          <p className="text-muted-foreground text-sm">{t('bankAccounts.subtitle')}</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="w-4 h-4 me-2" />
              {t('bankAccounts.addAccount')}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('bankAccounts.dialogTitle')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('bankAccounts.accountLabel')}</Label>
                <Input placeholder={t('bankAccounts.accountLabelPh')} value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('bankAccounts.bankName')}</Label>
                  <Input placeholder={t('bankAccounts.bankNamePh')} value={formData.bank_name} onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t('bankAccounts.accountType')}</Label>
                  <Select value={formData.account_type} onValueChange={(v) => setFormData({ ...formData, account_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="checking">{t('bankAccounts.acc.checking')}</SelectItem>
                      <SelectItem value="savings">{t('bankAccounts.acc.savings')}</SelectItem>
                      <SelectItem value="wallet">{t('bankAccounts.acc.wallet')}</SelectItem>
                      <SelectItem value="cash">{t('bankAccounts.acc.cash')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('bankAccounts.accountNumber')}</Label>
                  <Input placeholder="xxxx-xxxx" value={formData.account_number} onChange={(e) => setFormData({ ...formData, account_number: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t('bankAccounts.openingBalance')}</Label>
                  <Input type="number" placeholder="0.00" value={formData.current_balance} onChange={(e) => setFormData({ ...formData, current_balance: e.target.value })} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>{t('common.cancel')}</Button>
              <Button onClick={handleSubmit}>{t('bankAccounts.saveAccount')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed border rounded-md px-3 py-2 bg-muted/30">
        {t('bankAccounts.pageIntro')}
      </p>

      <p className="text-xs text-muted-foreground leading-relaxed border rounded-md px-3 py-2 bg-muted/30">
        {t('bankAccounts.disclaimer')}
      </p>

      <Tabs value={mainTab} onValueChange={setMainTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 gap-1 p-1 sm:inline-flex sm:w-auto">
          <TabsTrigger value="cashflow" className="text-xs sm:text-sm">
            {t('bankAccounts.tabCashFlow')}
          </TabsTrigger>
          <TabsTrigger value="profit" className="text-xs sm:text-sm">
            {t('bankAccounts.tabProfit')}
          </TabsTrigger>
          <TabsTrigger value="balances" className="text-xs sm:text-sm">
            {t('bankAccounts.tabBalances')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cashflow" className="mt-4 space-y-6">
          <p className="text-xs text-muted-foreground leading-relaxed border rounded-md px-3 py-2 bg-muted/20">
            {t('bankAccounts.cashFlowTabHelp')}
          </p>
          {flowLoadErrorBlock}
          {isLoading && !isError ? flowSkeleton : null}
          {!isLoading && !isError && cashStats ? (
            <>
              {renderThreeFlowCards(cashStats)}
              {renderBankCashSummaries(cashStats)}
              {renderMovementsTable()}
            </>
          ) : null}
          {!isLoading && !isError && !cashStats ? (
            <p className="text-sm text-muted-foreground">{t('bankAccounts.offlineStatsHint')}</p>
          ) : null}
        </TabsContent>

        <TabsContent value="profit" className="mt-4 space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed border rounded-md px-3 py-2 bg-muted/20">
            {t('bankAccounts.profitTabHelp')}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed border rounded-md px-3 py-2 bg-muted/20">
            {t('bankAccounts.profitTabInventoryNote')}
          </p>
          <Card className="glass-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t('bankAccounts.profitSnapshotTitle')}</CardTitle>
              <p className="text-sm text-muted-foreground">{t('bankAccounts.profitSnapshotSubtitle')}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed border rounded-md px-3 py-2 bg-muted/20">
                {t('bankAccounts.outflowLogicNote')}
              </p>
              <ProfitSnapshotKpis onBeforeScrollToCashFlow={goToCashFlowTab} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="balances" className="mt-4 space-y-6">
          <p className="text-xs text-muted-foreground leading-relaxed border rounded-md px-3 py-2 bg-muted/20">
            {t('bankAccounts.balancesTabHelp')}
          </p>
          <Alert>
            <AlertDescription className="text-xs leading-relaxed">
              {t('bankAccounts.balancesLedgerNote')}
            </AlertDescription>
          </Alert>
          {flowLoadErrorBlock}
          {isLoading && !isError ? flowSkeleton : null}
          {!isLoading && !isError && cashStats ? (
            <>
              {renderBalanceTopCards(cashStats)}
              {renderLedgerTable()}
              {renderBankCashSummaries(cashStats)}
            </>
          ) : null}
          {!isLoading && !isError && !cashStats ? (
            <p className="text-sm text-muted-foreground">{t('bankAccounts.offlineStatsHint')}</p>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
