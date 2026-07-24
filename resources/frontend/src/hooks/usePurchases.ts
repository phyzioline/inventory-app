import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchaseInvoiceService, PurchaseInvoice } from '@/lib/supabase-services';
import { toast } from 'sonner';

export function usePurchaseInvoices(options?: { includeCancelled?: boolean }) {
  const includeCancelled = options?.includeCancelled === true;
  return useQuery({
    queryKey: ['purchase-invoices', { includeCancelled }],
    queryFn: () => purchaseInvoiceService.getAll(includeCancelled),
  });
}

export function usePurchaseInvoice(id: string) {
  return useQuery({
    queryKey: ['purchase-invoices', id],
    queryFn: () => purchaseInvoiceService.getById(id),
    enabled: !!id,
  });
}

export function useCreatePurchaseInvoice() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (invoice: {
      supplier_id: string;
      warehouse_id: string;
      invoice_number?: string;
      total_amount: number;
      paid_amount?: number;
      status?: PurchaseInvoice['status'];
      notes?: string;
      items: Array<{
        product_id: string;
        quantity: number;
        unit_price: number;
      }>;
    }) => purchaseInvoiceService.create(invoice),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Purchase invoice created successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create purchase invoice: ${error.message}`);
    },
  });
}
