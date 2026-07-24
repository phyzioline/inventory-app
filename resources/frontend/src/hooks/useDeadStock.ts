import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface DeadStockItem {
    id: number;
    code: string;
    name: string;
    current_stock: number;
    cost_price: number;
    value_tied_up: number;
}

export const useDeadStock = (days: number = 90) => {
    return useQuery({
        queryKey: ['dead-stock', days],
        queryFn: async () => {
            const data = await api.get<DeadStockItem[]>('/reports/dead-stock', { days });
            return Array.isArray(data) ? data : [];
        },
    });
};
