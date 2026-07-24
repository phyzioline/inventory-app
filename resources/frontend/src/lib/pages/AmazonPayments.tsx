import { useState } from 'react';
import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import {
    DollarSign, Upload, Search, Calendar, Loader2, TrendingUp,
    TrendingDown, Package, Undo2, FileCode
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Card } from '@/components/ui/card';
import { useAmazonSettlements, useAmazonTransactions, useSettlementSummary } from '@/hooks/useAmazonSettlements';
import AmazonSettlementImportDialog from '@/components/amazon/AmazonSettlementImportDialog';
import { format } from 'date-fns';

export default function AmazonPayments() {
    const { t } = useLanguage();
    const [search, setSearch] = useState('');
    const [selectedSettlement, setSelectedSettlement] = useState<string | undefined>();
    const [importDialogOpen, setImportDialogOpen] = useState(false);

    const { data: settlements, isLoading: settlementsLoading } = useAmazonSettlements({ search });
    const { data: transactions, isLoading: transactionsLoading } = useAmazonTransactions(selectedSettlement);
    const summary = useSettlementSummary();

    const formatCurrency = (amount: number) => {
        return `${amount.toLocaleString()} EGP`;
    };

    const getTransactionBadge = (type: string) => {
        switch (type) {
            case 'Order': return <Badge className="bg-green-100 text-green-800 border-green-300">Order</Badge>;
            case 'Refund': return <Badge className="bg-red-100 text-red-800 border-red-300">Refund</Badge>;
            case 'OtherTransaction': return <Badge className="bg-gray-100 text-gray-800 border-gray-300">Other</Badge>;
            default: return <Badge>{type}</Badge>;
        }
    };

    if (settlementsLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <DollarSign className="w-6 h-6" />
                        Amazon Payments & Settlements
                    </h1>
                    <p className="text-muted-foreground">Track revenue, fees, and net profit from Amazon</p>
                </div>
                <Button onClick={() => setImportDialogOpen(true)} className="gap-2">
                    <Upload className="w-4 h-4" />
                    Import Settlement
                </Button>
            </div>

            {/* Financial Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Total Revenue</p>
                            <p className="text-2xl font-bold text-green-600">{formatCurrency(summary.totalRevenue)}</p>
                            <p className="text-xs text-muted-foreground mt-1">{summary.orderCount} orders</p>
                        </div>
                        <TrendingUp className="w-8 h-8 text-green-500 opacity-50" />
                    </div>
                </Card>

                <Card className="p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Total Fees</p>
                            <p className="text-2xl font-bold text-red-600">{formatCurrency(summary.totalFees)}</p>
                            <p className="text-xs text-muted-foreground mt-1">Amazon charges</p>
                        </div>
                        <TrendingDown className="w-8 h-8 text-red-500 opacity-50" />
                    </div>
                </Card>

                <Card className="p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Refunds</p>
                            <p className="text-2xl font-bold text-orange-600">{formatCurrency(summary.totalRefunds)}</p>
                            <p className="text-xs text-muted-foreground mt-1">{summary.refundCount} returns</p>
                        </div>
                        <Undo2 className="w-8 h-8 text-orange-500 opacity-50" />
                    </div>
                </Card>

                <Card className="p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Net Profit</p>
                            <p className="text-2xl font-bold text-blue-600">{formatCurrency(summary.netProfit)}</p>
                            <p className="text-xs text-muted-foreground mt-1">After all fees</p>
                        </div>
                        <DollarSign className="w-8 h-8 text-blue-500 opacity-50" />
                    </div>
                </Card>
            </div>

            {/* Settlements List */}
            <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by Settlement ID or Order ID..."
                            className="pl-9"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                </div>

                <div className="glass-card rounded-xl overflow-hidden">
                    {!settlements || settlements.length === 0 ? (
                        <div className="text-center py-12">
                            <FileCode className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                            <p className="text-muted-foreground mb-4">No settlements imported yet</p>
                            <Button onClick={() => setImportDialogOpen(true)} variant="outline" className="gap-2">
                                <Upload className="w-4 h-4" />
                                Import Your First Settlement
                            </Button>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Settlement ID</TableHead>
                                    <TableHead>Period</TableHead>
                                    <TableHead>Deposit Date</TableHead>
                                    <TableHead>Transactions</TableHead>
                                    <TableHead className="text-right">Total Amount</TableHead>
                                    <TableHead>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {settlements.map((settlement) => (
                                    <TableRow key={settlement.id}>
                                        <TableCell className="font-mono text-sm">{settlement.settlementId}</TableCell>
                                        <TableCell className="text-sm">
                                            {format(new Date(settlement.startDate), 'dd/MM/yyyy')}<br />
                                            <span className="text-xs text-muted-foreground">
                                                → {format(new Date(settlement.endDate), 'dd/MM/yyyy')}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            {format(new Date(settlement.depositDate), 'dd/MM/yyyy')}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline">{settlement.transactions.length}</Badge>
                                        </TableCell>
                                        <TableCell className="text-right font-bold text-green-600">
                                            {formatCurrency(settlement.totalAmount)}
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => setSelectedSettlement(
                                                    selectedSettlement === settlement.settlementId ? undefined : settlement.settlementId
                                                )}
                                            >
                                                {selectedSettlement === settlement.settlementId ? 'Hide' : 'View'} Transactions
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </div>
            </div>

            {/* Transaction Details */}
            {selectedSettlement && transactions && transactions.length > 0 && (
                <div className="glass-card rounded-xl overflow-hidden">
                    <div className="p-4 border-b bg-muted/50">
                        <h3 className="font-semibold">Settlement Transactions</h3>
                        <p className="text-sm text-muted-foreground">Settlement ID: {selectedSettlement}</p>
                    </div>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Type</TableHead>
                                <TableHead>Order ID</TableHead>
                                <TableHead>SKU</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Channel</TableHead>
                                <TableHead className="text-right">Revenue</TableHead>
                                <TableHead className="text-right">Fees</TableHead>
                                <TableHead className="text-right">Net Amount</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {transactionsLoading ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="text-center py-8">
                                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                                    </TableCell>
                                </TableRow>
                            ) : (
                                transactions.map((tx) => (
                                    <TableRow key={tx.id}>
                                        <TableCell>{getTransactionBadge(tx.type)}</TableCell>
                                        <TableCell className="font-mono text-xs">{tx.amazonOrderId}</TableCell>
                                        <TableCell className="font-mono text-xs">{tx.sku || '—'}</TableCell>
                                        <TableCell className="text-sm">
                                            {format(new Date(tx.postedDate), 'dd/MM/yyyy HH:mm')}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline">
                                                {tx.fulfillmentChannel === 'FBA' ? (
                                                    <><Package className="w-3 h-3 mr-1 inline" />FBA</>
                                                ) : (
                                                    'FBM'
                                                )}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right text-sm">
                                            {formatCurrency(tx.principal + tx.shipping)}
                                        </TableCell>
                                        <TableCell className="text-right text-sm text-red-600">
                                            {formatCurrency(Math.abs(tx.commission + tx.fbaFee + tx.otherFees))}
                                        </TableCell>
                                        <TableCell className="text-right font-medium">
                                            <span className={tx.netAmount >= 0 ? 'text-green-600' : 'text-red-600'}>
                                                {formatCurrency(tx.netAmount)}
                                            </span>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            )}

            <AmazonSettlementImportDialog open={importDialogOpen} onOpenChange={setImportDialogOpen} />
        </div>
    );
}
