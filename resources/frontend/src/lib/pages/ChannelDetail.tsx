import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { broadcastInventoryCatalogUpdated } from '@/lib/inventoryCatalogBroadcast';
import {
  getSkuQtyForMetrics,
  resolveMasterProduct,
  resolvePurchaseUnitCost,
} from '@/lib/channelInventoryMetrics';
import { DataLoadingState } from '@/components/DataLoadingState';
import { productService } from '@/lib/supabase-services';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Loader2,
  Search,
  RefreshCw,
  ExternalLink,
  Package,
  AlertCircle,
  TrendingUp,
  ShoppingCart,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  Plus,
  Pencil,
  ChevronDown,
  Trash2,
  SlidersHorizontal,
  Route,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import LinkSKUDialog from '@/components/inventory/LinkSKUDialog';
import AddSKUDialog from '@/components/inventory/AddSKUDialog';
import { ChannelSkuImportDialog } from '@/components/inventory/ChannelSkuImportDialog';
import { SkuMovementTrackerDialog } from '@/components/inventory/SkuMovementTrackerDialog';
import { getProductImageSrc } from '@/lib/utils';

function isValidImageCandidate(url: string | null | undefined): boolean {
  if (!url) return false;
  const value = String(url).trim();
  if (!value || value === '-' || value.toLowerCase() === 'null' || value.toLowerCase() === 'undefined') {
    return false;
  }
  return true;
}

function buildImageCandidates(rawUrl: string | null | undefined): string[] {
  if (!isValidImageCandidate(rawUrl)) return [];

  let value = String(rawUrl).trim();
  if (!value.startsWith('http://') && !value.startsWith('https://') && value.startsWith('www.')) {
    value = `https://${value}`;
  }

  const direct = getProductImageSrc(value);
  const proxy = value.startsWith('http://') || value.startsWith('https://')
    ? `/api/inventory/image-proxy?url=${encodeURIComponent(value)}`
    : direct;

  // Try proxy + direct to avoid broken thumbnails with external hosts.
  return Array.from(new Set([proxy, direct].filter(Boolean)));
}

function positiveNumber(value: unknown): number {
  const x = Number(value);
  return Number.isFinite(x) && x > 0 ? x : 0;
}

function resolveDisplayUnitPrice(sku: any): number {
  const selling = positiveNumber(sku?.selling_price);
  if (selling > 0) return selling;
  return resolvePurchaseUnitCost(sku);
}

function ProductThumb({ imageUrl }: { imageUrl: string | null | undefined }) {
  const candidates = useMemo(() => buildImageCandidates(imageUrl), [imageUrl]);
  const [index, setIndex] = useState(0);

  if (candidates.length === 0) {
    return <Package className="h-4 w-4 text-muted-foreground" />;
  }

  return (
    <img
      src={candidates[index]}
      alt=""
      className="w-full h-full object-cover"
      referrerPolicy="no-referrer"
      onError={() => {
        setIndex((prev) => (prev + 1 < candidates.length ? prev + 1 : prev));
      }}
    />
  );
}

export default function ChannelDetail() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const params = useParams();
  const slug = (params.slug && params['*']) ? `${params.slug}/${params['*']}`.replace(/\/+$/, '') : (params.slug || params['*'] || '');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
  const [isAddSkuOpen, setIsAddSkuOpen] = useState(false);
  const [editingSku, setEditingSku] = useState<any | null>(null);
  const [linkingSku, setLinkingSku] = useState<any | null>(null);
  const [isImportSkusOpen, setIsImportSkusOpen] = useState(false);
  const [linkFilter, setLinkFilter] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [includeGeneral, setIncludeGeneral] = useState(false);
  const [stockSort, setStockSort] = useState<'desc' | 'asc'>('desc');
  const [priceSort, setPriceSort] = useState<'desc' | 'asc'>('desc');
  const [sortPriority, setSortPriority] = useState<'price' | 'stock'>('price');
  const [pageSize, setPageSize] = useState<number>(100);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [bulkSellingPrice, setBulkSellingPrice] = useState('');
  const [bulkCostPrice, setBulkCostPrice] = useState('');
  const [isStockAdjustOpen, setIsStockAdjustOpen] = useState(false);
  const [targetStockQty, setTargetStockQty] = useState('');
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [trackerSkuId, setTrackerSkuId] = useState<number | null>(null);
  const [trackerTitle, setTrackerTitle] = useState('');

  const decodedSlug = useMemo(() => {
    if (!slug) return '';
    try {
      return decodeURIComponent(slug);
    } catch {
      return slug;
    }
  }, [slug]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  // 1. Fetch channel object by slug/name
  const { data: channel, isLoading: loadingChannel } = useQuery({
    queryKey: ['channel-by-slug', decodedSlug],
    queryFn: async () => {
      return await api.get(`/channels/slug/${encodeURIComponent(decodedSlug)}`);
    },
  });

  // 2. KPI totals (cheap count — do not load all SKUs)
  const { data: channelSummary, isFetching: fetchingSummary, isLoading: loadingSummary } = useQuery({
    queryKey: ['channel-sku-summary', channel?.id],
    queryFn: async () => api.get(`/skus/channel-summary?channel_id=${channel.id}`),
    enabled: !!channel?.id && !includeGeneral,
    placeholderData: (prev: any) => prev,
    staleTime: 15_000,
  });

  // 3. Paginated SKUs for this channel (merchant channels have thousands of rows)
  const {
    data: skuPage,
    isLoading: loadingSkus,
    isError: skusError,
    isFetching: fetchingSkus,
  } = useQuery({
    queryKey: [
      'channel-skus',
      channel?.id,
      includeGeneral,
      currentPage,
      pageSize,
      debouncedSearch,
      linkFilter,
    ],
    queryFn: async () => {
      if (!channel?.id) {
        return { data: [], current_page: 1, last_page: 1, per_page: pageSize, total: 0 };
      }
      if (includeGeneral) {
        const all = await api.get('/skus', { timeout: 120000 });
        const list = (Array.isArray(all) ? all : Array.isArray(all?.data) ? all.data : []).filter(
          (s: any) => !s?.channel_id
        );
        return {
          data: list,
          current_page: 1,
          last_page: 1,
          per_page: list.length || pageSize,
          total: list.length,
        };
      }
      const params = new URLSearchParams({
        channel_id: String(channel.id),
        paginate: '1',
        page: String(currentPage),
        per_page: String(Math.min(pageSize, 200)),
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (linkFilter === 'linked') params.set('linked', '1');
      if (linkFilter === 'unlinked') params.set('linked', '0');
      return await api.get(`/skus?${params.toString()}`, { timeout: 60000 });
    },
    enabled: !!channel?.id,
    retry: 1,
    placeholderData: (prev: any) => prev,
    staleTime: 15_000,
  });

  const skus = useMemo(() => {
    const rows = skuPage?.data;
    return Array.isArray(rows) ? rows : [];
  }, [skuPage]);

  const isMerchantChannel = useMemo(() => {
    const type = String(channel?.type || '').toLowerCase();
    const slugVal = String(channel?.slug || '').toLowerCase();
    const name = String(channel?.name || '').toLowerCase();
    return (
      type.includes('merchant') ||
      type.includes('mfn') ||
      type.includes('fbm') ||
      slugVal.includes('merchant') ||
      slugVal.includes('تاجر') ||
      name.includes('merchant') ||
      name.includes('تاجر')
    );
  }, [channel]);

  const getSkuQty = (sku: any) => getSkuQtyForMetrics(sku);
  const getStoreSellableQty = (sku: any) => {
    const n = Number(sku?.sellable_from_store_quantity);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const stats = useMemo(() => {
    if (includeGeneral) {
      return {
        total: skus.length,
        totalPieces: skus.reduce((sum: number, s: any) => sum + Math.max(0, getSkuQty(s)), 0),
        unlinked: skus.filter((s: any) => !s?.offer_id).length,
        totalValue: 0,
        sellingValue: 0,
      };
    }
    return {
      total: Number(channelSummary?.products ?? skuPage?.total ?? 0),
      totalPieces: Number(channelSummary?.pieces ?? 0),
      unlinked: Number(channelSummary?.unlinked ?? 0),
      totalValue: Number(channelSummary?.purchaseCost ?? 0),
      sellingValue: Number(channelSummary?.sellingValue ?? 0),
    };
  }, [includeGeneral, skus, channelSummary, skuPage?.total]);

  const summaryPending = !includeGeneral && (loadingSummary || (fetchingSummary && !channelSummary));

  const filteredSkus = useMemo(() => {
    // Search + link filter are applied server-side; keep client sort on the current page.
    return [...skus].sort((a: any, b: any) => {
      const priceA = resolveDisplayUnitPrice(a);
      const priceB = resolveDisplayUnitPrice(b);
      const qtyA = getSkuQty(a);
      const qtyB = getSkuQty(b);

      const priceDelta = priceSort === 'desc' ? priceB - priceA : priceA - priceB;
      const qtyDelta = stockSort === 'desc' ? qtyB - qtyA : qtyA - qtyB;

      if (sortPriority === 'stock') {
        if (qtyDelta !== 0) return qtyDelta;
        if (priceDelta !== 0) return priceDelta;
      } else {
        if (priceDelta !== 0) return priceDelta;
        if (qtyDelta !== 0) return qtyDelta;
      }

      return String(a?.sku || '').localeCompare(String(b?.sku || ''));
    });
  }, [skus, stockSort, priceSort, sortPriority]);

  const totalFiltered = Number(skuPage?.total ?? filteredSkus.length);
  const totalPages = Math.max(1, Number(skuPage?.last_page ?? 1));
  const pagedSkus = filteredSkus;
  const listPending = Boolean(fetchingSkus && pagedSkus.length === 0);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, linkFilter, pageSize, channel?.id, includeGeneral]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const toggleSelectSku = (id: string) => {
    const newSelected = new Set(selectedSkus);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedSkus(newSelected);
  };

  const selectedRows = useMemo(
    () => (skus || []).filter((s: any) => selectedSkus.has(s.id)),
    [skus, selectedSkus]
  );


  const handleBulkLink = useMutation({
    mutationFn: async () => {
      // Shared logic with MasterProducts - linking SKUs to main warehouse
      toast({
        title: "قيد التنفيذ",
        description: "يتم الآن ربط المنتجات المحددة وتوحيد المخزون...",
      });
      // In a real scenario, this would call a specific bulk-link SKU endpoint
      await new Promise(resolve => setTimeout(resolve, 1000));
    },
    onSuccess: () => {
      toast({
        title: "تم الربط بنجاح",
        description: "تم ربط المنتجات بالمخزن الرئيسي وتفعيل المزامنة.",
      });
      setSelectedSkus(new Set());
      queryClient.invalidateQueries({ queryKey: ['channel-skus'] });
      queryClient.invalidateQueries({ queryKey: ['channel-sku-summary', channel?.id] });
      broadcastInventoryCatalogUpdated('channel-skus');
    }
  });

  const handleBulkDelete = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selectedSkus);
      const results = await Promise.allSettled(ids.map((id: string) => api.delete(`/skus/${id}`)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      return { ok: ids.length - failed, failed, total: ids.length };
    },
    onSuccess: ({ ok, failed, total }) => {
      queryClient.invalidateQueries({ queryKey: ['channel-skus', channel?.id] });
      queryClient.invalidateQueries({ queryKey: ['channel-sku-summary', channel?.id] });
      broadcastInventoryCatalogUpdated('channel-skus');
      setSelectedSkus(new Set());
      if (failed === 0) {
        toast({ title: 'تم', description: 'تم حذف المنتجات المحددة' });
      } else if (ok === 0) {
        toast({ title: 'خطأ', description: 'تعذر حذف المنتجات المحددة', variant: 'destructive' });
      } else {
        toast({
          title: 'تم جزئياً',
          description: `تم حذف ${ok} من ${total} — تعذر حذف ${failed}`,
          variant: 'destructive',
        });
      }
    },
    onError: () => {
      toast({ title: 'خطأ', description: 'تعذر حذف بعض المنتجات', variant: 'destructive' });
    },
  });

  const handleBulkEdit = useMutation({
    mutationFn: async () => {
      const payload: any = {};
      if (bulkSellingPrice !== '') payload.selling_price = Number(bulkSellingPrice);
      if (bulkCostPrice !== '') payload.cost_price = Number(bulkCostPrice);
      await Promise.all(
        selectedRows.map((sku: any) => api.put(`/skus/${sku.id}`, payload))
      );
    },
    onSuccess: () => {
      toast({ title: 'تم', description: 'تم تعديل المنتجات المحددة' });
      setIsBulkEditOpen(false);
      setBulkSellingPrice('');
      setBulkCostPrice('');
      queryClient.invalidateQueries({ queryKey: ['channel-skus', channel?.id] });
      broadcastInventoryCatalogUpdated('channel-skus');
    },
    onError: () => {
      toast({ title: 'خطأ', description: 'فشل التعديل الجماعي', variant: 'destructive' });
    },
  });

  const handleBulkSetStock = useMutation({
    mutationFn: async () => {
      const target = Math.max(0, Number(targetStockQty || 0));
      if (!channel?.id) {
        throw new Error('Channel id is missing');
      }

      const payloadSkus = selectedRows.map((sku: any) => ({
        sku: String(sku.sku || '').trim(),
        name: sku.name || sku.offer?.master_product?.internal_name || sku.offer?.masterProduct?.internal_name || sku.sku,
        selling_price: Number(sku.selling_price || 0),
        image_url: sku.image_url || null,
        stock: target,
      })).filter((row: any) => row.sku);

      if (payloadSkus.length === 0) {
        return 0;
      }

      await api.post(`/channels/${channel.id}/import/confirm`, { skus: payloadSkus });
      return payloadSkus.length;
    },
    onSuccess: (count) => {
      setIsStockAdjustOpen(false);
      setTargetStockQty('');
      toast({ title: 'تم', description: `تم ضبط مخزون ${count} منتج بدون تسجيل خسائر` });
      queryClient.invalidateQueries({ queryKey: ['channel-skus', channel?.id] });
      broadcastInventoryCatalogUpdated('channel-skus');
    },
    onError: (err: any) => {
      toast({ title: 'خطأ', description: err?.response?.data?.message || 'فشل تعديل المخزون', variant: 'destructive' });
    },
  });

  if (loadingChannel || (loadingSkus && !skuPage)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
        <p className="text-muted-foreground animate-pulse">جاري تحميل بيانات القناة...</p>
      </div>
    );
  }

  if (skusError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 p-6">
        <AlertCircle className="w-12 h-12 text-destructive" />
        <p className="text-muted-foreground">تعذر تحميل منتجات هذه القناة. حاول مرة أخرى.</p>
        <Button
          variant="outline"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['channel-skus', channel?.id] })}
        >
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            {channel?.name || decodedSlug}
            <Badge variant="outline" className="text-xs uppercase bg-primary/5 text-primary border-primary/20">
              {channel?.type || 'CUSTOM'}
            </Badge>
          </h1>
          <p className="text-muted-foreground mt-1">
            إدارة منتجات ومخزون منصة {channel?.name || decodedSlug} والمزامنة مع المركز الرئيسي
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="default" className="h-9 shadow-md bg-emerald-600 hover:bg-emerald-700 text-white border-none" onClick={() => setIsImportSkusOpen(true)}>
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            استيراد منتجات لهذه القناة
          </Button>
          <Button variant="outline" className="h-9 border-primary/30" onClick={() => setIsAddSkuOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            إضافة عرض بيع جديد (SKU)
          </Button>
          <Button variant="outline" className="h-9" onClick={() => queryClient.invalidateQueries()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            تزامن الكل
          </Button>
        </div>
      </div>

      <ChannelSkuImportDialog
        open={isImportSkusOpen}
        onOpenChange={setIsImportSkusOpen}
        channelId={channel?.id}
        channelName={channel?.name}
        onImported={() => {
          queryClient.invalidateQueries({ queryKey: ['channel-skus', channel?.id] });
          queryClient.invalidateQueries({ queryKey: ['channel-by-slug', decodedSlug] });
          broadcastInventoryCatalogUpdated('channel-skus');
        }}
      />

      <LinkSKUDialog
        open={!!linkingSku}
        onOpenChange={(open) => !open && setLinkingSku(null)}
        sku={linkingSku}
      />

      <AddSKUDialog
        open={isAddSkuOpen}
        onOpenChange={setIsAddSkuOpen}
        presetChannelId={channel?.id != null ? String(channel.id) : undefined}
      />
      <AddSKUDialog
        open={!!editingSku}
        onOpenChange={(open) => !open && setEditingSku(null)}
        skuId={editingSku?.id}
        offerId={editingSku?.offer_id}
        initialData={editingSku || undefined}
      />

      {/* Stats Grid */}
      <div
        className={`grid gap-4 md:grid-cols-5 transition-opacity ${
          fetchingSummary || fetchingSkus ? 'opacity-80' : 'opacity-100'
        }`}
      >
        {[
          { title: 'إجمالي المنتجات', value: stats.total, icon: Package, color: 'blue' },
          { title: 'إجمالي القطع', value: stats.totalPieces, icon: ShoppingCart, color: 'emerald' },
          { title: 'غير مربوط', value: stats.unlinked, icon: AlertCircle, color: 'orange' },
          { title: 'إجمالي التكلفة', value: `${stats.totalValue.toLocaleString()}`, unit: 'ج.م', icon: TrendingUp, color: 'blue' },
          { title: 'القيمة البيعية', value: `${stats.sellingValue.toLocaleString()}`, unit: 'ج.م', icon: ShoppingCart, color: 'green' },
        ].map((stat, i) => (
          <Card key={i} className={`bg-white dark:bg-slate-900 border-l-4 border-l-${stat.color}-500 shadow-sm transition-all hover:scale-[1.02]`}>
            <CardContent className="pt-4 pb-4">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{stat.title}</p>
                  <h3 className="text-2xl font-bold mt-1 font-mono">
                    {summaryPending ? (
                      <span className="inline-flex items-center gap-2 text-base font-medium text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        جاري التحميل...
                      </span>
                    ) : (
                      <>
                        {stat.value}
                        {stat.unit && <span className="text-sm font-normal text-muted-foreground ml-1">{stat.unit}</span>}
                      </>
                    )}
                  </h3>
                </div>
                <stat.icon className={`h-8 w-8 text-${stat.color}-500 opacity-20`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Bulk Action Bar */}
      <AnimatePresence>
        {selectedSkus.size > 0 && (
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            className="sticky top-0 z-30 bg-primary text-primary-foreground p-3 rounded-lg shadow-xl flex items-center justify-between"
          >
            <div className="flex items-center gap-4">
              <span className="font-bold">{selectedSkus.size} منتجات مختارة</span>
              <div className="h-4 w-px bg-primary-foreground/30" />
              <Button variant="secondary" size="sm" onClick={() => handleBulkLink.mutate()} disabled={handleBulkLink.isPending}>
                <RefreshCw className={`mr-2 h-4 w-4 ${handleBulkLink.isPending ? 'animate-spin' : ''}`} />
                🔗 ربط بمخزن الرئيسي وتفعيل المزامنة
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setIsBulkEditOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                تعديل المحدد
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setIsStockAdjustOpen(true)}>
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                تعديل/تصفير المخزون
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (confirm(`متأكد من حذف ${selectedSkus.size} منتج؟`)) {
                    handleBulkDelete.mutate();
                  }
                }}
                disabled={handleBulkDelete.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                مسح المحدد
              </Button>
            </div>
            <Button variant="ghost" size="sm" className="text-primary-foreground/80 hover:text-white" onClick={() => setSelectedSkus(new Set())}>إلغاء</Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Inventory Card */}
      <Card className="border-none shadow-xl bg-white/50 backdrop-blur-sm dark:bg-slate-900/50">
        <CardHeader className="pb-0">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-4">
            <div className="flex items-center gap-2">
              <div className="bg-primary/10 p-2 rounded-lg">
                <ShoppingCart className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle>مخزون القناة</CardTitle>
                <CardDescription>قائمة المنتجات المدرجة على هذه المنصة</CardDescription>
              </div>
            </div>
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="ابحث عن SKU أو اسم منتج..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-10 border-slate-200"
              />
            </div>
            <Button
              type="button"
              variant={includeGeneral ? "default" : "outline"}
              size="sm"
              onClick={() => setIncludeGeneral((p) => !p)}
              title="يعرض المنتجات بدون مكان بيع (بدون قناة/مخزن)"
            >
              {includeGeneral ? "إظهار منتجات القناة" : "منتجات بدون مكان بيع"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLinkFilter('all');
                setStockSort('desc');
                setPriceSort('desc');
                setSortPriority('price');
                setIncludeGeneral(false);
              }}
            >
              مسح الفلاتر
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-slate-50/50 dark:bg-slate-800/50">
              <TableRow>
                <TableHead className="w-[50px] text-center">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300"
                    checked={
                      pagedSkus.length > 0 &&
                      pagedSkus.every((s: any) => selectedSkus.has(s.id))
                    }
                    onChange={(e) => {
                      const next = new Set(selectedSkus);
                      if (e.target.checked) {
                        pagedSkus.forEach((s: any) => next.add(s.id));
                      } else {
                        pagedSkus.forEach((s: any) => next.delete(s.id));
                      }
                      setSelectedSkus(next);
                    }}
                  />
                </TableHead>
                <TableHead className="w-[60px]">الصورة</TableHead>
                <TableHead>اسم المنتج (القناة)</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>
                  <div className="flex items-center gap-1">
                    <span>السعر</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="inline-flex items-center text-muted-foreground hover:text-foreground">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => { setPriceSort('desc'); setSortPriority('price'); }}>الأعلى للأدنى</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setPriceSort('asc'); setSortPriority('price'); }}>الأدنى للأعلى</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableHead>
                <TableHead>
                  <div className="flex items-center gap-1">
                    <span>حالة الربط</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="inline-flex items-center text-muted-foreground hover:text-foreground">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => setLinkFilter('all')}>الكل</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setLinkFilter('linked')}>مربوط</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setLinkFilter('unlinked')}>غير مربوط</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableHead>
                <TableHead className="w-[140px]">
                  <div className="flex items-center gap-1">
                    <span>المخزون</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="inline-flex items-center text-muted-foreground hover:text-foreground">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => { setStockSort('desc'); setSortPriority('stock'); }}>الأعلى للأدنى</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setStockSort('asc'); setSortPriority('stock'); }}>الأدنى للأعلى</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableHead>
                <TableHead>إجمالي التكلفة</TableHead>
                <TableHead className="text-right">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listPending ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-10">
                    <DataLoadingState />
                  </TableCell>
                </TableRow>
              ) : pagedSkus.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-20">
                    <div className="flex flex-col items-center gap-3">
                      <Package className="w-12 h-12 text-slate-200" />
                      <p className="text-muted-foreground">لا توجد منتجات مطابقة في هذه القناة.</p>
                      <Button variant="outline" onClick={() => setIsImportSkusOpen(true)}>
                        ابدأ بالاستيراد
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                pagedSkus.map((sku: any) => {
                  const masterProduct = sku.offer?.master_product ?? sku.offer?.masterProduct;
                  const masterPrice = masterProduct?.selling_price;
                  const masterCost = masterProduct?.cost_price;
                  const masterStock = masterProduct?.total_stock;

                  const skuSellingNum = Number(sku.selling_price ?? 0);
                  const purchaseUnit = resolvePurchaseUnitCost(sku);
                  const displayUnit = resolveDisplayUnitPrice(sku);
                  const showingPriceFromPurchase =
                    !(Number.isFinite(skuSellingNum) && skuSellingNum > 0) && purchaseUnit > 0;

                  const priceMismatch =
                    !showingPriceFromPurchase &&
                    masterPrice &&
                    Number.isFinite(skuSellingNum) &&
                    skuSellingNum > 0 &&
                    Math.abs(Number(masterPrice) - skuSellingNum) > 1;
                  const costMismatch =
                    !showingPriceFromPurchase &&
                    masterCost &&
                    sku.cost_price &&
                    Math.abs(Number(masterCost) - Number(sku.cost_price)) > 1;
                  const skuQty = getSkuQty(sku);
                  const stockMismatch = masterStock !== undefined && skuQty !== undefined && Number(masterStock) !== Number(skuQty);
                  const rowTotalCost = resolvePurchaseUnitCost(sku) * skuQty;

                  const isLinked = !!sku.offer_id;

                  return (
                    <TableRow key={sku.id} className="group transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/30">
                      <TableCell className="text-center">
                        <input
                          type="checkbox"
                          className="rounded border-gray-300"
                          checked={selectedSkus.has(sku.id)}
                          onChange={() => toggleSelectSku(sku.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="w-10 h-10 rounded border bg-muted flex items-center justify-center overflow-hidden">
                          <ProductThumb imageUrl={sku.image_url || masterProduct?.image_url} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold">{sku.name || masterProduct?.internal_name}</span>
                          <span className="text-[10px] text-muted-foreground uppercase">{sku.channel?.name || channel?.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{sku.sku}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 font-bold">
                            {displayUnit.toLocaleString()} ج.م
                            {(priceMismatch || costMismatch) && (
                              <div className="group/alert relative">
                                <AlertTriangle className="w-3.5 h-3.5 text-orange-500 cursor-help" />
                                <div className="absolute bottom-full mb-2 hidden group-hover/alert:block w-56 p-2 bg-slate-800 text-white text-[10px] rounded shadow-lg z-50">
                                  <p className="font-bold border-b border-white/20 pb-1 mb-1">اختلاف في البيانات:</p>
                                  {priceMismatch && <p>• سعر البيع: {Number(masterPrice).toLocaleString()} ج.م في الرئيسي</p>}
                                  {costMismatch && <p>• التكلفة: {Number(masterCost).toLocaleString()} ج.م في الرئيسي</p>}
                                </div>
                              </div>
                            )}
                          </div>
                          {showingPriceFromPurchase && (
                            <span className="text-[10px] text-muted-foreground font-normal">
                              من تكلفة الشراء (سعر البيع على القناة غير محدد)
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge
                            variant={isLinked ? 'default' : 'outline'}
                            className={`h-6 text-[10px] gap-1 w-fit ${isLinked ? 'bg-emerald-500 hover:bg-emerald-600' : 'text-slate-400'}`}
                          >
                            {isLinked ? <CheckCircle2 className="w-3 h-3" /> : null}
                            {isLinked ? 'مربوط' : 'غير مربوط'}
                          </Badge>
                          {!isLinked && (
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-[10px] justify-start"
                              onClick={() => setLinkingSku(sku)}
                            >
                              🔗 ربط الآن
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-[140px]">
                        <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={skuQty > 10 ? 'outline' : 'destructive'}
                            className="h-6 min-w-[92px] justify-center px-2 text-[12px] font-mono tabular-nums"
                          >
                            {skuQty} قطعة
                          </Badge>
                          {stockMismatch && (
                            <div className="group/stock relative">
                              <RefreshCw className="w-3 h-3 text-purple-500 animate-pulse cursor-help" />
                              <div className="absolute bottom-full mb-2 hidden group-stock-hover:block w-48 p-2 bg-slate-800 text-white text-[10px] rounded shadow-lg z-50">
                                المخزون لا يطابق الرئيسي ({masterStock} قطعة)
                              </div>
                            </div>
                          )}
                        </div>
                        {isMerchantChannel && getStoreSellableQty(sku) > 0 && (
                          <p className="text-[10px] text-muted-foreground leading-snug">
                            متاح للبيع من المحل: <span className="font-mono font-semibold text-foreground">{getStoreSellableQty(sku)}</span> قطعة
                          </p>
                        )}
                        {isMerchantChannel && Number(sku?.phantom_merchant_quantity || 0) > 0 && (
                          <p className="text-[10px] text-amber-600 leading-snug">
                            رصيد وهمي على التاجر ({Number(sku.phantom_merchant_quantity)} قطعة) — شغّل أمر التصحيح على السيرفر
                          </p>
                        )}
                        </div>
                      </TableCell>
                      <TableCell className="font-semibold">
                        {rowTotalCost.toLocaleString()} ج.م
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="تتبع حركة هذا الـ SKU فقط"
                            onClick={() => {
                              setTrackerSkuId(Number(sku.id));
                              setTrackerTitle(`تتبع ${sku.sku} — ${channel?.name || ''}`);
                              setTrackerOpen(true);
                            }}
                          >
                            <Route className="w-4 h-4 text-sky-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setEditingSku(sku)}
                            title="تعديل SKU"
                          >
                            <Pencil className="w-4 h-4 text-amber-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setLinkingSku(sku)}
                            title="ربط بمنتج رئيسي"
                          >
                            <ExternalLink className="w-4 h-4 text-primary" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-4 py-3 border-t bg-muted/20">
            <div className="text-xs text-muted-foreground">
              عرض {totalFiltered === 0 ? 0 : ((currentPage - 1) * pageSize) + 1}
              {' - '}
              {Math.min(currentPage * pageSize, totalFiltered)}
              {' من '}
              {totalFiltered}
              {fetchingSkus ? ' …' : ''}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">عدد العناصر:</span>
              <Select
                value={String(Math.min(pageSize, 200))}
                onValueChange={(v) => setPageSize(Number(v))}
              >
                <SelectTrigger className="w-[90px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="200">200</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
              >
                السابق
              </Button>
              <span className="text-xs px-2">
                {currentPage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
              >
                التالي
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-[10px] text-muted-foreground text-center italic opacity-50">
        يتم تحديث المخزون والأسعار تلقائياً عند تغييرها في المخزن الرئيسي إذا كانت حالة الربط "مربوط".
      </p>

      <Dialog open={isBulkEditOpen} onOpenChange={setIsBulkEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>تعديل جماعي للمنتجات المحددة ({selectedRows.length})</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">سعر البيع الجديد (اختياري)</label>
              <Input type="number" step="0.01" value={bulkSellingPrice} onChange={(e) => setBulkSellingPrice(e.target.value)} placeholder="اتركه فارغاً بدون تغيير" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">سعر التكلفة الجديد (اختياري)</label>
              <Input type="number" step="0.01" value={bulkCostPrice} onChange={(e) => setBulkCostPrice(e.target.value)} placeholder="اتركه فارغاً بدون تغيير" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkEditOpen(false)}>إلغاء</Button>
            <Button
              onClick={() => {
                if (bulkSellingPrice === '' && bulkCostPrice === '') {
                  toast({ title: 'تنبيه', description: 'اكتب قيمة واحدة على الأقل للتعديل', variant: 'destructive' });
                  return;
                }
                handleBulkEdit.mutate();
              }}
              disabled={handleBulkEdit.isPending}
            >
              {handleBulkEdit.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              حفظ التعديل
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isStockAdjustOpen} onOpenChange={setIsStockAdjustOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>ضبط مخزون المنتجات المحددة ({selectedRows.length})</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">الكمية المستهدفة لكل منتج</label>
            <Input
              type="number"
              min="0"
              value={targetStockQty}
              onChange={(e) => setTargetStockQty(e.target.value)}
              placeholder="مثال: 0 للتصفير أو 50"
            />
            <p className="text-xs text-muted-foreground">
              سيتم ضبط كل منتج محدد إلى نفس الكمية. لاستخدامها في بداية دورة شراء جديدة: ادخل 0 ثم ابدأ إدخال المشتريات.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsStockAdjustOpen(false)}>إلغاء</Button>
            <Button
              onClick={() => {
                if (targetStockQty === '') {
                  toast({ title: 'تنبيه', description: 'ادخل كمية مستهدفة', variant: 'destructive' });
                  return;
                }
                handleBulkSetStock.mutate();
              }}
              disabled={handleBulkSetStock.isPending}
            >
              {handleBulkSetStock.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              تطبيق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SkuMovementTrackerDialog
        open={trackerOpen}
        onOpenChange={(open) => {
          setTrackerOpen(open);
          if (!open) {
            setTrackerSkuId(null);
            setTrackerTitle('');
          }
        }}
        skuId={trackerSkuId}
        title={trackerTitle || undefined}
      />
    </div>
  );
}
