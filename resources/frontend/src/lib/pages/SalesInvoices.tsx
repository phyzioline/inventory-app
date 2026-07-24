import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus,
  Search,
  Download,
  FileText,
  DollarSign,
  TrendingUp,
  Clock,
  MoreHorizontal,
  Truck,
  CheckCircle,
  RotateCcw,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSalesOrders, useUpdateSalesOrderStatus } from '@/hooks/useSales';
import { useWarehouses } from '@/hooks/useWarehouses';
import { useReturns } from '@/hooks/useReturns';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { CreateSalesOrderDialog } from '@/components/sales/CreateSalesOrderDialog';
import { QuickShopSaleDialog } from '@/components/sales/QuickShopSaleDialog';
import { OrderInvoiceDetailDialog } from '@/components/sales/OrderInvoiceDetailDialog';

/** Badge + filters: financial settlement without lifecycle status still reads as a completed sale. */
function resolveSalesOrderDisplayStatus(order: {
  status?: string | null;
  settlement_status?: string | null;
}): string {
  const raw = String(order?.status || 'pending').toLowerCase();
  if (raw === 'pending' && String(order?.settlement_status || '').toLowerCase() === 'settled') {
    return 'sold';
  }
  return raw || 'pending';
}

function resolveMarketplaceKey(order: any): string {
  const explicit = String(order?.marketplace_source || '').trim().toLowerCase();
  if (explicit) return explicit;

  const slug = String(order?.channel?.slug || '').trim().toLowerCase();
  const name = String(order?.channel?.name || '').trim().toLowerCase();
  const hay = `${slug} ${name}`;

  // Direct POS / shop
  if (
    hay.includes('shop') ||
    hay.includes('store') ||
    hay.includes('main') ||
    hay.includes('المحل') ||
    hay.includes('direct')
  ) {
    return 'direct';
  }

  if (hay.includes('amazon')) {
    if (hay.includes('fba') || hay.includes('afn')) return 'amazon_fba';
    if (hay.includes('merchant') || hay.includes('mfn') || hay.includes('fbm') || hay.includes('تاجر')) return 'amazon_store';
    return 'amazon_store';
  }
  if (hay.includes('noon')) return 'noon';
  if (hay.includes('jumia')) return 'jumia';

  return '';
}

export default function SalesInvoicesPage() {
  const { t, language } = useLanguage();
  const toNumber = (value: unknown) => {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isQuickSaleOpen, setIsQuickSaleOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);

  const { data: orders, isLoading } = useSalesOrders();
  const { data: warehouses } = useWarehouses();
  const { data: returnsPayload } = useReturns();
  const returns = returnsPayload?.data ?? [];
  const updateStatus = useUpdateSalesOrderStatus();

  const warehouseByChannelId = useMemo(() => {
    const map = new Map<string, any>();
    (warehouses || []).forEach((w: any) => {
      const cid = String(w?.channel_id || '').trim();
      if (cid && !map.has(cid)) map.set(cid, w);
    });
    return map;
  }, [warehouses]);

  const resolveOrderWarehouseId = (order: any): string => {
    const direct = String(
      order?.warehouse_id ??
        order?.fulfillment_warehouse_id ??
        order?.credit_warehouse_id ??
        ''
    ).trim();
    if (direct) return direct;

    const channelId = String(order?.channel_id ?? order?.channel?.id ?? '').trim();
    const byChannel = channelId ? warehouseByChannelId.get(channelId) : null;
    return byChannel?.id ? String(byChannel.id) : '';
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

  // Filter orders
  const filteredOrders = orders?.filter((order) => {
    const query = searchQuery.toLowerCase();
    const orderRef = String(order.order_number || order.platform_order_id || '').toLowerCase();
    const customer = String(order.customer_name || '').toLowerCase();
    const externalRef = String(order.external_order_number || '').toLowerCase();

    const matchesSearch =
      orderRef.includes(query) ||
      customer.includes(query) ||
      externalRef.includes(query);

    const matchesStatus = statusFilter === 'all' || resolveSalesOrderDisplayStatus(order) === statusFilter;
    const resolvedWarehouseId = resolveOrderWarehouseId(order);
    const matchesWarehouse = warehouseFilter === 'all'
      || (resolvedWarehouseId !== '' && resolvedWarehouseId === String(warehouseFilter));
    const matchesDate = isDateInRange(order.order_date || order.created_at || null);

    return matchesSearch && matchesStatus && matchesWarehouse && matchesDate;
  });

  const totalPages = Math.ceil((filteredOrders?.length || 0) / itemsPerPage);
  const paginatedOrders = filteredOrders?.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const filteredReturns = (returns || []).filter((ret: any) =>
    isDateInRange(ret.return_date || ret.created_at || null)
  );

  const totalSalesQty = filteredOrders?.reduce((sum, order: any) => {
    const orderItems = Array.isArray(order?.items) ? order.items : [];
    return sum + orderItems.reduce((itemSum: number, item: any) => itemSum + toNumber(item?.quantity), 0);
  }, 0) || 0;

  const soldAmount = filteredOrders?.reduce((sum, order: any) => {
    const total = toNumber(order?.total_amount);
    if (!Number.isFinite(total) || total <= 0) return sum;
    return sum + total;
  }, 0) || 0;

  const receivedAmount = filteredOrders?.reduce((sum, order: any) => {
    const total = toNumber(order?.total_amount);
    if (!Number.isFinite(total) || total <= 0) return sum;

    if (String(order?.settlement_status || '').toLowerCase() === 'settled') {
      return sum + total;
    }

    const paid = toNumber(order?.paid_amount);
    const clampedPaid = Number.isFinite(paid) ? Math.min(Math.max(paid, 0), total) : 0;
    return sum + clampedPaid;
  }, 0) || 0;

  const pendingSettlementAmount = Math.max(0, soldAmount - receivedAmount);

  const returnsQty = filteredReturns.reduce((sum: number, ret: any) => sum + toNumber(ret?.quantity || 1), 0);
  const returnsCost = filteredReturns.reduce((sum: number, ret: any) => sum + toNumber(ret?.refund_amount), 0);

  const completedOrdersCount = filteredOrders?.filter((order: any) => {
    const status = String(order?.status || '').toLowerCase();
    const settled = String(order?.settlement_status || '').toLowerCase() === 'settled';
    return settled || ['sold', 'delivered', 'completed'].includes(status);
  }).length || 0;

  const pendingOrdersCount = filteredOrders?.filter((order: any) => {
    const status = String(order?.status || '').toLowerCase();
    const settled = String(order?.settlement_status || '').toLowerCase() === 'settled';
    const completed = settled || ['sold', 'delivered', 'completed'].includes(status);
    const excluded = ['cancelled', 'returned', 'rejected'].includes(status);
    return !completed && !excluded;
  }).length || 0;

  // Calculate stats
  const stats = {
    total: filteredOrders?.length || 0,
    totalAmount: filteredOrders?.reduce((sum, order) => sum + toNumber(order.total_amount), 0) || 0,
    pending: pendingOrdersCount,
    completed: completedOrdersCount,
    pendingSettlementAmount,
    returnsQty,
    returnsCost,
    salesQty: totalSalesQty,
  };

  const handleExport = () => {
    if (!filteredOrders || filteredOrders.length === 0) {
      toast.error(t('sales.export.noOrders'));
      return;
    }
    toast.success(t('sales.export.comingSoon'));
  };

  const handleStatusChange = (orderId: string, newStatus: 'pending' | 'shipped' | 'delivered' | 'sold' | 'return_in_progress' | 'returned') => {
    updateStatus.mutate({ id: orderId, status: newStatus });
  };

  const getStatusBadge = (status: string | null) => {
    const variants: Record<string, { className: string; label: string; icon: React.ReactNode }> = {
      pending: { className: 'badge-status badge-warning', label: t('sales.status.pending'), icon: <Clock className="w-3 h-3 mr-1" /> },
      processing: { className: 'badge-status badge-info', label: t('sales.status.processing'), icon: <Clock className="w-3 h-3 mr-1" /> },
      shipped: { className: 'badge-status badge-info', label: t('sales.status.shipped'), icon: <Truck className="w-3 h-3 mr-1" /> },
      delivered: { className: 'badge-status badge-success', label: t('sales.status.delivered'), icon: <CheckCircle className="w-3 h-3 mr-1" /> },
      sold: { className: 'badge-status badge-success', label: t('sales.status.sold'), icon: <CheckCircle className="w-3 h-3 mr-1" /> },
      completed: { className: 'badge-status badge-success', label: t('sales.status.completed'), icon: <CheckCircle className="w-3 h-3 mr-1" /> },
      cancelled: { className: 'badge-status badge-destructive', label: t('sales.status.cancelled'), icon: <RotateCcw className="w-3 h-3 mr-1" /> },
      rejected: { className: 'badge-status badge-destructive', label: t('sales.status.rejected'), icon: <RotateCcw className="w-3 h-3 mr-1" /> },
      return_in_progress: { className: 'badge-status bg-orange-500/10 text-orange-500', label: t('sales.status.returnInProgress'), icon: <RotateCcw className="w-3 h-3 mr-1" /> },
      returned: { className: 'badge-status badge-destructive', label: t('sales.status.returned'), icon: <RotateCcw className="w-3 h-3 mr-1" /> },
    };
    const variant = variants[status || 'pending'] || variants.pending;
    return (
      <Badge className={variant.className}>
        {variant.icon}
        {variant.label}
      </Badge>
    );
  };

  const getMarketplaceBadge = (source: string | null) => {
    const colors: Record<string, string> = {
      amazon_fba: 'bg-orange-500/10 text-orange-500',
      amazon_store: 'bg-orange-500/10 text-orange-500',
      noon: 'bg-yellow-500/10 text-yellow-500',
      jumia: 'bg-purple-500/10 text-purple-500',
      direct: 'bg-muted text-muted-foreground',
    };
    return (
      <Badge variant="outline" className={colors[source || 'direct'] || colors.direct}>
        {source?.replace('_', ' ').toUpperCase() || 'DIRECT'}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">{t('sales.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('sales.title')}</h1>
          <p className="text-muted-foreground">{t('sales.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            {t('sales.export')}
          </Button>
          <Button
            onClick={() => setIsQuickSaleOpen(true)}
            className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold shadow-md"
          >
            🛒 {language === 'ar' ? 'بيع المحل' : 'Shop Sale'}
          </Button>
          <Button onClick={() => setIsDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            {t('sales.newOrder')}
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
              <p className="text-sm text-muted-foreground">{t('sales.totalOrders')}</p>
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
            <div className="p-3 rounded-xl bg-success/10">
              <DollarSign className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('sales.totalRevenue')}</p>
              <p className="text-2xl font-bold">{toNumber(stats.totalAmount).toLocaleString()} EGP</p>
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
              <TrendingUp className="w-5 h-5 text-info" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('sales.completed')}</p>
              <p className="text-2xl font-bold">{stats.completed}</p>
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
              <p className="text-sm text-muted-foreground">{t('sales.pending')}</p>
              <p className="text-2xl font-bold">{stats.pending}</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="stat-card"
        >
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-red-500/10">
              <DollarSign className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('sales.pendingSettlement')}</p>
              <p className="text-2xl font-bold">{toNumber(stats.pendingSettlementAmount).toLocaleString()} EGP</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="stat-card"
        >
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-orange-500/10">
              <RotateCcw className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('sales.returnsQtyCost')}</p>
              <div className="mt-1 space-y-0.5">
                <p className="text-sm font-bold leading-tight">{`${t('sales.qty')}: ${stats.returnsQty.toLocaleString()}`}</p>
                <p className="text-sm font-bold leading-tight">{`${t('sales.cost')}: ${toNumber(stats.returnsCost).toLocaleString()} EGP`}</p>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="stat-card"
        >
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-indigo-500/10">
              <TrendingUp className="w-5 h-5 text-indigo-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('sales.salesQtyValue')}</p>
              <div className="mt-1 space-y-0.5">
                <p className="text-sm font-bold leading-tight">{`${t('sales.qty')}: ${stats.salesQty.toLocaleString()}`}</p>
                <p className="text-sm font-bold leading-tight">{`${t('sales.value')}: ${toNumber(stats.totalAmount).toLocaleString()} EGP`}</p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Filters and Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <CardTitle>{t('sales.allOrders')}</CardTitle>
                <CardDescription>{t('sales.allOrdersDesc')}</CardDescription>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <div className="relative flex-1 sm:w-[250px]">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={t('sales.searchOrders')}
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={(val) => { setStatusFilter(val); setCurrentPage(1); }}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder={t('sales.status')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('sales.allStatus')}</SelectItem>
                  <SelectItem value="pending">{t('sales.status.pending')}</SelectItem>
                  <SelectItem value="processing">{t('sales.status.processing')}</SelectItem>
                  <SelectItem value="shipped">{t('sales.status.shipped')}</SelectItem>
                  <SelectItem value="delivered">{t('sales.status.delivered')}</SelectItem>
                  <SelectItem value="sold">{t('sales.status.sold')}</SelectItem>
                  <SelectItem value="completed">{t('sales.status.completed')}</SelectItem>
                  <SelectItem value="return_in_progress">{t('sales.status.returnInProgress')}</SelectItem>
                  <SelectItem value="returned">{t('sales.status.returned')}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={warehouseFilter} onValueChange={(val) => { setWarehouseFilter(val); setCurrentPage(1); }}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder={t('filters.warehouse')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('sales.allWarehouses')}</SelectItem>
                  {warehouses?.filter(w => w.status === 'active' || w.status === 1 || w.is_active).map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); setCurrentPage(1); }}
                className="w-[160px]"
              />
              <Input
                type="date"
                value={toDate}
                onChange={(e) => { setToDate(e.target.value); setCurrentPage(1); }}
                className="w-[160px]"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredOrders && filteredOrders.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('sales.table.orderNumber')}</th>
                    <th>{t('sales.table.externalRef')}</th>
                    <th>{t('common.date')}</th>
                    <th>{t('sales.table.customer')}</th>
                    <th>{t('sales.table.source')}</th>
                    <th>{t('common.status')}</th>
                    <th className="text-right">{t('sales.table.amount')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedOrders?.map((order) => (
                    <tr key={order.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setSelectedOrder(order)}>
                      <td className="font-medium">{order.order_number || order.platform_order_id || `#${order.id}`}</td>
                      <td className="text-muted-foreground text-sm">
                        {order.external_order_number || '—'}
                      </td>
                      <td className="text-muted-foreground">
                        {new Date(order.created_at || '').toLocaleDateString()}
                      </td>
                      <td>{order.customer_name || t('sales.walkInCustomer')}</td>
                      <td>{getMarketplaceBadge(order.marketplace_source)}</td>
                      <td>{getStatusBadge(resolveSalesOrderDisplayStatus(order))}</td>
                      <td className="text-right font-medium">{toNumber(order.total_amount).toLocaleString()} EGP</td>
                      <td>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleStatusChange(order.id, 'shipped'); }}>
                              <Truck className="w-4 h-4 mr-2" />
                              {t('sales.action.markShipped')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleStatusChange(order.id, 'delivered'); }}>
                              <CheckCircle className="w-4 h-4 mr-2" />
                              {t('sales.action.markDelivered')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleStatusChange(order.id, 'sold'); }}>
                              <DollarSign className="w-4 h-4 mr-2" />
                              {t('sales.action.markSold')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              onClick={(e) => { e.stopPropagation(); handleStatusChange(order.id, 'return_in_progress'); }}
                              className="text-orange-500"
                            >
                              <RotateCcw className="w-4 h-4 mr-2" />
                              {t('sales.action.startReturn')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between p-4 border-t">
                  <span className="text-sm text-muted-foreground">
                    {t('common.showing')} {(currentPage - 1) * itemsPerPage + 1} {t('common.to')} {Math.min(currentPage * itemsPerPage, filteredOrders?.length || 0)} {t('common.of')} {filteredOrders?.length || 0}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      {t('common.previous')}
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: totalPages }).map((_, i) => {
                        // Show limited number of pages to avoid too many buttons
                        if (
                          totalPages <= 5 || 
                          i === 0 || 
                          i === totalPages - 1 || 
                          (i >= currentPage - 2 && i <= currentPage)
                        ) {
                          return (
                            <Button
                              key={i + 1}
                              variant={currentPage === i + 1 ? 'default' : 'outline'}
                              size="sm"
                              className="w-8 h-8 p-0"
                              onClick={() => setCurrentPage(i + 1)}
                            >
                              {i + 1}
                            </Button>
                          );
                        }
                        if (i === 1 && currentPage > 3) return <span key="dots-1" className="px-2">...</span>;
                        if (i === totalPages - 2 && currentPage < totalPages - 2) return <span key="dots-2" className="px-2">...</span>;
                        return null;
                      })}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                    >
                      {t('common.next')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium mb-2">{t('sales.empty.noOrders')}</p>
              <p className="text-muted-foreground mb-4">
                {searchQuery || statusFilter !== 'all' || warehouseFilter !== 'all'
                  ? t('sales.empty.adjustFilters')
                  : t('sales.empty.createFirstOrder')}
              </p>
              <Button onClick={() => setIsDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                {t('sales.createOrder')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateSalesOrderDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} />
      <OrderInvoiceDetailDialog
        order={selectedOrder}
        open={!!selectedOrder}
        onOpenChange={(next) => {
          if (!next) setSelectedOrder(null);
        }}
      />

      <QuickShopSaleDialog open={isQuickSaleOpen} onOpenChange={setIsQuickSaleOpen} />
    </div>
  );
}
