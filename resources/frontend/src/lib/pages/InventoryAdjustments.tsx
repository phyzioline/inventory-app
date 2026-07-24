import { useState, useEffect, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import {
    AlertTriangle,
    Trash2,
    Plus,
    Search,
    Filter,
    ChevronRight,
    Package,
    MapPin,
    ClipboardList,
    AlertCircle,
    History,
    DollarSign,
    Upload,
    Download,
    FileSpreadsheet,
    X
} from 'lucide-react';
import api from '@/lib/api';
import { downloadOpeningStockTemplate } from '@/lib/excelUtils';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

interface Adjustment {
    id: number;
    sku: {
        sku_code?: string;
        sku?: string;
        product_name?: string;
        offer?: {
            master_product?: {
                internal_name: string;
            }
        }
    };

    location: {
        name: string;
    };
    type: string;
    quantity: number;
    unit_cost: number | null;
    total_loss_amount: number | null;
    reason: string;
    notes: string;
    created_at: string;
    user: {
        name: string;
    };
}

export default function InventoryAdjustments() {
    const { t } = useLanguage();
    const CATEGORIES = [
        { value: 'OPENING_BALANCE', labelKey: 'adjustments.category.openingBalance', color: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-600 dark:border-emerald-400', bg: 'bg-emerald-500/10', isAddition: true },
        { value: 'CORRECTION', labelKey: 'adjustments.category.correction', color: 'text-blue-600 dark:text-blue-400', border: 'border-blue-600 dark:border-blue-400', bg: 'bg-blue-500/10', isAddition: true },
        { value: 'DAMAGE', labelKey: 'adjustments.category.damage', color: 'text-red-600 dark:text-red-400', border: 'border-red-600 dark:border-red-400', bg: 'bg-red-500/10', isAddition: false },
        { value: 'LOST', labelKey: 'adjustments.category.lost', color: 'text-orange-600 dark:text-orange-400', border: 'border-orange-600 dark:border-orange-400', bg: 'bg-orange-500/10', isAddition: false },
        { value: 'THEFT', labelKey: 'adjustments.category.theft', color: 'text-purple-600 dark:text-purple-400', border: 'border-purple-600 dark:border-purple-400', bg: 'bg-purple-500/10', isAddition: false },
        { value: 'EXPIRED', labelKey: 'adjustments.category.expired', color: 'text-amber-600 dark:text-amber-400', border: 'border-amber-600 dark:border-amber-400', bg: 'bg-amber-500/10', isAddition: false },
    ];
    const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [showImportDialog, setShowImportDialog] = useState(false);
    const [skuSearchTerm, setSkuSearchTerm] = useState('');
    const [productPickerOpen, setProductPickerOpen] = useState(false);

    // Form State
    const [skus, setSkus] = useState<any[]>([]);
    const [locations, setLocations] = useState<any[]>([]);
    const [formData, setFormData] = useState({
        sku_id: '',
        location_id: '',
        type: 'OPENING_BALANCE',
        quantity: '',
        notes: ''
    });


    const fileInputRef = useRef<HTMLInputElement>(null);
    const [importFile, setImportFile] = useState<File | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [importErrors, setImportErrors] = useState<string[]>([]);

    useEffect(() => {
        fetchAdjustments();
        fetchInitialData();
    }, []);

    const fetchInitialData = async () => {
        try {
            const [skusRes, locationsRes] = await Promise.all([
                api.getArray('skus'),
                api.getArray('warehouses') // Changed from locations to warehouses if that's the correct endpoint, checking fallback
            ]);
            setSkus(skusRes);
            // Fallback if warehouses endpoint returns empty or error, try locations
            if (!locationsRes || locationsRes.length === 0) {
                const locs = await api.getArray('locations');
                setLocations(locs);
            } else {
                setLocations(locationsRes);
            }
        } catch (e) {
            console.error('Failed to fetch SKUs or Locations', e);
            // Retry locations individually
            try {
                const locs = await api.getArray('locations');
                setLocations(locs);
            } catch (err) { }
        }
    };

    const fetchAdjustments = async () => {
        setIsLoading(true);
        try {
            const response = await api.get('adjustments');
            setAdjustments(response.data || []);
        } catch (e) {
            toast.error(t('adjustments.toast.fetchFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.sku_id || !formData.location_id || !formData.quantity) {
            toast.error(t('adjustments.toast.required'));
            return;
        }

        setIsSubmitting(true);
        try {
            await api.post('adjustments', {
                ...formData,
                quantity: parseFloat(formData.quantity)
            });

            toast.success(t('adjustments.toast.updated'));
            setShowForm(false);
            setFormData({ sku_id: '', location_id: '', type: 'OPENING_BALANCE', quantity: '', notes: '' });
            fetchAdjustments();
        } catch (e: any) {
            toast.error(e.response?.data?.message || t('adjustments.toast.recordFailed'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDownloadTemplate = () => {
        try {
            downloadOpeningStockTemplate();
            toast.success(t('adjustments.toast.templateDownloaded'));
        } catch (e) {
            console.error('Template download error:', e);
            toast.error(t('adjustments.toast.templateFailed'));
        }
    };

    const handleImport = async () => {
        if (!importFile) {
            toast.error(t('adjustments.toast.selectFile'));
            return;
        }

        const formData = new FormData();
        formData.append('file', importFile);

        setIsImporting(true);
        setImportErrors([]);
        try {
            await api.post('adjustments/import', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            toast.success(t('adjustments.toast.importSuccess'));
            setShowImportDialog(false);
            setImportErrors([]);
            setImportFile(null);
            fetchAdjustments();
        } catch (e: any) {
            const errs = (e.response?.data?.errors as string[] | undefined) || [];
            setImportErrors(errs);
            const msg = e.response?.data?.message || t('adjustments.toast.importFailed');
            toast.error(msg + (errs.length ? ` (${errs.length} error${errs.length > 1 ? 's' : ''})` : ''));
        } finally {
            setIsImporting(false);
        }
    };

    const selectedCategory = CATEGORIES.find(c => c.value === formData.type);
    const selectedSku = useMemo(
        () => skus.find((sku: any) => String(sku.id) === String(formData.sku_id)),
        [skus, formData.sku_id]
    );
    const selectedSkuLabel = selectedSku
        ? `${selectedSku.product_name || selectedSku.sku_code || selectedSku.sku} (${selectedSku.sku_code || selectedSku.sku || '-'})`
        : t('adjustments.chooseProduct');
    const filteredSkus = useMemo(() => {
        const term = skuSearchTerm.trim().toLowerCase();
        const list = skus || [];
        if (!term) return list.slice(0, 200);
        return list
            .filter((sku: any) => {
                const name = String(sku?.product_name || '').toLowerCase();
                const code = String(sku?.sku_code || sku?.sku || '').toLowerCase();
                return name.includes(term) || code.includes(term);
            })
            .slice(0, 200);
    }, [skus, skuSearchTerm]);

    const currentQtyAtLocation = useMemo(() => {
        if (!selectedSku || !formData.location_id) return null;
        const inv = selectedSku.inventory;
        if (Array.isArray(inv)) {
            const row = inv.find((i: any) => String(i.location_id) === String(formData.location_id));
            if (row) return Number(row.quantity ?? 0);
            return 0;
        }
        if (selectedSku.stock != null && selectedSku.stock !== '') {
            return Number(selectedSku.stock);
        }
        return null;
    }, [selectedSku, formData.location_id]);

    const qtyNumeric = parseFloat(String(formData.quantity || '').replace(',', '.')) || 0;
    const projectedQtyAfter = useMemo(() => {
        if (currentQtyAtLocation === null || !Number.isFinite(qtyNumeric)) return null;
        if (selectedCategory?.isAddition) return currentQtyAtLocation + qtyNumeric;
        return currentQtyAtLocation - qtyNumeric;
    }, [currentQtyAtLocation, qtyNumeric, selectedCategory?.isAddition]);

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">{t('adjustments.title')}</h1>
                    <p className="text-muted-foreground text-sm">{t('adjustments.subtitle')}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        onClick={() => setShowImportDialog(true)}
                        className="gap-2 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                    >
                        <Upload size={16} />
                        {t('adjustments.importStock')}
                    </Button>
                    <button
                        onClick={() => setShowForm(!showForm)}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-lg transition-all font-semibold",
                            showForm
                                ? "bg-muted text-muted-foreground hover:text-foreground"
                                : "bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-600/20"
                        )}
                    >
                        {showForm ? <Trash2 size={18} /> : <Plus size={18} />}
                        {showForm ? t('adjustments.cancel') : t('adjustments.record')}
                    </button>
                </div>
            </div>

            {/* Import Dialog */}
            <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('adjustments.importTitle')}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm text-blue-700 dark:text-blue-300 space-y-2">
                            <p className="font-semibold flex items-center gap-2">
                                <AlertCircle size={16} />
                                {t('adjustments.instructions')}
                            </p>
                            <ul className="list-disc list-inside space-y-1 opacity-90">
                                <li>{t('adjustments.instructions.step1')}</li>
                                <li>{t('adjustments.instructions.step2')}</li>
                                <li>{t('adjustments.instructions.step3')}</li>
                                <li>{t('adjustments.instructions.step4')}</li>
                            </ul>
                        </div>

                        <div className="flex items-center justify-between p-3 bg-muted/40 rounded-lg border border-border">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-emerald-500/20 rounded text-emerald-400">
                                    <FileSpreadsheet size={20} />
                                </div>
                                <div className="text-sm">
                                    <p className="font-medium text-foreground">{t('adjustments.excelTemplate')}</p>
                                    <p className="text-xs text-muted-foreground">{t('adjustments.excelTemplateDesc')}</p>
                                </div>
                            </div>
                            <Button variant="ghost" size="sm" onClick={handleDownloadTemplate} className="text-emerald-400 hover:text-emerald-300">
                                <Download size={16} className="mr-2" />
                                {t('adjustments.download')}
                            </Button>
                        </div>

                        <div
                            className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-emerald-500/50 transition-colors cursor-pointer"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept=".xlsx,.xls,.csv"
                                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                            />
                            {importFile ? (
                                <div className="flex flex-col items-center gap-2">
                                    <FileSpreadsheet className="w-10 h-10 text-emerald-500" />
                                    <p className="text-foreground font-medium">{importFile.name}</p>
                                    <p className="text-xs text-muted-foreground">{(importFile.size / 1024).toFixed(1)} KB</p>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={(e) => { e.stopPropagation(); setImportFile(null); }}
                                        className="text-red-400 hover:text-red-300 mt-2"
                                    >
                                        {t('common.delete')}
                                    </Button>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                    <Upload className="w-10 h-10 mb-2" />
                                    <p>{t('adjustments.uploadHint')}</p>
                                    <p className="text-xs">{t('adjustments.uploadTypes')}</p>
                                </div>
                            )}
                        </div>
                        {importErrors.length > 0 && (
                            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 max-h-40 overflow-y-auto">
                                <p className="text-red-400 font-medium mb-2 flex items-center gap-2">
                                    <AlertTriangle size={16} />
                                    {t('adjustments.importErrors')} ({importErrors.length}):
                                </p>
                                <ul className="text-sm text-red-300/90 space-y-1 list-disc list-inside">
                                    {importErrors.slice(0, 15).map((err, i) => (
                                        <li key={i}>{err}</li>
                                    ))}
                                    {importErrors.length > 15 && (
                                        <li className="text-red-400/80">{t('adjustments.moreErrors')} {importErrors.length - 15}</li>
                                    )}
                                </ul>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setShowImportDialog(false); setImportErrors([]); }}>{t('adjustments.cancel')}</Button>
                        <Button onClick={handleImport} disabled={!importFile || isImporting}>
                            {isImporting ? t('adjustments.importing') : t('adjustments.startImport')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {showForm && (
                <div className="bg-card border border-border rounded-xl p-6 animate-in fade-in slide-in-from-top-4 duration-300 shadow-sm">
                    <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                        <div className="space-y-4 xl:col-span-2">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-muted-foreground">{t('adjustments.searchSelectProduct')}</label>
                                <Popover open={productPickerOpen} onOpenChange={setProductPickerOpen}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="w-full justify-between bg-background text-foreground border-input"
                                        >
                                            <span className="truncate text-start">{selectedSkuLabel}</span>
                                            <ChevronRight className={cn("h-4 w-4 opacity-60 transition-transform", productPickerOpen && "rotate-90")} />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[420px] p-0 bg-popover text-popover-foreground border-border">
                                        <Command shouldFilter={false}>
                                            <CommandInput
                                                placeholder={t('adjustments.searchByNameSku')}
                                                value={skuSearchTerm}
                                                onValueChange={setSkuSearchTerm}
                                            />
                                            <CommandList>
                                                <CommandEmpty>{t('adjustments.chooseProduct')}</CommandEmpty>
                                                <CommandGroup>
                                                    {filteredSkus.map((sku: any) => (
                                                        <CommandItem
                                                            key={sku.id}
                                                            value={`${sku.product_name || ''} ${sku.sku_code || sku.sku || ''}`}
                                                            onSelect={() => {
                                                                setFormData({ ...formData, sku_id: String(sku.id) });
                                                                setSkuSearchTerm('');
                                                                setProductPickerOpen(false);
                                                            }}
                                                        >
                                                            <div className="flex flex-col">
                                                                <span className="text-sm">{sku.product_name || sku.sku_code || sku.sku}</span>
                                                                <span className="text-xs text-muted-foreground font-mono">{sku.sku_code || sku.sku || '-'}</span>
                                                            </div>
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </div>


                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">{t('adjustments.targetLocation')}</label>
                            <select
                                value={formData.location_id}
                                onChange={(e) => setFormData({ ...formData, location_id: e.target.value })}
                                className="w-full bg-background border border-input rounded-lg px-4 py-2 text-foreground focus:ring-2 focus:ring-emerald-500/50 outline-none transition-all"
                            >
                                <option value="">{t('adjustments.selectLocation')}</option>
                                {locations.map(loc => (
                                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">{t('adjustments.currentQty')}</label>
                            <div className="w-full rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 px-4 py-2 font-mono text-lg font-semibold tabular-nums">
                                {formData.sku_id && formData.location_id
                                    ? currentQtyAtLocation !== null
                                        ? currentQtyAtLocation.toLocaleString()
                                        : '—'
                                    : '—'}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">{t('adjustments.adjustmentType')}</label>
                            <select
                                value={formData.type}
                                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                className={cn(
                                    "w-full bg-background border-2 rounded-lg px-4 py-2 font-bold outline-none transition-all",
                                    selectedCategory?.border || 'border-input',
                                    selectedCategory?.color || 'text-foreground'
                                )}
                            >
                                {CATEGORIES.map(cat => (
                                    <option key={cat.value} value={cat.value} className="bg-background text-foreground">{t(cat.labelKey)}</option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">
                                {t('adjustments.quantityTo')} {selectedCategory?.isAddition ? t('adjustments.add') : t('adjustments.remove')}
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={formData.quantity}
                                onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                                className={cn(
                                    "w-full bg-background border border-input rounded-lg px-4 py-2 text-foreground placeholder:text-muted-foreground focus:ring-2 outline-none transition-all font-bold",
                                    selectedCategory?.isAddition ? "focus:ring-emerald-500/50 text-emerald-600 dark:text-emerald-400" : "focus:ring-red-500/50 text-red-600 dark:text-red-400"
                                )}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">{t('adjustments.projectedQty')}</label>
                            <div
                                className={cn(
                                    'w-full rounded-lg border px-4 py-2 font-mono text-lg font-semibold tabular-nums',
                                    projectedQtyAfter !== null && projectedQtyAfter < 0
                                        ? 'border-destructive/60 bg-destructive/10 text-destructive'
                                        : 'border-muted-foreground/20 bg-muted/20 text-foreground'
                                )}
                            >
                                {formData.sku_id && formData.location_id && formData.quantity !== '' && projectedQtyAfter !== null
                                    ? projectedQtyAfter.toLocaleString()
                                    : '—'}
                            </div>
                        </div>

                        <div className="space-y-2 xl:col-span-3">
                            <label className="text-sm font-medium text-muted-foreground">{t('adjustments.notes')}</label>
                            <input
                                type="text"
                                placeholder={t('adjustments.notesPlaceholder')}
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                className="w-full bg-background border border-input rounded-lg px-4 py-2 text-foreground outline-none focus:border-emerald-500/50"
                            />
                        </div>

                        <div className="flex items-end xl:col-span-1">
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white py-2 rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-all font-bold"
                            >
                                {isSubmitting ? t('adjustments.processing') : t('adjustments.post')}
                            </button>
                        </div>
                    </form>

                    <div className="mt-6 p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/10 flex gap-4">
                        <AlertCircle className="text-emerald-500 shrink-0" size={20} />
                        <p className="text-xs text-emerald-700 dark:text-emerald-400/80 leading-relaxed">
                            <strong>{t('adjustments.important')}</strong> {t('adjustments.importantDesc')}
                        </p>
                    </div>
                </div>
            )}

            {/* History List */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                <div className="p-4 border-b border-border flex justify-between items-center bg-muted/20">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
                            <History size={18} />
                        </div>
                        <h3 className="font-semibold text-foreground">{t('adjustments.recent')}</h3>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                        <input
                            type="text"
                            placeholder={t('adjustments.searchHistory')}
                            className="bg-background border border-input rounded-lg pl-10 pr-4 py-1.5 text-sm text-foreground focus:ring-1 focus:ring-emerald-500 outline-none w-64"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    {isLoading ? (
                        <div className="py-20 flex flex-col items-center gap-3">
                            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                            <p className="text-muted-foreground text-sm animate-pulse">{t('adjustments.loading')}</p>
                        </div>
                    ) : adjustments.length === 0 ? (
                        <div className="py-20 text-center space-y-3">
                            <ClipboardList className="w-12 h-12 text-muted-foreground mx-auto" />
                            <p className="text-muted-foreground">{t('adjustments.empty')}</p>
                        </div>
                    ) : (
                        <table className="w-full text-left text-sm">
                            <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] font-bold tracking-wider">
                                <tr>
                                    <th className="px-6 py-4">{t('adjustments.dateStaff')}</th>
                                    <th className="px-6 py-4">{t('adjustments.productLocation')}</th>
                                    <th className="px-6 py-4">{t('adjustments.type')}</th>
                                    <th className="px-6 py-4">{t('adjustments.adjustment')}</th>
                                    <th className="px-6 py-4 text-right">{t('adjustments.valueImpact')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {adjustments.map((adj) => {
                                    const category = CATEGORIES.find(c => c.value === adj.type);
                                    return (
                                        <tr key={adj.id} className="hover:bg-muted/30 transition-colors group">
                                            <td className="px-6 py-4">
                                                <div className="space-y-0.5">
                                                    <div className="text-foreground font-medium">{new Date(adj.created_at).toLocaleDateString()}</div>
                                                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                                                        <Plus size={10} className="text-emerald-500" />
                                                        {adj.user?.name}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2 rounded bg-muted text-muted-foreground group-hover:text-emerald-500 transition-colors">
                                                        <Package size={16} />
                                                    </div>
                                                    <div>
                                                        <div className="font-semibold text-foreground">
                                                            {adj.sku?.product_name || adj.sku?.offer?.master_product?.internal_name || adj.sku?.sku_code || adj.sku?.sku || t('adjustments.unknownItem')}
                                                        </div>

                                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                            <MapPin size={10} />
                                                            {adj.location?.name}
                                                            <span className="text-muted-foreground">•</span>
                                                            <span className="font-mono">{adj.sku?.sku_code || adj.sku?.sku}</span>

                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-tighter", category?.bg, category?.color)}>
                                                    {category ? t(category.labelKey) : adj.type}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <span className={cn("font-bold", category?.isAddition ? "text-emerald-400" : "text-red-400")}>
                                                        {category?.isAddition ? '+' : '-'}{Math.abs(adj.quantity)}
                                                    </span>
                                                    <span className="text-muted-foreground">{t('adjustments.units')}</span>
                                                </div>
                                                {adj.notes && <div className="text-[10px] text-muted-foreground italic mt-1 max-w-[200px] truncate">{adj.notes}</div>}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="inline-flex flex-col items-end">
                                                    <div className={cn("flex items-center gap-1 font-bold", category?.isAddition ? "text-emerald-500" : "text-red-500")}>
                                                        <DollarSign size={14} />
                                                        {(adj.total_loss_amount || (adj.quantity * (adj.unit_cost || 0))).toLocaleString()}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground">{t('adjustments.cost')}: {adj.unit_cost || 0} {t('adjustments.perUnit')}</div>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}


