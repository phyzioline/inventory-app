import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2 } from 'lucide-react';

interface AdminOverview {
  total_products: number;
  low_stock_count: number;
  out_of_stock_count: number;
  pending_returns: number;
  total_orders: number;
  total_revenue: number;
  tenant_count: number;
  low_stock_by_tenant: Array<{ user_id: number; low_stock_count: number }>;
  recent_pending_returns: Array<{
    id: number;
    return_status?: string;
    inventory_status?: string;
    inventory_order?: { platform_order_id?: string; customer_name?: string; user_id?: number };
  }>;
}

const StatCard = ({ label, value }: { label: string; value: number | string }) => (
  <Card>
    <CardHeader className="pb-2">
      <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
    </CardContent>
  </Card>
);

export default function AdminOverview() {
  const { data, isLoading, error } = useQuery<AdminOverview>({
    queryKey: ['admin-overview'],
    queryFn: () => api.get('/admin/overview'),
  });

  if (isLoading) {
    return (
      <div className="h-[50vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return <div className="p-6 text-destructive">Failed to load admin overview.</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Admin — Cross-Tenant Overview</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Tenants" value={data.tenant_count} />
        <StatCard label="Total Products" value={data.total_products} />
        <StatCard label="Total Orders" value={data.total_orders} />
        <StatCard label="Total Revenue" value={data.total_revenue} />
        <StatCard label="Low Stock" value={data.low_stock_count} />
        <StatCard label="Out of Stock" value={data.out_of_stock_count} />
        <StatCard label="Pending Returns" value={data.pending_returns} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top Tenants by Low-Stock Count</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User ID</TableHead>
                <TableHead>Low-Stock Items</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.low_stock_by_tenant.map((row) => (
                <TableRow key={row.user_id}>
                  <TableCell>{row.user_id}</TableCell>
                  <TableCell>{row.low_stock_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Pending Returns (all tenants)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>User ID</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recent_pending_returns.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.inventory_order?.platform_order_id ?? '—'}</TableCell>
                  <TableCell>{row.inventory_order?.customer_name ?? '—'}</TableCell>
                  <TableCell>{row.inventory_order?.user_id ?? '—'}</TableCell>
                  <TableCell>{row.return_status ?? row.inventory_status ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
