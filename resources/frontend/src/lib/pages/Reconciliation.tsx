import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Landmark,
  FileUp,
  Search,
  Loader2,
  CheckCircle,
  Clock,
  Download,
  RefreshCcw,
  Building2,
  TrendingUp,
  TrendingDown,
  Undo2,
  DollarSign,
  Truck
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { fetchInventoryPaginatedList } from '@/lib/supabase-services';
import { toast } from 'sonner';
import { formatCurrency, formatDate } from '@/lib/utils';

export default function Reconciliation() {
  const { t, language } = useLanguage();
  const isAr = language === 'ar';
  const { platform } = useParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);
  const [selectedImportChannelId, setSelectedImportChannelId] = useState<number | null>(null);
  const [selectedSettlementId, setSelectedSettlementId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toNumber = (value: unknown) => {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  };

  const getTransactionStatusMeta = (statusRaw?: string | null) => {
    const status = String(statusRaw || 'released').toLowerCase().trim();
    if (status === 'deferred') {
      return {
        label: isAr ? 'قيد التأجيل' : 'Deferred',
        className: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
      };
    }
    if (status === 'pending') {
      return {
        label: isAr ? 'معلّق' : 'Pending',
        className: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
      };
    }
    if (status === 'reversed') {
      return {
        label: isAr ? 'معكوس' : 'Reversed',
        className: 'bg-red-500/10 text-red-600 border-red-500/30',
      };
    }
    return {
      label: isAr ? 'تم الإصدار' : 'Released',
      className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
    };
  };

  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.getArray('/channels'),
  });

  const normalizeChannelFamily = (value: string) => {
    const normalized = value
      .toLowerCase()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/ph?yzioline|ph?yzio ?line/g, 'phyzioline')
      .replace(/فيزيول[اي]ن/g, 'فيزيولاين')
      .replace(/\b(fba|afn|merchant|mfn|fbm)\b/g, ' ')
      .replace(/\b(trader|seller)\b/g, ' ')
      .replace(/(تاجر|التاجر|تجّار|تجار)/g, ' ')
      .replace(/\d+/g, ' ')
      .replace(/[_-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return normalized;
  };

  /** Shop / POS channels don't receive marketplace payment sheets — hide from the top boxes. */
  const isShopPaymentChannel = (channel: any) => {
    const type = String(channel?.type || '').toLowerCase().trim();
    const hay = `${channel?.name || ''} ${channel?.slug || ''}`.toLowerCase();
    if (type === 'pos' || type === 'store' || type === 'shop') return true;
    return /محل/.test(hay) || /\bshop\b/.test(hay) || /\bstore\b/.test(hay);
  };

  const buildGroupLabel = (channelsInGroup: any[]) => {
    const first = channelsInGroup[0];
    if (!first) return '-';
    const candidate = String(first.name || '')
      .replace(/\b(fba|afn|merchant|mfn|fbm)\b/gi, '')
      .replace(/(تاجر|التاجر|تجّار|تجار)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return candidate || first.name || '-';
  };

  const channelGroups = useMemo(() => {
    const groupsMap = new Map<string, any[]>();
    channels.forEach((channel: any) => {
      if (isShopPaymentChannel(channel)) return;
      // Group by canonical channel family name; slug differences should not split same business account.
      const key = normalizeChannelFamily(`${channel.name || ''}`) || normalizeChannelFamily(`${channel.slug || ''}`) || String(channel.id);
      const existing = groupsMap.get(key) || [];
      existing.push(channel);
      groupsMap.set(key, existing);
    });

    return Array.from(groupsMap.entries()).map(([key, groupedChannels]) => {
      const sortedChannels = [...groupedChannels].sort((a: any, b: any) => Number(a.id) - Number(b.id));
      return {
        key,
        name: buildGroupLabel(sortedChannels),
        slug: sortedChannels.map((c: any) => c.slug).filter(Boolean).join(' | '),
        channelIds: sortedChannels.map((c: any) => Number(c.id)),
        channels: sortedChannels,
      };
    });
  }, [channels]);

  useEffect(() => {
    if (!channelGroups.length) return;

    const stillVisible = selectedChannelId
      ? channelGroups.some((group: any) => group.channelIds.some((id: number) => Number(id) === Number(selectedChannelId)))
      : false;
    if (stillVisible) return;

    const fromRoute = platform
      ? channelGroups.find((group: any) => group.channels.some((c: any) => (c.slug || '').toLowerCase() === platform.toLowerCase()))
      : null;
    const initialId = fromRoute?.channelIds?.[0] || channelGroups[0].channelIds[0];
    setSelectedChannelId(Number(initialId));
  }, [channelGroups, platform, selectedChannelId]);

  const selectedChannelGroup = useMemo(() => {
    return channelGroups.find((group: any) => group.channelIds.some((id: number) => Number(id) === Number(selectedChannelId))) || null;
  }, [channelGroups, selectedChannelId]);

  const selectedChannel = useMemo(
    () => channels.find((c: any) => Number(c.id) === Number(selectedChannelId)),
    [channels, selectedChannelId]
  );

  const selectedChannelIds = useMemo(
    () => (selectedChannelGroup?.channelIds?.length ? selectedChannelGroup.channelIds : (selectedChannelId ? [selectedChannelId] : [])),
    [selectedChannelGroup, selectedChannelId]
  );

  useEffect(() => {
    if (!selectedChannelGroup?.channels?.length) {
      setSelectedImportChannelId(null);
      return;
    }
    const stillValid = selectedChannelGroup.channels.some((c: any) => Number(c.id) === Number(selectedImportChannelId));
    if (!stillValid) {
      setSelectedImportChannelId(Number(selectedChannelGroup.channels[0].id));
    }
  }, [selectedChannelGroup, selectedImportChannelId]);

  const { data: settlements = [], isLoading } = useQuery({
    queryKey: ['settlements', selectedChannelIds, search],
    queryFn: () =>
      fetchInventoryPaginatedList('settlements', {
        channel_ids: selectedChannelIds.length ? selectedChannelIds.join(',') : undefined,
        search: search || undefined,
      }),
    enabled: selectedChannelIds.length > 0,
  });

  const { data: summary } = useQuery({
    queryKey: ['settlements-summary', selectedChannelIds, search],
    queryFn: () => api.get('/settlements/summary', {
      params: {
        channel_ids: selectedChannelIds.length ? selectedChannelIds.join(',') : undefined,
        search: search || undefined,
      },
    }),
    enabled: selectedChannelIds.length > 0,
    staleTime: 0,
  });

  const { data: selectedSettlementDetail, isLoading: isTransactionsLoading } = useQuery({
    queryKey: ['settlement-detail', selectedSettlementId],
    queryFn: () => api.get(`/settlements/${selectedSettlementId}`),
    enabled: !!selectedSettlementId,
  });

  /** Same idea as sales order dialog + `settlements/order-net-totals`: sum every line `amount` per marketplace order id. */
  const settlementSheetOrderRollups = useMemo(() => {
    const raw = selectedSettlementDetail?.items;
    if (!Array.isArray(raw) || raw.length === 0) {
      return { groups: [] as { orderKey: string; items: any[]; sumAmount: number; sumFees: number; currency: string }[], grandAmount: 0, grandFees: 0 };
    }
    const byKey = new Map<string, any[]>();
    for (const item of raw) {
      const oid = String(item.platform_order_id ?? '').trim();
      const key = oid !== '' ? oid : '__no_order__';
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(item);
    }
    const sortedKeys = [...byKey.keys()].sort((a, b) => {
      if (a === '__no_order__') return 1;
      if (b === '__no_order__') return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
    let grandAmount = 0;
    let grandFees = 0;
    const groups = sortedKeys.map((orderKey) => {
      const items = byKey.get(orderKey)!;
      const sumAmount = items.reduce((s, it) => s + toNumber(it.amount), 0);
      const sumFees = items.reduce((s, it) => s + toNumber(it.fee_amount), 0);
      grandAmount += sumAmount;
      grandFees += sumFees;
      const currency = String(items[0]?.currency || 'EGP');
      return { orderKey, items, sumAmount, sumFees, currency };
    });
    return { groups, grandAmount, grandFees };
  }, [selectedSettlementDetail]);

  const getReadableImportError = (error: any) => {
    const raw = String(error?.response?.data?.message || error?.message || '').trim();
    const lower = raw.toLowerCase();

    if (!raw) {
      return isAr ? 'تعذر رفع الشيت. تأكد من نوع الملف والبيانات ثم حاول مرة أخرى.' : 'Could not import sheet. Check file type/data and try again.';
    }
    if (lower.includes('already reconciled') || lower.includes('already reconciled')) {
      return isAr ? 'هذه التسوية تمت بالفعل من قبل.' : 'This settlement is already reconciled.';
    }
    if (lower.includes('preg_split') || lower.includes('compilation failed')) {
      return isAr ? 'تنسيق الملف غير مدعوم أو به رموز غير متوقعة. استخدم ملف XML / CSV / TXT صالح.' : 'File format has unexpected content. Please upload a valid XML / CSV / TXT file.';
    }
    if (lower.includes('duplicate') || lower.includes('already exists')) {
      return isAr ? 'هذا الشيت موجود بالفعل. يمكنك إعادة الرفع للتحديث.' : 'This sheet already exists. Re-upload to update it.';
    }

    return raw;
  };

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedImportChannelId) {
        throw new Error(isAr ? 'اختر القناة أولاً.' : 'Please select a channel first.');
      }
      const formData = new FormData();
      formData.append('file', file);
      formData.append('channel_id', selectedImportChannelId.toString());
      return api.upload('/settlements/import', formData);
    },
    onSuccess: (res: any) => {
      const created = toNumber(res?.new_lines ?? res?.stats?.new_lines ?? 0);
      const updated = toNumber(res?.updated_lines ?? res?.stats?.updated_lines ?? 0);
      const duplicates = toNumber(res?.skipped_duplicates ?? res?.stats?.skipped_duplicates ?? 0);

      toast.success(
        isAr
          ? `تم رفع الشيت: جديد ${created} | تم تحديثه ${updated} | مكرر متجاهل ${duplicates}`
          : `Sheet imported: New ${created} | Updated ${updated} | Duplicates ignored ${duplicates}`
      );
      setIsImportOpen(false);
      setSelectedImportFile(null);
      queryClient.invalidateQueries({ queryKey: ['settlements'] });
      queryClient.invalidateQueries({ queryKey: ['settlements-summary'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['orders-for-profit'] });
      queryClient.invalidateQueries({ queryKey: ['sales-order-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      queryClient.invalidateQueries({ queryKey: ['profit'] });
      queryClient.invalidateQueries({ queryKey: ['settlement-order-net-totals'] });
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      queryClient.invalidateQueries({ queryKey: ['receipts-for-profit-balance'] });
      queryClient.invalidateQueries({ queryKey: ['finance-cash-flow-overview'] });
      queryClient.invalidateQueries({ queryKey: ['finance-cash-flow-stats'] });
    },
    onError: (error: any) => {
      toast.error((isAr ? 'فشل رفع الشيت: ' : 'Import failed: ') + getReadableImportError(error));
    }
  });

  const reconcileMutation = useMutation({
    mutationFn: (id: number) => api.post(`/settlements/${id}/reconcile`),
    onSuccess: (res: any) => {
      const matchedLines = toNumber(res?.matched_lines ?? res?.matched_orders ?? 0);
      const unmatchedLines = toNumber(res?.unmatched_lines ?? 0);
      const unmatchedOrderIds: string[] = Array.isArray(res?.unmatched_order_ids)
        ? res.unmatched_order_ids.map((id: any) => String(id))
        : [];

      toast.success(
        isAr
          ? `تمت التسوية. مطابق: ${matchedLines} | غير مطابق: ${unmatchedLines}`
          : `Reconciled. Matched: ${matchedLines} | Unmatched: ${unmatchedLines}`
      );

      if (unmatchedLines > 0 && unmatchedOrderIds.length > 0) {
        const idsPreview = unmatchedOrderIds.slice(0, 5).join(', ');
        toast.info(
          isAr
            ? `أمثلة أرقام غير مطابقة: ${idsPreview}`
            : `Sample unmatched order IDs: ${idsPreview}`
        );
      }

      queryClient.invalidateQueries({ queryKey: ['settlements'] });
      queryClient.invalidateQueries({ queryKey: ['settlements-summary'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['orders-for-profit'] });
      queryClient.invalidateQueries({ queryKey: ['sales-order-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      queryClient.invalidateQueries({ queryKey: ['settlement-order-net-totals'] });
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      queryClient.invalidateQueries({ queryKey: ['receipts-for-profit-balance'] });
      queryClient.invalidateQueries({ queryKey: ['finance-cash-flow-overview'] });
      queryClient.invalidateQueries({ queryKey: ['finance-cash-flow-stats'] });
    },
    onError: (error: any) => {
      const message = String(error?.response?.data?.message || error?.message || '');
      if (message.toLowerCase().includes('already reconciled')) {
        toast.info(isAr ? 'هذه التسوية متسوية بالفعل.' : 'This settlement is already reconciled.');
      } else {
        toast.error((isAr ? 'فشل تنفيذ التسوية: ' : 'Reconcile failed: ') + getReadableImportError(error));
      }
    }
  });

  const deleteSettlementMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/settlements/${id}`),
    onSuccess: () => {
      toast.success(isAr ? 'تم حذف التسوية' : 'Settlement deleted');
      setSelectedSettlementId(null);
      queryClient.invalidateQueries({ queryKey: ['settlements'] });
      queryClient.invalidateQueries({ queryKey: ['settlements-summary'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['orders-for-profit'] });
      queryClient.invalidateQueries({ queryKey: ['sales-order-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      queryClient.invalidateQueries({ queryKey: ['profit'] });
      queryClient.invalidateQueries({ queryKey: ['settlement-order-net-totals'] });
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      queryClient.invalidateQueries({ queryKey: ['receipts-for-profit-balance'] });
      queryClient.invalidateQueries({ queryKey: ['finance-cash-flow-overview'] });
      queryClient.invalidateQueries({ queryKey: ['finance-cash-flow-stats'] });
    },
    onError: (error: any) => {
      const message = String(error?.response?.data?.message || error?.message || '');
      toast.error((isAr ? 'فشل حذف التسوية: ' : 'Delete failed: ') + (message || (isAr ? 'خطأ غير معروف' : 'Unknown error')));
    }
  });

  const handleImport = () => {
    if (!selectedImportFile) {
      toast.error(isAr ? 'اختر ملف التسوية أولاً.' : 'Please select a settlement file first.');
      return;
    }
    importMutation.mutate(selectedImportFile);
  };

  const filtered = settlements;

  const totals = useMemo(() => {
    const totalAmount = filtered.reduce((sum: number, s: any) => sum + toNumber(s.total_amount), 0);
    const reconciled = filtered.filter((s: any) => s.status === 'reconciled').length;
    const pending = filtered.filter((s: any) => s.status !== 'reconciled').length;
    return { totalAmount, reconciled, pending, count: filtered.length };
  }, [filtered]);

  const downloadTemplate = () => {
    const isAmazonLike = (selectedChannel?.slug || '').toLowerCase().includes('amazon');
    const amazonTemplate = 'settlement-id,settlement-start-date,settlement-end-date,posted-date-time,order-id,sku,transaction-type,transaction-status,fee-amount,amount,currency,fulfillment-channel,marketplace-name,description\nSETTLEMENT-001,2026-03-01,2026-03-15,2026-03-16 10:30:00,402-1234567-1234567,SKU-001,Order,Released,-70,1200,EGP,Merchant,amazon.eg,Order payment\nSETTLEMENT-001,2026-03-01,2026-03-15,2026-03-16 11:00:00,402-1234567-1234567,SKU-001,Refund,Deferred,38,-1200,EGP,Merchant,amazon.eg,Refund deduction\n';
    const genericTemplate = 'report-id,transaction-date,order-id,sku,transaction-type,transaction-status,fee-amount,amount,currency,description\nPAYMENT-2026-03,2026-03-16 10:30:00,402-1234567-1234567,SKU-001,Order,Released,-20,1200,EGP,Order payment captured\nPAYMENT-2026-03,2026-03-16 11:00:00,402-1234567-1234567,SKU-001,Refund,Deferred,12,-200,EGP,Partial refund\n';
    const blob = new Blob(["\uFEFF" + (isAmazonLike ? amazonTemplate : genericTemplate)], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = isAmazonLike ? 'amazon-payment-sheet-template.csv' : 'channel-payment-sheet-template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('nav.reconciliationHub')}</h1>
          <p className="text-muted-foreground">{isAr ? 'مكان موحّد لرفع شيتات الدفع وتحديث الطلبات والمرتجعات' : 'Upload payment sheets and sync orders/returns across channels'}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
        {channelGroups.map((group: any) => (
          <button
            key={group.key}
            onClick={() => setSelectedChannelId(Number(group.channelIds[0]))}
            className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 group ${selectedChannelGroup?.key === group.key
              ? 'bg-emerald-500/10 border-emerald-500'
              : 'bg-card border-border hover:border-muted-foreground/30 hover:bg-muted/40'
              }`}
          >
            <Building2 className={`w-6 h-6 ${selectedChannelGroup?.key === group.key ? 'text-emerald-400' : 'text-gray-400'}`} />
            <span className={`text-sm font-bold text-center ${selectedChannelGroup?.key === group.key ? 'text-emerald-400' : 'text-gray-400'}`}>
              {group.name}
            </span>
            <span className="text-[10px] text-gray-500 font-mono text-center">{group.slug || '-'}</span>
          </button>
        ))}
      </div>

      <div className="pt-6 border-t border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">{isAr ? 'تحميل شيتات الدفع' : 'Payment Sheets Upload'}</h2>
          <p className="text-sm text-muted-foreground">{isAr ? 'القناة الحالية:' : 'Current channel:'} <span className="text-foreground">{selectedChannelGroup?.name || selectedChannel?.name || '-'}</span></p>
          {selectedChannelGroup && selectedChannelGroup.channels.length > 1 && (
            <p className="text-xs text-muted-foreground">
              {isAr ? `يشمل ${selectedChannelGroup.channels.length} حسابات مرتبطة` : `Includes ${selectedChannelGroup.channels.length} linked channels`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ['settlements'] });
              queryClient.invalidateQueries({ queryKey: ['settlements-summary'] });
            }}
          >
            <RefreshCcw size={16} />
          </Button>
          <Button className="gap-2 bg-slate-700 hover:bg-slate-600 text-white" onClick={downloadTemplate}>
            <Download className="w-4 h-4" />
            {isAr ? 'تحميل Template' : 'Download Template'}
          </Button>
          <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setIsImportOpen(true)} disabled={!selectedChannelGroup}>
            <FileUp className="w-4 h-4" />
            {isAr ? 'رفع شيت الدفع' : 'Upload Payment Sheet'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
        <Card className="border-border bg-card">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{isAr ? 'صافي الربح' : 'Net Profit'}</p>
                <p className="text-2xl font-bold text-blue-600 mt-1">{formatCurrency(toNumber(summary?.net_profit || 0))}</p>
                <p className="text-xs text-muted-foreground mt-1">{isAr ? 'بعد الخصومات' : 'After fees & refunds'}</p>
              </div>
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <DollarSign className="w-5 h-5 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{isAr ? 'إجمالي المرتجعات' : 'Refunds'}</p>
                <p className="text-2xl font-bold text-orange-600 mt-1">{formatCurrency(toNumber(summary?.total_refunds || 0))}</p>
                <p className="text-xs text-muted-foreground mt-1">{toNumber(summary?.refund_count || 0)} {isAr ? 'مرتجع' : 'returns'}</p>
              </div>
              <div className="p-2 bg-orange-500/10 rounded-lg">
                <Undo2 className="w-5 h-5 text-orange-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{isAr ? 'رسوم أمازون' : 'Amazon Fees'}</p>
                <p className="text-2xl font-bold text-red-600 mt-1">{formatCurrency(toNumber(summary?.amazon_fees || 0))}</p>
                <p className="text-xs text-muted-foreground mt-1">{isAr ? 'عمولات وخصومات المنصة' : 'Commission, FBA, and platform charges'}</p>
              </div>
              <div className="p-2 bg-red-500/10 rounded-lg">
                <TrendingDown className="w-5 h-5 text-red-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{isAr ? 'رسوم الشحن' : 'Shipping Fees'}</p>
                <p className="text-2xl font-bold text-amber-600 mt-1">{formatCurrency(toNumber(summary?.shipping_fees || 0))}</p>
                <p className="text-xs text-muted-foreground mt-1">{isAr ? 'HB/Chargeback ورسوم الشحن' : 'Shipping HB/chargeback and shipping costs'}</p>
              </div>
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <Truck size={20} className="text-amber-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{isAr ? 'إجمالي الإيراد' : 'Total Revenue'}</p>
                <p className="text-2xl font-bold text-green-600 mt-1">{formatCurrency(toNumber(summary?.total_revenue || 0))}</p>
                <p className="text-xs text-muted-foreground mt-1">{toNumber(summary?.order_count || 0)} {isAr ? 'عملية طلب' : 'order tx'} - {isAr ? 'إجمالي الرسوم' : 'Fees Total'}: {formatCurrency(toNumber(summary?.total_fees || 0))}</p>
              </div>
              <div className="p-2 bg-green-500/10 rounded-lg">
                <TrendingUp size={20} className="text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{isAr ? 'أموال قيد التأجيل' : 'Deferred / Pending Money'}</p>
                <p className="text-2xl font-bold text-amber-600 mt-1">{formatCurrency(toNumber(summary?.pending_money || 0))}</p>
                <p className="text-xs text-muted-foreground mt-1">{isAr ? 'لا تُحتسب ضمن الربح حتى يتم الإصدار' : 'Excluded from profit until released'}</p>
                <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
                  {isAr
                    ? 'يُحسب من كل الشيتات المرفوعة. اضغط «تحديث» بجانب الرفع لتحديث الأرقام. صفوف «مؤجل» في تقارير قديمة تبقى حتى يُعاد رفع ذلك التقرير أو تحديثه.'
                    : 'Sum across all uploaded reports. Use the refresh button next to Upload to reload KPIs. Deferred rows in older reports remain until that report file is re-imported.'}
                </p>
              </div>
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <Clock size={20} className="text-amber-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={isAr ? 'ابحث برقم التقرير أو رقم الطلب...' : 'Search by report ID or order ID...'}
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40 border-b border-border">
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-muted-foreground">{isAr ? 'رقم التقرير' : 'Report ID'}</TableHead>
              <TableHead className="text-muted-foreground">{isAr ? 'فترة الدورة' : 'Cycle Period'}</TableHead>
              <TableHead className="text-muted-foreground">{isAr ? 'المنصة' : 'Platform'}</TableHead>
              <TableHead className="text-muted-foreground">{isAr ? 'صافي الإيداع' : 'Net Deposit'}</TableHead>
              <TableHead className="text-muted-foreground">{isAr ? 'الحالة' : 'Status'}</TableHead>
              <TableHead className="text-right text-muted-foreground pr-6">{isAr ? 'الإجراءات' : 'Workflow'}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-16 text-muted-foreground">
                  <div className="flex flex-col items-center gap-3">
                    <Landmark className="w-12 h-12 opacity-10" />
                    <p>{isAr ? 'لا توجد تقارير دفع مرفوعة' : 'No payment reports found.'}</p>
                    <Button variant="link" className="text-emerald-500" onClick={() => setIsImportOpen(true)}>{isAr ? 'ارفع أول شيت دفع' : 'Upload first sheet'}</Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.flatMap((s: any) => {
                const isExpanded = selectedSettlementId === s.id;

                const mainRow = (
                  <TableRow
                    key={`settlement-${s.id}`}
                    className={`border-b border-border/40 hover:bg-muted/30 transition-colors group cursor-pointer ${isExpanded ? 'bg-muted/40' : ''}`}
                    onClick={() => setSelectedSettlementId((prev) => (prev === s.id ? null : s.id))}
                  >
                    <TableCell className="font-mono text-sm text-foreground py-4">{s.report_id}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <span className="text-foreground font-medium">{formatDate(s.start_date)}</span>
                      <span className="inline mx-2 text-muted-foreground/60">→</span>
                      <span className="text-foreground font-medium">{formatDate(s.end_date)}</span>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Badge variant="outline" className="bg-muted/30 border-border text-foreground">
                          {s.channel?.name || selectedChannel?.name || '-'}
                        </Badge>
                        {(s.channel?.slug || s.merchant_identifier) && (
                          <p className="text-[10px] text-muted-foreground font-mono">
                            {s.channel?.slug || s.merchant_identifier}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-bold text-foreground">
                      {formatCurrency(s.total_amount, s.currency || 'EGP')}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={`gap-1.5 px-3 py-1 ${s.status === 'reconciled'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : s.status === 'processing'
                            ? 'bg-blue-500/10 text-blue-400 animate-pulse'
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          }`}
                      >
                        {s.status === 'reconciled' ? <CheckCircle size={14} /> : <Clock size={14} />}
                        {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <div className="flex justify-end gap-2">
                        {s.status !== 'reconciled' && (
                          <Button
                            size="sm"
                            className="bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white border border-emerald-500/30"
                            disabled={reconcileMutation.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              reconcileMutation.mutate(s.id);
                            }}
                          >
                        {reconcileMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : (isAr ? 'تسوية' : 'Reconcile')}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 border-red-200 hover:bg-red-50"
                          disabled={deleteSettlementMutation.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            const ok = window.confirm(
                              isAr
                                ? `حذف التسوية ${s.report_id}؟\nسيتم حذف المعاملات وإلغاء الإيصال التلقائي وإعادة حساب حالات الطلبات.\nثم يمكنك رفعها من جديد.`
                                : `Delete settlement ${s.report_id}?\nThis removes its transactions, deletes the auto receipt, and recomputes affected order statuses.\nYou can then re-upload the file.`
                            );
                            if (!ok) return;
                            deleteSettlementMutation.mutate(Number(s.id));
                          }}
                        >
                          {isAr ? 'حذف' : 'Delete'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSettlementId((prev) => (prev === s.id ? null : s.id));
                          }}
                        >
                          {isExpanded ? (isAr ? 'إخفاء المعاملات' : 'Hide Transactions') : (isAr ? 'عرض المعاملات' : 'View Transactions')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );

                if (!isExpanded) return [mainRow];

                const detailsRow = (
                  <TableRow key={`settlement-details-${s.id}`} className="bg-muted/20">
                    <TableCell colSpan={6} className="p-0">
                      <div className="border-t border-border">
                        <div className="px-4 py-3 border-b border-border/70 bg-muted/30 space-y-1">
                          <p className="font-semibold text-foreground text-sm">
                            {isAr ? 'معاملات الشيت' : 'Settlement Transactions'}
                          </p>
                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            {isAr
                              ? 'صافي كل طلب = مجموع عمود «المبلغ» لكل الأسطر (Principal، الشحن، الرسوم، العروض…) — نفس منطق نافذة الطلب وتقرير أرباح الفترة.'
                              : 'Per-order net = sum of the Amount column for every line (Principal, shipping, fees, promos, etc.) — same logic as the order dialog and period profit.'}
                          </p>
                        </div>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>{isAr ? 'النوع' : 'Type'}</TableHead>
                                <TableHead>{isAr ? 'حالة المعاملة' : 'Transaction Status'}</TableHead>
                                <TableHead>{isAr ? 'رقم الطلب' : 'Order ID'}</TableHead>
                                <TableHead>{isAr ? 'رمز المنتج' : 'SKU'}</TableHead>
                                <TableHead>{isAr ? 'التاريخ' : 'Date'}</TableHead>
                                <TableHead>{isAr ? 'الوصف' : 'Description'}</TableHead>
                                <TableHead className="text-right">{isAr ? 'الرسوم' : 'Fees'}</TableHead>
                                <TableHead className="text-right">{isAr ? 'المبلغ' : 'Amount'}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {isTransactionsLoading ? (
                                <TableRow>
                                  <TableCell colSpan={8} className="text-center py-6">
                                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-primary" />
                                  </TableCell>
                                </TableRow>
                              ) : !selectedSettlementDetail?.items?.length ? (
                                <TableRow>
                                  <TableCell colSpan={8} className="text-center py-6 text-muted-foreground">
                                    {isAr ? 'لا توجد معاملات لهذا الشيت' : 'No transactions for this sheet'}
                                  </TableCell>
                                </TableRow>
                              ) : (
                                <>
                                  {settlementSheetOrderRollups.groups.flatMap((group) => {
                                    const lineRows = group.items.map((item: any) => (
                                      <TableRow key={item.id}>
                                        <TableCell>
                                          <Badge variant="outline" className="capitalize">{item.transaction_type || '-'}</Badge>
                                        </TableCell>
                                        <TableCell>
                                          <Badge
                                            variant="outline"
                                            className={getTransactionStatusMeta(item.transaction_status).className}
                                          >
                                            {getTransactionStatusMeta(item.transaction_status).label}
                                          </Badge>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">{item.platform_order_id || '-'}</TableCell>
                                        <TableCell className="font-mono text-xs">{item.sku || '-'}</TableCell>
                                        <TableCell>{item.transaction_date ? formatDate(item.transaction_date) : '-'}</TableCell>
                                        <TableCell className="max-w-[320px] truncate" title={item.description || ''}>{item.description || '-'}</TableCell>
                                        <TableCell className={`text-right font-medium ${toNumber(item.fee_amount) <= 0 ? 'text-red-600' : 'text-green-600'}`}>
                                          {formatCurrency(toNumber(item.fee_amount), item.currency || 'EGP')}
                                        </TableCell>
                                        <TableCell className={`text-right font-medium ${toNumber(item.amount) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                          {formatCurrency(toNumber(item.amount), item.currency || 'EGP')}
                                        </TableCell>
                                      </TableRow>
                                    ));
                                    const sub = (
                                      <TableRow key={`order-net-${group.orderKey}`} className="bg-muted/50 font-semibold border-t border-border/60">
                                        <TableCell colSpan={6} className="text-end text-xs sm:text-sm">
                                          {group.orderKey === '__no_order__'
                                            ? isAr
                                              ? 'مجموع المبلغ (بدون رقم طلب)'
                                              : 'Sum (no order id)'
                                            : isAr
                                              ? `صافي الطلب — مجموع المبلغ (${group.orderKey})`
                                              : `Order net — sum of amounts (${group.orderKey})`}
                                        </TableCell>
                                        <TableCell
                                          className={`text-right text-xs sm:text-sm ${group.sumFees <= 0 ? 'text-red-600' : 'text-green-600'}`}
                                        >
                                          {formatCurrency(group.sumFees, group.currency)}
                                        </TableCell>
                                        <TableCell
                                          className={`text-right text-xs sm:text-sm ${group.sumAmount >= 0 ? 'text-green-600' : 'text-red-600'}`}
                                        >
                                          {formatCurrency(group.sumAmount, group.currency)}
                                        </TableCell>
                                      </TableRow>
                                    );
                                    return [...lineRows, sub];
                                  })}
                                  <TableRow className="bg-muted/70 font-bold border-t-2 border-border">
                                    <TableCell colSpan={6} className="text-end">
                                      {isAr ? 'إجمالي الشيت (كل الطلبات)' : 'Sheet total (all orders)'}
                                    </TableCell>
                                    <TableCell className={`text-right ${settlementSheetOrderRollups.grandFees <= 0 ? 'text-red-600' : 'text-green-600'}`}>
                                      {formatCurrency(
                                        settlementSheetOrderRollups.grandFees,
                                        settlementSheetOrderRollups.groups[0]?.currency || 'EGP'
                                      )}
                                    </TableCell>
                                    <TableCell className={`text-right ${settlementSheetOrderRollups.grandAmount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {formatCurrency(
                                        settlementSheetOrderRollups.grandAmount,
                                        settlementSheetOrderRollups.groups[0]?.currency || 'EGP'
                                      )}
                                    </TableCell>
                                  </TableRow>
                                </>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                );

                return [mainRow, detailsRow];
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Import Dialog */}
      <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
        <DialogContent className="border-border rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-xl">
              <div className="p-2 bg-emerald-500/10 rounded-lg">
                <FileUp className="w-5 h-5 text-emerald-500" />
              </div>
              {isAr ? 'تحميل شيتات الدفع' : 'Upload Payment Sheet'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-6">
            {selectedChannelGroup?.channels?.length > 1 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">
                  {isAr ? 'اختر الحساب المراد الرفع له' : 'Choose target channel for import'}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {selectedChannelGroup.channels.map((ch: any) => (
                    <Button
                      key={ch.id}
                      type="button"
                      variant={Number(selectedImportChannelId) === Number(ch.id) ? 'default' : 'outline'}
                      className={Number(selectedImportChannelId) === Number(ch.id) ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                      onClick={() => setSelectedImportChannelId(Number(ch.id))}
                    >
                      {ch.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <div className="p-8 border-2 border-dashed border-border rounded-2xl flex flex-col items-center justify-center gap-4 bg-muted/20 hover:bg-muted/40 transition-all cursor-pointer group" onClick={() => fileInputRef.current?.click()}>
              <div className="p-4 bg-muted rounded-full group-hover:scale-110 transition-transform">
                <Download className="w-8 h-8 text-emerald-500" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">{isAr ? 'اضغط لاختيار شيت الدفع' : 'Click to upload payment sheet'}</p>
                <p className="text-xs text-muted-foreground mt-1">{isAr ? 'يدعم XML / TXT / CSV' : 'Supports XML / TXT / CSV'}</p>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                onChange={(e) => setSelectedImportFile(e.target.files?.[0] || null)}
                accept=".xml,.csv,.txt"
              />
              {selectedImportFile && (
                <p className="text-xs text-emerald-400 font-mono">{selectedImportFile.name}</p>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {isAr
                ? 'أي Order ID موجود سيتم تحديث حالته المالية مباشرة في الطلبات، وأي Refund سيتم ربطه تلقائيا في صفحة المرتجعات كحالة Pending.'
                : 'Existing order IDs are updated directly in Orders, and refund lines are automatically synced to Returns as pending.'}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsImportOpen(false)}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleImport} disabled={importMutation.isPending || !selectedImportFile || !selectedImportChannelId}>
              {importMutation.isPending ? <Loader2 className="animate-spin mr-2" /> : (isAr ? 'بدء التحديث' : 'Start Update')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
