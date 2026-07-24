import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    ArrowLeft,
    Upload,
    Download,
    FileSpreadsheet,
    AlertCircle,
    CheckCircle2,
    XCircle,
    Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
    parseProductExcelFile,
    downloadProductImportTemplate,
    ImportResult,
    ProductImportRow,
} from '@/lib/excelUtils';
import { warehouseService as storeService, productService, inventoryService } from '@/lib/supabase-services';
import { toast } from 'sonner';

export default function ImportProductsPage() {
    const { storeId } = useParams<{ storeId: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [file, setFile] = useState<File | null>(null);
    const [importResult, setImportResult] = useState<ImportResult | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);

    // Fetch store details
    const { data: store, isLoading: isLoadingStore } = useQuery({
        queryKey: ['store', storeId],
        queryFn: () => storeService.getById(storeId!),
        enabled: !!storeId,
    });

    // Import mutation
    const importMutation = useMutation({
        mutationFn: async (data: ProductImportRow[]) => {
            if (!storeId) throw new Error('Store ID is required');

            setUploadProgress(0);
            const products = [];
            const storeProductItems = [];

            for (let i = 0; i < data.length; i++) {
                const row = data[i];

                // Create product object
                const product = {
                    name: row['Product Name'],
                    sku: row['SKU'],
                    asin: row['ASIN'] || null,
                    barcode: row['Barcode'] || null,
                    category: row['Category'] || null,
                    unit: row['Unit'] || 'piece',
                    cost_price: Number(row['Cost Price']),
                    selling_price: Number(row['Selling Price']),
                    min_stock_level: Number(row['Min Stock Level']) || 0,
                    description: row['Description'] || null,
                    is_active: true,
                };

                products.push(product);

                // Prepare store product link (quantity)
                storeProductItems.push({
                    quantity: Number(row['Quantity']),
                });

                // Update progress
                setUploadProgress(((i + 1) / data.length) * 50);
            }

            // Create products in bulk
            const createdProducts = await productService.bulkCreate(products);

            // Add products to store inventory
            for (let i = 0; i < createdProducts.length; i++) {
                const product = createdProducts[i];
                const qty = storeProductItems[i].quantity;
                if (qty > 0) {
                    await inventoryService.updateStock(product.id, storeId!, qty);
                }
            }

            setUploadProgress(75);

            setUploadProgress(100);

            return {
                productsCreated: createdProducts.length,
                storeProductsAdded: storeProductsData.length,
            };
        },
        onSuccess: (result) => {
            toast.success(`Successfully imported ${result.productsCreated} products!`);
            queryClient.invalidateQueries({ queryKey: ['inventory', storeId] });
            queryClient.invalidateQueries({ queryKey: ['store', storeId] });
            setTimeout(() => {
                navigate(`/stores/${storeId}`);
            }, 1500);
        },
        onError: (error: any) => {
            toast.error('Failed to import products: ' + error.message);
            setIsProcessing(false);
        },
    });

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = event.target.files?.[0];
        if (!selectedFile) return;

        // Validate file type
        if (!selectedFile.name.endsWith('.xlsx') && !selectedFile.name.endsWith('.xls')) {
            toast.error('Please select a valid Excel file (.xlsx or .xls)');
            return;
        }

        setFile(selectedFile);
        setIsProcessing(true);
        setImportResult(null);

        try {
            const result = await parseProductExcelFile(selectedFile);
            setImportResult(result);

            if (result.success) {
                toast.success(`File validated successfully! ${result.validRows} rows ready to import.`);
            } else {
                toast.warning(`File has ${result.errors.length} validation errors. Please review.`);
            }
        } catch (error: any) {
            toast.error('Failed to parse Excel file: ' + error.message);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleImport = () => {
        if (!importResult || !importResult.success || importResult.validRows === 0) {
            toast.error('No valid data to import');
            return;
        }

        setIsProcessing(true);

        // Filter only valid rows (rows without errors)
        const errorRows = new Set(importResult.errors.map(e => e.row));
        const validData = importResult.data.filter((_, index) => {
            const rowNumber = index + 2;
            return !errorRows.has(rowNumber);
        });

        importMutation.mutate(validData);
    };

    const handleClear = () => {
        setFile(null);
        setImportResult(null);
        setUploadProgress(0);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    if (isLoadingStore) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Loading...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-4xl mx-auto">
            {/* Page Header */}
            <div className="flex items-center gap-4">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigate(`/stores/${storeId}`)}
                >
                    <ArrowLeft className="w-5 h-5" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold">Import Products</h1>
                    <p className="text-muted-foreground">
                        Import products to {store?.name} from Excel file
                    </p>
                </div>
            </div>

            {/* Instructions Card */}
            <Card>
                <CardHeader>
                    <CardTitle>How to Import</CardTitle>
                    <CardDescription>Follow these steps to import products successfully</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-start gap-3">
                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-bold">
                            1
                        </div>
                        <div>
                            <p className="font-medium">Download the Excel template</p>
                            <p className="text-sm text-muted-foreground">
                                Use our template to ensure your data is formatted correctly
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3">
                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-bold">
                            2
                        </div>
                        <div>
                            <p className="font-medium">Fill in your product data</p>
                            <p className="text-sm text-muted-foreground">
                                Include: Product Name, SKU, ASIN, Cost Price, Selling Price, Quantity
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3">
                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-bold">
                            3
                        </div>
                        <div>
                            <p className="font-medium">Upload your Excel file</p>
                            <p className="text-sm text-muted-foreground">
                                We'll validate your data and show any errors before importing
                            </p>
                        </div>
                    </div>

                    <div className="pt-4">
                        <Button
                            variant="outline"
                            onClick={downloadProductImportTemplate}
                            className="w-full sm:w-auto"
                        >
                            <Download className="w-4 h-4 mr-2" />
                            Download Excel Template
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Upload Card */}
            <Card>
                <CardHeader>
                    <CardTitle>Upload Excel File</CardTitle>
                    <CardDescription>Select your prepared Excel file (.xlsx or .xls)</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                        <FileSpreadsheet className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                        <p className="text-sm font-medium mb-2">
                            {file ? file.name : 'No file selected'}
                        </p>
                        <p className="text-xs text-muted-foreground mb-4">
                            Supports .xlsx and .xls files
                        </p>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={handleFileSelect}
                            className="hidden"
                            disabled={isProcessing}
                        />
                        <div className="flex gap-2 justify-center">
                            <Button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isProcessing}
                            >
                                {isProcessing ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <Upload className="w-4 h-4 mr-2" />
                                        Select File
                                    </>
                                )}
                            </Button>
                            {file && (
                                <Button variant="outline" onClick={handleClear} disabled={isProcessing}>
                                    Clear
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Progress Bar */}
                    {uploadProgress > 0 && (
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span>Importing products...</span>
                                <span>{uploadProgress}%</span>
                            </div>
                            <Progress value={uploadProgress} />
                        </div>
                    )}

                    {/* Validation Results */}
                    {importResult && (
                        <div className="space-y-4">
                            {/* Summary */}
                            <div className="grid grid-cols-3 gap-4">
                                <div className="text-center p-4 bg-secondary/20 rounded-lg">
                                    <p className="text-2xl font-bold">{importResult.totalRows}</p>
                                    <p className="text-sm text-muted-foreground">Total Rows</p>
                                </div>
                                <div className="text-center p-4 bg-success/20 rounded-lg">
                                    <p className="text-2xl font-bold text-success">{importResult.validRows}</p>
                                    <p className="text-sm text-muted-foreground">Valid</p>
                                </div>
                                <div className="text-center p-4 bg-destructive/20 rounded-lg">
                                    <p className="text-2xl font-bold text-destructive">{importResult.invalidRows}</p>
                                    <p className="text-sm text-muted-foreground">Invalid</p>
                                </div>
                            </div>

                            {/* Success Alert */}
                            {importResult.success && (
                                <Alert>
                                    <CheckCircle2 className="h-4 w-4" />
                                    <AlertTitle>Ready to Import</AlertTitle>
                                    <AlertDescription>
                                        All {importResult.validRows} rows passed validation. Click "Import Products" to proceed.
                                    </AlertDescription>
                                </Alert>
                            )}

                            {/* Errors */}
                            {importResult.errors.length > 0 && (
                                <Alert variant="destructive">
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertTitle>Validation Errors Found</AlertTitle>
                                    <AlertDescription>
                                        <div className="mt-2 space-y-1 max-h-[200px] overflow-y-auto">
                                            {importResult.errors.slice(0, 20).map((error, index) => (
                                                <div key={index} className="text-sm">
                                                    <span className="font-medium">Row {error.row}:</span> {error.error} ({error.field})
                                                </div>
                                            ))}
                                            {importResult.errors.length > 20 && (
                                                <p className="text-sm font-medium mt-2">
                                                    ... and {importResult.errors.length - 20} more errors
                                                </p>
                                            )}
                                        </div>
                                    </AlertDescription>
                                </Alert>
                            )}

                            {/* Action Buttons */}
                            <div className="flex gap-2 justify-end">
                                {importResult.validRows > 0 && (
                                    <Button
                                        onClick={handleImport}
                                        disabled={isProcessing || importMutation.isPending}
                                    >
                                        {importMutation.isPending ? (
                                            <>
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                Importing...
                                            </>
                                        ) : (
                                            <>
                                                <Upload className="w-4 h-4 mr-2" />
                                                Import {importResult.validRows} Products
                                            </>
                                        )}
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
