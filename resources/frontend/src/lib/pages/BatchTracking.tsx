import { useState } from 'react';
import { useSmartImportBatches } from '@/hooks/useSmartImport';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Eye,
  TrendingUp,
  Package,
  Clock,
  Search,
  ArrowRight
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { BatchDetails } from '@/components/inventory/BatchDetails';

export default function BatchTracking() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const { data: batchesData, isLoading } = useSmartImportBatches();

  const handleOpenDetails = (id: number) => {
    setSelectedBatchId(id);
  };

  const batches = batchesData?.data || [];

  const filteredBatches = batches.filter((batch: any) =>
    batch.batch_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    batch.vendor?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    batch.invoice_number?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft': return <Badge variant="secondary">Draft</Badge>;
      case 'approved': return <Badge variant="outline" className="border-blue-500 text-blue-500">Approved</Badge>;
      case 'received': return <Badge variant="outline" className="border-emerald-500 text-emerald-500">Received</Badge>;
      case 'cancelled': return <Badge variant="destructive">Cancelled</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Batch Cost Tracking</h1>
          <p className="text-gray-400">Track landing costs and landing quantities of inventory batches</p>
        </div>

        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <Input
              placeholder="Search batches..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-gray-800 border-gray-700 text-white"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <Package size={16} /> Total Batches
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{batches.length}</div>
          </CardContent>
        </Card>

        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <TrendingUp size={16} /> Total Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-400">
              {formatCurrency(batches.reduce((sum: number, b: any) => sum + parseFloat(b.grand_total || 0), 0))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <Clock size={16} /> Pending Receipt
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-400">
              {batches.filter((b: any) => b.status === 'approved').length}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-gray-800/50 border-gray-700 overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-gray-900/50">
              <TableRow className="border-gray-700 hover:bg-transparent">
                <TableHead className="text-gray-400">Batch Info</TableHead>
                <TableHead className="text-gray-400">Vendor</TableHead>
                <TableHead className="text-gray-400">Invoice</TableHead>
                <TableHead className="text-gray-400">Items</TableHead>
                <TableHead className="text-gray-400">Total Value</TableHead>
                <TableHead className="text-gray-400">Status</TableHead>
                <TableHead className="text-gray-400">Date</TableHead>
                <TableHead className="text-right text-gray-400">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-gray-700 animate-pulse">
                    <TableCell colSpan={8} className="h-16 bg-gray-800/20"></TableCell>
                  </TableRow>
                ))
              ) : filteredBatches.length === 0 ? (
                <TableRow className="border-gray-700">
                  <TableCell colSpan={8} className="text-center py-12 text-gray-500">
                    No batches found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredBatches.map((batch: any) => (
                  <TableRow key={batch.id} className="border-gray-700 hover:bg-gray-800/30 transition-colors">
                    <TableCell>
                      <div className="font-medium text-white">{batch.batch_number}</div>
                      <div className="text-xs text-gray-500">{batch.upload?.filename || 'Manual entry'}</div>
                    </TableCell>
                    <TableCell className="text-gray-300">
                      {batch.vendor?.name || <span className="text-gray-500 italic">Unmatched: {batch.supplier_name_raw}</span>}
                    </TableCell>
                    <TableCell className="text-gray-300">
                      {batch.invoice_number || '-'}
                      {batch.invoice_date && <div className="text-xs text-gray-500">{formatDate(batch.invoice_date)}</div>}
                    </TableCell>
                    <TableCell className="text-gray-300 font-mono">
                      {batch.items_count}
                    </TableCell>
                    <TableCell className="text-emerald-400 font-medium">
                      {formatCurrency(batch.grand_total, batch.currency)}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(batch.status)}
                    </TableCell>
                    <TableCell className="text-gray-400 text-xs">
                      {batch.received_at ? formatDate(batch.received_at) : formatDate(batch.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10"
                        onClick={() => handleOpenDetails(batch.id)}
                      >
                        <Eye size={18} className="mr-2" /> Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedBatchId && (
        <BatchDetails
          batchId={selectedBatchId}
          onClose={() => setSelectedBatchId(null)}
        />
      )}
    </div>
  );
}
