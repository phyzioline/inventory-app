import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Wallet,
  Calendar,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Receipt,
  CreditCard,
  ShoppingCart,
  Loader2,
  AlertTriangle,
  Landmark,
  Users,
  Truck,
} from 'lucide-react';

export type TreasuryStatsSlice = {
  total_capital: number;
  total_receipts: number;
  total_payments: number;
  total_expenses: number;
  total_outflow: number;
  estimated_balance: number;
  purchase_paid_total: number;
};

export type TreasuryExtraRow = {
  id: string;
  labelAr: string;
  labelEn: string;
  value: number;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Non-interactive subsection title inside a column (e.g. «وارد منصات»). */
  isSection?: boolean;
  /**
   * When false, the row is contextual only (e.g. supplier AP balance). Server `total_outflow` excludes these;
   * do not add them to the cash-outflow lines when reconciling mentally.
   */
  isOutflowLine?: boolean;
  /** Optional native tooltip (e.g. disambiguate vs another screen). */
  titleHint?: string;
};

type TreasuryBoxProps = {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  /** `ref` = balance-sheet style row (not part of cash-outflow total). */
  tone: 'in' | 'out' | 'ref';
  dir: 'rtl' | 'ltr';
  titleHint?: string;
};

function InboundSectionHeading({
  label,
  dir,
  compactTop,
}: {
  label: string;
  dir: 'rtl' | 'ltr';
  compactTop?: boolean;
}) {
  return (
    <div className={cn('px-1', dir === 'rtl' ? 'text-right' : 'text-left')} role="presentation">
      <p
        className={cn(
          'text-[11px] font-semibold uppercase tracking-wide text-muted-foreground pb-0.5 border-b border-border/60',
          compactTop ? 'pt-0' : 'pt-3'
        )}
      >
        {label}
      </p>
    </div>
  );
}

const roundMoneyUi = (n: number) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
};

function TreasuryBox({ label, value, icon: Icon, onClick, tone, dir, titleHint }: TreasuryBoxProps) {
  const Chev = dir === 'rtl' ? ChevronLeft : ChevronRight;
  const shellTone =
    tone === 'in'
      ? 'border-emerald-500/25 bg-emerald-500/[0.04]'
      : tone === 'ref'
        ? 'border-border/80 bg-muted/35'
        : 'border-rose-500/25 bg-rose-500/[0.04]';
  const iconTone =
    tone === 'in'
      ? 'bg-emerald-500/15 text-emerald-600'
      : tone === 'ref'
        ? 'bg-muted text-muted-foreground'
        : 'bg-rose-500/15 text-rose-600';
  return (
    <button
      type="button"
      onClick={onClick}
      title={titleHint}
      className={cn(
        'w-full flex items-center gap-3 p-3 rounded-xl border text-start transition-colors',
        'hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        shellTone
      )}
    >
      <div className={cn('p-2.5 rounded-lg shrink-0', iconTone)}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className="text-base font-bold tabular-nums">{value.toLocaleString()} EGP</p>
      </div>
      <Chev className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
    </button>
  );
}

export function TreasuryDashboard({
  isAr,
  dir,
  stats,
  operationalNet,
  inboundRows,
  inboundDisplayedTotal,
  inboundLoading,
  approximate,
  lastUpdatedMs,
  onRefresh,
  isRefreshing,
  extraOutbound = [],
  expenseCategoryRows,
  customerShopReceivable,
  customerReceivableFromLedger,
  supplierPayablesBalance,
}: {
  isAr: boolean;
  dir: 'rtl' | 'ltr';
  stats: TreasuryStatsSlice;
  operationalNet: number;
  inboundRows: TreasuryExtraRow[];
  inboundDisplayedTotal: number;
  inboundLoading?: boolean;
  approximate?: boolean;
  lastUpdatedMs: number;
  onRefresh: () => void;
  isRefreshing: boolean;
  extraOutbound?: TreasuryExtraRow[];
  /**
   * When set, replaces the single «المصروفات» line with the same operating-expense split as the P&L tab
   * (shipping, marketing, rent, salaries, other). Omit or leave undefined to keep one aggregate expenses row from `stats`.
   */
  expenseCategoryRows?: TreasuryExtraRow[];
  /** Shop/customer receivable — when `customerReceivableFromLedger`, matches Customers page «المستحق». */
  customerShopReceivable?: number;
  /** When true, `customerShopReceivable` is from customer account-summary (not unpaid orders). */
  customerReceivableFromLedger?: boolean;
  /** Amount owed to suppliers (open payables); not the same as cash payments — shortcut to /suppliers. */
  supplierPayablesBalance?: number;
}) {
  const navigate = useNavigate();

  const inboundRowsDisplay = useMemo(() => {
    if (customerShopReceivable === undefined) {
      return inboundRows;
    }
    const lead: TreasuryExtraRow[] = [
      {
        id: 'customers_shop_receivable',
        labelAr: customerReceivableFromLedger ? 'مستحقات المحل (عملاء)' : 'طلبات المحل (غير مسددة)',
        labelEn: customerReceivableFromLedger ? 'Shop receivables (customers)' : 'Local shop orders (unpaid)',
        titleHint: isAr
          ? customerReceivableFromLedger
            ? 'مجموع «المستحق» من صفحة العملاء (فواتير العملاء − المقبوضات).'
            : 'من قائمة الطلبات: طلبات قناة «محل/متجر» بحالة بيع ولم يُسدد إجماليها بالكامل. هذا ليس رقم «المستحق» في صفحة العملاء.'
          : customerReceivableFromLedger
            ? 'Sum of «Due» from the Customers page (invoice remaining per contact).'
            : 'From orders: local/shop channel sold-like orders still unpaid. Not the Customers page «Due» total.',
        value: roundMoneyUi(customerShopReceivable),
        path: '/customers',
        icon: Users,
      },
    ];
    return [...lead, ...inboundRows];
  }, [customerReceivableFromLedger, customerShopReceivable, inboundRows, isAr]);

  const outboundRows = useMemo(() => {
    const expensesAggregate: TreasuryExtraRow = {
      id: 'expenses',
      labelAr: 'المصروفات',
      labelEn: 'Expenses',
      value: stats.total_expenses,
      path: '/expenses',
      icon: Wallet,
    };
    const payments: TreasuryExtraRow = {
      id: 'payments',
      labelAr: 'إجمالي المدفوع',
      labelEn: 'Total paid',
      titleHint: isAr
        ? 'كل المدفوعات المكتملة من بداية السجل (بدون فلتر تاريخ في الخزنة). نفس صفوف شاشة المدفوعات — إذا غيّرت التاريخ هناك يختلف الرقم. يُحسب مرة واحدة في إجمالي الصادر.'
        : 'All completed payments since the start of your ledger (treasury has no date filter). Same rows as Payments — change dates there and the KPI will differ. Counted once in total outbound.',
      value: stats.total_payments,
      path: '/finance/payments',
      icon: CreditCard,
    };

    const supplierPayablesAmt =
      supplierPayablesBalance === undefined ? null : roundMoneyUi(supplierPayablesBalance);
    const supplierReferenceBlock: TreasuryExtraRow[] =
      supplierPayablesAmt === null || supplierPayablesAmt <= 0.00001
        ? []
        : [
            {
              id: 'section_supplier_reference',
              isSection: true,
              labelAr: 'مرجعي — ليس ضمن «إجمالي الصادر»',
              labelEn: 'Reference — not in «total outbound»',
              value: 0,
              path: '',
              icon: Truck,
            },
            {
              id: 'supplier_payables',
              labelAr: 'مستحقات الموردين (ديون)',
              labelEn: 'Supplier payables',
              titleHint: isAr
                ? 'رصيد مستحق للموردين من شاشة الموردين. لا يُحسب في إجمالي الصادر أعلاه (الصادر النقدي = مصروفات + إجمالي المدفوع فقط).'
                : 'Open AP from Suppliers. Not included in total outbound above (cash outflow = expenses + total paid only).',
              value: supplierPayablesAmt,
              path: '/suppliers',
              icon: Truck,
              isOutflowLine: false,
            },
          ];

    const tail = extraOutbound.filter((r) => r.value > 0.00001);

    const split = expenseCategoryRows?.filter((r) => !r.isSection && r.value > 0.00001) ?? [];
    if (split.length === 0) {
      return [expensesAggregate, payments, ...supplierReferenceBlock, ...tail];
    }
    const singleAggregateFallback = split.length === 1 && split[0].id === 'expenses';
    const expenseBlock: TreasuryExtraRow[] = singleAggregateFallback
      ? [split[0]]
      : [
          {
            id: 'section_operating_expenses',
            labelAr: 'المصروفات التشغيلية',
            labelEn: 'Operating expenses',
            value: 0,
            path: '',
            isSection: true,
            icon: Wallet,
          },
          ...split,
        ];
    return [...expenseBlock, payments, ...supplierReferenceBlock, ...tail];
  }, [
    expenseCategoryRows,
    isAr,
    stats.total_expenses,
    stats.total_payments,
    supplierPayablesBalance,
    extraOutbound,
  ]);

  const inboundBreakdownCount = useMemo(
    () => inboundRowsDisplay.filter((r) => !r.isSection).length,
    [inboundRowsDisplay]
  );
  const outboundBreakdownCount = useMemo(
    () => outboundRows.filter((r) => !r.isSection && r.isOutflowLine !== false).length,
    [outboundRows]
  );

  const cashOutflowParts = useMemo(() => {
    const exp = roundMoneyUi(stats.total_expenses);
    const pay = roundMoneyUi(stats.total_payments);
    const sum = roundMoneyUi(exp + pay);
    const tot = roundMoneyUi(stats.total_outflow);
    return { exp, pay, sum, tot, matches: Math.abs(sum - tot) < 0.02 };
  }, [stats.total_expenses, stats.total_payments, stats.total_outflow]);

  const go = (path: string) => {
    navigate(path);
  };

  const updatedLabel = lastUpdatedMs
    ? new Date(lastUpdatedMs).toLocaleString(isAr ? 'ar-EG' : 'en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

  const netNegative = operationalNet < -0.00001;

  return (
    <div className="space-y-4" dir={dir}>
      {approximate ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
          <p>
            {isAr
              ? 'تُعرض أرقام تقريبية من بيانات الشاشة فقط (بدون تسوية مشتريات الضمنية من الخادم). افتح «الحسابات البنكية» للتأكد عند توفر الـ API.'
              : 'Showing approximate figures from this screen only (implicit purchase settlements from server unavailable). Open Bank Accounts when the API is available.'}
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        <Card className="glass-card lg:order-none order-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowDownCircle className="w-5 h-5 text-emerald-500" />
              {isAr ? 'وارد (داخل)' : 'Inbound'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {inboundLoading ? (
              <div className="flex justify-center py-8 text-muted-foreground gap-2 text-sm">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                {isAr ? 'جاري تحميل توزيع الوارد…' : 'Loading inbound breakdown…'}
              </div>
            ) : (
              inboundRowsDisplay.map((row, idx) =>
                row.isSection ? (
                  <InboundSectionHeading
                    key={row.id}
                    label={isAr ? row.labelAr : row.labelEn}
                    dir={dir}
                    compactTop={idx === 0}
                  />
                ) : (
                  <TreasuryBox
                    key={row.id}
                    label={isAr ? row.labelAr : row.labelEn}
                    value={row.value}
                    icon={row.icon}
                    tone="in"
                    dir={dir}
                    titleHint={row.titleHint}
                    onClick={() => {
                      if (row.path) go(row.path);
                    }}
                  />
                )
              )
            )}
            <Button
              type="button"
              variant="outline"
              className="w-full mt-1 gap-2"
              onClick={() => go('/finance/receipts')}
            >
              {isAr ? 'عرض كل المقبوضات' : 'View all receipts'}
              {dir === 'rtl' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </Button>
          </CardContent>
        </Card>

        <Card className="glass-card border-2 border-primary/35 order-1 lg:order-none">
          <CardContent className="pt-8 pb-8 flex flex-col items-center justify-center text-center gap-3">
            <div
              className={cn(
                'relative flex h-44 w-44 items-center justify-center rounded-full border-[3px] shadow-inner',
                netNegative
                  ? 'border-destructive/55 bg-destructive/[0.06]'
                  : 'border-primary/50 bg-primary/5'
              )}
            >
              <div
                className={cn(
                  'absolute inset-2 rounded-full border border-dashed',
                  netNegative ? 'border-destructive/25' : 'border-primary/25'
                )}
                aria-hidden
              />
              <div className="relative px-2">
                <p className="text-sm font-medium text-muted-foreground">{isAr ? 'الصافي المتاح الآن' : 'Available net now'}</p>
                <p
                  className={cn(
                    'text-3xl font-extrabold tabular-nums tracking-tight',
                    netNegative ? 'text-destructive' : 'text-primary'
                  )}
                >
                  {operationalNet.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">EGP</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground max-w-[18rem]">
              <Wallet className="w-4 h-4 shrink-0" />
              {isAr ? 'من حركة التحصيل والصرف (بدون احتساب رأس المال الأولي هنا)' : 'From collections & payouts (initial capital excluded here)'}
            </div>
            <p className="text-[11px] text-muted-foreground max-w-xs leading-relaxed">
              {isAr
                ? 'الصافي = إجمالي المقبوضات − إجمالي الصادر (إجمالي المدفوع + المصروفات). إذا كان الصادر أكبر من الوارد يظهر الصافي سالبًا (عجز نقدي).'
                : 'Net = total receipts − total outflow (total paid + expenses). If outflow exceeds receipts, net shows negative (cash shortfall).'}
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card lg:order-none order-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowUpCircle className="w-5 h-5 text-rose-500" />
              {isAr ? 'صادر (خارج)' : 'Outbound'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {outboundRows.map((row, idx) =>
              row.isSection ? (
                <InboundSectionHeading
                  key={row.id}
                  label={isAr ? row.labelAr : row.labelEn}
                  dir={dir}
                  compactTop={idx === 0}
                />
              ) : (
                <TreasuryBox
                  key={row.id}
                  label={isAr ? row.labelAr : row.labelEn}
                  value={row.value}
                  icon={row.icon}
                  tone={row.isOutflowLine === false ? 'ref' : 'out'}
                  dir={dir}
                  titleHint={row.titleHint}
                  onClick={() => {
                    if (row.path) go(row.path);
                  }}
                />
              )
            )}
            <p className="text-[10px] text-muted-foreground px-1 pt-1 leading-relaxed border-t border-border/50 mt-2">
              {isAr ? (
                <>
                  <span className="font-medium text-foreground/80">إجمالي الصادر النقدي</span> من الخادم = المصروفات (
                  {cashOutflowParts.exp.toLocaleString()}) + إجمالي المدفوع ({cashOutflowParts.pay.toLocaleString()}) ={' '}
                  <span className="tabular-nums font-medium">{cashOutflowParts.tot.toLocaleString()}</span> EGP.
                  {!cashOutflowParts.matches ? (
                    <span className="text-amber-700 dark:text-amber-300"> — فرق تقريب يرجى التحديث أو مراجعة البيانات.</span>
                  ) : null}{' '}
                  صف «مستحقات الموردين» مرجعي فقط ولا يُضاف لهذا المجموع.
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground/80">Cash outbound total</span> from server = expenses (
                  {cashOutflowParts.exp.toLocaleString()}) + total paid ({cashOutflowParts.pay.toLocaleString()}) ={' '}
                  <span className="tabular-nums font-medium">{cashOutflowParts.tot.toLocaleString()}</span> EGP.
                  {!cashOutflowParts.matches ? (
                    <span className="text-amber-700 dark:text-amber-300"> — small mismatch; refresh or review data.</span>
                  ) : null}{' '}
                  «Supplier payables» is reference only and is not added to this sum.
                </>
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full mt-1 gap-2"
              onClick={() => go('/finance/payments')}
            >
              {isAr ? 'عرض كل الصادر (المدفوعات)' : 'View all outbound (payments)'}
              {dir === 'rtl' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardContent className="p-3 sm:p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3">
              <Wallet className="w-5 h-5 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground truncate">{isAr ? 'الصافي المتاح' : 'Available net'}</p>
                <p className={cn('text-sm font-bold tabular-nums truncate', netNegative && 'text-destructive')}>{operationalNet.toLocaleString()}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3">
              <ArrowDownCircle className="w-5 h-5 text-emerald-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-muted-foreground flex items-center justify-between gap-2">
                  <span className="truncate">{isAr ? 'إجمالي الوارد (المعروض)' : 'Inbound shown'}</span>
                  <span
                    className="shrink-0 tabular-nums rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:text-emerald-200"
                    title={
                      isAr
                        ? `عدد البنود تحت الوارد: ${inboundBreakdownCount}`
                        : `Inbound line items: ${inboundBreakdownCount}`
                    }
                  >
                    {inboundBreakdownCount}
                  </span>
                </p>
                <p className="text-sm font-bold tabular-nums truncate">{inboundDisplayedTotal.toLocaleString()}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3">
              <ArrowUpCircle className="w-5 h-5 text-rose-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-muted-foreground flex items-center justify-between gap-2">
                  <span className="truncate">{isAr ? 'إجمالي الصادر' : 'Total outbound'}</span>
                  <span
                    className="shrink-0 tabular-nums rounded-md border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800 dark:text-rose-200"
                    title={
                      isAr
                        ? `عدد البنود تحت الصادر: ${outboundBreakdownCount}`
                        : `Outbound line items: ${outboundBreakdownCount}`
                    }
                  >
                    {outboundBreakdownCount}
                  </span>
                </p>
                <p className="text-sm font-bold tabular-nums truncate">{stats.total_outflow.toLocaleString()}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3">
              <Calendar className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground truncate">{isAr ? 'آخر تحديث' : 'Last updated'}</p>
                <p className="text-xs font-medium tabular-nums truncate" title={updatedLabel}>
                  {updatedLabel}
                </p>
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1 flex items-stretch">
              <Button
                type="button"
                variant="secondary"
                className="w-full gap-2 h-auto py-3"
                onClick={() => void onRefresh()}
                disabled={isRefreshing}
              >
                {isRefreshing ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <RefreshCw className="w-4 h-4" aria-hidden />}
                {isAr ? 'تحديث' : 'Refresh'}
              </Button>
            </div>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Landmark className="w-3.5 h-3.5 shrink-0" />
            {isAr
              ? '«مستحقات المحل» من صفحة العملاء. «إجمالي المدفوع» = شاشة المدفوعات (مرة واحدة). «مستحقات الموردين» مرجعي فقط. الصافي = مقبوضات − (مدفوع + مصروفات).'
              : 'Shop receivables from Customers. «Total paid» = Payments screen (once). «Supplier payables» is reference only. Net = receipts − (paid + expenses).'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
