import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { returnService } from '@/lib/supabase-services';
import { toast } from 'sonner';

export type ReturnsPageOptions = {
  page?: number;
  perPage?: number;
  search?: string;
  pendingPhysical?: boolean;
  claimsHub?: boolean;
  enabled?: boolean;
};

export function useReturns(options: ReturnsPageOptions = {}) {
  const page = options.page ?? 1;
  const perPage = options.perPage ?? 100;
  const search = options.search ?? '';

  return useQuery({
    queryKey: ['returns', page, perPage, search, options.pendingPhysical ?? false, options.claimsHub ?? false],
    queryFn: () => returnService.getPage({
      page,
      perPage,
      search,
      pendingPhysical: options.pendingPhysical,
      claimsHub: options.claimsHub,
    }),
    enabled: options.enabled !== false,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useCreateReturn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (returnData: {
      order_id: string;
      return_type: 'stock' | 'damaged';
      reason?: string;
      amazon_order_number?: string;
      refund_amount?: number;
    }) => returnService.create(returnData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      toast.success('Return processed successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to process return: ${error.message}`);
    },
  });
}

export function useUpdateReturnStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'pending' | 'in_transit' | 'received' | 'refunded' | 'restocked' }) => {
      if (status === 'restocked') {
        return returnService.process(id);
      }
      if (status === 'received') {
        return returnService.receive(id);
      }
      return returnService.updateStatus(id, status);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      toast.success('Return status updated');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update status: ${error.message}`);
    },
  });
}
