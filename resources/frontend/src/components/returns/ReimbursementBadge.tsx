import { Badge } from '@/components/ui/badge';
import {
  resolveReimbursementDisplay,
  resolveRowReimbursementDisplay,
} from '@/components/returns/returnReimbursementUtils';

type Props = {
  rows: Record<string, unknown>[];
  isAr: boolean;
  t: (key: string) => string;
  /** group = aggregate multiple rows; row = single row */
  mode?: 'group' | 'row';
};

export function ReimbursementBadge({ rows, isAr, t, mode = 'group' }: Props) {
  const resolved =
    mode === 'row' && rows[0]
      ? resolveRowReimbursementDisplay(rows[0])
      : resolveReimbursementDisplay(rows);

  if (resolved.display === 'none') {
    return <span className="text-muted-foreground">—</span>;
  }

  if (resolved.display === 'paid') {
    return (
      <Badge className="bg-sky-600 text-white text-[9px]">
        {t('returns.reimbursement.claimPaid') || 'Reimbursement received'}
      </Badge>
    );
  }

  if (resolved.display === 'ready') {
    return (
      <Badge className="bg-emerald-600 text-white text-[9px]">
        {t('returns.reimbursement.ready') || 'Ready to claim'}
      </Badge>
    );
  }

  if (resolved.display === 'pending') {
    if (resolved.daysLeft != null && resolved.daysLeft > 0) {
      return (
        <Badge className="bg-amber-500 text-white text-[9px]">
          {isAr ? `انتظر ${resolved.daysLeft} يوم` : `Wait ${resolved.daysLeft} days`}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-[9px] border-amber-500 text-amber-700 dark:text-amber-400">
        {t('returns.reimbursement.pending') || 'Awaiting window'}
      </Badge>
    );
  }

  return <span className="text-muted-foreground">—</span>;
}
