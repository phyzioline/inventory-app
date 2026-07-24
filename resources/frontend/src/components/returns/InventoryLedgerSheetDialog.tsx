import { useRef } from 'react';
import { Loader2, Upload } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function InventoryLedgerSheetDialog({ open, onOpenChange }: Props) {
  const { t, language } = useLanguage();
  const isAr = language === 'ar';
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.upload('/returns/import-inventory-ledger', formData);
    },
    onSuccess: (res: any) => {
      const s = res?.summary;
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      toast.success(
        isAr
          ? `شيت المخزون: ${s?.created ?? 0} جديد، ${s?.updated ?? 0} محدث، تخطي غير المؤهل ${s?.skipped_no_claim_disposition ?? 0}، بدون تاريخ ${s?.skipped_no_date ?? 0}`
          : `Inventory ledger: ${s?.created ?? 0} created, ${s?.updated ?? 0} updated, skipped disposition ${s?.skipped_no_claim_disposition ?? 0}, no date ${s?.skipped_no_date ?? 0}`,
      );
      onOpenChange(false);
      if (fileRef.current) fileRef.current.value = '';
    },
    onError: (error: any) => {
      const data = error?.response?.data;
      toast.error(data?.message || error?.message || 'Import failed');
    },
  });

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importMutation.mutate(file);
    e.target.value = '';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border text-foreground">
        <DialogHeader>
          <DialogTitle>
            {t('returns.ledgerSheet.title') || (isAr ? 'شيت مخزون / Ledger (تعويضات)' : 'Inventory ledger (claims)')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm leading-relaxed">
            {t('returns.ledgerSheet.description') ||
              (isAr
                ? 'ارفع CSV تقرير الحركة (مثل Ledger Detail). الصفوف ذات Disposition = WAREHOUSE_DAMAGED أو LOST تُسجَّل للتعويض: آخر موعد للمطالبة = 60 يومًا من «تاريخ ووقت الحدث» في الملف.'
                : 'Upload the inventory ledger CSV. Rows with WAREHOUSE_DAMAGED or LOST are tracked for reimbursement: deadline is 60 days from the event date/time column.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t('returns.ledgerSheet.file') || (isAr ? 'ملف CSV' : 'CSV file')}</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt"
              className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border file:bg-muted file:px-3 file:py-2"
              disabled={importMutation.isPending}
              onChange={onPickFile}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={importMutation.isPending}>
            {t('common.cancel') || 'Cancel'}
          </Button>
          <Button
            type="button"
            className="gap-2"
            disabled={importMutation.isPending}
            onClick={() => fileRef.current?.click()}
          >
            {importMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {t('returns.ledgerSheet.upload') || (isAr ? 'اختر ملف' : 'Choose file')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
