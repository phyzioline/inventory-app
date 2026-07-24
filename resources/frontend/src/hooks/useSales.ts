import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salesOrderService, SalesOrder } from '@/lib/supabase-services';
import { toast } from 'sonner';

export function useSalesOrders() {
  return useQuery({
    queryKey: ['sales-orders'],
    queryFn: () => salesOrderService.getAll(),
  });
}

export function useSalesOrder(id: string) {
  return useQuery({
    queryKey: ['sales-orders', id],
    queryFn: () => salesOrderService.getById(id),
    enabled: !!id,
  });
}

export function useCreateSalesOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (order: {
      order_number: string;
      warehouse_id: string;
      credit_warehouse_id?: string;
      fulfillment_warehouse_id?: string;
      customer_name?: string;
      total_amount: number;
      status?: SalesOrder['status'];
      marketplace_source?: string;
      external_order_number?: string;
      source_account_email?: string;
      auto_pull_from_source?: boolean;
      payment_type?: 'cash' | 'credit';
      paid_amount?: number;
      remaining_amount?: number;
      items: Array<{
        product_id: string;
        quantity: number;
        unit_price: number;
      }>;
    }) => salesOrderService.create(order),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      toast.success('Sales order created successfully');
    },
    onError: (error: any) => {
      const data = error?.response?.data;
      const details = data?.errors
        ? Object.values(data.errors).flat().join(' | ')
        : (data?.error || data?.message || error?.message || 'Unknown error');
      toast.error(`Failed to create sales order: ${details}`);
    },
  });
}

export function useUpdateSalesOrderStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: SalesOrder['status'] }) =>
      salesOrderService.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      toast.success('Order status updated');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update status: ${error.message}`);
    },
  });
}

export function useOrderProfitability(id: string) {
  return useQuery({
    queryKey: ['order-profitability', id],
    queryFn: () => salesOrderService.getProfitability(id),
    enabled: !!id,
  });
}
