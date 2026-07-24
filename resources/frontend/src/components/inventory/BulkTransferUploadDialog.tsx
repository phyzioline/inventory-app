import { useState, useRef } from 'react';
import { Upload, Download, FileSpreadsheet, Loader2, Check, X, AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { read, utils } from 'xlsx';
import api from '@/lib/api';
import { toast } from 'sonner';

interface BulkTransferUploadDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

interface TransferRow {
    sku: string;
    quantity: number;
    source_warehouse: string;
    destination_warehouse: string;
    notes?: string;
    status?: 'pending' | 'valid' | 'error';
    message?: string;
    productId?: string;
    sourceId?: string;
    destinationId?: string;
}

export function BulkTransferUploadDialog({ open, onOpenChange, onSuccess }: BulkTransferUploadDialogProps) {
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [previewData, setPreviewData] = useState<TransferRow[]>([]);
    const [validationErrors, setValidationErrors] = useState<string[]>([]);
    const [uploadResult, setUploadResult] = useState<any>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const downloadTemplate = () => {
        const headers = ['SKU', 'Quantity', 'Source Warehouse Name', 'Destination Warehouse Name', 'Notes'];
        const data = [
            ['SKU123', 10, 'Main Warehouse', 'Store A', 'Restock'],
            ['SKU456', 5, 'Main Warehouse', 'Store B', 'Urgent'],
        ];

        const ws = utils.aoa_to_sheet([headers, ...data]);
        const wb = utils.book_new();
        utils.book_append_sheet(wb, ws, "Transfers");

        // Generate buffer and download
        const wbout = read(utils.write(wb, { type: 'base64', bookType: 'xlsx' }), { type: 'base64' });
        // In a real app we'd use file-saver, but here we can try a simple anchor trick or just use the backend endpoint if available
        // Since we don't have file-saver installed in this environment, let's use a backend endpoint if we created one, 
        // or just rely on the user manually creating it for now if backend endpoint is missing.
        // Actually, let's just create a CSV string for simplicity if XLSX write fails in browser

        const csvContent = headers.join(',') + '\n' + data.map(row => row.join(',')).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'transfer_template.csv'; // CSV is safer without libraries
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    };

    const processFile = async (file: File) => {
        try {
            const data = await file.arrayBuffer();
            const workbook = read(data);
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = utils.sheet_to_json(worksheet, { header: 1 });

            if (jsonData.length < 2) {
                toast.error('File appears to be empty or missing headers');
                return;
            }

            const headers = jsonData[0] as string[];
            // Simple mapping based on index or name
            const rows = jsonData.slice(1).map((row: any) => ({
                sku: row[0] || '',
                quantity: Number(row[1] || 0),
                source_warehouse: row[2] || '',
                destination_warehouse: row[3] || '',
                notes: row[4] || '',
                status: 'pending'
            })).filter((r: TransferRow) => r.sku && r.quantity > 0);

            setPreviewData(rows as TransferRow[]);
            setValidationErrors([]);
            setUploadResult(null);
        } catch (error) {
            console.error('Error processing file:', error);
            toast.error('Failed to process file. Please ensure it is a valid Excel or CSV file.');
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            processFile(e.target.files[0]);
        }
    };

    const handleUpload = async () => {
        if (!file) return;

        setIsUploading(true);
        setUploadProgress(10);

        const formData = new FormData();
        formData.append('file', file);

        try {
            // 1. Upload for validation
            setUploadProgress(30);
            const response = await api.post('/inventory/transfers/bulk-upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' } // api.post usually handles this but explicit is good for file
            });

            setUploadProgress(60);

            if (response && response.preview) {
                setUploadResult(response);
                setPreviewData(response.preview); // Update preview with backend validation results

                if (response.valid_count === 0) {
                    toast.error('No valid transfers found in file');
                } else {
                    toast.success(`Processed ${response.total_count} rows. ${response.valid_count} valid.`);
                }
            }

            setUploadProgress(100);
        } catch (error: any) {
            console.error('Upload failed:', error);
            toast.error(error.response?.data?.message || 'Upload failed');
            setValidationErrors([error.message]);
        } finally {
            setIsUploading(false);
        }
    };

    const handleExecute = async () => {
        if (!uploadResult || !uploadResult.upload_id) return;

        setIsUploading(true);
        try {
            await api.post('/inventory/transfers/execute', {
                upload_id: uploadResult.upload_id
            });
            toast.success('Bulk transfer executed successfully');
            onSuccess();
            onOpenChange(false);
        } catch (error: any) {
            toast.error(error.response?.data?.message || 'Execution failed');
        } finally {
            setIsUploading(false);
        }
    };

    const validRows = previewData.filter(r => r.status === 'valid');
    const errorRows = previewData.filter(r => r.status === 'error');

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Bulk Stock Transfer</DialogTitle>
                    <DialogDescription>
                        Upload a spreadsheet to transfer stock between warehouses in bulk.
                    </DialogDescription>
                </DialogHeader>

                {!uploadResult ? (
                    <div className="space-y-6">
                        <div className="border-2 border-dashed rounded-lg p-8 text-center space-y-4">
                            <div className="flex justify-center">
                                <div className="p-4 bg-primary/10 rounded-full">
                                    <Upload className="w-8 h-8 text-primary" />
                                </div>
                            </div>
                            <div>
                                <p className="font-medium">Click to upload or drag and drop</p>
                                <p className="text-sm text-muted-foreground">Excel or CSV files</p>
                            </div>
                            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                                Select File
                            </Button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                className="hidden"
                                accept=".xlsx,.xls,.csv"
                                onChange={handleFileChange}
                            />
                        </div>

                        <div className="text-center">
                            <Button variant="link" onClick={downloadTemplate} className="gap-2">
                                <Download className="w-4 h-4" />
                                Download Template
                            </Button>
                        </div>

                        {file && (
                            <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                                <div className="flex items-center gap-3">
                                    <FileSpreadsheet className="w-5 h-5 text-green-600" />
                                    <span className="font-medium text-sm">{file.name}</span>
                                </div>
                                <Button variant="ghost" size="sm" onClick={() => { setFile(null); setPreviewData([]); }}>
                                    <X className="w-4 h-4" />
                                </Button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-4">
                        <Alert variant={errorRows.length > 0 ? "destructive" : "default"}>
                            <AlertTitle>Validation Results</AlertTitle>
                            <AlertDescription>
                                Found {validRows.length} valid transfers and {errorRows.length} errors.
                            </AlertDescription>
                        </Alert>

                        <Tabs defaultValue={errorRows.length > 0 ? "errors" : "valid"}>
                            <TabsList>
                                <TabsTrigger value="valid">Valid ({validRows.length})</TabsTrigger>
                                <TabsTrigger value="errors">Errors ({errorRows.length})</TabsTrigger>
                            </TabsList>
                            <TabsContent value="valid">
                                <ScrollArea className="h-[300px]">
                                    <table className="w-full text-sm">
                                        <thead className="text-left text-muted-foreground bg-muted sticky top-0">
                                            <tr>
                                                <th className="p-2">SKU</th>
                                                <th className="p-2">Qty</th>
                                                <th className="p-2">Source</th>
                                                <th className="p-2">Destination</th>
                                                <th className="p-2">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {validRows.map((row, i) => (
                                                <tr key={i} className="border-b">
                                                    <td className="p-2 font-mono">{row.sku}</td>
                                                    <td className="p-2">{row.quantity}</td>
                                                    <td className="p-2">{row.source_warehouse}</td>
                                                    <td className="p-2">{row.destination_warehouse}</td>
                                                    <td className="p-2 text-green-600 flex items-center gap-1">
                                                        <Check className="w-3 h-3" /> Valid
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </ScrollArea>
                            </TabsContent>
                            <TabsContent value="errors">
                                <ScrollArea className="h-[300px]">
                                    <table className="w-full text-sm">
                                        <thead className="text-left text-muted-foreground bg-muted sticky top-0">
                                            <tr>
                                                <th className="p-2">SKU</th>
                                                <th className="p-2">Message</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {errorRows.map((row, i) => (
                                                <tr key={i} className="border-b bg-red-50/50">
                                                    <td className="p-2 font-mono">{row.sku}</td>
                                                    <td className="p-2 text-red-600 flex items-center gap-2">
                                                        <AlertCircle className="w-3 h-3" />
                                                        {row.message}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </ScrollArea>
                            </TabsContent>
                        </Tabs>
                    </div>
                )}

                <DialogFooter>
                    {!uploadResult ? (
                        <Button onClick={handleUpload} disabled={!file || isUploading} className="w-full sm:w-auto">
                            {isUploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                            Validate File
                        </Button>
                    ) : (
                        <div className="flex gap-2 w-full justify-end">
                            <Button variant="outline" onClick={() => setUploadResult(null)}>Back</Button>
                            <Button onClick={handleExecute} disabled={validRows.length === 0 || isUploading}>
                                {isUploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                Execute {validRows.length} Transfers
                            </Button>
                        </div>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
