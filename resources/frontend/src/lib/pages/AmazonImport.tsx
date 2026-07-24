import React, { useCallback } from 'react';
import { CheckCircle, RotateCcw, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CSVUploadSection } from '@/components/imports/CSVUploadSection';
import { TransactionsTable } from '@/components/imports/TransactionsTable';
import { ImportBatchList } from '@/components/imports/ImportBatchList';
import { useAmazonImport } from '@/hooks/useAmazonImport';

export default function AmazonImport() {
  const {
    batches,
    batchesLoading,
    transactions,
    transactionsLoading,
    currentBatchId,
    setCurrentBatchId,
    createBatch,
    importToStaging,
    confirmImport,
    rollbackBatch,
    reclassify,
    isImporting,
    isConfirming,
    isRollingBack
  } = useAmazonImport();

  const handleUpload = useCallback(async (
    rows: Record<string, unknown>[],
    fileInfo: { fileName: string; fileSize: number }
  ) => {
    // Create batch first
    await createBatch(fileInfo);
    // Then import rows
    await importToStaging(rows);
  }, [createBatch, importToStaging]);

  const handleConfirmImport = useCallback(async () => {
    await confirmImport();
  }, [confirmImport]);

  const handleRollback = useCallback(async (batchId: string) => {
    await rollbackBatch(batchId);
  }, [rollbackBatch]);

  const handleReclassify = useCallback(async () => {
    await reclassify();
  }, [reclassify]);

  // Get stats for current batch
  const stats = transactions?.reduce((acc, tx) => {
    acc[tx.classification_status] = (acc[tx.classification_status] || 0) + 1;
    acc[`status_${tx.import_status}`] = (acc[`status_${tx.import_status}`] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  const hasValidatedTransactions = (stats['status_validated'] || 0) > 0;
  const hasPendingTransactions = (stats['status_pending'] || 0) > 0;
  const hasUnknownTransactions = (stats['UNKNOWN'] || 0) > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Amazon CSV Import</h1>
        <p className="text-muted-foreground">
          Import Amazon transaction reports with automatic classification and deduplication
        </p>
      </div>

      {/* Alerts */}
      {hasUnknownTransactions && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Unknown Transactions Detected</AlertTitle>
          <AlertDescription>
            {stats['UNKNOWN']} transactions could not be classified. These may be orphan refunds
            or transactions without matching orders.
          </AlertDescription>
        </Alert>
      )}

      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar - Batch List */}
        <div className="lg:col-span-1">
          <ImportBatchList
            batches={batches || []}
            currentBatchId={currentBatchId}
            onSelectBatch={setCurrentBatchId}
            onRollback={handleRollback}
            isRollingBack={isRollingBack}
          />
        </div>

        {/* Main Content */}
        <div className="lg:col-span-3 space-y-6">
          {/* Upload Section */}
          <CSVUploadSection
            onUpload={handleUpload}
            isLoading={isImporting}
            batchId={currentBatchId}
          />

          {/* Action Buttons */}
          {currentBatchId && transactions && transactions.length > 0 && (
            <div className="flex items-center gap-4 p-4 bg-muted/30 rounded-lg border">
              <div className="flex-1">
                <div className="text-sm font-medium">
                  {transactions.length} transactions in batch
                </div>
                <div className="text-xs text-muted-foreground">
                  {stats['FBA_SALE'] || 0} sales • {stats['RETURN'] || 0} returns •
                  {stats['DUPLICATE'] || 0} duplicates • {stats['UNKNOWN'] || 0} unknown
                </div>
              </div>

              <div className="flex items-center gap-2">
                {hasPendingTransactions && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReclassify}
                    disabled={isConfirming}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Validate Data
                  </Button>
                )}

                {hasValidatedTransactions && (
                  <div className="flex flex-col items-end gap-2">
                    <Button
                      size="sm"
                      onClick={handleConfirmImport}
                      disabled={isConfirming}
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      {isConfirming ? 'Importing...' : 'Confirm Import'}
                    </Button>
                    <p className="text-[10px] text-muted-foreground italic">
                      * Will deduct items from FBA warehouse
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Transactions Table */}
          {currentBatchId && (
            <TransactionsTable
              transactions={transactions || []}
              isLoading={transactionsLoading}
            />
          )}

          {/* Empty State */}
          {!currentBatchId && !batchesLoading && (
            <div className="text-center py-12 text-muted-foreground">
              <p>Upload a CSV file or select an existing batch to view transactions</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
