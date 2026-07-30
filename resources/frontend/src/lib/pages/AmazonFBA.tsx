import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Package } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Mode = 'fba' | 'fbm';

const FBA_TYPES = new Set(['amazon_fba', 'fba']);
const FBM_TYPES = new Set(['amazon_merchant', 'amazon_fbm', 'fbm', 'merchant']);

function matchType(raw: unknown, mode: Mode): boolean {
  const t = String(raw || '').trim().toLowerCase();
  if (mode === 'fba') return FBA_TYPES.has(t) || t.includes('fba');
  return FBM_TYPES.has(t) || (t.includes('amazon') && !t.includes('fba'));
}

export function AmazonChannelInventoryPage({ mode }: { mode: Mode }) {
  const { language, dir } = useLanguage();
  const isAr = language === 'ar';
  const title = mode === 'fba' ? 'Amazon FBA' : 'Amazon FBM';

  const { data: channels = [], isLoading: channelsLoading } = useQuery({
    queryKey: ['channels'],
    queryFn: () => axios.get('/api/inventory/channels').then((r) => r.data),
  });

  const matched = useMemo(
    () => (Array.isArray(channels) ? channels : []).filter((c: any) => matchType(c.type, mode) && c.is_active !== false),
    [channels, mode]
  );

  const channelIds = matched.map((c: any) => c.id).join(',');

  const { data: skus = [], isLoading: skusLoading } = useQuery({
    queryKey: ['amazon-channel-skus', mode, channelIds],
    enabled: matched.length > 0,
    queryFn: async () => {
      const all = await axios.get('/api/inventory/skus').then((r) => r.data);
      const ids = new Set(matched.map((c: any) => Number(c.id)));
      return (Array.isArray(all) ? all : []).filter((s: any) => ids.has(Number(s.channel_id)));
    },
  });

  return (
    <div className="space-y-6" dir={dir}>
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Package className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{title}</h1>
            <p className="text-muted-foreground">
              {isAr
                ? 'قائمة SKUs المرتبطة بقنوات أمازون من هذا النوع.'
                : 'SKUs linked to Amazon channels of this fulfillment type.'}
            </p>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link to="/channels">{isAr ? 'كل القنوات' : 'All channels'}</Link>
        </Button>
      </motion.div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base">{isAr ? 'القنوات المطابقة' : 'Matched channels'}</CardTitle>
          <CardDescription>
            {channelsLoading
              ? '…'
              : matched.length === 0
                ? isAr
                  ? 'لا توجد قنوات من هذا النوع بعد — أضف قناة من الإعدادات.'
                  : 'No channels of this type yet — add one in Settings.'
                : matched.map((c: any) => c.name).join(' · ')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {skusLoading || channelsLoading ? (
            <p className="text-sm text-muted-foreground">{isAr ? 'جاري التحميل…' : 'Loading…'}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>{isAr ? 'الاسم' : 'Name'}</TableHead>
                  <TableHead>{isAr ? 'القناة' : 'Channel'}</TableHead>
                  <TableHead>{isAr ? 'Lot / Serial' : 'Lot / Serial'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skus.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      {isAr ? 'لا توجد SKUs' : 'No SKUs'}
                    </TableCell>
                  </TableRow>
                ) : (
                  skus.slice(0, 200).map((s: any) => {
                    const ch = matched.find((c: any) => Number(c.id) === Number(s.channel_id));
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.sku || s.seller_sku || s.id}</TableCell>
                        <TableCell>{s.name || s.title || '—'}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{ch?.name || s.channel_id}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {[s.lot_number, s.serial_number].filter(Boolean).join(' / ') || '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AmazonFBA() {
  return <AmazonChannelInventoryPage mode="fba" />;
}
