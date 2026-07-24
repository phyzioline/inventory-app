import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';

export interface AmazonOrder {
    id: string;
    amazonOrderId: string;
    merchantOrderId: string;
    purchaseDate: string;
    lastUpdatedDate: string;
    orderStatus: 'Pending' | 'Shipped' | 'Canceled' | 'Delivered' | 'Returned';
    fulfillmentChannel: 'Amazon' | 'Merchant';
    salesChannel: string;
    sku: string;
    asin: string;
    productName: string;
    itemStatus: 'Unshipped' | 'Shipped' | 'Delivered';
    quantity: number;
    currency: string;
    itemPrice: number;
    itemTax: number;
    shippingPrice: number;
    shippingTax: number;
    shipCity: string;
    shipState: string;
    shipCountry: string;
}

export interface ImportSummary {
    total: number;
    new: number;
    updated: number;
    skipped: number;
    errors: string[];
}

// Local storage key
const STORAGE_KEY = 'amazon_orders';

// Helper to get orders from localStorage
const getStoredOrders = (): AmazonOrder[] => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
};

// Helper to save orders to localStorage
const saveOrders = (orders: AmazonOrder[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
};

export const useAmazonOrders = (filters?: {
    status?: string;
    fulfillmentChannel?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
}) => {
    return useQuery({
        queryKey: ['amazon-orders', filters],
        queryFn: async () => {
            // Simulate API delay
            await new Promise(resolve => setTimeout(resolve, 500));

            let orders = getStoredOrders();

            // Apply filters
            if (filters?.status && filters.status !== 'all') {
                orders = orders.filter(o => o.orderStatus === filters.status);
            }

            if (filters?.fulfillmentChannel && filters.fulfillmentChannel !== 'all') {
                orders = orders.filter(o => o.fulfillmentChannel === filters.fulfillmentChannel);
            }

            if (filters?.dateFrom) {
                orders = orders.filter(o => new Date(o.purchaseDate) >= new Date(filters.dateFrom!));
            }

            if (filters?.dateTo) {
                orders = orders.filter(o => new Date(o.purchaseDate) <= new Date(filters.dateTo!));
            }

            if (filters?.search) {
                const search = filters.search.toLowerCase();
                orders = orders.filter(o =>
                    o.amazonOrderId.toLowerCase().includes(search) ||
                    o.productName.toLowerCase().includes(search) ||
                    o.sku.toLowerCase().includes(search) ||
                    o.asin.toLowerCase().includes(search)
                );
            }

            // Sort by purchase date descending
            return orders.sort((a, b) =>
                new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime()
            );
        },
    });
};

export const useImportAmazonOrders = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (file: File): Promise<ImportSummary> => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();

                reader.onload = (e) => {
                    try {
                        const data = e.target?.result;
                        const workbook = XLSX.read(data, { type: 'binary' });
                        const sheetName = workbook.SheetNames[0];
                        const worksheet = workbook.Sheets[sheetName];
                        const jsonData = XLSX.utils.sheet_to_json(worksheet);

                        const summary: ImportSummary = {
                            total: jsonData.length,
                            new: 0,
                            updated: 0,
                            skipped: 0,
                            errors: [],
                        };

                        const existingOrders = getStoredOrders();
                        const orderMap = new Map(existingOrders.map(o => [o.amazonOrderId + o.sku, o]));

                        jsonData.forEach((row: any, index: number) => {
                            try {
                                // Map CSV columns to our interface
                                const orderId = row['amazon-order-id'] || row['amazon_order_id'];
                                const sku = row['sku'];

                                if (!orderId || !sku) {
                                    summary.skipped++;
                                    summary.errors.push(`Row ${index + 2}: Missing order ID or SKU`);
                                    return;
                                }

                                const uniqueKey = orderId + sku;
                                const order: AmazonOrder = {
                                    id: uniqueKey,
                                    amazonOrderId: orderId,
                                    merchantOrderId: row['merchant-order-id'] || row['merchant_order_id'] || orderId,
                                    purchaseDate: row['purchase-date'] || row['purchase_date'] || new Date().toISOString(),
                                    lastUpdatedDate: row['last-updated-date'] || row['last_updated_date'] || new Date().toISOString(),
                                    orderStatus: (row['order-status'] || row['order_status'] || 'Pending') as any,
                                    fulfillmentChannel: (row['fulfillment-channel'] || row['fulfillment_channel'] || 'Merchant') as any,
                                    salesChannel: row['sales-channel'] || row['sales_channel'] || 'Amazon',
                                    sku: sku,
                                    asin: row['asin'] || '',
                                    productName: row['product-name'] || row['product_name'] || '',
                                    itemStatus: (row['item-status'] || row['item_status'] || 'Unshipped') as any,
                                    quantity: parseInt(row['quantity'] || '1'),
                                    currency: row['currency'] || 'EGP',
                                    itemPrice: parseFloat(row['item-price'] || row['item_price'] || '0'),
                                    itemTax: parseFloat(row['item-tax'] || row['item_tax'] || '0'),
                                    shippingPrice: parseFloat(row['shipping-price'] || row['shipping_price'] || '0'),
                                    shippingTax: parseFloat(row['shipping-tax'] || row['shipping_tax'] || '0'),
                                    shipCity: row['ship-city'] || row['ship_city'] || '',
                                    shipState: row['ship-state'] || row['ship_state'] || '',
                                    shipCountry: row['ship-country'] || row['ship_country'] || 'EG',
                                };

                                if (orderMap.has(uniqueKey)) {
                                    // Update existing
                                    orderMap.set(uniqueKey, order);
                                    summary.updated++;
                                } else {
                                    // Add new
                                    orderMap.set(uniqueKey, order);
                                    summary.new++;
                                }
                            } catch (err) {
                                summary.skipped++;
                                summary.errors.push(`Row ${index + 2}: ${err instanceof Error ? err.message : 'Parse error'}`);
                            }
                        });

                        // Save to localStorage
                        const allOrders = Array.from(orderMap.values());
                        saveOrders(allOrders);

                        resolve(summary);
                    } catch (error) {
                        reject(error);
                    }
                };

                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsBinaryString(file);
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['amazon-orders'] });
        },
    });
};
