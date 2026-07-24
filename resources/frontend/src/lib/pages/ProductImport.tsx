import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Download, Upload, AlertCircle, CheckCircle, FileUp, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { downloadProductImportTemplate } from '@/lib/excelUtils';
import * as XLSX from 'xlsx';

interface ProductRow {
  name: string;
  sku: string;
  asin?: string;
  category?: string;
  description?: string;
  selling_price?: number;
  cost_price?: number;
  barcode?: string;
  min_stock?: number;
  quantity?: number;
  supplier_name?: string;
  notes?: string;
  image_url?: string;
}


export default function ProductImport() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<ProductRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [step, setStep] = useState<'upload' | 'preview'>('upload');
  const [createDirectly, setCreateDirectly] = useState(false);

  const downloadTemplate = () => {
    try {
      downloadProductImportTemplate();
      toast.success('Template downloaded');
    } catch (e) {
      console.error('Template download error:', e);
      toast.error('Failed to download template');
    }
  };

  // ── Client-side Data parser ───────────────────────────────────────────────
  const parseDataClientSide = (rows: string[][]): { data: ProductRow[]; errors: string[] } => {
    if (rows.length < 2) return { data: [], errors: ['File has no data rows'] };

    const headers = rows[0].map(h => String(h || '').toLowerCase().trim());

    // Find column index – checks multiple possible names
    const col = (...keys: string[]): number => {
      for (const k of keys) {
        const i = headers.findIndex(h =>
          h === k ||
          h.includes(k) ||
          h.replace(/[*]/g, '').trim() === k ||
          k.includes(h.replace(/[*]/g, '').trim())
        );
        if (i !== -1) return i;
      }
      // Arabic fallbacks
      const arabicMap: Record<string, string[]> = {
        'name': ['اسم', 'منتج', 'تسمية'],
        'sku': ['سكيو', 'كود', 'رمز'],
        'asin': ['اسين', 'asin'],
        'description': ['وصف', 'تفاصيل'],
        'price': ['سعر', 'بيع'],
        'quantity': ['كمية', 'عدد', 'مخزون'],
        'category': ['تصنيف', 'قسم', 'نوع'],
        'barcode': ['باركود', 'سيريال'],
        'cost price': ['تكلفة', 'شراء'],
        'min stock': ['حد', 'أدنى'],
        'supplier': ['مورد', 'المورد'],
        'notes': ['ملاحظات', 'ملاحظة'],
        'image': ['صورة', 'رابط الصورة', 'image']
      };

      for (const key of keys) {
        if (arabicMap[key]) {
          const i = headers.findIndex(h => arabicMap[key].some(a => (h || '').includes(a)));
          if (i !== -1) return i;
        }
      }

      return -1;
    };

    const nameIdx = col('name', 'item-name', 'product name', 'product');
    const skuIdx = col('sku', 'seller-sku', 'seller sku');
    const asinIdx = col('asin', 'asin1');
    const descIdx = col('description', 'item-description');
    const priceIdx = col('price', 'selling price', 'sell price');
    const qtyIdx = col('quantity', 'qty', 'stock');
    const catIdx = col('category');
    const barcodeIdx = col('barcode', 'product-id', 'ean', 'upc');
    const costIdx = col('cost price', 'cost_price');
    const minStockIdx = col('min stock', 'min_stock');
    const supplierIdx = col('supplier', 'supplier name', 'vendor');
    const notesIdx = col('notes', 'note');
    const imageIdx = col('image', 'image url', 'img', 'url');

    const data: ProductRow[] = [];
    const parseErrors: string[] = [];

    rows.slice(1).forEach((cells, i) => {
      const name = nameIdx !== -1 ? cells[nameIdx] || '' : '';
      const sku = skuIdx !== -1 ? cells[skuIdx] || '' : '';

      if (!name && !sku) return; // blank row
      if (!name || !sku) {
        parseErrors.push(`Row ${i + 2}: Missing ${!name ? 'Product Name' : 'SKU'}`);
        return;
      }

      data.push({
        name,
        sku: String(sku).trim(),
        asin: asinIdx !== -1 ? cells[asinIdx] || undefined : undefined,
        description: descIdx !== -1 ? cells[descIdx] || undefined : undefined,
        category: catIdx !== -1 ? cells[catIdx] || undefined : undefined,
        barcode: barcodeIdx !== -1 ? cells[barcodeIdx] || undefined : undefined,
        selling_price: priceIdx !== -1 ? parseFloat(String(cells[priceIdx])) || 0 : 0,
        cost_price: costIdx !== -1 ? parseFloat(String(cells[costIdx])) || 0 : 0,
        quantity: qtyIdx !== -1 ? parseInt(String(cells[qtyIdx])) || 0 : 0,
        min_stock: minStockIdx !== -1 ? parseInt(String(cells[minStockIdx])) || 0 : 0,
        supplier_name: supplierIdx !== -1 ? String(cells[supplierIdx] || '').trim() || undefined : undefined,
        notes: notesIdx !== -1 ? String(cells[notesIdx] || '').trim() || undefined : undefined,
        image_url: imageIdx !== -1 ? String(cells[imageIdx] || '').trim() || undefined : undefined,
      });
    });

    return { data, errors: parseErrors };
  };

  const onDrop = async (acceptedFiles: File[]) => {
    const uploadedFile = acceptedFiles[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setIsUploading(true);
    setErrors([]);

    const fileName = uploadedFile.name.toLowerCase();
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

    try {
      let rows: string[][] = [];

      if (isExcel) {
        const data = await uploadedFile.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as string[][];
      } else {
        // Helper to read file with specific encoding
        const readFile = (file: File, encoding: string): Promise<string> => {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsText(file, encoding);
          });
        };

        // Try UTF-8 first, but if we see diamond shapes or it's a CSV, 
        // it might be Windows-1256 (common for Arabic Excel exports)
        let text = await readFile(uploadedFile, 'utf-8');

        // If we see lots of replacement characters (), try Windows-1256
        if (text.includes('\uFFFD')) {
          text = await readFile(uploadedFile, 'windows-1256');
        }

        const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
        if (lines.length > 0) {
          const firstLine = lines[0];
          const delimiter = (firstLine.split('\t').length > firstLine.split(',').length) ? '\t' : ',';
          rows = lines.map(line => line.split(delimiter).map(c => c.trim().replace(/^"|"$/g, '')));
        }
      }

      const { data, errors: parseErrors } = parseDataClientSide(rows);

      setPreviewData(data);
      setErrors(parseErrors);

      if (data.length > 0) {
        setStep('preview');
        if (parseErrors.length > 0) {
          toast.warning(`Parsed ${data.length} rows – ${parseErrors.length} issues found`);
        } else {
          toast.success(`Successfully parsed ${data.length} rows`);
        }
      } else {
        const errorMsg = parseErrors.length > 0 ? parseErrors[0] : 'No valid data found in file. Please check headers.';
        toast.error(errorMsg);
        setFile(null);
      }
    } catch (e: any) {
      console.error('Import Error:', e);
      toast.error('Failed to read file: ' + (e?.message || 'Unknown error'));
      setFile(null);
    } finally {
      setIsUploading(false);
    }
  };

  const confirmImport = async () => {
    setIsImporting(true);
    try {
      const response = await api.post('import/products/confirm', { products: previewData });
      const count = response.results?.drafts_created || 0;

      if (createDirectly && count > 0) {
        const draftIds = (response.results?.drafts || []).map((d: any) => d.id).filter(Boolean);
        if (draftIds.length > 0) {
          await api.post('import/products/drafts/batch', { ids: draftIds, action: 'create_new' });
          toast.success(`تم إنشاء ${draftIds.length} منتج بنجاح في المنتجات الرئيسية`);
          navigate('/master-products');
        } else {
          toast.success(`${count} منتج جاهز للمراجعة`);
          navigate('/import/products/drafts');
        }
      } else {
        toast.success(`تم! ${count} منتج جاهز للمراجعة.`);
        navigate('/import/products/drafts');
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'فشل الاستيراد');
    } finally {
      setIsImporting(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'text/plain': ['.txt'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
    },
    maxFiles: 1,
    disabled: isUploading
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">Product Import</h1>
          <p className="text-gray-400">Bulk upload products via CSV/Excel</p>
        </div>
        <button
          onClick={downloadTemplate}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600/20 text-emerald-400 rounded-lg hover:bg-emerald-600/30 transition-colors"
        >
          <Download size={18} />
          Download Template
        </button>
      </div>

      {step === 'upload' && (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all
                        ${isDragActive ? 'border-emerald-500 bg-emerald-500/5' : 'border-gray-700 hover:border-emerald-500/50 hover:bg-gray-800/50'}
                        ${isUploading ? 'opacity-50 cursor-wait' : ''}
                    `}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 rounded-full bg-gray-800">
              {isUploading ? <Loader2 className="animate-spin text-emerald-500" size={32} /> : <FileUp className="text-gray-400" size={32} />}
            </div>
            <div className="space-y-1">
              <p className="text-lg font-medium text-white">
                {isUploading ? 'Processing File...' : 'Drop your file here, or click to browse'}
              </p>
              <p className="text-sm text-gray-500">
                Supports CSV, Excel (.xlsx, .xls), or Amazon TSV (.txt) files up to 20MB
              </p>
            </div>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
          {errors.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <h3 className="flex items-center gap-2 text-red-400 font-medium mb-2">
                <AlertCircle size={18} />
                Import Issues ({errors.length})
              </h3>
              <ul className="list-disc list-inside text-sm text-red-300/80 space-y-1 max-h-40 overflow-y-auto">
                {errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-gray-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="space-y-2">
                <h3 className="font-medium text-white flex items-center gap-2">
                  <CheckCircle size={18} className="text-emerald-500" />
                  Ready to Import ({previewData.length} items)
                </h3>
                <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer hover:text-white">
                  <input
                    type="checkbox"
                    checked={createDirectly}
                    onChange={(e) => setCreateDirectly(e.target.checked)}
                    className="rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500"
                  />
                  تحويل مباشرةً للمنتجات الرئيسية (بدون مراجعة)
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setStep('upload');
                    setFile(null);
                    setPreviewData([]);
                    setErrors([]);
                  }}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmImport}
                  disabled={isImporting || previewData.length === 0}
                  className="flex items-center gap-2 px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {isImporting ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />}
                  Confirm Import
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-400 uppercase bg-gray-900/50 sticky top-0">
                  <tr>
                    <th className="px-6 py-3">Product Name</th>
                    <th className="px-6 py-3">SKU</th>
                    <th className="px-6 py-3">ASIN</th>
                    <th className="px-6 py-3">Category</th>
                    <th className="px-6 py-3">Selling Price</th>
                    <th className="px-6 py-3">Qty</th>
                    <th className="px-6 py-3">Cost Price</th>
                    <th className="px-6 py-3">Stock Min</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700 text-gray-300">
                  {previewData.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-800/30">
                      <td className="px-6 py-3">{row.name}</td>
                      <td className="px-6 py-3 font-mono text-emerald-400">{row.sku}</td>
                      <td className="px-6 py-3 font-mono text-blue-400 text-xs">{row.asin || '-'}</td>
                      <td className="px-6 py-3">{row.category || '-'}</td>
                      <td className="px-6 py-3">{row.selling_price || '-'}</td>
                      <td className="px-6 py-3">{row.quantity ?? '-'}</td>
                      <td className="px-6 py-3">{row.cost_price || '-'}</td>
                      <td className="px-6 py-3">{row.min_stock || '-'}</td>
                    </tr>
                  ))}
                  {previewData.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
                        No valid data found to import.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
