import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface Customer {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    tax_id?: string;
    address?: string;
    credit_limit: number;
    current_balance: number;
    is_active: boolean;
}

export function useCustomers(options?: Pick<UseQueryOptions<Customer[]>, 'enabled'>) {
    return useQuery({
        queryKey: ['customers'],
        queryFn: async () => {
            const data = await api.get<Customer[] | { data: Customer[] }>('customers');
            if (Array.isArray(data)) return data;
            if (data && Array.isArray((data as { data: Customer[] }).data)) {
                return (data as { data: Customer[] }).data;
            }
            return [];
        },
        enabled: options?.enabled ?? true,
    });
}

export function useCreateCustomer() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: Partial<Customer>) => api.post('customers', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['customers'] });
            toast.success('Customer created successfully');
        },
        onError: (error: unknown) => {
            const message =
                (error as { response?: { data?: { message?: string } } })?.response?.data?.message
                || (error as Error)?.message
                || 'Failed to create customer';
            toast.error(message);
        },
    });
}
