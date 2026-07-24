import { useState } from 'react';
import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { ShoppingCart, Search, Filter, Calendar, Loader2, Package, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useAmazonOrders } from '@/hooks/useAmazonOrders';
import { format } from 'date-fns';

export default function AmazonOrders() {
    const { t } = useLanguage();
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [channelFilter, setChannelFilter] = useState('all');

    const { data: orders, isLoading } = useAmazonOrders({
        status: statusFilter,
        fulfillmentChannel: channelFilter,
        search,
    });

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Pending': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
            case 'Shipped': return 'bg-blue-100 text-blue-800 border-blue-300';
            case 'Delivered': return 'bg-green-100 text-green-800 border-green-300';
            case 'Returned': return 'bg-red-100 text-red-800 border-red-300';
            case 'Canceled': return 'bg-gray-100 text-gray-800 border-gray-300';
            default: return 'bg-gray-100 text-gray-800 border-gray-300';
        }
    };

    const getFulfillmentIcon = (channel: string) => {
        return channel === 'Amazon' ? (
            <Package className="w-4 h-4 text-orange-600" />
        ) : (
            <Truck className="w-4 h-4 text-blue-600" />
        );
    };

    if (isLoading) {
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
                        <ShoppingCart className="w-6 h-6" />
                        Amazon Orders
                    </h1>
                    <p className="text-muted-foreground">Track and manage all Amazon orders</p>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="glass-card p-4 rounded-xl">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Total Orders</p>
                            <p className="text-2xl font-bold">{orders?.length || 0}</p>
                        </div>
                        <ShoppingCart className="w-8 h-8 text-primary opacity-50" />
                    </div>
                </div>
                <div className="glass-card p-4 rounded-xl">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Pending</p>
                            <p className="text-2xl font-bold text-yellow-600">
                                {orders?.filter(o => o.orderStatus === 'Pending').length || 0}
                            </p>
                        </div>
                        <Calendar className="w-8 h-8 text-yellow-500 opacity-50" />
                    </div>
                </div>
                <div className="glass-card p-4 rounded-xl">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">FBA Orders</p>
                            <p className="text-2xl font-bold text-orange-600">
                                {orders?.filter(o => o.fulfillmentChannel === 'Amazon').length || 0}
                            </p>
                        </div>
                        <Package className="w-8 h-8 text-orange-500 opacity-50" />
                    </div>
                </div>
                <div className="glass-card p-4 rounded-xl">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">FBM Orders</p>
                            <p className="text-2xl font-bold text-blue-600">
                                {orders?.filter(o => o.fulfillmentChannel === 'Merchant').length || 0}
                            </p>
                        </div>
                        <Truck className="w-8 h-8 text-blue-500 opacity-50" />
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by Order ID, SKU, ASIN, or Product..."
                        className="pl-9"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-[180px]">
                        <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="Pending">Pending</SelectItem>
                        <SelectItem value="Shipped">Shipped</SelectItem>
                        <SelectItem value="Delivered">Delivered</SelectItem>
                        <SelectItem value="Returned">Returned</SelectItem>
                        <SelectItem value="Canceled">Canceled</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={channelFilter} onValueChange={setChannelFilter}>
                    <SelectTrigger className="w-full sm:w-[180px]">
                        <SelectValue placeholder="Fulfillment" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Channels</SelectItem>
                        <SelectItem value="Amazon">FBA</SelectItem>
                        <SelectItem value="Merchant">FBM</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Orders Table */}
            <div className="glass-card rounded-xl overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Order ID</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Product</TableHead>
                            <TableHead>SKU / ASIN</TableHead>
                            <TableHead>Qty</TableHead>
                            <TableHead>Price</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Fulfillment</TableHead>
                            <TableHead>Location</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!orders || orders.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                                    No orders found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            orders.map((order) => (
                                <TableRow key={order.id}>
                                    <TableCell className="font-mono text-xs">
                                        {order.amazonOrderId.slice(0, 15)}...
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {format(new Date(order.purchaseDate), 'dd/MM/yyyy')}
                                    </TableCell>
                                    <TableCell className="max-w-[200px]">
                                        <div className="truncate text-sm" title={order.productName}>
                                            {order.productName || '—'}
                                        </div>
                                    </TableCell>
                                    <TableCell className="font-mono text-xs">
                                        <div>{order.sku}</div>
                                        <div className="text-muted-foreground">{order.asin}</div>
                                    </TableCell>
                                    <TableCell>{order.quantity}</TableCell>
                                    <TableCell className="font-medium">
                                        {order.itemPrice.toLocaleString()} {order.currency}
                                    </TableCell>
                                    <TableCell>
                                        <Badge className={getStatusColor(order.orderStatus)}>
                                            {order.orderStatus}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1">
                                            {getFulfillmentIcon(order.fulfillmentChannel)}
                                            <span className="text-xs">{order.fulfillmentChannel === 'Amazon' ? 'FBA' : 'FBM'}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                        {order.shipCity}, {order.shipState}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
