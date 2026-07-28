import {
  Calendar,
  Clock,
  Eye,
  Package,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { TransferBatch } from '@/lib/transferBatchUtils';
import { resolveProductLabel } from '@/lib/transferBatchUtils';
import { parseBatchShipmentLabel } from '@/lib/transferBatchPreview';
import type { TransferLane } from '@/lib/transferLanes';

interface TransferLaneColumnProps {
  lane: TransferLane;
  batches: TransferBatch[];
  isAr: boolean;
  t: (key: string) => string;
  onOpenBatch: (batch: TransferBatch) => void;
  resolveLocationName: (id: string) => string;
  layout?: 'column' | 'row';
}

function formatRelativeTime(date: Date, isAr: boolean): string {
  const diffMs = Date.now() - date.getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return '';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return isAr ? 'الآن' : 'Just now';
  if (mins < 60) return isAr ? `منذ ${mins} د` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return isAr ? `منذ ${hours} س` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return isAr ? `منذ ${days} ي` : `${days}d ago`;
}

export function TransferLaneColumn({
  lane,
  batches,
  isAr,
  t,
  onOpenBatch,
  resolveLocationName,
  layout = 'row',
}: TransferLaneColumnProps) {
  const isCompact = lane.sizeTier === 'compact';
  const isRow = layout === 'row';
  const title = isAr ? lane.titleAr : lane.titleEn;
  const totalQty = batches.reduce((sum, b) => sum + Number(b.totalQty || 0), 0);
  const latest = batches[0];
  const latestDate = latest ? new Date(latest.created_at || 0) : null;
  const latestLabel =
    latestDate && !Number.isNaN(latestDate.getTime())
      ? latestDate.toLocaleString(isAr ? 'ar-EG' : 'en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';

  const tableMaxHeight = isRow
    ? isCompact
      ? batches.length === 0
        ? undefined
        : 'max-h-[180px]'
      : 'max-h-[min(42vh,420px)]'
    : isCompact
      ? 'max-h-[200px]'
      : 'max-h-[calc(100vh-320px)]';

  const header = (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3',
        isRow ? 'w-full' : 'flex-col items-start',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <CardTitle className={cn('font-bold leading-snug', isRow ? 'text-base' : 'text-sm')}>
          {title}
        </CardTitle>
        <Badge variant="secondary" className="shrink-0 tabular-nums">
          {batches.length}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Package className="h-3.5 w-3.5" />
          {totalQty.toLocaleString()} {t('sales.qty')}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          {t('transfers.lane.lastUpload')}: {latestLabel}
        </span>
      </div>
    </div>
  );

  const tableContent =
    batches.length === 0 ? (
      <div
        className={cn(
          'text-center text-sm text-muted-foreground',
          isCompact ? 'px-4 py-6' : 'px-4 py-10',
        )}
      >
        {t('transfers.lane.empty')}
      </div>
    ) : (
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead className="w-8" />
            <TableHead className={cn(isCompact ? 'w-[110px]' : 'w-[130px]', 'text-xs')}>
              {t('common.date')}
            </TableHead>
            <TableHead className={cn(isCompact ? 'w-[120px]' : 'w-[150px]', 'text-xs')}>
              {isAr ? 'رقم الشحنة' : 'Shipment #'}
            </TableHead>
            <TableHead className="text-xs">{t('table.product')}</TableHead>
            <TableHead className={cn('text-xs text-end', isCompact ? 'w-[72px]' : 'w-[88px]')}>
              {t('sales.qty')}
            </TableHead>
            {!isCompact && <TableHead className="w-[min(180px,18vw)] text-xs">{t('adjustments.notes')}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((batch, index) => {
            const createdAt = new Date(batch.created_at || 0);
            const isLatest = index === 0;
            const shipmentLabel = parseBatchShipmentLabel(batch);
            const toName =
              batch.direction === 'IN'
                ? batch.location?.name || ''
                : resolveLocationName(batch.toLocationId);

            return (
              <TableRow
                key={batch.key}
                className={cn(
                  'cursor-pointer hover:bg-muted/50',
                  isLatest && 'bg-primary/5 hover:bg-primary/10',
                  isCompact && 'text-xs',
                )}
                onClick={() => onOpenBatch(batch)}
                title={isAr ? 'اضغط لمعاينة التحويل' : 'Click to preview transfer'}
              >
                <TableCell className="px-2">
                  <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                </TableCell>
                <TableCell className={cn('py-2', isCompact && 'py-1.5')}>
                  <div className="flex items-center gap-1 text-xs font-medium">
                    <Calendar className="h-3 w-3 text-muted-foreground" />
                    {Number.isNaN(createdAt.getTime())
                      ? '—'
                      : createdAt.toLocaleDateString(isAr ? 'ar-EG' : 'en-US')}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {Number.isNaN(createdAt.getTime())
                      ? ''
                      : createdAt.toLocaleTimeString(isAr ? 'ar-EG' : 'en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                    {isLatest && (
                      <Badge variant="outline" className="ms-1 h-4 px-1 text-[9px]">
                        {t('transfers.lane.latest')}
                      </Badge>
                    )}
                  </div>
                  {!isCompact && !Number.isNaN(createdAt.getTime()) && (
                    <div className="text-[10px] text-muted-foreground/80">
                      {formatRelativeTime(createdAt, isAr)}
                    </div>
                  )}
                </TableCell>
                <TableCell className={cn('py-2 font-mono text-[10px]', isCompact && 'py-1.5')}>
                  <span className="line-clamp-2 font-semibold" title={shipmentLabel}>
                    {shipmentLabel}
                  </span>
                </TableCell>
                <TableCell className={cn('py-2', isCompact && 'py-1.5')}>
                  <span className="text-xs font-semibold">
                    {batch.items.length} {t('table.product')}
                  </span>
                  <p
                    className={cn(
                      'text-[10px] leading-snug text-muted-foreground',
                      isCompact ? 'line-clamp-1' : 'line-clamp-2',
                    )}
                  >
                    {batch.items
                      .slice(0, isCompact ? 1 : 2)
                      .map((tx) => `${tx.sku?.sku || '-'} · ${resolveProductLabel(tx)}`)
                      .join(' ، ')}
                    {batch.items.length > (isCompact ? 1 : 2)
                      ? ` +${batch.items.length - (isCompact ? 1 : 2)}`
                      : ''}
                  </p>
                  {toName ? (
                    <p className="mt-0.5 text-[10px] text-muted-foreground/80 truncate">{toName}</p>
                  ) : null}
                </TableCell>
                <TableCell className={cn('py-2 text-end', isCompact && 'py-1.5')}>
                  <Badge variant="outline" className="px-1.5 py-0 text-xs font-bold tabular-nums">
                    {batch.totalQty}
                  </Badge>
                </TableCell>
                {!isCompact && (
                  <TableCell className="max-w-[180px] truncate py-2 text-[10px] text-muted-foreground">
                    {batch.userNotes || '—'}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );

  if (isRow) {
    return (
      <Card
        className={cn(
          'overflow-hidden border-s-4 shadow-sm',
          lane.accentClass.replace('border-t-', 'border-s-'),
          isCompact && 'shadow-none',
        )}
      >
        <CardHeader className={cn('py-3', lane.headerBgClass)}>{header}</CardHeader>
        <CardContent className={cn('min-h-0 overflow-auto p-0', tableMaxHeight)}>{tableContent}</CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('flex min-h-0 flex-col border-t-4 shadow-sm', lane.accentClass)}>
      <CardHeader className={cn('space-y-2 pb-3', lane.headerBgClass)}>{header}</CardHeader>
      <CardContent className={cn('min-h-0 flex-1 overflow-auto p-0', tableMaxHeight)}>{tableContent}</CardContent>
    </Card>
  );
}
