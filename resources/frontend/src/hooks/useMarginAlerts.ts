import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface MarginAlertItem {
    id: number;
    code: string;
    name: string;
    selling_price: number;
    cost_price: number;
    margin_percent: number;
}

export const useMarginAlerts = (threshold: number = 0.20) => {
    return useQuery({
        queryKey: ['margin-alerts', threshold],
        queryFn: async () => {
            const data = await api.get<MarginAlertItem[]>('/reports/margin-alerts', { threshold });
            return Array.isArray(data) ? data : [];
        },
    });
};
