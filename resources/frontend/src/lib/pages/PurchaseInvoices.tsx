import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    Plus,
    Search,
    Download,
    Trash2,
    FileText,
    DollarSign,
    TrendingDown,
    Clock,
    Printer,
    Eye,
    Loader2,
    RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePurchaseInvoices } from '@/hooks/usePurchases';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { PurchaseInvoiceDialog } from '@/components/invoices/PurchaseInvoiceDialog';
import PurchaseProductPicker from '@/components/invoices/PurchaseProductPicker';
import api from '@/lib/api';
import { getDefaultPrintBranding, printPurchaseInvoiceProfessional } from '@/lib/printUtils';
import {
    parsePurchasePaymentMeta,
    resolvePaidRemainingFromBatchNotes,
    resolvePurchasePaymentDisplayStatus,
} from '@/utils/purchasePaymentStatus';
import { purchaseInvoiceMatchesSearch } from '@/utils/purchaseInvoiceSearch';

export default function PurchaseInvoicesPage() {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const { t, language } = useLanguage();
    const isAr = language === 'ar';
    const [searchParams, setSearchParams] = useSearchParams();
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [savingDetails, setSavingDetails] = useState(false);
    const [addingDetailLine, setAddingDetailLine] = useState(false);
    const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);
    const [isEditingDetails, setIsEditingDetails] = useState(false);
    const [detailsForm, setDetailsForm] = useState({
        invoice_number: '',
        invoice_date: '',
        notes: '',
        paymentType: 'credit',
        supplier_ref: '',
        location_id: '',
    });
    const [detailsItems, setDetailsItems] = useState<Array<{
        id: number;
        raw_description: string;
        master_product_id: string;
        sku_id: string;
        sku_code: string;
        quantity: number;
        unit_price: number;
    }>>([]);

    const selectedInvoiceRef = useRef<any>(null);
    selectedInvoiceRef.current = selectedInvoice;

    const lineQuantityFromBatchItem = (item: any) =>
        Number(item?.received_quantity ?? item?.quantity ?? 0);

    const buildDetailsLineRows = (batchItems: any[]) =>
        (Array.isArray(batchItems) ? batchItems : []).map((item: any) => ({
            id: Number(item.id),
            raw_description: String(item?.raw_description || item?.master_product?.internal_name || item?.masterProduct?.internal_name || ''),
            master_product_id: item?.master_product_id ? String(item.master_product_id) : '',
            sku_id: item?.sku_id ? String(item.sku_id) : '',
            sku_code: String(item?.sku?.sku || item?.sku?.sku_code || ''),
            quantity: lineQuantityFromBatchItem(item),
            unit_price: Number(item?.unit_price || 0),
        }));

    const getDetailsRowForItem = (
        rows: typeof detailsItems,
        serverItem: any
    ): (typeof detailsItems)[number] =>
        rows.find((r) => Number(r.id) === Number(serverItem.id)) ?? buildDetailsLineRows([serverItem])[0];

    // Fetch purchase invoices from Supabase
    const { data: invoices, isLoading, refetch } = usePurchaseInvoices({ includeCancelled: true });
    const { data: vendors = [] } = useQuery({
        queryKey: ['vendors'],
        queryFn: () => api.getArray('/vendors'),
    });
    const { data: suppliers = [] } = useQuery({
        queryKey: ['suppliers'],
        queryFn: () => api.getArray('/suppliers'),
    });
    const { data: warehouses = [] } = useQuery({
        queryKey: ['warehouses'],
        queryFn: () => api.getArray('/warehouses'),
    });

    const pickerWarehouses = useMemo(
        () =>
            (warehouses || []).map((loc: any) => ({
                id: String(loc.id),
                name: loc.name,
                channel_id: loc.channel_id != null ? String(loc.channel_id) : null,
                type: loc.type,
            })),
        [warehouses]
    );
    const isEmptyInvoice = (invoice: any) => {
        const itemCount = Number(invoice?.item_count || 0);
        const totalAmount = Number(invoice?.total_amount || 0);
        const paidAmount = Number(invoice?.paid_amount || 0);
        return itemCount <= 0 && totalAmount <= 0 && paidAmount <= 0;
    };

    // Filter invoices
    const filteredInvoices = invoices?.filter((invoice) => {
        if (isEmptyInvoice(invoice)) return false;
        const matchesSearch = purchaseInvoiceMatchesSearch(invoice, searchQuery);

        // Default view hides cancelled invoices so "deleted" records stop affecting day-to-day list.
        const matchesStatus = statusFilter === 'all'
            ? invoice.status !== 'cancelled'
            : invoice.status === statusFilter;

        return matchesSearch && matchesStatus;
    });

    const emptyInvoices = (invoices || []).filter((invoice) => isEmptyInvoice(invoice));

    // Calculate stats
    const nonCancelledForStats = (filteredInvoices || []).filter((inv) => inv.status !== 'cancelled');
    const stats = {
        total: nonCancelledForStats.length,
        totalAmount: nonCancelledForStats.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0),
        paidAmount: nonCancelledForStats.reduce((sum, inv) => sum + Number(inv.paid_amount || 0), 0),
        // Open-style statuses only (exclude draft/review from this KPI count).
        pending: nonCancelledForStats.filter((inv) => {
            const s = String(inv.status || '').toLowerCase();
            return !['paid', 'cancelled', 'draft', 'review'].includes(s);
        }).length,
    };

    const handleExport = () => {
        if (!filteredInvoices || filteredInvoices.length === 0) {
            toast.error(t('purchases.export.noInvoices'));
            return;
        }
        toast.success(t('purchases.export.comingSoon'));
    };

    const handleCleanupEmptyInvoices = async () => {
        const candidates = emptyInvoices.filter((inv) => inv.status !== 'received');
        if (candidates.length === 0) {
            toast.error(t('purchases.cleanup.none'));
            return;
        }
        try {
            const results = await Promise.all(
                candidates.map((inv) =>
                    api.post(`purchases/smart-import/batches/${inv.id}/cancel`, {})
                        .then(() => ({ ok: true }))
                        .catch(() => ({ ok: false }))
                )
            );
            const successCount = results.filter((r) => r.ok).length;
            if (successCount > 0) {
                toast.success(`${t('purchases.cleanup.success')} (${successCount})`);
                await refetch();
            } else {
                toast.error(t('purchases.cleanup.failed'));
            }
        } catch {
            toast.error(t('purchases.cleanup.failed'));
        }
    };

    const handleDeleteInvoice = async (invoice: any) => {
        const isReceived = String(invoice?.backend_status || '').toLowerCase() === 'received';

        const confirmed = window.confirm(
            isReceived
                ? (
                    isAr
                        ? `الفاتورة ${invoice?.invoice_number || invoice?.id} مستلمة بالفعل.\nسيتم إلغاؤها محاسبيًا مع إرجاع/خصم المخزون المرتبط بها.\nقد يفشل الإلغاء إذا تم استهلاك المخزون بعد الاستلام.\nهل تريد المتابعة؟`
                        : `Invoice ${invoice?.invoice_number || invoice?.id} is already received.\nIt will be cancelled financially and its received stock will be rolled back.\nCancellation may fail if the stock was consumed after receiving.\nContinue?`
                )
                : (
                    isAr
                        ? `هل تريد حذف الفاتورة رقم ${invoice?.invoice_number || invoice?.id}؟`
                        : `Delete invoice ${invoice?.invoice_number || invoice?.id}?`
                )
        );
        if (!confirmed) return;

        setDeletingInvoiceId(String(invoice.id));
        try {
            await api.post(`purchases/smart-import/batches/${invoice.id}/cancel`, {
                keep_stock: false,
            });
            toast.success(isAr ? 'تم حذف الفاتورة' : 'Invoice deleted');
            await refetch();
            if (selectedInvoice?.id === invoice.id) {
                setIsDetailsOpen(false);
                setSelectedInvoice(null);
            }
        } catch (error: any) {
            toast.error(error?.response?.data?.message || (isAr ? 'فشل حذف الفاتورة' : 'Failed to delete invoice'));
        } finally {
            setDeletingInvoiceId(null);
        }
    };

    const handlePrintInvoice = async (invoice: any) => {
        try {
            const batch = await api.get(`purchases/smart-import/batches/${invoice.id}`);
            const printed = printPurchaseInvoiceProfessional({
                rtl: isAr,
                branding: getDefaultPrintBranding(),
                batch,
                labels: {
                    title: t('purchases.dialog.invoiceTitle'),
                    invoiceNo: t('purchases.dialog.invoiceNumber'),
                    date: t('purchases.dialog.invoiceDate'),
                    supplier: t('filters.supplier'),
                    supplierRef: isAr ? 'مرجع المورد' : 'Supplier ref.',
                    hash: '#',
                    product: t('table.product'),
                    qty: t('sales.qty'),
                    unitPrice: t('purchases.dialog.unitPrice'),
                    lineTotal: t('purchases.dialog.total'),
                    subtotal: t('purchases.dialog.subtotal'),
                    discount: isAr ? 'الخصم' : 'Discount',
                    tax: t('purchases.dialog.tax'),
                    grandTotal: t('purchases.dialog.grandTotal'),
                    notes: isAr ? 'ملاحظات' : 'Notes',
                    receivedBy: isAr ? 'المستلم / المحاسب' : 'Received by',
                    supplierSign: isAr ? 'اعتماد المورد' : 'Supplier acknowledgment',
                    accountPrevious: isAr ? 'الحساب السابق' : 'Previous balance',
                    paid: isAr ? 'المدفوع' : 'Paid',
                    remaining: isAr ? 'المتبقي' : 'Remaining',
                    accountPreviousHint: isAr ? '(من رصيد المورد الحالي)' : '(from current vendor balance)',
                },
            });
            if (!printed) {
                toast.error(t('purchases.print.allowPopups'));
            }
        } catch (e) {
            console.error('[print purchase invoice]', e);
            toast.error(t('purchases.print.failed'));
        }
    };

    const defaultPaymentTypeFromNotes = (rawNotes: any) => {
        const type = parsePurchasePaymentMeta(rawNotes).type;
        return (type === 'cash' || type === 'credit') ? type : 'credit';
    };

    const stripPaymentMetaFromNotes = (rawNotes: any) => {
        return String(rawNotes || '')
            .split('\n')
            .filter((line) => !String(line).trim().startsWith('[PAYMENT]'))
            .join('\n')
            .trim();
    };

    const paymentMetaPayload = (paymentType: 'cash' | 'credit') => ({
        payment_type: paymentType,
        ...(paymentType === 'credit' ? { paid_amount: 0 } : {}),
    });

    const resolveSupplierRefFromBatch = (batch: any) => {
        if (!batch) return '';
        if (batch?.supplier_id) return `supplier:${batch.supplier_id}`;
        if (batch?.vendor_id) {
            const vendorName = String(batch?.vendor?.name || '').trim().toLowerCase();
            if (vendorName) {
                const supplierMatch = supplierOptions.find(
                    (opt) => opt.value.startsWith('supplier:') && opt.label.trim().toLowerCase() === vendorName
                );
                if (supplierMatch) return supplierMatch.value;
            }
            const vendorMatch = supplierOptions.find((opt) => opt.value === `vendor:${batch.vendor_id}`);
            if (vendorMatch) return vendorMatch.value;
        }
        return '';
    };

    const canEditBatch = (status?: string | null) => {
        const normalized = String(status || '').toLowerCase();
        return ['draft', 'review', 'approved'].includes(normalized);
    };

    const canRelinkAfterReceive = (status?: string | null) => {
        return String(status || '').toLowerCase() === 'received';
    };

    const supplierOptions = useMemo(() => {
        const seen = new Set<string>();
        const options: Array<{ value: string; label: string }> = [];

        (suppliers || []).forEach((s: any) => {
            const label = String(s?.name || '').trim();
            if (!label) return;
            const key = label.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            options.push({ value: `supplier:${s.id}`, label });
        });

        (vendors || []).forEach((v: any) => {
            const label = String(v?.name || '').trim();
            if (!label) return;
            const key = label.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            options.push({ value: `vendor:${v.id}`, label });
        });

        return options;
    }, [suppliers, vendors]);

    const openInvoiceDetails = async (invoice: any) => {
        setIsDetailsOpen(true);
        setDetailsLoading(true);
        setIsEditingDetails(false);
        try {
            const batch = await api.get(`purchases/smart-import/batches/${invoice.id}`);
            setSelectedInvoice(batch);
            setDetailsForm({
                invoice_number: batch?.invoice_number || batch?.reference_number || invoice?.invoice_number || '',
                invoice_date: batch?.invoice_date ? String(batch.invoice_date).slice(0, 10) : '',
                notes: stripPaymentMetaFromNotes(batch?.notes || ''),
                paymentType: defaultPaymentTypeFromNotes(batch?.notes) as 'cash' | 'credit',
                supplier_ref: resolveSupplierRefFromBatch(batch),
                location_id: batch?.location_id ? String(batch.location_id) : '',
            });
            setDetailsItems(buildDetailsLineRows(batch?.items));
        } catch {
            toast.error(t('purchases.details.loadFailed'));
            setIsDetailsOpen(false);
        } finally {
            setDetailsLoading(false);
        }
    };

    const openInvoiceDetailsRef = useRef(openInvoiceDetails);
    openInvoiceDetailsRef.current = openInvoiceDetails;

    useEffect(() => {
        const raw = searchParams.get('batch');
        if (!raw) return;
        const batchId = String(raw).trim();
        if (!/^\d+$/.test(batchId)) {
            setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete('batch');
                return next;
            }, { replace: true });
            return;
        }
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete('batch');
            return next;
        }, { replace: true });
        void openInvoiceDetailsRef.current({ id: batchId });
    }, [searchParams, setSearchParams]);

    const remapDetailsItemsFromBatch = (batch: any) => {
        setDetailsItems(buildDetailsLineRows(batch?.items));
    };

    const saveInvoiceEdits = async () => {
        if (!selectedInvoice?.id) return;
        const canEditFull = canEditBatch(selectedInvoice?.status);
        const isReceived = canRelinkAfterReceive(selectedInvoice?.status);
        if (!canEditFull && !isReceived) {
            toast.error(
                isAr
                    ? 'لا يمكن تعديل هذه الفاتورة بعد الاستلام. احذفها/الغِها ثم أعد إنشاؤها أو استلامها مرة أخرى.'
                    : 'This invoice cannot be edited after receiving. Cancel/delete it and recreate or receive it again.'
            );
            return;
        }
        setSavingDetails(true);
        try {
            // Always persist payment type first (otherwise users think save failed).
            // For cash: mark as fully paid by default; for credit: keep paid amount as-is unless user explicitly changes it elsewhere.
            await api.post(`purchases/smart-import/batches/${selectedInvoice.id}/payment-meta`, paymentMetaPayload(detailsForm.paymentType as 'cash' | 'credit'));

            const [supplierType, supplierIdRaw] = String(detailsForm.supplier_ref || '').split(':');
            const supplierId = Number(supplierIdRaw || 0);
            const common = {
                vendor_id: supplierType === 'vendor' && supplierId > 0 ? supplierId : null,
                supplier_id: supplierType === 'supplier' && supplierId > 0 ? supplierId : null,
                location_id: detailsForm.location_id ? Number(detailsForm.location_id) : null,
                items: (Array.isArray(selectedInvoice?.items) ? selectedInvoice.items : []).map((serverItem: any) => {
                    const row = getDetailsRowForItem(detailsItems, serverItem);
                    return {
                        id: row.id,
                        raw_description: row.raw_description || null,
                        master_product_id: row.master_product_id ? Number(row.master_product_id) : null,
                        sku_id: row.sku_id ? Number(row.sku_id) : null,
                        quantity: Number(row.quantity || 0),
                        unit_price: Number(row.unit_price || 0),
                    };
                }),
            };
            const payload = isReceived
                ? {
                    // Received invoices: allow safe relink + line edits (stock/payables are adjusted server-side).
                    ...common,
                }
                : {
                    invoice_number: detailsForm.invoice_number || null,
                    invoice_date: detailsForm.invoice_date || null,
                    notes: stripPaymentMetaFromNotes(detailsForm.notes || null),
                    ...common,
                };
            const response = await api.put(`purchases/smart-import/batches/${selectedInvoice.id}`, payload);
            const refreshed = response?.batch || await api.get(`purchases/smart-import/batches/${selectedInvoice.id}`);
            setSelectedInvoice(refreshed);
            remapDetailsItemsFromBatch(refreshed);
            setIsEditingDetails(false);
            // Sync back the computed payment type from server notes.
            setDetailsForm((prev) => ({
                ...prev,
                paymentType: defaultPaymentTypeFromNotes(refreshed?.notes) as 'cash' | 'credit',
                notes: stripPaymentMetaFromNotes(refreshed?.notes || prev.notes),
            }));
            await refetch();
            queryClient.invalidateQueries({ queryKey: ['payments'] });
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            queryClient.invalidateQueries({ queryKey: ['master-products'] });
            queryClient.invalidateQueries({ queryKey: ['purchase-invoice-store-inventory'] });
            queryClient.invalidateQueries({ queryKey: ['purchase-invoice-store-channel-skus'] });
            queryClient.invalidateQueries({ queryKey: ['warehouses'] });
            queryClient.invalidateQueries({ queryKey: ['skus'] });
            queryClient.invalidateQueries({ queryKey: ['channels-all-skus-metrics'] });
            queryClient.invalidateQueries({ queryKey: ['warehouses-summary'] });
            toast.success(t('purchases.details.updated'));
        } catch (error: any) {
            toast.error(error?.response?.data?.message || t('purchases.details.cannotEdit'));
        } finally {
            setSavingDetails(false);
        }
    };

    const handleAddDetailLine = async () => {
        if (!selectedInvoice?.id) return;
        if (!canEditBatch(selectedInvoice?.status) && !canRelinkAfterReceive(selectedInvoice?.status)) {
            toast.error(
                isAr
                    ? 'لا يمكن إضافة بنود بعد استلام الفاتورة.'
                    : 'Lines cannot be added after the invoice is received.'
            );
            return;
        }
        if (!isEditingDetails) {
            toast.error(isAr ? 'فعّل التعديل أولاً.' : 'Turn on edit mode first.');
            return;
        }
        setAddingDetailLine(true);
        try {
            const isReceived = canRelinkAfterReceive(selectedInvoice?.status);
            await api.post(`purchases/smart-import/batches/${selectedInvoice.id}/add-item`, {
                raw_description: isAr ? 'بند جديد' : 'New line',
                quantity: isReceived ? 0 : 1,
                unit_price: 0,
            });
            const refreshed = await api.get(`purchases/smart-import/batches/${selectedInvoice.id}`);
            setSelectedInvoice(refreshed);
            remapDetailsItemsFromBatch(refreshed);
            await refetch();
            toast.success(isAr ? 'تمت إضافة بند' : 'Line added');
        } catch (error: any) {
            toast.error(error?.response?.data?.message || (isAr ? 'تعذر إضافة البند' : 'Could not add line'));
        } finally {
            setAddingDetailLine(false);
        }
    };

    const handleRemoveDetailLine = async (itemId: number) => {
        if (!selectedInvoice?.id || !itemId) return;
        if (!isEditingDetails) {
            toast.error(isAr ? 'فعّل التعديل أولاً.' : 'Turn on edit mode first.');
            return;
        }
        const ok = window.confirm(isAr ? 'حذف هذا البند من الفاتورة؟' : 'Delete this line from the invoice?');
        if (!ok) return;
        setSavingDetails(true);
        try {
            await api.delete(`purchases/smart-import/batches/${selectedInvoice.id}/items/${itemId}`);
            const refreshed = await api.get(`purchases/smart-import/batches/${selectedInvoice.id}`);
            setSelectedInvoice(refreshed);
            remapDetailsItemsFromBatch(refreshed);
            await refetch();
            toast.success(isAr ? 'تم حذف البند' : 'Line deleted');
        } catch (error: any) {
            toast.error(error?.response?.data?.message || (isAr ? 'تعذر حذف البند' : 'Could not delete line'));
        } finally {
            setSavingDetails(false);
        }
    };

    const applyPaymentType = async () => {
        if (!selectedInvoice?.id) return;
        setSavingDetails(true);
        try {
            // Payment type update should not trigger stock receive/approve.
            await api.post(`purchases/smart-import/batches/${selectedInvoice.id}/payment-meta`, paymentMetaPayload(detailsForm.paymentType as 'cash' | 'credit'));

            const refreshed = await api.get(`purchases/smart-import/batches/${selectedInvoice.id}`);
            setSelectedInvoice(refreshed);
            setDetailsForm((prev) => ({
                ...prev,
                paymentType: defaultPaymentTypeFromNotes(refreshed?.notes) as 'cash' | 'credit',
            }));
            await refetch();
            queryClient.invalidateQueries({ queryKey: ['payments'] });
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            toast.success(t('purchases.details.paymentUpdated'));
        } catch (error: any) {
            toast.error(error?.response?.data?.message || t('purchases.details.paymentUpdateFailed'));
        } finally {
            setSavingDetails(false);
        }
    };

    const getStatusLabel = (status: string | null) => {
        const s = String(status || '').toLowerCase();
        const labels: Record<string, string> = {
            draft: t('purchases.status.draft'),
            review: t('purchases.status.review'),
            pending: t('purchases.status.pending'),
            confirmed: t('purchases.status.confirmed'),
            paid: t('purchases.status.paid'),
            partially_paid: t('purchases.status.partiallyPaid'),
            cancelled: t('purchases.status.cancelled'),
        };
        return labels[s] || s;
    };

    const getStatusBadge = (status: string | null) => {
        const s = String(status || '').toLowerCase();
        const variants: Record<string, { className: string; label: string }> = {
            draft: { className: 'badge-status badge-secondary', label: getStatusLabel('draft') },
            review: { className: 'badge-status badge-info', label: getStatusLabel('review') },
            pending: { className: 'badge-status badge-info', label: getStatusLabel('pending') },
            confirmed: { className: 'badge-status badge-success', label: getStatusLabel('confirmed') },
            paid: { className: 'badge-status badge-success', label: getStatusLabel('paid') },
            partially_paid: { className: 'badge-status badge-info', label: getStatusLabel('partially_paid') },
            cancelled: { className: 'badge-status badge-destructive', label: getStatusLabel('cancelled') },
        };
        const variant = variants[s] || variants.confirmed;
        return <Badge className={variant.className}>{variant.label}</Badge>;
    };

    const syncDetailsItemsFromServer = (serverItems: any[], prev: typeof detailsItems) =>
        serverItems.map((it: any) => getDetailsRowForItem(prev, it));

    const updateDetailsItemById = (itemId: number, patch: Partial<(typeof detailsItems)[number]>) => {
        setDetailsItems((prev) => {
            const inv = selectedInvoiceRef.current;
            const serverItems = Array.isArray(inv?.items) ? inv.items : [];
            const aligned = serverItems.length > 0 ? syncDetailsItemsFromServer(serverItems, prev) : [...prev];
            return aligned.map((row) => (Number(row.id) === Number(itemId) ? { ...row, ...patch } : row));
        });
    };

    const selectedInvoicePaymentStatus = useMemo(() => {
        if (!selectedInvoice) return null;
        const total = Number(selectedInvoice?.grand_total || selectedInvoice?.subtotal || 0);
        const { paid, remaining } = resolvePaidRemainingFromBatchNotes(selectedInvoice?.notes, total);
        return resolvePurchasePaymentDisplayStatus(selectedInvoice?.status, paid, remaining);
    }, [selectedInvoice]);

    const editedDetailsGrandTotal = useMemo(() => {
        const serverItems = Array.isArray(selectedInvoice?.items) ? selectedInvoice.items : [];
        if (serverItems.length === 0) {
            return detailsItems.reduce((sum, item) => sum + (Number(item?.quantity || 0) * Number(item?.unit_price || 0)), 0);
        }
        return serverItems.reduce((sum, serverItem: any) => {
            const row = getDetailsRowForItem(detailsItems, serverItem);
            return sum + Number(row.quantity || 0) * Number(row.unit_price || 0);
        }, 0);
    }, [detailsItems, selectedInvoice?.items]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-muted-foreground">{t('purchases.loading')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold">{t('purchases.title')}</h1>
                    <p className="text-muted-foreground">{t('purchases.subtitle')}</p>
                </div>
                <div className="flex gap-2">
                    {emptyInvoices.length > 0 && (
                        <Button variant="outline" onClick={handleCleanupEmptyInvoices}>
                            <Trash2 className="w-4 h-4 mr-2" />
                            {t('purchases.cleanup.deleteEmpty')}
                        </Button>
                    )}
                    <Button variant="outline" onClick={() => navigate('/purchases/returns')}>
                        <RotateCcw className="w-4 h-4 mr-2" />
                        {t('purchases.purchaseReturns')}
                    </Button>
                    <Button variant="outline" onClick={handleExport}>
                        <Download className="w-4 h-4 mr-2" />
                        {t('common.export')}
                    </Button>
                    <Button onClick={() => setIsDialogOpen(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        {t('purchases.newInvoice')}
                    </Button>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="stat-card"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-3 rounded-xl bg-primary/10">
                            <FileText className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">{t('purchases.totalInvoices')}</p>
                            <p className="text-2xl font-bold">{stats.total}</p>
                        </div>
                    </div>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="stat-card"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-3 rounded-xl bg-destructive/10">
                            <DollarSign className="w-5 h-5 text-destructive" />
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">{t('purchases.totalAmount')}</p>
                            <p className="text-2xl font-bold">{stats.totalAmount.toLocaleString()} EGP</p>
                            <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{t('purchases.totalAmountHint')}</p>
                        </div>
                    </div>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="stat-card"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-3 rounded-xl bg-info/10">
                            <TrendingDown className="w-5 h-5 text-info" />
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">{t('purchases.paidAmount')}</p>
                            <p className="text-2xl font-bold">{stats.paidAmount.toLocaleString()} EGP</p>
                            <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{t('purchases.paidAmountHint')}</p>
                        </div>
                    </div>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="stat-card"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-3 rounded-xl bg-warning/10">
                            <Clock className="w-5 h-5 text-warning" />
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">{t('purchases.notFullyPaidCount')}</p>
                            <p className="text-2xl font-bold">{stats.pending}</p>
                        </div>
                    </div>
                </motion.div>
            </div>

            {/* Filters and Table */}
            <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div>
                            <CardTitle>{t('purchases.allInvoices')}</CardTitle>
                            <CardDescription>{t('purchases.allInvoicesDesc')}</CardDescription>
                        </div>
                        <div className="flex gap-2">
                            <div className="relative flex-1 sm:w-[250px]">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                    placeholder={t('purchases.search')}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-9"
                                />
                            </div>
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="w-[150px]">
                                    <SelectValue placeholder={t('common.status')} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">{t('sales.allStatus')}</SelectItem>
                                    <SelectItem value="draft">{t('purchases.status.draft')}</SelectItem>
                                    <SelectItem value="review">{t('purchases.status.review')}</SelectItem>
                                    <SelectItem value="pending">{t('purchases.status.pending')}</SelectItem>
                                    <SelectItem value="paid">{t('purchases.status.paid')}</SelectItem>
                                    <SelectItem value="partially_paid">{t('purchases.status.partiallyPaid')}</SelectItem>
                                    <SelectItem value="confirmed">{t('purchases.status.confirmed')}</SelectItem>
                                    <SelectItem value="cancelled">{t('purchases.status.cancelled')}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {filteredInvoices && filteredInvoices.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>{t('purchases.table.invoiceNumber')}</th>
                                        <th>{t('filters.supplier')}</th>
                                        <th>{t('purchases.table.items')}</th>
                                        <th>{t('common.date')}</th>
                                        <th>{t('common.status')}</th>
                                        <th className="text-right">{t('common.amount')}</th>
                                        <th className="text-right">{t('purchases.table.paid')}</th>
                                        <th className="text-right">{t('purchases.table.balance')}</th>
                                        <th className="text-right">{t('common.actions')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredInvoices.map((invoice) => (
                                        <tr
                                            key={invoice.id}
                                            className="cursor-pointer hover:bg-muted/30"
                                            onClick={() => openInvoiceDetails(invoice)}
                                        >
                                            <td className="font-medium underline decoration-dotted underline-offset-4">
                                                {invoice.invoice_number || '—'}
                                            </td>
                                            <td>{invoice.supplier_name || '—'}</td>
                                            <td>{invoice.item_count || 0}</td>
                                            <td className="text-muted-foreground">
                                                {new Date(invoice.created_at || '').toLocaleDateString()}
                                            </td>
                                            <td>{getStatusBadge(invoice.status)}</td>
                                            <td className="text-right font-medium">{invoice.total_amount.toLocaleString()} EGP</td>
                                            <td className="text-right text-success">{(invoice.paid_amount || 0).toLocaleString()} EGP</td>
                                            <td className="text-right">
                                                {(invoice.total_amount - (invoice.paid_amount || 0)).toLocaleString()} EGP
                                            </td>
                                            <td className="text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            openInvoiceDetails(invoice);
                                                        }}
                                                    >
                                                        <Eye className="w-4 h-4 mr-2" />
                                                        {t('common.view')}
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={
                                                            deletingInvoiceId === String(invoice.id) ||
                                                            String(invoice?.backend_status || '').toLowerCase() === 'cancelled'
                                                        }
                                                        className="text-red-600 border-red-200 hover:bg-red-50"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDeleteInvoice(invoice);
                                                        }}
                                                    >
                                                        {deletingInvoiceId === String(invoice.id)
                                                            ? <Loader2 className="w-4 h-4 animate-spin" />
                                                            : <Trash2 className="w-4 h-4 mr-2" />}
                                                        {String(invoice?.backend_status || '').toLowerCase() === 'cancelled'
                                                            ? (isAr ? 'ملغاة' : 'Cancelled')
                                                            : (isAr ? 'حذف' : 'Delete')}
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="text-center py-12">
                            <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                            <p className="text-lg font-medium mb-2">{t('purchases.empty.noInvoices')}</p>
                            <p className="text-muted-foreground mb-4">
                                {searchQuery || statusFilter !== 'all'
                                    ? t('purchases.empty.adjustFilters')
                                    : t('purchases.empty.createFirst')}
                            </p>
                            <Button onClick={() => setIsDialogOpen(true)}>
                                <Plus className="w-4 h-4 mr-2" />
                                {t('purchases.createInvoice')}
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            <PurchaseInvoiceDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} />

            <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
                <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto gap-3 p-4 sm:p-5">
                    <DialogHeader className="space-y-1">
                        <DialogTitle className="text-lg">{t('purchases.details.title')}</DialogTitle>
                        <DialogDescription className="text-xs">
                            {selectedInvoice?.invoice_number || selectedInvoice?.reference_number || '—'}
                        </DialogDescription>
                    </DialogHeader>

                    {detailsLoading ? (
                        <div className="py-10 flex items-center justify-center">
                            <Loader2 className="w-6 h-6 animate-spin text-primary" />
                        </div>
                    ) : selectedInvoice ? (
                        <div className="space-y-2">
                            {canRelinkAfterReceive(selectedInvoice?.status) && (
                                <div className="rounded border border-blue-200 bg-blue-50/60 text-blue-800 text-[11px] leading-snug px-2 py-1.5">
                                    {isAr
                                        ? 'الفاتورة مستلمة: يمكنك تعديل البنود (كمية/سعر/حذف/إضافة) وسيتم تعديل المخزون ومستحقات المورد تلقائيًا. لو المخزون غير كافي للخصم، النظام هيمنع الحفظ.'
                                        : 'Invoice is received: you can edit lines (qty/price/add/delete). Stock and supplier payable are adjusted automatically. Saving will fail if stock is insufficient to deduct.'}
                                </div>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <Label className="text-xs">{t('purchases.dialog.invoiceNumber')}</Label>
                                    <Input
                                        className="h-8 text-sm"
                                        value={detailsForm.invoice_number}
                                        onChange={(e) => setDetailsForm((prev) => ({ ...prev, invoice_number: e.target.value }))}
                                        disabled={!isEditingDetails || canRelinkAfterReceive(selectedInvoice?.status)}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">{t('purchases.dialog.invoiceDate')}</Label>
                                    <Input
                                        className="h-8 text-sm"
                                        type="date"
                                        value={detailsForm.invoice_date}
                                        onChange={(e) => setDetailsForm((prev) => ({ ...prev, invoice_date: e.target.value }))}
                                        disabled={!isEditingDetails || canRelinkAfterReceive(selectedInvoice?.status)}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">{t('filters.supplier')}</Label>
                                    {isEditingDetails ? (
                                        <Select
                                            value={detailsForm.supplier_ref || undefined}
                                            onValueChange={(val) => setDetailsForm((prev) => ({ ...prev, supplier_ref: val }))}
                                        >
                                            <SelectTrigger className="h-8 text-sm">
                                                <SelectValue placeholder={t('filters.supplier')} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {supplierOptions.map((opt) => (
                                                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <Input className="h-8 text-sm" value={selectedInvoice?.vendor?.name || selectedInvoice?.supplier?.name || '—'} disabled />
                                    )}
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">{t('purchases.dialog.paymentType')}</Label>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <Select
                                            value={detailsForm.paymentType}
                                            onValueChange={(v) => setDetailsForm((prev) => ({ ...prev, paymentType: v }))}
                                        >
                                            <SelectTrigger className="h-8 w-[160px] text-sm">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="cash">{t('purchases.payment.cash')}</SelectItem>
                                                <SelectItem value="credit">{t('purchases.payment.credit')}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={applyPaymentType} disabled={savingDetails}>
                                            {savingDetails ? <Loader2 className="w-3.5 h-3.5 me-1 animate-spin" /> : null}
                                            {t('common.save')}
                                        </Button>
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">{t('table.warehouse')}</Label>
                                    {isEditingDetails ? (
                                        <Select
                                            value={detailsForm.location_id || undefined}
                                            onValueChange={(val) => setDetailsForm((prev) => ({ ...prev, location_id: val }))}
                                        >
                                            <SelectTrigger className="h-8 text-sm">
                                                <SelectValue placeholder={t('table.warehouse')} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {warehouses.map((loc: any) => (
                                                    <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <Input className="h-8 text-sm" value={selectedInvoice?.location?.name || '—'} disabled />
                                    )}
                                </div>
                            </div>

                            <div className="space-y-1">
                                <Label className="text-xs">{t('adjustments.notes')}</Label>
                                <Input
                                    className="h-8 text-sm"
                                    value={detailsForm.notes}
                                    onChange={(e) => setDetailsForm((prev) => ({ ...prev, notes: e.target.value }))}
                                    disabled={!isEditingDetails || canRelinkAfterReceive(selectedInvoice?.status)}
                                />
                            </div>

                            <Label className="text-xs font-medium">{t('purchases.dialog.items')}</Label>
                            <div className="rounded-t border border-b-0 overflow-hidden">
                            <div className="overflow-auto max-h-[min(52vh,480px)] border-b-0">
                                <table className="w-full text-xs border-collapse [&_td]:border-b [&_td]:border-border/50 [&_th]:border-b [&_th]:bg-muted/80 [&_td]:py-1 [&_th]:py-1.5 [&_td]:px-1.5 [&_th]:px-1.5 [&_th]:text-start align-middle">
                                    <thead>
                                        <tr>
                                            <th className="w-8">#</th>
                                            <th>{t('table.product')}</th>
                                            <th className="whitespace-nowrap">SKU</th>
                                            <th className="whitespace-nowrap">{t('sales.qty')}</th>
                                            <th className="whitespace-nowrap">{t('purchases.dialog.unitPrice')}</th>
                                            <th className="whitespace-nowrap">{t('purchases.dialog.total')}</th>
                                            {isEditingDetails ? <th className="w-10 text-center">{t('common.delete')}</th> : null}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(selectedInvoice?.items || []).map((item: any, idx: number) => {
                                            const isReceived = canRelinkAfterReceive(selectedInvoice?.status);
                                            const line = getDetailsRowForItem(detailsItems, item);
                                            const lineQty = Number(line.quantity || 0);
                                            const lineUnit = Number(line.unit_price || 0);
                                            return (
                                                <tr key={item.id || idx} className="hover:bg-muted/40">
                                                    <td className="text-muted-foreground tabular-nums">{idx + 1}</td>
                                                    <td>
                                                        {isEditingDetails ? (
                                                            <div className="min-w-[180px] max-w-[min(42vw,360px)]">
                                                                <PurchaseProductPicker
                                                                    locationId={detailsForm.location_id}
                                                                    warehouses={pickerWarehouses}
                                                                    masterProductId={line.master_product_id}
                                                                    skuId={line.sku_id || null}
                                                                    enabled={isDetailsOpen && isEditingDetails}
                                                                    onSelect={(pick) => {
                                                                        updateDetailsItemById(Number(item.id), {
                                                                            master_product_id: pick.masterProductId,
                                                                            sku_id: pick.skuId ? String(pick.skuId) : '',
                                                                            sku_code: pick.skuCode,
                                                                            raw_description: pick.rawDescription,
                                                                            unit_price:
                                                                                pick.lastPurchasePrice > 0
                                                                                    ? pick.lastPurchasePrice
                                                                                    : line.unit_price,
                                                                        });
                                                                    }}
                                                                />
                                                            </div>
                                                        ) : (
                                                            <span className="line-clamp-2 leading-snug">
                                                                {item?.master_product?.internal_name || item?.masterProduct?.internal_name || item?.raw_description || '—'}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="whitespace-nowrap font-mono text-[11px]">
                                                        {line.sku_code || item?.sku?.sku || '—'}
                                                    </td>
                                                    <td className="tabular-nums">
                                                        {isEditingDetails ? (
                                                            <Input
                                                                type="number"
                                                                step="any"
                                                                inputMode="decimal"
                                                                className={`h-7 w-[4.5rem] min-w-0 text-xs px-1.5 py-0 tabular-nums`}
                                                                value={String(lineQty)}
                                                                onChange={(e) => {
                                                                    const raw = e.target.value;
                                                                    updateDetailsItemById(Number(item.id), { quantity: raw === '' ? 0 : Number(raw) });
                                                                }}
                                                            />
                                                        ) : (
                                                            lineQuantityFromBatchItem(item).toLocaleString()
                                                        )}
                                                    </td>
                                                    <td className="tabular-nums">
                                                        {isEditingDetails ? (
                                                            <Input
                                                                type="number"
                                                                step="any"
                                                                inputMode="decimal"
                                                                className={`h-7 w-[4.5rem] min-w-0 text-xs px-1.5 py-0 tabular-nums`}
                                                                value={String(lineUnit)}
                                                                onChange={(e) => {
                                                                    const raw = e.target.value;
                                                                    updateDetailsItemById(Number(item.id), { unit_price: raw === '' ? 0 : Number(raw) });
                                                                }}
                                                            />
                                                        ) : (
                                                            Number(item?.unit_price || 0).toLocaleString()
                                                        )}
                                                    </td>
                                                    <td className="tabular-nums font-medium">
                                                        {(isEditingDetails ? (lineQty * lineUnit) : Number(item?.total_price || 0)).toLocaleString()}
                                                    </td>
                                                    {isEditingDetails ? (
                                                        <td className="text-center">
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7 text-destructive"
                                                                onClick={() => handleRemoveDetailLine(Number(item.id))}
                                                                disabled={savingDetails}
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </td>
                                                    ) : null}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            {isEditingDetails && (canEditBatch(selectedInvoice?.status) || canRelinkAfterReceive(selectedInvoice?.status)) ? (
                                <div className="flex justify-center border-x border-b rounded-b-md bg-muted/25 py-2">
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        className="h-9 min-w-[9rem] gap-2 font-medium"
                                        onClick={handleAddDetailLine}
                                        disabled={addingDetailLine}
                                    >
                                        {addingDetailLine ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                        {t('purchases.details.addLine')}
                                    </Button>
                                </div>
                            ) : null}
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                <div className="p-2 rounded border bg-muted/30 text-xs">
                                    <p className="text-[11px] text-muted-foreground">{t('common.status')}</p>
                                    <p className="font-semibold text-sm leading-tight">
                                        {selectedInvoicePaymentStatus ? getStatusLabel(selectedInvoicePaymentStatus) : '—'}
                                    </p>
                                </div>
                                <div className="p-2 rounded border bg-muted/30 text-xs">
                                    <p className="text-[11px] text-muted-foreground">{t('purchases.dialog.grandTotal')}</p>
                                    <p className="font-semibold text-sm leading-tight">
                                        {(
                                            isEditingDetails && !canRelinkAfterReceive(selectedInvoice?.status)
                                                ? editedDetailsGrandTotal
                                                : Number(selectedInvoice?.grand_total || selectedInvoice?.subtotal || 0)
                                        ).toLocaleString()} EGP
                                    </p>
                                </div>
                                <div className="p-2 rounded border bg-muted/30 text-xs">
                                    <p className="text-[11px] text-muted-foreground">{t('table.warehouse')}</p>
                                    <p className="font-semibold text-sm leading-tight">{selectedInvoice?.location?.name || '—'}</p>
                                </div>
                                <div className="p-2 rounded border bg-muted/30 text-xs">
                                    <p className="text-[11px] text-muted-foreground">{t('purchases.table.items')}</p>
                                    <p className="font-semibold text-sm leading-tight">{Array.isArray(selectedInvoice?.items) ? selectedInvoice.items.length : 0}</p>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    <DialogFooter className="gap-1.5 sm:gap-2 flex-wrap">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                                const canEditFull = canEditBatch(selectedInvoice?.status);
                                const canRelinkOnly = canRelinkAfterReceive(selectedInvoice?.status);
                                if (!canEditFull && !canRelinkOnly) {
                                    toast.error(
                                        isAr
                                            ? 'هذه الفاتورة حالتها مقفولة للتعديل.'
                                            : 'This invoice status is locked for editing.'
                                    );
                                    return;
                                }
                                if (!isEditingDetails && canRelinkOnly) {
                                    toast.success(
                                        isAr
                                            ? 'وضع تعديل المورد/المخزن وربط الأصناف مفعل لهذه الفاتورة المستلمة.'
                                            : 'Supplier/warehouse and item-mapping edit mode enabled for this received invoice.'
                                    );
                                }
                                const willEnableEdit = !isEditingDetails;
                                setIsEditingDetails((prev) => !prev);
                                if (willEnableEdit && selectedInvoice) {
                                    queueMicrotask(() => remapDetailsItemsFromBatch(selectedInvoice));
                                }
                            }}
                            disabled={!(canEditBatch(selectedInvoice?.status) || canRelinkAfterReceive(selectedInvoice?.status))}
                        >
                            {isEditingDetails ? t('purchases.details.cancelEdit') : t('common.edit')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => selectedInvoice && handlePrintInvoice({ id: selectedInvoice.id, invoice_number: detailsForm.invoice_number })}>
                            <Printer className="w-3.5 h-3.5 me-1.5" />
                            {t('purchases.details.print')}
                        </Button>
                        <Button size="sm" onClick={saveInvoiceEdits} disabled={!isEditingDetails || savingDetails}>
                            {savingDetails ? <Loader2 className="w-3.5 h-3.5 me-1.5 animate-spin" /> : null}
                            {t('settings.saveChanges')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
