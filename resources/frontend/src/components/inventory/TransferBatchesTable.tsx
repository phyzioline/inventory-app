import { useState } from 'react';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { TransferBatch } from '@/lib/transferBatchUtils';
import { TransferShipmentRow } from '@/components/inventory/TransferShipmentRow';

type Props = {
  batches: TransferBatch[];
  isAr: boolean;
  t: (key: string) => string;
  txById: Map<string, any>;
  resolveLocationName: (id: string) => string;
  onOpenBatch: (batch: TransferBatch) => void;
  onEditItem?: (txId: string) => void;
};

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

export function TransferBatchesTable({
  batches,
  isAr,
  t,
  txById,
  resolveLocationName,
  onOpenBatch,
  onEditItem,
}: Props) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

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
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-8" />
          <TableHead className="min-w-[160px] text-xs">{isAr ? 'رقم الشحنة' : 'Shipment #'}</TableHead>
          <TableHead className="w-[100px] text-xs">{isAr ? 'الحالة' : 'Status'}</TableHead>
          <TableHead className="w-[130px] text-xs">{t('common.date')}</TableHead>
          <TableHead className="w-[90px] text-xs">{isAr ? 'الشحن إلى' : 'Ship to'}</TableHead>
          <TableHead className="w-[80px] text-center text-xs">{isAr ? 'SKU' : 'SKUs'}</TableHead>
          <TableHead className="w-[80px] text-center text-xs">{isAr ? 'الوحدات' : 'Units'}</TableHead>
          <TableHead className="w-[90px] text-center text-xs">{isAr ? 'عرض' : 'View'}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {batches.map((batch, index) => (
          <TransferShipmentRow
            key={batch.key}
            batch={batch}
            isAr={isAr}
            isCompact={false}
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
}
