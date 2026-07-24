import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { marketService } from '@/lib/supabase-services';
import { toast } from 'sonner';

export function useMarkets() {
  return useQuery({
    queryKey: ['markets'],
    queryFn: () => marketService.getAll(),
  });
}

export function useCreateMarket() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (market: { code: string; name?: string }) => 
      marketService.create(market),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['markets'] });
      toast.success('Market added');
    },
    onError: (error: Error) => {
      toast.error(`Failed to add market: ${error.message}`);
    },
  });
}

export function useDeleteMarket() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => marketService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['markets'] });
      toast.success('Market removed');
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove market: ${error.message}`);
    },
  });
}
