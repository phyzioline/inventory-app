import { useState, useMemo, useEffect, Fragment, useCallback } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { productService, skuService, offerService } from "@/lib/supabase-services";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2, Package, Upload, Search, ChevronRight, ChevronDown, ExternalLink, Tag, Image as ImageIcon, AlertCircle, RefreshCw, ChevronLeft, X, Warehouse, Info, ArrowDownWideNarrow, ArrowUpWideNarrow, Route } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useWarehouses } from "@/hooks/useWarehouses";
import AddSKUDialog from "@/components/inventory/AddSKUDialog";
import { SkuMovementTrackerDialog } from "@/components/inventory/SkuMovementTrackerDialog";
import { ChannelsWidget } from "@/components/inventory/ChannelsWidget";
import { getProductImageSrc } from "@/lib/utils";
import { sumWarehouseSummary, type WarehouseSummaryRow } from "@/lib/warehouseSummaryAggregation";
import { api, apiClient } from "@/lib/api";
import { broadcastInventoryCatalogUpdated } from "@/lib/inventoryCatalogBroadcast";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface MasterProduct {
    id: string;
    internal_name: string;
    category: string;
    image_url?: string;
    specifications: any;
    original_supplier: string;
    original_supplier_sku: string;
    is_active: boolean;
    created_at: string;
    cost_price?: number;
    selling_price?: number;
    offers?: any[];
    total_stock?: number;
    purchase_balance?: number;
    last_purchase_price?: number;
    min_stock?: number;
}

type SortField = "internal_name" | "original_supplier" | "last_purchase_price" | "selling_price" | "total_stock" | "is_active";

const resolveMasterPurchasePrice = (product: MasterProduct): number => {
    const skus = Array.isArray(product.offers) ? product.offers.flatMap((o: any) => Array.isArray(o.skus) ? o.skus : []) : [];
    const skuWithCost = skus.find((s: any) => Number(s.cost_price || 0) > 0);
    if (skuWithCost) return Number(skuWithCost.cost_price);
    if (Number(product.cost_price || 0) > 0) return Number(product.cost_price);
    if (Number(product.last_purchase_price || 0) > 0) return Number(product.last_purchase_price);
    return 0;
};

/** Rolls up SKU inventory lines into quantities per warehouse for the expanded row. */
const aggregateStockByWarehouse = (
    product: MasterProduct,
    warehousesList: { id: string; name: string }[]
): { warehouseId: string; name: string; qty: number }[] => {
    const map = new Map<string, number>();
    const offers = Array.isArray(product.offers) ? product.offers : [];
    for (const offer of offers) {
        const skus = Array.isArray(offer?.skus) ? offer.skus : [];
        for (const sku of skus) {
            const invs = Array.isArray(sku?.inventory) ? sku.inventory : [];
            for (const inv of invs) {
                const wid = String(inv.location_id ?? inv.location?.id ?? inv.warehouse_id ?? "").trim();
                if (!wid) continue;
                map.set(wid, (map.get(wid) || 0) + Number(inv.quantity || 0));
            }
        }
    }
    return Array.from(map.entries())
        .map(([warehouseId, qty]) => ({
            warehouseId,
            name: warehousesList.find((w) => String(w.id) === warehouseId)?.name || `مخزن (${warehouseId.slice(0, 8)}…)`,
            qty,
        }))
        .filter((r) => r.qty !== 0)
        .sort((a, b) => Math.abs(b.qty) - Math.abs(a.qty));
};

const MasterProducts = () => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { data: warehouses = [] } = useWarehouses();
    const { data: salesChannels = [] } = useQuery({
        queryKey: ["channels"],
        queryFn: () => api.getArray("/channels"),
    });
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<MasterProduct | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [showEmptyProducts, setShowEmptyProducts] = useState(false);
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [isAddSkuOpen, setIsAddSkuOpen] = useState(false);
    const [formData, setFormData] = useState({
        internal_name: "",
        category: "",
        specifications: "",
        notes: "",
        original_supplier: "",
        original_supplier_sku: "",
        cost_price: "",
        selling_price: "",
        min_stock: "",
        barcode: "",
    });
    const [productFormAdvancedOpen, setProductFormAdvancedOpen] = useState(false);

    const [activeOfferId, setActiveOfferId] = useState<string | undefined>(undefined);
    const [firstOfferGuide, setFirstOfferGuide] = useState<{ productId: string; productName: string } | null>(null);
    const [firstOfferChannelId, setFirstOfferChannelId] = useState("");
    const [presetSkuChannelId, setPresetSkuChannelId] = useState<string | undefined>(undefined);
    const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
    const [editingSku, setEditingSku] = useState<any>(null);
    const [isBulkLinkingOpen, setIsBulkLinkingOpen] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize] = useState(50);
    const [sortField, setSortField] = useState<SortField>("internal_name");
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
    const [trackerOpen, setTrackerOpen] = useState(false);
    const [trackerSkuId, setTrackerSkuId] = useState<number | null>(null);
    const [trackerMasterId, setTrackerMasterId] = useState<number | null>(null);
    const [trackerTitle, setTrackerTitle] = useState("");

    // Fetch master products page-by-page (show first chunk immediately).
    const [masterProducts, setMasterProducts] = useState<MasterProduct[] | undefined>(undefined);
    const [loadingProducts, setLoadingProducts] = useState(true);
    const [loadingMoreProducts, setLoadingMoreProducts] = useState(false);
    const [productsLoadFailed, setProductsLoadFailed] = useState(false);
    const [productsLoadError, setProductsLoadError] = useState<Error | null>(null);
    const [loadProgress, setLoadProgress] = useState({ page: 0, lastPage: 0, total: 0 });

    const loadMasterProducts = useCallback(async () => {
        setLoadingProducts(true);
        setLoadingMoreProducts(false);
        setProductsLoadFailed(false);
        setProductsLoadError(null);
        setMasterProducts([]);
        setLoadProgress({ page: 0, lastPage: 0, total: 0 });

        const perPage = 80;
        const acc: MasterProduct[] = [];

        const fetchPage = async (page: number) => {
            const res = await apiClient.get("/master-products", {
                params: { paginate: 1, page, per_page: perPage },
            });
            const payload = res.data as {
                data?: any[];
                last_page?: number;
                total?: number;
            };
            return {
                page,
                chunk: (Array.isArray(payload?.data) ? payload.data : []).map((mp: any) =>
                    productService.transformMasterProduct(mp)
                ),
                lastPage: typeof payload?.last_page === "number" ? payload.last_page : 1,
                total: typeof payload?.total === "number" ? payload.total : 0,
            };
        };

        try {
            const first = await fetchPage(1);
            acc.push(...first.chunk);
            setMasterProducts([...acc]);
            setLoadProgress({ page: 1, lastPage: first.lastPage, total: first.total || acc.length });
            setLoadingProducts(false);

            const lastPage = Math.min(first.lastPage, 50);
            if (lastPage <= 1) {
                queryClient.setQueryData(["master-products"], acc);
                return;
            }

            setLoadingMoreProducts(true);
            const remaining = Array.from({ length: lastPage - 1 }, (_, i) => i + 2);
            const batchSize = 4;
            for (let i = 0; i < remaining.length; i += batchSize) {
                const batch = remaining.slice(i, i + batchSize);
                const results = await Promise.all(batch.map((p) => fetchPage(p)));
                results.sort((a, b) => a.page - b.page);
                for (const result of results) {
                    acc.push(...result.chunk);
                }
                setMasterProducts([...acc]);
                setLoadProgress({
                    page: results[results.length - 1]?.page ?? batch[batch.length - 1],
                    lastPage,
                    total: first.total || acc.length,
                });
            }
            queryClient.setQueryData(["master-products"], acc);
        } catch (error: any) {
            setProductsLoadFailed(acc.length === 0);
            setProductsLoadError(error instanceof Error ? error : new Error(String(error?.message || "Failed")));
            if (acc.length > 0) {
                setMasterProducts(acc);
                queryClient.setQueryData(["master-products"], acc);
            }
        } finally {
            setLoadingProducts(false);
            setLoadingMoreProducts(false);
        }
    }, [queryClient]);

    useEffect(() => {
        loadMasterProducts();
    }, [loadMasterProducts]);

    const { data: warehouseSummaryRows = [], isFetched: warehouseSummaryFetched } = useQuery({
        queryKey: ["warehouses-summary"],
        queryFn: () => api.getArray("/warehouses/summary"),
        staleTime: 120_000,
        placeholderData: (prev) => prev,
    });

    const stats = useMemo(() => {
        const catalog = masterProducts ?? [];
        const LOCAL_CHANNEL_KEYS = new Set([
            'store',
            'shop',
            'physical',
            'المحل',
            'المخزن',
        ]);

        const hasAnySku = (product: any) => {
            const offers = Array.isArray(product?.offers) ? product.offers : [];
            return offers.some((o: any) => Array.isArray(o?.skus) && o.skus.length > 0);
        };

        const hasExternalLinkedSku = (product: any) => {
            const offers = Array.isArray(product?.offers) ? product.offers : [];
            const skus = offers.flatMap((o: any) => (Array.isArray(o?.skus) ? o.skus : []));
            if (skus.length === 0) return false;

            return skus.some((sku: any) => {
                const channelId = String(sku?.channel_id ?? '').trim();
                const channelSlug = String(sku?.channel?.slug ?? '').toLowerCase().trim();
                const channelName = String(sku?.channel?.name ?? '').toLowerCase().trim();

                if (!channelId) return false;
                // If SKU is linked only to local/store channel, keep it as "unlinked" for marketplace linking purposes.
                if (LOCAL_CHANNEL_KEYS.has(channelSlug) || LOCAL_CHANNEL_KEYS.has(channelName)) return false;
                return true;
            });
        };

        const fromMasterProductsValue = catalog.reduce((acc, p) => {
            const qty = Number(p.total_stock || 0);
            const cost = resolveMasterPurchasePrice(p);
            return acc + (qty > 0 && cost > 0 ? qty * cost : 0);
        }, 0);
        const fromMasterProductsItems = catalog.reduce((acc, p) => {
            const qty = Number(p.total_stock || 0);
            return acc + (qty > 0 ? qty : 0);
        }, 0);

        const whRows = Array.isArray(warehouseSummaryRows) ? warehouseSummaryRows : [];
        const warehouseTotals = sumWarehouseSummary(whRows as WarehouseSummaryRow[]);
        const fromWarehousesItems = warehouseTotals.totalQuantity;
        const fromWarehousesCost = warehouseTotals.totalCost;

        // Prefer warehouse rollup when the summary API returned real totals (same source as channel cards).
        const hasWarehouseTotals =
            warehouseSummaryFetched &&
            whRows.length > 0 &&
            (fromWarehousesCost > 0 || fromWarehousesItems > 0);

        const totalFromApi = loadProgress.total > 0 ? loadProgress.total : 0;

        return {
            totalProducts: totalFromApi > 0 ? totalFromApi : catalog.length,
            unlinkedProducts: catalog.filter((p) => !hasExternalLinkedSku(p)).length,
            totalInventoryValue: hasWarehouseTotals ? fromWarehousesCost : fromMasterProductsValue,
            totalItems: hasWarehouseTotals ? fromWarehousesItems : fromMasterProductsItems,
        };
    }, [masterProducts, warehouseSummaryRows, warehouseSummaryFetched, loadProgress.total]);

    const filteredProducts = useMemo(() => {
        if (!masterProducts) return [];
        const hasAnySku = (product: any) => {
            const offers = Array.isArray(product?.offers) ? product.offers : [];
            return offers.some((o: any) => Array.isArray(o?.skus) && o.skus.length > 0);
        };
        const baseList = showEmptyProducts
            ? masterProducts
            : masterProducts.filter((p: any) => hasAnySku(p) || Number(p.total_stock || 0) > 0);
        const query = searchQuery.trim().toLowerCase();
        if (!query) return baseList;

        return baseList.filter((p) => {
            const categoryName = typeof p.category === 'object' && p.category ? (p.category as any).name : (p.category || "");
            const barcode = p.specifications?.barcode || "";
            const offerSkus = (Array.isArray(p.offers) ? p.offers : [])
                .flatMap((offer: any) => Array.isArray(offer?.skus) ? offer.skus : [])
                .map((sku: any) => `${sku?.sku || ''} ${sku?.name || ''} ${sku?.channel?.name || ''}`)
                .join(' ')
                .toLowerCase();

            return (
                p.internal_name?.toLowerCase().includes(query) ||
                categoryName.toLowerCase().includes(query) ||
                p.original_supplier?.toLowerCase().includes(query) ||
                p.original_supplier_sku?.toLowerCase().includes(query) ||
                barcode.toLowerCase().includes(query) ||
                String(p.id || '').toLowerCase().includes(query) ||
                offerSkus.includes(query)
            );
        });
    }, [masterProducts, searchQuery, showEmptyProducts]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery]);

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
        } else {
            setSortField(field);
            setSortDirection(field === "internal_name" ? "asc" : "desc");
        }
    };

    const sortIcon = (field: SortField) =>
        sortField === field
            ? sortDirection === "desc"
                ? <ArrowDownWideNarrow className="w-3 h-3 ms-1" />
                : <ArrowUpWideNarrow className="w-3 h-3 ms-1" />
            : null;

    const sortedProducts = useMemo(() => {
        const list = [...filteredProducts];
        const mul = sortDirection === "asc" ? 1 : -1;
        list.sort((a: any, b: any) => {
            let cmp = 0;
            switch (sortField) {
                case "internal_name":
                    cmp = String(a?.internal_name || "").localeCompare(String(b?.internal_name || ""), undefined, { sensitivity: "base" });
                    break;
                case "original_supplier":
                    cmp = String(a?.original_supplier || "").localeCompare(String(b?.original_supplier || ""), undefined, { sensitivity: "base" });
                    break;
                case "last_purchase_price":
                    cmp = resolveMasterPurchasePrice(a) - resolveMasterPurchasePrice(b);
                    break;
                case "selling_price":
                    cmp = Number(a?.selling_price || 0) - Number(b?.selling_price || 0);
                    break;
                case "total_stock":
                    cmp = Number(a?.total_stock || 0) - Number(b?.total_stock || 0);
                    break;
                case "is_active":
                    cmp = Number(!!a?.is_active) - Number(!!b?.is_active);
                    break;
                default:
                    cmp = 0;
            }
            return cmp * mul;
        });
        return list;
    }, [filteredProducts, sortField, sortDirection]);

    const totalPages = Math.ceil(sortedProducts.length / pageSize);
    const paginatedProducts = sortedProducts.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    const toggleSelectProduct = (id: string) => {
        const newSelected = new Set(selectedProducts);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedProducts(newSelected);
    };

    const toggleSelectAll = () => {
        if (selectedProducts.size === filteredProducts.length && filteredProducts.length > 0) {
            setSelectedProducts(new Set());
        } else {
            setSelectedProducts(new Set(filteredProducts.map(p => p.id)));
        }
    };

    const handleEditSku = (sku: any) => {
        setEditingSku(sku);
        setActiveOfferId(sku.offer_id);
        setIsAddSkuOpen(true);
    };

    const sumInventoryQty = (sku: any) => {
        const invs = Array.isArray(sku?.inventory) ? sku.inventory : [];
        return invs.reduce((sum: number, inv: any) => sum + Number(inv?.quantity || 0), 0);
    };

    /** Match MasterProductController — this SKU only at its channel warehouse locations. */
    const sumChannelStockForSkuRow = (sku: any, _product: MasterProduct) => {
        const apiDisplay =
            sku.display_quantity != null && sku.display_quantity !== undefined
                ? Number(sku.display_quantity)
                : null;
        if (apiDisplay != null && !Number.isNaN(apiDisplay)) {
            return apiDisplay;
        }

        const channelId = Number(sku?.channel_id ?? sku?.channel?.id ?? 0);
        if (!channelId) {
            return sumInventoryQty(sku);
        }

        const invs = Array.isArray(sku?.inventory) ? sku.inventory : [];
        let ownAtChannel = 0;
        for (const inv of invs) {
            const locChannelId = Number(inv?.location?.channel_id ?? inv?.location?.channel?.id ?? 0);
            if (locChannelId === channelId) {
                ownAtChannel += Number(inv?.quantity || 0);
            }
        }

        const locs = Array.isArray(sku?.channel?.locations) ? [...sku.channel.locations] : [];
        locs.sort((a: any, b: any) => Number(a.id) - Number(b.id));
        const linked = String(locs[0]?.id ?? sku?.channel?.linked_location_id ?? '').trim();
        if (linked) {
            const atLinked = invs
                .filter((inv: any) => String(inv?.location_id ?? '') === linked)
                .reduce((sum: number, inv: any) => sum + Number(inv?.quantity || 0), 0);
            if (atLinked > 0 || ownAtChannel <= 0) {
                return atLinked;
            }
        }

        return ownAtChannel;
    };

    const handleDeleteSku = async (sku: any) => {
        const skuId = String(sku?.id || "").trim();
        if (!skuId) return;
        const skuCode = String(sku?.sku || sku?.sku_code || "").trim() || skuId;
        const confirmed = confirm(
            `حذف SKU «${skuCode}»؟\n\nسيتم حذف العرض الفرعي (SKU) والمخزون المرتبط به. المنتج الأساسي لن يُحذف.`
        );
        if (!confirmed) return;

        try {
            await skuService.delete(skuId);
            toast({
                title: "تم حذف الـ SKU",
                description: `تم حذف ${skuCode} بنجاح.`,
            });
            invalidateMasterProductPageData();
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "فشل حذف الـ SKU",
                description: error?.response?.data?.message || error?.message || "تعذر حذف الـ SKU",
            });
        }
    };

    const handleCloseAddSku = () => {
        setIsAddSkuOpen(false);
        setEditingSku(null);
        setActiveOfferId(undefined);
        setPresetSkuChannelId(undefined);
    };

    const createFirstOfferMutation = useMutation({
        mutationFn: async ({
            productId,
            productName,
            channelId,
        }: {
            productId: string;
            productName: string;
            channelId: string;
        }) => {
            const channel = (salesChannels as any[]).find((c) => String(c.id) === channelId);
            const channelLabel = String(channel?.name || "").trim();
            const offer = await offerService.create({
                master_product_id: productId,
                name: channelLabel ? `${productName} — ${channelLabel}` : productName,
                type: "single",
            });
            return { offer, channelId };
        },
        onSuccess: ({ offer, channelId }) => {
            invalidateMasterProductPageData();
            setFirstOfferGuide(null);
            setActiveOfferId(String(offer.id));
            setPresetSkuChannelId(channelId);
            setEditingSku(null);
            setIsAddSkuOpen(true);
            toast({
                title: "عرض البيع جاهز",
                description: "أكمل بيانات الـ SKU (الكود، السعر، …) ثم احفظ.",
            });
        },
        onError: (error: any) => {
            toast({
                variant: "destructive",
                title: "تعذر إنشاء عرض البيع",
                description: error?.response?.data?.message || error?.message || "حدث خطأ",
            });
        },
    });

    const startFirstOfferForProduct = (productId: string, productName: string, channelId: string) => {
        if (!channelId) {
            toast({
                variant: "destructive",
                title: "اختر قناة البيع",
                description: "حدد المنصة أو المحل الذي تريد إنشاء عرض البيع (SKU) عليه.",
            });
            return;
        }
        createFirstOfferMutation.mutate({ productId, productName, channelId });
    };

    const invalidateMasterProductPageData = () => {
        loadMasterProducts();
        queryClient.invalidateQueries({ queryKey: ["master-products"] });
        queryClient.invalidateQueries({ queryKey: ["warehouses-summary"] });
        queryClient.invalidateQueries({ queryKey: ["channels-all-skus-metrics"] });
        // Orders / profit read effective cost via API hydration; refresh after SKU↔master fixes.
        queryClient.invalidateQueries({ queryKey: ["orders-for-profit"] });
        queryClient.invalidateQueries({ queryKey: ["profit-summary"] });
        queryClient.invalidateQueries({ queryKey: ["profit-by-sku"] });
        broadcastInventoryCatalogUpdated('master-products');
    };

    const handleBulkLink = () => {
        if (selectedProducts.size === 0) return;
        setIsBulkLinkingOpen(true);
    };

    const bulkDeleteMutation = useMutation({
        mutationFn: async () => {
            return await productService.bulkDelete(Array.from(selectedProducts));
        },
        onSuccess: (data: any) => {
            toast({
                title: "تم الحذف بنجاح",
                description: `تم حذف ${data?.deleted ?? selectedProducts.size} منتج من المنتجات الرئيسية.`,
            });
            setSelectedProducts(new Set());
            invalidateMasterProductPageData();
        },
        onError: (error: any) => {
            toast({
                variant: "destructive",
                title: "فشل الحذف",
                description: error.message || "لم يتم حذف المنتجات",
            });
        },
    });

    const handleBulkDelete = () => {
        if (selectedProducts.size === 0) return;
        if (!confirm(`هل تريد حذف ${selectedProducts.size} منتج؟ سيؤثر ذلك على جميع العروض والـ SKU المرتبطة.`)) return;
        bulkDeleteMutation.mutate();
    };

    const confirmBulkLink = useMutation({
        mutationFn: async () => {
            await productService.bulkLink(Array.from(selectedProducts));
        },
        onSuccess: () => {
            toast({
                title: "تم الربط بنجاح",
                description: `تم ربط ${selectedProducts.size} منتجات بالمخزن الرئيسي وتوحيد المخزون.`,
            });
            setSelectedProducts(new Set());
            setIsBulkLinkingOpen(false);
            invalidateMasterProductPageData();
        }
    });

    const regenerateMutation = useMutation({
        mutationFn: async () => {
            return await productService.regenerateMasterProducts();
        },
        onSuccess: (data: any) => {
            toast({
                title: "تمت استعادة المنتجات",
                description: `تم استعادة ${data.count || ''} منتجات من السجلات السابقة.`,
            });
            invalidateMasterProductPageData();
        },
        onError: (error: any) => {
            toast({
                variant: "destructive",
                title: "خطأ في الاستعادة",
                description: error.message || "فشل استعادة المنتجات المفقودة",
            });
        }
    });

    const handleAddSku = (offerId: string) => {
        setActiveOfferId(offerId);
        setIsAddSkuOpen(true);
    };

    const toggleRow = (productId: string) => {
        const newExpanded = new Set(expandedRows);
        if (newExpanded.has(productId)) {
            newExpanded.delete(productId);
        } else {
            newExpanded.add(productId);
        }
        setExpandedRows(newExpanded);
    };

    // Create/Update mutation
    const saveMutation = useMutation({
        mutationFn: async (data: typeof formData) => {
            let specObj: Record<string, unknown> = {};
            if (data.specifications?.trim()) {
                try {
                    specObj = JSON.parse(data.specifications) as Record<string, unknown>;
                } catch {
                    throw new Error("البيانات الإضافية (JSON) غير صالحة");
                }
            }
            if (data.notes?.trim()) specObj.notes = data.notes.trim();
            else delete specObj.notes;

            if (data.min_stock?.trim()) specObj.min_stock = data.min_stock;
            if (data.barcode?.trim()) specObj.barcode = data.barcode;

            const payload: Record<string, unknown> = {
                internal_name: data.internal_name,
                category: data.category || "",
                original_supplier: data.original_supplier || "",
                original_supplier_sku: data.original_supplier_sku || "",
                specifications: specObj,
            };
            if (data.cost_price !== "") payload.cost_price = data.cost_price;
            if (data.selling_price !== "") payload.selling_price = data.selling_price;

            if (editingProduct) {
                await productService.update(editingProduct.id, payload);
                return { mode: "update" as const };
            }
            const created = await productService.create(payload);
            return { mode: "create" as const, created };
        },
        onSuccess: (result) => {
            invalidateMasterProductPageData();
            if (result?.mode === "update") {
                toast({
                    title: "تم التحديث",
                    description: `تم تحديث «${formData.internal_name}».`,
                });
                handleCloseDialog();
                return;
            }
            const created = result?.created;
            const productId = String(created?.id ?? "").trim();
            const productName = String(created?.internal_name || formData.internal_name || "").trim();
            handleCloseDialog();
            if (productId) {
                setExpandedRows((prev) => new Set(prev).add(productId));
            }
            toast({
                title: "تم إنشاء منتج جديد",
                description: `تم حفظ المنتج الأساسي «${productName}». الخطوة التالية: إنشاء أول عرض بيع (SKU) على قناة البيع.`,
            });
            if (productId) {
                setFirstOfferChannelId("");
                setFirstOfferGuide({ productId, productName });
            }
        },
        onError: (error: any) => {
            toast({
                variant: "destructive",
                title: "تعذر الحفظ",
                description: error?.message || "حدث خطأ أثناء حفظ المنتج",
            });
        },
    });

    // Delete mutation
    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            await productService.delete(id);
        },
        onSuccess: () => {
            invalidateMasterProductPageData();
            toast({
                title: "تم الحذف",
                description: "تم حذف المنتج الأساسي والارتباطات المرتبطة به.",
            });
        },
        onError: (error: any) => {
            toast({
                variant: "destructive",
                title: "تعذر الحذف",
                description: error?.message || "فشل حذف المنتج",
            });
        },
    });

    const handleCloseDialog = () => {
        setIsDialogOpen(false);
        setEditingProduct(null);
        setProductFormAdvancedOpen(false);
        setFormData({
            internal_name: "",
            category: "",
            specifications: "",
            notes: "",
            original_supplier: "",
            original_supplier_sku: "",
            cost_price: "",
            selling_price: "",
            min_stock: "",
            barcode: "",
        });
    };

    const handleSyncAll = () => {
        toast({
            title: "قيد المزامنة",
            description: "يتم الآن تحديث المخزون والأسعار عبر جميع المنصات...",
        });
        // Here you would call an API to trigger sync
    };

    const handleEdit = (product: MasterProduct) => {
        setEditingProduct(product);
        const rawSpec =
            product.specifications && typeof product.specifications === "object"
                ? (product.specifications as Record<string, unknown>)
                : {};
        const { notes: specNotes, ...restSpec } = rawSpec as { notes?: string; [k: string]: unknown };
        const notesVal = specNotes != null ? String(specNotes) : "";
        setFormData({
            internal_name: product.internal_name,
            category:
                product.category && typeof product.category === "object"
                    ? (product.category as any).name
                    : (product.category as any) || "",
            specifications: Object.keys(restSpec).length ? JSON.stringify(restSpec, null, 2) : "",
            notes: notesVal,
            original_supplier: product.original_supplier || "",
            original_supplier_sku: product.original_supplier_sku || "",
            // New products may not have last_purchase_price yet; fall back to cost_price.
            cost_price: (product.cost_price ?? product.last_purchase_price)?.toString() || "",
            selling_price: product.selling_price?.toString() || "",
            min_stock: product.min_stock?.toString() || "",
            barcode: String((rawSpec as { barcode?: string })?.barcode || ""),
        });
        setProductFormAdvancedOpen(true);
        setIsDialogOpen(true);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        saveMutation.mutate(formData);
    };

    return (
        <div className="p-6 space-y-6">
            {/* Dashboard Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <Card className="bg-white dark:bg-slate-900 border-l-2 border-l-blue-500 shadow-sm transition-all hover:shadow-md">
                    <CardContent className="pt-1.5 pb-1.5 px-3">
                        <div className="flex justify-between items-center">
                            <div>
                                <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">المنتجات الأساسية</p>
                                <h3 className="text-base font-bold mt-0 leading-tight">{stats.totalProducts}</h3>
                            </div>
                            <Package className="h-4 w-4 text-blue-500 opacity-30" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-white dark:bg-slate-900 border-l-2 border-l-orange-500 shadow-sm transition-all hover:shadow-md">
                    <CardContent className="pt-1.5 pb-1.5 px-3">
                        <div className="flex justify-between items-center">
                            <div>
                                <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">إجمالي القطع المتاحة</p>
                                <h3 className="text-base font-bold mt-0 leading-tight font-mono">
                                    {Math.round(stats.totalItems).toLocaleString()}
                                </h3>
                            </div>
                            <Package className="h-4 w-4 text-orange-500 opacity-30" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-white dark:bg-slate-900 border-l-2 border-l-green-500 shadow-sm transition-all hover:shadow-md">
                    <CardContent className="pt-1.5 pb-1.5 px-3">
                        <div className="flex justify-between items-start gap-2">
                            <div className="min-w-0 flex-1">
                                <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">تكلفة البضاعة بالمخازن</p>
                                <h3 className="text-base font-bold mt-0 leading-tight text-green-600 dark:text-green-500">
                                    {Math.round(stats.totalInventoryValue).toLocaleString()}{" "}
                                    <span className="text-[9px] font-normal text-muted-foreground">EGP</span>
                                </h3>
                                <p className="text-[8px] text-muted-foreground leading-snug mt-1">
                                    تقدير للمخزون الحالي (كميات × تكلفة وحدة). لا يساوي إجمالي المدفوع للموردين في المالية.
                                </p>
                            </div>
                            <Tag className="h-4 w-4 text-green-500 opacity-30 shrink-0 mt-0.5" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Channels & Warehouses Summary Widget */}
            <ChannelsWidget />

            {/* Bulk Action Bar */}
            {selectedProducts.size > 0 && (
                <div className="sticky top-0 z-30 bg-primary text-primary-foreground p-3 rounded-lg shadow-lg flex items-center justify-between animate-in slide-in-from-top duration-300">
                    <div className="flex items-center gap-4">
                        <span className="font-bold">{selectedProducts.size} منتجات محددة</span>
                        <div className="h-4 w-px bg-primary-foreground/30" />
                        <Button variant="secondary" size="sm" onClick={handleBulkLink} disabled={confirmBulkLink.isPending}>
                            <RefreshCw className={`mr-2 h-4 w-4 ${confirmBulkLink.isPending ? 'animate-spin' : ''}`} />
                            🔗 ربط بالمخزن الرئيسي وتوحيد المخزون
                        </Button>
                        <Button variant="secondary" size="sm" className="bg-destructive/20 text-destructive hover:bg-destructive/30" onClick={handleBulkDelete} disabled={bulkDeleteMutation.isPending}>
                            <Trash2 className={`mr-2 h-4 w-4 ${bulkDeleteMutation.isPending ? 'animate-pulse' : ''}`} />
                            حذف المجموعة
                        </Button>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedProducts(new Set())}>إلغاء</Button>
                </div>
            )}

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-xl font-bold">المنتجات الأساسية</h1>
                    <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">
                        الاسم اللي بتشتري بيه من المورد (مش اسم العرض على أمازون/نون). الكميات الفعلية في{" "}
                        <span className="font-medium text-foreground">المخازن</span>؛ وكل اسم وSKU على المنصة يُسجَّل كـ{" "}
                        <span className="font-medium text-foreground">عرض بيع</span> تحت نفس المنتج الأساسي.
                    </p>
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-2 w-full md:w-auto">
                    <div className="relative w-full sm:w-[380px]">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-primary/70" />
                        <Input
                            placeholder="ابحث بالاسم أو SKU أو باركود أو مورد..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 pr-9 h-10 border-primary/20 focus-visible:ring-primary/30 bg-background/80"
                        />
                        {searchQuery ? (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
                                aria-label="Clear search"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        ) : null}
                        <p className="mt-1 text-[11px] text-muted-foreground">
                            البحث يشمل: اسم المنتج - SKU - المورد - الباركود
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                            <Checkbox
                                id="show-empty-products"
                                checked={showEmptyProducts}
                                onCheckedChange={(v) => setShowEmptyProducts(Boolean(v))}
                            />
                            <Label htmlFor="show-empty-products" className="text-[11px] text-muted-foreground cursor-pointer">
                                إظهار المنتجات بدون عروض/مخزون
                            </Label>
                        </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                        <Button variant="outline" size="sm" onClick={handleSyncAll}>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            تزامن الآن
                        </Button>
                        {stats.unlinkedProducts > 0 && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => regenerateMutation.mutate()}
                                disabled={regenerateMutation.isPending}
                                className="border-orange-500/20 text-orange-400 hover:bg-orange-500/10"
                            >
                                <RefreshCw className={`mr-2 h-4 w-4 ${regenerateMutation.isPending ? "animate-spin" : ""}`} />
                                {regenerateMutation.isPending ? "جاري الاستعادة..." : "استعادة المنتجات المفقودة"}
                            </Button>
                        )}
                        <Link to="/import/products">
                            <Button variant="outline" size="sm">
                                <Upload className="mr-2 h-4 w-4" />
                                استيراد/تصدير
                            </Button>
                        </Link>
                        <Dialog
                            open={isDialogOpen}
                            onOpenChange={(open) => {
                                if (!open) handleCloseDialog();
                                else {
                                    setIsDialogOpen(true);
                                    if (!editingProduct) setProductFormAdvancedOpen(false);
                                }
                            }}
                        >
                            <DialogTrigger asChild>
                                <Button size="sm">
                                    <Plus className="mr-2 h-4 w-4" />
                                    إضافة منتج أساسي
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                                <DialogHeader>
                                    <DialogTitle>
                                        {editingProduct ? "تعديل منتج أساسي" : "إضافة منتج أساسي"}
                                    </DialogTitle>
                                </DialogHeader>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <Label htmlFor="internal_name" className="flex items-center gap-1">
                                            اسم المنتج الأساسي
                                            <span className="text-destructive">*</span>
                                            <span title="الاسم اللي بتشتري وتتعامل بيه داخليًا؛ لازم يكون مميز. مش اسم العرض على المنصة.">
                                                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                                            </span>
                                        </Label>
                                        <Input
                                            id="internal_name"
                                            value={formData.internal_name}
                                            onChange={(e) =>
                                                setFormData({ ...formData, internal_name: e.target.value })
                                            }
                                            required
                                            placeholder="مثال: مجموعة هاند جريب"
                                            dir="auto"
                                        />
                                        <p className="text-xs text-muted-foreground mt-1">
                                            ده اللي بتسجّل بيه المشتريات؛ عروض البيع والـ SKU على كل منصة تتضاف من القائمة أو من «أماكن البيع».
                                        </p>
                                    </div>

                                    <div>
                                        <Label htmlFor="original_supplier" className="flex items-center gap-1">
                                            اسم المورد
                                            <span className="text-muted-foreground font-normal text-xs">(اختياري)</span>
                                        </Label>
                                        <Input
                                            id="original_supplier"
                                            value={formData.original_supplier}
                                            onChange={(e) =>
                                                setFormData({ ...formData, original_supplier: e.target.value })
                                            }
                                            placeholder="موردك المعتاد له الصنف"
                                            dir="auto"
                                        />
                                    </div>

                                    <div>
                                        <Label htmlFor="notes">ملاحظات</Label>
                                        <Textarea
                                            id="notes"
                                            value={formData.notes}
                                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                            placeholder="أي تفاصيل تساعدك تفتكر الصنف…"
                                            rows={3}
                                            dir="auto"
                                        />
                                    </div>

                                    <Collapsible open={productFormAdvancedOpen} onOpenChange={setProductFormAdvancedOpen}>
                                        <CollapsibleTrigger asChild>
                                            <button
                                                type="button"
                                                className="text-sm text-primary hover:underline w-full text-start py-1"
                                            >
                                                {productFormAdvancedOpen ? "▼ إخفاء الخيارات المتقدمة" : "▶ خيارات متقدمة (تصنيف، كود مورد، أسعار، باركود، JSON…)"}
                                            </button>
                                        </CollapsibleTrigger>
                                        <CollapsibleContent className="space-y-4 pt-2 border-t mt-2">
                                            <div>
                                                <Label htmlFor="category">التصنيف</Label>
                                                <Input
                                                    id="category"
                                                    value={formData.category}
                                                    onChange={(e) =>
                                                        setFormData({ ...formData, category: e.target.value })
                                                    }
                                                    placeholder="اختياري"
                                                    dir="auto"
                                                />
                                            </div>
                                            <div>
                                                <Label htmlFor="original_supplier_sku">كود الصنف عند المورد</Label>
                                                <Input
                                                    id="original_supplier_sku"
                                                    value={formData.original_supplier_sku}
                                                    onChange={(e) =>
                                                        setFormData({
                                                            ...formData,
                                                            original_supplier_sku: e.target.value,
                                                        })
                                                    }
                                                    placeholder="اختياري"
                                                    dir="auto"
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <Label htmlFor="cost_price">تكلفة (ج.م)</Label>
                                                    <Input
                                                        id="cost_price"
                                                        type="number"
                                                        value={formData.cost_price}
                                                        onChange={(e) =>
                                                            setFormData({ ...formData, cost_price: e.target.value })
                                                        }
                                                        placeholder="0.00"
                                                    />
                                                </div>
                                                <div>
                                                    <Label htmlFor="selling_price">سعر بيع (ج.م)</Label>
                                                    <Input
                                                        id="selling_price"
                                                        type="number"
                                                        value={formData.selling_price}
                                                        onChange={(e) =>
                                                            setFormData({ ...formData, selling_price: e.target.value })
                                                        }
                                                        placeholder="0.00"
                                                    />
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <Label htmlFor="min_stock">تنبيه حد أدنى للمخزون</Label>
                                                    <Input
                                                        id="min_stock"
                                                        type="number"
                                                        value={formData.min_stock}
                                                        onChange={(e) =>
                                                            setFormData({ ...formData, min_stock: e.target.value })
                                                        }
                                                        placeholder="مثال: 10"
                                                    />
                                                </div>
                                                <div>
                                                    <Label htmlFor="barcode">الباركود</Label>
                                                    <Input
                                                        id="barcode"
                                                        value={formData.barcode}
                                                        onChange={(e) =>
                                                            setFormData({ ...formData, barcode: e.target.value })
                                                        }
                                                        placeholder="EAN / UPC"
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <Label htmlFor="specifications">بيانات إضافية (JSON)</Label>
                                                <Textarea
                                                    id="specifications"
                                                    value={formData.specifications}
                                                    onChange={(e) =>
                                                        setFormData({ ...formData, specifications: e.target.value })
                                                    }
                                                    placeholder='{"color": "black"}'
                                                    rows={3}
                                                    className="font-mono text-xs"
                                                    dir="ltr"
                                                />
                                            </div>
                                        </CollapsibleContent>
                                    </Collapsible>

                                    <div className="flex justify-end gap-2 pt-2">
                                        <Button type="button" variant="outline" onClick={handleCloseDialog}>
                                            إلغاء
                                        </Button>
                                        <Button type="submit" disabled={saveMutation.isPending}>
                                            {saveMutation.isPending ? "جاري الحفظ…" : "حفظ المنتج"}
                                        </Button>
                                    </div>
                                </form>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Package className="h-5 w-5" />
                        قائمة المنتجات الأساسية
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                        {filteredProducts.length.toLocaleString()} نتيجة من{" "}
                        {(loadProgress.total || masterProducts?.length || 0).toLocaleString()}
                        {loadingMoreProducts && loadProgress.lastPage > 1
                            ? ` — جاري تحميل الصفحة ${loadProgress.page + 1} من ${loadProgress.lastPage}…`
                            : ""}
                    </p>
                </CardHeader>
                <CardContent>
                    {loadingProducts && !masterProducts?.length ? (
                        <div className="text-center py-8 text-muted-foreground">جاري تحميل المنتجات…</div>
                    ) : productsLoadFailed && !masterProducts?.length ? (
                        <div className="text-center py-12">
                            <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
                            <h3 className="text-lg font-semibold mb-2">تعذّر تحميل المنتجات الأساسية</h3>
                            <p className="text-muted-foreground mb-4 max-w-md mx-auto">
                                {productsLoadError instanceof Error
                                    ? productsLoadError.message
                                    : "حدث خطأ أثناء الاتصال بالخادم. جرّب إعادة التحميل."}
                            </p>
                            <Button variant="outline" onClick={() => loadMasterProducts()} disabled={loadingProducts || loadingMoreProducts}>
                                <RefreshCw className={`mr-2 h-4 w-4 ${loadingProducts || loadingMoreProducts ? "animate-spin" : ""}`} />
                                إعادة المحاولة
                            </Button>
                        </div>
                    ) : masterProducts && masterProducts.length > 0 ? (
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/30">
                                    <TableHead className="w-[40px] p-0">
                                        <div className="flex items-center justify-center h-full">
                                            <input
                                                type="checkbox"
                                                className="w-4 h-4 rounded border-gray-300 cursor-pointer"
                                                checked={filteredProducts.length > 0 && selectedProducts.size === filteredProducts.length}
                                                onChange={toggleSelectAll}
                                            />
                                        </div>
                                    </TableHead>
                                    <TableHead className="w-[40px]"></TableHead>
                                    <TableHead className="w-[60px]">الصورة</TableHead>
                                    <TableHead>
                                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 font-semibold" onClick={() => handleSort("internal_name")}>
                                            اسم المنتج الأساسي
                                            {sortIcon("internal_name")}
                                        </Button>
                                    </TableHead>
                                    <TableHead>
                                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 font-semibold" onClick={() => handleSort("original_supplier")}>
                                            المورد
                                            {sortIcon("original_supplier")}
                                        </Button>
                                    </TableHead>
                                    <TableHead>
                                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 font-semibold" onClick={() => handleSort("last_purchase_price")}>
                                            آخر سعر شراء
                                            {sortIcon("last_purchase_price")}
                                        </Button>
                                    </TableHead>
                                    <TableHead>
                                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 font-semibold" onClick={() => handleSort("selling_price")}>
                                            سعر البيع
                                            {sortIcon("selling_price")}
                                        </Button>
                                    </TableHead>
                                    <TableHead>
                                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 font-semibold" onClick={() => handleSort("total_stock")}>
                                            إجمالي المخزون
                                            {sortIcon("total_stock")}
                                        </Button>
                                    </TableHead>
                                    <TableHead>
                                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 font-semibold" onClick={() => handleSort("is_active")}>
                                            الحالة
                                            {sortIcon("is_active")}
                                        </Button>
                                    </TableHead>
                                    <TableHead className="text-right">الإجراءات</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {paginatedProducts.map((product) => (
                                    <Fragment key={String(product.id)}>
                                        <TableRow
                                            className={`hover:bg-muted/50 cursor-pointer h-16 ${selectedProducts.has(String(product.id)) ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}
                                            onClick={(e) => {
                                                if (!(e.target as HTMLElement).closest('[data-actions]')) toggleRow(String(product.id));
                                            }}
                                        >
                                            <TableCell onClick={(e) => { e.stopPropagation(); toggleSelectProduct(String(product.id)); }} className="p-0">
                                                <div className="flex items-center justify-center h-full">
                                                    <input
                                                        type="checkbox"
                                                        className="w-4 h-4 rounded border-gray-300"
                                                        checked={selectedProducts.has(String(product.id))}
                                                        onChange={() => { }} // Controlled by outer click
                                                    />
                                                </div>
                                            </TableCell>
                                            <TableCell onClick={(e) => { e.stopPropagation(); toggleRow(String(product.id)); }}>
                                                {expandedRows.has(String(product.id)) ? (
                                                    <ChevronDown className="h-4 w-4 text-primary" />
                                                ) : (
                                                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <div className="w-10 h-10 rounded-lg border bg-muted flex items-center justify-center overflow-hidden shadow-sm">
                                                    {product.image_url ? (
                                                        <img src={getProductImageSrc(product.image_url)} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                                    ) : (
                                                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="font-medium">
                                                <div className="flex flex-col">
                                                    <Link
                                                        to={`/master-products/${String(product.id)}`}
                                                        className="text-primary hover:underline flex items-center gap-1 font-bold decoration-primary/30"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        {product.internal_name}
                                                        <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                                                    </Link>
                                                    <span className="text-[10px] text-muted-foreground font-mono bg-muted w-fit px-1 rounded mt-1" title="معرّف السجل في النظام">
                                                        رقم السجل: {String(product.id).slice(0, 8)}…
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-sm">{product.original_supplier || "-"}</TableCell>
                                            <TableCell className="text-sm font-semibold">
                                                {resolveMasterPurchasePrice(product) > 0 ? `${resolveMasterPurchasePrice(product).toLocaleString()} ج.م` : "-"}
                                            </TableCell>
                                            <TableCell className="text-sm font-bold text-emerald-600">
                                                {product.selling_price ? `${Number(product.selling_price).toLocaleString()} ج.م` : "-"}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-slate-900">{product.total_stock || 0}</span>
                                                    {Number(product.purchase_balance) > 0 && (
                                                        <span className="text-[10px] text-orange-600 font-medium whitespace-nowrap" title="رصيد مشتريات قيد الاستلام">
                                                            + {product.purchase_balance} قيد التوريد
                                                        </span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={product.is_active ? "default" : "secondary"} className={`h-6 ${product.is_active ? 'bg-green-100 text-green-700 hover:bg-green-100 border-green-200' : ''}`}>
                                                    {product.is_active ? "نشط" : "معطل"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right p-0" data-actions>
                                                <div className="flex justify-end gap-1 relative z-20" data-actions>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-sky-600 shrink-0"
                                                        title="تتبع كل حركات المنتج الأساسي (كل عروض البيع)"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setTrackerSkuId(null);
                                                            setTrackerMasterId(Number(product.id));
                                                            setTrackerTitle(`تتبع المنتج الأساسي — ${product.internal_name}`);
                                                            setTrackerOpen(true);
                                                        }}
                                                    >
                                                        <Route className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-primary shrink-0"
                                                        onClick={(e) => { e.stopPropagation(); handleEdit(product); }}
                                                    >
                                                        <Edit className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-destructive shrink-0"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (
                                                                confirm(
                                                                    "حذف هذا المنتج الأساسي؟ سيتأثر كل عروض البيع والـ SKU المرتبطة به."
                                                                )
                                                            ) {
                                                                deleteMutation.mutate(product.id);
                                                            }
                                                        }}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>

                                        {expandedRows.has(product.id) && (
                                            <TableRow key={`${product.id}-expanded`} className="bg-slate-50/50 dark:bg-slate-900/50">
                                                <TableCell colSpan={10} className="p-0">
                                                    <div className="p-4 pl-12 border-l-2 border-primary/20 space-y-4">
                                                        {(() => {
                                                            const whRows = aggregateStockByWarehouse(product, warehouses);
                                                            return (
                                                                <div className="rounded-lg border bg-background/80 p-3">
                                                                    <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                                                                        <Warehouse className="h-4 w-4 text-primary" />
                                                                        الكميات حسب المخزن
                                                                    </h4>
                                                                    {whRows.length > 0 ? (
                                                                        <ul className="flex flex-wrap gap-2 text-xs">
                                                                            {whRows.map((row) => (
                                                                                <li
                                                                                    key={row.warehouseId}
                                                                                    className="rounded-md border px-2 py-1 bg-muted/40"
                                                                                >
                                                                                    <span className="font-medium">{row.name}</span>
                                                                                    <span className="text-muted-foreground mx-1">:</span>
                                                                                    <span className="font-mono font-bold">{row.qty}</span>
                                                                                </li>
                                                                            ))}
                                                                        </ul>
                                                                    ) : (
                                                                        <p className="text-xs text-muted-foreground">
                                                                            لا توجد كميات موزّعة على مخازن في بيانات العروض الحالية — الإجمالي أعلاه قد يكون من تجميع آخر أو لم يُحمَّل تفصيل المخزن بعد.
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            );
                                                        })()}

                                                        <div className="flex justify-between items-center">
                                                            <h4 className="text-sm font-semibold flex items-center gap-2">
                                                                <Tag className="h-4 w-4" />
                                                                عروض البيع (أسماء وأسعار وSKU على كل منصة)
                                                            </h4>
                                                        </div>

                                                        {product.offers && product.offers.length > 0 ? (
                                                            <div className="space-y-4">
                                                                {product.offers.map((offer) => (
                                                                    <div key={offer.id} className="bg-background rounded-lg border p-3">
                                                                        <div className="flex items-center justify-between mb-2">
                                                                            <span className="text-xs font-medium bg-muted px-2 py-0.5 rounded">
                                                                                عرض: {offer.name}
                                                                            </span>
                                                                            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                                                                <span className="text-[10px] text-muted-foreground">النوع: {offer.type}</span>
                                                                                <Button type="button" size="sm" variant="outline" className="h-6 text-[9px] px-2 shrink-0" onClick={(e) => { e.stopPropagation(); handleAddSku(offer.id); }}>
                                                                                    <Plus className="h-3 w-3 mr-1" />
                                                                                    إضافة عرض بيع (SKU)
                                                                                </Button>
                                                                            </div>
                                                                        </div>

                                                                        {offer.skus && offer.skus.length > 0 ? (
                                                                            <Table>
                                                                                <TableHeader className="bg-muted/50">
                                                                                    <TableRow className="hover:bg-transparent h-8">
                                                                                        <TableHead className="w-[50px]"></TableHead>
                                                                                        <TableHead className="h-7 text-[10px] py-0 text-muted-foreground uppercase tracking-wider">الصورة</TableHead>
                                                                                        <TableHead className="h-7 text-[10px] py-0 text-muted-foreground uppercase tracking-wider">كود SKU</TableHead>
                                                                                        <TableHead className="h-7 text-[10px] py-0 text-muted-foreground uppercase tracking-wider">اسم المنتج بالمنصة</TableHead>
                                                                                        <TableHead className="h-7 text-[10px] py-0 text-muted-foreground uppercase tracking-wider">المنصة</TableHead>
                                                                                        <TableHead className="h-7 text-[10px] py-0 text-muted-foreground uppercase tracking-wider">التكلفة</TableHead>
                                                                                        <TableHead className="h-7 text-[10px] py-0 text-muted-foreground uppercase tracking-wider">سعر البيع</TableHead>
                                                                                        <TableHead className="h-7 text-[10px] py-0 text-muted-foreground uppercase tracking-wider">حالة الربط</TableHead>
                                                                                        <TableHead className="h-7 text-[10px] py-0 text-muted-foreground uppercase tracking-wider">المخزون</TableHead>
                                                                                        <TableHead className="h-7 text-[10px] py-0 text-muted-foreground uppercase tracking-wider text-right">الإجراءات</TableHead>
                                                                                    </TableRow>
                                                                                </TableHeader>
                                                                                <TableBody>
                                                                                    {offer.skus.map((sku: any) => {
                                                                                        const margin = sku.selling_price && sku.cost_price
                                                                                            ? (((sku.selling_price - sku.cost_price) / sku.selling_price) * 100).toFixed(1)
                                                                                            : '0';
                                                                                        const apiDisplay =
                                                                                            sku.display_quantity != null && sku.display_quantity !== undefined
                                                                                                ? Number(sku.display_quantity)
                                                                                                : null;
                                                                                        const totalStock =
                                                                                            apiDisplay != null && !Number.isNaN(apiDisplay)
                                                                                                ? apiDisplay
                                                                                                : sumChannelStockForSkuRow(sku, product);
                                                                                        const isLinked = !!sku.channel_id;
                                                                                        const priceMismatch = product.selling_price && sku.selling_price && Math.abs(Number(product.selling_price) - Number(sku.selling_price)) > 1;

                                                                                        return (
                                                                                            <TableRow key={sku.id} className="hover:bg-muted/20 border-b-0 h-12">
                                                                                                <TableCell className="py-1">
                                                                                                    <div className="flex items-center justify-center">
                                                                                                        <RefreshCw className={`h-3 w-3 ${isLinked ? 'text-green-500' : 'text-slate-300'}`} />
                                                                                                    </div>
                                                                                                </TableCell>
                                                                                                <TableCell className="py-1">
                                                                                                    <div className="w-8 h-8 rounded border bg-muted flex items-center justify-center overflow-hidden">
                                                                                                        {sku.image_url || product.image_url ? (
                                                                                                            <img src={getProductImageSrc(sku.image_url || product.image_url)} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                                                                                        ) : (
                                                                                                            <ImageIcon className="h-3 w-3 text-muted-foreground" />
                                                                                                        )}
                                                                                                    </div>
                                                                                                </TableCell>
                                                                                                <TableCell className="py-1 text-xs font-mono">{sku.sku}</TableCell>
                                                                                                <TableCell className="py-1 text-xs font-semibold max-w-[200px]">
                                                                                                    <div className="flex flex-col gap-0.5">
                                                                                                        <span className="truncate">{sku.name || product.internal_name}</span>
                                                                                                        <span className="text-[10px] text-muted-foreground font-mono">{(sku.channel?.name ? `${sku.channel.name} · ` : '')}{sku.sku}</span>
                                                                                                    </div>
                                                                                                </TableCell>
                                                                                                <TableCell className="py-1 text-xs">
                                                                                                    <Badge variant="outline" className="text-[9px] h-4 bg-muted/50 border-primary/20">
                                                                                                        {sku.channel?.name || (isLinked ? 'قناة' : 'عام')}
                                                                                                    </Badge>
                                                                                                </TableCell>
                                                                                                <TableCell className="py-1 text-[11px] text-muted-foreground">{Number(sku.cost_price || resolveMasterPurchasePrice(product) || 0).toLocaleString()} ج.م</TableCell>
                                                                                                <TableCell className="py-1 text-xs font-bold text-blue-600">
                                                                                                    <div className="flex items-center gap-1">
                                                                                                        {Number(sku.selling_price || 0).toLocaleString()} ج.م
                                                                                                        {priceMismatch && (
                                                                                                            <span title="السعر يختلف عن المنتج الرئيسي">
                                                                                                                <AlertCircle className="h-3 w-3 text-orange-500" />
                                                                                                            </span>
                                                                                                        )}
                                                                                                    </div>
                                                                                                </TableCell>
                                                                                                <TableCell className="py-1 text-[11px]">
                                                                                                    <Badge variant={isLinked ? "default" : "outline"} className={`text-[9px] h-4 ${isLinked ? 'bg-green-100 text-green-700 hover:bg-green-100 border-green-200' : ''}`}>
                                                                                                        {isLinked ? 'مربوط' : 'غير مربوط'}
                                                                                                    </Badge>
                                                                                                </TableCell>
                                                                                                <TableCell className="py-1 text-xs">
                                                                                                    <Badge variant={totalStock > 0 ? "secondary" : "destructive"} className="text-[9px] h-4">
                                                                                                        {totalStock} قطعة
                                                                                                    </Badge>
                                                                                                </TableCell>
                                                                                                <TableCell className="py-1 text-right" onClick={(e) => e.stopPropagation()}>
                                                                                                    <Button
                                                                                                        type="button"
                                                                                                        variant="ghost"
                                                                                                        size="icon"
                                                                                                        className="h-6 w-6 shrink-0 text-sky-600"
                                                                                                        title="تتبع حركة هذا الـ SKU فقط"
                                                                                                        onClick={(e) => {
                                                                                                            e.stopPropagation();
                                                                                                            setTrackerMasterId(null);
                                                                                                            setTrackerSkuId(Number(sku.id));
                                                                                                            setTrackerTitle(`تتبع ${sku.sku}`);
                                                                                                            setTrackerOpen(true);
                                                                                                        }}
                                                                                                    >
                                                                                                        <Route className="h-3 w-3" />
                                                                                                    </Button>
                                                                                                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={(e) => { e.stopPropagation(); handleEditSku(sku); }}>
                                                                                                        <Edit className="h-3 w-3" />
                                                                                                    </Button>
                                                                                                    <Button
                                                                                                        type="button"
                                                                                                        variant="ghost"
                                                                                                        size="icon"
                                                                                                        className="h-6 w-6 shrink-0 text-destructive"
                                                                                                        title="حذف SKU"
                                                                                                        onClick={(e) => { e.stopPropagation(); handleDeleteSku(sku); }}
                                                                                                    >
                                                                                                        <Trash2 className="h-3 w-3" />
                                                                                                    </Button>
                                                                                                </TableCell>
                                                                                            </TableRow>
                                                                                        );
                                                                                    })}
                                                                                </TableBody>
                                                                            </Table>
                                                                        ) : (
                                                                            <p className="text-[10px] text-muted-foreground text-center py-2">لا يوجد SKU لهذا العرض بعد.</p>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <div className="text-center py-6 bg-muted/20 rounded-lg border border-dashed space-y-3">
                                                                <p className="text-xs text-muted-foreground">
                                                                    لا يوجد عرض بيع (SKU) بعد. أنشئ أول عرض على قناة البيع التي تبيع عليها (المحل، أمازون، نون، …).
                                                                </p>
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="default"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setFirstOfferChannelId("");
                                                                        setFirstOfferGuide({
                                                                            productId: String(product.id),
                                                                            productName: String(product.internal_name || ""),
                                                                        });
                                                                    }}
                                                                >
                                                                    <Plus className="h-3 w-3 mr-1" />
                                                                    إنشاء أول عرض بيع
                                                                </Button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </Fragment>
                                ))}
                            </TableBody>
                        </Table>
                    ) : (
                        <div className="text-center py-12">
                            <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                            <h3 className="text-lg font-semibold mb-2">لا توجد منتجات أساسية بعد</h3>
                            <p className="text-muted-foreground mb-4 max-w-md mx-auto">
                                ابدأ بإضافة اسم الصنف اللي بتشتري بيه؛ بعدين من «أماكن البيع» أو من التوسيع هنا تضيف عرض بيع وSKU لكل منصة.
                            </p>
                            <Button onClick={() => setIsDialogOpen(true)}>
                                <Plus className="mr-2 h-4 w-4" />
                                إضافة أول منتج أساسي
                            </Button>
                        </div>
                    )}
                </CardContent>
                {totalPages > 1 && (
                    <div className="flex justify-between items-center px-6 py-4 border-t bg-muted/10">
                        <div className="text-xs text-muted-foreground font-mono">
                            يتم عرض {((currentPage - 1) * pageSize) + 1} إلى {Math.min(currentPage * pageSize, filteredProducts.length)} من أصل {filteredProducts.length} منتج
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="h-8 w-8 p-0"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <div className="flex items-center gap-1 font-mono text-xs font-bold text-primary">
                                {currentPage} / {totalPages}
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="h-8 w-8 p-0"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </Card>

            <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200">
                <CardContent className="pt-6">
                    <h3 className="font-semibold mb-2 flex items-center gap-2">
                        <Info className="h-4 w-4" />
                        إزاي تفهم النظام بسرعة؟
                    </h3>
                    <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                        <li>
                            <strong className="text-foreground">المنتج الأساسي:</strong> الاسم اللي بتشتري بيه من المورد (مش اسم القائمة على أمازون).
                        </li>
                        <li>
                            <strong className="text-foreground">المخازن:</strong> المكان اللي فيه الكمية الفعلية بعد فاتورة الشراء.
                        </li>
                        <li>
                            <strong className="text-foreground">أماكن البيع:</strong> المنصة أو المحل اللي بتبيع عليه.
                        </li>
                        <li>
                            <strong className="text-foreground">عرض البيع (SKU):</strong> شكل المنتج وهو طالع للبيع في مكان معيّن — ممكن اسم مختلف وكود SKU مختلف لنفس المنتج الأساسي.
                        </li>
                        <li>
                            لما ترفع شيت طلبات، النظام يربط <strong className="text-foreground">الـ SKU → عرض البيع → المنتج الأساسي</strong> ثم يخصم من المخزون.
                        </li>
                    </ul>
                </CardContent>
            </Card>

            <Dialog
                open={!!firstOfferGuide}
                onOpenChange={(open) => {
                    if (!open) {
                        setFirstOfferGuide(null);
                        setFirstOfferChannelId("");
                    }
                }}
            >
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>تم إنشاء منتج جديد</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 text-sm">
                        <p>
                            تم حفظ المنتج الأساسي
                            {firstOfferGuide?.productName ? (
                                <> «<strong>{firstOfferGuide.productName}</strong>»</>
                            ) : null}
                            . لم يُنشأ أي عرض بيع تلقائيًا لتجنب الالتباس.
                        </p>
                        <p className="text-muted-foreground">
                            الخطوة التالية: <strong className="text-foreground">إنشاء أول عرض بيع (SKU)</strong> على القناة التي تبيع عليها.
                        </p>
                        <div>
                            <Label>قناة البيع</Label>
                            <Select value={firstOfferChannelId} onValueChange={setFirstOfferChannelId}>
                                <SelectTrigger className="mt-1">
                                    <SelectValue placeholder="اختر القناة (المحل، أمازون، نون…)" />
                                </SelectTrigger>
                                <SelectContent>
                                    {(salesChannels as any[]).map((ch) => (
                                        <SelectItem key={String(ch.id)} value={String(ch.id)}>
                                            {ch.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button type="button" variant="outline" onClick={() => setFirstOfferGuide(null)}>
                            لاحقًا
                        </Button>
                        <Button
                            type="button"
                            disabled={!firstOfferGuide || !firstOfferChannelId || createFirstOfferMutation.isPending}
                            onClick={() => {
                                if (!firstOfferGuide) return;
                                startFirstOfferForProduct(
                                    firstOfferGuide.productId,
                                    firstOfferGuide.productName,
                                    firstOfferChannelId
                                );
                            }}
                        >
                            {createFirstOfferMutation.isPending ? "جاري الإعداد…" : "متابعة — إنشاء عرض البيع"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <AddSKUDialog
                open={isAddSkuOpen}
                onOpenChange={handleCloseAddSku}
                offerId={activeOfferId || ""}
                skuId={editingSku?.id}
                initialData={editingSku}
                presetChannelId={presetSkuChannelId}
            />

            <SkuMovementTrackerDialog
                open={trackerOpen}
                onOpenChange={(open) => {
                    setTrackerOpen(open);
                    if (!open) {
                        setTrackerSkuId(null);
                        setTrackerMasterId(null);
                        setTrackerTitle("");
                    }
                }}
                skuId={trackerSkuId}
                masterProductId={trackerMasterId}
                title={trackerTitle || undefined}
            />
        </div >
    );
};

export default MasterProducts;
