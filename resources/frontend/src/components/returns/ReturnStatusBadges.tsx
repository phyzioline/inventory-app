import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  formatFinancialStatusLabel,
  formatPhysicalStatusLabel,
  getFinancialStatus,
  getPhysicalStatus,
  physicalStatusBadgeClass,
  type ReturnRowLike,
} from '@/components/returns/returnDisplayUtils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type Props = {
  row: ReturnRowLike;
  isAr: boolean;
  t: (key: string) => string;
  className?: string;
};

export function ReturnStatusBadges({ row, isAr, t, className }: Props) {
  const physical = getPhysicalStatus(row);
  const financial = getFinancialStatus(row);

  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>
      <Badge
        className={cn(
          'text-[9px] uppercase font-bold px-2 py-0.5 rounded whitespace-nowrap',
          physicalStatusBadgeClass(physical),
        )}
      >
        {formatPhysicalStatusLabel(row, isAr)}
      </Badge>
      {financial === 'amazon_refund' ? (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="text-[8px] px-1.5 py-0 border-blue-500/50 text-blue-700 dark:text-blue-300 cursor-help"
              >
                {formatFinancialStatusLabel(row, isAr)}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              {t('returns.financial.refundTooltip') ||
                (isAr
                  ? 'من شيت الدفع — ليس استلاماً في المستودع'
                  : 'From settlement sheet — not warehouse receipt')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </div>
  );
}

export function ReturnStatusBadgeGroup({
  rows,
  isAr,
  t,
}: {
  rows: ReturnRowLike[];
  isAr: boolean;
  t: (key: string) => string;
}) {
  const physicalLabels = Array.from(
    new Set(rows.map((r) => formatPhysicalStatusLabel(r, isAr))),
  );
  const hasFinancial = rows.some((r) => getFinancialStatus(r) === 'amazon_refund');

  return (
    <div className="flex flex-wrap gap-1 justify-center">
      {physicalLabels.slice(0, 3).map((label) => (
        <Badge key={label} className="text-[9px] uppercase px-1.5 py-0 bg-muted text-foreground">
          {label}
        </Badge>
      ))}
      {physicalLabels.length > 3 ? (
        <span className="text-[10px] text-muted-foreground">+</span>
      ) : null}
      {hasFinancial ? (
        <Badge
          variant="outline"
          className="text-[8px] px-1 py-0 border-blue-500/50 text-blue-700 dark:text-blue-300"
          title={
            t('returns.financial.refundTooltip') ||
            (isAr ? 'رد مالي من شيت الدفع' : 'Financial refund from settlement')
          }
        >
          {isAr ? 'رد مالي' : 'Refund'}
        </Badge>
      ) : null}
    </div>
  );
}
