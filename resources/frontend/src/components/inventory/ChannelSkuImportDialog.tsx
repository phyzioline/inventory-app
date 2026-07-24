import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { Upload, FileSpreadsheet, Check, X, Loader2, Download, ArrowRight, ArrowLeft, Package } from 'lucide-react';
import api from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog';

interface SkuRow {
    name: string;
    sku: string;
    barcode?: string;
    selling_price?: number | string;
    stock?: number;
    image_url?: string;
}

interface Props {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    channelId: number;
    channelName?: string;
    onImported?: () => void;
}

export function ChannelSkuImportDialog({ open, onOpenChange, channelId, channelName, onImported }: Props) {
    const { language } = useLanguage();
    const isAr = language === 'ar';
    const fileRef = useRef<HTMLInputElement>(null);

    const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
    const [isLoading, setIsLoading] = useState(false);
    const [preview, setPreview] = useState<SkuRow[]>([]);
    const [parseErrors, setParseErrors] = useState<string[]>([]);
    const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
    const [result, setResult] = useState<{ processed: number; errors: string[] } | null>(null);

    const handleReset = () => {
        setStep('upload');
        setPreview([]);
        setParseErrors([]);
        setSelectedRows(new Set());
        setResult(null);
        if (fileRef.current) fileRef.current.value = '';
    };

    const handleClose = () => {
        handleReset();
        onOpenChange(false);
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsLoading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);

            const data = await api.upload(`channels/${channelId}/import/upload`, formData);

            if (!data.success) throw new Error(data.message || 'Upload failed');

            setPreview(data.preview || []);
            setParseErrors(data.errors || []);
            // Select all rows by default
            setSelectedRows(new Set((data.preview || []).map((_: SkuRow, i: number) => i)));
            setStep('preview');
            toast.success(isAr ? `تم تحليل ${data.valid_rows} منتج` : `Parsed ${data.valid_rows} products`);
        } catch (err: any) {
            const serverMessage = err.response?.data?.message;
            toast.error(serverMessage || err.message || (isAr ? 'فشل رفع الملف' : 'Upload failed'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirm = async () => {
        const selectedSkus = preview.filter((_, i) => selectedRows.has(i));
        if (selectedSkus.length === 0) {
            toast.error(isAr ? 'اختر على الأقل منتج واحد' : 'Select at least one product');
            return;
        }

        setIsLoading(true);
        try {
            const data = await api.post(`channels/${channelId}/import/confirm`, { skus: selectedSkus });
            setResult({ processed: data.processed, errors: data.errors || [] });
            setStep('done');
            if (data.errors?.length) {
                data.errors.forEach((e: string) => toast.error(e));
            }
            toast.success(isAr ? `تمت معالجة ${data.processed} منتج بنجاح` : `Processed ${data.processed} products successfully`);
            onImported?.();
        } catch (err: any) {
            toast.error(err.message || (isAr ? 'فشل الاستيراد' : 'Import failed'));
        } finally {
            setIsLoading(false);
        }
    };

    const toggleRow = (i: number) => {
        const next = new Set(selectedRows);
        next.has(i) ? next.delete(i) : next.add(i);
        setSelectedRows(next);
    };

    const toggleAll = () => {
        setSelectedRows(selectedRows.size === preview.length ? new Set() : new Set(preview.map((_, i) => i)));
    };

    const downloadTemplate = () => {
        window.open(`/api/inventory/channels/${channelId}/import/template`, '_blank');
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-4xl bg-gray-950 border border-gray-800 text-white">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold flex items-center gap-2">
                        <FileSpreadsheet className="text-emerald-400" size={22} />
                        {isAr ? `استيراد منتجات لـ ${channelName}` : `Import SKUs for ${channelName}`}
                    </DialogTitle>
                    <DialogDescription className="text-gray-400 text-sm">
                        {isAr
                            ? 'المنتجات ستُضاف مباشرة لهذه القناة. اربطها بالمخزن الرئيسي لاحقاً.'
                            : 'Products will be added directly to this channel. Link to master inventory later.'}
                    </DialogDescription>
                </DialogHeader>

                {/* Step Indicator */}
                <div className="flex items-center gap-2 text-xs font-bold mb-4">
                    <span className={`px-3 py-1 rounded-full ${step === 'upload' ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400'}`}>
                        1. {isAr ? 'رفع الملف' : 'Upload'}
                    </span>
                    <ArrowRight size={14} className="text-gray-600" />
                    <span className={`px-3 py-1 rounded-full ${step === 'preview' ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400'}`}>
                        2. {isAr ? 'مراجعة' : 'Preview'}
                    </span>
                    <ArrowRight size={14} className="text-gray-600" />
                    <span className={`px-3 py-1 rounded-full ${step === 'done' ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400'}`}>
                        3. {isAr ? 'تم' : 'Done'}
                    </span>
                </div>

                {/* STEP 1: Upload */}
                {step === 'upload' && (
                    <div className="space-y-4">
                        <div
                            className="border-2 border-dashed border-gray-700 rounded-xl p-10 text-center cursor-pointer hover:border-emerald-500 transition-all"
                            onClick={() => fileRef.current?.click()}
                        >
                            {isLoading ? (
                                <Loader2 className="mx-auto animate-spin text-emerald-400 mb-3" size={36} />
                            ) : (
                                <Upload className="mx-auto text-gray-600 mb-3" size={36} />
                            )}
                            <p className="text-white font-bold">{isAr ? 'اضغط لرفع ملف Excel أو CSV' : 'Click to upload Excel or CSV'}</p>
                            <p className="text-gray-500 text-xs mt-1">XLSX · XLS · CSV · TXT</p>
                            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden" onChange={handleUpload} />
                        </div>
                        <div className="flex justify-between items-center">
                            <button onClick={downloadTemplate} className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300">
                                <Download size={14} />
                                {isAr ? 'تحميل القالب' : 'Download Template'}
                            </button>
                            <p className="text-xs text-gray-600 italic">
                                {isAr ? 'يدعم: Product Name, SKU — أو تقارير أمازون FBA (seller-sku, Quantity Available)' : 'Supports: Product Name, SKU — or Amazon FBA reports (seller-sku, Quantity Available)'}
                            </p>
                        </div>
                    </div>
                )}

                {/* STEP 2: Preview */}
                {step === 'preview' && (
                    <div className="space-y-3">
                        {parseErrors.length > 0 && (
                            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                                <p className="text-red-400 text-xs font-bold mb-1">{parseErrors.length} {isAr ? 'خطأ في الملف:' : 'parse errors:'}</p>
                                {parseErrors.slice(0, 3).map((e, i) => <p key={i} className="text-red-400 text-xs">{e}</p>)}
                            </div>
                        )}

                        <div className="flex justify-between items-center">
                            <p className="text-sm font-bold">{isAr ? `${selectedRows.size} من ${preview.length} مختار` : `${selectedRows.size} of ${preview.length} selected`}</p>
                            <button onClick={toggleAll} className="text-xs text-emerald-400 underline">
                                {selectedRows.size === preview.length ? (isAr ? 'إلغاء الكل' : 'Deselect All') : (isAr ? 'اختيار الكل' : 'Select All')}
                            </button>
                        </div>

                        <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-800">
                            <table className="w-full text-xs">
                                <thead className="bg-gray-800 sticky top-0">
                                    <tr>
                                        <th className="px-3 py-2 w-8 text-center">
                                            <input type="checkbox" checked={selectedRows.size === preview.length && preview.length > 0} onChange={toggleAll} />
                                        </th>
                                        <th className="px-3 py-2 text-left text-gray-400 font-bold uppercase">{isAr ? 'المنتج' : 'Product'}</th>
                                        <th className="px-3 py-2 text-left text-gray-400 font-bold uppercase">SKU</th>
                                        <th className="px-3 py-2 text-right text-gray-400 font-bold uppercase">{isAr ? 'المخزون' : 'Stock'}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-800">
                                    {preview.map((row, i) => (
                                        <tr key={i} className={`transition-colors ${selectedRows.has(i) ? 'bg-emerald-500/5' : 'opacity-40'}`}>
                                            <td className="px-3 py-2 text-center">
                                                <input type="checkbox" checked={selectedRows.has(i)} onChange={() => toggleRow(i)} />
                                            </td>
                                            <td className="px-3 py-2 font-medium text-white truncate max-w-[180px]">{row.name}</td>
                                            <td className="px-3 py-2 text-emerald-400 font-mono">{row.sku}</td>
                                            <td className="px-3 py-2 text-right text-gray-300">{row.stock ?? '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex justify-between pt-2">
                            <button onClick={handleReset} className="flex items-center gap-1.5 px-4 py-2 bg-gray-800 rounded-lg text-sm hover:bg-gray-700 transition-all">
                                <ArrowLeft size={14} /> {isAr ? 'رجوع' : 'Back'}
                            </button>
                            <button
                                onClick={handleConfirm}
                                disabled={isLoading || selectedRows.size === 0}
                                className="flex items-center gap-2 px-6 py-2 bg-emerald-600 rounded-lg text-sm font-bold hover:bg-emerald-500 disabled:opacity-40 transition-all"
                            >
                                {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                {isAr ? `استيراد ${selectedRows.size} منتج` : `Import ${selectedRows.size} SKUs`}
                            </button>
                        </div>
                    </div>
                )}

                {/* STEP 3: Done */}
                {step === 'done' && result && (
                    <div className="flex flex-col items-center gap-5 py-6 text-center">
                        <div className={`w-20 h-20 rounded-full flex items-center justify-center ${result.processed > 0 ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-amber-500/10 border border-amber-500/30'}`}>
                            <Package className={result.processed > 0 ? 'text-emerald-400' : 'text-amber-400'} size={36} />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-white mb-1">
                                {result.processed > 0
                                    ? (isAr ? 'تم الاستيراد بنجاح!' : 'Import Complete!')
                                    : (isAr ? 'فشل الاستيراد' : 'Import Failed')}
                            </h3>
                            <p className="text-gray-400 text-sm">
                                {isAr
                                    ? `تمت معالجة ${result.processed} منتج بنجاح (إضافة وتحديث المخزون).`
                                    : `${result.processed} products processed (added or inventory updated).`}
                            </p>
                            {result.errors.length > 0 && (
                                <div className="mt-4 text-right w-full max-w-md mx-auto">
                                    <p className="text-red-400 text-sm font-bold">{result.errors.length} {isAr ? 'أخطاء حدثت' : 'errors'}</p>
                                    <div className="mt-2 max-h-32 overflow-y-auto bg-red-500/10 border border-red-500/20 rounded p-2 text-xs text-red-300 text-left">
                                        {result.errors.slice(0, 5).map((e, i) => (
                                            <p key={i} className="truncate" title={e}>{e}</p>
                                        ))}
                                        {result.errors.length > 5 && (
                                            <p className="text-gray-500 mt-1">... {result.errors.length - 5} {isAr ? 'أخطاء أخرى' : 'more'}</p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="flex gap-3 mt-2">
                            <button onClick={handleClose} className="px-6 py-2 bg-emerald-600 rounded-lg font-bold hover:bg-emerald-500 transition-all">
                                {isAr ? 'عرض منتجات القناة' : 'View Channel SKUs'}
                            </button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

export default ChannelSkuImportDialog;
