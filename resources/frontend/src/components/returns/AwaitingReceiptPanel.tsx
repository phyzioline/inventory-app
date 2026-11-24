import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type AwaitingRow = {
  id: number;
  order_number: string | null;
  channel: string | null;
  sku_code: string | null;
  quantity: number;
  refund_amount: number;
  refunded_at: string | null;
  days_waiting: number | null;
  settlement_report_id: string | null;
};

type AwaitingPayload = {
  data: AwaitingRow[];
  current_page: number;
  last_page: number;
  total: number;
  summary: {
    count: number;
    units: number;
    refund_total: number;
    overdue: number;
    overdue_days: number;
    by_month: { month: string; count: number; refund_total: number }[];
  };
};

const money = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

/**
 * Refunded by the platform, never received into stock. Totals come from the server —
 * never summed from the visible page.
 */
export function AwaitingReceiptPanel({ t }: { t: (key: string) => string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['returns', 'awaiting-receipt', page],
    queryFn: async () => (await api.get('returns/awaiting-receipt', { params: { page, per_page: 50 } })) as unknown as AwaitingPayload,
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-6">{t('common.loading')}</p>;
  }
  if (isError || !data) {
    return <p className="text-sm text-destructive py-6">{t('returns.awaiting.error')}</p>;
  }

  const s = data.summary;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('returns.awaiting.explain')}</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label={t('returns.awaiting.count')} value={money(s.count)} />
        <Stat label={t('returns.awaiting.refundTotal')} value={money(s.refund_total)} />
        <Stat
          label={t('returns.awaiting.overdue').replace(':days', String(s.overdue_days))}
          value={money(s.overdue)}
          tone={s.overdue > 0 ? 'warn' : undefined}
        />
        <Stat label={t('returns.awaiting.units')} value={money(s.units)} />
      </div>

      {s.by_month.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {s.by_month.map((m) => (
            <span key={m.month} className="rounded-md border border-border px-2 py-1 text-xs">
              <span dir="ltr">{m.month}</span> · {money(m.count)} · <span dir="ltr">{money(m.refund_total)}</span>
            </span>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-start">
              <th className="py-2 px-3 text-start">{t('returns.awaiting.order')}</th>
              <th className="py-2 px-3 text-start">SKU</th>
              <th className="py-2 px-3 text-start">{t('returns.awaiting.channel')}</th>
              <th className="py-2 px-3 text-start">{t('returns.awaiting.refundedAt')}</th>
              <th className="py-2 px-3 text-start">{t('returns.awaiting.days')}</th>
              <th className="py-2 px-3 text-start">{t('returns.awaiting.amount')}</th>
              <th className="py-2 px-3 text-start">{t('returns.awaiting.sheet')}</th>
            </tr>
          </thead>
          <tbody>
            {data.data.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-muted-foreground">{t('returns.awaiting.empty')}</td>
              </tr>
            ) : (
              data.data.map((r) => {
                const overdue = (r.days_waiting ?? 0) >= s.overdue_days;
                return (
                  <tr key={r.id} className={cn('border-t border-border', overdue && 'bg-amber-500/10')}>
                    <td className="py-2 px-3" dir="ltr">{r.order_number ?? '—'}</td>
                    <td className="py-2 px-3" dir="ltr">{r.sku_code ?? '—'}</td>
                    <td className="py-2 px-3">{r.channel ?? '—'}</td>
                    <td className="py-2 px-3" dir="ltr">{r.refunded_at ?? '—'}</td>
                    <td className={cn('py-2 px-3', overdue && 'font-semibold text-amber-800 dark:text-amber-300')}>{r.days_waiting ?? '—'}</td>
                    <td className="py-2 px-3" dir="ltr">{money(r.refund_amount)}</td>
                    <td className="py-2 px-3" dir="ltr">{r.settlement_report_id ?? '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {data.last_page > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('common.previous')}
          </button>
          <span dir="ltr">{data.current_page} / {data.last_page}</span>
          <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={page >= data.last_page} onClick={() => setPage((p) => p + 1)}>
            {t('common.next')}
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className={cn('rounded-xl border border-border p-3', tone === 'warn' && 'border-amber-500/50 bg-amber-500/10')}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold" dir="ltr">{value}</div>
    </div>
  );
}
