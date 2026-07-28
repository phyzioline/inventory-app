import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import { useLanguage } from '@/contexts/LanguageContext';
import { 
  Settings as SettingsIcon, 
  Warehouse, 
  Package, 
  Truck, 
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  AlertCircle,
  CheckSquare,
  Loader2,
  UserRound,
  Shield,
  CreditCard,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useWarehouses, useCreateWarehouse, useUpdateWarehouse, useDeleteWarehouse } from '@/hooks/useWarehouses';
import { useSuppliers, useCreateSupplier, useUpdateSupplier, useDeleteSupplier } from '@/hooks/useSuppliers';
import { useSupplierAccountSummaries } from '@/hooks/useSupplierAccountSummaries';
import { getSupplierOutstanding } from '@/lib/supplierOutstanding';
import { Warehouse as WarehouseType, Supplier } from '@/lib/supabase-services';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  SettingsAccountPanel,
  SettingsSecurityPanel,
  SettingsSubscriptionSummary,
} from '@/components/settings/SettingsAccountPanels';
import { ProductWorkflowGuide } from '@/components/settings/ProductWorkflowGuide';

type EditMode = { type: 'warehouse' | 'supplier' | 'product'; id?: string; data?: any } | null;

const channelTypeOptions: Array<{ id: string; labelAr: string; labelEn: string }> = [
  { id: 'amazon_merchant', labelAr: 'أمازون تاجر', labelEn: 'Amazon Merchant' },
  { id: 'amazon_fba', labelAr: 'أمازون FBA', labelEn: 'Amazon FBA' },
  { id: 'noon_merchant', labelAr: 'نون تاجر', labelEn: 'Noon Merchant' },
  { id: 'noon_fbn', labelAr: 'نون FBN', labelEn: 'Noon FBN' },
  { id: 'jumia_merchant', labelAr: 'جوميا تاجر', labelEn: 'Jumia Merchant' },
  { id: 'jumia_fbn', labelAr: 'جوميا FBN', labelEn: 'Jumia FBN' },
  { id: 'website', labelAr: 'موقع إلكتروني', labelEn: 'Website (E-commerce)' },
  { id: 'pos', labelAr: 'متجر فعلي (POS)', labelEn: 'Physical Store (POS)' },
  { id: 'custom', labelAr: 'مخصص', labelEn: 'Custom' },
];

const normalizeType = (raw: any) => String(raw || '').trim().toLowerCase();

const resolveChannelTypeLabel = (rawType: any, isAr: boolean): string => {
  const t = normalizeType(rawType);
  const found = channelTypeOptions.find((x) => x.id === t);
  if (found) return isAr ? found.labelAr : found.labelEn;
  if (!t) return isAr ? 'غير محدد' : 'Unspecified';
  return t.replaceAll('_', ' ');
};

const slugify = (raw: string) =>
  String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const safeNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatMoney = (value: unknown): string => safeNumber(value).toFixed(2);

export default function Settings() {
  const { t, language } = useLanguage();
  const isAr = language === 'ar';
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; id: string | string[]; name: string } | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());

  // Data hooks
  const { data: warehouses = [], isLoading: warehousesLoading } = useWarehouses();
  const { data: warehouseSummary = [] } = useQuery({
    queryKey: ['warehouses-summary'],
    queryFn: () => axios.get('/api/inventory/warehouses/summary').then((r) => r.data),
  });
  const { data: suppliers = [], isLoading: suppliersLoading } = useSuppliers();
  const { summaryMap, summariesReady } = useSupplierAccountSummaries(suppliers);
  const supplierSummariesPending = !summariesReady && suppliers.length > 0;
  const { data: masterProducts = [], isLoading: productsLoading } = useQuery({
    queryKey: ['masterProducts'],
    queryFn: async () => {
      const res = await axios.get('/api/inventory/admin/master-products');
      return res.data;
    }
  });

  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: () => axios.get('/api/inventory/channels').then((r) => r.data),
  });

  const updateChannel = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) =>
      axios.put(`/api/inventory/channels/${id}`, payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      toast.success(isAr ? 'تم تحديث القناة' : 'Channel updated');
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message || (isAr ? 'فشل تحديث القناة' : 'Failed to update channel'));
    },
  });

  const createChannel = useMutation({
    mutationFn: (payload: any) => axios.post('/api/inventory/channels', payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      toast.success(isAr ? 'تمت إضافة القناة' : 'Channel created');
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message || (isAr ? 'فشل إضافة القناة' : 'Failed to create channel'));
    },
  });

  // Mutations
  const createWarehouse = useCreateWarehouse();
  const updateWarehouse = useUpdateWarehouse();
  const deleteWarehouse = useDeleteWarehouse();
  const createSupplier = useCreateSupplier();
  const updateSupplier = useUpdateSupplier();
  const deleteSupplier = useDeleteSupplier();
  
  const updateProduct = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const res = await axios.put(`/api/inventory/admin/master-products/${id}`, updates);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masterProducts'] });
      toast.success('Product updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update product: ${error.message}`);
    }
  });

  const deleteProduct = useMutation({
    mutationFn: async (id: string | string[]) => {
      if (Array.isArray(id)) {
        await axios.post('/api/inventory/admin/master-products/bulk-delete', { ids: id });
      } else {
        await axios.delete(`/api/inventory/admin/master-products/${id}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masterProducts'] });
      toast.success('Product(s) deleted successfully');
      setSelectedProducts(new Set());
    }
  });

  const handleSave = () => {
    if (!editMode || !editMode.data) return;

    switch (editMode.type) {
      case 'warehouse':
        // If this location is linked to a sales channel, update the channel type too (deduction logic).
        if (editMode.data?.channel_id) {
          const cid = String(editMode.data.channel_id);
          const channelType = normalizeType(editMode.data?.channel_type);
          if (channelType) {
            updateChannel.mutate({ id: cid, payload: { type: channelType } });
          }
        }

        // If creating a new "channel place" from Settings, create a Channel (and its linked location) instead.
        if (!editMode.id) {
          const chosen = normalizeType(editMode.data?.channel_type);
          if (chosen) {
            const name = String(editMode.data?.name || '').trim();
            const slug = slugify(name || chosen || `channel-${Date.now()}`);
            createChannel.mutate({
              name: name || slug,
              slug,
              type: chosen,
            });
            setEditMode(null);
            return;
          }
        }

        if (editMode.id) {
          const payload = { ...editMode.data };
          delete payload.channel_type;
          updateWarehouse.mutate({ id: editMode.id, updates: payload });
        } else {
          const payload = { ...editMode.data };
          delete payload.channel_type;
          createWarehouse.mutate(payload);
        }
        break;
      case 'supplier':
        if (editMode.id) {
          updateSupplier.mutate({ id: editMode.id, updates: editMode.data });
        } else {
          createSupplier.mutate(editMode.data);
        }
        break;
      case 'product':
        if (editMode.id) {
          updateProduct.mutate({ id: editMode.id, updates: editMode.data });
        }
        break;
    }
    setEditMode(null);
  };

  const handleDelete = () => {
    if (!deleteConfirm) return;

    switch (deleteConfirm.type) {
      case 'warehouse':
        deleteWarehouse.mutate(deleteConfirm.id);
        break;
      case 'supplier':
        deleteSupplier.mutate(deleteConfirm.id);
        break;
      case 'product':
        deleteProduct.mutate(deleteConfirm.id);
        break;
    }
    setDeleteConfirm(null);
  };

  const settingsTabs = [
    { id: 'account', label: t('settings.tabAccount'), icon: UserRound },
    { id: 'security', label: t('settings.tabSecurity'), icon: Shield },
    { id: 'subscription', label: t('settings.tabSubscription'), icon: CreditCard },
    { id: 'warehouses', label: t('nav.warehouses'), icon: Warehouse },
    { id: 'suppliers', label: t('nav.suppliers'), icon: Truck },
    { id: 'products', label: t('nav.products'), icon: Package },
  ];

  const { dir } = useLanguage();
  const warehouseCostMap = useMemo(() => {
    const map = new Map<string, number>();
    (warehouseSummary || []).forEach((row: any) => {
      const id = String(row?.id ?? row?.location_id ?? '');
      if (!id) return;
      map.set(id, safeNumber(row?.total_cost ?? row?.purchaseCost ?? row?.cost ?? 0));
    });
    return map;
  }, [warehouseSummary]);

  return (
    <div className="space-y-6" dir={dir}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3"
      >
        <div className="p-2 rounded-lg bg-primary/10">
          <SettingsIcon className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
          <p className="text-muted-foreground">{t('settings.subtitle')}</p>
        </div>
      </motion.div>

      {/* Settings Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Tabs defaultValue="account" className="space-y-6">
          <TabsList className="flex w-full max-w-4xl h-auto flex-wrap justify-start gap-1 p-1">
            {settingsTabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="flex items-center gap-2 px-3 py-2">
                <tab.icon className="w-4 h-4" />
                <span className="text-xs sm:text-sm">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="account" className="space-y-6">
            <SettingsAccountPanel />
          </TabsContent>

          <TabsContent value="security" className="space-y-6">
            <SettingsSecurityPanel />
          </TabsContent>

          <TabsContent value="subscription" className="space-y-6">
            <SettingsSubscriptionSummary />
          </TabsContent>

          {/* Warehouses */}
          <TabsContent value="warehouses" className="space-y-6">
            <Card className="glass-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>{t('settings.warehousesStores')}</CardTitle>
                  <CardDescription>{t('settings.warehousesStoresDesc')}</CardDescription>
                </div>
                <Button onClick={() => setEditMode({ type: 'warehouse', data: { name: '', type: 'shop', is_main: false, wallet_balance: 0 } })}>
                  <Plus className="w-4 h-4 me-2" />
                  {t('settings.addWarehouse')}
                </Button>
              </CardHeader>
              <CardContent>
                {warehousesLoading ? (
                  <div className="h-40 flex items-center justify-center text-muted-foreground">{t('common.loading')}</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('common.name')}</TableHead>
                        <TableHead>{t('common.type')}</TableHead>
                        <TableHead>{t('common.status')}</TableHead>
                        <TableHead>{t('settings.walletBalance')}</TableHead>
                        <TableHead className="text-end">{t('common.actions')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {warehouses.map((warehouse) => (
                        <TableRow key={warehouse.id}>
                          <TableCell className="font-medium">{warehouse.name}</TableCell>
                          <TableCell>
                            {(() => {
                              const channelId = warehouse?.channel_id != null ? String(warehouse.channel_id) : '';
                              const ch = channelId ? (channels || []).find((c: any) => String(c?.id) === channelId) : null;
                              const channelType = ch?.type ?? null;
                              const isMerchant = normalizeType(channelType).includes('merchant');
                              const rawWarehouseType = normalizeType(warehouse?.type);
                              const fallbackTypeLabel = rawWarehouseType === 'physical'
                                ? (isAr ? 'متجر فعلي' : 'Physical store')
                                : (warehouse.type || '').replace('_', ' ');
                              const label = channelType ? resolveChannelTypeLabel(channelType, isAr) : fallbackTypeLabel;
                              return (
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant={isMerchant ? "default" : "outline"} className="capitalize">
                                    {label}
                                  </Badge>
                                  {isMerchant && (
                                    <Badge variant="outline" className="text-[11px]">
                                      {isAr ? 'خصم من المحل' : 'Deducts from Store'}
                                    </Badge>
                                  )}
                                </div>
                              );
                            })()}
                          </TableCell>
                          <TableCell>
                            {warehouse.is_main ? (
                              <Badge className="bg-success/10 text-success">Main</Badge>
                            ) : (
                              <Badge variant="secondary">Secondary</Badge>
                            )}
                          </TableCell>
                          <TableCell>{formatMoney(warehouseCostMap.get(String(warehouse.id)) ?? 0)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => {
                                  const channelId = warehouse?.channel_id != null ? String(warehouse.channel_id) : '';
                                  const ch = channelId ? (channels || []).find((c: any) => String(c?.id) === channelId) : null;
                                  setEditMode({
                                    type: 'warehouse',
                                    id: warehouse.id,
                                    data: {
                                      ...warehouse,
                                      channel_type: ch?.type ?? '',
                                    }
                                  });
                                }}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => setDeleteConfirm({ type: 'warehouse', id: warehouse.id, name: warehouse.name })}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Suppliers */}
          <TabsContent value="suppliers" className="space-y-6">
            <Card className="glass-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Suppliers</CardTitle>
                  <CardDescription>Manage your product suppliers and vendors</CardDescription>
                </div>
                <Button onClick={() => setEditMode({ type: 'supplier', data: { name: '', phone: '', email: '', address: '', balance: 0 } })}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Supplier
                </Button>
              </CardHeader>
              <CardContent>
                {suppliersLoading ? (
                  <div className="h-40 flex items-center justify-center text-muted-foreground">Loading...</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>{t('suppliers.outstanding')}</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {suppliers
                        .filter((supplier) => supplier && supplier.id != null && String(supplier.id).trim() !== '')
                        .map((supplier) => (
                        <TableRow key={String(supplier.id)}>
                          <TableCell className="font-medium">{supplier.name}</TableCell>
                          <TableCell>{supplier.phone || '-'}</TableCell>
                          <TableCell>{supplier.email || '-'}</TableCell>
                          <TableCell>
                            {supplierSummariesPending ? (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
                            ) : (
                              <span
                                className={
                                  getSupplierOutstanding(supplier, summaryMap) > 0
                                    ? 'text-warning'
                                    : 'text-success'
                                }
                              >
                                {formatMoney(getSupplierOutstanding(supplier, summaryMap))}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => setEditMode({ type: 'supplier', id: supplier.id, data: supplier })}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => setDeleteConfirm({ type: 'supplier', id: supplier.id, name: supplier.name })}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Products */}
          <TabsContent value="products" className="space-y-6">
            <ProductWorkflowGuide />

            <Card className="glass-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>{isAr ? 'إعدادات المنتجات' : 'Product Settings'}</CardTitle>
                  <CardDescription>
                    {isAr ? 'حدود المخزون الافتراضية وإدارة المنتجات الأساسية' : 'Configure product-level settings and defaults'}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  {selectedProducts.size > 0 && (
                    <Button 
                      variant="destructive" 
                      onClick={() => setDeleteConfirm({ 
                        type: 'product', 
                        id: Array.from(selectedProducts), 
                        name: `${selectedProducts.size} selected products` 
                      })}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete ({selectedProducts.size})
                    </Button>
                  )}
                  <Button 
                    variant="outline" 
                    onClick={() => {
                        const genIds = masterProducts
                            .filter((p: any) => {
                                const skus = Array.isArray(p.offers) ? p.offers.flatMap((o: any) => Array.isArray(o.skus) ? o.skus : []) : [];
                                return skus.some((s: any) => s.sku?.endsWith('-GEN'));
                            })
                            .map((p: any) => p.id);
                        setSelectedProducts(new Set(genIds));
                        toast.info(`Selected ${genIds.length} products with -GEN suffix`);
                    }}
                  >
                    <CheckSquare className="w-4 h-4 mr-2" />
                    Select -GEN
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {productsLoading ? (
                  <div className="h-40 flex items-center justify-center text-muted-foreground">Loading...</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px]">
                          <Checkbox 
                            checked={selectedProducts.size > 0 && selectedProducts.size === masterProducts.slice(0, 20).length}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedProducts(new Set(masterProducts.slice(0, 20).map((p: any) => p.id)));
                              } else {
                                setSelectedProducts(new Set());
                              }
                            }}
                          />
                        </TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Min Stock</TableHead>
                        <TableHead>Max Stock</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {masterProducts.slice(0, 20).map((product: any) => {
                        const offerSkus = Array.isArray(product.offers) ? product.offers.flatMap((o: any) => Array.isArray(o.skus) ? o.skus : []) : [];
                        const primarySku = offerSkus.length > 0 ? offerSkus[0].sku : (product.original_supplier_sku || '-');
                        
                        return (
                        <TableRow key={product.id}>
                          <TableCell>
                            <Checkbox 
                              checked={selectedProducts.has(product.id)}
                              onCheckedChange={(checked) => {
                                const next = new Set(selectedProducts);
                                if (checked) next.add(product.id);
                                else next.delete(product.id);
                                setSelectedProducts(next);
                              }}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{product.internal_name}</TableCell>
                          <TableCell>{primarySku}</TableCell>
                          <TableCell>{product.specifications?.min_stock || 0}</TableCell>
                          <TableCell>{product.specifications?.max_stock || '-'}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => setEditMode({ 
                                  type: 'product', 
                                  id: product.id, 
                                  data: { min_stock: product.specifications?.min_stock, max_stock: product.specifications?.max_stock } 
                                })}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => setDeleteConfirm({ type: 'product', id: product.id, name: product.internal_name })}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )})}
                    </TableBody>
                  </Table>
                )}
                {masterProducts.length > 20 && (
                  <p className="text-sm text-muted-foreground mt-4">
                    {isAr
                      ? `عرض 20 من ${masterProducts.length} منتج. لعرض الكل انتقل إلى صفحة المنتجات الأساسية.`
                      : `Showing 20 of ${masterProducts.length} products. View all in Master Products page.`}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </motion.div>

      {/* Edit Dialog */}
      <Dialog open={!!editMode} onOpenChange={() => setEditMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editMode?.id ? 'Edit' : 'Add'} {editMode?.type === 'warehouse' ? 'Warehouse' : editMode?.type === 'supplier' ? 'Supplier' : 'Product'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {editMode?.type === 'warehouse' && (
              <>
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input 
                    value={editMode.data?.name || ''} 
                    onChange={(e) => setEditMode({ ...editMode, data: { ...editMode.data, name: e.target.value } })}
                    placeholder="Warehouse name"
                  />
                </div>
                {/* Removed confusing legacy "Type" dropdown (shop/amazon_fba/marketplace). */}

                {/* Channel type mapping (unified with Channels page). */}
                <div className="space-y-2">
                  <Label>{isAr ? 'نوع قناة البيع (تاجر/مستودع)' : 'Sales channel type (merchant/fulfillment)'}</Label>
                  <Select
                    value={String(editMode.data?.channel_type || '')}
                    onValueChange={(value) => setEditMode({ ...editMode, data: { ...editMode.data, channel_type: value } })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={isAr ? 'اختياري: لو ده مكان لقناة بيع' : 'Optional: if this is a sales channel place'} />
                    </SelectTrigger>
                    <SelectContent>
                      {channelTypeOptions.map((opt) => (
                        <SelectItem key={opt.id} value={opt.id}>
                          {isAr ? opt.labelAr : opt.labelEn}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!!normalizeType(editMode.data?.channel_type).includes('merchant') && (
                    <p className="text-[11px] text-muted-foreground">
                      {isAr ? 'تاجر: الطلبات تخصم من رصيد المحل الأساسي.' : 'Merchant: orders deduct from the main store stock.'}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Switch 
                    checked={editMode.data?.is_main || false}
                    onCheckedChange={(checked) => setEditMode({ ...editMode, data: { ...editMode.data, is_main: checked } })}
                  />
                  <Label>Set as main warehouse</Label>
                </div>
              </>
            )}
            {editMode?.type === 'supplier' && (
              <>
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input 
                    value={editMode.data?.name || ''} 
                    onChange={(e) => setEditMode({ ...editMode, data: { ...editMode.data, name: e.target.value } })}
                    placeholder="Supplier name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input 
                    value={editMode.data?.phone || ''} 
                    onChange={(e) => setEditMode({ ...editMode, data: { ...editMode.data, phone: e.target.value } })}
                    placeholder="Phone number"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input 
                    type="email"
                    value={editMode.data?.email || ''} 
                    onChange={(e) => setEditMode({ ...editMode, data: { ...editMode.data, email: e.target.value } })}
                    placeholder="Email address"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Address</Label>
                  <Input 
                    value={editMode.data?.address || ''} 
                    onChange={(e) => setEditMode({ ...editMode, data: { ...editMode.data, address: e.target.value } })}
                    placeholder="Address"
                  />
                </div>
              </>
            )}
            {editMode?.type === 'product' && (
              <>
                <div className="space-y-2">
                  <Label>Minimum Stock Level</Label>
                  <Input 
                    type="number"
                    value={editMode.data?.min_stock || 0} 
                    onChange={(e) => setEditMode({ ...editMode, data: { ...editMode.data, min_stock: parseInt(e.target.value) } })}
                    placeholder="Min stock"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Maximum Stock Level</Label>
                  <Input 
                    type="number"
                    value={editMode.data?.max_stock || ''} 
                    onChange={(e) => setEditMode({ ...editMode, data: { ...editMode.data, max_stock: parseInt(e.target.value) || null } })}
                    placeholder="Max stock (optional)"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditMode(null)}>Cancel</Button>
            <Button onClick={handleSave}>
              <Save className="w-4 h-4 mr-2" />
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="w-5 h-5" />
              Confirm Deletion
            </DialogTitle>
          </DialogHeader>
          <p className="py-4">
            Are you sure you want to delete <strong>{deleteConfirm?.name}</strong>? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
