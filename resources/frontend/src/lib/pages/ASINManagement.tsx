import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { useProducts } from '@/hooks/useProducts';
import { useASINs, useCreateASIN, useDeleteASIN, useUpdateASIN, useASINPriceHistory } from '@/hooks/useASINs';
import { useWarehouses } from '@/hooks/useWarehouses';
import { useInventory } from '@/hooks/useInventory';
import { useSalesOrders } from '@/hooks/useSales';
import { useReturns } from '@/hooks/useReturns';
import { productService, Product, ASIN, asinService } from '@/lib/supabase-services';
import { toast } from 'sonner';
import { BulkASINUploadDialog } from '@/components/asins/BulkASINUploadDialog';
import {
  Plus,
  Search,
  Filter,
  Download,
  Upload,
  Tag,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Trash2,
  Package,
  Edit2,
  Check,
  X,
  TrendingUp,
  TrendingDown,
  BarChart3,
  DollarSign,
  RotateCcw,
  ArrowUpDown,
  Clock,
  Image as ImageIcon,
  FileText,
  Activity,
  Warehouse,
  Star,
  AlertCircle,
  CheckCircle2,
  PauseCircle,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MarketSelect } from '@/components/shared/MarketSelect';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { format } from 'date-fns';

interface ProductWithASINs extends Product {
  asins: ASIN[];
}

interface ASINStats {
  totalStock: number;
  stockByWarehouse: { warehouseId: string; warehouseName: string; quantity: number }[];
  salesCount: number;
  returnsCount: number;
  revenue: number;
  healthScore: number;
}

type SortField = 'name' | 'asinCount' | 'stock' | 'sales' | 'revenue' | 'health';
type SortDirection = 'asc' | 'desc';

const statusConfig = {
  active: { label: 'Active', icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10' },
  paused: { label: 'Paused', icon: PauseCircle, color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
  inactive: { label: 'Inactive', icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
  pending: { label: 'Pending', icon: Clock, color: 'text-blue-500', bg: 'bg-blue-500/10' },
};

export default function ASINManagement() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [expandedASINs, setExpandedASINs] = useState<Set<string>>(new Set());
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [priceValue, setPriceValue] = useState('');
  const [newAsin, setNewAsin] = useState<{ productId: string; code: string; marketplace: string } | null>(null);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [priceHistoryDialog, setPriceHistoryDialog] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState('');
  const [uploadingImage, setUploadingImage] = useState<string | null>(null);
  const [isAddOfferDialogOpen, setIsAddOfferDialogOpen] = useState(false);
  const [singleOfferData, setSingleOfferData] = useState({
    asin_code: '',
    marketplace: 'Amazon.eg',
    display_price: '',
    masterSku: '',
  });

  const { data: products, isLoading: productsLoading, error: productsError } = useProducts();
  const { data: allAsins, isLoading: asinsLoading } = useASINs();
  const { data: warehouses } = useWarehouses();
  const { data: inventory } = useInventory();
  const { data: salesOrders } = useSalesOrders();
  const { data: returnsPayload } = useReturns();
  const returns = returnsPayload?.data ?? [];
  const createASIN = useCreateASIN();
  const deleteASIN = useDeleteASIN();
  const updateASIN = useUpdateASIN();
  const { data: priceHistory } = useASINPriceHistory(priceHistoryDialog);

  // Calculate ASIN statistics
  const calculateASINStats = (asin: ASIN): ASINStats => {
    const productInventory = inventory?.filter(i => i.product_id === asin.product_id) || [];
    const totalStock = productInventory.reduce((sum, i) => sum + (i.quantity || 0), 0);
    const stockByWarehouse = productInventory.map(i => ({
      warehouseId: i.warehouse_id,
      warehouseName: warehouses?.find(w => w.id === i.warehouse_id)?.name || 'Unknown',
      quantity: i.quantity || 0,
    }));

    // Calculate sales for this product
    const productSales = salesOrders?.flatMap(o => o.items || []).filter(i => i.product_id === asin.product_id) || [];
    const salesCount = productSales.reduce((sum, i) => sum + (i.quantity || 0), 0);
    const revenue = productSales.reduce((sum, i) => sum + (i.total_price || 0), 0);

    // Calculate returns for this product
    const productReturns = returns?.filter(r => {
      const order = salesOrders?.find(o => o.id === r.order_id);
      return order?.items?.some(i => i.product_id === asin.product_id);
    }) || [];
    const returnsCount = productReturns.length;

    // Calculate health score (0-100)
    let healthScore = 50; // Base score
    if (salesCount > 0) healthScore += Math.min(25, salesCount * 2);
    if (totalStock > 0) healthScore += 10;
    if (returnsCount > 0) healthScore -= Math.min(20, returnsCount * 5);
    if (asin.status === 'active') healthScore += 10;
    if (asin.status === 'inactive') healthScore -= 15;
    healthScore = Math.max(0, Math.min(100, healthScore));

    return { totalStock, stockByWarehouse, salesCount, returnsCount, revenue, healthScore };
  };

  // Combine products with their ASINs and stats
  const productsWithASINs: (ProductWithASINs & { stats: ASINStats })[] = useMemo(() => {
    return products?.map(product => {
      const productAsins = allAsins?.filter(a => a.product_id === product.id) || [];
      const combinedStats = productAsins.reduce<ASINStats>(
        (acc, asin) => {
          const stats = calculateASINStats(asin);
          return {
            totalStock: acc.totalStock + stats.totalStock,
            stockByWarehouse: [...acc.stockByWarehouse, ...stats.stockByWarehouse],
            salesCount: acc.salesCount + stats.salesCount,
            returnsCount: acc.returnsCount + stats.returnsCount,
            revenue: acc.revenue + stats.revenue,
            healthScore: productAsins.length > 0 ? (acc.healthScore + stats.healthScore) / 2 : 0,
          };
        },
        { totalStock: 0, stockByWarehouse: [], salesCount: 0, returnsCount: 0, revenue: 0, healthScore: 0 }
      );
      return { ...product, asins: productAsins, stats: combinedStats };
    }) || [];
  }, [products, allAsins, inventory, salesOrders, returns, warehouses]);

  // Filter and sort products
  const filteredProducts = useMemo(() => {
    let result = productsWithASINs.filter(p =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.asins.some(a => a.asin_code.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'asinCount':
          comparison = a.asins.length - b.asins.length;
          break;
        case 'stock':
          comparison = a.stats.totalStock - b.stats.totalStock;
          break;
        case 'sales':
          comparison = a.stats.salesCount - b.stats.salesCount;
          break;
        case 'revenue':
          comparison = a.stats.revenue - b.stats.revenue;
          break;
        case 'health':
          comparison = a.stats.healthScore - b.stats.healthScore;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [productsWithASINs, searchQuery, sortField, sortDirection]);

  const toggleExpanded = (productId: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const toggleASINExpanded = (asinId: string) => {
    setExpandedASINs(prev => {
      const next = new Set(prev);
      if (next.has(asinId)) next.delete(asinId);
      else next.add(asinId);
      return next;
    });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleAddASIN = async (productId: string) => {
    if (!newAsin || newAsin.productId !== productId || !newAsin.code) return;
    if (newAsin.code.length !== 10 || !/^[A-Z0-9]{10}$/.test(newAsin.code.toUpperCase())) {
      toast.error('ASIN must be 10 alphanumeric characters');
      return;
    }
    try {
      await createASIN.mutateAsync({
        product_id: productId,
        asin_code: newAsin.code.toUpperCase(),
        marketplace: newAsin.marketplace || null,
      });
      setNewAsin(null);
    } catch (error) {
      // Error handled by hook
    }
  };

  const handleDeleteASIN = async (asinId: string) => {
    await deleteASIN.mutateAsync(asinId);
  };

  const handlePriceEdit = async (asinId: string) => {
    const price = parseFloat(priceValue);
    if (isNaN(price) || price < 0) {
      toast.error('Invalid price');
      return;
    }
    try {
      await updateASIN.mutateAsync({ id: asinId, updates: { display_price: price } });
      toast.success('Price updated');
      setEditingPrice(null);
      setPriceValue('');
    } catch (error) {
      toast.error('Failed to update price');
    }
  };

  const handleStatusChange = async (asinId: string, status: string) => {
    try {
      await updateASIN.mutateAsync({ id: asinId, updates: { status } });
      toast.success('Status updated');
    } catch (error) {
      toast.error('Failed to update status');
    }
  };

  const handleNotesUpdate = async (asinId: string) => {
    try {
      await updateASIN.mutateAsync({ id: asinId, updates: { notes: notesValue } });
      toast.success('Notes updated');
      setEditingNotes(null);
      setNotesValue('');
    } catch (error) {
      toast.error('Failed to update notes');
    }
  };

  const handleImageUpload = async (asinId: string, file: File) => {
    setUploadingImage(asinId);
    try {
      // For now, create a local object URL as placeholder
      // TODO: Implement Laravel file upload endpoint
      const localUrl = URL.createObjectURL(file);
      await updateASIN.mutateAsync({ id: asinId, updates: { image_url: localUrl } });
      toast.success('Image uploaded');
    } catch (error) {
      toast.error('Failed to upload image');
    } finally {
      setUploadingImage(null);
    }
  };

  const handleExport = () => {
    if (!productsWithASINs.length) return;
    const exportData = productsWithASINs.flatMap(product =>
      product.asins.length > 0
        ? product.asins.map(asin => {
          const stats = calculateASINStats(asin);
          return {
            'Product Name': product.name,
            'SKU': product.sku,
            'ASIN': asin.asin_code,
            'Marketplace': asin.marketplace || '',
            'Display Price': asin.display_price || '',
            'Status': asin.status || 'active',
            'Total Stock': stats.totalStock,
            'Sales Count': stats.salesCount,
            'Returns': stats.returnsCount,
            'Revenue': stats.revenue,
            'Health Score': stats.healthScore,
            'Notes': asin.notes || '',
          };
        })
        : [{
          'Product Name': product.name,
          'SKU': product.sku,
          'ASIN': '',
          'Marketplace': '',
          'Display Price': '',
          'Status': '',
          'Total Stock': 0,
          'Sales Count': 0,
          'Returns': 0,
          'Revenue': 0,
          'Health Score': 0,
          'Notes': '',
        }]
    );
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ASINs');
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `asins-report-${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success('Exported successfully');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json<{ SKU: string; ASIN: string; Marketplace?: string; 'Display Price'?: number; Status?: string; Notes?: string }>(ws);

      let imported = 0;
      for (const row of jsonData) {
        if (!row.ASIN || !row.SKU) continue;
        const product = products?.find(p => p.sku === row.SKU);
        if (!product) continue;
        try {
          await createASIN.mutateAsync({
            product_id: product.id,
            asin_code: row.ASIN.toUpperCase(),
            marketplace: row.Marketplace || null,
            display_price: row['Display Price'] || null,
            status: row.Status || 'active',
            notes: row.Notes || null,
          });
          imported++;
        } catch {
          // Skip duplicates
        }
      }
      toast.success(`Imported ${imported} ASINs`);
      e.target.value = '';
    } catch (error) {
      toast.error('Failed to import file');
    }
  };

  const getHealthColor = (score: number) => {
    if (score >= 70) return 'text-green-500';
    if (score >= 40) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getHealthBg = (score: number) => {
    if (score >= 70) return 'bg-green-500';
    if (score >= 40) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const isLoading = productsLoading || asinsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading ASIN data...</p>
        </div>
      </div>
    );
  }

  if (productsError) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">ASIN Management</h1>
            <p className="text-muted-foreground">Manage product ASINs and detailed reports</p>
          </div>
        </div>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Connection Error</AlertTitle>
          <AlertDescription>Unable to load data. Please ensure you're logged in and try again.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">ASIN Management</h1>
          <p className="text-muted-foreground">Manage ASINs with detailed reports & analytics</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => navigate('/import/amazon')}>
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Bulk Upload Offers</span>
          </Button>
          <Button className="gap-2" onClick={() => setIsAddOfferDialogOpen(true)}>
            <Plus className="w-4 h-4" />
            Add Single Offer
          </Button>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg"><Tag className="w-5 h-5 text-primary" /></div>
            <div>
              <p className="text-2xl font-bold">{allAsins?.length || 0}</p>
              <p className="text-xs text-muted-foreground">Total ASINs</p>
            </div>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg"><CheckCircle2 className="w-5 h-5 text-green-500" /></div>
            <div>
              <p className="text-2xl font-bold">{allAsins?.filter(a => a.status === 'active' || !a.status).length || 0}</p>
              <p className="text-xs text-muted-foreground">Active</p>
            </div>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg"><DollarSign className="w-5 h-5 text-blue-500" /></div>
            <div>
              <p className="text-2xl font-bold">{productsWithASINs.reduce((sum, p) => sum + p.stats.revenue, 0).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Total Revenue</p>
            </div>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 rounded-lg"><BarChart3 className="w-5 h-5 text-purple-500" /></div>
            <div>
              <p className="text-2xl font-bold">{productsWithASINs.reduce((sum, p) => sum + p.stats.salesCount, 0)}</p>
              <p className="text-xs text-muted-foreground">Total Sales</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Filters Bar */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-xl p-4">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by product, SKU, or ASIN..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Select value={sortField} onValueChange={(v) => handleSort(v as SortField)}>
              <SelectTrigger className="w-36">
                <ArrowUpDown className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="asinCount">ASIN Count</SelectItem>
                <SelectItem value="stock">Stock</SelectItem>
                <SelectItem value="sales">Sales</SelectItem>
                <SelectItem value="revenue">Revenue</SelectItem>
                <SelectItem value="health">Health</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}>
              {sortDirection === 'asc' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            </Button>
            <Button variant="outline" className="gap-2" onClick={handleExport} disabled={!productsWithASINs.length}>
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export</span>
            </Button>
            <label>
              <Button variant="outline" className="gap-2" asChild>
                <span>
                  <Upload className="w-4 h-4" />
                  <span className="hidden sm:inline">Import</span>
                </span>
              </Button>
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
            </label>
          </div>
        </div>
      </motion.div>

      {/* Products with ASINs */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="space-y-3">
        {filteredProducts.length === 0 && (
          <div className="glass-card rounded-xl p-12 text-center text-muted-foreground">
            {searchQuery ? 'No products found matching your search.' : 'No products yet.'}
          </div>
        )}

        {filteredProducts.map((product, index) => {
          const isExpanded = expandedProducts.has(product.id);

          return (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.05 + index * 0.02 }}
              className="glass-card rounded-xl overflow-hidden"
            >
              {/* Product Header */}
              <div
                className="p-4 flex items-center gap-4 cursor-pointer hover:bg-secondary/20 transition-colors"
                onClick={() => toggleExpanded(product.id)}
              >
                {/* Product Image */}
                <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center shrink-0 overflow-hidden">
                  {product.images && product.images.length > 0 ? (
                    <img src={product.images[0]} alt={product.name} className="w-full h-full object-cover" />
                  ) : (
                    <Package className="w-6 h-6 text-muted-foreground" />
                  )}
                </div>

                {/* Product Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{product.name}</span>
                    <Badge variant="outline" className="font-mono text-xs shrink-0">{product.sku || '-'}</Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge variant="secondary" className="text-xs"><Tag className="w-3 h-3 mr-1" />{product.asins.length} ASIN{product.asins.length !== 1 ? 's' : ''}</Badge>
                    <Badge variant="outline" className="text-xs"><Warehouse className="w-3 h-3 mr-1" />{product.stats.totalStock} stock</Badge>
                    <Badge variant="outline" className="text-xs"><BarChart3 className="w-3 h-3 mr-1" />{product.stats.salesCount} sold</Badge>
                  </div>
                </div>

                {/* Health Score */}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="hidden sm:flex items-center gap-2 shrink-0">
                        <div className="w-16 h-2 bg-secondary rounded-full overflow-hidden">
                          <div className={`h-full ${getHealthBg(product.stats.healthScore)} transition-all`} style={{ width: `${product.stats.healthScore}%` }} />
                        </div>
                        <span className={`text-sm font-medium ${getHealthColor(product.stats.healthScore)}`}>{Math.round(product.stats.healthScore)}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>Health Score</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {/* Revenue */}
                <div className="hidden md:block text-right shrink-0">
                  <p className="font-semibold">{product.stats.revenue.toLocaleString()} EGP</p>
                  <p className="text-xs text-muted-foreground">Revenue</p>
                </div>

                {/* Expand Toggle */}
                <Button variant="ghost" size="icon" className="shrink-0">
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </Button>
              </div>

              {/* Expanded ASINs */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 pt-2 border-t border-border/50 space-y-3">
                      {product.asins.length === 0 && <p className="text-sm text-muted-foreground">No ASINs assigned</p>}

                      {product.asins.map((asin) => {
                        const stats = calculateASINStats(asin);
                        const isASINExpanded = expandedASINs.has(asin.id);
                        const statusInfo = statusConfig[asin.status as keyof typeof statusConfig] || statusConfig.active;
                        const StatusIcon = statusInfo.icon;

                        return (
                          <motion.div
                            key={asin.id}
                            layout
                            className="bg-secondary/30 rounded-lg p-3 space-y-3"
                          >
                            {/* ASIN Header Row */}
                            <div className="flex items-center gap-3 flex-wrap">
                              {/* ASIN Image */}
                              <div className="relative w-10 h-10 rounded-lg bg-secondary flex items-center justify-center shrink-0 overflow-hidden group">
                                {asin.image_url ? (
                                  <img src={asin.image_url} alt={asin.asin_code} className="w-full h-full object-cover" />
                                ) : (
                                  <ImageIcon className="w-5 h-5 text-muted-foreground" />
                                )}
                                <label className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity">
                                  {uploadingImage === asin.id ? (
                                    <Loader2 className="w-4 h-4 text-white animate-spin" />
                                  ) : (
                                    <Plus className="w-4 h-4 text-white" />
                                  )}
                                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleImageUpload(asin.id, e.target.files[0])} />
                                </label>
                              </div>

                              {/* ASIN Code & Marketplace */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono font-medium">{asin.asin_code}</span>
                                  {asin.marketplace && <Badge variant="outline" className="text-xs">{asin.marketplace}</Badge>}
                                  <Badge className={`${statusInfo.bg} ${statusInfo.color} text-xs gap-1`}>
                                    <StatusIcon className="w-3 h-3" />
                                    {statusInfo.label}
                                  </Badge>
                                </div>
                              </div>

                              {/* Display Price */}
                              <div className="shrink-0">
                                {editingPrice === asin.id ? (
                                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                    <Input
                                      type="number"
                                      value={priceValue}
                                      onChange={e => setPriceValue(e.target.value)}
                                      className="w-24 h-8 text-right"
                                      placeholder="0"
                                      autoFocus
                                    />
                                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handlePriceEdit(asin.id)}>
                                      <Check className="w-4 h-4 text-green-500" />
                                    </Button>
                                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingPrice(null); setPriceValue(''); }}>
                                      <X className="w-4 h-4 text-red-500" />
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    <span className="font-semibold">{asin.display_price ? `${Number(asin.display_price).toLocaleString()} EGP` : '-'}</span>
                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setEditingPrice(asin.id); setPriceValue(asin.display_price?.toString() || ''); }}>
                                      <Edit2 className="w-3 h-3" />
                                    </Button>
                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setPriceHistoryDialog(asin.id); }}>
                                      <Clock className="w-3 h-3" />
                                    </Button>
                                  </div>
                                )}
                              </div>

                              {/* Health Score */}
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <Activity className={`w-4 h-4 ${getHealthColor(stats.healthScore)}`} />
                                      <span className={`text-sm font-medium ${getHealthColor(stats.healthScore)}`}>{Math.round(stats.healthScore)}</span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>ASIN Health Score</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>

                              {/* Expand/Actions */}
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggleASINExpanded(asin.id)}>
                                {isASINExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeleteASIN(asin.id)}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>

                            {/* Expanded ASIN Details */}
                            <AnimatePresence>
                              {isASINExpanded && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden"
                                >
                                  <div className="pt-3 border-t border-border/30 space-y-3">
                                    {/* Stats Grid */}
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                      <div className="bg-background/50 rounded-lg p-2">
                                        <p className="text-xs text-muted-foreground">Total Stock</p>
                                        <p className="text-lg font-semibold">{stats.totalStock}</p>
                                      </div>
                                      <div className="bg-background/50 rounded-lg p-2">
                                        <p className="text-xs text-muted-foreground">Sales Count</p>
                                        <p className="text-lg font-semibold">{stats.salesCount}</p>
                                      </div>
                                      <div className="bg-background/50 rounded-lg p-2">
                                        <p className="text-xs text-muted-foreground">Returns</p>
                                        <p className="text-lg font-semibold">{stats.returnsCount}</p>
                                      </div>
                                      <div className="bg-background/50 rounded-lg p-2">
                                        <p className="text-xs text-muted-foreground">Revenue</p>
                                        <p className="text-lg font-semibold">{stats.revenue.toLocaleString()}</p>
                                      </div>
                                    </div>

                                    {/* Stock by Warehouse */}
                                    {stats.stockByWarehouse.length > 0 && (
                                      <div>
                                        <p className="text-xs text-muted-foreground mb-2">Stock by Warehouse</p>
                                        <div className="flex flex-wrap gap-2">
                                          {stats.stockByWarehouse.map((w, i) => (
                                            <Badge key={i} variant="outline" className="text-xs">
                                              <Warehouse className="w-3 h-3 mr-1" />
                                              {w.warehouseName}: {w.quantity}
                                            </Badge>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {/* Status & Notes Row */}
                                    <div className="flex flex-col sm:flex-row gap-3">
                                      <div className="flex-1">
                                        <p className="text-xs text-muted-foreground mb-1">Status</p>
                                        <Select value={asin.status || 'active'} onValueChange={(v) => handleStatusChange(asin.id, v)}>
                                          <SelectTrigger className="w-full sm:w-40 h-8">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="active">Active</SelectItem>
                                            <SelectItem value="paused">Paused</SelectItem>
                                            <SelectItem value="inactive">Inactive</SelectItem>
                                            <SelectItem value="pending">Pending</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <div className="flex-[2]">
                                        <p className="text-xs text-muted-foreground mb-1">Notes</p>
                                        {editingNotes === asin.id ? (
                                          <div className="flex gap-2">
                                            <Textarea
                                              value={notesValue}
                                              onChange={(e) => setNotesValue(e.target.value)}
                                              className="flex-1 min-h-[60px]"
                                              placeholder="Add notes..."
                                            />
                                            <div className="flex flex-col gap-1">
                                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleNotesUpdate(asin.id)}>
                                                <Check className="w-4 h-4 text-green-500" />
                                              </Button>
                                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingNotes(null); setNotesValue(''); }}>
                                                <X className="w-4 h-4 text-red-500" />
                                              </Button>
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="flex items-start gap-2 bg-background/50 rounded-lg p-2 min-h-[40px]">
                                            <p className="flex-1 text-sm">{asin.notes || <span className="text-muted-foreground">No notes</span>}</p>
                                            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => { setEditingNotes(asin.id); setNotesValue(asin.notes || ''); }}>
                                              <Edit2 className="w-3 h-3" />
                                            </Button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </motion.div>
                        );
                      })}

                      {/* Add ASIN Form */}
                      {newAsin?.productId === product.id ? (
                        <div className="flex gap-2 items-center flex-wrap">
                          <Input
                            placeholder="B0XXXXXXXXX"
                            maxLength={10}
                            value={newAsin.code}
                            onChange={e => setNewAsin({ ...newAsin, code: e.target.value.toUpperCase() })}
                            className="w-32 font-mono"
                          />
                          <MarketSelect
                            value={newAsin.marketplace}
                            onValueChange={v => setNewAsin({ ...newAsin, marketplace: v })}
                            placeholder="Market"
                            className="w-28"
                          />
                          <Button size="sm" onClick={() => handleAddASIN(product.id)} disabled={createASIN.isPending}>
                            {createASIN.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setNewAsin(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => setNewAsin({ productId: product.id, code: '', marketplace: '' })}>
                          <Plus className="w-4 h-4" />
                          Add ASIN
                        </Button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </motion.div>

      {/* Price History Dialog */}
      <Dialog open={!!priceHistoryDialog} onOpenChange={() => setPriceHistoryDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Price History
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {priceHistory?.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No price changes recorded</p>}
            {priceHistory?.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between p-2 bg-secondary/30 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{entry.old_price ?? '-'}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-medium">{entry.new_price}</span>
                </div>
                <span className="text-xs text-muted-foreground">{format(new Date(entry.changed_at), 'MMM d, yyyy HH:mm')}</span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Single Offer Dialog */}
      <Dialog open={isAddOfferDialogOpen} onOpenChange={setIsAddOfferDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Amazon Offer</DialogTitle>
            <DialogDescription>
              Create a new listing and link it to a Master Product using SKU or Barcode.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>ASIN / Listing Code</Label>
                <Input
                  placeholder="B0XXXXXXXX"
                  value={singleOfferData.asin_code}
                  onChange={e => setSingleOfferData({ ...singleOfferData, asin_code: e.target.value.toUpperCase() })}
                />
              </div>
              <div className="space-y-2">
                <Label>Marketplace</Label>
                <MarketSelect
                  value={singleOfferData.marketplace}
                  onValueChange={v => setSingleOfferData({ ...singleOfferData, marketplace: v })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Link to Master SKU / Barcode</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Enter Master SKU or Barcode to link..."
                  className="pl-9"
                  value={singleOfferData.masterSku}
                  onChange={e => setSingleOfferData({ ...singleOfferData, masterSku: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Selling Price (Optional)</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={singleOfferData.display_price}
                onChange={e => setSingleOfferData({ ...singleOfferData, display_price: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsAddOfferDialogOpen(false)}>Cancel</Button>
            <Button onClick={async () => {
              if (!singleOfferData.asin_code || !singleOfferData.masterSku) {
                toast.error('Please fill ASIN and Master SKU');
                return;
              }
              const product = products?.find(p => p.sku === singleOfferData.masterSku || p.barcode === singleOfferData.masterSku);
              if (!product) {
                toast.error('Master Product not found');
                return;
              }
              try {
                await createASIN.mutateAsync({
                  product_id: product.id,
                  asin_code: singleOfferData.asin_code.toUpperCase(),
                  marketplace: singleOfferData.marketplace,
                  display_price: singleOfferData.display_price ? parseFloat(singleOfferData.display_price) : null,
                  status: 'active'
                });
                setIsAddOfferDialogOpen(false);
                setSingleOfferData({ asin_code: '', marketplace: 'Amazon.eg', display_price: '', masterSku: '' });
                toast.success('Offer created and linked successfully');
              } catch (e) {
                // Error handled by hook
              }
            }}>
              Link & Save Offer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}