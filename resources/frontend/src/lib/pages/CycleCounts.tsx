import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import axios from 'axios';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

type CycleCount = {
  id: number;
  status: string;
  location?: { id: number; name?: string };
  items?: Array<{
    id: number;
    sku_id: number;
    system_qty: number;
    counted_qty: number | null;
    variance_qty: number | null;
    sku?: { id: number; sku?: string; name?: string };
  }>;
};

export default function CycleCounts() {
  const { language, dir } = useLanguage();
  const isAr = language === 'ar';
  const queryClient = useQueryClient();
  const [locationId, setLocationId] = useState('');
  const [activeId, setActiveId] = useState<number | null>(null);
  const [counts, setCounts] = useState<Record<number, string>>({});

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => axios.get('/api/inventory/warehouses').then((r) => r.data),
  });

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['cycle-counts'],
    queryFn: async () => {
      const res = await axios.get('/api/inventory/cycle-counts');
      return (res.data?.data || []) as CycleCount[];
    },
  });

  const active = useMemo(() => list.find((c) => c.id === activeId) || null, [list, activeId]);

  const create = useMutation({
    mutationFn: () =>
      axios.post('/api/inventory/cycle-counts', { location_id: Number(locationId) }).then((r) => r.data),
    onSuccess: (payload) => {
      queryClient.invalidateQueries({ queryKey: ['cycle-counts'] });
      const id = payload?.data?.id;
      if (id) setActiveId(id);
      toast.success(isAr ? 'تم بدء الجرد' : 'Cycle count started');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || (isAr ? 'فشل' : 'Failed')),
  });

  const saveCounts = useMutation({
    mutationFn: async () => {
      if (!active) return;
      const lines = (active.items || []).map((item) => ({
        sku_id: item.sku_id,
        counted_qty: Number(counts[item.sku_id] ?? item.counted_qty ?? item.system_qty ?? 0),
      }));
      return axios.post(`/api/inventory/cycle-counts/${active.id}/counts`, { lines }).then((r) => r.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cycle-counts'] });
      toast.success(isAr ? 'تم حفظ العدّ' : 'Counts saved');
    },
  });

  const post = useMutation({
    mutationFn: () => axios.post(`/api/inventory/cycle-counts/${activeId}/post`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cycle-counts'] });
      toast.success(isAr ? 'تم ترحيل فروقات الجرد' : 'Variances posted');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || (isAr ? 'فشل الترحيل' : 'Post failed')),
  });

  return (
    <div className="space-y-6" dir={dir}>
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <ClipboardList className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{isAr ? 'جرد دوري' : 'Cycle counts'}</h1>
          <p className="text-muted-foreground">
            {isAr ? 'عدّ المخزون وترحيل الفروقات كتعديلات.' : 'Count stock and post variances as adjustments.'}
          </p>
        </div>
      </motion.div>

      <Card className="glass-card">
        <CardHeader className="flex flex-row items-end justify-between gap-4">
          <div>
            <CardTitle>{isAr ? 'بدء جرد' : 'Start count'}</CardTitle>
            <CardDescription>{isAr ? 'اختر موقعاً لسحب أرصدة النظام.' : 'Pick a location to snapshot system qty.'}</CardDescription>
          </div>
          <div className="flex gap-2 items-end">
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder={isAr ? 'الموقع' : 'Location'} />
              </SelectTrigger>
              <SelectContent>
                {(Array.isArray(warehouses) ? warehouses : []).map((w: any) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button disabled={!locationId || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : isAr ? 'بدء' : 'Start'}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base">{isAr ? 'الجلسات' : 'Sessions'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground">{isAr ? 'لا جلسات' : 'None yet'}</p>
            ) : (
              list.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setActiveId(c.id);
                    const next: Record<number, string> = {};
                    (c.items || []).forEach((i) => {
                      next[i.sku_id] = String(i.counted_qty ?? i.system_qty ?? 0);
                    });
                    setCounts(next);
                  }}
                  className={`w-full text-start rounded-md border px-3 py-2 text-sm ${
                    activeId === c.id ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <div className="font-medium">#{c.id} · {c.location?.name || '—'}</div>
                  <Badge variant="secondary" className="mt-1">
                    {c.status}
                  </Badge>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              {active ? `#${active.id}` : isAr ? 'اختر جلسة' : 'Select a session'}
            </CardTitle>
            {active && active.status !== 'posted' && (
              <div className="flex gap-2">
                <Button variant="outline" disabled={saveCounts.isPending} onClick={() => saveCounts.mutate()}>
                  {isAr ? 'حفظ العدّ' : 'Save counts'}
                </Button>
                <Button disabled={post.isPending} onClick={() => post.mutate()}>
                  {isAr ? 'ترحيل الفروقات' : 'Post variances'}
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {!active ? (
              <p className="text-muted-foreground text-sm">{isAr ? 'لا يوجد اختيار' : 'Nothing selected'}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>{isAr ? 'النظام' : 'System'}</TableHead>
                    <TableHead>{isAr ? 'العدّ' : 'Counted'}</TableHead>
                    <TableHead>{isAr ? 'الفرق' : 'Variance'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(active.items || []).map((item) => {
                    const counted = Number(counts[item.sku_id] ?? item.counted_qty ?? item.system_qty ?? 0);
                    const variance = counted - Number(item.system_qty || 0);
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-medium">{item.sku?.sku || item.sku_id}</div>
                          <div className="text-xs text-muted-foreground">{item.sku?.name}</div>
                        </TableCell>
                        <TableCell>{Number(item.system_qty).toFixed(2)}</TableCell>
                        <TableCell>
                          <Input
                            className="w-28"
                            type="number"
                            disabled={active.status === 'posted'}
                            value={counts[item.sku_id] ?? String(item.counted_qty ?? item.system_qty ?? 0)}
                            onChange={(e) => setCounts((prev) => ({ ...prev, [item.sku_id]: e.target.value }))}
                          />
                        </TableCell>
                        <TableCell className={variance === 0 ? '' : variance > 0 ? 'text-emerald-600' : 'text-destructive'}>
                          {variance.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
