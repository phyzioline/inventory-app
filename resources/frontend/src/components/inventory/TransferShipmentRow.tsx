import { Fragment, useMemo } from 'react';
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { TransferBatch } from '@/lib/transferBatchUtils';
import { buildBatchFbaSummary, getBatchShipmentMeta } from '@/lib/transferBatchPreview';
import { TransferBatchSummaryTable } from '@/components/inventory/TransferBatchSummaryTable';

type ShipmentRowProps = {
  batch: TransferBatch;
  isAr: boolean;
  isCompact: boolean;
  isLatest: boolean;
  isOpen: boolean;
  t: (key: string) => string;
  txById: Map<string, any>;
  resolveLocationName: (id: string) => string;
  onToggle: () => void;
  onOpenBatch: (batch: TransferBatch) => void;
  onEditItem?: (txId: string) => void;
  formatRelativeTime: (date: Date, isAr: boolean) => string;
};

export function TransferShipmentRow({
  batch,
  isAr,
  isCompact,
  isLatest,
  isOpen,
  t,
  txById,
  resolveLocationName,
  onToggle,
  onOpenBatch,
  onEditItem,
  formatRelativeTime,
}: ShipmentRowProps) {
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  const meta = getBatchShipmentMeta(batch);
  const createdAt = new Date(batch.created_at || 0);
  const toName =
    batch.direction === 'IN'
      ? batch.location?.name || ''
      : resolveLocationName(batch.toLocationId);
  const shipTo = meta.shipToFc || toName || '—';

  const dateLabel = Number.isNaN(createdAt.getTime())
    ? '—'
    : createdAt.toLocaleDateString(isAr ? 'ar-EG' : 'en-US');
  const timeLabel = Number.isNaN(createdAt.getTime())
    ? ''
    : createdAt.toLocaleTimeString(isAr ? 'ar-EG' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });

  const summary = useMemo(() => {
    if (!isOpen) return null;
    return buildBatchFbaSummary(batch, resolveLocationName, txById, isAr);
  }, [isOpen, batch, resolveLocationName, txById, isAr]);

  const mainRow = (
    <TableRow
      className={cn(
        'cursor-pointer hover:bg-muted/50',
        isLatest && 'bg-primary/5 hover:bg-primary/10',
        isOpen && 'bg-muted/30',
        isCompact && 'text-xs',
      )}
      onClick={onToggle}
    >
      <TableCell className="px-2">
        <Chevron className="h-4 w-4 text-muted-foreground" />
      </TableCell>
      <TableCell className={cn('py-2', isCompact && 'py-1.5')}>
        <div className="font-mono text-[11px] font-semibold leading-snug" title={meta.shipmentId}>
          {meta.shipmentId}
        </div>
        {meta.isFba ? (
          <Badge variant="outline" className="mt-0.5 h-4 px-1 text-[9px]">
            FBA
          </Badge>
        ) : null}
      </TableCell>
      {!isCompact && (
        <TableCell className="py-2">
          <Badge className="h-5 gap-1 bg-green-600 px-1.5 text-[10px] hover:bg-green-600">
            <CheckCircle2 className="h-3 w-3" />
            {isAr ? 'تم التحويل' : 'Transferred'}
          </Badge>
        </TableCell>
      )}
      <TableCell className={cn('py-2', isCompact && 'py-1.5')}>
        <div className="flex items-center gap-1 text-xs font-medium">
          <Calendar className="h-3 w-3 text-muted-foreground" />
          {dateLabel}
        </div>
        {timeLabel ? (
          <div className="text-[10px] text-muted-foreground">
            {timeLabel}
            {isLatest && !isCompact ? (
              <Badge variant="outline" className="ms-1 h-4 px-1 text-[9px]">
                {t('transfers.lane.latest')}
              </Badge>
            ) : null}
          </div>
        ) : null}
        {!isCompact && !Number.isNaN(createdAt.getTime()) ? (
          <div className="text-[10px] text-muted-foreground/80">
            {formatRelativeTime(createdAt, isAr)}
          </div>
        ) : null}
      </TableCell>
      {!isCompact && (
        <TableCell className="py-2 font-mono text-[11px] font-medium">{shipTo}</TableCell>
      )}
      <TableCell className="py-2 text-center">
        <span className="font-mono text-xs font-semibold text-primary">{meta.skuCount}</span>
      </TableCell>
      <TableCell className="py-2 text-center">
        <Badge variant="outline" className="px-1.5 py-0 text-xs font-bold tabular-nums">
          {meta.totalUnits}
        </Badge>
      </TableCell>
      <TableCell className="py-2 text-center">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-[10px]"
          onClick={(e) => {
            e.stopPropagation();
            onOpenBatch(batch);
          }}
        >
          <Eye className="h-3 w-3" />
          {isAr ? 'عرض' : 'View'}
        </Button>
      </TableCell>
    </TableRow>
  );

  if (!isOpen || !summary) {
    return mainRow;
  }

  return (
    <Fragment>
      {mainRow}
      <TableRow className="bg-muted/10 hover:bg-muted/10">
        <TableCell colSpan={isCompact ? 6 : 8} className="p-2 sm:p-3">
          <TransferBatchSummaryTable summary={summary} isAr={isAr} onEditRow={onEditItem} />
        </TableCell>
      </TableRow>
    </Fragment>
  );
}
