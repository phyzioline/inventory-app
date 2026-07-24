import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import { fetchMergedLocationInventory, resolveInventoryRowQty } from '@/lib/warehouseInventoryFetch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowRightLeft, Calendar, MapPin, Package } from 'lucide-react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { Check, ChevronsUpDown, Search } from 'lucide-react';

type Props = {
  open: boolean;
  transferTxId: string | null;
  onOpenChange: (open: boolean) => void;
};

function extractUserNotes(raw: string): string {
  let s = String(raw || '').trim();
  if (!s) return '';
  // remove cross-sku suffix if exists
  s = s.replace(/\s*\[cross-SKU:[^\]]+\]\s*$/i, '').trim();
  // remove system prefix (OUT/IN)
  s = s.replace(/^Transfer\s+OUT\s+to\s+Location\s+#\d+\.\s*/i, '');
  s = s.replace(/^Transfer\s+IN\s+from\s+Location\s+#\d+\.\s*/i, '');
  return s.trim();
}

function toNumber(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatDateTime(value: unknown): { date: string; time: string } {
  const d = new Date(String(value || ''));
  if (Number.isNaN(d.getTime())) return { date: '—', time: '—' };
  return {
    date: d.toLocaleDateString(),
    time: d.toLocaleTimeString(),
  };
}

export function TransferDetailsDialog({ open, transferTxId, onOpenChange }: Props) {
  const { t, language } = useLanguage();
  const isAr = language === 'ar';
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [destPickerOpen, setDestPickerOpen] = useState(false);
  const [destSearch, setDestSearch] = useState('');

  const { data: outTx, isLoading: loadingOut } = useQuery({
    queryKey: ['transfer-out-tx', transferTxId],
    queryFn: () => api.get(`/transactions/${transferTxId}`),
    enabled: open && !!transferTxId,
    staleTime: 0,
  });

  const inTxId = useMemo(() => {
    const rid = outTx?.reference_id;
    if (rid == null) return null;
    const s = String(rid).trim();
    return s ? s : null;
  }, [outTx]);

  const { data: inTx, isLoading: loadingIn } = useQuery({
    queryKey: ['transfer-in-tx', inTxId],
    queryFn: () => api.get(`/transactions/${inTxId}`),
    enabled: open && !!inTxId,
    staleTime: 0,
  });

  const [qty, setQty] = useState<number>(1);
  const [loadedQty, setLoadedQty] = useState<number>(1);
  const [notes, setNotes] = useState<string>('');
  const [fromLocationId, setFromLocationId] = useState<string>('');
  const [toLocationId, setToLocationId] = useState<string>('');
  const [toSkuId, setToSkuId] = useState<string>('');

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.getArray('warehouses'),
    enabled: open,
    staleTime: 60_000,
  });

  const fromLocation = useMemo(
    () => (locations || []).find((l: any) => String(l.id) === String(fromLocationId)),
    [locations, fromLocationId]
  );
  const toLocation = useMemo(
    () => (locations || []).find((l: any) => String(l.id) === String(toLocationId)),
    [locations, toLocationId]
  );

  const toChannelId = toLocation?.channel_id != null ? String(toLocation.channel_id) : '';
  const fromChannelId = fromLocation?.channel_id != null ? String(fromLocation.channel_id) : '';

  const { data: destInventory = [], isLoading: loadingDestInventory } = useQuery({
    queryKey: ['transfer-edit-dest-inventory', toLocationId, toChannelId],
    queryFn: () => fetchMergedLocationInventory(String(toLocationId), toChannelId || null),
    enabled: open && !!toLocationId,
  });

  const { data: sourceInventory = [], isLoading: loadingSourceInventory } = useQuery({
    queryKey: ['transfer-edit-source-inventory', fromLocationId, fromChannelId],
    queryFn: () => fetchMergedLocationInventory(String(fromLocationId), fromChannelId || null),
    enabled: open && !!fromLocationId,
  });

  const destSkuOptions = useMemo(() => {
    const rows = (destInventory || [])
      .filter((item: any) => item?.sku?.id)
      .map((item: any) => ({
        sku_id: String(item.sku.id),
        sku_code: String(item.sku?.sku || ''),
        name:
          item?.sku?.offer?.master_product?.internal_name ||
          item?.sku?.offer?.masterProduct?.internal_name ||
          item?.sku?.name ||
          item?.sku?.offer?.name ||
          '',
        available: resolveInventoryRowQty(item),
      }));
    const dedup = new Map<string, any>();
    for (const r of rows) {
      if (!dedup.has(r.sku_id)) dedup.set(r.sku_id, r);
    }
    return Array.from(dedup.values());
  }, [destInventory]);

  const filteredDestSkuOptions = useMemo(() => {
    const q = destSearch.trim().toLowerCase();
    if (!q) return destSkuOptions;
    return destSkuOptions.filter((s: any) => {
      return String(s.sku_code).toLowerCase().includes(q) || String(s.name).toLowerCase().includes(q);
    });
  }, [destSkuOptions, destSearch]);

  const sourceSkuAvailable = useMemo(() => {
    const srcSkuId = outTx?.sku?.id != null ? String(outTx.sku.id) : '';
    if (!srcSkuId) return null;
    const row = (sourceInventory || []).find((item: any) => String(item?.sku?.id || '') === srcSkuId);
    if (!row) return 0;
    return resolveInventoryRowQty(row);
  }, [sourceInventory, outTx]);

  useEffect(() => {
    if (!open) return;
    const q = toNumber(outTx?.quantity || 1);
    const safe = q > 0 ? q : 1;
    setQty(safe);
    setLoadedQty(safe);
    // show user-editable part; we still allow full notes overwrite
    setNotes(extractUserNotes(String(outTx?.notes || '')));
    setFromLocationId(String(outTx?.location_id || outTx?.location?.id || ''));
    setToLocationId(String(inTx?.location_id || inTx?.location?.id || ''));
    setToSkuId(String(inTx?.sku?.id || ''));
  }, [open, outTx]);

  // when IN tx loads later, align editable fields
  useEffect(() => {
    if (!open) return;
    if (inTx?.location_id != null) setToLocationId(String(inTx.location_id));
    if (inTx?.sku?.id != null) setToSkuId(String(inTx.sku.id));
  }, [open, inTx]);

  const busy = loadingOut || (inTxId != null && loadingIn);

  const sourceLabel = useMemo(() => {
    const loc = fromLocation || outTx?.location;
    return loc?.name || (loc?.id != null ? `#${loc.id}` : '—');
  }, [fromLocation, outTx]);

  const destLabel = useMemo(() => {
    const loc = toLocation || inTx?.location;
    return loc?.name || (loc?.id != null ? `#${loc.id}` : '—');
  }, [toLocation, inTx]);

  const sourceSku = useMemo(() => outTx?.sku?.sku || outTx?.sku?.name || '—', [outTx]);
  const destSku = useMemo(() => {
    const picked = destSkuOptions.find((s: any) => String(s.sku_id) === String(toSkuId));
    return picked?.sku_code || inTx?.sku?.sku || inTx?.sku?.name || '—';
  }, [destSkuOptions, toSkuId, inTx]);

  const sourceProductName = useMemo(() => {
    return (
      outTx?.sku?.offer?.master_product?.internal_name ||
      outTx?.sku?.offer?.masterProduct?.internal_name ||
      outTx?.sku?.offer?.name ||
      outTx?.sku?.name ||
      '—'
    );
  }, [outTx]);

  const destProductName = useMemo(() => {
    const picked = destSkuOptions.find((s: any) => String(s.sku_id) === String(toSkuId));
    if (picked?.name) return picked.name;
    return (
      inTx?.sku?.offer?.master_product?.internal_name ||
      inTx?.sku?.offer?.masterProduct?.internal_name ||
      inTx?.sku?.offer?.name ||
      inTx?.sku?.name ||
      '—'
    );
  }, [destSkuOptions, toSkuId, inTx]);

  const created = formatDateTime(outTx?.created_at || outTx?.updated_at);
  const qtyDiff = loadedQty - qty;

  const excelTable = 'w-full border-collapse border border-border text-[11px] leading-tight';
  const excelTh = 'border border-border bg-muted/90 px-2 py-1.5 font-semibold whitespace-nowrap';
  const excelTd = 'border border-border px-2 py-1 align-middle';
  const excelTdNum = 'border border-border px-2 py-1 text-center font-mono tabular-nums';

  const canSave = !!transferTxId && !busy && qty >= 1 && !saving;

  const handleSave = async () => {
    if (!transferTxId) return;
    setSaving(true);
    try {
      await api.patch(`/transactions/${transferTxId}/transfer`, {
        quantity: Math.max(1, Math.floor(qty || 1)),
        // store user notes text (backend will rebuild OUT/IN prefix)
        notes: notes.trim() || null,
        from_location_id: fromLocationId ? Number(fromLocationId) : null,
        to_location_id: toLocationId ? Number(toLocationId) : null,
        to_sku_id: toSkuId ? Number(toSkuId) : null,
      });
      toast.success(isAr ? 'تم تحديث التحويل' : 'Transfer updated');
      await queryClient.invalidateQueries({ queryKey: ['transfers'] });
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-by-location'] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || (isAr ? 'فشل التحديث' : 'Update failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            {isAr ? 'تفاصيل التحويل' : 'Transfer details'}
          </DialogTitle>
        </DialogHeader>

        {busy ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            {isAr ? 'جارٍ التحميل...' : 'Loading...'}
          </div>
        ) : !outTx ? (
          <div className="py-10 text-center text-muted-foreground">—</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3 bg-muted/20">
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Calendar className="h-3 w-3" />
                  {isAr ? 'التاريخ' : 'Date'}
                </div>
                <div className="text-sm font-semibold">{created.date}</div>
                <div className="text-xs text-muted-foreground">{created.time}</div>
              </div>
              <div className="rounded-lg border p-3 bg-muted/20">
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <MapPin className="h-3 w-3" />
                  {isAr ? 'من' : 'From'}
                </div>
                <div className="text-sm font-semibold truncate" title={sourceLabel}>
                  {sourceLabel}
                </div>
                <div className="text-xs text-muted-foreground font-mono truncate" title={sourceSku}>
                  {sourceSku}
                </div>
              </div>
              <div className="rounded-lg border p-3 bg-muted/20">
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <MapPin className="h-3 w-3" />
                  {isAr ? 'إلى' : 'To'}
                </div>
                <div className="text-sm font-semibold truncate" title={destLabel}>
                  {destLabel}
                </div>
                <div className="text-xs text-muted-foreground font-mono truncate" title={destSku}>
                  {destSku}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{isAr ? 'من (المخزن)' : 'From (warehouse)'}</Label>
                <Select value={fromLocationId} onValueChange={setFromLocationId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={isAr ? 'اختر المخزن' : 'Select warehouse'} />
                  </SelectTrigger>
                  <SelectContent className="z-[70]">
                    {(locations || []).filter((l: any) => l?.is_active !== false).map((l: any) => (
                      <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fromLocationId && (
                  <p className="text-[11px] text-muted-foreground">
                    {loadingSourceInventory
                      ? (isAr ? 'جارٍ تحميل المخزون...' : 'Loading stock...')
                      : (isAr ? 'المتاح من SKU المصدر: ' : 'Available for source SKU: ') + String(sourceSkuAvailable ?? '—')}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>{isAr ? 'إلى (المخزن)' : 'To (warehouse)'}</Label>
                <Select value={toLocationId} onValueChange={(v) => { setToLocationId(v); setToSkuId(''); }}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={isAr ? 'اختر المخزن' : 'Select warehouse'} />
                  </SelectTrigger>
                  <SelectContent className="z-[70]">
                    {(locations || []).filter((l: any) => l?.is_active !== false).map((l: any) => (
                      <SelectItem key={l.id} value={String(l.id)} disabled={String(l.id) === String(fromLocationId)}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {isAr
                    ? 'اختيار مخزن وجهة مختلف قد يتطلب اختيار SKU وجهة مطابق للقناة.'
                    : 'Changing destination may require choosing a destination SKU matching that channel.'}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{isAr ? 'SKU الوجهة' : 'Destination SKU'}</Label>
              {!toLocationId ? (
                <p className="text-sm text-muted-foreground">{isAr ? 'اختر مخزن الوجهة أولاً.' : 'Select destination warehouse first.'}</p>
              ) : loadingDestInventory ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isAr ? 'جارٍ تحميل أصناف الوجهة...' : 'Loading destination SKUs...'}
                </div>
              ) : (
                <Popover open={destPickerOpen} onOpenChange={setDestPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className="w-full justify-between h-9">
                      <span className="truncate font-mono text-sm">
                        {toSkuId
                          ? (destSkuOptions.find((s: any) => String(s.sku_id) === String(toSkuId))?.sku_code || toSkuId)
                          : (isAr ? 'اختر SKU الوجهة…' : 'Pick destination SKU…')}
                      </span>
                      <ChevronsUpDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[360px] p-0 z-[80]" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder={isAr ? 'ابحث بـ SKU أو الاسم...' : 'Search by SKU or name...'}
                        value={destSearch}
                        onValueChange={setDestSearch}
                      />
                      <CommandList>
                        <CommandEmpty>{isAr ? 'لا يوجد نتائج' : 'No results'}</CommandEmpty>
                        <CommandGroup heading={isAr ? `${destSkuOptions.length} SKU في الوجهة` : `${destSkuOptions.length} SKUs at destination`}>
                          {filteredDestSkuOptions.slice(0, 500).map((s: any) => (
                            <CommandItem
                              key={s.sku_id}
                              value={`${s.sku_code} ${s.name}`}
                              keywords={[s.sku_code, s.name]}
                              onSelect={() => {
                                setToSkuId(String(s.sku_id));
                                setDestPickerOpen(false);
                              }}
                            >
                              <Check className={cn('mr-2 h-4 w-4', String(toSkuId) === String(s.sku_id) ? 'opacity-100' : 'opacity-0')} />
                              <div className="flex-1 min-w-0">
                                <div className="font-mono text-xs font-bold truncate">{s.sku_code}</div>
                                <div className="text-xs text-muted-foreground truncate">{s.name}</div>
                              </div>
                              <Badge variant="outline" className="ml-2 shrink-0 text-[10px] font-mono">
                                {s.available}
                              </Badge>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Search className="h-3 w-3" />
                {isAr
                  ? 'ابحث داخل أصناف مخزن الوجهة (لو مخزن مرتبط بقناة لازم SKU الوجهة يكون تابع لنفس القناة).'
                  : 'Search within destination warehouse SKUs (if warehouse is channel-linked, destination SKU must match that channel).'}
              </p>
            </div>

            <div className="rounded-lg border overflow-hidden">
              <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">{isAr ? 'ملخص الصنف' : 'Item summary'}</span>
                </div>
                <Badge variant="outline" className="font-mono">
                  {isAr ? 'رقم الحركة' : 'Tx'} #{outTx?.id}
                </Badge>
              </div>
              <table className={excelTable}>
                <thead>
                  <tr>
                    <th className={cn(excelTh, 'text-start')}>{isAr ? 'SKU المحل' : 'Shop SKU'}</th>
                    <th className={cn(excelTh, 'text-start')}>{isAr ? 'SKU الوجهة' : 'Dest SKU'}</th>
                    <th className={cn(excelTh, 'text-start min-w-[140px]')}>{isAr ? 'المنتج' : 'Product'}</th>
                    <th className={cn(excelTh, 'text-center w-20')}>{isAr ? 'المطلوب' : 'Required'}</th>
                    <th className={cn(excelTh, 'text-center w-24')}>{isAr ? 'المحوّل' : 'Transferred'}</th>
                    <th className={cn(excelTh, 'text-center w-20')}>{isAr ? 'الفرق' : 'Diff'}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={cn(excelTd, 'font-mono text-[10px]')}>{sourceSku}</td>
                    <td className={cn(excelTd, 'font-mono text-[10px]')}>{destSku}</td>
                    <td className={cn(excelTd, 'text-[10px] truncate max-w-[180px]')} title={sourceProductName}>
                      {sourceProductName}
                    </td>
                    <td className={excelTdNum}>{loadedQty}</td>
                    <td className={excelTdNum}>
                      <Input
                        type="number"
                        min={1}
                        inputMode="numeric"
                        value={qty}
                        onChange={(e) => setQty(parseInt(e.target.value, 10) || 1)}
                        className="h-7 w-16 mx-auto font-mono tabular-nums text-center text-xs px-1"
                      />
                    </td>
                    <td
                      className={cn(
                        excelTdNum,
                        qtyDiff > 0 ? 'text-amber-700 font-semibold' : qtyDiff < 0 ? 'text-red-600 font-semibold' : ''
                      )}
                    >
                      {qtyDiff}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="px-3 py-2 text-[11px] text-muted-foreground border-t">
                {isAr
                  ? 'المطلوب = الكمية المحفوظة عند فتح التفاصيل. عدّل «المحوّل» ثم احفظ.'
                  : 'Required = quantity when opened. Edit Transferred then save.'}
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">{t('adjustments.notes') || (isAr ? 'ملاحظات' : 'Notes')}</div>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="min-h-[90px]"
                placeholder={isAr ? 'سبب التحويل / ملاحظة…' : 'Reason / note…'}
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {isAr ? 'إغلاق' : 'Close'}
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={!canSave} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isAr ? 'حفظ التعديل' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

