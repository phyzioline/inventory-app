import { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { useBulkCreateProducts } from '@/hooks/useProducts';
import { useCategories, useCreateCategory } from '@/hooks/useCategories';
import { useASINs, useCreateASIN } from '@/hooks/useASINs';
import { parseProductsFromExcel, validateImportData, downloadImportTemplate, ProductImportData } from '@/lib/excelProductUtils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ImportProductsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ImportProductsDialog({ isOpen, onClose }: ImportProductsDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ProductImportData[] | null>(null);
  const [errors, setErrors] = useState<{ row: number; message: string }[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bulkCreate = useBulkCreateProducts();
  const { data: categories } = useCategories();
  const createCategory = useCreateCategory();
  const { data: existingAsins } = useASINs();
  const createASIN = useCreateASIN();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setErrors([]);

    try {
      const products = await parseProductsFromExcel(selectedFile);
      const existingAsinCodes = existingAsins?.map(a => a.asin_code) || [];
      const { valid, errors: validationErrors } = validateImportData(products, existingAsinCodes);
      
      setParsedData(valid);
      setErrors(validationErrors);
    } catch (error) {
      toast.error('Failed to parse Excel file');
      setParsedData(null);
    }
  };

  const handleImport = async () => {
    if (!parsedData || parsedData.length === 0) return;

    setIsImporting(true);
    try {
      // Create missing categories first
      const categoryMap = new Map<string, string>();
      for (const cat of categories || []) {
        categoryMap.set(cat.name.toLowerCase(), cat.id);
      }

      for (const product of parsedData) {
        if (product.category_name && !categoryMap.has(product.category_name.toLowerCase())) {
          const newCat = await createCategory.mutateAsync({ name: product.category_name });
          categoryMap.set(product.category_name.toLowerCase(), newCat.id);
        }
      }

      // Prepare products for bulk insert
      const productsToCreate = parsedData.map(p => ({
        name: p.name,
        category_id: p.category_name ? categoryMap.get(p.category_name.toLowerCase()) || null : null,
        selling_price: p.selling_price || null,
        last_purchase_price: p.last_purchase_price || null,
        avg_purchase_price: p.last_purchase_price || null,
        min_stock: 0,
        max_stock: null,
        lowest_price: null,
        highest_price: null,
        images: [],
      }));

      const createdProducts = await bulkCreate.mutateAsync(productsToCreate);

      // Create ASINs for products
      for (let i = 0; i < parsedData.length; i++) {
        const product = parsedData[i];
        if (product.asins && createdProducts[i]) {
          for (const asin of product.asins) {
            await createASIN.mutateAsync({
              product_id: createdProducts[i].id,
              asin_code: asin,
              marketplace: null,
            });
          }
        }
      }

      toast.success(`Successfully imported ${createdProducts.length} products`);
      handleClose();
    } catch (error: any) {
      toast.error(error.message || 'Failed to import products');
    } finally {
      setIsImporting(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setParsedData(null);
    setErrors([]);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" />
            Import Products
          </DialogTitle>
          <DialogDescription>
            Upload an Excel file (.xlsx) with your products. Required columns: Name. Optional: Category, Price, Cost, ASIN.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-xs h-8"
            onClick={downloadImportTemplate}
          >
            <Download className="w-3 h-3" />
            Download Excel Template
          </Button>

          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
          >
            <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              {file ? file.name : 'Click to select Excel file'}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {parsedData && parsedData.length > 0 && (
            <Alert>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <AlertDescription>
                Found {parsedData.length} valid products ready to import.
              </AlertDescription>
            </Alert>
          )}

          {errors.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-destructive">Validation Errors:</p>
              <ScrollArea className="h-32 rounded border border-destructive/20 p-2">
                {errors.map((error, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-destructive">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>Row {error.row}: {error.message}</span>
                  </div>
                ))}
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isImporting}>
            Cancel
          </Button>
          <Button 
            onClick={handleImport} 
            disabled={!parsedData || parsedData.length === 0 || isImporting}
          >
            {isImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Import {parsedData?.length || 0} Products
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
