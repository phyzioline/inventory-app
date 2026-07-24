import api, { apiClient } from '@/lib/api';
import {
    deriveFinancialStatusFromRaw,
    derivePhysicalStatusFromRaw,
} from '@/components/returns/returnDisplayUtils';
import {
    resolvePaidRemainingFromBatchNotes,
    resolvePurchasePaymentDisplayStatus,
} from '@/utils/purchasePaymentStatus';

/**
 * Load every page from a Laravel paginated inventory endpoint (default was 50 rows → KPIs understated).
 */
export async function fetchInventoryPaginatedList(
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<any[]> {
  const perPage = 40;
  const out: any[] = [];
  let page = 1;
  let lastPage = 1;
  const maxPages = 100;
  while (page <= lastPage && page <= maxPages) {
    const res = await apiClient.get(path, {
      params: {
        ...params,
        per_page: perPage,
        page,
      },
    });
    const payload = res.data as { data?: any[]; last_page?: number };
    const chunk = Array.isArray(payload?.data) ? payload.data : [];
    out.push(...chunk);
    lastPage = typeof payload?.last_page === 'number' ? payload.last_page : 1;
    page += 1;
  }
  return out;
}

// ==========================================
// INTERFACES (Matching Supabase Schema for UI Compatibility)
// ==========================================

export interface Profile {
    id: string;
    full_name: string | null;
    company_name: string | null;
    currency: string;
    created_at: string;
    updated_at: string;
}

export interface Warehouse {
    id: string;
    user_id: string;
    name: string;
    type: 'shop' | 'store' | 'amazon_fba' | 'marketplace' | 'channel' | 'physical';
    is_main: boolean;
    is_active?: boolean;
    channel_id?: string | null;
    wallet_balance: number;
    created_at: string;
    updated_at: string;
}

export interface Category {
    id: string;
    user_id: string;
    name: string;
    created_at: string;
}

export interface Product {
    id: string;
    user_id: string;
    name: string;
    sku: string;
    category_id: string | null;
    min_stock: number;
    max_stock: number | null;
    last_purchase_price: number | null;
    avg_purchase_price: number | null;
    lowest_price: number | null;
    highest_price: number | null;
    selling_price: number | null;
    images: string[];
    image_url?: string;
    created_at: string;
    updated_at: string;
    category?: Category;
    offers?: any[]; // Dynamic offers/variations
    internal_name?: string; // Original Laravel field
    product_name?: string;
    original_supplier?: string;

    original_supplier_sku?: string;
    specifications?: any;
    is_active?: boolean;
    total_stock?: number;
    purchase_balance?: number;
    cost_price?: number | null;
}

// ... Additional interfaces can be added as needed

// ==========================================
// SERVICES (Adapters for Laravel API)
// ==========================================

// ========== PROFILE SERVICE ==========
export const profileService = {
    async getProfile() {
        // In Laravel Sanctum, we usually get user via /auth/me or similar
        // We might need a specific profile endpoint if 'profiles' table is separate
        // For now, assuming user object contains profile data or separate endpoint
        try {
            const user = await api.me();
            return {
                id: user.id.toString(),
                full_name: user.name,
                company_name: user.company_name || 'My Company',
                currency: 'EGP',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            } as Profile;
        } catch (e) {
            console.error("Profile fetch error", e);
            throw e;
        }
    },

    async updateProfile(updates: Partial<Profile>) {
        // TODO: Implement update profile endpoint
        console.warn("updateProfile not fully implemented");
        return { ...updates } as Profile;
    },
};

// ========== WAREHOUSE SERVICE (Inventory Locations) ==========
export const warehouseService = {
    normalizeWarehouseType(type: any): Warehouse['type'] {
        const raw = String(type || '').toLowerCase();
        if (raw === 'shop' || raw === 'store' || raw === 'physical') return 'physical';
        if (raw === 'channel') return 'channel';
        if (raw === 'amazon_fba') return 'amazon_fba';
        if (raw === 'marketplace') return 'marketplace';
        return 'store';
    },

    async getAll(options?: { includeInactive?: boolean }) {
        const includeInactive = options?.includeInactive === true;
        const endpoint = includeInactive ? 'warehouses?include_inactive=1' : 'warehouses';
        const locations = await api.getArray(endpoint);
        return locations.map((loc: any) => ({
            id: loc.id.toString(),
            user_id: loc.user_id?.toString() || '1',
            name: loc.name,
            type: this.normalizeWarehouseType(loc.type),
            is_main: Boolean(loc.is_main),
            is_active: loc.is_active !== false,
            channel_id: loc.channel_id ? String(loc.channel_id) : null,
            wallet_balance: Number(loc.wallet_balance || 0),
            created_at: loc.created_at,
            updated_at: loc.updated_at
        })) as Warehouse[];
    },

    async getById(id: string) {
        const loc = await api.get(`warehouses/${id}`);
        return {
            id: loc.id.toString(),
            user_id: loc.user_id?.toString() || '1',
            name: loc.name,
            type: this.normalizeWarehouseType(loc.type),
            is_main: Boolean(loc.is_main),
            is_active: loc.is_active !== false,
            channel_id: loc.channel_id ? String(loc.channel_id) : null,
            wallet_balance: Number(loc.wallet_balance || 0),
            created_at: loc.created_at,
            updated_at: loc.updated_at
        } as Warehouse;
    },

    async create(warehouse: Omit<Warehouse, 'id' | 'user_id' | 'created_at' | 'updated_at'>) {
        const loc = await api.post('warehouses', {
            name: warehouse.name,
            type: this.normalizeWarehouseType(warehouse.type),
            is_main: warehouse.is_main,
            is_active: warehouse.is_active ?? true,
            // wallet_balance handled by default 0
        });
        return {
            id: loc.id.toString(),
            user_id: '1',
            name: loc.name,
            type: this.normalizeWarehouseType(loc.type),
            is_main: Boolean(loc.is_main),
            is_active: loc.is_active !== false,
            channel_id: loc.channel_id ? String(loc.channel_id) : null,
            wallet_balance: Number(loc.wallet_balance || 0),
            created_at: loc.created_at,
            updated_at: loc.updated_at
        } as Warehouse;
    },

    async update(id: string, updates: Partial<Warehouse>) {
        const payload = { ...updates } as any;
        if (payload.type) payload.type = this.normalizeWarehouseType(payload.type);
        const loc = await api.put(`warehouses/${id}`, payload);
        return {
            id: loc.id.toString(),
            // ... map fields
            name: loc.name,
            type: this.normalizeWarehouseType(loc.type),
            is_main: Boolean(loc.is_main),
            is_active: loc.is_active !== false,
            channel_id: loc.channel_id ? String(loc.channel_id) : null,
            wallet_balance: Number(loc.wallet_balance || 0),
            // ...
            created_at: loc.created_at,
            updated_at: loc.updated_at
        } as Warehouse;
    },

    async delete(id: string) {
        await api.delete(`warehouses/${id}`);
    },

    async updateWalletBalance(id: string, amount: number) {
        // TODO: Implement specialized endpoint or just use update
        // For now, fetch, calculate, update
        const w = await this.getById(id);
        return this.update(id, { wallet_balance: w.wallet_balance + amount });
    },
};

// ========== PRODUCT SERVICE (Master Products) ==========
export const productService = {
    async getAll() {
        const products = await fetchInventoryPaginatedList('master-products', { paginate: 1 });
        return products.map((mp: any) => this.transformMasterProduct(mp));
    },

    async getById(id: string) {
        const mp = await api.get(`master-products/${id}`);
        return this.transformMasterProduct(mp);
    },

    async create(product: any) {
        const mp = await api.post('master-products', product);
        return this.transformMasterProduct(mp);
    },

    async update(id: string, updates: any) {
        const mp = await api.put(`master-products/${id}`, updates);
        return this.transformMasterProduct(mp);
    },

    async delete(id: string) {
        await api.delete(`master-products/${id}`);
    },

    async bulkLink(ids: string[]) {
        return await api.post('master-products/bulk-link', { ids });
    },

    async bulkDelete(ids: string[]) {
        return await api.post('master-products/bulk-delete', { ids });
    },

    async regenerateMasterProducts() {
        return await api.post('admin/regenerate-master-products', {});
    },

    async bulkCreate(products: any[]) {
        const created: any[] = [];
        for (const p of products) {
            try {
                const res = await this.create(p);
                created.push(res);
            } catch (e) {
                console.error("Bulk create error", e);
            }
        }
        return created;
    },

    // Helper to transform Laravel MasterProduct to React Product
    transformMasterProduct(rawMp: any): Product {
        // Handle Laravel data wrapping if it exists
        const mp = (rawMp && rawMp.data && !Array.isArray(rawMp.data)) ? rawMp.data : rawMp;

        const defaultOffer = mp?.offers?.[0];
        const defaultSku = defaultOffer?.skus?.[0];
        const offers = Array.isArray(mp?.offers) ? mp.offers : [];

        return {
            id: mp?.id?.toString() || Math.random().toString(),
            user_id: '1',
            name: mp?.internal_name || mp?.product_name || 'Unnamed Product',
            internal_name: mp?.internal_name || 'Unnamed Product',
            product_name: mp?.product_name || mp?.internal_name || 'Unnamed Product',

            original_supplier: mp?.original_supplier || '',
            original_supplier_sku: mp?.original_supplier_sku || '',
            specifications: mp?.specifications || {},
            is_active: Boolean(mp?.is_active ?? true),
            sku: defaultSku?.sku || '',
            category_id: typeof mp?.category === 'object' ? mp.category?.id : mp?.category,
            category: typeof mp?.category === 'object' ? mp.category : (mp?.category ? { id: 'cat', user_id: '1', name: mp.category, created_at: '' } : undefined),
            min_stock: mp?.specifications?.min_stock || 0,
            max_stock: mp?.specifications?.max_stock || null,
            selling_price: Number(mp?.selling_price ?? defaultSku?.selling_price ?? 0),
            cost_price: mp?.cost_price !== undefined && mp?.cost_price !== null ? Number(mp.cost_price) : null,
            last_purchase_price: mp?.last_purchase_price !== undefined && mp?.last_purchase_price !== null ? Number(mp.last_purchase_price) : null,
            avg_purchase_price: Number(mp?.avg_purchase_price ?? defaultSku?.cost_price ?? 0),
            lowest_price: 0,
            highest_price: 0,
            images: mp?.specifications?.images || [],
            image_url: mp?.image_url || mp?.specifications?.images?.[0] || '',
            created_at: mp?.created_at || new Date().toISOString(),
            updated_at: mp?.updated_at || new Date().toISOString(),
            offers,
            skus: offers.flatMap((o: any) => (Array.isArray(o?.skus) ? o.skus : [])),
            needs_first_offer: Boolean(mp?.needs_first_offer),
            total_stock: Number(mp?.total_stock || 0),
            purchase_balance: Number(mp?.purchase_balance || 0),
        };
    }
};

// ========== ADDITIONAL INTERFACES ==========

export interface Supplier {
    id: string;
    user_id?: string;
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    balance: number;
    is_active: boolean;
    created_at?: string;
    updated_at?: string;
}

export interface SalesOrder {
    id: string;
    order_number: string;
    warehouse_id: string;
    customer_name?: string;
    total_amount: number;
    payment_type?: 'cash' | 'credit';
    paid_amount?: number;
    remaining_amount?: number;
    settlement_status?: string;
    financial_status?: string;
    status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
    marketplace_source?: string;
    external_order_number?: string;
    created_at?: string;
    updated_at?: string;
    items?: any[];
}

export interface PurchaseInvoice {
    id: string;
    invoice_number?: string;
    supplier_id: string;
    supplier_name?: string;
    warehouse_id: string;
    total_amount: number;
    paid_amount?: number;
    remaining_amount?: number;
    payment_type?: 'cash' | 'credit';
    item_count?: number;
    status: 'draft' | 'pending' | 'paid' | 'partially_paid' | 'cancelled';
    backend_status?: string;
    notes?: string;
    created_at?: string;
    updated_at?: string;
    items?: any[];
}

export interface ASIN {
    id: string;
    product_id: string;
    asin_code: string;
    marketplace?: string | null;
    notes?: string | null;
    status?: string | null;
    image_url?: string | null;
    display_price?: number | null;
    created_at?: string;
}

export interface StockMovement {
    id: string;
    product_id: string;
    from_store_id?: string;
    to_store_id?: string;
    movement_type: 'purchase' | 'sale' | 'transfer' | 'adjustment' | 'return' | 'initial';
    quantity: number;
    reference_id?: string;
    reference_number?: string;
    notes?: string;
    movement_date: string;
    created_at: string;
    product?: Product;
}

export interface Return {
    id: string;
    return_number?: string;
    return_type: 'sales_return' | 'purchase_return' | 'stock' | 'damaged';
    order_id?: string;
    reason?: string;
    refund_amount?: number;
    status: 'pending' | 'received' | 'refunded' | 'restocked';
    created_at?: string;
}

export interface Receipt {
    id: string;
    receipt_number: string;
    type: 'cash' | 'bank_transfer' | 'check' | 'other';
    amount: number;
    date: string;
    payer_type?: string;
    payer_id?: string;
    payer_name?: string;
    warehouse_id?: string;
    notes?: string;
    status: 'pending' | 'confirmed' | 'cancelled';
    created_at?: string;
}

export interface Payment {
    id: string;
    payment_number: string;
    type: 'cash' | 'bank_transfer' | 'check' | 'other';
    amount: number;
    date: string;
    payee_type?: string;
    payee_id?: string;
    payee_name?: string;
    warehouse_id?: string;
    notes?: string;
    status: 'pending' | 'confirmed' | 'cancelled';
    created_at?: string;
}

export interface Expense {
    id: string;
    description: string;
    category: string;
    amount: number;
    date: string;
    warehouse_id?: string;
    notes?: string;
    status: 'pending' | 'approved' | 'rejected';
    created_at?: string;
}

// ========== CATEGORY SERVICE ==========
export const categoryService = {
    async getAll() { return []; },
    async create(name: string) { return { id: '1', name }; }
};

// ========== OFFER SERVICE (Variations/Bundles) ==========
export const offerService = {
    async getAll(masterProductId?: string) {
        const endpoint = masterProductId ? `inventory-offers?master_product_id=${masterProductId}` : 'inventory-offers';
        return await api.getArray(endpoint);
    },

    async create(offer: any) {
        return await api.post('inventory-offers', offer);
    },

    async update(id: string, updates: any) {
        return await api.put(`inventory-offers/${id}`, updates);
    },

    async delete(id: string) {
        await api.delete(`inventory-offers/${id}`);
    }
};

// ========== SKU SERVICE (Channel Specifics) ==========
export const skuService = {
    async getAll(offerId?: string) {
        const endpoint = offerId ? `skus?offer_id=${offerId}` : 'skus';
        return await api.getArray(endpoint);
    },

    async create(sku: any) {
        return await api.post('skus', sku);
    },

    async update(id: string, updates: any) {
        return await api.put(`skus/${id}`, updates);
    },

    async delete(id: string) {
        await api.delete(`skus/${id}`);
    }
};



// ========== CHANNEL SERVICE ==========
export const channelService = {
    async getAll() {
        return await api.getArray('channels');
    },

    async create(data: any) {
        return await api.post('channels', data);
    },

    async update(id: string, updates: any) {
        return await api.put(`channels/${id}`, updates);
    },

    async delete(id: string) {
        await api.delete(`channels/${id}`);
    }
};

export const marketService = channelService;

export const asinService = {
    async getAll() {
        return await api.getArray('skus');
    },
    async getByProduct(id: string) {
        return await api.get(`skus?master_product_id=${id}`);
    },
    async create(data: any) {
        return await api.post('skus', data);
    },
    async update(id: string, data: any) {
        return await api.put(`skus/${id}`, data);
    },
    async delete(id: string) {
        await api.delete(`skus/${id}`);
    },
    async getPriceHistory(id: string) {
        return []; // To be implemented later
    }
};

export const inventoryService = {
    async getAll() {
        return await api.getArray('transactions');
    },
    async getByWarehouse(id: string) {
        return await api.getArray(`warehouses/${id}/inventory`);
    },
    async getByProduct(id: string) {
        return await api.getArray(`master-products/${id}/inventory`);
    },
    async getTotalStock(id: string) {
        const data = await api.get(`master-products/${id}/stock`);
        return data.total_stock || 0;
    },
    async updateStock(pid: string, wid: string, qty: number) {
        return await api.post('transactions', {
            sku_id: pid,
            location_id: wid,
            quantity: qty,
            type: 'ADJUSTMENT'
        });
    },
    async setStock(pid: string, wid: string, qty: number) {
        return await api.post('transactions', {
            sku_id: pid,
            location_id: wid,
            quantity: qty,
            type: 'SET'
        });
    }
};

export const supplierService = {
    async getAll() {
        return await api.getArray('suppliers');
    },
    async getById(id: string) {
        return await api.get(`suppliers/${id}`);
    },
    async create(data: any) {
        return await api.post('suppliers', data);
    },
    async update(id: string, data: any) {
        return await api.put(`suppliers/${id}`, data);
    },
    async delete(id: string) {
        await api.delete(`suppliers/${id}`);
    },
    async updateBalance(id: string, amt: number) {
        return await api.post(`suppliers/${id}/pay`, { amount: amt, payment_method: 'other' });
    }
};

export const purchaseInvoiceService = {
    async getAll(includeCancelled: boolean = false) {
        try {
            const perPage = 200;
            const batches: any[] = [];
            let page = 1;
            let lastPage = 1;
            const maxPages = 60;
            while (page <= lastPage && page <= maxPages) {
                const res = await apiClient.get('purchases/smart-import/batches', {
                    params: { per_page: perPage, page },
                });
                const payload = res.data as { data?: any[]; last_page?: number };
                const chunk = Array.isArray(payload?.data) ? payload.data : [];
                batches.push(...chunk);
                lastPage = typeof payload?.last_page === 'number' ? payload.last_page : 1;
                page += 1;
            }
            const mapped = batches.map((b: any) => {
                const totalAmount = Number(b.grand_total || b.subtotal || b.total_cost || b.total_amount || 0);
                const { paid: resolvedPaid, remaining: resolvedRemaining, type: resolvedType } =
                    resolvePaidRemainingFromBatchNotes(b.notes, totalAmount);
                const backendStatus = String(b.status || '').toLowerCase();
                const finalStatus = resolvePurchasePaymentDisplayStatus(
                    backendStatus,
                    resolvedPaid,
                    resolvedRemaining,
                    resolvedType
                );

                return {
                    id: b.id?.toString() || String(b.id),
                    batch_number: b.batch_number || '',
                    invoice_number: b.invoice_number || b.reference_number || b.batch_number || `BATCH-${b.id}`,
                    supplier_id: b.vendor_id?.toString() || b.supplier_id?.toString() || '',
                    supplier_name: b.vendor?.name || b.supplier?.name || '',
                    warehouse_id: b.location_id?.toString() || '',
                    total_amount: totalAmount,
                    paid_amount: resolvedPaid,
                    remaining_amount: resolvedRemaining,
                    payment_type: (resolvedType || (resolvedPaid >= totalAmount && totalAmount > 0 ? 'cash' : 'credit')) as 'cash' | 'credit',
                    item_count: Number(b.items_count || b.item_count || 0),
                    status: finalStatus as any,
                    backend_status: backendStatus,
                    notes: b.notes || null,
                    created_at: b.created_at,
                    updated_at: b.updated_at,
                    items: b.items || [],
                };
            });

            // When includeCancelled is false: only drop cancelled so totals align with supplier "total purchases".
            // Draft/review/pending stay visible to the app; UI may filter further.
            return includeCancelled
                ? mapped
                : mapped.filter((invoice: any) => String(invoice.status || '').toLowerCase() !== 'cancelled');
        } catch {
            return [];
        }
    },
    async getById(id: string) {
        return await api.get(`purchases/smart-import/batches/${id}`);
    },
    async create(data: any) {
        // Build a minimal purchase batch directly via the backend
        return await api.post('purchases/smart-import/batches' as any, {
            supplier_id: data.supplier_id,
            location_id: data.store_id || data.warehouse_id,
            reference_number: data.invoice_number,
            notes: data.notes,
            invoice_date: data.invoice_date,
            payment_method: data.payment_type || null,
            paid_amount: Number(data.paid_amount || 0),
            remaining_amount: Number(data.remaining_amount || 0),
            payment_status: data.payment_status || null,
            items: (data.items || []).map((item: any) => ({
                master_product_id: item.product_id,
                sku_id: item.sku_id || null,
                quantity: item.quantity,
                unit_price: item.unit_price,
            })),
        });
    }
};


export const salesOrderService = {
    async getAll() {
        return await api.getArray('orders');
    },
    async getById(id: string) {
        return await api.get(`orders/${id}`);
    },
    async create(data: any) {
        return await api.post('orders', data);
    },
    async updateStatus(id: string, status: string) {
        return await api.put(`orders/${id}`, { status });
    },
    async getProfitability(id: string) {
        return await api.get(`orders/${id}/profitability`);
    }
};

export const stockMovementService = {
    async getAll() {
        return await api.getArray('transactions');
    },
    async getByProduct(productId: string) {
        return await api.getArray(`transactions?sku_id=${productId}`);
    },
    async create(data: any) {
        return await api.post('transactions', data);
    },
    async transfer(fromWarehouseId: string, toWarehouseId: string, productId: string, quantity: number, notes?: string) {
        return await api.post('transactions/transfer', {
            sku_id: productId,
            from_location_id: fromWarehouseId,
            to_location_id: toWarehouseId,
            quantity: quantity,
            notes: notes || `Internal Transfer`,
        });
    }
};

// ========== SALES INVOICE SERVICE ==========
export const salesInvoiceService = {
    async getAll() {
        return await api.getArray('orders');
    },
    async getById(id: string) {
        return await api.get(`orders/${id}`);
    },
    async create(data: any) {
        return await api.post('orders', data);
    },
    async update(id: string, data: any) {
        return await api.put(`orders/${id}`, data);
    },
};

// ========== CUSTOMER SERVICE ==========
export const customerService = {
    async getAll() {
        try {
            return await api.getArray('customers');
        } catch {
            return [];
        }
    },
    async getById(id: string) {
        return await api.get(`customers/${id}`);
    },
    async create(data: any) {
        return await api.post('customers', data);
    },
    async update(id: string, data: any) {
        return await api.put(`customers/${id}`, data);
    },
    async delete(id: string) {
        await api.delete(`customers/${id}`);
    },
};

function resolveSkuImageUrl(sku: any): string {
    if (!sku) return '';
    const raw =
        sku?.offer?.master_product?.image_url ||
        sku?.offer?.masterProduct?.image_url ||
        sku?.image_url ||
        sku?.offer?.master_product?.image ||
        sku?.offer?.masterProduct?.image ||
        '';
    return typeof raw === 'string' ? raw : '';
}

// ========== RETURN SERVICE ==========
export const returnService = {
    normalizeReturnStatus(r: any): string {
        const lifecycle = (r.return_status || '').toString().toLowerCase();
        if (lifecycle === 'in_transit') return 'in_transit';
        if (lifecycle === 'arrived_to_warehouse') return 'received';
        if (lifecycle === 'restocked' || lifecycle === 'closed') return 'restocked';
        if (lifecycle === 'cancelled') return 'cancelled';
        if (lifecycle === 'lost') return 'lost';

        const internal = (r.status || '').toString().toLowerCase();
        if (internal === 'completed') return 'restocked';
        if (internal === 'approved') return 'received';
        if (internal === 'in_transit') return 'in_transit';

        const external = (r.external_status || '').toString().toLowerCase();
        if (external.includes('refund') || external.includes('chargeback')) return 'refunded';
        if (external.includes('transit') || external.includes('pickup') || external.includes('carrier')) return 'in_transit';

        return 'pending';
    },
    mapReturnRow(r: any) {
        const orderItems = Array.isArray(r.inventory_order?.items) ? r.inventory_order.items : [];
        const matchedItem = orderItems.find((item: any) => {
            const itemSku = (item?.sku?.sku || item?.sku_code || '').toString();
            return itemSku && itemSku === (r.sku_code || '').toString();
        }) || orderItems[0] || null;
        const productImageUrl =
            r.product_image_url ||
            resolveSkuImageUrl(matchedItem?.sku) ||
            null;

        const ch = r.inventory_order?.channel;
        const channelObj = ch
            ? { name: ch.name ?? null, slug: ch.slug ?? null }
            : null;

        return {
            id: r.id?.toString?.() || String(r.id),
            return_number: r.platform_return_id || `RET-${r.id}`,
            platform_return_id: r.platform_return_id || null,
            status: r.status || null,
            amazon_order_number: r.inventory_order?.platform_order_id || null,
            metadata: r.metadata && typeof r.metadata === 'object' ? r.metadata : {},
            order: r.inventory_order
                ? {
                    id: r.inventory_order.id?.toString?.() || String(r.inventory_order.id),
                    order_number: r.inventory_order.platform_order_id || `#${r.inventory_order.id}`,
                    order_date: r.inventory_order.order_date ?? null,
                    channel: channelObj,
                    items: orderItems.map((item: any) => ({
                        id: item.id?.toString?.() || String(item.id),
                        sku_code: item?.sku?.sku || item?.sku_code || null,
                        product_name: item?.product_name || null,
                        quantity: Number(item?.quantity || 0),
                        unit_price: Number(item?.unit_price || 0),
                    })),
                }
                : null,
            customer_name: r.inventory_order?.customer_name || null,
            return_type: r.disposition === 'sellable' ? 'stock' : 'damaged',
            return_status: this.normalizeReturnStatus(r),
            physical_status: derivePhysicalStatusFromRaw(r),
            financial_status: deriveFinancialStatusFromRaw(r),
            reason: r.reason || null,
            disposition: r.disposition || null,
            sku_code: r.sku_code || matchedItem?.sku_code || null,
            product_name: r.product_name || matchedItem?.product_name || null,
            product_image_url: productImageUrl,
            return_quantity: Number(r.return_quantity || 1),
            refund_amount: Number(r.refund_amount || 0),
            financial_deduction: Number(r.financial_deduction || 0),
            extra_shipping_fee: Number(r.extra_shipping_fee || 0),
            inventory_status: r.inventory_status || null,
            return_location: r.return_location || null,
            channel: channelObj?.name || r.channel || r.source_channel || r.inventory_order?.channel?.name || null,
            external_status: r.external_status || null,
            /** Posted transaction date from settlement / platform */
            transaction_return_date: r.return_date || null,
            return_date: r.last_update_date || r.return_date || null,
            last_update_date: r.last_update_date || null,
            created_at: r.created_at,
            order_date: r.inventory_order?.order_date ?? null,
        };
    },
    async getPage(options: { page?: number; perPage?: number; search?: string; pendingPhysical?: boolean; claimsHub?: boolean } = {}) {
        const page = options.page ?? 1;
        const perPage = options.perPage ?? 100;
        const response = await api.get('returns', {
            params: {
                page,
                per_page: perPage,
                search: options.search?.trim() || undefined,
                pending_physical: options.pendingPhysical ? 1 : undefined,
                claims_hub: options.claimsHub ? 1 : undefined,
            },
        });
        const rows = Array.isArray(response?.data) ? response.data : [];
        return {
            data: rows.map((r: any) => this.mapReturnRow(r)),
            current_page: Number(response?.current_page ?? page),
            last_page: Number(response?.last_page ?? 1),
            per_page: Number(response?.per_page ?? perPage),
            total: Number(response?.total ?? rows.length),
        };
    },
    /** Full export only — not for routine UI lists. */
    async exportAll(options?: { onProgress?: (rows: any[]) => void }) {
        try {
            const perPage = 500;
            const maxPages = 40;

            const fetchPage = async (page: number) => {
                const response = await api.get('returns', {
                    params: { per_page: perPage, page },
                });
                const rows = Array.isArray(response?.data) ? response.data : [];
                return {
                    page,
                    rows,
                    lastPage: Math.min(Number(response?.last_page || 1), maxPages),
                };
            };

            const first = await fetchPage(1);
            let acc = first.rows.map((r: any) => this.mapReturnRow(r));
            options?.onProgress?.(acc);

            if (first.lastPage <= 1) {
                return acc;
            }

            const remaining = Array.from({ length: first.lastPage - 1 }, (_, i) => i + 2);
            const batchSize = 5;
            for (let i = 0; i < remaining.length; i += batchSize) {
                const batch = remaining.slice(i, i + batchSize);
                const results = await Promise.all(batch.map((page) => fetchPage(page)));
                results.sort((a, b) => a.page - b.page);
                for (const result of results) {
                    acc = [...acc, ...result.rows.map((r: any) => this.mapReturnRow(r))];
                }
                options?.onProgress?.(acc);
            }

            return acc;
        } catch {
            return [];
        }
    },
    async create(data: any) {
        const orderId = String(data.order_id);
        const manualRef = data.amazon_order_number?.trim()
            ? String(data.amazon_order_number).trim()
            : `MANUAL-${orderId}-${Date.now()}`;
        return await api.post('returns', {
            inventory_order_id: orderId,
            platform_return_id: manualRef,
            sku_code: data.sku_code || null,
            return_quantity: data.return_quantity != null ? Math.max(1, Number(data.return_quantity)) : undefined,
            reason: data.reason || 'Manual return',
            disposition: data.return_type === 'stock' ? 'sellable' : 'damaged',
            refund_amount: data.refund_amount != null ? Number(data.refund_amount) : undefined,
        });
    },
    async getById(id: string) {
        return await api.get(`returns/${id}`);
    },
    async updateStatus(id: string, status: string) {
        const nowIso = new Date().toISOString();
        if (status === 'refunded') {
            // Financial marker only; inventory stays on hold until physical confirmation.
            return await api.put(`returns/${id}`, {
                external_status: 'refunded',
                return_status: 'return_requested',
                inventory_status: 'on_hold',
                last_update_date: nowIso,
            });
        }

        const statusMap: Record<string, any> = {
            pending: { status: 'pending', return_status: 'return_requested', inventory_status: 'on_hold' },
            in_transit: { status: 'in_transit', return_status: 'in_transit', inventory_status: 'on_hold' },
            received: { status: 'approved', return_status: 'arrived_to_warehouse', inventory_status: 'pending_confirmation' },
            restocked: { status: 'completed', return_status: 'restocked', inventory_status: 'restocked' },
            lost: { status: 'completed', return_status: 'lost', inventory_status: 'written_off' },
            closed: { status: 'completed', return_status: 'closed', inventory_status: 'restocked' },
        };

        const payload = statusMap[status] || { status };
        payload.last_update_date = nowIso;
        return await api.put(`returns/${id}`, payload);
    },
    async process(id: string) {
        return await api.post(`returns/${id}/process`);
    },
    async receive(id: string) {
        return await api.post(`returns/${id}/receive`, {});
    },
};

// ========== RECEIPT SERVICE ==========
export const receiptService = {
    async getAll() {
        try {
            return await fetchInventoryPaginatedList('receipts');
        } catch {
            return [];
        }
    },
    async create(data: any) {
        return await api.post('receipts', data);
    },
    async update(id: string, data: any) {
        return await api.put(`receipts/${id}`, data);
    },
    async delete(id: string) {
        await api.delete(`receipts/${id}`);
    },
};

// ========== PAYMENT SERVICE ==========
export const paymentService = {
    async getAll() {
        try {
            return await fetchInventoryPaginatedList('payments');
        } catch {
            return [];
        }
    },
    async create(data: any) {
        return await api.post('payments', data);
    },
    async update(id: string, data: any) {
        return await api.put(`payments/${id}`, data);
    },
    async delete(id: string) {
        await api.delete(`payments/${id}`);
    },
};

// ========== EXPENSE SERVICE ==========
export const expenseService = {
    async getAll() {
        try {
            return await fetchInventoryPaginatedList('expenses');
        } catch {
            return [];
        }
    },
    async create(data: any) {
        return await api.post('expenses', data);
    },
    async update(id: string, data: any) {
        return await api.put(`expenses/${id}`, data);
    },
    async delete(id: string) {
        await api.delete(`expenses/${id}`);
    },
};

// ========== INTERNAL TRANSFER SERVICE ==========
export const internalTransferService = {
    async create(data: { from_warehouse_id: string; to_warehouse_id: string; product_id: string; quantity: number; notes?: string }) {
        return stockMovementService.transfer(
            data.from_warehouse_id,
            data.to_warehouse_id,
            data.product_id,
            data.quantity,
            data.notes
        );
    },
    async getAll() {
        try {
            return await api.getArray('transactions?type=TRANSFER');
        } catch {
            return [];
        }
    }
};

// ========== SMART IMPORT SERVICE ==========
export const smartImportService = {
    async getBatches(status?: string) {
        const url = status ? `purchases/smart-import/batches?status=${status}` : 'purchases/smart-import/batches';
        return await api.getArray(url);
    },
    async getBatch(id: string) {
        return await api.get(`purchases/smart-import/batches/${id}`);
    },
    async approveBatch(id: string) {
        return await api.post(`purchases/smart-import/batches/${id}/approve`);
    },
    async receiveBatch(id: string, data: { location_id: string; items: any[] }) {
        return await api.post(`purchases/smart-import/batches/${id}/receive`, data);
    },
    async cancelBatch(id: string) {
        return await api.post(`purchases/smart-import/batches/${id}/cancel`);
    }
};
