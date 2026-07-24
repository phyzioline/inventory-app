import { useState, useEffect } from 'react';
import {
  TrendingUp,
  Search,
  Package,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  User,
  History,
  Tractor,
  ExternalLink,
  ChevronRight,
  Filter
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { toast } from 'sonner';

interface PurchaseHistoryItem {
  id: number;
  sku: {
    sku_code: string;
    master_product: {
      internal_name: string;
    }
  };
  batch: {
    batch_number: string;
    invoice_number: string;
    invoice_date: string;
    currency: string;
  };
  quantity: number;
  unit_price: number;
  total_price: number;
  created_at: string;
}

export default function SupplierCostTracking() {
  const [vendors, setVendors] = useState<any[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(null);
  const [history, setHistory] = useState<PurchaseHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchVendors();
  }, []);

  const fetchVendors = async () => {
    try {
      const response = await api.getArray('vendors');
      setVendors(response);

      // Check for vendorId in URL
      const params = new URLSearchParams(window.location.hash.split('?')[1]);
      const vendorIdParam = params.get('vendorId');

      if (vendorIdParam) {
        const id = parseInt(vendorIdParam);
        setSelectedVendorId(id);
        fetchHistory(id);
      } else if (response.length > 0 && !selectedVendorId) {
        setSelectedVendorId(response[0].id);
        fetchHistory(response[0].id);
      }
    } catch (e) {
      toast.error('Failed to load vendors');
    }
  };

  const fetchHistory = async (vendorId: number) => {
    setIsLoading(true);
    try {
      const response = await api.get(`vendors/${vendorId}/purchase-history`);
      setHistory(response || []);
    } catch (e) {
      toast.error('Failed to load price history');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVendorSelect = (id: number) => {
    setSelectedVendorId(id);
    fetchHistory(id);
  };

  const selectedVendor = vendors.find(v => v.id === selectedVendorId);

  // Group history by product to see trends
  const groupedByProduct = history.reduce((acc: any, item) => {
    const skuCode = item.sku?.sku_code || 'Unknown';
    if (!acc[skuCode]) acc[skuCode] = [];
    acc[skuCode].push(item);
    return acc;
  }, {});

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">Supplier Cost Tracking</h1>
          <p className="text-gray-400">Monitor purchase price trends and vendor performance</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Vendor Sidebar */}
        <Card className="lg:col-span-1 bg-gray-900/50 border-gray-800">
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Tractor size={16} className="text-emerald-500" />
              Vendors
            </CardTitle>
            <div className="relative mt-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
              <Input
                placeholder="Search vendor..."
                className="pl-8 bg-black/20 border-gray-800 text-xs h-8"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="p-0 max-h-[600px] overflow-y-auto">
            {vendors.filter(v => v.name.toLowerCase().includes(searchTerm.toLowerCase())).map(vendor => (
              <button
                key={vendor.id}
                onClick={() => handleVendorSelect(vendor.id)}
                className={`w-full text-left px-4 py-3 flex items-center justify-between border-b border-gray-800/50 transition-colors ${selectedVendorId === vendor.id ? 'bg-emerald-500/10 border-r-2 border-r-emerald-500' : 'hover:bg-gray-800/30'
                  }`}
              >
                <div className="min-w-0">
                  <div className={`text-sm font-medium truncate ${selectedVendorId === vendor.id ? 'text-emerald-400' : 'text-gray-300'}`}>
                    {vendor.name}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{vendor.email || 'No email registered'}</div>
                </div>
                <ChevronRight size={14} className={selectedVendorId === vendor.id ? 'text-emerald-500' : 'text-gray-700'} />
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Analytics Main View */}
        <div className="lg:col-span-3 space-y-6">
          {isLoading ? (
            <Card className="bg-gray-900/50 border-gray-800 h-[400px] flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
            </Card>
          ) : !selectedVendorId ? (
            <Card className="bg-gray-900/50 border-gray-800 h-[400px] flex flex-col items-center justify-center text-gray-500">
              <History size={48} className="mb-4 opacity-10" />
              <p>Select a vendor to view cost analytics</p>
            </Card>
          ) : (
            <>
              {/* Header Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-emerald-500/5 border-emerald-500/10">
                  <CardContent className="pt-6">
                    <div className="text-xs text-emerald-500/70 font-bold uppercase tracking-wider mb-1">Total Purchases</div>
                    <div className="text-2xl font-bold text-white tracking-tight">{history.length} line items</div>
                  </CardContent>
                </Card>
                <Card className="bg-blue-500/5 border-blue-500/10">
                  <CardContent className="pt-6">
                    <div className="text-xs text-blue-500/70 font-bold uppercase tracking-wider mb-1">Last Invoice</div>
                    <div className="text-2xl font-bold text-white tracking-tight">
                      {history[0] ? formatDate(history[0].batch.invoice_date) : 'N/A'}
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-purple-500/5 border-purple-500/10">
                  <CardContent className="pt-6">
                    <div className="text-xs text-purple-500/70 font-bold uppercase tracking-wider mb-1">Active SKUs</div>
                    <div className="text-2xl font-bold text-white tracking-tight">{Object.keys(groupedByProduct).length} Products</div>
                  </CardContent>
                </Card>
              </div>

              {/* Price Trends Table */}
              <Card className="bg-gray-900/50 border-gray-800">
                <CardHeader className="flex flex-row items-center justify-between border-b border-gray-800 pb-4">
                  <CardTitle className="text-lg font-bold text-white flex items-center gap-2">
                    <TrendingUp size={20} className="text-emerald-500" />
                    Price History for {selectedVendor.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-black/40">
                        <TableRow className="border-gray-800">
                          <TableHead className="text-[10px] font-bold uppercase text-gray-500">Product</TableHead>
                          <TableHead className="text-[10px] font-bold uppercase text-gray-500">SKU</TableHead>
                          <TableHead className="text-[10px] font-bold uppercase text-gray-500">Last Price</TableHead>
                          <TableHead className="text-[10px] font-bold uppercase text-gray-500">Purchase Count</TableHead>
                          <TableHead className="text-[10px] font-bold uppercase text-gray-500">Price Trend</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(groupedByProduct).map(([skuCode, items]: [string, any]) => {
                          const lastItem = items[0];
                          const prevItem = items[1];
                          const priceDiff = prevItem ? lastItem.unit_price - prevItem.unit_price : 0;

                          return (
                            <TableRow key={skuCode} className="border-gray-800 hover:bg-gray-800/20 group">
                              <TableCell className="font-medium text-gray-200 py-4">
                                {lastItem.sku?.master_product?.internal_name}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-gray-500">
                                {skuCode}
                              </TableCell>
                              <TableCell className="font-bold text-white">
                                {formatCurrency(lastItem.unit_price, lastItem.batch.currency)}
                              </TableCell>
                              <TableCell className="text-gray-400">
                                <Badge variant="secondary" className="bg-gray-800 text-gray-400 rounded-md">
                                  {items.length} times
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {prevItem ? (
                                  <div className={`flex items-center gap-1 text-xs font-bold ${priceDiff > 0 ? 'text-red-400' : priceDiff < 0 ? 'text-emerald-400' : 'text-gray-500'}`}>
                                    {priceDiff > 0 ? <ArrowUpRight size={14} /> : priceDiff < 0 ? <ArrowDownRight size={14} /> : null}
                                    {priceDiff !== 0 ? Math.abs((priceDiff / prevItem.unit_price) * 100).toFixed(1) + '%' : 'No change'}
                                  </div>
                                ) : (
                                  <span className="text-xs text-gray-600 italic">First purchase</span>
                                )}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Detailed Log */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-gray-400 flex items-center gap-2 px-2">
                  <ClipboardList size={16} /> Raw Purchase Log
                </h3>
                {history.slice(0, 10).map((item) => (
                  <div key={item.id} className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 flex flex-col md:flex-row justify-between gap-4">
                    <div className="flex gap-4">
                      <div className="p-2 bg-gray-800 rounded-lg h-10 w-10 flex items-center justify-center text-emerald-500">
                        <Package size={20} />
                      </div>
                      <div>
                        <div className="font-bold text-gray-200">{item.sku?.master_product?.internal_name}</div>
                        <div className="flex gap-4 mt-1">
                          <span className="text-[10px] text-gray-500 flex items-center gap-1">
                            <Calendar size={10} /> {formatDate(item.batch.invoice_date)}
                          </span>
                          <span className="text-[10px] text-gray-500 flex items-center gap-1 font-mono uppercase">
                            INV: {item.batch.invoice_number}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <div className="text-[10px] text-gray-500 uppercase font-bold">Quantity</div>
                        <div className="text-sm font-bold text-white">{item.quantity}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-gray-500 uppercase font-bold">Unit Price</div>
                        <div className="text-lg font-bold text-emerald-400">{formatCurrency(item.unit_price, item.batch.currency)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Internal icons helper (simulated since some aren't in lucide basic list)
const ClipboardList = ({ size, className }: any) => <ClipboardListLucide size={size} className={className} />;
import { ClipboardList as ClipboardListLucide } from 'lucide-react';
