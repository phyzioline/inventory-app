import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus,
  FileUp,
  Upload,
  Loader2,
  Search,
  Download,
  RotateCcw,
  Clock,
  Package,
  CheckCircle,
  DollarSign,
  AlertTriangle,
  RefreshCw,
  Scan,
  RotateCw,
  BarChart3,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useReturns, useUpdateReturnStatus } from '@/hooks/useReturns';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn, getProductImageSrc } from '@/lib/utils';
import { ReturnInvoiceDialog } from '@/components/returns/ReturnInvoiceDialog';
import { ReturnScannerDialog } from '@/components/returns/ReturnScannerDialog';
import { ReturnDetailDialog } from '@/components/returns/ReturnDetailDialog';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { returnService } from '@/lib/supabase-services';
import { useNavigate } from 'react-router-dom';
import { RemovalImportDialog } from '@/components/inventory/RemovalImportDialog';
import { FbaReturnsSheetDialog } from '@/components/returns/FbaReturnsSheetDialog';
import { InventoryLedgerSheetDialog } from '@/components/returns/InventoryLedgerSheetDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import * as XLSX from 'xlsx';
import {
  channelLabelFromReturn,
  countsAsPendingPhysicalReturn,
  formatPhysicalReturnLocation,
  formatReturnReasonLabel,
  getPhysicalStatus,
  isVisiblePhysicalReturnRow,
  matchesPhysicalStatusFilter,
  returnMatchesSearch,
} from '@/components/returns/returnDisplayUtils';
import {
  formatReimbursementExportLabel,
  rowReimbursementCategory,
} from '@/components/returns/returnReimbursementUtils';
import { AmazonClaimsHub } from '@/components/returns/AmazonClaimsHub';
import { ReturnStatusBadges, ReturnStatusBadgeGroup } from '@/components/returns/ReturnStatusBadges';
import { ReimbursementBadge } from '@/components/returns/ReimbursementBadge';
import { ReturnGroupActionsMenu } from '@/components/returns/ReturnGroupActionsMenu';

const STICKY_ACTIONS_CELL =
  'sticky end-0 z-20 bg-card/95 backdrop-blur-sm border-s border-border shadow-[-4px_0_8px_rgba(0,0,0,0.06)]';

function aggregateReturnLocations(rows: any[]): string {
  const parts = rows.map((row) => formatPhysicalReturnLocation(row)).filter((x) => x && String(x).trim() !== '');
  const uniq = [...new Set(parts.map((p) => String(p).trim()))];
  if (uniq.length === 0) return '';
  if (uniq.length === 1) return uniq[0];
  return uniq.join(' · ');
}

function aggregateSkuList(rows: any[]): string {
  const skus = [...new Set(rows.map((x) => String(x.sku_code || '').trim()).filter(Boolean))];
  if (skus.length === 0) return '';
  if (skus.length === 1) return skus[0];
  return `${skus.slice(0, 3).join(' · ')}${skus.length > 3 ? ' +' : ''}`;
}

function resolveReturnImage(r: any): string {
  return String(r?.product_image_url || '').trim();
}

function collectGroupImages(rows: any[]): string[] {
  return [...new Set(rows.map((r) => resolveReturnImage(r)).filter(Boolean))];
}

function ProductThumb({
  src,
  alt,
  size = 'md',
}: {
  src?: string | null;
  alt?: string;
  size?: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';
  const [failed, setFailed] = useState(false);
  const imgSrc = !failed ? getProductImageSrc(src || '') : '';
  return (
    <div
      className={cn(
        dim,
        'rounded border border-border bg-muted/30 flex items-center justify-center overflow-hidden shrink-0',
      )}
    >
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={alt || ''}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <Package
          className={cn(
            'text-muted-foreground',
            size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4',
          )}
        />
      )}
    </div>
  );
}

function GroupProductThumbs({ rows }: { rows: any[] }) {
  const images = collectGroupImages(rows);
  if (images.length === 0) {
    return <ProductThumb alt="" />;
  }
  if (images.length === 1) {
    const row = rows.find((r) => resolveReturnImage(r) === images[0]);
    return (
      <ProductThumb
        src={images[0]}
        alt={row?.product_name || row?.sku_code || ''}
      />
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {images.slice(0, 3).map((src) => (
        <ProductThumb key={src} src={src} size="sm" />
      ))}
      {images.length > 3 ? (
        <span className="text-[10px] text-muted-foreground self-center">+{images.length - 3}</span>
      ) : null}
    </div>
  );
}

function groupMatchesDateRange(group: { rows: any[] }, from: string, to: string): boolean {
  const head = group.rows[0];
  const raw = head?.return_date || head?.created_at;
  if (!raw) return !from && !to;
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return !from && !to;
  if (from) {
    const start = new Date(`${from}T00:00:00`);
    if (dt < start) return false;
  }
  if (to) {
    const end = new Date(`${to}T23:59:59.999`);
    if (dt > end) return false;
  }
  return true;
}

export default function Returns() {
  const { t, language } = useLanguage();
  const isAr = language === 'ar';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [reimbursementFilter, setReimbursementFilter] = useState<'all' | 'ready' | 'pending' | 'paid'>('all');
  const [activeTab, setActiveTab] = useState<'returns' | 'claims' | 'removals'>('returns');
  const [removalsSearchTerm, setRemovalsSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [isInvoiceDialogOpen, setIsInvoiceDialogOpen] = useState(false);
  const [isScannerDialogOpen, setIsScannerDialogOpen] = useState(false);
  const [detailReturnId, setDetailReturnId] = useState<string | null>(null);
  const [isRemovalImportOpen, setIsRemovalImportOpen] = useState(false);
  const [isFbaSheetOpen, setIsFbaSheetOpen] = useState(false);
  const [isLedgerSheetOpen, setIsLedgerSheetOpen] = useState(false);
  const [pendingPanelOpen, setPendingPanelOpen] = useState(false);
  /** Expanded Amazon order groups (one platform order → multiple settlement lines). */
  const [expandedOrderKeys, setExpandedOrderKeys] = useState<Set<string>>(() => new Set());
  const [exportDateFrom, setExportDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [exportDateTo, setExportDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: returnsPage, isLoading, isFetching } = useReturns({
    page: currentPage,
    perPage: Math.max(pageSize, 100),
    search: searchTerm,
  });
  const { data: pendingPage } = useReturns({
    perPage: 50,
    pendingPhysical: true,
  });
  const { data: claimsPage } = useReturns({
    perPage: 500,
    claimsHub: true,
    enabled: activeTab === 'claims',
  });
  const updateStatus = useUpdateReturnStatus();
  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('channel', 'amazon');
      // Laravel boolean validator accepts 0/1 reliably in multipart payloads.
      formData.append('auto_process', '0');
      return api.upload('/returns/import', formData);
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success(`Returns imported: ${res?.summary?.created ?? 0} created, ${res?.summary?.processed ?? 0} processed`);
    },
    onError: (error: any) => {
      const data = error?.response?.data;
      const validation = data?.errors
        ? Object.values(data.errors).flat().join(' | ')
        : null;
      toast.error(`Import failed: ${data?.message || validation || error.message}`);
    },
  });

  const returnsArray = Array.isArray(returnsPage?.data) ? returnsPage.data : [];
  const claimsArray = Array.isArray(claimsPage?.data) ? claimsPage.data : [];
  const serverTotal = Number(returnsPage?.total ?? returnsArray.length);

  const { data: removalItemsPayload, isLoading: loadingRemovals } = useQuery({
    queryKey: ['removals', removalsSearchTerm],
    queryFn: () => api.get('/removals', { params: { search: removalsSearchTerm, per_page: 200 } }),
    enabled: activeTab === 'removals',
  });
  const removalItems = Array.isArray((removalItemsPayload as any)?.data) ? (removalItemsPayload as any).data : [];

  const receiveRemovalMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/removals/items/${id}/receive`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['removals'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-by-location'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success(t('returns.removals.received') || 'Received and restocked');
    },
    onError: (err: any) => {
      const data = err?.response?.data;
      toast.error(data?.message || data?.error || 'Failed');
    },
  });

  const toNumber = (value: unknown) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const formatSignedCurrency = (value: number) => {
    if (!value) return '0 EGP';
    const sign = value > 0 ? '+' : '-';
    return `${sign}${Math.abs(value).toLocaleString()} EGP`;
  };

  const formatReturnDate = (r: any) => {
    const raw = r?.return_date || r?.created_at || null;
    if (!raw) return '—';
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) {
      return String(raw);
    }
    return `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  const formatTimestamp = (raw: unknown) => {
    if (!raw) return '—';
    const dt = new Date(raw as string);
    if (Number.isNaN(dt.getTime())) return String(raw);
    return `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  const toggleOrderGroup = (orderKey: string) => {
    setExpandedOrderKeys((prev) => {
      const next = new Set(prev);
      if (next.has(orderKey)) next.delete(orderKey);
      else next.add(orderKey);
      return next;
    });
  };

  const filteredReturns = returnsArray.filter((r) => {
    if (! isVisiblePhysicalReturnRow(r)) {
      return false;
    }
    const matchesSearch = returnMatchesSearch(r, searchTerm);
    const matchesType = typeFilter === 'all' || r.return_type === typeFilter;
    const matchesStatus = matchesPhysicalStatusFilter(r, statusFilter);

    return matchesSearch && matchesType && matchesStatus;
  });

  const orderGroups = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const r of filteredReturns) {
      const pid = typeof r.platform_return_id === 'string' ? r.platform_return_id : '';
      const k = String(
        pid.startsWith('INVLEDGER-')
          ? pid
          : r.amazon_order_number || r.order?.order_number || `id-${r.id}`,
      );
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    const groups = Array.from(m.entries()).map(([orderKey, rows]) => {
      const sorted = [...rows].sort((a, b) => {
        const da = new Date(a.return_date || a.created_at || 0).getTime();
        const db = new Date(b.return_date || b.created_at || 0).getTime();
        return db - da;
      });
      const totalRefund = sorted.reduce((s, r) => s + toNumber(r.refund_amount), 0);
      const totalNet = sorted.reduce((s, r) => {
        const refundAmount = toNumber(r.refund_amount);
        const financialDeduction = toNumber(r.financial_deduction);
        const extraShippingFee = toNumber(r.extra_shipping_fee);
        return s + -1 * (refundAmount + financialDeduction + extraShippingFee);
      }, 0);
      return { orderKey, rows: sorted, totalRefund, totalNet };
    });
    groups.sort((a, b) => {
      const a0 = a.rows[0];
      const b0 = b.rows[0];
      const da = new Date(a0?.return_date || a0?.created_at || 0).getTime();
      const db = new Date(b0?.return_date || b0?.created_at || 0).getTime();
      return db - da;
    });
    if (reimbursementFilter !== 'all') {
      return groups.filter((g) => {
        const cats = g.rows.map(rowReimbursementCategory);
        if (reimbursementFilter === 'ready') return cats.some((c) => c === 'ready');
        if (reimbursementFilter === 'pending') return cats.some((c) => c === 'pending');
        if (reimbursementFilter === 'paid') return cats.some((c) => c === 'paid');
        return true;
      });
    }
    return groups;
  }, [filteredReturns, reimbursementFilter]);

  const totalPages = Math.max(1, Number(returnsPage?.last_page ?? 1));
  const paginatedGroups = useMemo(() => orderGroups, [orderGroups]);

  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);
    const pages = new Set<number>([1, totalPages]);
    for (let p = start; p <= end; p += 1) pages.add(p);
    return Array.from(pages).sort((a, b) => a - b);
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, typeFilter, statusFilter, reimbursementFilter, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const stats = {
    total: serverTotal,
    pending: filteredReturns.filter((r) => countsAsPendingPhysicalReturn(r)).length,
    delayed: filteredReturns.filter((r) => {
      if (! countsAsPendingPhysicalReturn(r)) return false;
      const basis = new Date(r.return_date || r.created_at);
      if (isNaN(basis.getTime())) return false;
      const days = (Date.now() - basis.getTime()) / (1000 * 60 * 60 * 24);
      return days >= 7;
    }).length,
    pendingValue: filteredReturns
      .filter((r) => countsAsPendingPhysicalReturn(r))
      .reduce((sum, r) => sum + Number(r.refund_amount || 0), 0),
    delayedValue: filteredReturns
      .filter((r) => {
        if (! countsAsPendingPhysicalReturn(r)) return false;
        const basis = new Date(r.return_date || r.created_at);
        if (isNaN(basis.getTime())) return false;
        const days = (Date.now() - basis.getTime()) / (1000 * 60 * 60 * 24);
        return days >= 7;
      })
      .reduce((sum, r) => sum + Number(r.refund_amount || 0), 0),
    restocked: filteredReturns.filter((r) => getPhysicalStatus(r) === 'restocked_fba').length,
    refunded: filteredReturns.filter((r) => r.financial_status === 'amazon_refund').length,
    totalRefundAmount: filteredReturns.reduce((sum, r) => sum + toNumber(r.refund_amount), 0),
  };

  const pendingRows = (Array.isArray(pendingPage?.data) ? pendingPage.data : [])
    .map((r) => {
      const basis = new Date(r.return_date || r.created_at);
      const ageDays = isNaN(basis.getTime()) ? 0 : Math.max(0, Math.floor((Date.now() - basis.getTime()) / (1000 * 60 * 60 * 24)));
      return { ...r, ageDays };
    })
    .sort((a, b) => b.ageDays - a.ageDays);

  const handleStatusChange = (id: string, status: any) => {
    updateStatus.mutate({ id, status });
  };

  const handleImportReturnsClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportReturnsFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importMutation.mutate(file);
    e.target.value = '';
  };

  const handleExportToExcel = async () => {
    toast.loading(isAr ? 'جاري تجهيز التصدير…' : 'Preparing export…', { id: 'returns-export' });
    try {
      const allRows = await returnService.exportAll();
      const exportFiltered = allRows.filter((r) => {
        const matchesSearch = returnMatchesSearch(r, searchTerm);
        const matchesType = typeFilter === 'all' || r.return_type === typeFilter;
        const matchesStatus = matchesPhysicalStatusFilter(r, statusFilter);
        return matchesSearch && matchesType && matchesStatus;
      });
      const m = new Map<string, any[]>();
      for (const r of exportFiltered) {
        const pid = typeof r.platform_return_id === 'string' ? r.platform_return_id : '';
        const k = String(
          pid.startsWith('INVLEDGER-')
            ? pid
            : r.amazon_order_number || r.order?.order_number || `id-${r.id}`,
        );
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(r);
      }
      const groups = Array.from(m.entries()).map(([orderKey, rows]) => {
        const sorted = [...rows].sort((a, b) => {
          const da = new Date(a.return_date || a.created_at || 0).getTime();
          const db = new Date(b.return_date || b.created_at || 0).getTime();
          return db - da;
        });
        const totalRefund = sorted.reduce((s, r) => s + toNumber(r.refund_amount), 0);
        const totalNet = sorted.reduce((s, r) => {
          const refundAmount = toNumber(r.refund_amount);
          const financialDeduction = toNumber(r.financial_deduction);
          const extraShippingFee = toNumber(r.extra_shipping_fee);
          return s + -1 * (refundAmount + financialDeduction + extraShippingFee);
        }, 0);
        return { orderKey, rows: sorted, totalRefund, totalNet };
      }).filter((g) => groupMatchesDateRange(g, exportDateFrom, exportDateTo));

    if (!groups.length) {
      toast.error(t('returns.exportNoData') || (isAr ? 'لا توجد صفوف في الفترة المحددة' : 'No rows in the selected period'), { id: 'returns-export' });
      return;
    }

    const col = (en: string, ar: string) => (isAr ? ar : en);
    const wsData = groups.map((group) => {
      const head = group.rows[0];
      const statusLabels = Array.from(
        new Set(group.rows.map((x: any) => String(x.return_status || '')).filter(Boolean)),
      ).join(', ');
      const extLabels = Array.from(
        new Set(group.rows.map((x: any) => String(x.external_status || '')).filter(Boolean)),
      ).join(', ');
      return {
        [col('Return # / Ref', 'رقم المرتجع / المرجع')]: group.orderKey,
        [col('Order #', 'رقم الطلب')]: head?.order?.order_number || '—',
        [col('Customer', 'العميل')]: head?.customer_name || (t('returns.walkIn') || 'Walk-in'),
        [col('Channel', 'قناة الطلب')]: channelLabelFromReturn(head),
        [col('Status', 'الحالة')]: statusLabels || '—',
        [col('External Status', 'حالة خارجية')]: extLabels || '—',
        [col('Return Location', 'مكان المرتجع')]: aggregateReturnLocations(group.rows) || '—',
        [col('SKU', 'SKU')]: aggregateSkuList(group.rows) || '—',
        [col('Reimbursement / Claim', 'التعويض / المطالبة')]: formatReimbursementExportLabel(
          group.rows,
          isAr,
          t,
        ),
        [col('Refund (EGP)', 'رد للعميل (جنيه)')]: group.totalRefund > 0 ? -group.totalRefund : 0,
        [col('Net (EGP)', 'الصافي (جنيه)')]: group.totalNet,
        [col('Date', 'التاريخ')]: formatReturnDate(head),
        [col('Linked Lines', 'عدد الحركات')]: group.rows.length,
      };
    });

    const ws = XLSX.utils.json_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isAr ? 'المرتجعات' : 'Returns');
    const fromPart = exportDateFrom || 'all';
    const toPart = exportDateTo || 'all';
    XLSX.writeFile(wb, `returns-report-${fromPart}_${toPart}.xlsx`);
    toast.success(
      isAr
        ? `تم تصدير ${groups.length} صف`
        : `Exported ${groups.length} row${groups.length === 1 ? '' : 's'}`,
      { id: 'returns-export' },
    );
    } catch (error: any) {
      toast.error(error?.message || (isAr ? 'فشل التصدير' : 'Export failed'), { id: 'returns-export' });
    }
  };

  const returnsBootstrapping = isLoading && returnsArray.length === 0;

  if (returnsBootstrapping) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <RefreshCw className="w-10 h-10 text-emerald-500 animate-spin" />
        <p className="text-muted-foreground">{t('common.loading') || 'Loading...'}</p>
      </div>
    );
  }

  return (
    <div className="-mx-2 space-y-4 p-3 sm:-mx-4 sm:p-4 lg:-mx-6 lg:p-5 w-full max-w-none min-w-0">
      {isFetching && returnsArray.length > 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
          {isAr
            ? `جاري تحميل باقي المرتجعات… (${returnsArray.length.toLocaleString()} محمّل حتى الآن)`
            : `Loading more returns… (${returnsArray.length.toLocaleString()} loaded so far)`}
        </div>
      ) : null}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground mb-1">{t('nav.returns') || 'Returns Management'}</h1>
          <p className="text-muted-foreground text-sm">{t('returns.subtitle') || 'Track customer returns and updated inventory conditions.'}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => navigate('/returns/analytics')}
            className="gap-2"
          >
            <BarChart3 className="w-4 h-4" />
            {t('returns.analytics.nav') || 'Return Analytics'}
          </Button>
          <Button
            variant="outline"
            onClick={handleImportReturnsClick}
            disabled={importMutation.isPending}
            className="border-blue-500/30 bg-blue-500/5 text-blue-400 hover:bg-blue-500 hover:text-white gap-2"
          >
            {importMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
            {t('returns.importFile') || t('common.import') || 'Import'}
          </Button>
          <Button
            variant="outline"
            onClick={() => setIsFbaSheetOpen(true)}
            className="border-sky-500/30 bg-sky-500/5 text-sky-400 hover:bg-sky-600 hover:text-white gap-2"
          >
            <Upload className="w-4 h-4" />
            {t('returns.fbaSheet.button') || (language === 'ar' ? 'شيت مرتجعات FBA' : 'FBA returns sheet')}
          </Button>
          <Button
            variant="outline"
            onClick={() => setIsLedgerSheetOpen(true)}
            className="border-cyan-500/30 bg-cyan-500/5 text-cyan-400 hover:bg-cyan-600 hover:text-white gap-2"
          >
            <Upload className="w-4 h-4" />
            {t('returns.ledgerSheet.button') || (language === 'ar' ? 'شيت مخزون (تعويض)' : 'Inventory ledger')}
          </Button>
          <Button
            variant="outline"
            onClick={() => setIsRemovalImportOpen(true)}
            className="border-violet-500/30 bg-violet-500/5 text-violet-500 hover:bg-violet-500 hover:text-white gap-2"
          >
            <Upload className="w-4 h-4" />
            {t('returns.removals.import') || 'Import Removals'}
          </Button>
          <Button
            variant="outline"
            onClick={() => setIsScannerDialogOpen(true)}
            className="border-emerald-500/30 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500 hover:text-white gap-2"
          >
            <Scan className="w-4 h-4" />
            {t('returns.scanReceive') || 'Scan / Receive'}
          </Button>
          <Button
            onClick={() => setIsInvoiceDialogOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2"
          >
            <Plus className="w-4 h-4" />
            {t('returns.new') || 'New Return'}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xml,.csv,.txt"
          className="hidden"
          onChange={handleImportReturnsFile}
        />
      </div>

      <RemovalImportDialog
        open={isRemovalImportOpen}
        onOpenChange={setIsRemovalImportOpen}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['removals'] })}
      />

      <FbaReturnsSheetDialog open={isFbaSheetOpen} onOpenChange={setIsFbaSheetOpen} />
      <InventoryLedgerSheetDialog open={isLedgerSheetOpen} onOpenChange={setIsLedgerSheetOpen} />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'returns' | 'claims' | 'removals')}>
        <TabsList className="w-full justify-start flex-wrap h-auto gap-1.5 p-1.5 bg-muted/40 border border-border rounded-xl">
          <TabsTrigger
            value="returns"
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-semibold border border-transparent transition-colors',
              'data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-800 data-[state=active]:border-emerald-500/40',
              'dark:data-[state=active]:text-emerald-300',
            )}
          >
            {t('nav.returns') || 'Returns'}
          </TabsTrigger>
          <TabsTrigger
            value="claims"
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-semibold border border-transparent transition-colors',
              'data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-900 data-[state=active]:border-amber-500/50',
              'dark:data-[state=active]:text-amber-200',
            )}
          >
            {t('returns.claimsHub.title') || (isAr ? 'يلا نجيب فلوس من أمازون' : 'Amazon claims')}
          </TabsTrigger>
          <TabsTrigger
            value="removals"
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-semibold border border-transparent transition-colors',
              'data-[state=active]:bg-violet-500/15 data-[state=active]:text-violet-900 data-[state=active]:border-violet-500/50',
              'dark:data-[state=active]:text-violet-200',
            )}
          >
            {t('returns.removals.tab') || 'Amazon Removals'}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="returns" className="space-y-6 mt-4 focus-visible:outline-none">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        {[
          { label: t('returns.kpi.total') || 'Total Returns', value: stats.total, icon: RotateCcw, color: 'text-blue-400', bg: 'bg-blue-400/10' },
          { label: t('returns.kpi.pending') || 'Pending Review', value: stats.pending, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-400/10' },
          { label: t('returns.kpi.delayed') || 'Pending > 7 Days', value: stats.delayed, icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-400/10' },
          { label: t('returns.kpi.pendingValue') || 'Pending Value', value: `${stats.pendingValue.toLocaleString()} EGP`, icon: DollarSign, color: 'text-orange-400', bg: 'bg-orange-400/10' },
          { label: t('returns.kpi.delayedValue') || 'Overdue Value', value: `${stats.delayedValue.toLocaleString()} EGP`, icon: AlertTriangle, color: 'text-rose-400', bg: 'bg-rose-400/10' },
          { label: t('returns.kpi.restocked') || 'Restocked', value: stats.restocked, icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
          { label: t('returns.kpi.totalRefunded') || 'Total Refunded', value: `${stats.totalRefundAmount.toLocaleString()} EGP`, icon: DollarSign, color: 'text-purple-400', bg: 'bg-purple-400/10' },
        ].map((stat, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-card border border-border p-4 rounded-xl flex items-center gap-4"
          >
            <div className={cn("p-3 rounded-lg", stat.bg)}>
              <stat.icon className={cn("w-5 h-5", stat.color)} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">{stat.label}</p>
              <p className="text-xl font-bold text-foreground">{stat.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-center">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-600/80" />
          <Input
            placeholder={
              t('returns.searchPlaceholder') ||
              (isAr ? 'ابحث برقم الطلب أو الـ SKU أو اسم المنتج…' : 'Search by order #, SKU, or product name…')
            }
            className="pl-10 bg-background border-2 border-emerald-500/60 ring-1 ring-emerald-500/20 rounded-lg focus:border-emerald-500 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground px-1">
            {t('returns.search.hint') ||
              (isAr
                ? 'ابحث برقم الطلب → سجّل تم الاستلام أو هالك من القائمة أو المسح'
                : 'Search by order # → mark received or lost from the list or scanner')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 w-full md:w-auto items-center">
          <Input
            type="date"
            value={exportDateFrom}
            onChange={(e) => setExportDateFrom(e.target.value)}
            className="w-full sm:w-[140px] bg-background border-border"
            title={t('returns.exportDateFrom') || (isAr ? 'من تاريخ' : 'From date')}
            aria-label={t('returns.exportDateFrom') || (isAr ? 'من تاريخ' : 'From date')}
          />
          <Input
            type="date"
            value={exportDateTo}
            onChange={(e) => setExportDateTo(e.target.value)}
            className="w-full sm:w-[140px] bg-background border-border"
            title={t('returns.exportDateTo') || (isAr ? 'إلى تاريخ' : 'To date')}
            aria-label={t('returns.exportDateTo') || (isAr ? 'إلى تاريخ' : 'To date')}
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleExportToExcel}
            className="gap-2 border-emerald-500/30 bg-emerald-500/5 text-emerald-600 hover:bg-emerald-600 hover:text-white shrink-0"
          >
            <Download className="w-4 h-4" />
            {t('returns.exportExcel') || (isAr ? 'تصدير Excel' : 'Export Excel')}
          </Button>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full md:w-36 bg-background border-border">
              <SelectValue placeholder={t('common.type') || 'Type'} />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border text-popover-foreground">
              <SelectItem value="all">{t('common.all') || 'All'}</SelectItem>
              <SelectItem value="stock">{t('returns.type.toStock') || 'To Stock'}</SelectItem>
              <SelectItem value="damaged">{t('returns.type.damaged') || 'Damaged'}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full md:w-36 bg-background border-border">
              <SelectValue placeholder={t('common.status') || 'Status'} />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border text-popover-foreground">
              <SelectItem value="all">{t('common.all') || 'All'}</SelectItem>
              <SelectItem value="pending">{t('returns.status.pending') || 'Awaiting arrival'}</SelectItem>
              <SelectItem value="in_transit">{t('returns.status.inTransit') || 'In transit'}</SelectItem>
              <SelectItem value="received">{t('returns.status.received') || 'Received'}</SelectItem>
              <SelectItem value="refunded" title={t('returns.status.refundedTooltip') || ''}>
                {t('returns.status.refunded') || 'Amazon financial refund'}
              </SelectItem>
              <SelectItem value="restocked">{t('returns.status.restocked') || 'Restocked to FBA'}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Collapsible open={pendingPanelOpen} onOpenChange={setPendingPanelOpen}>
        <Card className="bg-card border-border overflow-hidden">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-xl"
              aria-expanded={pendingPanelOpen}
            >
              <CardHeader className="flex flex-row items-center justify-between gap-3 py-4 cursor-pointer hover:bg-muted/30 transition-colors">
                <div className="min-w-0">
                  <CardTitle className="text-foreground text-base sm:text-lg">
                    {t('returns.pendingDashboard.title') || 'Pending Physical Returns Dashboard'}
                  </CardTitle>
                  {pendingPanelOpen ? (
                    <CardDescription className="mt-1">
                      {t('returns.pendingDashboard.subtitle') ||
                        'Oldest pending and in-transit returns. Use this list to prioritize scan/receipt confirmation.'}
                    </CardDescription>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
                      {(t('returns.pendingDashboard.collapsedHint') || 'Collapsed — click to expand ({count} pending)').replace(
                        '{count}',
                        String(pendingRows.length),
                      )}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="secondary" className="text-xs tabular-nums">
                    {pendingRows.length}
                  </Badge>
                  <ChevronDown
                    className={cn(
                      'w-5 h-5 text-muted-foreground transition-transform duration-200',
                      pendingPanelOpen ? 'rotate-180' : '',
                    )}
                    aria-hidden
                  />
                </div>
              </CardHeader>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 border-t border-border">
              {pendingRows.length === 0 ? (
                <div className="py-4 text-sm text-muted-foreground">
                  {t('returns.pendingDashboard.empty') || 'No pending physical returns.'}
                </div>
              ) : (
                <div className="overflow-x-auto -mx-1 pt-4">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border">
                        <th className="py-2 pr-3 w-12">{t('returns.table.image') || (isAr ? 'صورة' : 'Image')}</th>
                        <th className="py-2 pr-3">{t('returns.pendingDashboard.table.return') || 'Return'}</th>
                        <th className="py-2 pr-3">{t('returns.pendingDashboard.table.order') || 'Order'}</th>
                        <th className="py-2 pr-3">{t('common.status') || 'Status'}</th>
                        <th className="py-2 pr-3">{t('returns.pendingDashboard.table.ageDays') || 'Age (days)'}</th>
                        <th className="py-2 pr-3 text-right">{t('returns.pendingDashboard.table.value') || 'Value'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingRows.slice(0, 20).map((r) => (
                        <tr
                          key={`pending-${r.id}`}
                          role="button"
                          tabIndex={0}
                          className="border-b border-border/70 cursor-pointer hover:bg-muted/30"
                          onClick={() => setDetailReturnId(String(r.id))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setDetailReturnId(String(r.id));
                            }
                          }}
                        >
                          <td className="py-2 pr-3 align-middle">
                            <ProductThumb
                              src={resolveReturnImage(r)}
                              alt={r.product_name || r.sku_code || ''}
                              size="sm"
                            />
                          </td>
                          <td className="py-2 pr-3 text-foreground">#{r.return_number || r.id}</td>
                          <td className="py-2 pr-3 text-foreground">{r.amazon_order_number || r.order?.order_number || '—'}</td>
                          <td className="py-2 pr-3">
                            <ReturnStatusBadges row={r} isAr={isAr} t={t} className="items-start" />
                          </td>
                          <td className="py-2 pr-3">
                            <span className={cn(r.ageDays >= 7 ? 'text-red-500 font-bold' : 'text-foreground')}>
                              {r.ageDays}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-right text-amber-400 font-semibold">
                            {Number(r.refund_amount || 0).toLocaleString()} EGP
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <div className="w-full min-w-0 bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        {orderGroups.length === 0 ? (
          <div className="py-20 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto border border-border">
              <RotateCw className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">{t('returns.empty') || 'No return records found matching your filters.'}</p>
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[980px] table-fixed text-[11px] leading-tight text-start border-collapse">
            <colgroup>
              <col className="w-[18%]" />
              <col className="w-[11%]" />
              <col className="w-[12%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
              <col className="w-[7%]" />
              <col className="w-[8%]" />
              <col className="w-[9%]" />
              <col className="w-[5%]" />
              <col className="w-[5%]" />
              <col className="w-[5%]" />
              <col className="w-[40px]" />
            </colgroup>
            <thead>
              <tr className="bg-muted/40 border-b border-border text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
                <th className="px-2 py-2.5 whitespace-nowrap">{isAr ? 'المنتج / SKU' : 'Product / SKU'}</th>
                <th className="px-2 py-2.5 whitespace-nowrap">{t('returns.table.returnRef') || 'Return # / Ref'}</th>
                <th className="px-2 py-2.5 whitespace-nowrap">{t('returns.table.orderInfo') || 'Order Info'}</th>
                <th className="px-2 py-2.5 text-center whitespace-nowrap">{t('returns.table.orderChannel') || 'Channel'}</th>
                <th className="px-2 py-2.5 text-center whitespace-nowrap">{t('common.status') || 'Status'}</th>
                <th className="px-2 py-2.5 whitespace-nowrap">{t('returns.table.reason') || (isAr ? 'سبب الإرجاع' : 'Return reason')}</th>
                <th className="px-2 py-2.5 whitespace-nowrap">{t('returns.table.externalStatus') || 'External Status'}</th>
                <th className="px-2 py-2.5 whitespace-nowrap">{t('returns.table.returnLocation') || 'Return Location'}</th>
                <th className="px-2 py-2.5 whitespace-nowrap align-top min-w-0">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
                      {t('returns.table.reimbursement') || 'Reimbursement'}
                    </span>
                    <Select
                      value={reimbursementFilter}
                      onValueChange={(v) => setReimbursementFilter(v as 'all' | 'ready' | 'pending' | 'paid')}
                    >
                      <SelectTrigger className="h-7 min-h-7 text-[10px] font-semibold normal-case tracking-normal border-border bg-muted/30">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border text-popover-foreground">
                        <SelectItem value="all">{t('returns.reimbursement.filterAll') || 'All'}</SelectItem>
                        <SelectItem value="ready">{t('returns.reimbursement.filterReady') || 'Ready to claim'}</SelectItem>
                        <SelectItem value="pending">{t('returns.reimbursement.filterPending') || 'Awaiting window'}</SelectItem>
                        <SelectItem value="paid">{t('returns.reimbursement.filterPaid') || 'Claim paid'}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </th>
                <th className="px-2 py-2.5 text-end whitespace-nowrap">{t('returns.table.refund') || 'Refund'}</th>
                <th className="px-2 py-2.5 text-end whitespace-nowrap">{t('returns.table.net') || 'Net'}</th>
                <th className="px-2 py-2.5 text-end whitespace-nowrap">{t('common.date') || 'Date'}</th>
                <th className={cn('px-1 py-2.5 w-10', STICKY_ACTIONS_CELL)}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginatedGroups.map((group) => {
                const head = group.rows[0];
                const expanded = expandedOrderKeys.has(group.orderKey);
                const reasonSummary = Array.from(
                  new Set(
                    group.rows
                      .map((x: any) => formatReturnReasonLabel(x.reason, isAr))
                      .filter((x) => x && x !== '—'),
                  ),
                );
                const extLabels = Array.from(
                  new Set(group.rows.map((x: any) => String(x.external_status || '')).filter(Boolean)),
                );
                const locationSummary = aggregateReturnLocations(group.rows);
                const channelSummary = channelLabelFromReturn(head);
                const skuSummary = aggregateSkuList(group.rows);
                return (
                  <Fragment key={group.orderKey}>
                    <tr
                      role="button"
                      tabIndex={0}
                      className="hover:bg-muted/40 transition-colors group cursor-pointer bg-muted/10"
                      onClick={() => toggleOrderGroup(group.orderKey)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleOrderGroup(group.orderKey);
                        }
                      }}
                    >
                      <td className="px-2 py-2.5 align-top min-w-0">
                        <div className="flex items-start gap-2 min-w-0">
                          <GroupProductThumbs rows={group.rows} />
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-[10px] font-semibold truncate" title={skuSummary || undefined}>
                              {skuSummary || '—'}
                            </div>
                            <div
                              className="text-[10px] text-muted-foreground line-clamp-2 leading-snug"
                              title={group.rows.map((x: any) => x.product_name).filter(Boolean).join(' · ') || undefined}
                            >
                              {group.rows.map((x: any) => x.product_name).filter(Boolean).slice(0, 2).join(' · ') || '—'}
                              {group.rows.filter((x: any) => x.product_name).length > 2
                                ? ` +${group.rows.filter((x: any) => x.product_name).length - 2}`
                                : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 align-top min-w-0">
                        <div className="flex items-start gap-1.5">
                          <ChevronDown
                            className={cn(
                              'w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground transition-transform',
                              expanded ? 'rotate-180' : '',
                            )}
                            aria-hidden
                          />
                          <div className="min-w-0">
                            <div
                              className="text-[11px] font-semibold text-foreground font-mono truncate"
                              title={group.orderKey}
                            >
                              {group.orderKey}
                            </div>
                            <div className="text-[9px] text-muted-foreground">
                              {group.rows.length > 1
                                ? (isAr
                                  ? `${group.rows.length} حركات — اضغط للتفاصيل`
                                  : `${group.rows.length} lines — expand`)
                                : (isAr ? 'حركة واحدة' : 'Single line')}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 align-top min-w-0">
                        <div className="text-[11px] text-foreground font-medium truncate" title={head?.order?.order_number || ''}>
                          {head?.order?.order_number || '—'}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate" title={head?.customer_name || ''}>
                          {head?.customer_name || (t('returns.walkIn') || 'Walk-in')}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-center align-top min-w-0">
                        <Badge variant="outline" className="text-[9px] font-normal max-w-full truncate" title={channelSummary}>
                          {channelSummary}
                        </Badge>
                      </td>
                      <td className="px-2 py-2.5 text-center align-top min-w-0">
                        <ReturnStatusBadgeGroup rows={group.rows} isAr={isAr} t={t} />
                      </td>
                      <td className="px-2 py-2.5 text-[10px] text-foreground align-top min-w-0">
                        <div className="truncate" title={reasonSummary.join(', ')}>
                          {reasonSummary.length ? reasonSummary.join(' · ') : '—'}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-[10px] text-foreground align-top min-w-0">
                        <div className="truncate" title={extLabels.join(', ')}>
                          {extLabels.length ? extLabels.join(', ') : '—'}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-[10px] text-foreground align-top min-w-0">
                        <div className="font-medium text-foreground truncate" title={locationSummary || undefined}>
                          {locationSummary || '—'}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 align-top text-[10px] min-w-0">
                        <ReimbursementBadge rows={group.rows} isAr={isAr} t={t} mode="group" />
                      </td>
                      <td className="px-2 py-2.5 text-end font-bold text-red-500 align-top whitespace-nowrap">
                        {group.totalRefund > 0 ? formatSignedCurrency(-group.totalRefund) : '0'}
                      </td>
                      <td
                        className={cn(
                          'px-2 py-2.5 text-end font-bold align-top whitespace-nowrap',
                          group.totalNet >= 0 ? 'text-emerald-500' : 'text-red-500',
                        )}
                      >
                        {formatSignedCurrency(group.totalNet)}
                      </td>
                      <td className="px-2 py-2.5 text-end text-[10px] text-muted-foreground align-top whitespace-nowrap">
                        {formatReturnDate(head)}
                      </td>
                      <td
                        className={cn('px-1 py-2.5 text-end align-top', STICKY_ACTIONS_CELL)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ReturnGroupActionsMenu
                          rows={group.rows}
                          isAr={isAr}
                          t={t}
                          onStatusChange={handleStatusChange}
                        />
                      </td>
                    </tr>
                    {expanded
                      ? group.rows.map((r: any) => {
                          const refundAmount = toNumber(r.refund_amount);
                          const financialDeduction = toNumber(r.financial_deduction);
                          const extraShippingFee = toNumber(r.extra_shipping_fee);
                          const netSettlement = -1 * (refundAmount + financialDeduction + extraShippingFee);
                          const txDate = r.transaction_return_date ?? r.return_date;
                          return (
                            <tr
                              key={`${group.orderKey}-${r.id}`}
                              role="button"
                              tabIndex={0}
                              className="hover:bg-muted/30 transition-colors cursor-pointer bg-muted/5"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDetailReturnId(String(r.id));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setDetailReturnId(String(r.id));
                                }
                              }}
                            >
                              <td className="px-2 py-2 align-top min-w-0 bg-muted/5">
                                <div className="flex items-start gap-2 min-w-0 ps-2">
                                  <ProductThumb
                                    src={resolveReturnImage(r)}
                                    alt={r.product_name || r.sku_code || ''}
                                    size="sm"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="font-mono text-[10px] font-semibold truncate" title={r.sku_code || undefined}>
                                      {r.sku_code || '—'}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground line-clamp-2" title={r.product_name || undefined}>
                                      {r.product_name || '—'}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-2 py-2 align-top min-w-0 bg-muted/5">
                                <div className="text-[10px] font-mono text-muted-foreground truncate" title={String(r.return_number || r.id)}>
                                  #{String(r.return_number || r.id).slice(0, 16)}
                                </div>
                              </td>
                              <td className="px-2 py-2 align-top min-w-0 bg-muted/5">
                                <div className="text-[10px] text-foreground font-medium truncate" title={r.order?.order_number || ''}>
                                  {r.order?.order_number || '—'}
                                </div>
                                <div className="text-[9px] text-muted-foreground truncate">{r.customer_name || (t('returns.walkIn') || 'Walk-in')}</div>
                              </td>
                              <td className="px-2 py-2 text-center align-top bg-muted/5">
                                <Badge
                                  variant="outline"
                                  className="text-[9px] font-normal max-w-full truncate mx-auto block w-fit"
                                  title={channelLabelFromReturn(r)}
                                >
                                  {channelLabelFromReturn(r)}
                                </Badge>
                                <div
                                  className={cn(
                                    'text-[9px] mt-0.5 font-medium',
                                    r.return_type === 'stock' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                                  )}
                                >
                                  {r.return_type === 'stock'
                                    ? t('returns.type.toStock') || 'To Stock'
                                    : t('returns.type.damaged') || 'Damaged'}
                                </div>
                              </td>
                              <td className="px-2 py-2 text-center align-top bg-muted/5">
                                <ReturnStatusBadges row={r} isAr={isAr} t={t} />
                              </td>
                              <td className="px-2 py-2 text-[10px] align-top min-w-0 bg-muted/5">
                                <div className="truncate" title={r.reason || undefined}>
                                  {formatReturnReasonLabel(r.reason, isAr)}
                                </div>
                              </td>
                              <td className="px-2 py-2 text-[10px] align-top min-w-0 bg-muted/5">
                                <div className="truncate">{r.external_status || '—'}</div>
                              </td>
                              <td className="px-2 py-2 text-[10px] align-top min-w-0 bg-muted/5">
                                <div className="font-medium text-foreground truncate" title={formatPhysicalReturnLocation(r) || undefined}>
                                  {formatPhysicalReturnLocation(r) || '—'}
                                </div>
                              </td>
                              <td className="px-2 py-2 align-top text-[10px] bg-muted/5">
                                <ReimbursementBadge rows={[r]} isAr={isAr} t={t} mode="row" />
                              </td>
                              <td className="px-2 py-2 text-end text-[10px] text-red-500 font-semibold whitespace-nowrap bg-muted/5">
                                {refundAmount > 0 ? formatSignedCurrency(-refundAmount) : '0'}
                              </td>
                              <td
                                className={cn(
                                  'px-2 py-2 text-end text-[10px] font-semibold whitespace-nowrap bg-muted/5',
                                  netSettlement >= 0 ? 'text-emerald-500' : 'text-red-500',
                                )}
                              >
                                {formatSignedCurrency(netSettlement)}
                              </td>
                              <td className="px-2 py-2 text-end text-[9px] text-muted-foreground align-top whitespace-nowrap bg-muted/5">
                                <div>{formatTimestamp(txDate)}</div>
                              </td>
                              <td className={cn('px-1 py-2 text-end align-top bg-muted/5', STICKY_ACTIONS_CELL)} />
                            </tr>
                          );
                        })
                      : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border border-border rounded-lg p-3 bg-card/40">
        <div className="text-xs text-muted-foreground">
          {orderGroups.length > 0
            ? `${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, serverTotal)} / ${serverTotal}`
            : '0 / 0'}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('returns.rows') || 'Rows'}</span>
          <select
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
          >
            {[50, 100, 200, 500].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-border text-foreground"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          >
            {t('common.previous') || 'Prev'}
          </Button>

          {pageNumbers.map((page, index) => {
            const prev = pageNumbers[index - 1];
            const showGap = prev && page - prev > 1;
            return (
              <div key={page} className="flex items-center gap-1">
                {showGap ? <span className="px-1 text-xs text-gray-500">...</span> : null}
                <Button
                  type="button"
                  variant={currentPage === page ? 'default' : 'outline'}
                  size="sm"
                  className="min-w-8 px-2 border-border"
                  onClick={() => setCurrentPage(page)}
                >
                  {`ص ${page}`}
                </Button>
              </div>
            );
          })}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-border text-foreground"
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          >
            {t('common.next') || 'Next'}
          </Button>
        </div>
      </div>

      <ReturnInvoiceDialog
        open={isInvoiceDialogOpen}
        onOpenChange={setIsInvoiceDialogOpen}
      />

      <ReturnDetailDialog
        open={!!detailReturnId}
        returnId={detailReturnId}
        onOpenChange={(open) => {
          if (!open) setDetailReturnId(null);
        }}
      />

      <ReturnScannerDialog
        open={isScannerDialogOpen}
        onOpenChange={setIsScannerDialogOpen}
      />
        </TabsContent>

        <TabsContent value="claims" className="mt-4 focus-visible:outline-none">
          <AmazonClaimsHub returns={claimsArray} isAr={isAr} t={t} />
        </TabsContent>

        <TabsContent value="removals" className="space-y-4 mt-4 focus-visible:outline-none">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-xl border border-violet-500/25 bg-violet-500/5 p-4">
            <div>
              <h2 className="text-xl font-bold text-foreground">
                {t('returns.removals.title') || 'Amazon removal orders'}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {t('returns.removals.subtitle') ||
                  'Import Removal Order Detail CSV, then confirm receipt to restock into the shop.'}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsRemovalImportOpen(true)}
              className="gap-2 border-violet-500/40 bg-violet-500/10 text-violet-700 hover:bg-violet-600 hover:text-white shrink-0 dark:text-violet-300"
            >
              <Upload className="w-4 h-4" />
              {t('returns.removals.import') || 'Import Removals'}
            </Button>
          </div>

          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-600/80" />
            <Input
              placeholder={
                t('returns.removals.searchPlaceholder') ||
                (isAr ? 'ابحث برقم إزالة أو SKU…' : 'Search removal order # or SKU…')
              }
              className="pl-10 border-2 border-violet-500/40 ring-1 ring-violet-500/15 rounded-lg"
              value={removalsSearchTerm}
              onChange={(e) => setRemovalsSearchTerm(e.target.value)}
            />
          </div>

          <Card className="bg-card border-violet-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-foreground text-base">
                {t('returns.removals.listTitle') || (isAr ? 'سطور الإزالة' : 'Removal lines')}
              </CardTitle>
              <CardDescription>
                {loadingRemovals
                  ? t('common.loading') || 'Loading...'
                  : (t('returns.removals.count') || '{count} rows').replace(
                      '{count}',
                      String(removalItems.length),
                    )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingRemovals ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('common.loading') || 'Loading...'}
                </div>
              ) : removalItems.length === 0 ? (
                <div className="text-sm text-muted-foreground">{t('returns.removals.empty') || 'No removal rows yet.'}</div>
              ) : (
                <div className="overflow-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-muted-foreground">
                      <tr>
                        <th className="text-start px-3 py-2 w-14">{t('returns.table.image') || (isAr ? 'صورة' : 'Image')}</th>
                        <th className="text-start px-3 py-2">{t('returns.removals.table.order') || 'Removal order'}</th>
                        <th className="text-start px-3 py-2">SKU</th>
                        <th className="text-start px-3 py-2">{t('returns.removals.table.disposition') || 'Disposition'}</th>
                        <th className="text-end px-3 py-2">{t('returns.removals.table.qty') || 'Qty'}</th>
                        <th className="text-start px-3 py-2">{t('returns.removals.table.status') || 'Status'}</th>
                        <th className="text-end px-3 py-2">{t('returns.removals.table.actions') || 'Actions'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {removalItems.map((it: any) => {
                        const orderId = it?.removal_order?.removal_order_id || it?.removalOrder?.removal_order_id || it?.removalOrder?.removal_order_id || it?.removal_order_id;
                        const qty = Number(it?.shipped_quantity || 0) || Number(it?.requested_quantity || 0) || 0;
                        const received = String(it?.receive_status || '') === 'received';
                        return (
                          <tr key={it.id} className="border-t">
                            <td className="px-3 py-2 align-middle">
                              <ProductThumb
                                src={it.product_image_url}
                                alt={it.product_name || it.sku_code || ''}
                                size="sm"
                              />
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{String(orderId || '—')}</td>
                            <td className="px-3 py-2 font-mono text-xs">{it.sku_code || '—'}</td>
                            <td className="px-3 py-2">{it.disposition || '—'}</td>
                            <td className="px-3 py-2 text-end font-mono text-xs">{qty}</td>
                            <td className="px-3 py-2">
                              <Badge
                                variant={received ? 'default' : 'secondary'}
                                className={received ? 'bg-violet-600' : ''}
                              >
                                {received
                                  ? t('returns.removals.status.received') || 'Received'
                                  : t('returns.removals.status.pending') || 'Pending'}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-end">
                              <Button
                                type="button"
                                size="sm"
                                className="bg-violet-600 hover:bg-violet-500 text-white"
                                disabled={received || receiveRemovalMutation.isPending}
                                onClick={() => void receiveRemovalMutation.mutate(String(it.id))}
                              >
                                {t('returns.removals.actions.receive') || 'Confirm receipt'}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
