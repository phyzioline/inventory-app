import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, FileSpreadsheet, Loader2, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { invalidateInventoryLiveQueries } from '@/lib/inventoryLiveQueries';
import { useToast } from '@/hooks/use-toast';

const MARKETPLACE_IMPORT_UPLOAD_TIMEOUT_MS = 600_000;

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    channelId: number;
    channelName: string;
}

export default function MarketplaceOrderImportDialog({ open, onOpenChange, channelId, channelName }: Props) {
    const { t } = useLanguage();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [file, setFile] = useState<File | null>(null);
    const [results, setResults] = useState<any | null>(null);
    const [preview, setPreview] = useState<any | null>(null);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const previewReqSeq = useRef(0);

    const importMutation = useMutation({
        mutationFn: async (file: File) => {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('channel_id', channelId.toString());
            formData.append('lock_channel', '0');
            return api.upload('/marketplace/import', formData, {
                timeoutMs: MARKETPLACE_IMPORT_UPLOAD_TIMEOUT_MS,
            });
        },
        onSuccess: (data) => {
            const details = data.details ?? data;
            setResults(details);
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            invalidateInventoryLiveQueries(queryClient, { scope: 'marketplace-import', immediate: true });
            const shortageN = Number(details?.stock_shortage_count ?? details?.stock_shortages?.length ?? 0);
            if (shortageN > 0) {
                toast({
                    title: 'تنبيه مخزون',
                        description:
                        `تم حفظ الطلبات لكن لم يُنفَّذ خصم المخزون لـ ${shortageN} سطرًا (رصيد غير كافٍ في موقع الخصم؛ للتاجر من مخزون المحل فقط). راجع القائمة.`,
                });
            } else {
                toast({
                    title: t('common.success'),
                    description: t('orders.importSuccess') || 'Orders imported successfully',
                });
            }
        },
        onError: (err: any) => {
            const msg =
                err?.response?.data?.error ||
                err?.response?.data?.message ||
                'فشل الاستيراد';
            const status = err?.response?.status;
            toast({
                title: status === 422 ? 'تم رفض الشيت' : 'فشل الاستيراد',
                description: msg,
                variant: 'destructive',
            });
        },
    });

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            setResults(null);
            setPreview(null);
        }
    };

    // Auto-preview as soon as user selects a file (so warnings appear BEFORE confirm).
    useEffect(() => {
        if (!open || !file || results) return;
        const seq = ++previewReqSeq.current;
        setIsPreviewLoading(true);
        const formData = new FormData();
        formData.append('file', file);
        formData.append('channel_id', channelId.toString());

        api.upload('/marketplace/import/preview', formData, {
            timeoutMs: MARKETPLACE_IMPORT_UPLOAD_TIMEOUT_MS,
        })
            .then((res: any) => {
                if (seq !== previewReqSeq.current) return;
                const details = res?.details ?? res;
                setPreview(details);
                const shortageN = Number(details?.stock_shortage_count ?? details?.stock_shortages?.length ?? 0);
                if (details?.import_blocked) {
                    toast({
                        title: 'لا يمكن تأكيد الاستيراد',
                        description:
                            details.import_blocked_message_ar ||
                            `يوجد مشاكل في الشيت${shortageN > 0 ? ` (منها ${shortageN} نقص مخزون للصفوف التي تتطلب خصماً)` : ''}.`,
                        variant: 'destructive',
                    });
                } else if (shortageN > 0) {
                    toast({
                        title: 'تنبيه مخزون',
                        description: `يوجد ${shortageN} سطر بنقص مخزون — لن يُقبل الشيت حتى يتوفر الرصيد.`,
                        variant: 'destructive',
                    });
                }
            })
            .catch((err: any) => {
                if (seq !== previewReqSeq.current) return;
                const msg =
                    err?.response?.data?.error ||
                    err?.response?.data?.message ||
                    'فشل إنشاء المعاينة. تأكد من الملف.';
                toast({ title: 'فشل المعاينة', description: msg, variant: 'destructive' });
            })
            .finally(() => {
                if (seq !== previewReqSeq.current) return;
                setIsPreviewLoading(false);
            });
    }, [open, file, channelId, results, toast]);

    const handlePreview = async () => {
        if (!file) return;
        setIsPreviewLoading(true);
        const formData = new FormData();
        formData.append('file', file);
        formData.append('channel_id', channelId.toString());
        try {
            const res = await api.upload('/marketplace/import/preview', formData, {
                timeoutMs: MARKETPLACE_IMPORT_UPLOAD_TIMEOUT_MS,
            });
            const details = res.details ?? res;
            setPreview(details);
            const blockingShort = Number(details?.blocking_shortage_count ?? 0);
            const backfillShort = Number(details?.backfill_shortage_count ?? 0);
            if (details?.import_blocked) {
                toast({
                    title: 'لا يمكن تأكيد الاستيراد',
                    description:
                        details.import_blocked_message_ar ||
                        `يوجد مشاكل في الشيت${blockingShort > 0 ? ` (منها ${blockingShort} نقص مخزون يمنع التأكيد)` : ''}.`,
                    variant: 'destructive',
                });
            } else if (backfillShort > 0) {
                toast({
                    title: 'تنبيه خصم متأخر',
                    description: `يوجد ${backfillShort} سطراً لطلب موجود بدون خصم OUT سابق — تحذير فقط ولا يمنع التأكيد.`,
                });
            }
        } catch (err: any) {
            const msg =
                err?.response?.data?.error ||
                err?.response?.data?.message ||
                'فشل إنشاء المعاينة. تأكد من الملف.';
            toast({ title: 'فشل المعاينة', description: msg, variant: 'destructive' });
        } finally {
            setIsPreviewLoading(false);
        }
    };

    const handleImport = () => {
        if (file) {
            importMutation.mutate(file);
        }
    };

    const handleClose = () => {
        setFile(null);
        setResults(null);
        setPreview(null);
        previewReqSeq.current++;
        importMutation.reset();
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="w-5 h-5" />
                        {t('orders.import')} - {channelName}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {!results ? (
                        <>
                            <div className="text-sm text-muted-foreground bg-muted p-3 rounded-lg border border-border/50">
                                <p className="font-semibold text-foreground mb-1">💡 {t('orders.importDesc')}</p>
                                <p className="text-[11px]">
                                    تأكد من وجود الأعمدة المطلوبة (Order ID, SKU, Quantity, Price) حسب نظام تصدير {channelName}.
                                </p>
                            </div>

                            <div className="border-2 border-dashed rounded-xl p-8 text-center hover:border-primary transition-all bg-slate-50/50 dark:bg-slate-900/50">
                                <input
                                    type="file"
                                    accept=".csv,.txt,.xlsx,.xls"
                                    onChange={handleFileChange}
                                    className="hidden"
                                    id="marketplace-order-file"
                                />
                                <label htmlFor="marketplace-order-file" className="cursor-pointer group">
                                    <div className="bg-primary/5 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                                        <Upload className="w-8 h-8 text-primary" />
                                    </div>
                                    <p className="text-sm font-bold">
                                        {file ? file.name : t('orders.selectFile')}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-2">
                                        Supports CSV, Excel
                                    </p>
                                </label>
                            </div>

                            {importMutation.isError && (
                                <Alert variant="destructive" className="animate-in fade-in slide-in-from-top-1">
                                    <XCircle className="w-4 h-4" />
                                    <AlertDescription>
                                        فشل الاستيراد: يرجى التأكد من توافق الملف مع صيغة {channelName}.
                                    </AlertDescription>
                                </Alert>
                            )}

                            {preview?.import_blocked && (
                                <div className="p-3 bg-red-50 dark:bg-red-950/25 rounded-lg border border-red-200 dark:border-red-900">
                                    <p className="text-[11px] font-bold text-red-800 dark:text-red-300 mb-1">
                                        لا يمكن تأكيد الاستيراد حتى تُصلح النقاط التالية:
                                    </p>
                                    <p className="text-[10px] text-red-700 dark:text-red-200 whitespace-pre-wrap">
                                        {preview.import_blocked_message_ar ||
                                            'أصلِح صفوف المنتجات غير المربوطة أو وفّر مخزون المحل للصفوف التجارية التي تظهر نقصاً.'}
                                    </p>
                                </div>
                            )}

                            {preview && Number(preview.stock_shortage_count ?? preview.stock_shortages?.length ?? 0) > 0 && (
                                <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-900 max-h-40 overflow-y-auto">
                                    <p className="text-[11px] font-bold text-amber-800 dark:text-amber-400 mb-1 flex items-center gap-2">
                                        <AlertTriangle className="w-4 h-4" />
                                        نقص مخزون (لن يُقبل الشيت للصفوف التي تحتاج خصماً):
                                    </p>
                                    <ul className="text-[10px] space-y-1 text-amber-900 dark:text-amber-200">
                                        {(preview.stock_shortages as any[]).slice(0, 30).map((row, i: number) => (
                                            <li key={i} className="flex flex-wrap items-center gap-1">
                                                <span>• {row.message_ar || row.message_en}</span>
                                                {Boolean(row?.deducts_from_store_bucket) ? (
                                                    <span className="inline-flex items-center rounded border border-red-500/45 bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-800 dark:text-red-200">
                                                        لا يوجد مخزون بالمحل
                                                    </span>
                                                ) : null}
                                            </li>
                                        ))}
                                        {(preview.stock_shortages as any[]).length > 30 && (
                                            <li>...وغيرها {(preview.stock_shortages as any[]).length - 30} سطر</li>
                                        )}
                                    </ul>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="space-y-4 animate-in zoom-in-95 duration-300">
                            <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-4 rounded-xl flex items-start gap-3">
                                <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5" />
                                <div className="space-y-1">
                                    <h4 className="font-bold text-emerald-900 dark:text-emerald-400">اكتمل الاستيراد بنجاح!</h4>
                                    <div className="grid grid-cols-2 gap-x-4 text-xs mt-2">
                                        <div className="flex justify-between border-b border-emerald-100 dark:border-emerald-900 py-1">
                                            <span>إجمالي الصفوف:</span>
                                            <span className="font-mono font-bold">{results.total}</span>
                                        </div>
                                        <div className="flex justify-between border-b border-emerald-100 dark:border-emerald-900 py-1">
                                            <span>تم الاستيراد:</span>
                                            <span className="font-mono font-bold text-emerald-600">{results.imported}</span>
                                        </div>
                                        <div className="flex justify-between py-1">
                                            <span>فشل:</span>
                                            <span className="font-mono font-bold text-red-500">{results.failed}</span>
                                        </div>
                                        <div className="flex justify-between py-1">
                                            <span>تخطي (موجود مسبقاً):</span>
                                            <span className="font-mono font-bold text-slate-500">{results.skipped}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {results.errors?.length > 0 && (
                                <div className="p-3 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-100 dark:border-red-900 max-h-32 overflow-y-auto">
                                    <p className="text-[11px] font-bold text-red-700 dark:text-red-400 mb-1">الأخطاء المكتشفة:</p>
                                    <ul className="text-[10px] space-y-1 text-red-600 dark:text-red-300">
                                        {results.errors.slice(0, 10).map((err: string, i: number) => (
                                            <li key={i}>• {err}</li>
                                        ))}
                                        {results.errors.length > 10 && <li>...وغيرها {results.errors.length - 10} أخطاء</li>}
                                    </ul>
                                </div>
                            )}

                            {Number(results.stock_shortage_count ?? results.stock_shortages?.length ?? 0) > 0 && (
                                <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-900 max-h-40 overflow-y-auto">
                                    <p className="text-[11px] font-bold text-amber-800 dark:text-amber-400 mb-1">
                                        لا يوجد مخزون كافٍ — لم يُخصم:
                                    </p>
                                    <ul className="text-[10px] space-y-1 text-amber-900 dark:text-amber-200">
                                        {(results.stock_shortages as any[]).map((row, i: number) => (
                                            <li key={i} className="flex flex-wrap items-center gap-1">
                                                <span>• {row.message_ar || row.message_en}</span>
                                                {Boolean(row?.deducts_from_store_bucket) ? (
                                                    <span className="inline-flex items-center rounded border border-red-500/45 bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-800 dark:text-red-200">
                                                        لا يوجد مخزون بالمحل
                                                    </span>
                                                ) : null}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    {!results ? (
                        <>
                            <Button variant="ghost" onClick={handleClose} disabled={importMutation.isPending}>
                                {t('common.cancel')}
                            </Button>
                            <Button
                                onClick={handleImport}
                                disabled={
                                    !file ||
                                    isPreviewLoading ||
                                    importMutation.isPending ||
                                    !preview ||
                                    Boolean(preview.import_blocked)
                                }
                                className="px-6"
                                title={
                                    preview?.import_blocked
                                        ? 'أصلِح أخطاء الشيت أو نقص المحل أولاً'
                                        : !preview
                                          ? 'انتظر اكتمال المعاينة أولاً'
                                          : undefined
                                }
                            >
                                {isPreviewLoading || importMutation.isPending ? (
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                ) : (
                                    <CheckCircle className="w-4 h-4 mr-2" />
                                )}
                                تأكيد الاستيراد
                            </Button>
                        </>
                    ) : (
                        <Button onClick={handleClose} className="w-full">
                            {t('common.view')} {t('nav.orders')}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
