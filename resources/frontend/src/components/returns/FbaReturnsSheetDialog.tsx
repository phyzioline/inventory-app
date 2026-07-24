import { useRef, useState } from 'react';
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

export function FbaReturnsSheetDialog({ open, onOpenChange }: Props) {
  const { t, language } = useLanguage();
  const isAr = language === 'ar';
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [updateOnly, setUpdateOnly] = useState(false);
  const [autoRestockSellable, setAutoRestockSellable] = useState(true);

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('channel', 'amazon');
      formData.append('auto_process', '0');
      formData.append('update_only', updateOnly ? '1' : '0');
      formData.append('auto_process_sellable', autoRestockSellable ? '1' : '0');
      return api.upload('/returns/import', formData);
    },
    onSuccess: (res: any) => {
      const s = res?.summary;
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success(
        isAr
          ? `تم الاستيراد: ${s?.updated ?? 0} محدث، ${s?.created ?? 0} جديد، ${s?.processed ?? 0} مخزون، تخطي ${s?.skipped_update_only_no_match ?? 0} (لا تطابق)`
          : `Import: ${s?.updated ?? 0} updated, ${s?.created ?? 0} created, ${s?.processed ?? 0} restocked, skipped no-match ${s?.skipped_update_only_no_match ?? 0}`,
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
            {t('returns.fbaSheet.title') || (isAr ? 'شيت مرتجعات FBA (التصنيف والموقع)' : 'FBA returns sheet (disposition & FC)')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm leading-relaxed">
            {t('returns.fbaSheet.description') ||
              (isAr
                ? 'ارفع تقرير Amazon FBA Returns بنفس أعمدة الملف الرسمي (order-id, sku, license-plate-number, detailed-disposition, fulfillment-center-id). يتم مطابقة السطر بدون تكرار عبر رقم اللوحة والـ hash، ودمج التحديث مع سطر التسوية إن وُجد.'
                : 'Upload the official FBA Returns CSV. Rows are matched deduplicated by license plate + row hash, and merged onto settlement-created returns when possible.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <label className="flex items-start gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={updateOnly}
              onChange={(e) => setUpdateOnly(e.target.checked)}
              className="mt-1 rounded border-border"
            />
            <span>
              {t('returns.fbaSheet.updateOnly') ||
                (isAr ? 'تحديث السجلات الموجودة فقط (لا إنشاء سجلات جديدة إن لم يُعثر على تطابق)' : 'Update existing rows only (skip if no match)')}
            </span>
          </label>

          <label className="flex items-start gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={autoRestockSellable}
              onChange={(e) => setAutoRestockSellable(e.target.checked)}
              className="mt-1 rounded border-border"
            />
            <span>
              {t('returns.fbaSheet.autoRestock') ||
                (isAr
                  ? 'إذا كان SELLABLE: زيادة المخزون المحلي المرتبط بطلب القناة (نفس مسار معالجة المرتجع)'
                  : 'If SELLABLE: add quantity to local stock linked to the order (same as return processing)')}
            </span>
          </label>

          <div className="space-y-2">
            <Label>{t('returns.fbaSheet.file') || (isAr ? 'ملف CSV' : 'CSV file')}</Label>
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

        <DialogFooter className="gap-2 sm:gap-0">
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
            {t('returns.fbaSheet.chooseFile') || (isAr ? 'اختر الملف وارفع' : 'Choose file')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
