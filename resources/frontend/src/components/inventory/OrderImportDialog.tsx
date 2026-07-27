import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Upload, FileSpreadsheet, Loader2, CheckCircle, XCircle, Download, RotateCcw, Filter, List, ScanLine, Pin, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import api from '@/lib/api';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useMarketplaceImportPreviewLiveRefresh } from '@/hooks/useMarketplaceImportPreviewLiveRefresh';

/** Large order sheets may run several minutes server-side. */
const MARKETPLACE_IMPORT_UPLOAD_TIMEOUT_MS = 600_000;

type ImportChannelMode = 'auto' | 'manual';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void;
    /** Pre-select account anchor in auto mode (e.g. from orders page channel filter). */
    defaultAnchorChannelId?: string;
}

/** Blocking issue only (matches summary counts — excludes backfill warnings on duplicates). */
function previewRowHasBlockingIssue(row: any): boolean {
    if (row.catalog_issue && typeof row.catalog_issue === 'object') {
        return true;
    }
    const sp = row.stock_preview;
    if (sp?.shortage && row.status !== 'duplicate') {
        return true;
    }
    if (row.status === 'error') {
        const r = String(row.reason || '').trim();
        return r !== '' && r !== '—';
    }
    return false;
}

/** One consolidated issue line per preview row (shown beside order id). */
function previewRowIssueText(row: any, isAr: boolean): { text: string; hasIssue: boolean } {
    const ci = row.catalog_issue;
    if (ci && typeof ci === 'object') {
        const text = isAr ? String(ci.ar ?? ci.en ?? '') : String(ci.en ?? ci.ar ?? '');
        return { text, hasIssue: true };
    }
    const sp = row.stock_preview;
    if (sp?.shortage) {
        const backfill = Boolean(sp.backfill_pending);
        const merchant = Boolean(sp.deducts_from_store_bucket);
        const req = sp.requested ?? 0;
        const av = sp.available ?? 0;
        const mAv = sp.merchant_available ?? null;
        const sAv = sp.store_available ?? null;
        const poolHint =
            merchant && (mAv !== null || sAv !== null)
                ? (isAr
                    ? ` (تاجر: ${mAv ?? 0} + محل: ${sAv ?? 0} — يُخصم من التاجر أولاً ثم المحل)`
                    : ` (merchant: ${mAv ?? 0} + store: ${sAv ?? 0} — merchant first, then store)`)
                : merchant
                  ? (isAr
                      ? ' (يُخصم من التاجر أولاً ثم المحل)'
                      : ' (merchant channel first, then main store)')
                  : '';
        const backfillHint = backfill
            ? (isAr
                ? ' الطلب موجود مسبقاً لكن لم يُخصم مخزونه — يحتاج رصيداً لإتمام الخصم المتأخر.'
                : ' Order already exists but stock was never deducted — needs stock for pending backfill.')
            : '';
        const text = isAr
            ? merchant
                ? `لم يُنفَّذ خصم المخزون — المطلوب ${req} والمتاح ${av}.${poolHint} الرصيد غير كافٍ.${backfillHint}`
                : `لم يُنفَّذ خصم المخزون — المطلوب ${req} والمتاح ${av} في موقع الخصم.${backfillHint}`
            : merchant
              ? `Stock NOT deducted — need ${req}, have ${av}.${poolHint} Insufficient combined stock.${backfillHint}`
              : `Stock NOT deducted — need ${req}, have ${av} at deduction location.${backfillHint}`;
        return { text, hasIssue: true };
    }
    if (row.status === 'error') {
        const r = String(row.reason || '').trim();
        if (r && r !== '—') {
            return { text: r, hasIssue: true };
        }
    }
    return { text: '—', hasIssue: false };
}

function formatPreviewOrderDate(value: unknown): string {
    if (value === null || value === undefined || value === '') {
        return '—';
    }
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
        return String(value);
    }
    return parsed.toLocaleDateString('en-GB');
}

export function OrderImportDialog({ open, onOpenChange, onSuccess, defaultAnchorChannelId }: Props) {
    const { language } = useLanguage();
    const isAr = language === 'ar';
    const queryClient = useQueryClient();
    const [file, setFile] = useState<File | null>(null);
    const [channelId, setChannelId] = useState<string>('');
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [rollbackBusy, setRollbackBusy] = useState(false);
    const [retryBusy, setRetryBusy] = useState(false);
    const [retryDays, setRetryDays] = useState('1');
    const [retryPreview, setRetryPreview] = useState<any>(null);
    const [results, setResults] = useState<any>(null);
    const [preview, setPreview] = useState<any>(null);
    const [previewRowFilter, setPreviewRowFilter] = useState<'all' | 'issues'>('all');
    const [channelMode, setChannelMode] = useState<ImportChannelMode>('auto');
    const [isSilentPreviewRefresh, setIsSilentPreviewRefresh] = useState(false);
    const previewReqSeq = useRef(0);
    const lockChannel = channelMode === 'manual';

    useEffect(() => {
        if (!open || !defaultAnchorChannelId || channelMode !== 'auto') {
            return;
        }
        setChannelId(defaultAnchorChannelId);
    }, [open, defaultAnchorChannelId, channelMode]);

    const { data: channels = [] } = useQuery({
        queryKey: ['channels'],
        queryFn: () => api.getArray('/channels')
    });

    const { data: lastBatch } = useQuery({
        queryKey: ['marketplace-import-last-batch'],
        queryFn: () =>
            api.get<{
                available: boolean;
                transaction_count: number;
                new_orders_count: number;
                recorded_at: string | null;
                hint?: string | null;
            }>('marketplace/import/last-batch'),
        enabled: open,
    });

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            setResults(null);
            setPreview(null);
            setPreviewRowFilter('all');
        }
    };

    const appendImportFormFields = (formData: FormData) => {
        formData.append('file', file!);
        formData.append('lock_channel', lockChannel ? '1' : '0');
        if (lockChannel) {
            formData.append('channel_id', channelId);
        } else if (channelId) {
            // Optional anchor when multiple marketplace families exist (FBA/merchant siblings).
            formData.append('channel_id', channelId);
        }
    };

    const canStartPreview = Boolean(file) && (channelMode === 'auto' || Boolean(channelId));

    const buildPreviewFormData = useCallback(() => {
        const formData = new FormData();
        appendImportFormFields(formData);
        return formData;
    }, [file, lockChannel, channelId, channelMode]);

    const runPreviewUpload = useCallback(
        async (options?: { silent?: boolean }) => {
            if (!file) {
                return null;
            }
            if (channelMode === 'manual' && !channelId) {
                return null;
            }

            const seq = ++previewReqSeq.current;
            if (!options?.silent) {
                setIsPreviewLoading(true);
            } else {
                setIsSilentPreviewRefresh(true);
            }

            try {
                const response = await api.upload('/marketplace/import/preview', buildPreviewFormData(), {
                    timeoutMs: MARKETPLACE_IMPORT_UPLOAD_TIMEOUT_MS,
                });
                if (seq !== previewReqSeq.current) {
                    return null;
                }
                const det = response.details;
                setPreview(det);
                if (!options?.silent) {
                    setPreviewRowFilter('all');
                    if (det?.import_blocked) {
                        toast.error(
                            isAr
                                ? det.import_blocked_message_ar || 'لا يمكن تأكيد الاستيراد حتى تُصلح الأخطاء أو نقص المخزون.'
                                : 'Import cannot be confirmed until catalog errors or stock shortages are resolved.',
                            { duration: 12_000 }
                        );
                    }
                }
                return det;
            } catch (error: any) {
                if (seq !== previewReqSeq.current) {
                    return null;
                }
                if (!options?.silent) {
                    console.error('Preview failed:', error);
                    const errorMsg =
                        error.response?.data?.error ||
                        error.response?.data?.message ||
                        (isAr ? 'فشل إنشاء المعاينة' : 'Preview failed');
                    toast.error(errorMsg);
                }
                return null;
            } finally {
                if (seq === previewReqSeq.current) {
                    if (!options?.silent) {
                        setIsPreviewLoading(false);
                    } else {
                        setIsSilentPreviewRefresh(false);
                    }
                }
            }
        },
        [file, channelMode, channelId, buildPreviewFormData, isAr]
    );

    useMarketplaceImportPreviewLiveRefresh({
        enabled: open && Boolean(preview) && !results && Boolean(file),
        onRefresh: () => runPreviewUpload({ silent: true }),
    });

    const handlePreview = async () => {
        if (!file) {
            toast.error(isAr ? 'يرجى اختيار الملف' : 'Please select a file');
            return;
        }
        if (channelMode === 'manual' && !channelId) {
            toast.error(isAr ? 'اختر قناة البيع للوضع اليدوي' : 'Select a sales channel for manual mode');
            return;
        }

        await runPreviewUpload();
    };

    const handleImport = async () => {
        if (!file) {
            toast.error(isAr ? 'يرجى اختيار الملف' : 'Please select a file');
            return;
        }
        if (channelMode === 'manual' && !channelId) {
            toast.error(isAr ? 'اختر قناة البيع للوضع اليدوي' : 'Select a sales channel for manual mode');
            return;
        }

        setIsImporting(true);
        const formData = new FormData();
        appendImportFormFields(formData);

        try {
            const response = await api.upload('/marketplace/import', formData, {
                timeoutMs: MARKETPLACE_IMPORT_UPLOAD_TIMEOUT_MS,
            });
            const details = response.details;
            setResults(details);
            void queryClient.invalidateQueries({ queryKey: ['marketplace-import-last-batch'] });
            void queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
            void queryClient.invalidateQueries({ queryKey: ['orders'] });
            void queryClient.invalidateQueries({ queryKey: ['orders-for-profit'] });
            const shortageN = Number(details?.stock_shortage_count ?? details?.stock_shortages?.length ?? 0);
            const importedN = Number(details?.imported ?? 0);
            const skippedN = Number(details?.skipped ?? 0);
            if (shortageN > 0) {
                toast.warning(
                    isAr
                        ? `تنبيه: ${shortageN} سطر بدون خصم مخزون (لم يُنفَّذ الخصم). إن كان هذا بعد معاينة نظيفة، غالباً تغيّر الرصيد بين المعاينة والاستيراد.`
                        : `${shortageN} line(s): stock deduction did not run. If preview was clear, inventory likely changed between preview and import.`,
                    { duration: 10_000 }
                );
            } else if (importedN === 0 && skippedN > 0) {
                toast.info(
                    isAr
                        ? `لم يُضف طلب جديد (${skippedN} صف مُتجاهل — غالباً مكرر أو موجود مسبقاً). راجع المعاينة: «طلبات جديدة» يجب أن تكون > 0 لإضافة طلبات.`
                        : `No new rows imported (${skippedN} skipped — usually duplicates or already in system). Preview must show new orders > 0.`,
                    { duration: 12_000 }
                );
            } else {
                toast.success(
                    isAr
                        ? `تم الاستيراد: ${importedN} صفاً${skippedN > 0 ? ` (وتم تجاهل ${skippedN})` : ''}`
                        : `Imported ${importedN} row(s)${skippedN > 0 ? ` (${skippedN} skipped)` : ''}`
                );
            }
            if (onSuccess) onSuccess();
        } catch (error: any) {
            console.error('Import failed:', error);
            const status = error.response?.status;
            const errorMsg =
                error.response?.data?.error ||
                error.response?.data?.message ||
                (isAr ? 'فشل الاستيراد' : 'Import failed');
            if (status === 422) {
                toast.error(
                    isAr
                        ? errorMsg || 'تم رفض الشيت: يوجد أخطاء أو نقص مخزون يمنع الاستيراد.'
                        : errorMsg || 'Import rejected: fix catalog or stock issues first.'
                );
            } else {
                toast.error(errorMsg);
            }
        } finally {
            setIsImporting(false);
        }
    };

    const handleClose = () => {
        previewReqSeq.current++;
        setFile(null);
        setChannelId('');
        setChannelMode('auto');
        setResults(null);
        setPreview(null);
        setPreviewRowFilter('all');
        setRollbackBusy(false);
        setRetryBusy(false);
        setRetryPreview(null);
        setRetryDays('1');
        onOpenChange(false);
    };

    const handleRetryStockPreview = async () => {
        setRetryBusy(true);
        setRetryPreview(null);
        try {
            const days = Math.max(0, Number(retryDays) || 1);
            const res = await api.post('marketplace/import/retry-stock-deductions', {
                days,
                dry_run: true,
            });
            setRetryPreview(res?.details ?? res);
            const d = res?.details ?? res;
            toast.success(
                isAr
                    ? `معاينة: ${d?.scanned ?? 0} بند — سيُخصم ${d?.deducted ?? 0}، سبق خصمه ${d?.already_deducted ?? 0}`
                    : `Preview: ${d?.scanned ?? 0} lines — would deduct ${d?.deducted ?? 0}, already done ${d?.already_deducted ?? 0}`
            );
        } catch (error: any) {
            toast.error(
                error.response?.data?.error ||
                    error.response?.data?.message ||
                    (isAr ? 'تعذر المعاينة' : 'Preview failed')
            );
        } finally {
            setRetryBusy(false);
        }
    };

    const handleRetryStockRun = async () => {
        const would = Number(retryPreview?.deducted ?? 0);
        const scanned = Number(retryPreview?.scanned ?? 0);
        const msg = isAr
            ? `إعادة خصم المخزون للبنود الناقصة خلال آخر ${retryDays} يوم(أيام):\n• معاينة: ${scanned} بند، سيُخصم تقريباً ${would}\n• لن يُخصم مرتين إن وُجدت حركة OUT سابقة\nالمتابعة؟`
            : `Retry stock deduction for pending lines in the last ${retryDays} day(s):\n• Preview: ${scanned} line(s), ~${would} would deduct\n• Will not double-deduct if an OUT already exists\nContinue?`;
        if (!window.confirm(msg)) {
            return;
        }
        setRetryBusy(true);
        try {
            const days = Math.max(0, Number(retryDays) || 1);
            const res = await api.post('marketplace/import/retry-stock-deductions', {
                days,
                dry_run: false,
            });
            const d = res?.details ?? res;
            setRetryPreview(d);
            toast.success(
                isAr
                    ? `تم: خُصم ${d?.deducted ?? 0}، نواقص ${d?.shortage ?? 0}، سبق خصمه ${d?.already_deducted ?? 0}`
                    : `Done: deducted ${d?.deducted ?? 0}, shortage ${d?.shortage ?? 0}, already ${d?.already_deducted ?? 0}`
            );
            void queryClient.invalidateQueries({ queryKey: ['orders'] });
            void queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
            if (onSuccess) onSuccess();
        } catch (error: any) {
            toast.error(
                error.response?.data?.error ||
                    error.response?.data?.message ||
                    (isAr ? 'تعذر إعادة الخصم' : 'Retry failed')
            );
        } finally {
            setRetryBusy(false);
        }
    };

    const handleRollbackLastImport = async () => {
        const n = Number(results?.rollback_stock_transactions ?? lastBatch?.transaction_count ?? 0);
        const o = Number(results?.rollback_new_orders ?? lastBatch?.new_orders_count ?? 0);
        const msg = isAr
            ? `التراجع الفوري عن آخر استيراد:\n• إرجاع المخزون من ${n} حركة خصم (إن وُجدت)\n• حذف ${o} طلباً أُنشئ في ذلك الاستيراد (وبنوده)\nلا يمكن التراجع. المتابعة؟`
            : `Immediate undo of your last import:\n• Restock from ${n} deduction line(s) if any\n• Delete ${o} order(s) created in that import (and their lines)\nCannot be undone. Continue?`;
        if (!window.confirm(msg)) {
            return;
        }
        setRollbackBusy(true);
        try {
            const res = await api.post('marketplace/import/rollback-last', {});
            const rev = Number(res?.details?.reversed ?? 0);
            const del = Number(res?.details?.orders_deleted ?? 0);
            toast.success(
                isAr
                    ? `تم الرجوع: ${rev} حركة مخزون، حُذف ${del} طلباً.`
                    : `Rollback done: ${rev} stock line(s), ${del} order(s) removed.`
            );
            void queryClient.invalidateQueries({ queryKey: ['marketplace-import-last-batch'] });
            void queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
            void queryClient.invalidateQueries({ queryKey: ['orders'] });
            void queryClient.invalidateQueries({ queryKey: ['orders-for-profit'] });
            setResults((prev: any) =>
                prev
                    ? {
                          ...prev,
                          rollback_available: false,
                          rollback_stock_transactions: 0,
                          rollback_new_orders: 0,
                      }
                    : prev
            );
            if (onSuccess) onSuccess();
        } catch (error: any) {
            const errorMsg =
                error.response?.data?.message ||
                error.response?.data?.error ||
                (isAr ? 'تعذر الاسترجاع' : 'Rollback failed');
            toast.error(errorMsg);
        } finally {
            setRollbackBusy(false);
        }
    };

    const downloadErrorReport = () => {
        if (!preview?.rows?.length && !(preview?.stock_shortages as any[])?.length) return;
        const blockingRows = (preview.rows as any[]).filter((r) => previewRowHasBlockingIssue(r));
        const shortageRows = ((preview.stock_shortages as any[]) || []).filter((s) => !s.is_backfill_warning);
        const csv = [
            ['row_number', 'status', 'catalog_issue', 'stock_issue', 'reason', 'uploaded_order_number', 'uploaded_sku', 'existing_order_number'].join(','),
            ...blockingRows.map((r) => {
                const ci = r.catalog_issue;
                const catalogText =
                    ci && typeof ci === 'object'
                        ? isAr
                            ? String(ci.ar ?? '')
                            : String(ci.en ?? ci.ar ?? '')
                        : '';
                const sp = r.stock_preview;
                const stockText = sp?.shortage
                    ? previewRowIssueText(r, isAr).text
                    : '';
                return [
                    r.row_number,
                    r.status,
                    `"${catalogText.replace(/"/g, '""')}"`,
                    `"${stockText.replace(/"/g, '""')}"`,
                    `"${String(r.reason || '').replace(/"/g, '""')}"`,
                    r.uploaded_data?.order_number || '',
                    r.uploaded_data?.sku || '',
                    r.existing_data?.order_number || '',
                ].join(',');
            }),
            ...shortageRows
                .filter((s) => !blockingRows.some((r) => r.uploaded_data?.order_number === s.platform_order_id))
                .map((s) =>
                    [
                        '',
                        'stock_shortage',
                        '""',
                        `"${String(isAr ? s.message_ar : s.message_en || s.message_ar || '').replace(/"/g, '""')}"`,
                        '""',
                        s.platform_order_id || '',
                        s.sku_code_sheet || s.sku_code_internal || '',
                        '',
                    ].join(',')
                ),
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'orders-import-errors.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    };

    const getStatusMeta = (status: string) => {
        if (status === 'new') return { label: 'New Order', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
        if (status === 'update') return { label: 'Update Order', className: 'bg-blue-500/10 text-blue-400 border-blue-500/30' };
        if (status === 'duplicate') return { label: 'Already Exists', className: 'bg-amber-500/10 text-amber-400 border-amber-500/30' };
        return { label: 'Catalog / SKU error', className: 'bg-rose-500/10 text-rose-400 border-rose-500/30' };
    };

    const previewAllRows = preview?.rows || [];
    const previewIssueRowCount = useMemo(() => {
        const fromApi = Number(preview?.preview_issue_row_count);
        if (Number.isFinite(fromApi) && fromApi >= 0) {
            return fromApi;
        }
        const catalogErr = Number(preview?.summary?.errors ?? 0);
        const stockBlocking = Number(preview?.blocking_shortage_count ?? preview?.stock_shortage_count ?? 0);
        return catalogErr + stockBlocking;
    }, [preview]);
    const previewDisplayRows = useMemo(() => {
        if (previewRowFilter === 'issues') {
            return previewAllRows.filter((row: any) => previewRowHasBlockingIssue(row));
        }
        return previewAllRows;
    }, [previewAllRows, previewRowFilter]);

    const downloadTemplate = (templateType: 'all-orders' | 'amazon-fba' | 'amazon-fbm') => {
        const templates: Record<'all-orders' | 'amazon-fba' | 'amazon-fbm', { filename: string; content: string; mime: string }> = {
            'all-orders': {
                filename: 'orders-template-all-orders.txt',
                mime: 'text/plain;charset=utf-8;',
                // Matches the "all orders" export headers (tab-delimited).
                content:
                    'amazon-order-id\tmerchant-order-id\tpurchase-date\tlast-updated-date\torder-status\tfulfillment-channel\tsales-channel\torder-channel\turl\tship-service-level\tproduct-name\tsku\tasin\titem-status\tquantity\tcurrency\titem-price\titem-tax\tshipping-price\tshipping-tax\tgift-wrap-price\tgift-wrap-tax\titem-promotion-discount\tship-promotion-discount\tship-city\tship-state\tship-postal-code\tship-country\tpromotion-ids\tfulfilled-by',
            },
            'amazon-fba': {
                filename: 'orders-template-amazon-fba.csv',
                mime: 'text/csv;charset=utf-8;',
                // Matches Amazon shipped-by-Amazon Arabic CSV export headers.
                content:
                    '"رقم الطلب من أمازون","رقم طلب التاجر","رقم الشحنة","رقم المنتج بالشحنة","رقم منتجات الطلب من أمازون","رقم منتجات طلب التاجر","تاريخ الشراء","تاريخ المدفوعات","تاريخ الشحن","تاريخ الإبلاغ","البريد الإلكتروني للمشتري","اسم المشتري","رقم هاتف المشتري","رقم تخزين سلعة التاجر MSKU","العنوان","الكمية المشحونة","العملة","سعر المنتج","ضريبة المنتج","سعر الشحن","ضريبة الشحن","سعر تغليف الهدية","ضريبة تغليف الهدايا","مستوى خدمة الشحن","اسم المستلم","عنوان الشحن 1","عنوان الشحن 2","عنوان الشحن 3","مدينة الشحن","ولاية الشحن","الرمز البريدي للشحن","رمز بلد الشحن","رقم هاتف الشحن","عنوان الفوترة 1","عنوان الفوترة 2","عنوان الفوترة 3","مدينة الفوترة","ولاية الفوترة","bill-postal-code","bill-country","عرض خصم خاص بالمنتج","عرض خصم خاص بالشحنة","الناقل","رقم التتبع","تاريخ الوصول المقدر","حاوية كاملة الحمولة","قناة الشحن","قناة المبيعات"',
            },
            'amazon-fbm': {
                filename: 'orders-template-amazon-fbm.txt',
                mime: 'text/plain;charset=utf-8;',
                // Matches Amazon shipped-by-merchant report headers (tab-delimited).
                content:
                    'order-id\torder-item-id\tpurchase-date\tpayments-date\tbuyer-email\tbuyer-name\tbuyer-phone-number\tsku\tproduct-name\tquantity-purchased\tcurrency\titem-price\titem-tax\tshipping-price\tshipping-tax\tship-service-level\trecipient-name\tship-address-1\tship-address-2\tship-address-3\tship-city\tship-state\tship-county\tship-postal-code\tship-country\tship-phone-number\tdelivery-start-date\tdelivery-end-date\tdelivery-time-zone\tdelivery-Instructions\tpayment-method\tcod-collectible-amount\talready-paid\tpayment-method-fee\tfulfilled-by\tshipment-status',
            },
        };

        const template = templates[templateType];
        const blob = new Blob(["\uFEFF" + template.content + '\n'], { type: template.mime });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = template.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent
                className={
                    results || preview
                        ? 'flex h-[96vh] max-h-[96vh] w-[99vw] max-w-[99vw] flex-col gap-0 overflow-hidden p-3 sm:p-4'
                        : 'max-w-2xl'
                }
            >
                <DialogHeader className="shrink-0 space-y-1 pb-2">
                    <DialogTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="w-5 h-5 text-emerald-500" />
                        {isAr ? 'استيراد الطلبات' : 'Import Orders'}
                    </DialogTitle>
                </DialogHeader>

                <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overscroll-contain py-2 pe-0.5">
                    {!results && !preview ? (
                        <>
                            <div className="space-y-3">
                                <Label className="text-sm font-semibold">
                                    {isAr ? 'كيف نحدد قناة البيع؟' : 'How should we assign the sales channel?'}
                                </Label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setChannelMode('auto');
                                            if (defaultAnchorChannelId) {
                                                setChannelId(defaultAnchorChannelId);
                                            }
                                        }}
                                        className={cn(
                                            'rounded-xl border-2 p-4 text-start transition-all hover:border-emerald-500/50',
                                            channelMode === 'auto'
                                                ? 'border-emerald-500 bg-emerald-500/10 shadow-sm'
                                                : 'border-border bg-muted/20',
                                        )}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div
                                                className={cn(
                                                    'rounded-lg p-2 shrink-0',
                                                    channelMode === 'auto' ? 'bg-emerald-500/20 text-emerald-600' : 'bg-muted text-muted-foreground',
                                                )}
                                            >
                                                <ScanLine className="w-5 h-5" />
                                            </div>
                                            <div className="min-w-0 space-y-1">
                                                <p className="font-semibold text-sm text-foreground">
                                                    {isAr ? 'تحديد من الشيت' : 'Detect from sheet'}
                                                </p>
                                                <p className="text-[11px] leading-relaxed text-muted-foreground">
                                                    {isAr
                                                        ? 'مثالي لشيت فيه تاجر + FBA معاً. النظام يقرأ fulfillment-channel ويختار القناة لكل صف تلقائياً — بدون إجبارك تختار قناة واحدة.'
                                                        : 'Best for mixed merchant + FBA sheets. Reads fulfillment-channel per row — no need to pick one channel upfront.'}
                                                </p>
                                            </div>
                                        </div>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setChannelMode('manual')}
                                        className={cn(
                                            'rounded-xl border-2 p-4 text-start transition-all hover:border-sky-500/50',
                                            channelMode === 'manual'
                                                ? 'border-sky-500 bg-sky-500/10 shadow-sm'
                                                : 'border-border bg-muted/20',
                                        )}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div
                                                className={cn(
                                                    'rounded-lg p-2 shrink-0',
                                                    channelMode === 'manual' ? 'bg-sky-500/20 text-sky-600' : 'bg-muted text-muted-foreground',
                                                )}
                                            >
                                                <Pin className="w-5 h-5" />
                                            </div>
                                            <div className="min-w-0 space-y-1">
                                                <p className="font-semibold text-sm text-foreground">
                                                    {isAr ? 'قناة واحدة محددة' : 'Single fixed channel'}
                                                </p>
                                                <p className="text-[11px] leading-relaxed text-muted-foreground">
                                                    {isAr
                                                        ? 'كل صفوف الشيت تُسجَّل في القناة التي تختارها (مثلاً FBA بولندا فقط).'
                                                        : 'Every row is saved under the channel you pick (e.g. FBA Poland only).'}
                                                </p>
                                            </div>
                                        </div>
                                    </button>
                                </div>

                                {channelMode === 'manual' ? (
                                    <div className="space-y-2 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
                                        <Label>{isAr ? 'قناة الرفع' : 'Upload channel'}</Label>
                                        <Select value={channelId} onValueChange={setChannelId}>
                                            <SelectTrigger>
                                                <SelectValue placeholder={isAr ? 'اختر القناة' : 'Select channel'} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {channels.map((c: any) => (
                                                    <SelectItem key={c.id} value={c.id.toString()}>
                                                        {c.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                ) : (
                                    <div className="space-y-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
                                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                                            {isAr
                                                ? 'النظام يحدد الحساب من SKU في الكتالوج (مثلاً Art مقابل فيزيولاين)، ثم يفرّق تاجر/FBA من fulfillment-channel. اختيار حساب مرجعي اختياري عند الشك.'
                                                : 'Account is inferred from catalog SKU (e.g. Art vs Phyzioline), then merchant/FBA from fulfillment-channel. Optional anchor if ambiguous.'}
                                        </p>
                                        <Label className="text-xs">{isAr ? 'حساب مرجعي (اختياري)' : 'Reference account (optional)'}</Label>
                                        <Select
                                            value={channelId || '__auto__'}
                                            onValueChange={(v) => setChannelId(v === '__auto__' ? '' : v)}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder={isAr ? 'تلقائي من SKU' : 'Auto from SKU'} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="__auto__">{isAr ? 'تلقائي من SKU / الشيت' : 'Auto from SKU / sheet'}</SelectItem>
                                                {channels.map((c: any) => (
                                                    <SelectItem key={c.id} value={c.id.toString()}>
                                                        {c.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                            </div>

                            <div className="border-2 border-dashed border-gray-800 rounded-xl p-8 text-center hover:border-emerald-500/50 transition-colors bg-gray-900/50">
                                <input
                                    type="file"
                                    accept=".xlsx,.xls,.csv,.txt"
                                    onChange={handleFileChange}
                                    className="hidden"
                                    id="order-upload-input"
                                />
                                <label htmlFor="order-upload-input" className="cursor-pointer">
                                    <Upload className="w-10 h-10 mx-auto mb-4 text-gray-500" />
                                    <p className="text-sm font-medium">
                                        {file ? file.name : (isAr ? 'اضغط لاختيار ملف Excel/CSV/TXT' : 'Click to select Excel/CSV/TXT file')}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-2">
                                        Supports Amazon, Noon exports (CSV/TXT/Excel)
                                    </p>
                                </label>
                            </div>
                            <div className="rounded-lg border border-border p-3 bg-muted/20 space-y-2">
                                <p className="text-xs text-muted-foreground">
                                    {isAr
                                        ? 'لو الاستيراد فشل بسبب عدم تطابق الأعمدة، نزّل القالب واملأ عليه ثم ارفعه.'
                                        : 'If import fails due to column mismatch, download the template, fill it, then upload it.'}
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="h-8 w-full px-3 text-xs font-medium justify-center"
                                        onClick={() => downloadTemplate('all-orders')}
                                    >
                                        <Download className="w-3.5 h-3.5 me-1.5 shrink-0" />
                                        {isAr ? 'كل الطلبات' : 'All Orders'}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="h-8 w-full px-3 text-xs font-medium justify-center"
                                        onClick={() => downloadTemplate('amazon-fba')}
                                    >
                                        <Download className="w-3.5 h-3.5 me-1.5 shrink-0" />
                                        {isAr ? 'أمازون FBA' : 'Amazon FBA'}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="h-8 w-full px-3 text-xs font-medium justify-center"
                                        onClick={() => downloadTemplate('amazon-fbm')}
                                    >
                                        <Download className="w-3.5 h-3.5 me-1.5 shrink-0" />
                                        {isAr ? 'أمازون FBM' : 'Amazon FBM'}
                                    </Button>
                                </div>
                            </div>

                            <div className="rounded-lg border border-amber-500/35 bg-amber-500/5 p-3 space-y-2">
                                <p className="text-sm font-medium text-foreground">
                                    {isAr ? 'إعادة خصم النواقص (بدون رفع الشيت)' : 'Retry pending deductions (no sheet)'}
                                </p>
                                <p className="text-[11px] text-muted-foreground leading-relaxed">
                                    {isAr
                                        ? 'للطلبات المسجّلة بنقص مخزون أو بدون خصم سابق. يتحقق من عدم وجود حركة OUT قبل الخصم — لا دبلرة.'
                                        : 'For shortage / legacy undeducted lines. Checks for an existing OUT before deducting — no double sell.'}
                                </p>
                                <div className="flex flex-wrap items-end gap-2">
                                    <div className="space-y-1">
                                        <Label className="text-xs">{isAr ? 'آخر كام يوم' : 'Last N days'}</Label>
                                        <Input
                                            type="number"
                                            min={0}
                                            max={366}
                                            className="w-24 h-8"
                                            value={retryDays}
                                            onChange={(e) => setRetryDays(e.target.value)}
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={retryBusy}
                                        onClick={() => void handleRetryStockPreview()}
                                    >
                                        {retryBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ScanLine className="w-4 h-4 mr-1" />}
                                        {isAr ? 'معاينة' : 'Preview'}
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="bg-amber-600 hover:bg-amber-700 text-white"
                                        disabled={retryBusy || !retryPreview}
                                        onClick={() => void handleRetryStockRun()}
                                    >
                                        {retryBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                                        {isAr ? 'تنفيذ الخصم' : 'Run deduction'}
                                    </Button>
                                </div>
                                {retryPreview ? (
                                    <p className="text-[11px] text-muted-foreground">
                                        {isAr
                                            ? `نتيجة: ممسوح ${retryPreview.scanned} · سيُخصم/خُصم ${retryPreview.deducted} · سبق ${retryPreview.already_deducted} · نقص ${retryPreview.shortage} · تجاهل ${retryPreview.skipped}`
                                            : `Result: scanned ${retryPreview.scanned} · deduct ${retryPreview.deducted} · already ${retryPreview.already_deducted} · shortage ${retryPreview.shortage} · skipped ${retryPreview.skipped}`}
                                        {retryPreview.dry_run ? (isAr ? ' (معاينة فقط)' : ' (preview only)') : ''}
                                    </p>
                                ) : null}
                            </div>
                        </>
                    ) : preview && !results ? (
                        <div className="flex min-h-0 flex-1 flex-col gap-3">
                            {preview.import_blocked ? (
                                <Alert variant="destructive" className="border-red-500/40">
                                    <AlertTitle>{isAr ? 'لا يمكن تأكيد هذا الشيت' : 'Import cannot be confirmed'}</AlertTitle>
                                    <AlertDescription className="text-sm whitespace-pre-wrap">
                                        {isAr
                                            ? preview.import_blocked_message_ar ||
                                              'أصلِح صفوف SKU غير المربوطة أو نقص المخزون للصفوف التي تتطلب خصماً ثم أعد المعاينة.'
                                            : 'Fix unlinked SKUs or insufficient stock for rows that require deduction, then preview again.'}
                                    </AlertDescription>
                                </Alert>
                            ) : null}

                            {(() => {
                                const catalogErr = Number(preview.summary?.errors ?? 0);
                                const stockBlocking = Number(preview.blocking_shortage_count ?? preview.stock_shortage_count ?? 0);
                                const stockBackfill = Number(preview.backfill_shortage_count ?? 0);
                                const problemRows = catalogErr + stockBlocking;
                                if (problemRows <= 0 && stockBackfill <= 0) return null;
                                return (
                                    <div className="rounded-lg border border-rose-500/35 bg-rose-500/[0.07] px-3 py-2.5 text-sm">
                                        <span className="font-semibold text-rose-800 dark:text-rose-300">
                                            {isAr ? 'عدد الصفوف التي بها مشكلة:' : 'Rows with issues:'}
                                        </span>{' '}
                                        <strong className="text-lg tabular-nums">{problemRows}</strong>
                                        <span className="text-muted-foreground ms-2">
                                            {isAr ? (
                                                <>
                                                    (ربط منتج: <strong>{catalogErr}</strong> — نقص مخزون يمنع: <strong>{stockBlocking}</strong>
                                                    {stockBackfill > 0 ? (
                                                        <> — خصم متأخر (تحذير): <strong>{stockBackfill}</strong></>
                                                    ) : null}
                                                    )
                                                </>
                                            ) : (
                                                <>
                                                    (catalog: <strong>{catalogErr}</strong> — blocking stock: <strong>{stockBlocking}</strong>
                                                    {stockBackfill > 0 ? (
                                                        <> — backfill warn: <strong>{stockBackfill}</strong></>
                                                    ) : null}
                                                    )
                                                </>
                                            )}
                                        </span>
                                    </div>
                                );
                            })()}

                            <Alert className="bg-slate-500/10 border-slate-500/20 shrink-0">
                                <AlertTitle className="flex flex-wrap items-center gap-2">
                                    <span>{isAr ? 'معاينة الاستيراد' : 'Import Preview'}</span>
                                    {isSilentPreviewRefresh ? (
                                        <span className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
                                            <RefreshCw className="h-3 w-3 animate-spin" />
                                            {isAr ? 'تحديث تلقائي…' : 'Live refresh…'}
                                        </span>
                                    ) : null}
                                </AlertTitle>
                                <AlertDescription className="text-xs text-muted-foreground mb-2">
                                    {isAr
                                        ? 'عمود «المشكلة» بجانب رقم الطلب يوضح سبب المنع لكل سطر قبل «تأكيد الاستيراد». أعلاه: إجمالي عدد الصفوف ذات المشكلة.'
                                        : 'The Issue column next to each order explains why that row blocks import. Above: total count of problematic rows.'}
                                </AlertDescription>
                                <AlertDescription>
                                    <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                                        <div>{isAr ? 'إجمالي الصفوف:' : 'Total Rows:'} <strong>{preview.summary?.total_rows ?? 0}</strong></div>
                                        <div className="text-emerald-400">{isAr ? 'طلبات جديدة:' : 'New Orders:'} <strong>{preview.summary?.new_orders ?? 0}</strong></div>
                                        <div className="text-blue-400">{isAr ? 'طلبات تحديث:' : 'Update Orders:'} <strong>{preview.summary?.update_orders ?? 0}</strong></div>
                                        <div className="text-amber-400">{isAr ? 'مكررة:' : 'Duplicates:'} <strong>{preview.summary?.duplicates ?? 0}</strong></div>
                                        <div className="text-rose-400">{isAr ? 'أخطاء كتالوج:' : 'Catalog errors:'} <strong>{preview.summary?.errors ?? 0}</strong></div>
                                        <div className="text-rose-400/90">
                                            {isAr ? 'نقص مخزون (يمنع):' : 'Stock shortage (blocks):'}{' '}
                                            <strong>{preview.blocking_shortage_count ?? preview.stock_shortage_count ?? 0}</strong>
                                        </div>
                                        {Number(preview.backfill_shortage_count ?? 0) > 0 ? (
                                            <div className="text-amber-500">
                                                {isAr ? 'خصم متأخر (تحذير):' : 'Backfill (warn):'}{' '}
                                                <strong>{preview.backfill_shortage_count}</strong>
                                            </div>
                                        ) : null}
                                        <div>{isAr ? 'سيتم استيراد:' : 'Will Import:'} <strong>{preview.summary?.will_import ?? 0}</strong></div>
                                        <div>{isAr ? 'سيتم تجاهل:' : 'Ignored:'} <strong>{preview.summary?.ignored ?? 0}</strong></div>
                                        <div>{isAr ? 'صفوف المعاينة:' : 'Rows Shown:'} <strong>{preview.rows_shown ?? 0}</strong></div>
                                    </div>
                                </AlertDescription>
                            </Alert>
                            <Alert className="bg-amber-500/10 border-amber-500/30 shrink-0">
                                <AlertTitle>{isAr ? 'المخزون' : 'Inventory'}</AlertTitle>
                                <AlertDescription className="text-xs leading-relaxed">
                                    {isAr
                                        ? 'الخصم للطلبات الجديدة أو سطر SKU جديد على طلب موجود. الصف المكرر (نفس الطلب + SKU + الكمية) يُتجاهل. إن كان الطلب موجوداً لكن بدون حركة OUT سابقة يظهر «خصم متأخر» كتحذير فقط ولا يمنع التأكيد. الطلبات الجديدة الحقيقية بنقص مخزون تمنع التأكيد حتى يتوفر الرصيد.'
                                        : 'Stock deducts for new orders or new SKU lines on existing orders. Exact duplicate rows (same order + SKU + qty) are skipped. Missing OUT on an existing line shows as backfill warning only — not a blocker. Truly new rows with insufficient stock still block confirm.'}
                                </AlertDescription>
                            </Alert>

                            <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={previewRowFilter === 'issues' ? 'default' : 'outline'}
                                        className={previewRowFilter === 'issues' ? 'bg-rose-600 hover:bg-rose-700 text-white' : ''}
                                        disabled={previewIssueRowCount === 0}
                                        onClick={() => setPreviewRowFilter('issues')}
                                    >
                                        <Filter className="w-4 h-4 me-1" />
                                        {isAr
                                            ? `عرض المشاكل (${previewIssueRowCount})`
                                            : `Show issues (${previewIssueRowCount})`}
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={previewRowFilter === 'all' ? 'default' : 'outline'}
                                        onClick={() => setPreviewRowFilter('all')}
                                    >
                                        <List className="w-4 h-4 me-1" />
                                        {isAr
                                            ? `عرض الكل (${previewAllRows.length})`
                                            : `Show all (${previewAllRows.length})`}
                                    </Button>
                                </div>
                                {previewRowFilter === 'issues' ? (
                                    <span className="text-xs text-muted-foreground tabular-nums">
                                        {isAr
                                            ? `يعرض ${previewDisplayRows.length} من ${previewAllRows.length} صف`
                                            : `Showing ${previewDisplayRows.length} of ${previewAllRows.length} rows`}
                                    </span>
                                ) : null}
                            </div>

                            <div className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto rounded-lg border border-border [scrollbar-gutter:stable]">
                                <table className="w-full min-w-[960px] max-w-full table-fixed border-collapse text-sm">
                                    <colgroup>
                                        <col className="w-[3%]" />
                                        <col className="w-[10%]" />
                                        <col className="w-[8%]" />
                                        <col className="w-[20%]" />
                                        <col className="w-[9%]" />
                                        <col className="w-[4%]" />
                                        <col className="w-[6%]" />
                                        <col className="w-[10%]" />
                                        <col className="w-[9%]" />
                                        <col className="w-[10%]" />
                                        <col className="w-[9%]" />
                                    </colgroup>
                                    <thead className="bg-muted/30 sticky top-0 z-10 shadow-sm">
                                        <tr>
                                            <th className="text-start p-2.5">#</th>
                                            <th className="text-start p-2.5">Order</th>
                                            <th className="text-start p-2.5">{isAr ? 'تاريخ الطلب' : 'Order date'}</th>
                                            <th className="text-start p-2.5">{isAr ? 'المشكلة' : 'Issue'}</th>
                                            <th className="text-start p-2.5">SKU</th>
                                            <th className="text-start p-2.5">Qty</th>
                                            <th className="text-start p-2.5">{isAr ? 'سعر' : 'Price'}</th>
                                            <th className="text-start p-2.5">{isAr ? 'القناة' : 'Channel'}</th>
                                            <th className="text-start p-2.5">Status</th>
                                            <th className="text-start p-2.5">{isAr ? 'سياق' : 'Context'}</th>
                                            <th className="text-start p-2.5">{isAr ? 'قديم' : 'Old'}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {previewDisplayRows.length === 0 ? (
                                            <tr>
                                                <td colSpan={11} className="p-8 text-center text-sm text-muted-foreground">
                                                    {previewRowFilter === 'issues'
                                                        ? isAr
                                                            ? 'لا توجد صفوف بمشاكل في المعاينة الحالية.'
                                                            : 'No problematic rows in the current preview.'
                                                        : isAr
                                                          ? 'لا توجد صفوف.'
                                                          : 'No rows.'}
                                                </td>
                                            </tr>
                                        ) : (
                                            previewDisplayRows.map((row: any) => {
                                            const meta = getStatusMeta(row.status);
                                            const issue = previewRowIssueText(row, isAr);
                                            const reasonStr = String(row.reason || '').trim();
                                            const showReason = reasonStr !== '' && reasonStr !== '—';
                                            return (
                                                <tr
                                                    key={row.row_number}
                                                    className={`border-t border-border/50 ${issue.hasIssue ? 'bg-rose-500/[0.06]' : ''}`}
                                                >
                                                    <td className="p-2.5 align-top">{row.row_number}</td>
                                                    <td className="p-2.5 align-top font-mono break-all">{row.uploaded_data?.order_number || '—'}</td>
                                                    <td className="p-2.5 align-top text-[11px] tabular-nums whitespace-nowrap">
                                                        {formatPreviewOrderDate(row.uploaded_data?.order_date)}
                                                    </td>
                                                    <td className="p-2.5 align-top">
                                                        <span
                                                            className={`block max-h-32 overflow-y-auto break-words leading-snug ${
                                                                issue.hasIssue
                                                                    ? 'text-rose-700 dark:text-rose-300 font-medium'
                                                                    : 'text-muted-foreground'
                                                            }`}
                                                            title={issue.hasIssue ? issue.text : undefined}
                                                        >
                                                            {issue.text}
                                                        </span>
                                                    </td>
                                                    <td className="p-2.5 align-top break-all">{row.uploaded_data?.sku || '—'}</td>
                                                    <td className="p-2.5 align-top">{row.uploaded_data?.quantity ?? '—'}</td>
                                                    <td className="p-2.5 align-top tabular-nums">
                                                        {Number(row.uploaded_data?.unit_price || 0).toLocaleString()}
                                                    </td>
                                                    <td className="p-2 align-top break-words">{row.uploaded_data?.channel || '—'}</td>
                                                    <td className="p-2 align-top">
                                                        <span className={`inline-flex max-w-full flex-wrap px-1.5 py-0.5 rounded border text-[10px] ${meta.className}`}>
                                                            {meta.label}
                                                        </span>
                                                    </td>
                                                    <td className="p-2 align-top">
                                                        {showReason ? (
                                                            <span
                                                                className="text-muted-foreground block max-h-20 overflow-y-auto break-words text-[10px] leading-snug"
                                                                title={row.reason}
                                                            >
                                                                {row.reason}
                                                            </span>
                                                        ) : (
                                                            <span className="text-muted-foreground">—</span>
                                                        )}
                                                    </td>
                                                    <td className="p-2 align-top break-words text-[10px]">
                                                        {row.existing_data?.order_number ? (
                                                            <div className="space-y-0.5">
                                                                <div className="font-mono break-all">{row.existing_data.order_number}</div>
                                                                {row.uploaded_data?.matched_order_number &&
                                                                row.uploaded_data.matched_order_number !== row.uploaded_data?.order_number ? (
                                                                    <div className="text-amber-600 dark:text-amber-400">
                                                                        {isAr ? 'وُجد عبر: ' : 'Matched via: '}
                                                                        {row.uploaded_data.matched_order_number}
                                                                    </div>
                                                                ) : null}
                                                                <div className="text-muted-foreground">{row.existing_data.channel || '—'}</div>
                                                                {row.existing_data.order_date && (
                                                                    <div className="text-muted-foreground">
                                                                        {isAr ? 'تاريخ الطلب: ' : 'Order: '}
                                                                        {formatPreviewOrderDate(row.existing_data.order_date)}
                                                                    </div>
                                                                )}
                                                                {row.existing_data.imported_at && (
                                                                    <div className="text-muted-foreground">
                                                                        {isAr ? 'استُورد: ' : 'Imported: '}
                                                                        {formatPreviewOrderDate(row.existing_data.imported_at)}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            '—'
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {preview.truncated ? (
                                <p className="text-xs text-amber-500">
                                    {isAr
                                        ? `تم عرض أول ${Math.min(2000, preview.summary?.total_rows ?? 0)} صفاً${previewIssueRowCount > 0 ? ' + كل الصفوف ذات المشكلة' : ''} (${preview.rows_shown ?? '…'} في الجدول)؛ التحليل الكامل يشمل ${preview.summary?.total_rows ?? '…'} صفاً.`
                                        : `Table shows first ${Math.min(2000, preview.summary?.total_rows ?? 0)} rows${previewIssueRowCount > 0 ? ' plus all blocking-issue rows' : ''} (${preview.rows_shown ?? '…'} in table); analysis covers all ${preview.summary?.total_rows ?? '…'} rows.`}
                                </p>
                            ) : null}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <Alert className="bg-emerald-500/10 border-emerald-500/20 text-emerald-500">
                                <CheckCircle className="w-4 h-4" />
                                <AlertTitle>{isAr ? 'اكتمل الاستيراد' : 'Import Complete'}</AlertTitle>
                                <AlertDescription>
                                    <div className="mt-2 space-y-1 text-sm">
                                        <div>{isAr ? 'إجمالي الصفوف:' : 'Total Rows:'} <strong>{results.total}</strong></div>
                                        <div>{isAr ? 'تم استيرادها:' : 'Imported:'} <strong className="text-emerald-400">{results.imported}</strong></div>
                                        <div>{isAr ? 'تم تجاهلها (مكرر/بدون تغيير):' : 'Skipped (duplicate/no change):'} <strong>{results.skipped}</strong></div>
                                        {results.failed > 0 && (
                                            <div className="text-rose-400">{isAr ? 'فشلت:' : 'Failed:'} <strong>{results.failed}</strong></div>
                                        )}
                                    </div>
                                </AlertDescription>
                            </Alert>

                            {(Boolean(results?.rollback_available) || Boolean(lastBatch?.available)) && (
                                <Alert className="border-border bg-muted/30">
                                    <AlertTitle className="flex items-center gap-2">
                                        <RotateCcw className="w-4 h-4" />
                                        {isAr ? 'التراجع عن آخر استيراد' : 'Undo last import'}
                                    </AlertTitle>
                                    <AlertDescription className="space-y-2 text-xs leading-relaxed">
                                        <p>
                                            {isAr
                                                ? 'يعيد المخزون من حركات الخصم المسجّلة، ويحذف الطلبات التي أُنشئت في ذلك الاستيراد فقط (مع بنودها)، ويزيل حركات الاستيراد المرتبطة بها بعد فك ارتباط التسويات الاختيارية. لا يعيد طلبات قديمة عدّلها نفس الملف.'
                                                : 'Restocks from recorded deduction lines, deletes only orders created in that import (and their lines), clears linked ImportedOrder movements after optional link cleanup. It does not revert older orders that were only updated by the sheet.'}
                                        </p>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="gap-2"
                                            disabled={rollbackBusy}
                                            onClick={() => void handleRollbackLastImport()}
                                        >
                                            {rollbackBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                                            {isAr ? 'استرجاع آخر استيراد' : 'Rollback last import'}
                                        </Button>
                                    </AlertDescription>
                                </Alert>
                            )}

                            {results.errors?.length > 0 && (
                                <div className="max-h-40 overflow-y-auto space-y-2">
                                    {results.errors.map((err: string, i: number) => (
                                        <Alert key={i} variant="destructive" className="py-2">
                                            <XCircle className="w-4 h-4" />
                                            <AlertDescription className="text-xs">{err}</AlertDescription>
                                        </Alert>
                                    ))}
                                </div>
                            )}

                            {Number(results.stock_shortage_count ?? results.stock_shortages?.length ?? 0) > 0 && (
                                <Alert className="border-amber-500/40 bg-amber-500/10">
                                    <AlertTitle className="text-amber-700 dark:text-amber-400">
                                        {isAr ? 'تنبيه مخزون — لم يُخصم' : 'Stock warning — not deducted'}
                                    </AlertTitle>
                                    <AlertDescription className="text-xs space-y-2 max-h-48 overflow-y-auto">
                                        <p>
                                            {isAr
                                                ? 'التحذير حقيقي: خصم المخزون لم يُنفَّذ للأسطر أدناه (رصيد غير كافٍ). إن كانت المعاينة نظيفة قبل الاستيراد، غالباً تغيّر الرصيد بين المعاينة والتأكيد — أعد المعاينة ثم استورد. طلبات قديمة بدون خصم سابق تظهر الآن في المعاينة قبل الرفع.'
                                                : 'This warning is real: stock was NOT deducted for the lines below (insufficient quantity). If preview was clean, inventory likely changed between preview and confirm — preview again, then import. Legacy orders missing prior deduction now show in preview before upload.'}
                                        </p>
                                        <ul className="list-disc ps-4 space-y-1">
                                            {(results.stock_shortages as any[]).map((row, i: number) => (
                                                <li key={i}>
                                                    <span className="me-2">
                                                        {isAr ? row.message_ar : row.message_en || row.message_ar}
                                                    </span>
                                                    {Boolean(row?.deducts_from_store_bucket) ? (
                                                        <span className="inline-flex items-center rounded border border-red-500/45 bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-700 dark:text-red-300">
                                                            {isAr ? 'لا يوجد مخزون بالمحل' : 'No stock in store'}
                                                        </span>
                                                    ) : null}
                                                </li>
                                            ))}
                                        </ul>
                                    </AlertDescription>
                                </Alert>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter className="shrink-0 border-t border-border/60 bg-background pt-3 mt-2">
                    {!results && !preview ? (
                        <>
                            <Button variant="ghost" onClick={handleClose}>
                                {isAr ? 'إلغاء' : 'Cancel'}
                            </Button>
                            <Button
                                onClick={handlePreview}
                                disabled={!canStartPreview || isPreviewLoading}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                                {isPreviewLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                {isAr ? 'معاينة الشيت' : 'Preview Sheet'}
                            </Button>
                        </>
                    ) : preview && !results ? (
                        <>
                            <Button variant="ghost" onClick={() => { setPreview(null); setPreviewRowFilter('all'); }} disabled={isImporting}>
                                {isAr ? 'رجوع للتعديل' : 'Back'}
                            </Button>
                            <Button variant="outline" onClick={downloadErrorReport}>
                                <Download className="w-4 h-4 mr-2" />
                                {isAr ? 'تنزيل تقرير الأخطاء' : 'Download Error Report'}
                            </Button>
                            <Button
                                onClick={handleImport}
                                disabled={
                                    isImporting ||
                                    !file ||
                                    (preview.summary?.will_import ?? 0) <= 0 ||
                                    Boolean(preview.import_blocked)
                                }
                                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                title={
                                    preview.import_blocked
                                        ? isAr
                                            ? 'أصلِح أخطاء الشيت أو نقص المخزون أولاً'
                                            : 'Fix sheet errors or stock shortages first'
                                        : undefined
                                }
                            >
                                {isImporting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                {isAr ? 'تأكيد الاستيراد' : 'Confirm Import'}
                            </Button>
                        </>
                    ) : (
                        <Button onClick={handleClose} className="w-full">
                            {isAr ? 'إغلاق' : 'Close'}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
