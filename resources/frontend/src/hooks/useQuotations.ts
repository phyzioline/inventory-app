import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface Quotation {
    id: string;
    reference_number: string;
    customer_id?: string;
    customer_name?: string;
    quotation_date: string;
    valid_until?: string;
    total_amount: number;
    status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'converted';
    notes?: string;
    items?: any[];
}

export function useQuotations() {
    return useQuery({
        queryKey: ['quotations'],
        queryFn: async () => {
            const data = await api.get<Quotation[] | { data: Quotation[] }>('quotations');
            if (Array.isArray(data)) return data;
            if (data && Array.isArray((data as { data: Quotation[] }).data)) {
                return (data as { data: Quotation[] }).data;
            }
            return [];
        },
    });
}

export function useCreateQuotation() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: any) => api.post('quotations', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['quotations'] });
            toast.success('Quotation created successfully');
        },
    });
}

export function useUpdateQuotation() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => api.put(`quotations/${id}`, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['quotations'] });
            toast.success('Quotation updated successfully');
        },
    });
}

export function useConvertQuotation() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.post(`quotations/${id}/convert`, {}),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['quotations'] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            toast.success('Converted to order successfully');
        },
    });
}
