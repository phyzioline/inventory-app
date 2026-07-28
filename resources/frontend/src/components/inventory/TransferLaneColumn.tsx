import { useState } from 'react';
import { Clock, Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { TransferBatch } from '@/lib/transferBatchUtils';
import type { TransferLane } from '@/lib/transferLanes';
import { TransferShipmentRow } from '@/components/inventory/TransferShipmentRow';

interface TransferLaneColumnProps {
  lane: TransferLane;
  batches: TransferBatch[];
  isAr: boolean;
  t: (key: string) => string;
  txById: Map<string, any>;
  onOpenBatch: (batch: TransferBatch) => void;
  onEditItem?: (txId: string) => void;
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
  txById,
  onOpenBatch,
  onEditItem,
  resolveLocationName,
  layout = 'row',
}: TransferLaneColumnProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
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
        : 'max-h-[220px]'
      : 'max-h-[min(52vh,520px)]'
    : isCompact
      ? 'max-h-[220px]'
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
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-8" />
            <TableHead className={cn('text-xs', isCompact ? 'min-w-[120px]' : 'min-w-[160px]')}>
              {isAr ? 'رقم الشحنة' : 'Shipment #'}
            </TableHead>
            {!isCompact && (
              <TableHead className="w-[100px] text-xs">{isAr ? 'الحالة' : 'Status'}</TableHead>
            )}
            <TableHead className={cn('text-xs', isCompact ? 'w-[100px]' : 'w-[130px]')}>
              {t('common.date')}
            </TableHead>
            {!isCompact && (
              <TableHead className="w-[90px] text-xs">{isAr ? 'الشحن إلى' : 'Ship to'}</TableHead>
            )}
            <TableHead className={cn('text-xs text-center', isCompact ? 'w-[70px]' : 'w-[80px]')}>
              {isAr ? 'SKU' : 'SKUs'}
            </TableHead>
            <TableHead className={cn('text-xs text-center', isCompact ? 'w-[70px]' : 'w-[80px]')}>
              {isAr ? 'الوحدات' : 'Units'}
            </TableHead>
            <TableHead className="w-[90px] text-center text-xs">{isAr ? 'عرض' : 'View'}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((batch, index) => (
            <TransferShipmentRow
              key={batch.key}
              batch={batch}
              isAr={isAr}
              isCompact={isCompact}
              isLatest={index === 0}
              isOpen={expandedKey === batch.key}
              t={t}
              txById={txById}
              resolveLocationName={resolveLocationName}
              onToggle={() => setExpandedKey(expandedKey === batch.key ? null : batch.key)}
              onOpenBatch={onOpenBatch}
              onEditItem={onEditItem}
              formatRelativeTime={formatRelativeTime}
            />
          ))}
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
