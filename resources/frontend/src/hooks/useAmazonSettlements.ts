import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export interface AmazonSettlement {
    id: string;
    settlementId: string;
    totalAmount: number;
    currency: string;
    startDate: string;
    endDate: string;
    depositDate: string;
    transactions: AmazonTransaction[];
}

export interface AmazonTransaction {
    id: string;
    type: 'Order' | 'Refund' | 'OtherTransaction';
    amazonOrderId: string;
    sku?: string;
    postedDate: string;
    fulfillmentChannel: 'FBA' | 'FBM';
    principal: number;
    shipping: number;
    commission: number;
    fbaFee: number;
    otherFees: number;
    netAmount: number;
    transactionType?: string;
}

export interface SettlementSummary {
    totalRevenue: number;
    totalFees: number;
    totalRefunds: number;
    netProfit: number;
    orderCount: number;
    refundCount: number;
    fbaOrders: number;
    fbmOrders: number;
}

const STORAGE_KEY = 'amazon_settlements';

const getStoredSettlements = (): AmazonSettlement[] => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
};

const saveSettlements = (settlements: AmazonSettlement[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settlements));
};

export const useAmazonSettlements = (filters?: {
    dateFrom?: string;
    dateTo?: string;
    search?: string;
}) => {
    return useQuery({
        queryKey: ['amazon-settlements', filters],
        queryFn: async () => {
            await new Promise(resolve => setTimeout(resolve, 300));

            let settlements = getStoredSettlements();

            if (filters?.dateFrom) {
                settlements = settlements.filter(s =>
                    new Date(s.startDate) >= new Date(filters.dateFrom!)
                );
            }

            if (filters?.dateTo) {
                settlements = settlements.filter(s =>
                    new Date(s.endDate) <= new Date(filters.dateTo!)
                );
            }

            if (filters?.search) {
                const search = filters.search.toLowerCase();
                settlements = settlements.filter(s =>
                    s.settlementId.toLowerCase().includes(search) ||
                    s.transactions.some(t =>
                        t.amazonOrderId?.toLowerCase().includes(search) ||
                        t.sku?.toLowerCase().includes(search)
                    )
                );
            }

            return settlements.sort((a, b) =>
                new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
            );
        },
    });
};

export const useAmazonTransactions = (settlementId?: string) => {
    return useQuery({
        queryKey: ['amazon-transactions', settlementId],
        queryFn: async () => {
            await new Promise(resolve => setTimeout(resolve, 200));

            const settlements = getStoredSettlements();

            if (settlementId) {
                const settlement = settlements.find(s => s.settlementId === settlementId);
                return settlement?.transactions || [];
            }

            return settlements.flatMap(s => s.transactions);
        },
    });
};

export const useSettlementSummary = (): SettlementSummary => {
    const { data: settlements } = useAmazonSettlements();

    if (!settlements || settlements.length === 0) {
        return {
            totalRevenue: 0,
            totalFees: 0,
            totalRefunds: 0,
            netProfit: 0,
            orderCount: 0,
            refundCount: 0,
            fbaOrders: 0,
            fbmOrders: 0,
        };
    }

    const allTransactions = settlements.flatMap(s => s.transactions);

    const orders = allTransactions.filter(t => t.type === 'Order');
    const refunds = allTransactions.filter(t => t.type === 'Refund');

    const totalRevenue = orders.reduce((sum, t) => sum + t.principal + t.shipping, 0);
    const totalFees = orders.reduce((sum, t) => sum + Math.abs(t.commission + t.fbaFee + t.otherFees), 0);
    const totalRefunds = Math.abs(refunds.reduce((sum, t) => sum + t.netAmount, 0));
    const netProfit = allTransactions.reduce((sum, t) => sum + t.netAmount, 0);

    return {
        totalRevenue,
        totalFees,
        totalRefunds,
        netProfit,
        orderCount: orders.length,
        refundCount: refunds.length,
        fbaOrders: orders.filter(t => t.fulfillmentChannel === 'FBA').length,
        fbmOrders: orders.filter(t => t.fulfillmentChannel === 'FBM').length,
    };
};

export type ImportSettlementInput = { file: File; channelId: number };

function parseSettlementXmlInBrowser(file: File): Promise<{ success: boolean; settlement: AmazonSettlement; errors: string[] }> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const xmlText = e.target?.result as string;
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

                const errors: string[] = [];

                const settlementData = xmlDoc.querySelector('SettlementData');
                if (!settlementData) {
                    reject(new Error('Invalid settlement XML format'));
                    return;
                }

                const settlementId = settlementData.querySelector('AmazonSettlementID')?.textContent || '';
                const totalAmount = parseFloat(settlementData.querySelector('TotalAmount')?.textContent || '0');
                const currency = settlementData.querySelector('TotalAmount')?.getAttribute('currency') || 'EGP';
                const startDate = settlementData.querySelector('StartDate')?.textContent || '';
                const endDate = settlementData.querySelector('EndDate')?.textContent || '';
                const depositDate = settlementData.querySelector('DepositDate')?.textContent || '';

                const transactions: AmazonTransaction[] = [];

                xmlDoc.querySelectorAll('Order').forEach((orderNode, index) => {
                            try {
                                const orderId = orderNode.querySelector('AmazonOrderID')?.textContent || '';
                                const fulfillmentId = orderNode.querySelector('MerchantFulfillmentID')?.textContent || 'MFN';
                                const postedDate = orderNode.querySelector('PostedDate')?.textContent || '';

                                orderNode.querySelectorAll('Item').forEach(itemNode => {
                                    const sku = itemNode.querySelector('SKU')?.textContent || '';
                                    const quantity = parseInt(itemNode.querySelector('Quantity')?.textContent || '1');

                                    let principal = 0;
                                    let shipping = 0;

                                    itemNode.querySelectorAll('ItemPrice > Component').forEach(comp => {
                                        const type = comp.querySelector('Type')?.textContent;
                                        const amount = parseFloat(comp.querySelector('Amount')?.textContent || '0');
                                        if (type === 'Principal') principal = amount;
                                        if (type === 'Shipping') shipping = amount;
                                    });

                                    let commission = 0;
                                    let fbaFee = 0;
                                    let otherFees = 0;

                                    itemNode.querySelectorAll('ItemFees > Fee').forEach(feeNode => {
                                        const type = feeNode.querySelector('Type')?.textContent;
                                        const amount = parseFloat(feeNode.querySelector('Amount')?.textContent || '0');
                                        if (type === 'Commission') commission = amount;
                                        if (type === 'FBAPerUnitFulfillmentFee') fbaFee = amount;
                                        else if (type !== 'Commission') otherFees += amount;
                                    });

                                    const netAmount = principal + shipping + commission + fbaFee + otherFees;

                                    transactions.push({
                                        id: `${orderId}-${sku}-${index}`,
                                        type: 'Order',
                                        amazonOrderId: orderId,
                                        sku,
                                        postedDate,
                                        fulfillmentChannel: fulfillmentId === 'AFN' ? 'FBA' : 'FBM',
                                        principal,
                                        shipping,
                                        commission,
                                        fbaFee,
                                        otherFees,
                                        netAmount,
                                    });
                                });
                            } catch (err) {
                                errors.push(`Order parsing error: ${err instanceof Error ? err.message : 'Unknown'}`);
                            }
                        });

                        // Parse Refunds
                        xmlDoc.querySelectorAll('Refund').forEach((refundNode, index) => {
                            try {
                                const orderId = refundNode.querySelector('AmazonOrderID')?.textContent || '';
                                const fulfillmentId = refundNode.querySelector('MerchantFulfillmentID')?.textContent || 'MFN';
                                const postedDate = refundNode.querySelector('PostedDate')?.textContent || '';

                                refundNode.querySelectorAll('AdjustedItem').forEach(itemNode => {
                                    const sku = itemNode.querySelector('SKU')?.textContent || '';

                                    let principal = 0;
                                    let shipping = 0;

                                    itemNode.querySelectorAll('ItemPriceAdjustments > Component').forEach(comp => {
                                        const type = comp.querySelector('Type')?.textContent;
                                        const amount = parseFloat(comp.querySelector('Amount')?.textContent || '0');
                                        if (type === 'Principal') principal = amount;
                                        if (type === 'Shipping') shipping = amount;
                                    });

                                    let commission = 0;
                                    let otherFees = 0;

                                    itemNode.querySelectorAll('ItemFeeAdjustments > Fee').forEach(feeNode => {
                                        const type = feeNode.querySelector('Type')?.textContent;
                                        const amount = parseFloat(feeNode.querySelector('Amount')?.textContent || '0');
                                        if (type === 'Commission') commission = amount;
                                        else otherFees += amount;
                                    });

                                    const netAmount = principal + shipping + commission + otherFees;

                                    transactions.push({
                                        id: `${orderId}-refund-${sku}-${index}`,
                                        type: 'Refund',
                                        amazonOrderId: orderId,
                                        sku,
                                        postedDate,
                                        fulfillmentChannel: fulfillmentId === 'AFN' ? 'FBA' : 'FBM',
                                        principal,
                                        shipping,
                                        commission,
                                        fbaFee: 0,
                                        otherFees,
                                        netAmount,
                                    });
                                });
                            } catch (err) {
                                errors.push(`Refund parsing error: ${err instanceof Error ? err.message : 'Unknown'}`);
                            }
                        });

                        // Parse Other Transactions
                        xmlDoc.querySelectorAll('OtherTransaction').forEach((txNode, index) => {
                            try {
                                const orderId = txNode.querySelector('AmazonOrderID')?.textContent || `OTHER-${index}`;
                                const txType = txNode.querySelector('TransactionType')?.textContent || 'Other';
                                const postedDate = txNode.querySelector('PostedDate')?.textContent || '';
                                const amount = parseFloat(txNode.querySelector('Amount')?.textContent || '0');
                                const fulfillmentId = txNode.querySelector('MerchantFulfillmentID')?.textContent || 'MFN';

                                transactions.push({
                                    id: `${orderId}-other-${index}`,
                                    type: 'OtherTransaction',
                                    amazonOrderId: orderId,
                                    postedDate,
                                    fulfillmentChannel: fulfillmentId === 'AFN' ? 'FBA' : 'FBM',
                                    principal: 0,
                                    shipping: 0,
                                    commission: 0,
                                    fbaFee: 0,
                                    otherFees: amount,
                                    netAmount: amount,
                                    transactionType: txType,
                                });
                            } catch (err) {
                                errors.push(`Other transaction parsing error: ${err instanceof Error ? err.message : 'Unknown'}`);
                            }
                        });

                const settlement: AmazonSettlement = {
                    id: settlementId,
                    settlementId,
                    totalAmount,
                    currency,
                    startDate,
                    endDate,
                    depositDate,
                    transactions,
                };

                const existingSettlements = getStoredSettlements();
                const existingIndex = existingSettlements.findIndex(s => s.settlementId === settlementId);

                if (existingIndex >= 0) {
                    existingSettlements[existingIndex] = settlement;
                } else {
                    existingSettlements.push(settlement);
                }

                saveSettlements(existingSettlements);

                resolve({ success: true, settlement, errors });
            } catch (error) {
                reject(error);
            }
        };

        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}

export const useImportSettlement = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (input: ImportSettlementInput): Promise<{ success: boolean; settlement: AmazonSettlement; errors: string[] }> => {
            const { file, channelId } = input;
            const formData = new FormData();
            formData.append('file', file);
            formData.append('channel_id', String(channelId));
            await api.upload('/settlements/import', formData);
            return parseSettlementXmlInBrowser(file);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['amazon-settlements'] });
            queryClient.invalidateQueries({ queryKey: ['amazon-transactions'] });
            queryClient.invalidateQueries({ queryKey: ['settlement-order-net-totals'] });
            queryClient.invalidateQueries({ queryKey: ['settlement-order-sku-net-totals'] });
            queryClient.invalidateQueries({ queryKey: ['settlements'] });
            queryClient.invalidateQueries({ queryKey: ['settlements-summary'] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            queryClient.invalidateQueries({ queryKey: ['orders-for-profit'] });
            queryClient.invalidateQueries({ queryKey: ['receipts'] });
            queryClient.invalidateQueries({ queryKey: ['receipts-for-profit-balance'] });
            queryClient.invalidateQueries({ queryKey: ['finance-cash-flow-overview'] });
            queryClient.invalidateQueries({ queryKey: ['finance-cash-flow-stats'] });
        },
    });
};
