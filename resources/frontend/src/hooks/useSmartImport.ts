import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { smartImportService } from '@/lib/supabase-services';
import { toast } from 'sonner';

export function useSmartImportBatches(status?: string) {
    return useQuery({
        queryKey: ['smart-import-batches', status],
        queryFn: () => smartImportService.getBatches(status),
    });
}

export function useSmartImportBatch(id: string) {
    return useQuery({
        queryKey: ['smart-import-batches', id],
        queryFn: () => smartImportService.getBatch(id),
        enabled: !!id,
    });
}

export function useApproveBatch() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => smartImportService.approveBatch(id),
        onSuccess: (_, id) => {
            queryClient.invalidateQueries({ queryKey: ['smart-import-batches'] });
            queryClient.invalidateQueries({ queryKey: ['smart-import-batches', id] });
            toast.success('Batch approved successfully');
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.message || 'Failed to approve batch');
        }
    });
}

export function useReceiveBatch() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: { location_id: string; items: any[] } }) =>
            smartImportService.receiveBatch(id, data),
        onSuccess: (_, { id }) => {
            queryClient.invalidateQueries({ queryKey: ['smart-import-batches'] });
            queryClient.invalidateQueries({ queryKey: ['smart-import-batches', id] });
            queryClient.invalidateQueries({ queryKey: ['inventory'] });
            toast.success('Batch received successfully');
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.message || 'Failed to receive batch');
        }
    });
}

export function useCancelBatch() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => smartImportService.cancelBatch(id),
        onSuccess: (_, id) => {
            queryClient.invalidateQueries({ queryKey: ['smart-import-batches'] });
            queryClient.invalidateQueries({ queryKey: ['smart-import-batches', id] });
            toast.success('Batch cancelled');
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.message || 'Failed to cancel batch');
        }
    });
}
