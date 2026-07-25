import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

interface SubscriptionRow {
  id: number;
  status: string;
  billing_cycle: string | null;
  amount: string | null;
  ends_at: string | null;
  plan: { name: string; plan_code: string };
  user: { id: number; name: string; email: string };
}

interface Paginated<T> {
  data: T[];
}

export default function AdminSubscriptions() {
  const { data, isLoading, error } = useQuery<Paginated<SubscriptionRow>>({
    queryKey: ['admin-subscriptions'],
    queryFn: () => api.get('/admin/subscriptions'),
  });

  if (isLoading) {
    return (
      <div className="h-[50vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return <div className="p-6 text-destructive">Failed to load subscriptions.</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Admin — All Tenant Subscriptions</h1>

      <Card>
        <CardHeader>
          <CardTitle>Subscriptions ({data.data.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Billing</TableHead>
                <TableHead>Ends</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.user?.name}</TableCell>
                  <TableCell>{row.user?.email}</TableCell>
                  <TableCell>{row.plan?.name}</TableCell>
                  <TableCell>
                    <Badge variant={row.status === 'active' ? 'default' : 'secondary'}>{row.status}</Badge>
                  </TableCell>
                  <TableCell>{row.billing_cycle ?? '—'}</TableCell>
                  <TableCell>{row.ends_at ? new Date(row.ends_at).toLocaleDateString() : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
