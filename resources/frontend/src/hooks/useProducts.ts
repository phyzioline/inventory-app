import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productService, Product, inventoryService } from '@/lib/supabase-services';
import { toast } from 'sonner';

export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: () => productService.getAll(),
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: ['products', id],
    queryFn: () => productService.getById(id),
    enabled: !!id,
  });
}

export function useProductWithStock(productId: string) {
  const productQuery = useProduct(productId);
  const stockQuery = useQuery({
    queryKey: ['inventory', 'product', productId],
    queryFn: () => inventoryService.getByProduct(productId),
    enabled: !!productId,
  });

  return {
    product: productQuery.data,
    stock: stockQuery.data,
    totalStock: stockQuery.data?.reduce((sum, i) => sum + i.quantity, 0) || 0,
    isLoading: productQuery.isLoading || stockQuery.isLoading,
    error: productQuery.error || stockQuery.error,
  };
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (product: Omit<Product, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'category' | 'sku'>) => 
      productService.create(product),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Product created successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create product: ${error.message}`);
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Product> }) => 
      productService.update(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Product updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update product: ${error.message}`);
    },
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => productService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Product deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete product: ${error.message}`);
    },
  });
}

export function useBulkCreateProducts() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (products: Array<Omit<Product, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'category' | 'sku'>>) => 
      productService.bulkCreate(products),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(`${data.length} products created successfully`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to create products: ${error.message}`);
    },
  });
}
