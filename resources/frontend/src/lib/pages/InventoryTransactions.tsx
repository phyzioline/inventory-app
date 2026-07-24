import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, subDays, startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { 
  Search, 
  Filter, 
  Download, 
  Upload, 
  ArrowUpRight, 
  ArrowDownLeft, 
  RefreshCw, 
  Package,
  TrendingUp,
  TrendingDown,
  RotateCcw,
  AlertTriangle,
  CalendarDays,
  X
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLanguage } from '@/contexts/LanguageContext';
import { 
  stockMovementService, 
  warehouseService, 
  supplierService, 
  productService,
  salesOrderService,
  returnService,
  purchaseInvoiceService,
  asinService,
  StockMovement,
  SalesOrder,
  Return,
  PurchaseInvoice,
  Warehouse,
  Product,
  Supplier,
  ASIN
} from '@/lib/supabase-services';
import { cn } from '@/lib/utils';
import { exportToExcel } from '@/lib/excelUtils';
import { DateRange } from 'react-day-picker';

type TransactionType = 'all' | 'purchase' | 'sale' | 'transfer' | 'return' | 'adjustment';
type OrderStatus = 'all' | 'pending' | 'shipped' | 'delivered' | 'returned';

interface UnifiedTransaction {
  id: string;
  type: TransactionType;
  date: string;
  product_name: string;
  product_id: string | null;
  sku: string | null;
  asin: string | null;
  quantity: number;
  direction: 'in' | 'out' | 'transfer';
  warehouse_from: string | null;
  warehouse_to: string | null;
  reference_number: string | null;
  external_order_number: string | null;
  marketplace_source: string | null;
  status: string;
  supplier_name: string | null;
  customer_name: string | null;
  amount: number;
  notes: string | null;
}

export default function InventoryTransactions() {
  const { t } = useLanguage();
  const toNumber = (value: unknown) => {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  const [searchTerm, setSearchTerm] = useState('');
  const [transactionType, setTransactionType] = useState<TransactionType>('all');
  const [selectedWarehouses, setSelectedWarehouses] = useState<string[]>([]);
  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus>('all');
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date()
  });
  const [showFilters, setShowFilters] = useState(false);

  const normalizeTransactionType = (raw: unknown): TransactionType => {
    const value = String(raw || '').toLowerCase().trim();
    if (['purchase', 'in', 'receive', 'received'].includes(value)) return 'purchase';
    if (['sale', 'out', 'sold'].includes(value)) return 'sale';
    if (['transfer', 'transfer_in', 'transfer_out'].includes(value)) return 'transfer';
    if (['return', 'refund', 'returned'].includes(value)) return 'return';
    if (['adjustment', 'set', 'initial'].includes(value)) return 'adjustment';
    return 'adjustment';
  };

  const directionFromType = (rawType: unknown): 'in' | 'out' | 'transfer' => {
    const value = String(rawType || '').toLowerCase().trim();
    if (['transfer', 'transfer_in', 'transfer_out'].includes(value)) return 'transfer';
    if (['purchase', 'in', 'receive', 'received', 'return'].includes(value)) return 'in';
    return 'out';
  };

  // Fetch all required data
  const { data: stockMovements = [], isLoading: loadingMovements } = useQuery({
    queryKey: ['stock-movements'],
    queryFn: () => stockMovementService.getAll()
  });

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehouseService.getAll()
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => supplierService.getAll()
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => productService.getAll()
  });

  const { data: salesOrders = [] } = useQuery({
    queryKey: ['sales-orders'],
    queryFn: () => salesOrderService.getAll()
  });

  const { data: returns = [] } = useQuery({
    queryKey: ['returns'],
    queryFn: () => returnService.getPage({ page: 1, perPage: 200 }).then((r) => r.data),
  });

  const { data: purchaseInvoices = [] } = useQuery({
    queryKey: ['purchase-invoices'],
    queryFn: () => purchaseInvoiceService.getAll()
  });

  const { data: asins = [] } = useQuery({
    queryKey: ['asins'],
    queryFn: () => asinService.getAll()
  });

  // Create unified transactions list
  const unifiedTransactions = useMemo(() => {
    const transactions: UnifiedTransaction[] = [];

    // Add stock movements
    stockMovements.forEach((movement: any) => {
      const movementProductId = String(movement.product_id || movement.sku_id || '');
      const movementTypeRaw = movement.movement_type || movement.type || '';
      const normalizedType = normalizeTransactionType(movementTypeRaw);
      const movementDirection = directionFromType(movementTypeRaw);
      const matchedProduct = products.find((p: Product) => String(p.id) === movementProductId);
      const movementSkuCode = movement?.sku?.sku || matchedProduct?.sku || null;
      const fromWarehouse = warehouses.find(
        (w: Warehouse) => String(w.id) === String(movement.from_warehouse_id || movement.from_location_id || '')
      );
      const toWarehouse = warehouses.find(
        (w: Warehouse) => String(w.id) === String(movement.to_warehouse_id || movement.to_location_id || movement.location_id || '')
      );
      const asin = asins.find((a: ASIN) => String(a.product_id) === movementProductId);
      const productName =
        movement?.sku?.name ||
        movement?.sku?.product_name ||
        matchedProduct?.name ||
        'Unknown Product';

      transactions.push({
        id: String(movement.id),
        type: normalizedType,
        date: movement.movement_date || movement.created_at,
        product_name: productName,
        product_id: movementProductId || null,
        sku: movementSkuCode,
        asin: asin?.asin_code || null,
        quantity: toNumber(movement.quantity),
        direction: movementDirection,
        warehouse_from: fromWarehouse?.name || (movementDirection === 'transfer' ? (movement.location?.name || null) : null),
        warehouse_to: toWarehouse?.name || movement.location?.name || null,
        reference_number: movement.reference_number || movement.reference_id || null,
        external_order_number: null,
        marketplace_source: null,
        status: 'completed',
        supplier_name: null,
        customer_name: null,
        amount: 0,
        notes: movement.notes || null
      });
    });

    // OUT movements already logged for a specific order+SKU (manual sale or marketplace import): do not add a second
    // synthetic "sale" row from the orders list — that doubled apparent volume/sales after imports.
    const stockOutKeysForOrderSku = new Set<string>();
    stockMovements.forEach((m: any) => {
      const t = String(m.type || '').toUpperCase();
      if (t !== 'OUT') return;
      const rt = String(m.reference_type || '');
      if (rt !== 'Order' && rt !== 'ImportedOrder') return;
      const oid = String(m.reference_id ?? '').trim();
      const sid = String(m.sku_id ?? '').trim();
      if (oid !== '' && sid !== '') {
        stockOutKeysForOrderSku.add(`${oid}|${sid}`);
      }
    });

    // Add sales orders
    salesOrders.forEach((order: SalesOrder) => {
      const warehouse = warehouses.find((w: Warehouse) => w.id === order.warehouse_id);
      
      order.items?.forEach(item => {
        const itemSkuId = String((item as any).sku_id ?? (item as any).sku?.id ?? '').trim();
        if (itemSkuId !== '' && stockOutKeysForOrderSku.has(`${String(order.id)}|${itemSkuId}`)) {
          return;
        }
        const product = products.find((p: Product) => p.id === item.product_id);
        const asin = asins.find((a: ASIN) => a.product_id === item.product_id);

        transactions.push({
          id: `${order.id}-${item.id}`,
          type: 'sale',
          date: order.created_at,
          product_name: product?.name || 'Unknown Product',
          product_id: item.product_id,
          sku: product?.sku || null,
          asin: asin?.asin_code || null,
          quantity: item.quantity,
          direction: 'out',
          warehouse_from: warehouse?.name || null,
          warehouse_to: null,
          reference_number: order.order_number,
          external_order_number: order.external_order_number,
          marketplace_source: order.marketplace_source,
          status: order.status || 'pending',
          supplier_name: null,
          customer_name: order.customer_name,
          amount: item.total_price,
          notes: null
        });
      });
    });

    // Add returns
    returns.forEach((ret: Return) => {
      const order = salesOrders.find((o: SalesOrder) => o.id === ret.order_id);
      const warehouse = order ? warehouses.find((w: Warehouse) => w.id === order.warehouse_id) : null;

      order?.items?.forEach(item => {
        const product = products.find((p: Product) => p.id === item.product_id);
        const asin = asins.find((a: ASIN) => a.product_id === item.product_id);

        transactions.push({
          id: `return-${ret.id}-${item.id}`,
          type: 'return',
          date: ret.created_at,
          product_name: product?.name || 'Unknown Product',
          product_id: item.product_id,
          sku: product?.sku || null,
          asin: asin?.asin_code || null,
          quantity: item.quantity,
          direction: ret.return_type === 'stock' ? 'in' : 'out',
          warehouse_from: null,
          warehouse_to: warehouse?.name || null,
          reference_number: ret.return_number,
          external_order_number: ret.amazon_order_number,
          marketplace_source: order?.marketplace_source || null,
          status: ret.return_status || 'pending',
          supplier_name: null,
          customer_name: order?.customer_name || null,
          amount: ret.refund_amount || 0,
          notes: ret.reason
        });
      });
    });

    // Add purchase invoices
    purchaseInvoices.forEach((invoice: PurchaseInvoice) => {
      const supplier = suppliers.find((s: Supplier) => s.id === invoice.supplier_id);
      const warehouse = warehouses.find((w: Warehouse) => w.id === invoice.warehouse_id);

      invoice.items?.forEach(item => {
        const product = products.find((p: Product) => p.id === item.product_id);
        const asin = asins.find((a: ASIN) => a.product_id === item.product_id);

        transactions.push({
          id: `purchase-${invoice.id}-${item.id}`,
          type: 'purchase',
          date: invoice.created_at,
          product_name: product?.name || 'Unknown Product',
          product_id: item.product_id,
          sku: product?.sku || null,
          asin: asin?.asin_code || null,
          quantity: item.quantity,
          direction: 'in',
          warehouse_from: null,
          warehouse_to: warehouse?.name || null,
          reference_number: invoice.invoice_number,
          external_order_number: null,
          marketplace_source: null,
          status: invoice.status || 'pending',
          supplier_name: supplier?.name || null,
          customer_name: null,
          amount: item.total_price,
          notes: invoice.notes
        });
      });
    });

    // Sort by date descending
    return transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [stockMovements, salesOrders, returns, purchaseInvoices, warehouses, suppliers, products, asins]);

  // Apply filters
  const filteredTransactions = useMemo(() => {
    return unifiedTransactions.filter(tx => {
      // Search filter
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        const matchesSearch = 
          tx.product_name.toLowerCase().includes(search) ||
          tx.sku?.toLowerCase().includes(search) ||
          tx.asin?.toLowerCase().includes(search) ||
          tx.reference_number?.toLowerCase().includes(search) ||
          tx.external_order_number?.toLowerCase().includes(search) ||
          tx.supplier_name?.toLowerCase().includes(search) ||
          tx.customer_name?.toLowerCase().includes(search);
        if (!matchesSearch) return false;
      }

      // Transaction type filter
      if (transactionType !== 'all' && tx.type !== transactionType) return false;

      // Warehouse filter
      if (selectedWarehouses.length > 0) {
        const matchesWarehouse = 
          (tx.warehouse_from && selectedWarehouses.some(w => tx.warehouse_from?.includes(w))) ||
          (tx.warehouse_to && selectedWarehouses.some(w => tx.warehouse_to?.includes(w)));
        if (!matchesWarehouse) return false;
      }

      // Supplier filter
      if (selectedSuppliers.length > 0 && tx.supplier_name) {
        if (!selectedSuppliers.includes(tx.supplier_name)) return false;
      }

      // Product filter
      if (selectedProducts.length > 0 && tx.product_id) {
        if (!selectedProducts.includes(tx.product_id)) return false;
      }

      // Status filter
      if (selectedStatus !== 'all' && tx.status !== selectedStatus) return false;

      // Date range filter
      if (dateRange?.from && dateRange?.to) {
        const txDate = new Date(tx.date);
        if (!isWithinInterval(txDate, { 
          start: startOfDay(dateRange.from), 
          end: endOfDay(dateRange.to) 
        })) return false;
      }

      return true;
    });
  }, [unifiedTransactions, searchTerm, transactionType, selectedWarehouses, selectedSuppliers, selectedProducts, selectedStatus, dateRange]);

  // Calculate statistics
  const stats = useMemo(() => {
    const incoming = filteredTransactions.filter(tx => tx.direction === 'in');
    const outgoing = filteredTransactions.filter(tx => tx.direction === 'out');
    const transfers = filteredTransactions.filter(tx => tx.direction === 'transfer');

    return {
      totalTransactions: filteredTransactions.length,
      incomingCount: incoming.length,
      incomingQuantity: incoming.reduce((sum, tx) => sum + toNumber(tx.quantity), 0),
      outgoingCount: outgoing.length,
      outgoingQuantity: outgoing.reduce((sum, tx) => sum + toNumber(tx.quantity), 0),
      transferCount: transfers.length,
      transferQuantity: transfers.reduce((sum, tx) => sum + toNumber(tx.quantity), 0),
      totalValue: filteredTransactions.reduce((sum, tx) => sum + toNumber(tx.amount), 0),
      pendingOrders: filteredTransactions.filter(tx => tx.status === 'pending').length,
      shippedOrders: filteredTransactions.filter(tx => tx.status === 'shipped').length,
      deliveredOrders: filteredTransactions.filter(tx => tx.status === 'delivered').length,
      returnedOrders: filteredTransactions.filter(tx => tx.type === 'return').length
    };
  }, [filteredTransactions]);

  const handleExport = () => {
    const exportData = filteredTransactions.map(tx => ({
      'Date': format(new Date(tx.date), 'yyyy-MM-dd HH:mm'),
      'Type': tx.type,
      'Product': tx.product_name,
      'SKU': tx.sku || '',
      'ASIN': tx.asin || '',
      'Quantity': tx.quantity,
      'Direction': tx.direction,
      'From Warehouse': tx.warehouse_from || '',
      'To Warehouse': tx.warehouse_to || '',
      'Reference': tx.reference_number || '',
      'External Order': tx.external_order_number || '',
      'Marketplace': tx.marketplace_source || '',
      'Status': tx.status,
      'Supplier': tx.supplier_name || '',
      'Customer': tx.customer_name || '',
      'Amount': tx.amount,
      'Notes': tx.notes || ''
    }));

    exportToExcel(exportData, 'inventory-transactions');
  };

  const clearFilters = () => {
    setSearchTerm('');
    setTransactionType('all');
    setSelectedWarehouses([]);
    setSelectedSuppliers([]);
    setSelectedProducts([]);
    setSelectedStatus('all');
    setDateRange({ from: subDays(new Date(), 30), to: new Date() });
  };

  const getTypeIcon = (type: TransactionType) => {
    switch (type) {
      case 'purchase': return <ArrowDownLeft className="w-4 h-4 text-green-500" />;
      case 'sale': return <ArrowUpRight className="w-4 h-4 text-blue-500" />;
      case 'transfer': return <RefreshCw className="w-4 h-4 text-orange-500" />;
      case 'return': return <RotateCcw className="w-4 h-4 text-purple-500" />;
      case 'adjustment': return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      default: return <Package className="w-4 h-4" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
      pending: 'secondary',
      shipped: 'outline',
      delivered: 'default',
      sold: 'default',
      returned: 'destructive',
      completed: 'default',
      received: 'default',
      refunded: 'destructive',
      restocked: 'default',
      partial: 'secondary',
      paid: 'default'
    };

    return (
      <Badge variant={variants[status] || 'secondary'} className="capitalize">
        {status}
      </Badge>
    );
  };

  const getDirectionBadge = (direction: 'in' | 'out' | 'transfer') => {
    const config = {
      in: { label: t('transactions.direction.in'), className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
      out: { label: t('transactions.direction.out'), className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
      transfer: { label: t('transactions.direction.transfer'), className: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' }
    };

    return (
      <Badge variant="outline" className={config[direction].className}>
        {config[direction].label}
      </Badge>
    );
  };

  const isLoading = loadingMovements;

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('transactions.title')}</h1>
          <p className="text-muted-foreground">
            {t('transactions.subtitle')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            {t('transactions.export')}
          </Button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">{t('transactions.total')}</p>
                <p className="text-xl font-bold">{stats.totalTransactions}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-500" />
              <div>
                <p className="text-xs text-muted-foreground">{t('transactions.incoming')}</p>
                <p className="text-xl font-bold text-green-600">{stats.incomingQuantity}</p>
                <p className="text-xs text-muted-foreground">{stats.incomingCount} {t('transactions.txns')}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-red-500" />
              <div>
                <p className="text-xs text-muted-foreground">{t('transactions.outgoing')}</p>
                <p className="text-xl font-bold text-red-600">{stats.outgoingQuantity}</p>
                <p className="text-xs text-muted-foreground">{stats.outgoingCount} {t('transactions.txns')}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-orange-500" />
              <div>
                <p className="text-xs text-muted-foreground">{t('transactions.transfers')}</p>
                <p className="text-xl font-bold text-orange-600">{stats.transferQuantity}</p>
                <p className="text-xs text-muted-foreground">{stats.transferCount} {t('transactions.txns')}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-purple-500" />
              <div>
                <p className="text-xs text-muted-foreground">{t('transactions.returns')}</p>
                <p className="text-xl font-bold text-purple-600">{stats.returnedOrders}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              <div>
                <p className="text-xs text-muted-foreground">{t('transactions.pending')}</p>
                <p className="text-xl font-bold text-yellow-600">{stats.pendingOrders}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Order Lifecycle Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t('transactions.orderLifecycle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            <div className="flex items-center gap-2 px-3 py-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg min-w-fit">
              <span className="text-xs font-medium">{t('sales.status.pending')}</span>
              <Badge variant="secondary">{stats.pendingOrders}</Badge>
            </div>
            <div className="text-muted-foreground">→</div>
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg min-w-fit">
              <span className="text-xs font-medium">{t('sales.status.shipped')}</span>
              <Badge variant="secondary">{stats.shippedOrders}</Badge>
            </div>
            <div className="text-muted-foreground">→</div>
            <div className="flex items-center gap-2 px-3 py-2 bg-green-100 dark:bg-green-900/30 rounded-lg min-w-fit">
              <span className="text-xs font-medium">{t('sales.status.delivered')}</span>
              <Badge variant="secondary">{stats.deliveredOrders}</Badge>
            </div>
            <div className="text-muted-foreground">→</div>
            <div className="flex items-center gap-2 px-3 py-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg min-w-fit">
              <span className="text-xs font-medium">{t('sales.status.returned')}</span>
              <Badge variant="secondary">{stats.returnedOrders}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search and Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            {/* Search Bar */}
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={t('transactions.search')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="w-4 h-4 mr-2" />
                {t('transactions.filters')}
                {(selectedWarehouses.length > 0 || selectedSuppliers.length > 0 || selectedProducts.length > 0) && (
                  <Badge variant="secondary" className="ml-2">
                    {selectedWarehouses.length + selectedSuppliers.length + selectedProducts.length}
                  </Badge>
                )}
              </Button>
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="w-4 h-4 mr-1" />
                {t('transactions.clear')}
              </Button>
            </div>

            {/* Quick Filters */}
            <div className="flex flex-wrap gap-2">
              <Select value={transactionType} onValueChange={(v) => setTransactionType(v as TransactionType)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder={t('transactions.type')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('transactions.allTypes')}</SelectItem>
                  <SelectItem value="purchase">{t('transactions.type.purchase')}</SelectItem>
                  <SelectItem value="sale">{t('transactions.type.sale')}</SelectItem>
                  <SelectItem value="transfer">{t('transactions.type.transfer')}</SelectItem>
                  <SelectItem value="return">{t('transactions.type.return')}</SelectItem>
                  <SelectItem value="adjustment">{t('transactions.type.adjustment')}</SelectItem>
                </SelectContent>
              </Select>

              <Select value={selectedStatus} onValueChange={(v) => setSelectedStatus(v as OrderStatus)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder={t('common.status')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('transactions.allStatus')}</SelectItem>
                  <SelectItem value="pending">{t('sales.status.pending')}</SelectItem>
                  <SelectItem value="shipped">{t('sales.status.shipped')}</SelectItem>
                  <SelectItem value="delivered">{t('sales.status.delivered')}</SelectItem>
                  <SelectItem value="returned">{t('sales.status.returned')}</SelectItem>
                </SelectContent>
              </Select>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <CalendarDays className="w-4 h-4" />
                    {dateRange?.from ? (
                      dateRange.to ? (
                        `${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d')}`
                      ) : (
                        format(dateRange.from, 'MMM d, yyyy')
                      )
                    ) : (
                      t('transactions.dateRange')
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={dateRange?.from}
                    selected={dateRange}
                    onSelect={setDateRange}
                    numberOfMonths={2}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Advanced Filters */}
            {showFilters && (
              <div className="grid gap-4 grid-cols-1 md:grid-cols-3 pt-4 border-t">
                {/* Warehouses Multi-select */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('transactions.warehouses')}</label>
                  <ScrollArea className="h-[120px] border rounded-md p-2">
                    {warehouses.map((warehouse: Warehouse) => (
                      <div key={warehouse.id} className="flex items-center gap-2 py-1">
                        <Checkbox
                          id={`wh-${warehouse.id}`}
                          checked={selectedWarehouses.includes(warehouse.name)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedWarehouses([...selectedWarehouses, warehouse.name]);
                            } else {
                              setSelectedWarehouses(selectedWarehouses.filter(w => w !== warehouse.name));
                            }
                          }}
                        />
                        <label htmlFor={`wh-${warehouse.id}`} className="text-sm cursor-pointer">
                          {warehouse.name}
                        </label>
                      </div>
                    ))}
                  </ScrollArea>
                </div>

                {/* Suppliers Multi-select */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('transactions.suppliers')}</label>
                  <ScrollArea className="h-[120px] border rounded-md p-2">
                    {suppliers.map((supplier: Supplier) => (
                      <div key={supplier.id} className="flex items-center gap-2 py-1">
                        <Checkbox
                          id={`sup-${supplier.id}`}
                          checked={selectedSuppliers.includes(supplier.name)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedSuppliers([...selectedSuppliers, supplier.name]);
                            } else {
                              setSelectedSuppliers(selectedSuppliers.filter(s => s !== supplier.name));
                            }
                          }}
                        />
                        <label htmlFor={`sup-${supplier.id}`} className="text-sm cursor-pointer">
                          {supplier.name}
                        </label>
                      </div>
                    ))}
                  </ScrollArea>
                </div>

                {/* Products Multi-select */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('transactions.products')}</label>
                  <ScrollArea className="h-[120px] border rounded-md p-2">
                    {products.slice(0, 50).map((product: Product) => (
                      <div key={product.id} className="flex items-center gap-2 py-1">
                        <Checkbox
                          id={`prod-${product.id}`}
                          checked={selectedProducts.includes(product.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedProducts([...selectedProducts, product.id]);
                            } else {
                              setSelectedProducts(selectedProducts.filter(p => p !== product.id));
                            }
                          }}
                        />
                        <label htmlFor={`prod-${product.id}`} className="text-sm cursor-pointer truncate">
                          {product.name}
                        </label>
                      </div>
                    ))}
                  </ScrollArea>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Transactions Table */}
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[600px]">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-[100px]">{t('common.date')}</TableHead>
                  <TableHead className="w-[80px]">{t('transactions.type')}</TableHead>
                  <TableHead>{t('table.product')}</TableHead>
                  <TableHead className="w-[100px]">SKU</TableHead>
                  <TableHead className="w-[100px]">ASIN</TableHead>
                  <TableHead className="w-[80px] text-right">{t('sales.qty')}</TableHead>
                  <TableHead className="w-[90px]">{t('transactions.table.direction')}</TableHead>
                  <TableHead>{t('table.warehouse')}</TableHead>
                  <TableHead>{t('transactions.table.reference')}</TableHead>
                  <TableHead>{t('transactions.table.marketplace')}</TableHead>
                  <TableHead className="w-[100px]">{t('common.status')}</TableHead>
                  <TableHead className="text-right">{t('common.amount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-8">
                      {t('transactions.loading')}
                    </TableCell>
                  </TableRow>
                ) : filteredTransactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-8">
                      {t('transactions.noTransactions')}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredTransactions.map((tx) => (
                    <TableRow key={tx.id} className="hover:bg-muted/50">
                      <TableCell className="text-xs">
                        {format(new Date(tx.date), 'MMM d, yyyy')}
                        <br />
                        <span className="text-muted-foreground">
                          {format(new Date(tx.date), 'HH:mm')}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {getTypeIcon(tx.type)}
                          <span className="text-xs capitalize">{t(`transactions.type.${tx.type}`)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate" title={tx.product_name}>
                        {tx.product_name}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{tx.sku || '-'}</TableCell>
                      <TableCell className="font-mono text-xs">{tx.asin || '-'}</TableCell>
                      <TableCell className="text-right font-medium">{tx.quantity}</TableCell>
                      <TableCell>{getDirectionBadge(tx.direction)}</TableCell>
                      <TableCell className="text-xs">
                        {tx.warehouse_from && <div>{t('transactions.table.from')}: {tx.warehouse_from}</div>}
                        {tx.warehouse_to && <div>{t('transactions.table.to')}: {tx.warehouse_to}</div>}
                        {!tx.warehouse_from && !tx.warehouse_to && '-'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {tx.reference_number && <div className="font-mono">{tx.reference_number}</div>}
                        {tx.external_order_number && (
                          <div className="text-muted-foreground">{t('transactions.table.external')}: {tx.external_order_number}</div>
                        )}
                        {!tx.reference_number && !tx.external_order_number && '-'}
                      </TableCell>
                      <TableCell>
                        {tx.marketplace_source ? (
                          <Badge variant="outline" className="text-xs">
                            {tx.marketplace_source}
                          </Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell>{getStatusBadge(tx.status)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {toNumber(tx.amount) > 0 ? `${toNumber(tx.amount).toFixed(2)} EGP` : '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Results Summary */}
      <div className="text-sm text-muted-foreground text-center">
        {t('transactions.summary.showing')} {filteredTransactions.length} {t('transactions.summary.of')} {unifiedTransactions.length} {t('transactions.summary.transactions')}
      </div>
    </div>
  );
}
