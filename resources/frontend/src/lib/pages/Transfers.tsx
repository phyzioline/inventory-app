import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import { Loader2, ArrowRightLeft, Upload, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import TransferModal from '@/components/inventory/TransferModal';
import { BulkTransferUploadDialog } from '@/components/inventory/BulkTransferUploadDialog';
import NoonAsnTransferDialog from '@/components/inventory/NoonAsnTransferDialog';
import FbaRequestTransferDialog from '@/components/inventory/FbaRequestTransferDialog';
import { TransferDetailsDialog } from '@/components/inventory/TransferDetailsDialog';
import { TransferLaneColumn } from '@/components/inventory/TransferLaneColumn';
import { buildTransferBatches, batchMatchesSearch } from '@/lib/transferBatchUtils';
import { TRANSFER_LANES, groupBatchesByLane } from '@/lib/transferLanes';

export default function Transfers() {
  const { t, language } = useLanguage();
  const isAr = language === 'ar';
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

  const batches = useMemo(() => buildTransferBatches(transfers), [transfers]);

  const filteredBatches = useMemo(
    () => batches.filter((batch) => batchMatchesSearch(batch, searchQuery, resolveLocationName)),
    [batches, searchQuery, locationNameById],
  );

  const batchesByLane = useMemo(
    () => groupBatchesByLane(filteredBatches, locations, resolveLocationName),
    [filteredBatches, locations, locationNameById],
  );

  const unassignedCount = useMemo(() => {
    const assigned = TRANSFER_LANES.reduce((sum, lane) => sum + batchesByLane[lane.id].length, 0);
    return filteredBatches.length - assigned;
  }, [filteredBatches, batchesByLane]);

  const invalidateTransferQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['transfers'] });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-by-location'] });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TransferModal isOpen={isTransferModalOpen} onClose={() => setIsTransferModalOpen(false)} />
      <TransferDetailsDialog
        open={!!selectedTransferId}
        transferTxId={selectedTransferId}
        onOpenChange={(open) => {
          if (!open) setSelectedTransferId(null);
        }}
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('transfers.title')}</h1>
          <p className="text-muted-foreground">{t('transfers.subtitleLanes')}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setIsFbaRequestOpen(true)}>
            {t('transfers.fbaRequest')}
          </Button>
          <Button variant="outline" onClick={() => setIsNoonAsnOpen(true)}>
            {t('transfers.noonAsn')}
          </Button>
          <Button variant="outline" onClick={() => setIsBulkUploadOpen(true)}>
            <Upload className="me-2 h-4 w-4" />
            {t('transfers.bulkUpload')}
          </Button>
          <Button onClick={() => setIsTransferModalOpen(true)}>
            <ArrowRightLeft className="me-2 h-4 w-4" />
            {t('transfers.newTransfer')}
          </Button>
        </div>
      </div>

      <BulkTransferUploadDialog
        open={isBulkUploadOpen}
        onOpenChange={setIsBulkUploadOpen}
        onSuccess={invalidateTransferQueries}
      />
      <FbaRequestTransferDialog
        open={isFbaRequestOpen}
        onOpenChange={setIsFbaRequestOpen}
        onSuccess={invalidateTransferQueries}
      />
      <NoonAsnTransferDialog
        open={isNoonAsnOpen}
        onOpenChange={setIsNoonAsnOpen}
        onSuccess={invalidateTransferQueries}
      />

      <Card>
        <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{t('transfers.lanesTitle')}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{t('transfers.lanesHint')}</p>
          </div>
          <div className="relative w-full max-w-sm">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t('transfers.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 ps-9"
            />
          </div>
        </CardHeader>
        {unassignedCount > 0 && !searchQuery && (
          <CardContent className="pb-0 pt-0">
            <p className="text-xs text-muted-foreground">
              {t('transfers.lane.unassigned').replace('{count}', String(unassignedCount))}
            </p>
          </CardContent>
        )}
      </Card>

      <div className="grid min-h-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 xl:items-stretch [&>div]:max-h-[calc(100vh-260px)]">
        {TRANSFER_LANES.map((lane) => (
          <TransferLaneColumn
            key={lane.id}
            lane={lane}
            batches={batchesByLane[lane.id]}
            isAr={isAr}
            t={t}
            expandedBatches={expandedBatches}
            onToggleBatch={(key) =>
              setExpandedBatches((prev) => ({ ...prev, [key]: !prev[key] }))
            }
            onSelectTransfer={setSelectedTransferId}
            resolveLocationName={resolveLocationName}
          />
        ))}
      </div>
    </div>
  );
}
