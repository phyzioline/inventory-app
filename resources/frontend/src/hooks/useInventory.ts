import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryService, stockMovementService } from '@/lib/supabase-services';
import { toast } from 'sonner';

export function useInventory() {
  return useQuery({
    queryKey: ['inventory'],
    queryFn: () => inventoryService.getAll(),
  });
}

export function useWarehouseInventory(warehouseId: string) {
  return useQuery({
    queryKey: ['inventory', 'warehouse', warehouseId],
    queryFn: () => inventoryService.getByWarehouse(warehouseId),
    enabled: !!warehouseId,
  });
}

export function useProductInventory(productId: string) {
  return useQuery({
    queryKey: ['inventory', 'product', productId],
    queryFn: () => inventoryService.getByProduct(productId),
    enabled: !!productId,
  });
}

export function useUpdateStock() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ productId, warehouseId, quantity }: { 
      productId: string; 
      warehouseId: string; 
      quantity: number;
    }) => inventoryService.updateStock(productId, warehouseId, quantity),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success('Stock updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update stock: ${error.message}`);
    },
  });
}

export function useSetStock() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ productId, warehouseId, quantity }: { 
      productId: string; 
      warehouseId: string; 
      quantity: number;
    }) => inventoryService.setStock(productId, warehouseId, quantity),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success('Stock set successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to set stock: ${error.message}`);
    },
  });
}

export function useStockMovements() {
  return useQuery({
    queryKey: ['stock-movements'],
    queryFn: () => stockMovementService.getAll(),
  });
}

export function useProductStockMovements(productId: string) {
  return useQuery({
    queryKey: ['stock-movements', 'product', productId],
    queryFn: () => stockMovementService.getByProduct(productId),
    enabled: !!productId,
  });
}

export function useTransferStock() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ fromWarehouseId, toWarehouseId, productId, quantity, notes }: {
      fromWarehouseId: string;
      toWarehouseId: string;
      productId: string;
      quantity: number;
      notes?: string;
    }) => stockMovementService.transfer(fromWarehouseId, toWarehouseId, productId, quantity, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      toast.success('Stock transferred successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to transfer stock: ${error.message}`);
    },
  });
}
