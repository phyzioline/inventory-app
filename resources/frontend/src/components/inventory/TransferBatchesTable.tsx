import { Fragment } from 'react';
import { Calendar, ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { TransferBatch } from '@/lib/transferBatchUtils';
import { getBatchEndpoints, resolveProductLabel } from '@/lib/transferBatchUtils';

type Props = {
  batches: TransferBatch[];
  isAr: boolean;
  t: (key: string) => string;
  resolveLocationName: (id: string) => string;
  expandedBatches: Record<string, boolean>;
  onToggleBatch: (key: string) => void;
  onSelectTransfer: (id: string) => void;
};

export function TransferBatchesTable({
  batches,
  isAr,
  t,
  resolveLocationName,
  expandedBatches,
  onToggleBatch,
  onSelectTransfer,
}: Props) {
  if (batches.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {t('transfers.empty')}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('common.date')}</TableHead>
          <TableHead>{t('table.product')}</TableHead>
          <TableHead>{t('sales.qty')}</TableHead>
          <TableHead>{t('table.warehouse')}</TableHead>
          <TableHead>{t('adjustments.notes')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {batches.map((batch) => {
          const open = !!expandedBatches[batch.key];
          const Icon = open ? ChevronDown : ChevronRight;
          const createdAt = new Date(batch.created_at || 0);
          const dateStr = Number.isNaN(createdAt.getTime())
            ? '—'
            : createdAt.toLocaleDateString(isAr ? 'ar-EG' : 'en-US');
          const timeStr = Number.isNaN(createdAt.getTime())
            ? ''
            : createdAt.toLocaleTimeString(isAr ? 'ar-EG' : 'en-US', {
                hour: '2-digit',
                minute: '2-digit',
              });
          const { fromName, toName } = getBatchEndpoints(batch, resolveLocationName);

          const mainRow = (
            <TableRow
              key={batch.key}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => onToggleBatch(batch.key)}
            >
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <Calendar className="h-3 w-3 text-muted-foreground" />
                  {dateStr}
                </div>
                {timeStr ? <div className="text-xs text-muted-foreground">{timeStr}</div> : null}
              </TableCell>
              <TableCell>
                <span className="font-semibold">
                  {batch.items.length} {t('table.product')}
                </span>
                <p className="text-xs text-muted-foreground">
                  {batch.items
                    .slice(0, 2)
                    .map((tx) => `${tx.sku?.sku || '-'} · ${resolveProductLabel(tx)}`)
                    .join(' ، ')}
                  {batch.items.length > 2 ? ` +${batch.items.length - 2}` : ''}
                </p>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="px-2 py-0.5 text-base font-bold">
                  {batch.totalQty}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1 text-sm">
                  <div className="flex items-center gap-1 text-muted-foreground">
                    {t('transfers.from')}:{' '}
                    <span className="font-medium text-foreground">{fromName || '—'}</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    {t('transfers.to')}:{' '}
                    <span className="font-medium text-foreground">{toName || '—'}</span>
                  </div>
                </div>
              </TableCell>
              <TableCell className="max-w-[260px] truncate text-sm text-muted-foreground">
                {batch.userNotes || '—'}
              </TableCell>
            </TableRow>
          );

          if (!open) return mainRow;

          return (
            <Fragment key={`${batch.key}-group`}>
              {mainRow}
              <TableRow className="bg-muted/10">
                <TableCell colSpan={5} className="p-0">
                  <div className="px-6 py-4">
                    <Table className="rounded-md border bg-background shadow-sm">
                      <TableHeader className="bg-muted/30">
                        <TableRow>
                          <TableHead>SKU</TableHead>
                          <TableHead>{t('table.product')}</TableHead>
                          <TableHead className="text-end">{t('sales.qty')}</TableHead>
                          <TableHead>{t('transfers.from')}</TableHead>
                          <TableHead>{t('transfers.to')}</TableHead>
                          <TableHead>{t('adjustments.notes')}</TableHead>
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
                            <TableCell className="font-mono text-xs">{tx.sku?.sku || '—'}</TableCell>
                            <TableCell className="text-xs">{resolveProductLabel(tx)}</TableCell>
                            <TableCell className="text-end font-mono text-xs">{tx.quantity}</TableCell>
                            <TableCell className="text-xs">{fromName || '—'}</TableCell>
                            <TableCell className="text-xs">{toName || '—'}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{tx.notes || '—'}</TableCell>
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
  );
}
