import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { warehouseService, Warehouse } from '@/lib/supabase-services';
import { toast } from 'sonner';

const extractErrorMessage = (error: any, fallback: string) =>
  error?.response?.data?.message || error?.message || fallback;

export function useWarehouses() {
  return useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehouseService.getAll(),
  });
}

export function useWarehouse(id: string) {
  return useQuery({
    queryKey: ['warehouses', id],
    queryFn: () => warehouseService.getById(id),
    enabled: !!id,
  });
}

export function useCreateWarehouse() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (warehouse: Omit<Warehouse, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => 
      warehouseService.create(warehouse),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      toast.success('Warehouse created successfully');
    },
    onError: (error: any) => {
      toast.error(`Failed to create warehouse: ${extractErrorMessage(error, 'Unknown error')}`);
    },
  });
}

export function useUpdateWarehouse() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Warehouse> }) => 
      warehouseService.update(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      toast.success('Warehouse updated successfully');
    },
    onError: (error: any) => {
      toast.error(`Failed to update warehouse: ${extractErrorMessage(error, 'Unknown error')}`);
    },
  });
}

export function useDeleteWarehouse() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => warehouseService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      toast.success('Warehouse deleted successfully');
    },
    onError: (error: any) => {
      toast.error(`Failed to delete warehouse: ${extractErrorMessage(error, 'Unknown error')}`);
    },
  });
}
