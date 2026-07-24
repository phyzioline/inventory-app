import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Upload, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import api from '@/lib/api';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function RemovalImportDialog({ open, onOpenChange, onSuccess }: Props) {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any | null>(null);

  const reset = () => {
    setFile(null);
    setBusy(false);
    setResult(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    setFile(selected);
    setResult(null);
  };

  const handleImport = async () => {
    if (!file) {
      toast.error(isAr ? 'اختر ملف الإزالة أولاً' : 'Please select a removal file first.');
      return;
    }

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('source', 'amazon');
      const res = await api.upload('/removals/import', fd);
      setResult(res);
      toast.success(isAr ? 'تم استيراد طلبات الإزالة' : 'Removal orders imported.');
      onSuccess?.();
    } catch (err: any) {
      const data = err?.response?.data;
      toast.error(data?.message || data?.error || (isAr ? 'فشل الاستيراد' : 'Import failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{isAr ? 'رفع طلبات الإزالة (Amazon Removal)' : 'Import Amazon Removal Orders'}</DialogTitle>
        </DialogHeader>

        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{isAr ? 'ملف المطلوب' : 'Required file'}</AlertTitle>
          <AlertDescription className="text-sm leading-relaxed">
            {isAr
              ? 'ارفع ملف Amazon “Removal Order Detail” (CSV) مثل الذي يحتوي أعمدة: order-id, sku, disposition, requested-quantity, shipped-quantity.'
              : 'Upload Amazon “Removal Order Detail” (CSV) with columns like: order-id, sku, disposition, requested-quantity, shipped-quantity.'}
          </AlertDescription>
        </Alert>

        <div className="space-y-3">
          <div>
            <input
              type="file"
              accept=".csv,.txt"
              onChange={handleFileChange}
              className="block w-full text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {file ? file.name : (isAr ? 'لم يتم اختيار ملف' : 'No file selected')}
            </p>
          </div>

          {result?.summary ? (
            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle className="h-4 w-4 text-emerald-500" />
                {isAr ? 'ملخص الاستيراد' : 'Import summary'}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>{isAr ? 'إجمالي الصفوف' : 'Total rows'}: <span className="text-foreground">{result.summary.total_rows ?? 0}</span></div>
                <div>{isAr ? 'أوامر جديدة' : 'Orders created'}: <span className="text-foreground">{result.summary.orders_created ?? 0}</span></div>
                <div>{isAr ? 'أوامر تحديث' : 'Orders updated'}: <span className="text-foreground">{result.summary.orders_updated ?? 0}</span></div>
                <div>{isAr ? 'بنود جديدة' : 'Items created'}: <span className="text-foreground">{result.summary.items_created ?? 0}</span></div>
                <div>{isAr ? 'بنود تحديث' : 'Items updated'}: <span className="text-foreground">{result.summary.items_updated ?? 0}</span></div>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {isAr ? 'إغلاق' : 'Close'}
          </Button>
          <Button type="button" onClick={() => void handleImport()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
            {isAr ? 'استيراد' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

