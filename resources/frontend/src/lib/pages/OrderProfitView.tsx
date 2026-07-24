import { useState } from 'react';
import { useSalesOrders } from '@/hooks/useSales';
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
  TrendingUp,
  DollarSign,
  Percent,
  Search,
  Eye,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { ProfitBreakdown } from '@/components/orders/ProfitBreakdown';

export default function OrderProfitView() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const { data: ordersData, isLoading } = useSalesOrders();

  const orders = ordersData || [];

  const filteredOrders = orders.filter((order: any) =>
    order.order_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    order.platform_order_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    order.customer_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Summary Metrics (Basic Calculation)
  // In a real app, these should come from a dedicated stats endpoint
  const totalRevenue = orders.reduce((sum: number, o: any) => sum + parseFloat(o.total_amount || 0), 0);

  // Note: COGS should ideally come from the backend's profitability endpoint per order.
  // For the summary dashboard, we'll keep it simple or show 'N/A' if not calculated.
  // Here we'll show what we can from the list.

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Order Profit Analysis</h1>
          <p className="text-gray-400">Analyze gross profit and margins per individual order</p>
        </div>

        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <Input
              placeholder="Search orders..."
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
              <DollarSign size={16} /> Total Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">
              {formatCurrency(totalRevenue)}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <TrendingUp size={16} /> Avg. Gross Profit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-400 flex items-center gap-1">
              -- <span className="text-xs text-gray-500 font-normal ml-2">(Calculated in detail)</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <Percent size={16} /> Avg. Margin
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-400">
              --
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-gray-800/50 border-gray-700 overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-gray-900/50">
              <TableRow className="border-gray-700 hover:bg-transparent">
                <TableHead className="text-gray-400">Order #</TableHead>
                <TableHead className="text-gray-400">Channel</TableHead>
                <TableHead className="text-gray-400">Customer</TableHead>
                <TableHead className="text-gray-400">Total Amount</TableHead>
                <TableHead className="text-gray-400">Status</TableHead>
                <TableHead className="text-gray-400">Date</TableHead>
                <TableHead className="text-right text-gray-400">Analysis</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-gray-700 animate-pulse">
                    <TableCell colSpan={7} className="h-16 bg-gray-800/20"></TableCell>
                  </TableRow>
                ))
              ) : filteredOrders.length === 0 ? (
                <TableRow className="border-gray-700">
                  <TableCell colSpan={7} className="text-center py-12 text-gray-500">
                    No orders found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredOrders.map((order: any) => (
                  <TableRow key={order.id} className="border-gray-700 hover:bg-gray-800/30 transition-colors">
                    <TableCell>
                      <div className="font-medium text-white">{order.order_number || order.platform_order_id}</div>
                      <div className="text-xs text-gray-500">{order.platform_order_id}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {order.channel?.name || 'Manual'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-300">
                      {order.customer_name || '-'}
                    </TableCell>
                    <TableCell className="text-white font-medium">
                      {formatCurrency(order.total_amount)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={order.status === 'completed' ? 'outline' : 'secondary'}
                        className={order.status === 'completed' ? 'border-emerald-500 text-emerald-500' : ''}
                      >
                        {order.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-400 text-xs">
                      {formatDate(order.order_date)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10"
                        onClick={() => setSelectedOrderId(order.id)}
                      >
                        <Eye size={18} className="mr-2" /> View Profit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedOrderId && (
        <ProfitBreakdown
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
        />
      )}
    </div>
  );
}
