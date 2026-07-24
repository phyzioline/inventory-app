import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
    CheckCircle,
    XCircle,
    Link as LinkIcon,
    Plus,
    Search,
    AlertTriangle,
    Check,
    X,
    RefreshCw,
    Info,
    ChevronRight
} from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

interface MatchedProduct {
    id: number;
    internal_name: string;
    category: string;
}

interface DraftProduct {
    id: number;
    proposed_name: string;
    category: string;
    barcode: string;
    sku: string;
    specifications?: {
        min_stock?: number;
        selling_price?: number;
        cost_price?: number;
    };
    match_confidence: 'exact' | 'high' | 'low' | 'none';
    matched_product_id: number | null;
    matched_product?: MatchedProduct;
    status: 'pending' | 'approved' | 'rejected' | 'merged';
}

export default function DraftProductsReview() {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const [drafts, setDrafts] = useState<DraftProduct[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessing, setIsProcessing] = useState<number | null>(null);
    const [filter, setFilter] = useState<'pending' | 'approved'>('pending');
    const [pageSize, setPageSize] = useState(50);
    const [currentPage, setCurrentPage] = useState(1);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);

    useEffect(() => {
        fetchDrafts();
        setSelectedIds([]);
        setCurrentPage(1); // Reset page on filter change
    }, [filter]);

    const fetchDrafts = async () => {
        setIsLoading(true);
        try {
            // "approved" tab → backend uses "finished" to get approved+merged, newest first
            const apiStatus = filter === 'approved' ? 'finished' : filter;
            const response = await api.getArray(`import/products/drafts?status=${apiStatus}`);
            setDrafts(response);
        } catch (e) {
            toast.error('Failed to fetch draft products');
        } finally {
            setIsLoading(false);
        }
    };

    const totalPages = Math.ceil(drafts.length / pageSize);
    const paginatedDrafts = drafts.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    const processDraft = async (id: number, action: 'create_new' | 'link_existing' | 'reject', matchedId?: number) => {
        setIsProcessing(id);
        try {
            const response = await api.post(`import/products/drafts/${id}/process`, {
                action,
                matched_product_id: matchedId
            });
            toast.success('Action applied successfully');
            setDrafts(prev => prev.filter(d => d.id !== id));
            setSelectedIds(prev => prev.filter(selectedId => selectedId !== id));
        } catch (e: any) {
            const errorMsg = e.response?.data?.message || 'Failed to apply action';
            toast.error(errorMsg);
        } finally {
            setIsProcessing(null);
        }
    };

    const processBatch = async (action: 'create_new' | 'reject', idsOverride?: number[]) => {
        const idsToProcess = idsOverride ?? selectedIds;
        if (idsToProcess.length === 0) return;

        setIsLoading(true);
        try {
            const res = await api.post('import/products/drafts/batch', {
                ids: idsToProcess,
                action
            });
            const success = res?.results?.success ?? 0;
            const failed = res?.results?.failed ?? 0;
            const errors = res?.results?.errors ?? [];
            if (success > 0) {
                toast.success(`تم تحويل ${success} منتج بنجاح` + (failed > 0 ? ` (${failed} فشل)` : ''));
            }
            if (failed > 0) {
                const sample = errors.slice(0, 3).map((e: any) => `SKU ${e.sku}: ${e.message}`).join('؛ ');
                toast.error(
                    success === 0
                        ? `فشل تحويل ${failed} منتج.${sample ? ` أمثلة: ${sample}` : ''}`
                        : `${failed} منتج فشل تحويلها.${sample ? ` أمثلة: ${sample}` : ''}`
                );
            }
            setSelectedIds([]);
            fetchDrafts();
        } catch (e: any) {
            toast.error(e.response?.data?.message || 'فشل التحويل. جرّب مرة أخرى.');
            fetchDrafts();
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateAllPending = () => {
        const allPendingIds = drafts.map(d => d.id);
        if (allPendingIds.length === 0) return;
        if (!confirm(`تحويل ${allPendingIds.length} منتج دفعة واحدة إلى المنتجات الرئيسية؟`)) return;
        processBatch('create_new', allPendingIds);
    };

    const toggleSelectAll = () => {
        if (selectedIds.length === drafts.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(drafts.map(d => d.id));
        }
    };

    const toggleSelect = (id: number) => {
        setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const getConfidenceBadge = (confidence: string) => {
        switch (confidence) {
            case 'exact':
                return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500 text-white uppercase italic">Exact Match</span>;
            case 'high':
                return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500 text-white uppercase italic">High Match</span>;
            case 'low':
                return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-white uppercase italic">Low Match</span>;
            default:
                return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-600 text-white uppercase italic">New Product</span>;
        }
    };

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex justify-between items-end">
                <div>
                    <h1 className="text-2xl font-bold text-white mb-2">Review Import Drafts</h1>
                    <p className="text-gray-400">Review products from your last import before they go live.</p>
                </div>
                <div className="flex gap-4 items-center flex-wrap">
                    {drafts.length > 0 && filter === 'pending' && (
                        <button
                            onClick={handleCreateAllPending}
                            disabled={isLoading}
                            className="px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-500 transition-all shadow-lg flex items-center gap-2 disabled:opacity-50"
                        >
                            <Plus size={18} />
                            تحويل الكل ({drafts.length}) لمنتجات رئيسية
                        </button>
                    )}
                    {selectedIds.length > 0 && (
                        <div className="flex gap-2 animate-in fade-in slide-in-from-right-4">
                            <button
                                onClick={() => processBatch('create_new')}
                                disabled={isLoading}
                                className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-500 transition-all shadow-lg flex items-center gap-2 disabled:opacity-50"
                            >
                                <Plus size={16} />
                                Create {selectedIds.length} New
                            </button>
                            <button
                                onClick={() => processBatch('reject')}
                                disabled={isLoading}
                                className="px-4 py-1.5 bg-red-600/20 text-red-500 border border-red-500/30 rounded-lg text-sm font-bold hover:bg-red-600 hover:text-white transition-all shadow-lg disabled:opacity-50"
                            >
                                Discard {selectedIds.length}
                            </button>
                        </div>
                    )}
                    <div className="flex gap-2 items-center">
                        <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700">
                            <button
                                onClick={() => setFilter('pending')}
                                className={cn("px-4 py-1.5 rounded-md text-sm transition-all", filter === 'pending' ? "bg-emerald-600 text-white" : "text-gray-400 hover:text-white")}
                            >
                                Pending
                            </button>
                            <button
                                onClick={() => setFilter('approved')}
                                className={cn("px-4 py-1.5 rounded-md text-sm transition-all", filter === 'approved' ? "bg-emerald-600 text-white" : "text-gray-400 hover:text-white")}
                            >
                                Finished
                            </button>
                        </div>
                        {filter === 'approved' && (
                            <button
                                onClick={() => navigate('/master-products')}
                                className="px-4 py-1.5 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg text-sm font-bold hover:bg-blue-600 hover:text-white transition-all"
                            >
                                عرض المنتجات الرئيسية
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden shadow-2xl">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-4">
                        <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
                        <p className="text-gray-500 animate-pulse font-mono uppercase tracking-widest text-xs">Processing Database...</p>
                    </div>
                ) : drafts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                        <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center">
                            <CheckCircle className="w-8 h-8 text-gray-700" />
                        </div>
                        <div className="space-y-1">
                            <h3 className="text-lg font-medium text-white">No pending drafts</h3>
                            <p className="text-gray-500 max-w-xs mx-auto">All imported products have been reviewed or the list is empty.</p>
                        </div>
                        <button
                            onClick={() => navigate('/import/products')}
                            className="mt-4 px-6 py-2 bg-emerald-600 rounded-lg text-white hover:bg-emerald-500 transition-all"
                        >
                            Start New Import
                        </button>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-gray-800/50 border-b border-gray-800">
                                    <th className="px-6 py-4 w-10">
                                        <input
                                            type="checkbox"
                                            className="w-4 h-4 rounded border-gray-700 bg-gray-800 text-emerald-600 focus:ring-emerald-500"
                                            checked={selectedIds.length === drafts.length && drafts.length > 0}
                                            onChange={toggleSelectAll}
                                        />
                                    </th>
                                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-widest">Imported Info</th>
                                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-widest text-center">Match Engine Result</th>
                                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-widest text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800">
                                {paginatedDrafts.map((draft) => (
                                    <tr key={draft.id} className={cn("hover:bg-emerald-500/5 transition-colors group", selectedIds.includes(draft.id) && "bg-emerald-500/10")}>
                                        <td className="px-6 py-4">
                                            <input
                                                type="checkbox"
                                                className="w-4 h-4 rounded border-gray-700 bg-gray-800 text-emerald-600 focus:ring-emerald-500"
                                                checked={selectedIds.includes(draft.id)}
                                                onChange={() => toggleSelect(draft.id)}
                                            />
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="space-y-1">
                                                <div className="font-bold text-white group-hover:text-emerald-400 transition-colors uppercase tracking-tight">
                                                    {draft.proposed_name}
                                                </div>
                                                <div className="flex items-center gap-3 text-xs text-gray-500 font-mono">
                                                    <span className="bg-gray-800 px-1.5 py-0.5 rounded text-emerald-400 font-bold border border-emerald-500/20">{draft.sku || 'NO SKU'}</span>
                                                    {draft.barcode && <span className="opacity-60">Bar: {draft.barcode}</span>}
                                                    {draft.category && <span className="opacity-60">Cat: {draft.category}</span>}
                                                </div>
                                                <div className="flex items-center gap-4 text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-2">
                                                    {draft.specifications?.cost_price !== undefined && (
                                                        <span className="flex items-center gap-1 border-r border-gray-800 pr-3">
                                                            Cost: <span className="text-white">{draft.specifications.cost_price.toLocaleString()} EGP</span>
                                                        </span>
                                                    )}
                                                    {draft.specifications?.selling_price !== undefined && (
                                                        <span className="flex items-center gap-1 border-r border-gray-800 pr-3">
                                                            Sell: <span className="text-white">{draft.specifications.selling_price.toLocaleString()} EGP</span>
                                                        </span>
                                                    )}
                                                    {draft.specifications?.min_stock !== undefined && (
                                                        <span className="flex items-center gap-1 text-amber-500">
                                                            Stock Limit: {draft.specifications.min_stock}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center justify-center">
                                                <div className="flex flex-col items-center gap-1.5">
                                                    {filter === 'approved' ? (
                                                        <span className="px-2 py-1 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                                            تمت الإضافة للماستر
                                                        </span>
                                                    ) : (
                                                        getConfidenceBadge(draft.match_confidence)
                                                    )}
                                                    {draft.matched_product ? (
                                                        <Link
                                                            to={`/master-products/${draft.matched_product_id}`}
                                                            className="text-[11px] text-emerald-400 flex items-center gap-1 font-bold hover:underline"
                                                        >
                                                            <Check size={12} />
                                                            {draft.matched_product.internal_name}
                                                        </Link>
                                                    ) : filter === 'pending' && (
                                                        <div className="text-[10px] text-gray-500 flex items-center gap-1 italic opacity-60">
                                                            <Info size={12} />
                                                            Creating New Entry
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            {filter === 'pending' ? (
                                            <div className="flex justify-end gap-2">
                                                {draft.match_confidence !== 'none' && draft.matched_product_id ? (
                                                    <button
                                                        disabled={isProcessing === draft.id}
                                                        onClick={() => processDraft(draft.id, 'link_existing', draft.matched_product_id!)}
                                                        className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600/10 text-emerald-400 rounded-lg hover:bg-emerald-600 text-xs font-bold hover:text-white transition-all border border-emerald-600/30"
                                                    >
                                                        <LinkIcon size={14} />
                                                        Apply Match
                                                    </button>
                                                ) : null}

                                                <button
                                                    disabled={isProcessing === draft.id}
                                                    onClick={() => processDraft(draft.id, 'create_new')}
                                                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/10 text-blue-400 rounded-lg hover:bg-blue-600 text-xs font-bold hover:text-white transition-all border border-blue-600/30"
                                                >
                                                    <Plus size={14} />
                                                    Add New
                                                </button>

                                                <button
                                                    disabled={isProcessing === draft.id}
                                                    onClick={() => processDraft(draft.id, 'reject')}
                                                    className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                                                    title="Discard Import"
                                                >
                                                    <X size={18} />
                                                </button>
                                            </div>
                                            ) : draft.matched_product_id ? (
                                                <Link
                                                    to={`/master-products/${draft.matched_product_id}`}
                                                    className="text-xs text-blue-400 hover:underline"
                                                >
                                                    عرض في الماستر
                                                </Link>
                                            ) : null}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Pagination Controls */}
                {!isLoading && drafts.length > pageSize && (
                    <div className="flex justify-between items-center px-6 py-4 border-t border-gray-800 bg-gray-900/30">
                        <div className="text-xs text-gray-500 font-mono">
                            Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, drafts.length)} of {drafts.length}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="px-3 py-1 bg-gray-800 text-gray-400 rounded hover:text-white disabled:opacity-30 disabled:hover:text-gray-400 transition-all text-xs font-bold"
                            >
                                Previous
                            </button>
                            <div className="flex items-center gap-1 font-mono text-xs text-emerald-500">
                                {currentPage} / {totalPages}
                            </div>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="px-3 py-1 bg-gray-800 text-gray-400 rounded hover:text-white disabled:opacity-30 disabled:hover:text-gray-400 transition-all text-xs font-bold"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Legend / Info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-gray-800/30 border border-gray-800 p-4 rounded-xl flex gap-4 items-start">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                        <CheckCircle className="text-emerald-500" size={20} />
                    </div>
                    <div>
                        <h4 className="text-sm font-semibold text-white mb-1">Deduplication Matching</h4>
                        <p className="text-xs text-gray-500 leading-relaxed">The system uses fuzzy logic to identify if products in your Excel already exist in our database. Link them to prevent duplicates.</p>
                    </div>
                </div>
                <div className="bg-gray-800/30 border border-gray-800 p-4 rounded-xl flex gap-4 items-start">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                        <Plus className="text-blue-500" size={20} />
                    </div>
                    <div>
                        <h4 className="text-sm font-semibold text-white mb-1">Create New Products</h4>
                        <p className="text-xs text-gray-500 leading-relaxed">Choose "Create New" only if you are sure this product is genuinely unique to your system and has never been imported before.</p>
                    </div>
                </div>
                <div className="bg-gray-800/30 border border-gray-800 p-4 rounded-xl flex gap-4 items-start">
                    <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                        <AlertTriangle className="text-amber-500" size={20} />
                    </div>
                    <div>
                        <h4 className="text-sm font-semibold text-white mb-1">Human Validation</h4>
                        <p className="text-xs text-gray-500 leading-relaxed">AI performs the match, but a human must confirm. Reviewing ensures your inventory records stay clean and reconciled.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
