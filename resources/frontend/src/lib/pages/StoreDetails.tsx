import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Package,
  TrendingUp,
  AlertTriangle,
  Search,
  Wallet,
  RefreshCw,
  ArrowRightLeft,
  SlidersHorizontal,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { warehouseService, inventoryService } from '@/lib/supabase-services';
import { useLanguage } from '@/contexts/LanguageContext';
import TransferModal from '@/components/inventory/TransferModal';
import { toast } from 'sonner';

export default function StoreDetailsPage() {
  const { storeId } = useParams<{ storeId: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isSetStockOpen, setIsSetStockOpen] = useState(false);
  const [targetStockQty, setTargetStockQty] = useState('');

  // Fetch warehouse details
  const { data: warehouse, isLoading: isLoadingWarehouse, error: warehouseError } = useQuery({
    queryKey: ['warehouse', storeId],
    queryFn: () => warehouseService.getById(storeId!),
    enabled: !!storeId,
  });

  // Fetch inventory for this warehouse
  const { data: inventory, isLoading: isLoadingInventory } = useQuery({
    queryKey: ['warehouse-inventory', storeId],
    queryFn: async () => {
      try {
        return await inventoryService.getByWarehouse(storeId!);
      } catch {
        return [];
      }
    },
    enabled: !!storeId,
  });

  const getRowMeta = (item: any) => {
    const sku = item?.sku || {};
    const masterProduct = sku?.offer?.master_product || sku?.offer?.masterProduct || null;
    const quantity = Number(item?.quantity || 0);
    const reserved = Number(item?.reserved_quantity ?? item?.reserved ?? 0);
    const minStock = Number(masterProduct?.min_stock_level ?? masterProduct?.min_stock ?? 0);

    return {
      rowId: String(item?.id ?? `${sku?.id ?? ''}-${item?.location_id ?? ''}`),
      skuId: sku?.id ? String(sku.id) : '',
      masterProductId: masterProduct?.id ? String(masterProduct.id) : '',
      name: masterProduct?.internal_name || sku?.name || sku?.offer?.name || sku?.sku || '—',
      skuCode: sku?.sku || sku?.marketplace_id || '—',
      quantity,
      reserved,
      minStock,
    };
  };

  const normalizedInventory = useMemo(
    () => (inventory || []).map((item: any) => ({ ...item, __meta: getRowMeta(item) })),
    [inventory]
  );

  const filteredInventory = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    if (!search) return normalizedInventory;

    return normalizedInventory.filter((item: any) => {
      const meta = item.__meta;
      return meta.name.toLowerCase().includes(search) || meta.skuCode.toLowerCase().includes(search);
    });
  }, [normalizedInventory, searchQuery]);

  // Calculate stats
  const stats = {
    totalProducts: normalizedInventory.length || 0,
    totalItems: normalizedInventory.reduce((sum: number, item: any) => sum + Number(item.__meta.quantity || 0), 0) || 0,
    walletBalance: warehouse?.wallet_balance || 0,
    lowStockItems: normalizedInventory.filter((item: any) => Number(item.__meta.quantity || 0) <= Number(item.__meta.minStock || 0)).length || 0,
  };

  const selectedInventoryRows = useMemo(
    () => filteredInventory.filter((item: any) => selectedRows.has(String(item.__meta.rowId))),
    [filteredInventory, selectedRows]
  );

  const setStockMutation = useMutation({
    mutationFn: async (qty: number) => {
      if (!storeId) throw new Error('Missing store id');
      const targets = selectedInventoryRows
        .map((row: any) => row.__meta)
        .filter((meta: any) => !!meta.skuId);

      await Promise.all(
        targets.map((meta: any) => inventoryService.setStock(meta.skuId, storeId, qty))
      );
      return targets.length;
    },
    onSuccess: (count) => {
      toast.success(`تم ضبط مخزون ${count} منتج بنجاح`);
      setIsSetStockOpen(false);
      setTargetStockQty('');
      setSelectedRows(new Set());
      queryClient.invalidateQueries({ queryKey: ['warehouse-inventory', storeId] });
      queryClient.invalidateQueries({ queryKey: ['inventory-by-location'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message || error?.message || 'فشل ضبط المخزون');
    },
  });

  if (isLoadingWarehouse || isLoadingInventory) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">{t('loading') || 'Loading...'}</p>
        </div>
      </div>
    );
  }

  if (warehouseError || !warehouse) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">{t('warehouseNotFound') || 'المخزن غير موجود'}</h2>
          <p className="text-muted-foreground mb-4">{t('warehouseNotFoundDesc') || 'المخزن الذي تبحث عنه غير موجود'}</p>
          <Button onClick={() => navigate('/warehouses')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t('backToWarehouses') || 'العودة للمخازن'}
          </Button>
        </div>
      </div>
    );
  }

  const getWarehouseTypeColor = (type: string) => {
    switch (type) {
      case 'shop':
      case 'store':
        return 'bg-primary/10 text-primary';
      case 'amazon_fba':
        return 'bg-warning/10 text-warning';
      case 'marketplace':
        return 'bg-accent/10 text-accent-foreground';
      default:
        return 'bg-secondary/10 text-secondary-foreground';
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/warehouses')}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{warehouse.name}</h1>
              <Badge className={getWarehouseTypeColor(warehouse.type)}>
                {warehouse.type === 'shop' || warehouse.type === 'store' ? 'Shop / Store' : warehouse.type.replace('_', ' ')}
              </Badge>
              {warehouse.is_main && (
                <Badge variant="outline" className="border-primary text-primary">
                  {t('main') || 'رئيسي'}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">
              {t('manageWarehouseInventory') || 'إدارة المنتجات والمخزون لهذا المخزن'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="default"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => navigate(`/stores/${storeId}/import`)}
          >
            <Package className="w-4 h-4 mr-2" />
            استيراد منتجات
          </Button>
          <Button variant="outline" onClick={() => setIsTransferOpen(true)}>
            <ArrowRightLeft className="w-4 h-4 mr-2" />
            تحويلات
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ['warehouse', storeId] });
              queryClient.invalidateQueries({ queryKey: ['warehouse-inventory', storeId] });
            }}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            تزامن
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-primary/10">
              <Package className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('totalProducts') || 'إجمالي المنتجات'}</p>
              <p className="text-2xl font-bold">{stats.totalProducts}</p>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-info/10">
              <TrendingUp className="w-5 h-5 text-info" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('totalItems') || 'إجمالي الوحدات'}</p>
              <p className="text-2xl font-bold">{stats.totalItems.toLocaleString()}</p>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-success/10">
              <Wallet className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('walletBalance') || 'رصيد المحفظة'}</p>
              <p className="text-2xl font-bold">{stats.walletBalance.toLocaleString()}</p>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-warning/10">
              <AlertTriangle className="w-5 h-5 text-warning" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('lowStockAlerts') || 'تنبيهات نقص المخزون'}</p>
              <p className="text-2xl font-bold">{stats.lowStockItems}</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Inventory Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>{t('inventory') || 'المخزون'}</CardTitle>
              <CardDescription>{t('productsInWarehouse') || 'المنتجات المتاحة في هذا المخزن'}</CardDescription>
            </div>
            <div className="relative sm:w-[300px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t('searchProducts') || 'بحث عن منتج...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          {selectedRows.size > 0 && (
            <div className="mt-3 rounded-md border bg-primary/5 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{selectedRows.size} منتج محدد</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setIsSetStockOpen(true)}>
                  <SlidersHorizontal className="w-4 h-4 mr-1" />
                  ضبط الكمية
                </Button>
                <Button variant="outline" size="sm" onClick={() => setIsTransferOpen(true)}>
                  <ArrowRightLeft className="w-4 h-4 mr-1" />
                  تحويل
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelectedRows(new Set())}>
                  إلغاء
                </Button>
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {filteredInventory && filteredInventory.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground w-10">
                      <input
                        type="checkbox"
                        checked={filteredInventory.length > 0 && filteredInventory.every((row: any) => selectedRows.has(String(row.__meta.rowId)))}
                        onChange={(e) => {
                          const next = new Set(selectedRows);
                          if (e.target.checked) {
                            filteredInventory.forEach((row: any) => next.add(String(row.__meta.rowId)));
                          } else {
                            filteredInventory.forEach((row: any) => next.delete(String(row.__meta.rowId)));
                          }
                          setSelectedRows(next);
                        }}
                      />
                    </th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">{t('product') || 'المنتج'}</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">SKU</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">{t('quantity') || 'الكمية'}</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">محجوز</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">{t('status') || 'الحالة'}</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInventory.map((item: any) => {
                    const meta = item.__meta;
                    const isLowStock = Number(meta.quantity || 0) <= Number(meta.minStock || 0);
                    const checked = selectedRows.has(String(meta.rowId));

                    return (
                      <tr key={meta.rowId} className="border-b border-border/50 hover:bg-muted/50">
                        <td className="py-3 px-4">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const next = new Set(selectedRows);
                              if (next.has(String(meta.rowId))) next.delete(String(meta.rowId));
                              else next.add(String(meta.rowId));
                              setSelectedRows(next);
                            }}
                          />
                        </td>
                        <td className="py-3 px-4 font-medium">{meta.name}</td>
                        <td className="py-3 px-4 text-muted-foreground">{meta.skuCode}</td>
                        <td className="py-3 px-4 font-medium">{meta.quantity.toLocaleString()}</td>
                        <td className="py-3 px-4">{meta.reserved.toLocaleString()}</td>
                        <td className="py-3 px-4">
                          {isLowStock ? (
                            <Badge variant="destructive">{t('lowStock') || 'نقص مخزون'}</Badge>
                          ) : (
                            <Badge variant="secondary">{t('inStock') || 'متوفر'}</Badge>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={!meta.masterProductId}
                              onClick={() => {
                                if (meta.masterProductId) navigate(`/master-products/${meta.masterProductId}`);
                              }}
                              title="فتح المنتج الرئيسي"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <Package className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">{t('noProductsInWarehouse') || 'لا توجد منتجات في هذا المخزن'}</p>
              <Button variant="outline" className="mt-3" onClick={() => navigate(`/stores/${storeId}/import`)}>
                ابدأ بالاستيراد
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <TransferModal
        isOpen={isTransferOpen}
        onClose={() => setIsTransferOpen(false)}
        defaultSourceId={storeId}
      />

      <Dialog open={isSetStockOpen} onOpenChange={setIsSetStockOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>ضبط الكمية للمحدد ({selectedRows.size})</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              type="number"
              min="0"
              value={targetStockQty}
              onChange={(e) => setTargetStockQty(e.target.value)}
              placeholder="مثال: 0 أو 50"
            />
            <p className="text-xs text-muted-foreground">
              سيتم تعيين الكمية المستهدفة لكل SKU محدد في هذا المخزن.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSetStockOpen(false)}>إلغاء</Button>
            <Button
              disabled={setStockMutation.isPending}
              onClick={() => {
                const target = Number(targetStockQty);
                if (!Number.isFinite(target) || target < 0) {
                  toast.error('أدخل كمية صحيحة');
                  return;
                }
                setStockMutation.mutate(target);
              }}
            >
              تطبيق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
