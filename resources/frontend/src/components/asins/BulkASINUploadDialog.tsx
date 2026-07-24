import { useState } from 'react';
import { Upload, Download, FileSpreadsheet, Loader2, Check, X, AlertCircle, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { downloadChannelMappingTemplate } from '@/lib/excelUtils';

interface BulkUploadResult {
    summary: {
        total_rows: number;
        successful: number;
        errors: number;
        duplicates: number;
        not_found: number;
    };
    results: {
        success: Array<{ row: number; asin: any; product: any }>;
        errors: Array<{ row: number; data: any; reason: string }>;
        duplicates: Array<{ row: number; data: any; existing: any }>;
        not_found: Array<{ row: number; data: any; reason: string }>;
    };
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void;
}

export function BulkASINUploadDialog({ open, onOpenChange, onSuccess }: Props) {
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [result, setResult] = useState<BulkUploadResult | null>(null);

    const handleDownloadTemplate = () => {
        try {
            downloadChannelMappingTemplate();
            toast.success('Template downloaded');
        } catch (error) {
            toast.error('Failed to download template');
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            if (!selectedFile.name.match(/\.(xlsx|xls|csv)$/i)) {
                toast.error('Please select an Excel or CSV file');
                return;
            }
            setFile(selectedFile);
            setResult(null);
        }
    };

    const handleUpload = async () => {
        if (!file) {
            toast.error('Please select a file');
            return;
        }

        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/api/inventory/asins/bulk-upload', {
                method: 'POST',
                body: formData,
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                },
                credentials: 'include',
            });

            const data = await response.json();
            setResult(data);

            if (data.summary.successful > 0) {
                toast.success(`Successfully imported ${data.summary.successful} ASINs`);
                onSuccess?.();
            }

            if (data.summary.errors > 0) {
                toast.error(`${data.summary.errors} rows had errors`);
            }

            if (data.summary.duplicates > 0) {
                toast.warning(`${data.summary.duplicates} duplicates were skipped`);
            }

            if (data.summary.not_found > 0) {
                toast.warning(`${data.summary.not_found} products not found`);
            }
        } catch (error) {
            toast.error('Failed to upload file');
            console.error(error);
        } finally {
            setUploading(false);
        }
    };

    const handleClose = () => {
        setFile(null);
        setResult(null);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Bulk Upload ASINs</DialogTitle>
                </DialogHeader>

                <div className="space-y-6">
                    {/* Template Download */}
                    <Alert>
                        <FileSpreadsheet className="h-4 w-4" />
                        <AlertDescription className="flex items-center justify-between">
                            <div>
                                <p className="font-medium mb-1">Download the template and fill in your ASIN data</p>
                                <p className="text-sm text-muted-foreground">System will auto-link ASINs to products by SKU</p>
                            </div>
                            <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
                                <Download className="w-4 h-4 mr-2" />
                                Download Template
                            </Button>
                        </AlertDescription>
                    </Alert>

                    {/* File Upload */}
                    {!result && (
                        <div className="border-2 border-dashed rounded-lg p-8 text-center">
                            <input
                                type="file"
                                id="file-upload-asin"
                                accept=".xlsx,.xls,.csv"
                                onChange={handleFileChange}
                                className="hidden"
                            />
                            <label htmlFor="file-upload-asin" className="cursor-pointer">
                                <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                                <p className="text-lg font-medium mb-2">
                                    {file ? file.name : 'Click to select file'}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    Supports Excel (.xlsx, .xls) and CSV files
                                </p>
                            </label>
                        </div>
                    )}

                    {/* Upload Progress */}
                    {uploading && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Uploading and auto-linking ASINs...</span>
                            </div>
                            <Progress value={50} className="w-full" />
                        </div>
                    )}

                    {/* Results */}
                    {result && (
                        <div className="space-y-4">
                            {/* Summary Cards */}
                            <div className="grid grid-cols-5 gap-3">
                                <div className="bg-secondary rounded-lg p-3">
                                    <p className="text-xs text-muted-foreground">Total Rows</p>
                                    <p className="text-xl font-bold">{result.summary.total_rows}</p>
                                </div>
                                <div className="bg-green-500/10 rounded-lg p-3">
                                    <p className="text-xs text-green-700 dark:text-green-400">Successful</p>
                                    <p className="text-xl font-bold text-green-700 dark:text-green-400">{result.summary.successful}</p>
                                </div>
                                <div className="bg-red-500/10 rounded-lg p-3">
                                    <p className="text-xs text-red-700 dark:text-red-400">Errors</p>
                                    <p className="text-xl font-bold text-red-700 dark:text-red-400">{result.summary.errors}</p>
                                </div>
                                <div className="bg-yellow-500/10 rounded-lg p-3">
                                    <p className="text-xs text-yellow-700 dark:text-yellow-400">Duplicates</p>
                                    <p className="text-xl font-bold text-yellow-700 dark:text-yellow-400">{result.summary.duplicates}</p>
                                </div>
                                <div className="bg-orange-500/10 rounded-lg p-3">
                                    <p className="text-xs text-orange-700 dark:text-orange-400">Not Found</p>
                                    <p className="text-xl font-bold text-orange-700 dark:text-orange-400">{result.summary.not_found}</p>
                                </div>
                            </div>

                            {/* Success List */}
                            {result.results.success.length > 0 && (
                                <div>
                                    <h3 className="font-medium mb-2 flex items-center gap-2">
                                        <Check className="w-4 h-4 text-green-500" />
                                        Successfully Imported ({result.results.success.length})
                                    </h3>
                                    <div className="max-h-40 overflow-y-auto border rounded-lg">
                                        <table className="w-full text-sm">
                                            <thead className="bg-secondary sticky top-0">
                                                <tr>
                                                    <th className="text-left p-2">Row</th>
                                                    <th className="text-left p-2">ASIN</th>
                                                    <th className="text-left p-2">Product</th>
                                                    <th className="text-left p-2">Marketplace</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {result.results.success.slice(0, 10).map((item) => (
                                                    <tr key={item.row} className="border-t">
                                                        <td className="p-2">{item.row}</td>
                                                        <td className="p-2 font-mono">{item.asin.asin_code}</td>
                                                        <td className="p-2">{item.product.name}</td>
                                                        <td className="p-2">{item.asin.marketplace || '-'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        {result.results.success.length > 10 && (
                                            <p className="text-xs text-center p-2 text-muted-foreground">
                                                ...and {result.results.success.length - 10} more
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Not Found List */}
                            {result.results.not_found.length > 0 && (
                                <div>
                                    <h3 className="font-medium mb-2 flex items-center gap-2">
                                        <AlertTriangle className="w-4 h-4 text-orange-500" />
                                        Products Not Found ({result.results.not_found.length})
                                    </h3>
                                    <div className="max-h-40 overflow-y-auto border rounded-lg">
                                        <table className="w-full text-sm">
                                            <thead className="bg-secondary sticky top-0">
                                                <tr>
                                                    <th className="text-left p-2">Row</th>
                                                    <th className="text-left p-2">SKU</th>
                                                    <th className="text-left p-2">ASIN</th>
                                                    <th className="text-left p-2">Issue</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {result.results.not_found.map((item) => (
                                                    <tr key={item.row} className="border-t">
                                                        <td className="p-2">{item.row}</td>
                                                        <td className="p-2">{item.data.product_sku}</td>
                                                        <td className="p-2 font-mono">{item.data.asin_code}</td>
                                                        <td className="p-2 text-orange-600">{item.reason}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Errors List */}
                            {result.results.errors.length > 0 && (
                                <div>
                                    <h3 className="font-medium mb-2 flex items-center gap-2">
                                        <X className="w-4 h-4 text-red-500" />
                                        Errors ({result.results.errors.length})
                                    </h3>
                                    <div className="max-h-40 overflow-y-auto border rounded-lg">
                                        <table className="w-full text-sm">
                                            <thead className="bg-secondary sticky top-0">
                                                <tr>
                                                    <th className="text-left p-2">Row</th>
                                                    <th className="text-left p-2">ASIN</th>
                                                    <th className="text-left p-2">Reason</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {result.results.errors.map((item) => (
                                                    <tr key={item.row} className="border-t">
                                                        <td className="p-2">{item.row}</td>
                                                        <td className="p-2 font-mono">{item.data.asin_code || '-'}</td>
                                                        <td className="p-2 text-red-600">{item.reason}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Duplicates List */}
                            {result.results.duplicates.length > 0 && (
                                <div>
                                    <h3 className="font-medium mb-2 flex items-center gap-2">
                                        <AlertCircle className="w-4 h-4 text-yellow-500" />
                                        Duplicates Skipped ({result.results.duplicates.length})
                                    </h3>
                                    <div className="max-h-40 overflow-y-auto border rounded-lg">
                                        <table className="w-full text-sm">
                                            <thead className="bg-secondary sticky top-0">
                                                <tr>
                                                    <th className="text-left p-2">Row</th>
                                                    <th className="text-left p-2">ASIN</th>
                                                    <th className="text-left p-2">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {result.results.duplicates.map((item) => (
                                                    <tr key={item.row} className="border-t">
                                                        <td className="p-2">{item.row}</td>
                                                        <td className="p-2 font-mono">{item.data.asin_code}</td>
                                                        <td className="p-2 text-yellow-600">Already exists</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    {!result ? (
                        <>
                            <Button variant="outline" onClick={handleClose}>Cancel</Button>
                            <Button onClick={handleUpload} disabled={!file || uploading}>
                                {uploading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Uploading...
                                    </>
                                ) : (
                                    <>
                                        <Upload className="w-4 h-4 mr-2" />
                                        Upload & Auto-Link
                                    </>
                                )}
                            </Button>
                        </>
                    ) : (
                        <Button onClick={handleClose}>Close</Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
