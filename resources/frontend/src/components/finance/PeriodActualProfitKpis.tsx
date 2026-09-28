import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Loader2, Package, TrendingUp, Wallet } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import api from '@/lib/api';

const toNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const formatNumber = (value: unknown, options?: Intl.NumberFormatOptions) =>
  toNumber(value).toLocaleString('en-US', options);

type Props = {
  startDate: string;
  endDate: string;
  enabled?: boolean;
};

/**
 * Period KPIs: official accrual net profit (profit-summary) + separate cash-period strip.
 */
export function PeriodActualProfitKpis({ startDate, endDate, enabled = true }: Props) {
  const { t, language } = useLanguage();
  const isAr = language === 'ar';
  const rangeOk = enabled && Boolean(startDate && endDate && startDate <= endDate);

  const { data: official, isLoading: loadingOfficial, isError: errorOfficial } = useQuery({
    queryKey: ['profit-summary', 'period-kpis', startDate, endDate],
    queryFn: () =>
      api.get('/reports/profit-summary', {
        params: { start_date: startDate, end_date: endDate },
      }),
    enabled: rangeOk,
    staleTime: 120_000,
  });

  const { data: cash, isLoading: loadingCash, isError: errorCash } = useQuery({
    queryKey: ['cash-profit-snapshot', startDate, endDate],
    queryFn: () =>
      api.get('/reports/cash-profit-snapshot', {
        params: { start_date: startDate, end_date: endDate },
      }),
    enabled: rangeOk,
    staleTime: 120_000,
  });

  const isLoading = loadingOfficial || loadingCash;
  const isError = errorOfficial && errorCash;

  const officialNet = toNumber(
    (official as any)?.net_profit ?? (official as any)?.summary?.net_profit ?? 0
  );
  const officialRevenue = toNumber(
    (official as any)?.revenue ?? (official as any)?.total_revenue ?? 0
  );
  const officialCogs = toNumber((official as any)?.cogs ?? (official as any)?.total_cogs ?? 0);
  const officialExpenses = toNumber(
    (official as any)?.expenses ?? (official as any)?.total_expenses ?? 0
  );
  const officialRefunds = toNumber((official as any)?.refunds ?? 0);

  const totalReceipts = toNumber(cash?.total_receipts);
  const cashCogs = toNumber(cash?.total_cogs);
  const cashExpenses = toNumber(cash?.total_expenses);
  const cashResult = toNumber(cash?.cash_period_result ?? cash?.net_profit);
  const linkedOrders = toNumber(cash?.linked_order_count);
  const linkedUnits = toNumber(cash?.linked_unit_qty);
  const cogsRatio = cash?.cogs_to_receipts_pct != null ? toNumber(cash.cogs_to_receipts_pct) : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[120px] rounded-2xl border border-border/60 bg-card/50">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {isAr ? 'تعذّر تحميل ملخص أرباح الفترة.' : 'Could not load period profit summary.'}
      </div>
    );
  }

  const officialCards = [
    {
      key: 'revenue',
      label: t('profitPeriod.officialRevenue'),
      value: officialRevenue,
      icon: Wallet,
      iconClass: 'bg-emerald-500/10 text-emerald-600',
      valueClass: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      key: 'cogs',
      label: t('profitPeriod.officialCogs'),
      value: officialCogs,
      icon: Package,
      iconClass: 'bg-red-500/10 text-red-500',
      valueClass: 'text-red-500',
      prefix: '−',
    },
    {
      key: 'expenses',
      label: t('profitPeriod.officialExpenses'),
      value: officialExpenses + officialRefunds,
      icon: BarChart3,
      iconClass: 'bg-orange-500/10 text-orange-500',
      valueClass: 'text-orange-500',
      prefix: '−',
      hint: officialRefunds > 0
        ? (isAr ? `يشمل مرتجعات ${formatNumber(officialRefunds)}` : `incl. refunds ${formatNumber(officialRefunds)}`)
        : undefined,
    },
    {
      key: 'net',
      label: t('profitPeriod.officialNet'),
      value: officialNet,
      icon: TrendingUp,
      iconClass: 'bg-primary/10 text-primary',
      valueClass: officialNet >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500',
      highlight: true,
    },
  ];

  const cashCards = [
    {
      key: 'receipts',
      label: t('profitPeriod.actualProfitReceipts'),
      value: totalReceipts,
      icon: Wallet,
      iconClass: 'bg-emerald-500/10 text-emerald-600',
      valueClass: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      key: 'cogs',
      label: t('profitPeriod.actualProfitCogs'),
      value: cashCogs,
      icon: Package,
      iconClass: 'bg-red-500/10 text-red-500',
      valueClass: 'text-red-500',
      prefix: '−',
    },
    {
      key: 'expenses',
      label: t('profitPeriod.actualProfitExpenses'),
      value: cashExpenses,
      icon: BarChart3,
      iconClass: 'bg-orange-500/10 text-orange-500',
      valueClass: 'text-orange-500',
      prefix: '−',
    },
    {
      key: 'cash',
      label: t('profitPeriod.cashPeriodResult'),
      value: cashResult,
      icon: TrendingUp,
      iconClass: 'bg-teal-500/10 text-teal-600',
      valueClass: cashResult >= 0 ? 'text-teal-600 dark:text-teal-400' : 'text-red-500',
      highlight: true,
    },
  ];

  const renderCards = (cards: typeof officialCards) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 p-4 sm:p-5">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.key}
            className={`rounded-xl border px-4 py-3 ${
              card.highlight ? 'border-primary/30 bg-primary/5' : 'border-border/60 bg-card/80'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className={`p-2 rounded-lg ${card.iconClass}`}>
                <Icon className="w-4 h-4" />
              </div>
              <p className="text-xs text-muted-foreground leading-snug">{card.label}</p>
            </div>
            <p className={`text-xl sm:text-2xl font-bold tabular-nums ${card.valueClass}`}>
              {card.prefix || ''}
              {formatNumber(card.value)} <span className="text-sm font-medium text-muted-foreground">EGP</span>
            </p>
            {'hint' in card && card.hint ? (
              <p className="text-[10px] text-muted-foreground mt-1">{card.hint}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-2xl border border-border/70 bg-gradient-to-br from-card via-card to-primary/[0.04] shadow-sm ring-1 ring-border/40 overflow-hidden"
      >
        <div className="relative px-4 py-4 sm:px-5 sm:py-5 border-b border-border/50 bg-muted/20">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-l from-primary/70 via-teal-500/50 to-transparent" />
          <h2 className="text-base sm:text-lg font-semibold text-foreground">{t('profitPeriod.officialTitle')}</h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-3xl leading-relaxed">
            {t('profitPeriod.officialHint')}
          </p>
          {!errorOfficial && (
            <p className="text-[11px] text-muted-foreground/90 mt-2 font-mono tabular-nums" dir="ltr">
              {formatNumber(officialRevenue)} − {formatNumber(officialCogs)} − {formatNumber(officialExpenses + officialRefunds)} ={' '}
              <span className={officialNet >= 0 ? 'text-emerald-600' : 'text-red-500'}>{formatNumber(officialNet)}</span> EGP
            </p>
          )}
        </div>
        {!errorOfficial && renderCards(officialCards)}
        {errorOfficial && (
          <p className="px-4 py-3 text-sm text-destructive">
            {isAr ? 'تعذّر تحميل صافي الربح الرسمي.' : 'Could not load official net profit.'}
          </p>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.05 }}
        className="rounded-2xl border border-border/60 bg-card/60 overflow-hidden"
      >
        <div className="px-4 py-3 sm:px-5 border-b border-border/40 bg-muted/10">
          <h3 className="text-sm font-semibold text-foreground">{t('profitPeriod.actualProfitTitle')}</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-3xl leading-relaxed">
            {t('profitPeriod.actualProfitHint')}
          </p>
          {!errorCash && (
            <p className="text-[11px] text-muted-foreground/90 mt-2 font-mono tabular-nums" dir="ltr">
              {formatNumber(totalReceipts)} − {formatNumber(cashCogs)} − {formatNumber(cashExpenses)} ={' '}
              <span className={cashResult >= 0 ? 'text-teal-600' : 'text-red-500'}>{formatNumber(cashResult)}</span> EGP
            </p>
          )}
          {!errorCash && linkedOrders > 0 && (
            <p className="text-[11px] text-muted-foreground mt-1">
              {isAr
                ? `تكلفة شراء المحل لـ ${formatNumber(linkedUnits, { maximumFractionDigits: 0 })} قطعة على ${formatNumber(linkedOrders, { maximumFractionDigits: 0 })} طلب/شيت مرتبط بمقبوضات الفترة.`
                : `Shop purchase cost for ${formatNumber(linkedUnits, { maximumFractionDigits: 0 })} unit(s) across ${formatNumber(linkedOrders, { maximumFractionDigits: 0 })} receipt-linked order(s)/sheet(s).`}
              {cogsRatio != null
                ? ` ${t('profitPeriod.actualProfitCogsRatioHint')} (${formatNumber(cogsRatio)}%)`
                : ''}
            </p>
          )}
        </div>
        {!errorCash && renderCards(cashCards)}
        {errorCash && (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            {isAr ? 'تعذّر تحميل الملخص النقدي.' : 'Could not load cash period summary.'}
          </p>
        )}
      </motion.div>
    </div>
  );
}
