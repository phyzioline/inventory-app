import { Fragment } from 'react';
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock,
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
import type { TransferLane } from '@/lib/transferLanes';

interface TransferLaneColumnProps {
  lane: TransferLane;
  batches: TransferBatch[];
  isAr: boolean;
  t: (key: string) => string;
  expandedBatches: Record<string, boolean>;
  onToggleBatch: (key: string) => void;
  onSelectTransfer: (id: string) => void;
  resolveLocationName: (id: string) => string;
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
  expandedBatches,
  onToggleBatch,
  onSelectTransfer,
  resolveLocationName,
}: TransferLaneColumnProps) {
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

  return (
    <Card className={cn('flex min-h-0 flex-col border-t-4 shadow-sm', lane.accentClass)}>
      <CardHeader className={cn('space-y-2 pb-3', lane.headerBgClass)}>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-bold leading-snug">{title}</CardTitle>
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {batches.length}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Package className="h-3 w-3" />
            {totalQty.toLocaleString()} {t('sales.qty')}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {t('transfers.lane.lastUpload')}: {latestLabel}
          </span>
        </div>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 overflow-auto p-0">
        {batches.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            {t('transfers.lane.empty')}
          </div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="text-xs">{t('common.date')}</TableHead>
                <TableHead className="text-xs">{t('table.product')}</TableHead>
                <TableHead className="text-xs text-end">{t('sales.qty')}</TableHead>
                <TableHead className="text-xs">{t('adjustments.notes')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch, index) => {
                const open = !!expandedBatches[batch.key];
                const Icon = open ? ChevronDown : ChevronRight;
                const createdAt = new Date(batch.created_at || 0);
                const isLatest = index === 0;
                const toName =
                  batch.direction === 'IN'
                    ? batch.location?.name || ''
                    : resolveLocationName(batch.toLocationId);

                const mainRow = (
                  <TableRow
                    key={batch.key}
                    className={cn(
                      'cursor-pointer hover:bg-muted/50',
                      isLatest && 'bg-primary/5 hover:bg-primary/10',
                    )}
                    onClick={() => onToggleBatch(batch.key)}
                  >
                    <TableCell className="px-2">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    </TableCell>
                    <TableCell className="py-2">
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
                      {!Number.isNaN(createdAt.getTime()) && (
                        <div className="text-[10px] text-muted-foreground/80">
                          {formatRelativeTime(createdAt, isAr)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      <span className="text-xs font-semibold">
                        {batch.items.length} {t('table.product')}
                      </span>
                      <p className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                        {batch.items
                          .slice(0, 2)
                          .map((tx) => `${tx.sku?.sku || '-'} · ${resolveProductLabel(tx)}`)
                          .join(' ، ')}
                        {batch.items.length > 2 ? ` +${batch.items.length - 2}` : ''}
                      </p>
                    </TableCell>
                    <TableCell className="py-2 text-end">
                      <Badge variant="outline" className="px-1.5 py-0 text-xs font-bold tabular-nums">
                        {batch.totalQty}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[120px] truncate py-2 text-[10px] text-muted-foreground">
                      {batch.userNotes || '—'}
                    </TableCell>
                  </TableRow>
                );

                if (!open) return mainRow;

                return (
                  <Fragment key={`${batch.key}-group`}>
                    {mainRow}
                    <TableRow className="bg-muted/10">
                      <TableCell colSpan={5} className="p-2">
                        <div className="overflow-x-auto rounded-md border bg-background">
                          <Table>
                            <TableHeader className="bg-muted/30">
                              <TableRow>
                                <TableHead className="text-[10px]">SKU</TableHead>
                                <TableHead className="text-[10px]">{t('table.product')}</TableHead>
                                <TableHead className="text-end text-[10px]">{t('sales.qty')}</TableHead>
                                <TableHead className="text-[10px]">{t('transfers.to')}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {batch.items.map((tx) => (
                                <TableRow
                                  key={tx.id}
                                  className="cursor-pointer hover:bg-muted/20"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectTransfer(String(tx.id));
                                  }}
                                >
                                  <TableCell className="font-mono text-[10px]">{tx.sku?.sku || '-'}</TableCell>
                                  <TableCell className="max-w-[140px] truncate text-[10px]">
                                    {resolveProductLabel(tx)}
                                  </TableCell>
                                  <TableCell className="text-end font-mono text-[10px]">{tx.quantity}</TableCell>
                                  <TableCell className="text-[10px]">{toName || '—'}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
