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

export function PeriodActualProfitKpis({ startDate, endDate, enabled = true }: Props) {
  const { t, language } = useLanguage();
  const isAr = language === 'ar';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['cash-profit-snapshot', startDate, endDate],
    queryFn: () =>
      api.get('/reports/cash-profit-snapshot', {
        params: { start_date: startDate, end_date: endDate },
      }),
    enabled: enabled && Boolean(startDate && endDate && startDate <= endDate),
    staleTime: 120_000,
  });

  const totalReceipts = toNumber(data?.total_receipts);
  const totalCogs = toNumber(data?.total_cogs);
  const totalExpenses = toNumber(data?.total_expenses);
  const netProfit = toNumber(data?.net_profit);
  const linkedOrders = toNumber(data?.linked_order_count);
  const linkedUnits = toNumber(data?.linked_unit_qty);
  const cogsRatio = data?.cogs_to_receipts_pct != null ? toNumber(data.cogs_to_receipts_pct) : null;

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
        {isAr ? 'تعذّر تحميل ملخص الربح الفعلي.' : 'Could not load actual profit summary.'}
      </div>
    );
  }

  const cards = [
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
      value: totalCogs,
      icon: Package,
      iconClass: 'bg-red-500/10 text-red-500',
      valueClass: 'text-red-500',
      prefix: '−',
    },
    {
      key: 'expenses',
      label: t('profitPeriod.actualProfitExpenses'),
      value: totalExpenses,
      icon: BarChart3,
      iconClass: 'bg-orange-500/10 text-orange-500',
      valueClass: 'text-orange-500',
      prefix: '−',
    },
    {
      key: 'net',
      label: t('profitPeriod.actualProfitNet'),
      value: netProfit,
      icon: TrendingUp,
      iconClass: 'bg-primary/10 text-primary',
      valueClass: netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500',
      highlight: true,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="rounded-2xl border border-border/70 bg-gradient-to-br from-card via-card to-primary/[0.04] shadow-sm ring-1 ring-border/40 overflow-hidden"
    >
      <div className="relative px-4 py-4 sm:px-5 sm:py-5 border-b border-border/50 bg-muted/20">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-l from-primary/70 via-teal-500/50 to-transparent" />
        <h2 className="text-base sm:text-lg font-semibold text-foreground">{t('profitPeriod.actualProfitTitle')}</h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-3xl leading-relaxed">
          {t('profitPeriod.actualProfitHint')}
        </p>
        <p className="text-[11px] text-muted-foreground/90 mt-2 font-mono tabular-nums" dir="ltr">
          {formatNumber(totalReceipts)} − {formatNumber(totalCogs)} − {formatNumber(totalExpenses)} ={' '}
          <span className={netProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}>{formatNumber(netProfit)}</span> EGP
        </p>
        {linkedOrders > 0 && (
          <p className="text-[11px] text-muted-foreground mt-1">
            {isAr
              ? `تكلفة شراء المحل لـ ${formatNumber(linkedUnits, { maximumFractionDigits: 0 })} قطعة على ${formatNumber(linkedOrders, { maximumFractionDigits: 0 })} طلب/شيت مرتبط بمقبوضات الفترة.`
              : `Shop purchase cost for ${formatNumber(linkedUnits, { maximumFractionDigits: 0 })} unit(s) across ${formatNumber(linkedOrders, { maximumFractionDigits: 0 })} receipt-linked order(s)/sheet(s).`}
          </p>
        )}
        {cogsRatio != null && totalReceipts > 0 && (
          <p className="text-[11px] text-muted-foreground/90 mt-1">
            {isAr
              ? `تكلفة البضاعة ≈ ${formatNumber(cogsRatio, { maximumFractionDigits: 1 })}% من المقبوضات. ${t('profitPeriod.actualProfitCogsRatioHint')}`
              : `COGS ≈ ${formatNumber(cogsRatio, { maximumFractionDigits: 1 })}% of receipts. ${t('profitPeriod.actualProfitCogsRatioHint')}`}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 p-4 sm:p-5">
        {cards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04 }}
              className={`rounded-xl border bg-background/90 backdrop-blur-sm px-4 py-4 shadow-sm ${
                card.highlight ? 'border-primary/25 ring-1 ring-primary/10' : 'border-border/60'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`p-2.5 rounded-xl shrink-0 ${card.iconClass}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide leading-snug">
                    {card.label}
                  </p>
                  <p className={`text-xl sm:text-2xl font-bold tabular-nums mt-1 ${card.valueClass}`}>
                    {card.prefix ? `${card.prefix} ` : ''}
                    {formatNumber(card.value, { maximumFractionDigits: 0 })} EGP
                  </p>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
