import { useState } from 'react';
import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { useProducts, useDeleteProduct } from '@/hooks/useProducts';
import { AddProductModal } from '@/components/products/AddProductModal';
import { ImportProductsDialog } from '@/components/products/ImportProductsDialog';
import { ProductActionsMenu } from '@/components/products/ProductActionsMenu';
import { exportProductsToExcel } from '@/lib/excelProductUtils';
import {
  Plus,
  Search,
  Filter,
  Download,
  Upload,
  Package,
  Loader2,
  AlertTriangle,
  Image as ImageIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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

export default function Products() {
  const { t } = useLanguage();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteProductId, setDeleteProductId] = useState<string | null>(null);

  const { data: products, isLoading, error } = useProducts();
  const deleteProduct = useDeleteProduct();

  const filteredProducts = products?.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.sku?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDelete = () => {
    if (deleteProductId) {
      deleteProduct.mutate(deleteProductId, {
        onSuccess: () => setDeleteProductId(null),
      });
    }
  };

  const handleExport = () => {
    if (products && products.length > 0) {
      exportProductsToExcel(products, `products-${new Date().toISOString().split('T')[0]}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading products...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{t('products.title')}</h1>
            <p className="text-muted-foreground">{t('products.description')}</p>
          </div>
        </div>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Connection Error</AlertTitle>
          <AlertDescription>
            Unable to load products. Please ensure you're logged in and try again.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AddProductModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={() => setIsAddModalOpen(false)}
      />

      <ImportProductsDialog
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteProductId} onOpenChange={() => setDeleteProductId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Product</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this product? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('products.title')}</h1>
          <p className="text-muted-foreground">{t('products.description')}</p>
        </div>
        <Button className="gap-2" onClick={() => setIsAddModalOpen(true)}>
          <Plus className="w-4 h-4" />
          {t('products.addNew')}
        </Button>
      </div>

      {/* Filters Bar */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-xl p-4"
      >
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" className="gap-2">
              <Filter className="w-4 h-4" />
              {t('common.filter')}
            </Button>
            <Button variant="outline" className="gap-2" onClick={handleExport} disabled={!products?.length}>
              <Download className="w-4 h-4" />
              {t('common.export')}
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => setIsImportOpen(true)}>
              <Upload className="w-4 h-4" />
              {t('common.import')}
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Products Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card rounded-xl overflow-hidden"
      >
        {filteredProducts && filteredProducts.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            {searchQuery ? 'No products found matching your search.' : 'No products yet. Add your first product to get started.'}
          </div>
        )}

        {filteredProducts && filteredProducts.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left p-4 font-medium whitespace-nowrap w-12">
                    <input type="checkbox" className="rounded border-border" />
                  </th>
                  <th className="text-left p-4 font-medium whitespace-nowrap">{t('products.name')}</th>
                  <th className="text-left p-4 font-medium whitespace-nowrap">SKU</th>
                  <th className="text-left p-4 font-medium whitespace-nowrap">{t('products.category')}</th>
                  <th className="text-right p-4 font-medium whitespace-nowrap">Lowest Price</th>
                  <th className="text-right p-4 font-medium whitespace-nowrap">Highest Price</th>
                  <th className="text-right p-4 font-medium whitespace-nowrap">Avg Cost</th>
                  <th className="text-right p-4 font-medium whitespace-nowrap">Selling Price</th>
                  <th className="text-right p-4 font-medium whitespace-nowrap">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product, index) => (
                  <motion.tr
                    key={product.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 + index * 0.02 }}
                    className="group border-b border-border/50 hover:bg-secondary/20 transition-colors"
                  >
                    <td className="p-4">
                      <input type="checkbox" className="rounded border-border" />
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-14 h-14 rounded-lg bg-secondary flex items-center justify-center shrink-0 overflow-hidden">
                          {product.images && product.images.length > 0 ? (
                            <img
                              src={product.images[0]}
                              alt={product.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Package className="w-6 h-6 text-muted-foreground" />
                          )}
                        </div>
                        <span className="font-medium truncate">{product.name}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <Badge variant="outline" className="font-mono text-xs">
                        {product.sku || '-'}
                      </Badge>
                    </td>
                    <td className="p-4 text-muted-foreground">{typeof product.category?.name === 'string' ? product.category.name : '-'}</td>
                    <td className="p-4 text-right text-green-600 dark:text-green-400 font-medium">
                      {product.lowest_price ? `${Number(product.lowest_price).toLocaleString()} EGP` : '-'}
                    </td>
                    <td className="p-4 text-right text-red-600 dark:text-red-400 font-medium">
                      {product.highest_price ? `${Number(product.highest_price).toLocaleString()} EGP` : '-'}
                    </td>
                    <td className="p-4 text-right text-muted-foreground">
                      {product.avg_purchase_price ? `${Number(product.avg_purchase_price).toLocaleString()} EGP` : '-'}
                    </td>
                    <td className="p-4 text-right font-medium">
                      {product.selling_price ? `${Number(product.selling_price).toLocaleString()} EGP` : '-'}
                    </td>
                    <td className="p-4">
                      <div className="flex justify-end">
                        <ProductActionsMenu
                          product={product}
                          onDelete={setDeleteProductId}
                        />
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {filteredProducts && filteredProducts.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-sm text-muted-foreground">
              {t('common.showing')} 1 {t('common.to')} {filteredProducts.length} {t('common.of')} {filteredProducts.length} {t('common.results')}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled>{t('common.previous')}</Button>
              <Button variant="outline" size="sm" disabled>{t('common.next')}</Button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
