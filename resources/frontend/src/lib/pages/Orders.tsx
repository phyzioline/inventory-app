import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { ShoppingCart, Plus, Search, Loader2, AlertTriangle, Package, ArrowUpDown, DollarSign, RotateCcw, TrendingUp, MoreHorizontal, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import api from '@/lib/api';
import { toast } from 'sonner';
import { CreateSalesOrderDialog } from '@/components/sales/CreateSalesOrderDialog';
import { QuickShopSaleDialog } from '@/components/sales/QuickShopSaleDialog';
import { OrderInvoiceDetailDialog } from '@/components/sales/OrderInvoiceDetailDialog';
import { OrderImportDialog } from '@/components/inventory/OrderImportDialog';
import { getProductImageSrc } from '@/lib/utils';
import { useReturns } from '@/hooks/useReturns';

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-500',
  processing: 'bg-blue-500/10 text-blue-500',
  shipped: 'bg-purple-500/10 text-purple-500',
  delivered: 'bg-green-500/10 text-green-500',
  sold: 'bg-green-500/10 text-green-500',
  cancelled: 'bg-red-500/10 text-red-500',
  returned: 'bg-orange-500/10 text-orange-500',
};

function formatOrderStatusLabel(status: string | null | undefined, isAr: boolean): string {
  const key = String(status || '').toLowerCase();
  if (isAr) {
    const ar: Record<string, string> = {
      pending: 'قيد الانتظار',
      processing: 'قيد المعالجة',
      shipped: 'تم الشحن',
      delivered: 'تم التسليم',
      sold: 'مباع',
      cancelled: 'ملغي',
      returned: 'مرتجع',
    };
    return ar[key] || (key ? status || 'غير معروف' : 'غير معروف');
  }
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Unknown';
}

const paymentColors: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-500',
  charged: 'bg-blue-500/10 text-blue-500',
  pending_settlement: 'bg-indigo-500/10 text-indigo-500',
  settled: 'bg-green-500/10 text-green-500',
  refunded: 'bg-red-500/10 text-red-500',
  shipping_adjustment: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  cancelled: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
};

function isOrderCancelledRecord(order: any): boolean {
  const st = String(order?.status || '').toLowerCase();
  const fin = String(order?.financial_status || '').toLowerCase();
  return st === 'cancelled' || fin === 'cancelled';
}

const toNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const pickFirstPositive = (...values: unknown[]) => {
  for (const value of values) {
    const n = toNumber(value);
    if (n > 0) return n;
  }
  return 0;
};

const getLinkedMasterProduct = (row: any) =>
  row?.sku?.offer?.master_product
  || row?.sku?.offer?.masterProduct
  || row?.offer?.master_product
  || row?.offer?.masterProduct
  || row?.master_product
  || row?.masterProduct
  || null;

/** Shop purchase unit cost from master product (last purchase from purchase invoices). */
const resolveShopPurchaseUnitCost = (row: any): number => {
  const master = getLinkedMasterProduct(row);
  if (!master) return 0;
  return pickFirstPositive(
    master?.last_purchase_price,
    master?.avg_purchase_price,
    master?.cost_price,
    master?.specifications?.cost_price
  );
};

const orderLineCogs = (order: any): number => {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.reduce((sum: number, item: any) => {
    const qty = toNumber(item?.quantity);
    if (qty <= 0) return sum;
    return sum + qty * resolveShopPurchaseUnitCost(item);
  }, 0);
};

function isValidImageCandidate(url: string | null | undefined): boolean {
  if (!url) return false;
  const value = String(url).trim();
  if (!value || value === '-' || value.toLowerCase() === 'null' || value.toLowerCase() === 'undefined') {
    return false;
  }
  return true;
}

type LastImportBatchSnapshot = {
  available: boolean;
  transaction_count: number;
  /** Present on newer API; default 0 when missing */
  new_orders_count?: number;
  recorded_at: string | null;
  hint?: string | null;
};

function rollbackDisabledExplanation(
  isAr: boolean,
  hint: string | null | undefined,
  fetchError: boolean
): string {
  if (fetchError) {
    return isAr ? 'تعذر التحقق من الخادم. جرّب تحديث الصفحة.' : 'Could not load rollback status. Try refreshing.';
  }
  switch (hint) {
    case 'fba_no_local_deduction':
      return isAr
        ? 'آخر استيراد من قناة FBA: النظام لا يخصم المخزون المحلي لهذه القنوات، فلا يوجد ما يُسترجع من هنا.'
        : 'Your last import was an FBA channel: local stock is not deducted for FBA, so there is nothing to roll back here.';
    case 'no_deduction_lines':
      return isAr
        ? 'آخر استيراد لم يُنشئ خصومات مخزون (مثلاً طلبات مكررة/تحديثات فقط، أو لم يُربط المستودع بالقناة).'
        : 'Last import did not create stock deductions (e.g. only duplicates/updates, or warehouse not linked to the channel).';
    case 'no_recent_import':
      return isAr
        ? 'لا يوجد آخر استيراد مسجّل في قاعدة البيانات لهذا الحساب. (إن كان عندك دفعة قديمة في كاش السيرفر فقط، افتح الصفحة مرة بعد التحديث لنقلها تلقائياً؛ وإلا لا يمكن استرجاع استيراد لم يُسجّل أصلاً.)'
        : 'No last import batch is stored in the database for this account. (If an older batch only lived in server cache, loading this page once after upgrade may migrate it; otherwise a batch that was never recorded cannot be rolled back.)';
    case 'not_authenticated':
      return isAr ? 'يجب تسجيل الدخول.' : 'You must be signed in.';
    default:
      return isAr
        ? 'لا توجد دفعة استيراد يمكن عكسها من هنا.'
        : 'There is no recorded import batch to reverse here.';
  }
}

function rollbackReadyTooltip(isAr: boolean, tx: number, orders: number): string {
  const parts: string[] = [];
  if (tx > 0) {
    parts.push(
      isAr
        ? `إرجاع مخزون من ${tx} حركة خصم مسجّلة.`
        : `Restock from ${tx} recorded stock deduction line(s).`
    );
  }
  if (orders > 0) {
    parts.push(
      isAr
        ? `حذف ${orders} طلباً أُنشئ في ذلك الاستيراد (وبنوده) بعد فك ارتباط التسويات الاختيارية.`
        : `Delete ${orders} order(s) created in that import (and their lines), after clearing optional links.`
    );
  }
  if (parts.length === 0) {
    return isAr ? 'لا توجد تفاصيل للعرض.' : 'No rollback details.';
  }
  return parts.join(isAr ? ' ' : ' ');
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

  return Array.from(new Set([proxy, direct].filter(Boolean)));
}

function OrderThumb({ order, alt }: { order: any; alt: string }) {
  const candidates = useMemo(() => {
    const items = Array.isArray(order?.items) ? order.items : [];
    const allSources: string[] = [];

    for (const item of items) {
      allSources.push(
        item?.image_url,
        item?.product_image,
        item?.product_image_url,
        item?.thumbnail,
        item?.sku?.image_url,
        item?.sku?.thumbnail,
        item?.sku?.offer?.master_product?.image_url,
        item?.sku?.offer?.master_product?.thumbnail,
        item?.sku?.offer?.masterProduct?.image_url,
        item?.sku?.offer?.masterProduct?.thumbnail
      );

      const masterImages =
        item?.sku?.offer?.master_product?.images ||
        item?.sku?.offer?.masterProduct?.images ||
        item?.sku?.offer?.master_product?.specifications?.images ||
        item?.sku?.offer?.masterProduct?.specifications?.images;
      if (Array.isArray(masterImages)) {
        allSources.push(...masterImages);
      }
    }

    const normalized = Array.from(
      new Set(
        allSources
          .map((entry) => (entry == null ? '' : String(entry).trim()))
          .filter(Boolean)
      )
    );
    return normalized.flatMap((src) => buildImageCandidates(src));
  }, [order]);

  const [index, setIndex] = useState(0);

  if (candidates.length === 0) {
    return <Package className="w-4 h-4 text-muted-foreground" />;
  }

  return (
    <img
      src={candidates[index]}
      alt={alt}
      className="h-full w-full object-cover"
      referrerPolicy="no-referrer"
      onError={() => setIndex((prev) => (prev + 1 < candidates.length ? prev + 1 : prev))}
    />
  );
}

export default function Orders() {
  const { t, language } = useLanguage();
  const isAr = language === 'ar';
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const activeChannel = new URLSearchParams(location.search).get('channel') || '';

  const clearChannelFilter = () => {
    navigate('/orders', { replace: true });
  };

  const clearAllFilters = () => {
    setColumnFilters({
      orderId: '',
      product: '',
      channel: '',
      customer: '',
      payment: '',
      status: '',
    });
    setSearch('');
    setFromDate('');
    setToDate('');
    if (activeChannel) {
      clearChannelFilter();
    }
  };
  const [search, setSearch] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isQuickShopOpen, setIsQuickShopOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [selectedOrderStartEdit, setSelectedOrderStartEdit] = useState(false);
  const [columnFilters, setColumnFilters] = useState({
    orderId: '',
    product: '',
    channel: '',
    customer: '',
    payment: '',
    status: '',
    hasShortage: false,
  });
  const [sortField, setSortField] = useState<'order_id' | 'product' | 'channel' | 'customer' | 'date' | 'cogs' | 'total' | 'payment' | 'status'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [settledCancelOpen, setSettledCancelOpen] = useState(false);
  const [settledCancelOrder, setSettledCancelOrder] = useState<any | null>(null);

  /** Narrow API fetch when user clearly looks up one order (any date). */
  const serverOrderIdParam = useMemo(() => {
    const col = columnFilters.orderId.trim();
    const s = search.trim();
    if (col.length >= 3) {
      return col;
    }
    if (s.length >= 6 && !s.includes(' ')) {
      if (/^\d{2,3}-\d/.test(s)) {
        return s;
      }
      if (/^shop-/i.test(s)) {
        return s;
      }
      if (/^#\d+$/.test(s)) {
        return s;
      }
    }
    return '';
  }, [columnFilters.orderId, search]);

  const { data: orders, isLoading, error, refetch } = useQuery({
    queryKey: ['orders', activeChannel, serverOrderIdParam],
    queryFn: () =>
      api.getArray('/orders', {
        params: {
          ...(activeChannel ? { channel: activeChannel } : {}),
          ...(serverOrderIdParam ? { order_id: serverOrderIdParam } : {}),
        },
      }),
  });

  const {
    data: lastImportBatch,
    isError: lastBatchFetchError,
    isFetching: lastBatchFetching,
  } = useQuery({
    queryKey: ['marketplace-import-last-batch'],
    queryFn: () => api.get<LastImportBatchSnapshot>('marketplace/import/last-batch'),
  });

  const { data: returnsPayload } = useReturns();
  const returns = returnsPayload?.data ?? [];

  const handleRollbackLastImport = async () => {
    const n = Number(lastImportBatch?.transaction_count ?? 0);
    const o = Number(lastImportBatch?.new_orders_count ?? 0) || 0;
    const msg = isAr
      ? `سيتم التراجع عن آخر استيراد فوراً:\n• إرجاع المخزون من ${n} حركة خصم (إن وُجدت)\n• حذف ${o} طلباً أُنشئ في ذلك الاستيراد (وبنوده)\nلا يمكن التراجع عن هذا الإجراء. المتابعة؟`
      : `Undo your LAST sheet import now:\n• Restock from ${n} deduction line(s) if any\n• Delete ${o} order(s) created in that import (and their lines)\nThis cannot be undone. Continue?`;
    if (!window.confirm(msg)) return;
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
      void refetch();
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.message || err.response?.data?.error || (isAr ? 'تعذر الاسترجاع' : 'Rollback failed');
      toast.error(errorMsg);
    } finally {
      setRollbackBusy(false);
    }
  };

  const runCancelOrder = async (order: any, force: boolean) => {
    const id = String(order?.id ?? '');
    if (!id) return;
    setCancellingId(id);
    try {
      await api.post(`/orders/${id}/cancel`, { force });
      toast.success(t('orders.cancelSuccess'));
      setSettledCancelOpen(false);
      setSettledCancelOrder(null);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['orders-for-profit'] });
      void queryClient.invalidateQueries({ queryKey: ['orders-capital'] });
      void refetch();
    } catch (err: any) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      if (status === 422 && data?.requires_force) {
        setSettledCancelOrder(order);
        setSettledCancelOpen(true);
      } else {
        const errorMsg = data?.message || data?.error || t('orders.cancelError');
        toast.error(errorMsg);
      }
    } finally {
      setCancellingId(null);
    }
  };

  const isDateInRange = (value?: string | null) => {
    if (!fromDate && !toDate) return true;
    if (!value) return false;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    if (fromDate) {
      const from = new Date(fromDate);
      from.setHours(0, 0, 0, 0);
      if (date < from) return false;
    }
    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      if (date > to) return false;
    }
    return true;
  };

  function getOrderProductsText(order: any) {
    const names = (order?.items || [])
      .map((item: any) =>
        item.product_name ||
        item.sku?.offer?.master_product?.internal_name ||
        item.sku?.offer?.masterProduct?.internal_name ||
        item.sku?.name ||
        item.sku_code ||
        item.sku?.sku ||
        item.sku_sku
      )
      .filter(Boolean);

    if (names.length === 0) return '—';
    if (names.length <= 2) return names.join(' + ');
    return `${names.slice(0, 2).join(' + ')} +${names.length - 2}`;
  }

  function getOrderSkusText(order: any) {
    const codes = (order?.items || [])
      .map((item: any) => item?.sku_code || item?.sku?.sku || item?.sku_sku)
      .filter(Boolean)
      .map((v: any) => String(v).trim())
      .filter(Boolean);
    const unique = Array.from(new Set(codes));
    if (unique.length === 0) return '';
    if (unique.length <= 2) return unique.join(' + ');
    return `${unique.slice(0, 2).join(' + ')} +${unique.length - 2}`;
  }

  // Marketplace-import lines that were booked as sold but never actually deducted from stock
  // (see MarketplaceImportService::processOrderRow) — surfaced durably here since the one-time
  // import-confirmation warning disappears once that dialog is closed.
  function hasStockShortage(order: any): boolean {
    return (order?.items || []).some((item: any) => item?.stock_deduction_status === 'shortage');
  }

  function getStockShortageReasonsText(order: any): string {
    return (order?.items || [])
      .filter((item: any) => item?.stock_deduction_status === 'shortage')
      .map((item: any) => item?.stock_shortage_reason)
      .filter(Boolean)
      .join(' | ');
  }

  const getPaymentState = (order: any) => {
    const st = String(order?.status || '').toLowerCase();
    const fin = String(order?.financial_status || '').toLowerCase();
    if (st === 'cancelled' || fin === 'cancelled') return 'cancelled';
    if (order.settlement_status === 'settled') return 'settled';
    if (order.financial_status === 'charged') return 'pending_settlement';
    if (fin === 'shipping_adjustment') return 'shipping_adjustment';
    if (order.financial_status === 'refunded') return 'refunded';
    return order.financial_status || 'pending';
  };

  const sortIndicator = (field: typeof sortField) =>
    sortField === field ? (sortDirection === 'asc' ? '↑' : '↓') : '';

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDirection(field === 'date' || field === 'cogs' || field === 'total' ? 'desc' : 'asc');
  };

  const paymentOptions = useMemo(() => {
    const fromData = (orders || []).map((o: any) => getPaymentState(o)).filter(Boolean);
    return Array.from(new Set(['pending', 'pending_settlement', 'settled', 'refunded', 'shipping_adjustment', 'cancelled', ...fromData]));
  }, [orders]);

  const statusOptions = useMemo(() => {
    const fromData = (orders || []).map((o: any) => (o.status || '').toLowerCase()).filter(Boolean);
    return Array.from(new Set(['processing', 'cancelled', 'shipped', 'delivered', 'returned', ...fromData]));
  }, [orders]);

  const processedOrders = useMemo(() => {
    const query = search.toLowerCase().trim();
    const normalize = (v: unknown) => String(v ?? '').toLowerCase();
    const colOid = columnFilters.orderId.trim();
    const searchRaw = search.trim();
    const bypassDateFilter =
      colOid.length > 0 ||
      serverOrderIdParam.length > 0 ||
      (searchRaw.length >= 6 &&
        !searchRaw.includes(' ') &&
        (/^\d{2,3}-\d/.test(searchRaw) || /^shop-/i.test(searchRaw) || /^#\d+$/.test(searchRaw)));

    const filteredRows = (orders || []).filter((o: any) => {
      const orderId = normalize(o.platform_order_id || `#${o.id}`);
      const product = normalize(getOrderProductsText(o));
      const channel = normalize(o.channel?.name);
      const customer = normalize(o.customer_name);
      const status = normalize(o.status);
      const payment = normalize(getPaymentState(o));
      const orderDate = o.order_date || o.created_at || null;

      const matchesSearch =
        !query ||
        orderId.includes(query) ||
        customer.includes(query) ||
        status.includes(query) ||
        channel.includes(query) ||
        product.includes(query);

      const matchesOrderId = !columnFilters.orderId || orderId.includes(normalize(columnFilters.orderId));
      const matchesProduct = !columnFilters.product || product.includes(normalize(columnFilters.product));
      const matchesChannel = !columnFilters.channel || channel.includes(normalize(columnFilters.channel));
      const matchesCustomer = !columnFilters.customer || customer.includes(normalize(columnFilters.customer));
      const matchesPayment = !columnFilters.payment || payment === normalize(columnFilters.payment);
      const matchesStatus = !columnFilters.status || status === normalize(columnFilters.status);
      const matchesShortage = !columnFilters.hasShortage || hasStockShortage(o);
      const matchesDate = bypassDateFilter || isDateInRange(orderDate);

      return (
        matchesSearch &&
        matchesOrderId &&
        matchesProduct &&
        matchesChannel &&
        matchesCustomer &&
        matchesPayment &&
        matchesStatus &&
        matchesShortage &&
        matchesDate
      );
    });

    filteredRows.sort((a: any, b: any) => {
      const dir = sortDirection === 'asc' ? 1 : -1;
      const aProduct = getOrderProductsText(a).toLowerCase();
      const bProduct = getOrderProductsText(b).toLowerCase();
      const aPayment = getPaymentState(a).toLowerCase();
      const bPayment = getPaymentState(b).toLowerCase();

      const av =
        sortField === 'order_id' ? String(a.platform_order_id || a.id).toLowerCase() :
        sortField === 'product' ? aProduct :
        sortField === 'channel' ? String(a.channel?.name || '').toLowerCase() :
        sortField === 'customer' ? String(a.customer_name || '').toLowerCase() :
        sortField === 'date' ? new Date(a.order_date || 0).getTime() :
        sortField === 'cogs' ? orderLineCogs(a) :
        sortField === 'total' ? Number(a.total_amount || 0) :
        sortField === 'payment' ? aPayment :
        String(a.status || '').toLowerCase();

      const bv =
        sortField === 'order_id' ? String(b.platform_order_id || b.id).toLowerCase() :
        sortField === 'product' ? bProduct :
        sortField === 'channel' ? String(b.channel?.name || '').toLowerCase() :
        sortField === 'customer' ? String(b.customer_name || '').toLowerCase() :
        sortField === 'date' ? new Date(b.order_date || 0).getTime() :
        sortField === 'cogs' ? orderLineCogs(b) :
        sortField === 'total' ? Number(b.total_amount || 0) :
        sortField === 'payment' ? bPayment :
        String(b.status || '').toLowerCase();

      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });

    return filteredRows;
  }, [orders, search, columnFilters, sortField, sortDirection, fromDate, toDate, serverOrderIdParam]);

  const ordersForMetrics = useMemo(
    () => processedOrders.filter((o: any) => !isOrderCancelledRecord(o)),
    [processedOrders]
  );

  const totalPages = Math.max(1, Math.ceil(processedOrders.length / pageSize));
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return processedOrders.slice(start, start + pageSize);
  }, [processedOrders, currentPage, pageSize]);

  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);
    const pages = new Set<number>([1, totalPages]);
    for (let p = start; p <= end; p += 1) {
      pages.add(p);
    }
    return Array.from(pages).sort((a, b) => a - b);
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeChannel, search, columnFilters, sortField, sortDirection, pageSize, serverOrderIdParam]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  // Stats (exclude cancelled rows so KPIs match profit / pending logic)
  const totalRevenue = ordersForMetrics.reduce((s: number, o: any) => s + Number(o.total_amount || 0), 0);
  const totalCogsSold = ordersForMetrics.reduce((sum: number, o: any) => sum + orderLineCogs(o), 0);
  const soldAmount = ordersForMetrics.reduce((sum: number, o: any) => {
    const total = Number(o.total_amount || 0);
    if (!Number.isFinite(total) || total <= 0) return sum;
    return sum + total;
  }, 0);

  // Received money = settled marketplace orders + any direct paid amount.
  // Pending settlement is the difference between sold and received.
  const receivedAmount = ordersForMetrics.reduce((sum: number, o: any) => {
    const total = Number(o.total_amount || 0);
    if (!Number.isFinite(total) || total <= 0) return sum;

    if (String(o?.settlement_status || '').toLowerCase() === 'settled') {
      return sum + total;
    }

    const paid = Number(o.paid_amount || 0);
    const clampedPaid = Number.isFinite(paid) ? Math.min(Math.max(paid, 0), total) : 0;
    return sum + clampedPaid;
  }, 0);

  const pendingSettlementAmount = Math.max(0, soldAmount - receivedAmount);
  const completedCount = ordersForMetrics.filter((o: any) => {
    const s = String(o?.status || '').toLowerCase();
    const settled = String(o?.settlement_status || '').toLowerCase() === 'settled';
    return settled || ['sold', 'delivered', 'completed'].includes(s);
  }).length;
  const salesQty = ordersForMetrics.reduce((sum: number, o: any) =>
    sum + (Array.isArray(o.items) ? o.items.reduce((s: number, item: any) => s + Number(item.quantity || 0), 0) : 0)
  , 0);
  const dateFilteredReturns = (returns || []).filter((r: any) => isDateInRange(r.return_date || r.created_at || null));
  const returnsQty = dateFilteredReturns.reduce((sum: number, r: any) => sum + Number(r.quantity || 1), 0);
  const returnsCost = dateFilteredReturns.reduce((sum: number, r: any) => sum + Number(r.refund_amount || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('nav.allOrders')}</h1>
          <p className="text-muted-foreground">{t('orders.subtitle')}</p>
          {activeChannel && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="text-xs text-primary">
                {isAr ? 'تصفية حسب القناة:' : 'Filtered by channel:'}{' '}
                <span className="font-mono">{activeChannel}</span>
              </p>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={clearChannelFilter}>
                {isAr ? 'عرض كل الطلبات' : 'Show all orders'}
              </Button>
            </div>
          )}
        </div>
        <TooltipProvider delayDuration={200}>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setIsImportDialogOpen(true)} className="gap-2 border-emerald-500/20 text-emerald-500 hover:bg-emerald-500/5">
              <Plus className="w-4 h-4" />
              {isAr ? 'استيراد طلبات' : 'Import Orders'}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex max-w-full">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={rollbackBusy || !lastImportBatch?.available || lastBatchFetchError}
                    onClick={() => void handleRollbackLastImport()}
                    className="gap-2 border-amber-500/30 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                  >
                    {rollbackBusy || lastBatchFetching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}
                    {isAr ? 'استرجاع آخر استيراد' : 'Rollback last import'}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-start leading-snug">
                {lastImportBatch?.available
                  ? rollbackReadyTooltip(
                      isAr,
                      Number(lastImportBatch.transaction_count ?? 0) || 0,
                      Number(lastImportBatch.new_orders_count ?? 0) || 0
                    )
                  : rollbackDisabledExplanation(isAr, lastImportBatch?.hint, lastBatchFetchError)}
              </TooltipContent>
            </Tooltip>
          <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            {t('sales.createOrder') || 'New Order'}
          </Button>
          <Button
            type="button"
            onClick={() => setIsQuickShopOpen(true)}
            className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold text-white shadow-md hover:from-emerald-600 hover:to-teal-700"
          >
            🛒 {t('orders.newShopSale')}
          </Button>
          </div>
        </TooltipProvider>
      </div>

      <CreateSalesOrderDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} />
      <QuickShopSaleDialog open={isQuickShopOpen} onOpenChange={setIsQuickShopOpen} />
      <OrderInvoiceDetailDialog
        order={selectedOrder}
        open={!!selectedOrder}
        startEditing={selectedOrderStartEdit}
        onOpenChange={(next) => {
          if (!next) {
            setSelectedOrder(null);
            setSelectedOrderStartEdit(false);
          }
        }}
      />
      <OrderImportDialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen} onSuccess={() => refetch()} />

      <AlertDialog
        open={settledCancelOpen}
        onOpenChange={(open) => {
          setSettledCancelOpen(open);
          if (!open) setSettledCancelOrder(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('orders.cancelSettledTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('orders.cancelSettledDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={(e) => {
                e.preventDefault();
                if (settledCancelOrder) void runCancelOrder(settledCancelOrder, true);
              }}
            >
              {t('orders.cancelSettledConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Stats — dashboard-style KPI tiles */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-b from-card to-muted/15 p-4 shadow-sm transition-shadow hover:shadow-md"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-primary/70" />
          <div className="flex items-start gap-3 pt-1">
            <div className="rounded-xl bg-primary/12 p-2.5">
              <ShoppingCart className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">{isAr ? 'إجمالي الطلبات' : 'Total orders'}</p>
              <p className="text-2xl font-bold tracking-tight tabular-nums">{processedOrders.length}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {isAr ? `مكتمل: ${completedCount}` : `Completed: ${completedCount}`}
              </p>
            </div>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-b from-card to-muted/15 p-4 shadow-sm transition-shadow hover:shadow-md"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-emerald-500/80" />
          <div className="flex items-start gap-3 pt-1">
            <div className="rounded-xl bg-emerald-500/12 p-2.5">
              <Package className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">{isAr ? 'إجمالي المبيعات' : 'Total revenue'}</p>
              <p className="text-xl font-bold tracking-tight tabular-nums">{totalRevenue.toLocaleString()} EGP</p>
            </div>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-b from-card to-muted/15 p-4 shadow-sm transition-shadow hover:shadow-md"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-red-500/80" />
          <div className="flex items-start gap-3 pt-1">
            <div className="rounded-xl bg-red-500/12 p-2.5">
              <Package className="h-5 w-5 text-red-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">{t('orders.cogsSold')}</p>
              <p className="text-xl font-bold tracking-tight tabular-nums">{totalCogsSold.toLocaleString()} EGP</p>
              <p className="mt-1 text-[11px] text-muted-foreground leading-snug">{t('orders.cogsSoldHint')}</p>
            </div>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-b from-card to-muted/15 p-4 shadow-sm transition-shadow hover:shadow-md"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-rose-500/75" />
          <div className="flex items-start gap-3 pt-1">
            <div className="rounded-xl bg-rose-500/12 p-2.5">
              <DollarSign className="h-5 w-5 text-rose-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">{isAr ? 'مبالغ تحت التسوية' : 'Pending settlement'}</p>
              <p className="text-lg font-bold tracking-tight tabular-nums">{pendingSettlementAmount.toLocaleString()} EGP</p>
            </div>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-b from-card to-muted/15 p-4 shadow-sm transition-shadow hover:shadow-md"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-orange-500/80" />
          <div className="flex items-start gap-3 pt-1">
            <div className="rounded-xl bg-orange-500/12 p-2.5">
              <RotateCcw className="h-5 w-5 text-orange-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">{isAr ? 'المرتجعات' : 'Returns'}</p>
              <p className="text-sm font-semibold tabular-nums">{isAr ? `كمية ${returnsQty.toLocaleString()}` : `Qty ${returnsQty.toLocaleString()}`}</p>
              <p className="text-xs font-medium tabular-nums text-muted-foreground">{returnsCost.toLocaleString()} EGP</p>
            </div>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
          className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-b from-card to-muted/15 p-4 shadow-sm transition-shadow hover:shadow-md"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-indigo-500/80" />
          <div className="flex items-start gap-3 pt-1">
            <div className="rounded-xl bg-indigo-500/12 p-2.5">
              <TrendingUp className="h-5 w-5 text-indigo-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">{isAr ? 'المبيعات (كمية / قيمة)' : 'Sales qty / value'}</p>
              <p className="text-sm font-semibold tabular-nums">{isAr ? `كمية ${salesQty.toLocaleString()}` : `Qty ${salesQty.toLocaleString()}`}</p>
              <p className="text-xs font-medium tabular-nums text-muted-foreground">{totalRevenue.toLocaleString()} EGP</p>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={isAr ? 'ابحث برقم الطلب أو العميل...' : 'Search by order ID, customer...'}
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          className="h-8 w-[160px] text-xs"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
        />
        <Input
          type="date"
          className="h-8 w-[160px] text-xs"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
        />
        <Button type="button" variant="outline" size="sm" onClick={clearAllFilters}>
          {isAr ? 'مسح الفلاتر' : 'Clear Filters'}
        </Button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {isAr
          ? 'عند إدخال رقم طلب (عمود رقم الطلب أو بحث يشبه 402-… أو SHOP-…) يُتجاهل نطاق التاريخ ويُجلب الطلب من السيرفر حتى لو قديم. إن لم يظهر الطلب فقد لا يكون مستوردًا في «الطلبات» بعد (الشيت وحده لا ينشئ سجل طلب).'
          : 'When you enter an order reference (order ID column, or main search like 402-… or SHOP-…), the date range is ignored and the server returns matching orders of any age. If nothing appears, the order may not exist in Orders yet (a settlement sheet alone does not create an order row).'}
      </p>

      {activeChannel && !isLoading && processedOrders.length === 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{isAr ? 'لا توجد طلبات لهذه القناة' : 'No orders for this channel'}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              {isAr
                ? 'الصفحة مُصفّاة حسب قناة واحدة فقط. طلبات أمازون المستوردة غالباً تُسجَّل تحت قناة «Merchant/تاجر» وليس FBA، أو العكس — حسب عمود Fulfillment في ملف الاستيراد.'
                : 'This page is filtered to one sales channel. Amazon orders are often stored under Merchant vs FBA depending on the fulfillment column in your import file.'}
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={clearChannelFilter}>
              {isAr ? 'عرض جميع الطلبات' : 'Show all orders'}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{isAr ? 'خطأ' : 'Error'}</AlertTitle>
          <AlertDescription>{isAr ? 'فشل تحميل الطلبات.' : 'Failed to load orders.'}</AlertDescription>
        </Alert>
      )}

      <div className="glass-card rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="py-2 text-xs cursor-pointer select-none" onClick={() => handleSort('order_id')}>
                <span className="inline-flex items-center gap-1">{isAr ? 'رقم الطلب' : 'Order ID'} <ArrowUpDown className="w-3 h-3" /> {sortIndicator('order_id')}</span>
              </TableHead>
              <TableHead className="py-2 text-xs">{isAr ? 'الصورة' : 'Image'}</TableHead>
              <TableHead className="py-2 text-xs cursor-pointer select-none" onClick={() => handleSort('product')}>
                <span className="inline-flex items-center gap-1">{isAr ? 'اسم المنتج' : 'Product Name'} <ArrowUpDown className="w-3 h-3" /> {sortIndicator('product')}</span>
              </TableHead>
              <TableHead className="py-2 text-xs cursor-pointer select-none" onClick={() => handleSort('channel')}>
                <span className="inline-flex items-center gap-1">{isAr ? 'القناة' : 'Channel'} <ArrowUpDown className="w-3 h-3" /> {sortIndicator('channel')}</span>
              </TableHead>
              <TableHead className="py-2 text-xs cursor-pointer select-none" onClick={() => handleSort('customer')}>
                <span className="inline-flex items-center gap-1">{isAr ? 'العميل' : 'Customer'} <ArrowUpDown className="w-3 h-3" /> {sortIndicator('customer')}</span>
              </TableHead>
              <TableHead className="py-2 text-xs cursor-pointer select-none whitespace-nowrap" onClick={() => handleSort('date')}>
                <span className="inline-flex items-center gap-1">{isAr ? 'التاريخ' : 'Date'} <ArrowUpDown className="w-3 h-3" /> {sortIndicator('date')}</span>
              </TableHead>
              <TableHead
                className="py-2 text-[10px] cursor-pointer select-none text-end whitespace-nowrap w-[4.75rem] max-w-[4.75rem] text-muted-foreground"
                onClick={() => handleSort('cogs')}
                title={t('orders.colPurchaseCostHint')}
              >
                <span className="inline-flex items-center justify-end gap-0.5 w-full">
                  {t('orders.colPurchaseCost')} <ArrowUpDown className="w-2.5 h-2.5 shrink-0" /> {sortIndicator('cogs')}
                </span>
              </TableHead>
              <TableHead className="py-2 text-xs cursor-pointer select-none text-end whitespace-nowrap" onClick={() => handleSort('total')}>
                <span className="inline-flex items-center gap-1">{isAr ? 'الإجمالي' : 'Total'} <ArrowUpDown className="w-3 h-3" /> {sortIndicator('total')}</span>
              </TableHead>
              <TableHead className="py-2 text-xs cursor-pointer select-none" onClick={() => handleSort('payment')}>
                <span className="inline-flex items-center gap-1">{isAr ? 'الدفع' : 'Payment'} <ArrowUpDown className="w-3 h-3" /> {sortIndicator('payment')}</span>
              </TableHead>
              <TableHead className="py-2 text-xs cursor-pointer select-none" onClick={() => handleSort('status')}>
                <span className="inline-flex items-center gap-1">{isAr ? 'الحالة' : 'Status'} <ArrowUpDown className="w-3 h-3" /> {sortIndicator('status')}</span>
              </TableHead>
              <TableHead className="py-2 w-12 text-center text-xs text-muted-foreground">{t('orders.actionsMenu')}</TableHead>
            </TableRow>
            <TableRow>
              <TableHead className="py-2">
                <Input
                  className="h-8 text-xs"
                  placeholder={isAr ? 'فلتر رقم الطلب' : 'Filter order ID'}
                  value={columnFilters.orderId}
                  onChange={(e) => setColumnFilters((prev) => ({ ...prev, orderId: e.target.value }))}
                />
              </TableHead>
              <TableHead className="py-2">
                <div className="h-8 flex items-center text-xs text-muted-foreground">—</div>
              </TableHead>
              <TableHead className="py-2">
                <Input
                  className="h-8 text-xs"
                  placeholder={isAr ? 'فلتر المنتج' : 'Filter product'}
                  value={columnFilters.product}
                  onChange={(e) => setColumnFilters((prev) => ({ ...prev, product: e.target.value }))}
                />
                <button
                  type="button"
                  className={`mt-1 h-6 w-full rounded-md border text-[10px] ${
                    columnFilters.hasShortage
                      ? 'border-destructive bg-destructive/10 text-destructive'
                      : 'border-input text-muted-foreground'
                  }`}
                  onClick={() => setColumnFilters((prev) => ({ ...prev, hasShortage: !prev.hasShortage }))}
                >
                  {isAr ? 'فقط: مخزون لم يُخصم' : 'Only: not deducted'}
                </button>
              </TableHead>
              <TableHead className="py-2">
                <Input
                  className="h-8 text-xs"
                  placeholder={isAr ? 'فلتر القناة' : 'Filter channel'}
                  value={columnFilters.channel}
                  onChange={(e) => setColumnFilters((prev) => ({ ...prev, channel: e.target.value }))}
                />
              </TableHead>
              <TableHead className="py-2">
                <Input
                  className="h-8 text-xs"
                  placeholder={isAr ? 'فلتر العميل' : 'Filter customer'}
                  value={columnFilters.customer}
                  onChange={(e) => setColumnFilters((prev) => ({ ...prev, customer: e.target.value }))}
                />
              </TableHead>
              <TableHead className="py-2 text-xs text-muted-foreground">—</TableHead>
              <TableHead className="py-2 w-[4.75rem] max-w-[4.75rem] text-muted-foreground">—</TableHead>
              <TableHead className="py-2 text-xs text-muted-foreground">—</TableHead>
              <TableHead className="py-2">
                <select
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  value={columnFilters.payment}
                  onChange={(e) => setColumnFilters((prev) => ({ ...prev, payment: e.target.value }))}
                >
                  <option value="">{isAr ? 'كل حالات الدفع' : 'All payment states'}</option>
                  {paymentOptions.map((state) => (
                    <option key={state} value={state}>
                      {state === 'refunded'
                        ? (isAr ? 'خصم الشحن' : 'Shipping discount')
                        : state}
                    </option>
                  ))}
                </select>
              </TableHead>
              <TableHead className="py-2">
                <select
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  value={columnFilters.status}
                  onChange={(e) => setColumnFilters((prev) => ({ ...prev, status: e.target.value }))}
                >
                  <option value="">{isAr ? 'كل الحالات' : 'All statuses'}</option>
                  {statusOptions.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </TableHead>
              <TableHead className="py-2 w-12">
                <div className="h-8" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-12 text-muted-foreground">
                  {t('common.noData')}
                </TableCell>
              </TableRow>
            ) : (
              paginatedOrders.map((order: any) => (
                <TableRow
                  key={order.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => {
                    setSelectedOrderStartEdit(false);
                    setSelectedOrder(order);
                  }}
                >
                  <TableCell className="py-2 font-mono text-xs">{order.platform_order_id || `#${order.id}`}</TableCell>
                  <TableCell className="py-2">
                    <div className="h-10 w-10 rounded-md border border-border bg-muted/30 overflow-hidden flex items-center justify-center">
                      <OrderThumb order={order} alt={isAr ? 'منتج' : 'product'} />
                    </div>
                  </TableCell>
                  <TableCell className="py-2 max-w-[280px]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs leading-5 truncate" title={getOrderProductsText(order)}>
                          {getOrderProductsText(order)}
                        </p>
                        {hasStockShortage(order) ? (
                          <Badge
                            variant="destructive"
                            className="shrink-0 text-[9px] px-1 py-0 leading-4"
                            title={getStockShortageReasonsText(order) || (isAr ? 'مخزون لم يُخصم' : 'Stock not deducted')}
                          >
                            {isAr ? 'لم يُخصم' : 'Not deducted'}
                          </Badge>
                        ) : null}
                      </div>
                      {getOrderSkusText(order) ? (
                        <p
                          className="text-[10px] leading-4 text-muted-foreground font-mono tabular-nums truncate"
                          title={getOrderSkusText(order)}
                        >
                          {getOrderSkusText(order)}
                        </p>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="py-2">
                    <Badge variant="outline">{order.channel?.name || '—'}</Badge>
                  </TableCell>
                  <TableCell className="py-2 text-xs">{order.customer_name || '—'}</TableCell>
                  <TableCell className="py-2 text-xs whitespace-nowrap">{order.order_date ? new Date(order.order_date).toLocaleDateString() : '—'}</TableCell>
                  <TableCell
                    className="py-2 text-[10px] text-end tabular-nums whitespace-nowrap w-[4.75rem] max-w-[4.75rem] text-muted-foreground"
                    title={t('orders.colPurchaseCostHint')}
                  >
                    {(() => {
                      const cogs = orderLineCogs(order);
                      return cogs > 0 ? `${cogs.toLocaleString()}` : '—';
                    })()}
                  </TableCell>
                  <TableCell className="py-2 text-xs font-medium text-end whitespace-nowrap">{Number(order.total_amount || 0).toLocaleString()} EGP</TableCell>
                  <TableCell className="py-2">
                    <Badge className={
                      getPaymentState(order) === 'cancelled'
                        ? paymentColors.cancelled
                        : order.settlement_status === 'settled'
                          ? paymentColors.settled
                          : order.financial_status === 'charged'
                            ? paymentColors.pending_settlement
                            : paymentColors[order.financial_status || 'pending'] || paymentColors.pending
                    }>
                      {getPaymentState(order) === 'cancelled'
                        ? (isAr ? 'ملغي' : 'Cancelled')
                        : order.settlement_status === 'settled'
                          ? (isAr ? 'تم التسوية' : 'Settled')
                          : order.financial_status === 'charged'
                            ? (isAr ? 'بانتظار التسوية' : 'Pending Settlement')
                            : String(order.financial_status || '').toLowerCase() === 'shipping_adjustment'
                              ? (isAr ? 'تم خصم الشحن' : 'Shipping deducted')
                            : order.financial_status === 'refunded'
                              ? (isAr ? 'خصم الشحن' : 'Shipping discount')
                              : (isAr ? 'في انتظار الدفع' : 'Pending')}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-2">
                    <Badge className={statusColors[String(order.status || '').toLowerCase()] || 'bg-gray-500/10 text-gray-500'}>
                      {formatOrderStatusLabel(order.status, isAr)}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className="py-2 w-12 text-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={t('orders.actionsMenu')}
                          disabled={cancellingId === String(order.id)}
                        >
                          {cancellingId === String(order.id) ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MoreHorizontal className="h-4 w-4" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {!isOrderCancelledRecord(order) ? (
                          <DropdownMenuItem
                            onSelect={(e) => {
                              e.preventDefault();
                              setSelectedOrderStartEdit(true);
                              setSelectedOrder(order);
                            }}
                            className="gap-2"
                          >
                            <Pencil className="h-4 w-4" />
                            {t('common.edit')}
                          </DropdownMenuItem>
                        ) : null}
                        {!isOrderCancelledRecord(order) ? (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={(e) => {
                              e.preventDefault();
                              void runCancelOrder(order, false);
                            }}
                          >
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium">{t('orders.markCancelled')}</span>
                              <span className="text-[11px] font-normal text-muted-foreground leading-snug">
                                {t('orders.markCancelledHint')}
                              </span>
                            </div>
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem disabled>{t('orders.alreadyCancelled')}</DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border rounded-lg p-3 bg-card/40">
        <div className="text-xs text-muted-foreground">
          {processedOrders.length > 0
            ? `${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, processedOrders.length)} / ${processedOrders.length}`
            : `0 / 0`}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{isAr ? 'عدد الصفوف' : 'Rows'}</span>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
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
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          >
            {isAr ? 'السابق' : 'Prev'}
          </Button>

          {pageNumbers.map((page, index) => {
            const prev = pageNumbers[index - 1];
            const showGap = prev && page - prev > 1;
            return (
              <div key={page} className="flex items-center gap-1">
                {showGap ? <span className="px-1 text-xs text-muted-foreground">...</span> : null}
                <Button
                  type="button"
                  variant={currentPage === page ? 'default' : 'outline'}
                  size="sm"
                  className="min-w-8 px-2"
                  onClick={() => setCurrentPage(page)}
                >
                  {page}
                </Button>
              </div>
            );
          })}

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          >
            {isAr ? 'التالي' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}
