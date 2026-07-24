import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { asinService, ASIN } from '@/lib/supabase-services';
import { toast } from 'sonner';

export function useASINs() {
  return useQuery({
    queryKey: ['asins'],
    queryFn: () => asinService.getAll(),
  });
}

export function useProductASINs(productId: string) {
  return useQuery({
    queryKey: ['asins', 'product', productId],
    queryFn: () => asinService.getByProduct(productId),
    enabled: !!productId,
  });
}

// Alias for consistency
export const useASINsByProduct = useProductASINs;

export function useCreateASIN() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (asin: { product_id: string; asin_code: string; marketplace?: string | null; notes?: string | null; status?: string | null; image_url?: string | null; display_price?: number | null }) => 
      asinService.create(asin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asins'] });
      toast.success('ASIN created successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create ASIN: ${error.message}`);
    },
  });
}

export function useUpdateASIN() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<ASIN> }) => 
      asinService.update(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asins'] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to update ASIN: ${error.message}`);
    },
  });
}

export function useASINPriceHistory(asinId: string | null) {
  return useQuery({
    queryKey: ['asin-price-history', asinId],
    queryFn: () => asinService.getPriceHistory(asinId!),
    enabled: !!asinId,
  });
}

export function useDeleteASIN() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => asinService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asins'] });
      toast.success('ASIN deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete ASIN: ${error.message}`);
    },
  });
}
