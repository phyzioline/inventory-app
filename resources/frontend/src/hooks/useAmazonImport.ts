import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import api from '@/lib/api';

export interface ImportedTransaction {
  id: string;
  batch_id: string;
  transaction_date: string | null;
  transaction_type: string | null;
  order_id: string | null;
  sku_external_code: string | null;
  product_name: string | null;
  quantity: number;
  gross_amount: number;
  discount_amount: number;
  amazon_fee: number;
  fba_fee: number;
  other_fees: number;
  net_amount: number;
  classification_status: string;
  matched_order_id: string | null;
  matched_order_type: string | null;
  matched_sku_id: string | null;
  import_status: string;
  reason_log: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface ImportBatch {
  id: string;
  import_type: string;
  channel: string | null;
  file_name: string | null;
  file_size: number | null;
  records_total: number;
  records_success: number;
  records_failed: number;
  records_skipped: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ClassificationResult {
  classification_status: string;
  matched_order_id: string | null;
  matched_order_type: string | null;
  reason_log: string;
}

export function useAmazonImport() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentBatchId, setCurrentBatchId] = useState<string | null>(null);

  // Fetch import batches (stub - returns empty for now)
  const { data: batches, isLoading: batchesLoading } = useQuery({
    queryKey: ['import-batches', 'amazon'],
    queryFn: async () => {
      try {
        // TODO: Implement Laravel endpoint for import batches
        return [] as ImportBatch[];
      } catch {
        return [] as ImportBatch[];
      }
    }
  });

  // Fetch transactions for current batch (stub)
  const { data: transactions, isLoading: transactionsLoading, refetch: refetchTransactions } = useQuery({
    queryKey: ['imported-transactions', currentBatchId],
    queryFn: async () => {
      if (!currentBatchId) return [];
      try {
        // TODO: Implement Laravel endpoint
        return [] as ImportedTransaction[];
      } catch {
        return [] as ImportedTransaction[];
      }
    },
    enabled: !!currentBatchId
  });

  // Create import batch
  const createBatchMutation = useMutation({
    mutationFn: async (fileInfo: { fileName: string; fileSize: number }) => {
      return await api.post('/imports/batches', {
        import_type: 'amazon',
        file_name: fileInfo.fileName,
        file_size: fileInfo.fileSize,
      });
    },
    onSuccess: (data: any) => {
      setCurrentBatchId(data.id);
      queryClient.invalidateQueries({ queryKey: ['import-batches'] });
    }
  });

  // Import CSV rows to staging
  const importToStagingMutation = useMutation({
    mutationFn: async (rows: Record<string, unknown>[]) => {
      if (!currentBatchId) throw new Error('No active batch');
      return await api.post(`/imports/batches/${currentBatchId}/staging`, { rows });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['imported-transactions', currentBatchId] });
      toast({
        title: 'Success',
        description: 'Orders imported to staging. Please review and confirm.',
      });
    }
  });

  // Confirm import - This is where the magic happens (stock deduction + settlement)
  const confirmImportMutation = useMutation({
    mutationFn: async () => {
      if (!currentBatchId) throw new Error('No active batch');

      // The backend should handle this, but we simulate the intent
      return await api.post(`/imports/batches/${currentBatchId}/confirm`, {
        warehouse_id: 'amazon_fba_warehouse', // Example ID
        deduct_stock: true,
        update_settlement: true
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-by-location'] });
      queryClient.invalidateQueries({ queryKey: ['master-products'] });
      toast({
        title: 'Import Confirmed',
        description: 'Stock deducted from FBA and settlement records updated.',
      });
      setCurrentBatchId(null);
    }
  });

  // Rollback batch (stub)
  const rollbackBatchMutation = useMutation({
    mutationFn: async (batchId: string) => {
      throw new Error('Not implemented');
    }
  });

  // Re-classify (stub)
  const reclassifyMutation = useMutation({
    mutationFn: async () => {
      throw new Error('Not implemented');
    }
  });

  return {
    batches,
    batchesLoading,
    transactions,
    transactionsLoading,
    currentBatchId,
    setCurrentBatchId,
    createBatch: createBatchMutation.mutateAsync,
    importToStaging: importToStagingMutation.mutateAsync,
    confirmImport: confirmImportMutation.mutateAsync,
    rollbackBatch: rollbackBatchMutation.mutateAsync,
    reclassify: reclassifyMutation.mutateAsync,
    isImporting: importToStagingMutation.isPending,
    isConfirming: confirmImportMutation.isPending,
    isRollingBack: rollbackBatchMutation.isPending,
    refetchTransactions
  };
}
