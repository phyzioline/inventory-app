import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowRightLeft, Calendar, Upload, Search, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import TransferModal from '@/components/inventory/TransferModal';
import { BulkTransferUploadDialog } from '@/components/inventory/BulkTransferUploadDialog';
import NoonAsnTransferDialog from '@/components/inventory/NoonAsnTransferDialog';
import FbaRequestTransferDialog from '@/components/inventory/FbaRequestTransferDialog';
import { TransferDetailsDialog } from '@/components/inventory/TransferDetailsDialog';

export default function Transfers() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);
  const [isNoonAsnOpen, setIsNoonAsnOpen] = useState(false);
  const [isFbaRequestOpen, setIsFbaRequestOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);
  const [expandedBatches, setExpandedBatches] = useState<Record<string, boolean>>({});

  const { data: transfers, isLoading } = useQuery({
    queryKey: ['transfers'],
    queryFn: () => api.getArray('/transactions?type=TRANSFER'),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.getArray('warehouses'),
    staleTime: 60_000,
  });

  const locationNameById = useMemo(() => {
    const map = new Map<string, string>();
    (locations || []).forEach((l: any) => {
      if (l?.id == null) return;
      map.set(String(l.id), String(l.name || ''));
    });
    return map;
  }, [locations]);

  const resolveLocationName = (id: string) => {
    const s = String(id || '').trim();
    if (!s) return '';
    return locationNameById.get(s) || `Location #${s}`;
  };

  const resolveProductLabel = (tx: any) => {
    return (
      tx?.sku?.offer?.master_product?.internal_name ||
      tx?.sku?.offer?.masterProduct?.internal_name ||
      tx?.sku?.offer?.name ||
      tx?.sku?.product?.name ||
      tx?.sku?.name ||
      '-'
    );
  };

  const parseTransferNotes = (raw: any) => {
    const text = String(raw || '').trim();
    const outMatch = text.match(/Transfer\s+OUT\s+to\s+Location\s+#(\d+)/i);
    const inMatch = text.match(/Transfer\s+IN\s+from\s+Location\s+#(\d+)/i);
    const toLocationId = outMatch ? String(outMatch[1]) : '';
    const fromExternalLocationId = inMatch ? String(inMatch[1]) : '';
    const userNotes = text
      .replace(/^Transfer\s+OUT\s+to\s+Location\s+#\d+\.\s*/i, '')
      .replace(/^Transfer\s+IN\s+from\s+Location\s+#\d+\.\s*/i, '')
      .replace(/\s*\[cross-SKU:[^\]]+\]\s*$/i, '')
      .trim();
    return { toLocationId, fromExternalLocationId, userNotes };
  };

  const batches = (() => {
    const rows = Array.isArray(transfers) ? transfers : [];
    const map = new Map<string, any>();

    for (const tx of rows) {
      const created = new Date(tx.created_at || tx.updated_at || 0);
      const minuteKey = Number.isNaN(created.getTime())
        ? 'unknown'
        : `${created.getFullYear()}-${created.getMonth() + 1}-${created.getDate()} ${created.getHours()}:${created.getMinutes()}`;
      const fromLocationId = String(tx.location_id || tx.location?.id || '');
      const { toLocationId, fromExternalLocationId, userNotes } = parseTransferNotes(tx.notes);
      const direction = String(tx.type || '').toUpperCase() === 'IN' ? 'IN' : 'OUT';

      const remoteId = direction === 'IN' ? fromExternalLocationId : toLocationId;
      const key = [minuteKey, direction, fromLocationId, remoteId, userNotes].join('|');
      if (!map.has(key)) {
        map.set(key, {
          key,
          minuteKey,
          direction,
          fromLocationId,
          toLocationId,
          fromExternalLocationId,
          userNotes,
          created_at: tx.created_at,
          location: tx.location,
          items: [],
          totalQty: 0,
        });
      }
      const g = map.get(key);
      g.items.push(tx);
      g.totalQty += Number(tx.quantity || 0);
      map.set(key, g);
    }

    // Sort batches by newest
    return Array.from(map.values()).sort((a, b) => {
      const ad = new Date(a.created_at || 0).getTime();
      const bd = new Date(b.created_at || 0).getTime();
      return bd - ad;
    });
  })();

  const filteredBatches = batches.filter((batch: any) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const hay = [
      batch.userNotes,
      batch.location?.name,
      batch.fromLocationId,
      batch.toLocationId,
      batch.fromExternalLocationId,
      resolveLocationName(batch.toLocationId),
      resolveLocationName(batch.fromExternalLocationId),
      ...batch.items.flatMap((tx: any) => [
        tx.sku?.sku,
        tx.sku?.offer?.name,
        tx.sku?.product?.name,
        resolveProductLabel(tx),
        tx.notes,
        tx.location?.name,
      ]),
    ]
      .map((v: any) => String(v || '').toLowerCase())
      .join(' ');
    return hay.includes(q);
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <TransferModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
      />
      <TransferDetailsDialog
        open={!!selectedTransferId}
        transferTxId={selectedTransferId}
        onOpenChange={(open) => {
          if (!open) setSelectedTransferId(null);
        }}
      />

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{t('transfers.title')}</h1>
          <p className="text-muted-foreground">{t('transfers.subtitle')}</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Button variant="outline" onClick={() => setIsFbaRequestOpen(true)}>
            {t('transfers.fbaRequest')}
          </Button>
          <Button variant="outline" onClick={() => setIsNoonAsnOpen(true)}>
            {t('transfers.noonAsn')}
          </Button>
          <Button variant="outline" onClick={() => setIsBulkUploadOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            {t('transfers.bulkUpload')}
          </Button>
          <Button onClick={() => setIsTransferModalOpen(true)}>
            <ArrowRightLeft className="mr-2 h-4 w-4" />
            {t('transfers.newTransfer')}
          </Button>
        </div>
      </div>

      <BulkTransferUploadDialog
        open={isBulkUploadOpen}
        onOpenChange={setIsBulkUploadOpen}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['transfers'] });
          queryClient.invalidateQueries({ queryKey: ['transactions'] });
          queryClient.invalidateQueries({ queryKey: ['inventory-by-location'] });
        }}
      />

      <FbaRequestTransferDialog
        open={isFbaRequestOpen}
        onOpenChange={setIsFbaRequestOpen}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['transfers'] });
          queryClient.invalidateQueries({ queryKey: ['transactions'] });
          queryClient.invalidateQueries({ queryKey: ['inventory-by-location'] });
        }}
      />

      <NoonAsnTransferDialog
        open={isNoonAsnOpen}
        onOpenChange={setIsNoonAsnOpen}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['transfers'] });
          queryClient.invalidateQueries({ queryKey: ['transactions'] });
          queryClient.invalidateQueries({ queryKey: ['inventory-by-location'] });
        }}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle>{t('transfers.history')}</CardTitle>
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('transfers.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-9"
            />
          </div>
        </CardHeader>
        <CardContent>
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
              {filteredBatches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    {searchQuery ? t('transfers.emptySearch') : t('transfers.empty')}
                  </TableCell>
                </TableRow>
              ) : (
                filteredBatches.flatMap((batch: any) => {
                  const open = !!expandedBatches[batch.key];
                  const Icon = open ? ChevronDown : ChevronRight;
                  const createdAt = new Date(batch.created_at || 0);
                  const dateStr = Number.isNaN(createdAt.getTime()) ? '-' : createdAt.toLocaleDateString();
                  const timeStr = Number.isNaN(createdAt.getTime()) ? '' : createdAt.toLocaleTimeString();
                  const fromName =
                    batch.direction === 'IN'
                      ? resolveLocationName(batch.fromExternalLocationId)
                      : batch.location?.name || '';
                  const toName =
                    batch.direction === 'IN'
                      ? batch.location?.name || ''
                      : resolveLocationName(batch.toLocationId);

                  const mainRow = (
                    <TableRow
                      key={batch.key}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setExpandedBatches((prev) => ({ ...prev, [batch.key]: !prev[batch.key] }))}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          {dateStr}
                        </div>
                        <div className="text-xs text-muted-foreground">{timeStr}</div>
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold">
                          {Array.isArray(batch.items) ? `${batch.items.length} ` : ''}{t('table.product')}
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {batch.items?.slice(0, 2).map((tx: any) => `${tx.sku?.sku || '-'} · ${resolveProductLabel(tx)}`).join(' ، ')}
                          {batch.items?.length > 2 ? ` +${batch.items.length - 2}` : ''}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-base font-bold px-2 py-0.5">
                          {batch.totalQty}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 text-sm">
                          <div className="flex items-center gap-1 text-muted-foreground">
                            {t('transfers.from')}: <span className="text-foreground font-medium">{fromName || '—'}</span>
                          </div>
                          <div className="flex items-center gap-1 text-muted-foreground">
                            {t('transfers.to')}:{' '}
                            <span className="text-foreground font-medium">
                              {toName || '—'}
                            </span>
                          </div>
                          <div className="text-xs italic text-muted-foreground max-w-[260px] truncate">
                            {batch.userNotes || '-'}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {batch.userNotes || '-'}
                      </TableCell>
                    </TableRow>
                  );

                  if (!open) return [mainRow];

                  const detailsRow = (
                    <TableRow key={`${batch.key}-details`} className="bg-muted/10">
                      <TableCell colSpan={5} className="p-0">
                        <div className="px-6 py-4">
                          <Table className="border rounded-md bg-background shadow-sm">
                            <TableHeader className="bg-muted/30">
                              <TableRow>
                                <TableHead>SKU</TableHead>
                                <TableHead>{t('table.product')}</TableHead>
                                <TableHead className="text-right">{t('sales.qty')}</TableHead>
                                <TableHead>{t('transfers.from')}</TableHead>
                                <TableHead>{t('transfers.to')}</TableHead>
                                <TableHead>{t('adjustments.notes')}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {batch.items.map((tx: any) => (
                                <TableRow
                                  key={tx.id}
                                  className="cursor-pointer hover:bg-muted/20"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedTransferId(String(tx.id));
                                  }}
                                >
                                  <TableCell className="font-mono text-xs">{tx.sku?.sku || '-'}</TableCell>
                                  <TableCell className="text-xs">{resolveProductLabel(tx)}</TableCell>
                                  <TableCell className="text-right font-mono text-xs">{tx.quantity}</TableCell>
                                  <TableCell className="text-xs">
                                    {batch.direction === 'IN'
                                      ? resolveLocationName(batch.fromExternalLocationId) || '—'
                                      : tx.location?.name || '—'}
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    {batch.direction === 'IN' ? batch.location?.name || '—' : toName || '—'}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{tx.notes || '-'}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </TableCell>
                    </TableRow>
                  );

                  return [mainRow, detailsRow];
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
