import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface ReturnRateItem {
    id: number;
    code: string;
    name: string;
    total_sold: number;
    total_returned: number;
    return_rate: number;
}

export const useReturnRates = () => {
    return useQuery({
        queryKey: ['return-rates'],
        queryFn: async () => {
            const data = await api.get<ReturnRateItem[]>('/reports/return-rates');
            return data;
        },
    });
};
