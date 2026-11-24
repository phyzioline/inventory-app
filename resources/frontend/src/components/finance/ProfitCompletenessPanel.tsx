import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, Layers } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

const toNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const money = (value: unknown) => toNumber(value).toLocaleString('en-US', { maximumFractionDigits: 0 });

type Summary = {
  orders_profit?: number;
  expenses?: number;
  net_profit?: number;
  platform_account_net?: number;
  platform_account?: Record<string, { amount: number; lines: number }>;
  platform_account_scope?: string;
  orders_missing_from_system?: { orders: number; lines: number; net: number; sales: number };
  cash_transfers_excluded?: number;
  orders_before_start_archived?: { orders: number; net: number };
  uncosted_lines?: number;
  uncosted_revenue?: number;
  awaiting_platform_payment_orders?: number;
  awaiting_platform_payment_revenue?: number;
  unpaid_platform_orders?: number;
  unpaid_platform_order_value?: number;
};

const CATEGORY_ORDER = ['seller_rewards', 'reimbursements', 'shipping_credits', 'advertising', 'platform_fees'];

/**
 * How the server's net profit is built, and what it cannot include yet. Every number comes from
 * profit-summary (server); nothing is summed here except laying out the server's own parts.
 */
export function ProfitCompletenessPanel({ summary, t }: { summary: Summary | undefined; t: (key: string) => string }) {
  const { data: sheets, isError: sheetsError } = useQuery({
    queryKey: ['settlements', 'incomplete-count'],
    queryFn: async () => (await api.get('/settlements', { params: { per_page: 1 } })) as { incomplete_sheets?: { count: number; gap_total: number } },
    staleTime: 120_000,
  });

  if (!summary) return null;

  const platform = summary.platform_account ?? {};
  const missing = summary.orders_missing_from_system;
  const incomplete = sheets?.incomplete_sheets;
  const warnings: { key: string; text: string; amount: number; to?: string }[] = [];

  if (incomplete && incomplete.count > 0) {
    warnings.push({ key: 'sheets', text: t('profit.complete.incompleteSheets').replace(':n', String(incomplete.count)), amount: incomplete.gap_total, to: '/reconciliation' });
  }
  if (missing && missing.orders > 0) {
    warnings.push({ key: 'missing', text: t('profit.complete.missingOrders').replace(':n', money(missing.orders)), amount: missing.sales });
  }
  if (toNumber(summary.uncosted_lines) > 0) {
    warnings.push({ key: 'uncosted', text: t('profit.complete.uncosted').replace(':n', money(summary.uncosted_lines)), amount: toNumber(summary.uncosted_revenue) });
  }
  if (toNumber(summary.unpaid_platform_orders) > 0) {
    warnings.push({ key: 'unpaid', text: t('profit.complete.unpaid').replace(':n', money(summary.unpaid_platform_orders)), amount: toNumber(summary.unpaid_platform_order_value) });
  }
  if (toNumber(summary.awaiting_platform_payment_orders) > 0) {
    warnings.push({ key: 'awaiting', text: t('profit.complete.awaiting').replace(':n', money(summary.awaiting_platform_payment_orders)), amount: toNumber(summary.awaiting_platform_payment_revenue) });
  }

  const categories = CATEGORY_ORDER.filter((c) => platform[c]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="rounded-xl border border-border p-4 space-y-2">
        <div className="flex items-center gap-2 font-semibold">
          <Layers className="h-4 w-4" />
          {t('profit.complete.buildTitle')}
        </div>
        <Row label={t('profit.complete.ordersProfit')} value={summary.orders_profit} />
        <Row label={t('profit.complete.platformNet')} value={summary.platform_account_net} />
        {summary.platform_account_scope === 'excluded_by_account_filter' ? (
          <p className="text-xs text-muted-foreground ps-4">{t('profit.complete.accountFilter')}</p>
        ) : categories.length === 0 ? (
          <p className="text-xs text-muted-foreground ps-4">{t('profit.complete.noPlatformLines')}</p>
        ) : (
          categories.map((c) => (
            <Row key={c} label={t(`profit.complete.cat.${c}`)} value={platform[c].amount} sub />
          ))
        )}
        <Row label={t('profit.complete.expenses')} value={-toNumber(summary.expenses)} />
        <div className="border-t border-border pt-2">
          <Row label={t('profit.complete.netProfit')} value={summary.net_profit} strong />
        </div>
        {toNumber(summary.cash_transfers_excluded) !== 0 && (
          <p className="text-xs text-muted-foreground">
            {t('profit.complete.transfersExcluded')} <span dir="ltr">{money(summary.cash_transfers_excluded)}</span>
          </p>
        )}
        <p className="text-xs text-muted-foreground">{t('profit.complete.adsNote')}</p>
      </div>

      <div className={cn('rounded-xl border p-4 space-y-2', warnings.length > 0 ? 'border-amber-500/50 bg-amber-500/5' : 'border-border')}>
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className={cn('h-4 w-4', warnings.length > 0 && 'text-amber-600')} />
          {t('profit.complete.gapsTitle')}
        </div>
        {warnings.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('profit.complete.noGaps')}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {warnings.map((w) => (
              <li key={w.key} className="flex items-start justify-between gap-3">
                <span>
                  {w.to ? <Link to={w.to} className="underline underline-offset-2">{w.text}</Link> : w.text}
                </span>
                <span className="font-semibold whitespace-nowrap" dir="ltr">{money(w.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {toNumber(summary.orders_before_start_archived?.orders) > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('profit.complete.archived').replace(':n', money(summary.orders_before_start_archived?.orders))}{' '}
            <span dir="ltr">{money(summary.orders_before_start_archived?.net)}</span>
          </p>
        )}
        {sheetsError && <p className="text-xs text-destructive">{t('profit.complete.sheetsError')}</p>}
        <p className="text-xs text-muted-foreground">{t('profit.complete.gapsNote')}</p>
      </div>
    </div>
  );
}

function Row({ label, value, sub, strong }: { label: string; value: unknown; sub?: boolean; strong?: boolean }) {
  const n = toNumber(value);
  return (
    <div className={cn('flex items-center justify-between text-sm', sub && 'ps-4 text-muted-foreground', strong && 'font-bold text-base')}>
      <span>{label}</span>
      <span dir="ltr" className={cn(n < 0 && 'text-red-600 dark:text-red-400')}>{money(n)}</span>
    </div>
  );
}
