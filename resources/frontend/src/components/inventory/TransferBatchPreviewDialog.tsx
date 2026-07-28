import { useMemo } from 'react';
import { CheckCircle2, Package } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TransferBatch } from '@/lib/transferBatchUtils';
import { buildBatchFbaSummary } from '@/lib/transferBatchPreview';
import { TransferBatchSummaryTable } from '@/components/inventory/TransferBatchSummaryTable';

type Props = {
  open: boolean;
  batch: TransferBatch | null;
  txById: Map<string, any>;
  resolveLocationName: (id: string) => string;
  onOpenChange: (open: boolean) => void;
  onEditItem?: (txId: string) => void;
};

export function TransferBatchPreviewDialog({
  open,
  batch,
  txById,
  resolveLocationName,
  onOpenChange,
  onEditItem,
}: Props) {
  const { language } = useLanguage();
  const isAr = language === 'ar';

  const summary = useMemo(() => {
    if (!batch) return null;
    return buildBatchFbaSummary(batch, resolveLocationName, txById, isAr);
  }, [batch, resolveLocationName, txById, isAr]);

  const handleEdit = (txId: string) => {
    onOpenChange(false);
    onEditItem?.(txId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[96vh] max-h-[96vh] w-[99vw] max-w-[99vw] flex-col gap-2 overflow-hidden p-3 sm:p-4">
        <DialogHeader className="shrink-0 space-y-0.5">
          <DialogTitle className="flex items-center gap-1.5 text-base">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            {isAr ? 'ملخص تحويل FBA' : 'FBA transfer summary'}
          </DialogTitle>
          <DialogDescription className="text-xs leading-snug">
            {isAr
              ? 'مقارنة الكميات المطلوبة مقابل ما تم تحويله فعلياً — يمكنك تعديل أي صنف من زر التعديل.'
              : 'Compare required vs transferred quantities — use Edit to fix any row.'}
          </DialogDescription>
        </DialogHeader>

        {summary ? (
          <TransferBatchSummaryTable
            summary={summary}
            isAr={isAr}
            className="min-h-0 flex-1"
            onEditRow={onEditItem ? handleEdit : undefined}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Package className="me-2 h-5 w-5" />
            —
          </div>
        )}

        <DialogFooter className="shrink-0 gap-2 border-t pt-1.5">
          <Button type="button" className="h-8 min-w-[120px] text-xs" onClick={() => onOpenChange(false)}>
            {isAr ? 'إغلاق' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
