import React, { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { Search, Filter, ArrowUpDown } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ImportedTransaction } from '@/hooks/useAmazonImport';
import { cn } from '@/lib/utils';

interface TransactionsTableProps {
  transactions: ImportedTransaction[];
  isLoading?: boolean;
}

const classificationColors: Record<string, string> = {
  PENDING: 'bg-muted text-muted-foreground',
  DUPLICATE: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  STORE_SALE: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  FBA_SALE: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  RETURN: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  UNKNOWN: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  ERROR: 'bg-destructive text-destructive-foreground'
};

const statusColors: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  validated: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  imported: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  skipped: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  error: 'bg-destructive text-destructive-foreground'
};

export function TransactionsTable({ transactions, isLoading }: TransactionsTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [classificationFilter, setClassificationFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<keyof ImportedTransaction>('transaction_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const filteredTransactions = useMemo(() => {
    let result = [...transactions];

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(tx => 
        tx.order_id?.toLowerCase().includes(term) ||
        tx.product_name?.toLowerCase().includes(term) ||
        tx.sku_external_code?.toLowerCase().includes(term)
      );
    }

    // Classification filter
    if (classificationFilter !== 'all') {
      result = result.filter(tx => tx.classification_status === classificationFilter);
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(tx => tx.import_status === statusFilter);
    }

    // Sort
    result.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      const aStr = String(aVal);
      const bStr = String(bVal);
      return sortDir === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });

    return result;
  }, [transactions, searchTerm, classificationFilter, statusFilter, sortField, sortDir]);

  const stats = useMemo(() => {
    const counts: Record<string, number> = {
      total: transactions.length,
      FBA_SALE: 0,
      RETURN: 0,
      DUPLICATE: 0,
      UNKNOWN: 0,
      imported: 0,
      pending: 0
    };

    transactions.forEach(tx => {
      if (tx.classification_status in counts) {
        counts[tx.classification_status]++;
      }
      if (tx.import_status in counts) {
        counts[tx.import_status]++;
      }
    });

    return counts;
  }, [transactions]);

  const handleSort = (field: keyof ImportedTransaction) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(value);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Imported Transactions</CardTitle>
        <CardDescription>
          {stats.total} total • {stats.FBA_SALE} sales • {stats.RETURN} returns • {stats.DUPLICATE} duplicates
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by order ID, product, or SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={classificationFilter} onValueChange={setClassificationFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Classification" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classifications</SelectItem>
                <SelectItem value="FBA_SALE">FBA Sales</SelectItem>
                <SelectItem value="RETURN">Returns</SelectItem>
                <SelectItem value="DUPLICATE">Duplicates</SelectItem>
                <SelectItem value="UNKNOWN">Unknown</SelectItem>
                <SelectItem value="ERROR">Errors</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="validated">Validated</SelectItem>
                <SelectItem value="imported">Imported</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table */}
        <div className="border rounded-lg overflow-auto max-h-[600px]">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead 
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('transaction_date')}
                >
                  <div className="flex items-center gap-1">
                    Date
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead>Type</TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('order_id')}
                >
                  <div className="flex items-center gap-1">
                    Order ID
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead>Product / SKU</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Fees</TableHead>
                <TableHead 
                  className="text-right cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('net_amount')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Net
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="max-w-[200px]">Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                    No transactions found
                  </TableCell>
                </TableRow>
              ) : (
                filteredTransactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {tx.transaction_date 
                        ? format(new Date(tx.transaction_date), 'MMM d, yyyy')
                        : '-'
                      }
                    </TableCell>
                    <TableCell className="text-sm">
                      {tx.transaction_type || '-'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {tx.order_id || '-'}
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[200px]">
                        <div className="text-sm truncate">{tx.product_name || '-'}</div>
                        {tx.sku_external_code && (
                          <div className="text-xs text-muted-foreground">{tx.sku_external_code}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {formatCurrency(tx.gross_amount)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {formatCurrency(Math.abs(tx.amazon_fee) + Math.abs(tx.fba_fee) + Math.abs(tx.other_fees))}
                    </TableCell>
                    <TableCell className={cn(
                      "text-right text-sm font-medium",
                      tx.net_amount < 0 ? "text-destructive" : "text-green-600 dark:text-green-400"
                    )}>
                      {formatCurrency(tx.net_amount)}
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("text-xs", classificationColors[tx.classification_status])}>
                        {tx.classification_status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("text-xs", statusColors[tx.import_status])}>
                        {tx.import_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <span className="text-xs text-muted-foreground truncate block">
                        {tx.reason_log || '-'}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {filteredTransactions.length > 0 && (
          <div className="text-sm text-muted-foreground text-right">
            Showing {filteredTransactions.length} of {transactions.length} transactions
          </div>
        )}
      </CardContent>
    </Card>
  );
}
