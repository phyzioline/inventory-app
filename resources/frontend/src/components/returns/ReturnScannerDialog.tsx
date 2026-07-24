import React, { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Scan, Package, Loader2, Search, Check, AlertCircle, FileUp, ImageUp } from 'lucide-react';
import { toast } from 'sonner';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';

interface ReturnScannerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function ReturnScannerDialog({ open, onOpenChange }: ReturnScannerDialogProps) {
    const queryClient = useQueryClient();
    const [barcode, setBarcode] = useState('');
    const [scannedCode, setScannedCode] = useState('');
    const [isScanning, setIsScanning] = useState(false);
    const [scanResult, setScanResult] = useState<any>(null);
    const [isImportingPolicy, setIsImportingPolicy] = useState(false);
    const [isScanningImage, setIsScanningImage] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const policyFileRef = useRef<HTMLInputElement>(null);
    const labelImageRef = useRef<HTMLInputElement>(null);

    // Auto-focus input when dialog opens
    useEffect(() => {
        if (open) {
            setTimeout(() => inputRef.current?.focus(), 100);
        } else {
            resetScanner();
        }
    }, [open]);

    const resetScanner = () => {
        setBarcode('');
        setScanResult(null);
        setIsScanning(false);
    };

    const handleScan = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!barcode.trim()) return;

        setIsScanning(true);
        const code = barcode.trim();
        setScannedCode(code);
        try {
            const response = await api.post('barcode/scan', { barcode: code });
            setScanResult(response);
            if (response.found) {
                toast.success('Product/Order identified');
            } else {
                toast.error('Could not identify barcode');
            }
        } catch (error: any) {
            toast.error(error.message || 'Scan failed');
        } finally {
            setIsScanning(false);
            setBarcode('');
            // Keep focus for next scan if needed, or if we want to re-scan
            inputRef.current?.focus();
        }
    };

    const handleLabelImageUpload = async (file?: File) => {
        if (!file) return;
        setIsScanningImage(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const response = await api.upload('/barcode/scan-image', formData);
            setScanResult(response);
            if (response?.ocr_code) {
                setScannedCode(response.ocr_code);
            }
            if (response?.found) {
                toast.success(`Label parsed: ${response.ocr_code || 'code detected'}`);
            } else {
                toast.error(response?.message || 'Could not match label to order/product');
            }
        } catch (error: any) {
            const data = error?.response?.data;
            const validation = data?.errors ? Object.values(data.errors).flat().join(' | ') : null;
            toast.error(`Image scan failed: ${data?.message || validation || error.message}`);
        } finally {
            setIsScanningImage(false);
            if (labelImageRef.current) {
                labelImageRef.current.value = '';
            }
        }
    };

    const processReturnMutation = useMutation({
        mutationFn: async (data: any) => {
            return api.post('barcode/process-return', data);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            queryClient.invalidateQueries({ queryKey: ['inventory'] });
            toast.success('Return processed and inventory updated');
            resetScanner();
            onOpenChange(false);
        },
        onError: (error: any) => {
            toast.error(error.message || 'Failed to process return');
        }
    });

    const handlePolicyUpload = async (file?: File) => {
        if (!file) return;
        setIsImportingPolicy(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('channel', 'amazon');
            // Laravel boolean validator accepts 0/1 reliably in multipart payloads.
            formData.append('auto_process', '0');

            const response = await api.upload('/returns/import', formData);
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            queryClient.invalidateQueries({ queryKey: ['inventory'] });

            const summary = response?.summary || {};
            toast.success(
                `Policy imported: ${summary.created ?? 0} created, ${summary.processed ?? 0} processed`
            );
            onOpenChange(false);
        } catch (error: any) {
            const data = error?.response?.data;
            const validation = data?.errors ? Object.values(data.errors).flat().join(' | ') : null;
            toast.error(`Upload failed: ${data?.message || validation || error.message}`);
        } finally {
            setIsImportingPolicy(false);
            if (policyFileRef.current) {
                policyFileRef.current.value = '';
            }
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl bg-gray-900 border-gray-800 text-white">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-xl font-bold">
                        <Scan className="w-5 h-5 text-emerald-500" />
                        Amazon Return Scanner
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* Three options side-by-side */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => inputRef.current?.focus()}
                            className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500 hover:text-white gap-2"
                        >
                            <Scan className="w-4 h-4" />
                            Scan Code
                        </Button>

                        <input
                            ref={policyFileRef}
                            type="file"
                            accept=".xml,.csv,.txt"
                            className="hidden"
                            onChange={(e) => handlePolicyUpload(e.target.files?.[0])}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => policyFileRef.current?.click()}
                            disabled={isImportingPolicy}
                            className="border-blue-500/40 text-blue-400 hover:bg-blue-500 hover:text-white gap-2"
                        >
                            {isImportingPolicy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                            Upload Returns File
                        </Button>

                        <input
                            ref={labelImageRef}
                            type="file"
                            accept=".jpg,.jpeg,.png,.webp,.pdf"
                            className="hidden"
                            onChange={(e) => handleLabelImageUpload(e.target.files?.[0])}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => labelImageRef.current?.click()}
                            disabled={isScanningImage}
                            className="border-purple-500/40 text-purple-400 hover:bg-purple-500 hover:text-white gap-2"
                        >
                            {isScanningImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageUp className="w-4 h-4" />}
                            Upload Label Image
                        </Button>
                    </div>

                    {/* Scanner Input */}
                    <div className="relative">
                        <form onSubmit={handleScan}>
                            <Input
                                ref={inputRef}
                                value={barcode}
                                onChange={(e) => setBarcode(e.target.value)}
                                placeholder="Scan Amazon VRET, Mylerz AWB, or Product Barcode..."
                                className="h-14 bg-gray-800 border-2 border-emerald-500/30 focus:border-emerald-500 text-lg px-4 font-mono tracking-widest"
                                disabled={isScanning}
                                autoComplete="off"
                            />
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 text-xs text-gray-500 uppercase font-bold bg-gray-900 px-2 py-1 rounded border border-gray-700">
                                {isScanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                                Waiting for Scan
                            </div>
                        </form>
                    </div>

                    {/* Result Display */}
                    {scanResult && scanResult.found && (
                        <Card className="bg-emerald-500/5 border-emerald-500/20 overflow-hidden">
                            <CardContent className="p-0">
                                <div className="p-4 border-b border-emerald-500/10 flex justify-between items-center bg-emerald-500/10">
                                    <div className="flex items-center gap-2">
                                        <Package className="w-5 h-5 text-emerald-400" />
                                        <span className="font-bold">Identified Item</span>
                                    </div>
                                    <Badge className="bg-emerald-600">
                                        {scanResult.detected_channel || 'Amazon'}
                                    </Badge>
                                </div>
                                <div className="p-4 space-y-4">
                                    <div className="flex gap-4">
                                        <div className="flex-1">
                                            <h4 className="text-lg font-bold text-white">
                                                {scanResult.product?.internal_name || scanResult.order?.order_number || scanResult.tracking_number || 'Detected record'}
                                            </h4>
                                            <p className="text-sm text-gray-400 font-mono">
                                                {scanResult.product?.sku || scanResult.barcode || scanResult.ocr_code || scannedCode}
                                            </p>
                                        </div>
                                    </div>

                                    {scanResult.suggestions?.last_sold_from && (
                                        <div className="flex items-center gap-2 p-2 bg-gray-800/50 rounded-lg text-xs text-gray-400">
                                            <AlertCircle size={14} />
                                            Last sold from: <span className="text-white font-medium">{scanResult.suggestions.last_sold_from}</span>
                                        </div>
                                    )}

                                    {scanResult.product?.id ? (
                                        <div className="grid grid-cols-2 gap-3 pt-2">
                                            <Button
                                                onClick={() => processReturnMutation.mutate({
                                                    product_id: scanResult.product.id,
                                                    condition: 'good',
                                                    barcode: scannedCode || barcode
                                                })}
                                                className="bg-emerald-600 hover:bg-emerald-500 gap-2 h-12"
                                                disabled={processReturnMutation.isPending}
                                            >
                                                <Check size={18} />
                                                Return to Stock
                                            </Button>
                                            <Button
                                                onClick={() => processReturnMutation.mutate({
                                                    product_id: scanResult.product.id,
                                                    condition: 'damaged',
                                                    barcode: scannedCode || barcode
                                                })}
                                                variant="outline"
                                                className="border-red-500/50 text-red-500 hover:bg-red-500/10 gap-2 h-12"
                                                disabled={processReturnMutation.isPending}
                                            >
                                                <AlertCircle size={18} />
                                                Damaged / Out
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded p-2">
                                            Order/Tracking detected. If you need auto inventory update, import returns CSV/XML for this code.
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {!scanResult?.found && scanResult && (
                        <div className="p-8 text-center border-2 border-dashed border-red-500/20 rounded-xl bg-red-500/5 space-y-2">
                            <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
                            <h3 className="font-bold text-white uppercase">Not Found</h3>
                            <p className="text-sm text-gray-500">The scanned barcode does not match any product or Amazon order.</p>
                            <Button variant="ghost" size="sm" onClick={resetScanner} className="text-emerald-500 hover:text-emerald-400">
                                Try Again
                            </Button>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-gray-500">
                        Close Scanner
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
