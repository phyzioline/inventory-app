import { useQuery } from '@tanstack/react-query';
import { salesOrderService } from '@/lib/supabase-services';

export interface TopSellingProduct {
  product_id: string;
  product_name: string;
  product_sku: string | null;
  warehouse_name: string;
  warehouse_type: string;
  total_quantity_sold: number;
  selling_price: number;
  cost_price: number;
  total_profit: number;
  profit_margin: number;
}

interface UseTopSellingOptions {
  dateFrom?: string;
  dateTo?: string;
  warehouseFilter?: string;
}

export function useTopSellingProducts(options: UseTopSellingOptions = {}) {
  return useQuery({
    queryKey: ['top-selling-products', options.dateFrom, options.dateTo, options.warehouseFilter],
    queryFn: async () => {
      try {
        const orders = await salesOrderService.getAll();
        // Basic aggregation from order data
        const aggregation = new Map<string, TopSellingProduct>();
        
        for (const order of orders || []) {
          for (const item of order.items || []) {
            const key = `${item.product_id || item.sku_id}`;
            const qty = item.quantity || 0;
            const price = item.unit_price || 0;
            
            if (aggregation.has(key)) {
              const existing = aggregation.get(key)!;
              existing.total_quantity_sold += qty;
              existing.total_profit += price * qty;
            } else {
              aggregation.set(key, {
                product_id: key,
                product_name: item.product_name || item.name || `Product ${key}`,
                product_sku: item.sku || null,
                warehouse_name: order.warehouse_name || 'Default',
                warehouse_type: 'store',
                total_quantity_sold: qty,
                selling_price: price,
                cost_price: 0,
                total_profit: price * qty,
                profit_margin: 0,
              });
            }
          }
        }
        
        return Array.from(aggregation.values())
          .sort((a, b) => b.total_quantity_sold - a.total_quantity_sold);
      } catch {
        return [] as TopSellingProduct[];
      }
    },
  });
}
