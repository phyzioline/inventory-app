import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '@/lib/api';
import { toast } from 'sonner';
import { Loader2, Upload, CheckCircle2, AlertCircle, Package, ChevronsUpDown, Check, ArrowRight, ArrowLeft, Copy } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { cn, getProductImageSrc } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useQuery } from '@tanstack/react-query';
import { fetchAllWarehouseInventoryPages, resolveInventoryRowQty } from '@/lib/warehouseInventoryFetch';
import {
  buildFbaTransferSummary,
  FbaTransferSummary,
  FbaTransferSummaryTable,
} from '@/components/inventory/FbaTransferSummaryTable';

type ShipmentMeta = {
  shipment_id?: string;
  shipment_name?: string;
  ship_to_fc?: string;
  sku_count?: number | null;
  total_units?: number | null;
};

type StockStatus = 'ok' | 'insufficient' | 'unknown' | 'skipped';

type SkuOption = {
  sku_id: string;
  sku_code: string;
  marketplace_id?: string;
  channel_id?: string;
  channel_type?: string;
  channel_slug?: string;
  channel_name?: string;
  name: string;
  available: number;
  image: string;
  master_product_id?: string;
};

type MatchedItem = {
  amazon_msku: string;
  asin: string;
  fnsku: string;
  title: string;
  quantity: number;
  file_quantity?: number;
  sku_id: number;
  system_sku: string;
  product_name: string;
  matched_by: string;
  source_available: number | null;
  stock_status: StockStatus;
  to_sku_id?: number | null;
  dest_sku_code?: string | null;
  dest_image_url?: string | null;
  source_image_url?: string | null;
};

type UnmatchedItem = {
  amazon_msku: string;
  asin: string;
  fnsku: string;
  title: string;
  quantity: number;
  reason: string;
};

interface FbaRequestTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function resolveInventorySkuImage(item: any): string {
  const sku = item?.sku;
  const raw =
    sku?.offer?.master_product?.image ||
    sku?.offer?.masterProduct?.image ||
    sku?.offer?.master_product?.image_url ||
    sku?.offer?.masterProduct?.image_url ||
    sku?.image_url ||
    sku?.product?.image ||
    sku?.image ||
    '';
  return getProductImageSrc(raw);
}

function mapInventoryToSkuOptions(items: any[]): SkuOption[] {
  return (items || [])
    .map((item: any) => ({
      sku_id: String(item?.sku?.id || ''),
      sku_code: item?.sku?.sku || '',
      marketplace_id: item?.sku?.marketplace_id || '',
      channel_id: item?.sku?.channel_id != null ? String(item.sku.channel_id) : '',
      channel_type: item?.sku?.channel?.type || '',
      channel_slug: item?.sku?.channel?.slug || '',
      channel_name: item?.sku?.channel?.name || '',
      name:
        item?.sku?.offer?.master_product?.internal_name ||
        item?.sku?.offer?.masterProduct?.internal_name ||
        item?.sku?.name ||
        item?.sku?.offer?.name ||
        '',
      available: resolveInventoryRowQty(item),
      image: resolveInventorySkuImage(item),
      master_product_id: String(
        item?.sku?.offer?.master_product?.id ||
          item?.sku?.offer?.masterProduct?.id ||
          item?.sku?.offer?.master_product_id ||
          ''
      ),
    }))
    .filter((s) => s.sku_id);
}

function resolveSkuKind(opt: SkuOption, dir: 'rtl' | 'ltr'): { label: string; className: string } {
  const slug = String(opt.channel_slug || '').toLowerCase();
  const type = String(opt.channel_type || '').toLowerCase();
  const name = String(opt.channel_name || '').toLowerCase();
  const hay = `${slug} ${type} ${name}`;

  const isFba =
    hay.includes('fba') || hay.includes('amazon_fba') || hay.includes('amz_fba') || hay.includes('افن') || /\bafn\b/.test(hay);
  if (isFba) {
    return {
      label: dir === 'rtl' ? 'FBA' : 'FBA',
      className: 'border-purple-500/30 bg-purple-500/10 text-purple-800 dark:text-purple-200',
    };
  }

  const isMerchant =
    hay.includes('merchant') || hay.includes('mfn') || hay.includes('fbm') || hay.includes('تاجر');
  if (isMerchant) {
    return {
      label: dir === 'rtl' ? 'تاجر' : 'Merchant',
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200',
    };
  }

  return {
    label: dir === 'rtl' ? 'محل' : 'Shop',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-200',
  };
}

/** When the shop warehouse has no channel_id, still hide FBA/merchant/noon/jumia listings. */
function isShopSourceSkuOption(opt: SkuOption): boolean {
  const slug = String(opt.channel_slug || '').toLowerCase();
  const type = String(opt.channel_type || '').toLowerCase();
  const name = String(opt.channel_name || '').toLowerCase();
  const hay = `${slug} ${type} ${name}`;

  if (/\bfba\b|amazon_fba|\bafn\b/.test(hay)) return false;
  if (/merchant|\bmfn\b|\bfbm\b|تاجر/.test(hay)) return false;
  if (/noon|نون|jumia|جوميا/.test(hay)) return false;
  if (type.includes('fba') || type.includes('merchant') || type.includes('noon') || type.includes('jumia')) {
    return false;
  }
  // Amazon listing channels are never the physical-shop source catalog.
  if (/amazon|امازون/.test(hay)) return false;

  return true;
}

function normalizeLocChannelLabel(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAvailMap(sourceSkus: SkuOption[]): Map<number, number> {
  const map = new Map<number, number>();
  sourceSkus.forEach((s) => map.set(Number(s.sku_id), s.available));
  return map;
}

function validateTransferRowConstraints(
  row: MatchedItem,
  src: SkuOption | undefined,
  dst: SkuOption | undefined,
  fromLoc: any,
  toLoc: any,
  isAr: boolean
): string | null {
  if (!src || !dst) {
    return isAr
      ? `${row.amazon_msku}: SKU غير موجود في المخزون المحدد`
      : `${row.amazon_msku}: SKU not found in selected warehouse inventory`;
  }

  if (String(src.sku_id) !== String(dst.sku_id)) {
    const fromMaster = src.master_product_id || '';
    const toMaster = dst.master_product_id || '';
    if (!fromMaster || !toMaster || fromMaster !== toMaster) {
      return isAr
        ? `${row.amazon_msku}: SKU المحل (${src.sku_code}) و SKU FBA (${dst.sku_code}) غير مربوطين بنفس المنتج الرئيسي`
        : `${row.amazon_msku}: shop SKU (${src.sku_code}) and FBA SKU (${dst.sku_code}) are not linked to the same master product`;
    }
  }

  const fromChannelId = Number(fromLoc?.channel_id || 0);
  const toChannelId = Number(toLoc?.channel_id || 0);
  const fromSkuChannelId = Number(src.channel_id || 0);
  const toSkuChannelId = Number(dst.channel_id || 0);

  if (fromChannelId > 0 && fromSkuChannelId > 0 && fromChannelId !== fromSkuChannelId) {
    return isAr
      ? `${row.amazon_msku}: SKU المحل (${src.sku_code}) لا يطابق قناة مستودع المصدر`
      : `${row.amazon_msku}: shop SKU (${src.sku_code}) does not match source warehouse channel`;
  }

  if (toChannelId > 0) {
    if (toSkuChannelId <= 0) {
      return isAr
        ? `${row.amazon_msku}: SKU FBA (${dst.sku_code}) غير مربوط بقناة مستودع FBA`
        : `${row.amazon_msku}: FBA SKU (${dst.sku_code}) is not linked to the destination channel`;
    }
    if (toChannelId !== toSkuChannelId) {
      return isAr
        ? `${row.amazon_msku}: SKU FBA (${dst.sku_code}) لا يطابق قناة مستودع FBA`
        : `${row.amazon_msku}: FBA SKU (${dst.sku_code}) does not match FBA warehouse channel`;
    }
  }

  return null;
}

function translateTransferIssueMessage(message: string, isAr: boolean): string {
  const map: Record<string, string> = {
    'Cross-SKU transfers require both listings to be linked to the same master product.': isAr
      ? 'SKU المحل و SKU FBA يجب أن يكونا مربوطين بنفس المنتج الرئيسي'
      : 'Cross-SKU transfers require both listings to be linked to the same master product.',
    'Source location channel does not match SKU channel.': isAr
      ? 'SKU المحل لا يطابق قناة مستودع المصدر'
      : 'Source location channel does not match SKU channel.',
    'Destination SKU must be linked to the destination channel before transferring into this location.': isAr
      ? 'SKU FBA غير مربوط بقناة مستودع FBA'
      : 'Destination SKU must be linked to the destination channel before transferring into this location.',
    'Destination location channel does not match destination SKU channel.': isAr
      ? 'SKU FBA لا يطابق قناة مستودع FBA'
      : 'Destination location channel does not match destination SKU channel.',
    'SKU not found for this transfer row.': isAr ? 'SKU غير موجود لهذا الصف' : 'SKU not found for this transfer row.',
  };
  return map[message] || message;
}

function applyStockStatuses(items: MatchedItem[], availMap: Map<number, number>): MatchedItem[] {
  const demand = new Map<number, number>();
  items.forEach((r) => {
    if (!r.sku_id || r.quantity <= 0) return;
    demand.set(r.sku_id, (demand.get(r.sku_id) || 0) + r.quantity);
  });

  return items.map((r) => {
    if (r.quantity <= 0) {
      const avail = availMap.has(r.sku_id) ? availMap.get(r.sku_id)! : r.source_available;
      return { ...r, source_available: avail, stock_status: 'skipped' as StockStatus };
    }

    const avail = availMap.has(r.sku_id) ? availMap.get(r.sku_id)! : r.source_available;
    if (avail == null) {
      return { ...r, source_available: null, stock_status: 'unknown' as StockStatus };
    }
    const totalDemand = demand.get(r.sku_id) || 0;
    const ok = totalDemand <= avail;
    return { ...r, source_available: avail, stock_status: ok ? ('ok' as StockStatus) : ('insufficient' as StockStatus) };
  });
}

function SkuThumb({ src, alt }: { src?: string; alt?: string }) {
  return (
    <div className="h-7 w-7 rounded border bg-muted/40 overflow-hidden flex items-center justify-center shrink-0">
      {src ? (
        <img src={src} alt={alt || ''} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <Package className="h-4 w-4 text-muted-foreground" />
      )}
    </div>
  );
}

function looksLikeFba(loc: any): boolean {
  const name = String(loc?.name || '').toLowerCase();
  const type = String(loc?.type || '').toLowerCase();
  return (
    type === 'amazon_fba' ||
    type.includes('fba') ||
    /\bfba\b/i.test(name) ||
    (name.includes('amazon') && name.includes('fba')) ||
    (name.includes('امازون') && name.includes('fba'))
  );
}

export default function FbaRequestTransferDialog({ open, onOpenChange, onSuccess }: FbaRequestTransferDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [shipment, setShipment] = useState<ShipmentMeta | null>(null);
  const [fileTotalUnits, setFileTotalUnits] = useState<number | null>(null);
  const [matchedItems, setMatchedItems] = useState<MatchedItem[]>([]);
  const [unmatchedItems, setUnmatchedItems] = useState<UnmatchedItem[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const { t, language, dir } = useLanguage();
  const isAr = language === 'ar';
  const [destSkuPickerOpen, setDestSkuPickerOpen] = useState<Record<string, boolean>>({});
  const [sourceSkuPickerOpen, setSourceSkuPickerOpen] = useState<Record<string, boolean>>({});
  const [unmatchedDraft, setUnmatchedDraft] = useState<Record<string, { sourceSkuId: string; destSkuId: string }>>({});
  const [transferSummary, setTransferSummary] = useState<FbaTransferSummary | null>(null);
  const [submitIssues, setSubmitIssues] = useState<string[]>([]);
  const [priorTransfer, setPriorTransfer] = useState<{
    exists: boolean;
    shipment_id?: string;
    transferred_at?: string | null;
    line_count?: number;
    total_units?: number;
    notes_sample?: string | null;
  } | null>(null);

  const resetState = () => {
    setFile(null);
    setMatchedItems([]);
    setUnmatchedItems([]);
    setShipment(null);
    setFileTotalUnits(null);
    setDestSkuPickerOpen({});
    setSourceSkuPickerOpen({});
    setUnmatchedDraft({});
    setTransferSummary(null);
    setSubmitIssues([]);
    setPriorTransfer(null);
  };

  const finishAndClose = () => {
    onSuccess();
    resetState();
    onOpenChange(false);
  };

  const handleDialogOpenChange = (next: boolean) => {
    if (!next) {
      if (transferSummary) onSuccess();
      resetState();
    }
    onOpenChange(next);
  };

  const loadLocations = async () => {
    try {
      const rows = await api.getArray('warehouses');
      setLocations(rows);
      if (!rows.length) return;

      if (!destinationLocationId) {
        const suggestedFba = rows.find((loc: any) => looksLikeFba(loc));
        if (suggestedFba) setDestinationLocationId(String(suggestedFba.id));
      }
      if (!sourceLocationId) {
        const suggestedSource = rows.find((loc: any) => !looksLikeFba(loc)) || rows[0];
        if (suggestedSource) setSourceLocationId(String(suggestedSource.id));
      }
    } catch {
      toast.error(isAr ? 'تعذر تحميل المواقع' : 'Failed to load locations');
    }
  };

  const { data: sourceInventory = [], isLoading: loadingSource } = useQuery({
    queryKey: ['transfer-source-inventory-fba', sourceLocationId],
    queryFn: () => fetchAllWarehouseInventoryPages(sourceLocationId),
    enabled: open && !!sourceLocationId,
  });

  const { data: destInventory = [], isLoading: loadingDest } = useQuery({
    queryKey: ['transfer-dest-inventory-fba', destinationLocationId],
    queryFn: () => fetchAllWarehouseInventoryPages(destinationLocationId),
    enabled: open && !!destinationLocationId,
  });

  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.getArray('/channels'),
    enabled: open,
    staleTime: 60_000,
  });

  const allSourceSkus = useMemo(() => mapInventoryToSkuOptions(sourceInventory), [sourceInventory]);
  const allDestSkus = useMemo(() => mapInventoryToSkuOptions(destInventory), [destInventory]);

  const destChannelId = useMemo(() => {
    const loc = locations.find((l: any) => String(l.id) === destinationLocationId);
    if (loc?.channel_id != null && String(loc.channel_id) !== '') return String(loc.channel_id);
    return '';
  }, [locations, destinationLocationId]);

  const sourceChannelId = useMemo(() => {
    const loc = locations.find((l: any) => String(l.id) === sourceLocationId);
    if (loc?.channel_id != null && String(loc.channel_id) !== '') {
      return String(loc.channel_id);
    }
    // Physical shop warehouses often have null channel_id — match by name to the shop channel.
    const locName = normalizeLocChannelLabel(String(loc?.name || ''));
    if (!locName || !channels.length) return '';
    const matched = (channels as any[]).find((c) => {
      const n = normalizeLocChannelLabel(String(c?.name || ''));
      const s = normalizeLocChannelLabel(String(c?.slug || '').replace(/-/g, ' '));
      return (n && n === locName) || (s && s === locName);
    });
    return matched?.id != null ? String(matched.id) : '';
  }, [locations, sourceLocationId, channels]);

  /** Source picker: only shop-channel SKUs (never FBA/merchant/noon sitting in the same warehouse). */
  const sourceSkus = useMemo(() => {
    if (sourceChannelId) {
      return allSourceSkus.filter((s) => String(s.channel_id || '') === sourceChannelId);
    }
    return allSourceSkus.filter(isShopSourceSkuOption);
  }, [allSourceSkus, sourceChannelId]);

  /** Destination picker: only the selected FBA warehouse channel when known. */
  const destSkus = useMemo(() => {
    if (destChannelId) {
      return allDestSkus.filter((s) => String(s.channel_id || '') === destChannelId);
    }
    return allDestSkus;
  }, [allDestSkus, destChannelId]);

  const sourceAvailMap = useMemo(() => buildAvailMap(sourceSkus), [sourceSkus]);
  const refreshMatchedStock = useCallback(
    (items: MatchedItem[]) => applyStockStatuses(items, sourceAvailMap),
    [sourceAvailMap]
  );

  useEffect(() => {
    if (open) {
      loadLocations();
      return;
    }
    resetState();
  }, [open]);

  useEffect(() => {
    if (!sourceAvailMap.size || matchedItems.length === 0) return;
    setMatchedItems((prev) => refreshMatchedStock(prev));
  }, [sourceAvailMap, refreshMatchedStock]);

  useEffect(() => {
    if (!destInventory.length || !matchedItems.length) return;
    const destImageBySkuId = new Map<string, string>();
    allDestSkus.forEach((d) => {
      if (d.sku_id && d.image) destImageBySkuId.set(d.sku_id, d.image);
    });
    setMatchedItems((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        if (!row.to_sku_id || row.dest_image_url) return row;
        const img = destImageBySkuId.get(String(row.to_sku_id));
        if (!img) return row;
        changed = true;
        return { ...row, dest_image_url: img };
      });
      return changed ? next : prev;
    });
  }, [allDestSkus, destInventory.length]);

  const fbaDestinationOptions = useMemo(() => {
    const fba = locations.filter((loc: any) => looksLikeFba(loc));
    const rest = locations.filter((loc: any) => !looksLikeFba(loc));
    return [...fba, ...rest].filter((loc: any) => String(loc.id) !== sourceLocationId);
  }, [locations, sourceLocationId]);

  const sourceOptions = useMemo(() => {
    return locations
      .filter((loc: any) => String(loc.id) !== destinationLocationId)
      .sort((a: any, b: any) => (looksLikeFba(a) ? 1 : 0) - (looksLikeFba(b) ? 1 : 0));
  }, [locations, destinationLocationId]);

  const parseTsv = async () => {
    if (!file) {
      toast.error(isAr ? 'اختر ملف الشحنة أولاً' : 'Please select the shipment TSV file first');
      return;
    }
    if (!sourceLocationId || !destinationLocationId) {
      toast.error(isAr ? 'اختر المصدر ومستودع FBA' : 'Select source and FBA warehouse');
      return;
    }

    setIsParsing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('source_location_id', sourceLocationId);
      formData.append('destination_location_id', destinationLocationId);

      const response = await api.post('transfers/fba-shipment/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const matched = ((response?.matched_items || []) as MatchedItem[]).map((row) => ({
        ...row,
        file_quantity: row.file_quantity ?? row.quantity,
      }));
      const unmatched = (response?.unmatched_items || []) as UnmatchedItem[];
      setShipment((response?.shipment || null) as ShipmentMeta | null);
      setFileTotalUnits(Number(response?.summary?.total_units ?? response?.shipment?.total_units ?? 0) || null);
      setTransferSummary(null);
      setSubmitIssues([]);
      setPriorTransfer(response?.prior_transfer?.exists ? response.prior_transfer : null);
      setMatchedItems(refreshMatchedStock(matched));
      setUnmatchedItems(unmatched);
      setUnmatchedDraft({});

      if (response?.prior_transfer?.exists) {
        const at = response.prior_transfer.transferred_at
          ? new Date(response.prior_transfer.transferred_at).toLocaleString(isAr ? 'ar-EG' : 'en-GB')
          : '';
        toast.error(
          isAr
            ? `هذه الشحنة رُفعت مسبقاً${at ? ` يوم ${at}` : ''} — ${response.prior_transfer.line_count ?? 0} سطر، ${response.prior_transfer.total_units ?? 0} وحدة`
            : `This shipment was already transferred${at ? ` on ${at}` : ''} — ${response.prior_transfer.line_count ?? 0} line(s), ${response.prior_transfer.total_units ?? 0} unit(s)`,
          { duration: 12_000 }
        );
      } else {
        toast.success(
          isAr
            ? `تم التحليل: ${matched.length} مطابق، ${unmatched.length} غير مطابق`
            : `Parsed: ${matched.length} matched, ${unmatched.length} unmatched`
        );
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.message || (isAr ? 'فشل تحليل الملف' : 'Failed to parse shipment file'));
    } finally {
      setIsParsing(false);
    }
  };

  const setRowSourceSku = (amazonMsku: string, opt: SkuOption) => {
    setSubmitIssues([]);
    setMatchedItems((prev) =>
      refreshMatchedStock(
        prev.map((row) =>
          row.amazon_msku === amazonMsku
            ? {
                ...row,
                sku_id: Number(opt.sku_id),
                system_sku: opt.sku_code,
                product_name: opt.name,
                source_image_url: opt.image || null,
                matched_by: 'manual',
              }
            : row
        )
      )
    );
  };

  const setRowDestSku = (amazonMsku: string, opt: SkuOption) => {
    setSubmitIssues([]);
    setMatchedItems((prev) =>
      prev.map((row) =>
        row.amazon_msku === amazonMsku
          ? {
              ...row,
              to_sku_id: Number(opt.sku_id),
              dest_sku_code: opt.sku_code,
              dest_image_url: opt.image || null,
            }
          : row
      )
    );
  };

  const setRowQuantity = (amazonMsku: string, rawQty: number) => {
    setSubmitIssues([]);
    const quantity = Math.max(0, Math.floor(rawQty || 0));
    setMatchedItems((prev) =>
      refreshMatchedStock(prev.map((row) => (row.amazon_msku === amazonMsku ? { ...row, quantity } : row)))
    );
  };

  const linkUnmatchedRow = (row: UnmatchedItem) => {
    const draft = unmatchedDraft[row.amazon_msku];
    if (!draft?.sourceSkuId || !draft?.destSkuId) {
      toast.error(isAr ? 'اختر SKU المحل و SKU الـ FBA' : 'Select shop SKU and FBA SKU');
      return;
    }
    const src = sourceSkus.find((s) => s.sku_id === draft.sourceSkuId);
    const dst = destSkus.find((s) => s.sku_id === draft.destSkuId);
    if (!src || !dst) {
      toast.error(isAr ? 'SKU غير موجود في المخزون المحدد' : 'SKU not found in selected warehouses');
      return;
    }

    const newRow: MatchedItem = {
      amazon_msku: row.amazon_msku,
      asin: row.asin,
      fnsku: row.fnsku,
      title: row.title,
      quantity: row.quantity,
      file_quantity: row.quantity,
      sku_id: Number(src.sku_id),
      system_sku: src.sku_code,
      product_name: src.name,
      matched_by: 'manual-link',
      source_available: src.available,
      stock_status: 'unknown',
      to_sku_id: Number(dst.sku_id),
      dest_sku_code: dst.sku_code,
      dest_image_url: dst.image || null,
      source_image_url: src.image || null,
    };

    setMatchedItems((prev) => refreshMatchedStock([...prev, newRow]));
    setUnmatchedItems((prev) => prev.filter((u) => u.amazon_msku !== row.amazon_msku));
    setUnmatchedDraft((prev) => {
      const next = { ...prev };
      delete next[row.amazon_msku];
      return next;
    });
  };

  const previewUnits = useMemo(
    () => matchedItems.reduce((sum, r) => sum + (r.quantity > 0 ? r.quantity : 0), 0),
    [matchedItems]
  );

  const validation = useMemo(() => {
    const issues: string[] = [];
    const activeItems = matchedItems.filter((r) => r.quantity > 0);
    const skippedCount = matchedItems.length - activeItems.length;
    const fromLoc = locations.find((loc: any) => String(loc.id) === sourceLocationId);
    const toLoc = locations.find((loc: any) => String(loc.id) === destinationLocationId);

    if (!sourceLocationId) issues.push(isAr ? 'اختر موقع المصدر (المحل)' : 'Select source (shop) location');
    if (!destinationLocationId) issues.push(isAr ? 'اختر مستودع FBA' : 'Select FBA warehouse');
    if (activeItems.length === 0) {
      issues.push(
        isAr ? 'لا توجد صفوف بكمية أكبر من صفر للتحويل' : 'No rows with quantity greater than zero to transfer'
      );
    }
    if (unmatchedItems.length > 0) {
      issues.push(
        isAr
          ? `${unmatchedItems.length} صف غير مربوط — اربطها أو صحّح المنتجات في النظام`
          : `${unmatchedItems.length} unmatched row(s) — link them or fix catalog mapping`
      );
    }

    const missingDest = activeItems.filter((r) => !r.to_sku_id).length;
    if (missingDest > 0) {
      issues.push(
        isAr ? `${missingDest} صف بدون SKU FBA` : `${missingDest} row(s) missing FBA destination SKU`
      );
    }

    const missingSource = activeItems.filter((r) => !r.sku_id).length;
    if (missingSource > 0) {
      issues.push(isAr ? `${missingSource} صف بدون SKU المحل` : `${missingSource} row(s) missing shop source SKU`);
    }

    for (const row of activeItems) {
      const src = sourceSkus.find((s) => s.sku_id === String(row.sku_id));
      const dst = destSkus.find((s) => s.sku_id === String(row.to_sku_id));
      const constraintMsg = validateTransferRowConstraints(row, src, dst, fromLoc, toLoc, isAr);
      if (constraintMsg) issues.push(constraintMsg);
    }

    const insufficient = activeItems.filter((r) => r.stock_status === 'insufficient').length;
    if (insufficient > 0) {
      issues.push(
        isAr
          ? `${insufficient} صف يتجاوز مخزون المحل (راجع الكميات أو SKU المصدر)`
          : `${insufficient} row(s) exceed shop stock (check qty or source SKU)`
      );
    }

    const unknown = activeItems.filter((r) => r.stock_status === 'unknown').length;
    if (unknown > 0 && sourceAvailMap.size > 0) {
      issues.push(isAr ? `${unknown} صف بحالة مخزون غير معروفة` : `${unknown} row(s) with unknown stock state`);
    }

    if (fileTotalUnits != null && fileTotalUnits > 0 && previewUnits > fileTotalUnits) {
      issues.push(
        `${t('transfers.fbaRequestUnitsMismatch')} (${previewUnits} > ${fileTotalUnits})`
      );
    }

    if (priorTransfer?.exists) {
      const at = priorTransfer.transferred_at
        ? new Date(priorTransfer.transferred_at).toLocaleString(isAr ? 'ar-EG' : 'en-GB')
        : '';
      issues.push(
        isAr
          ? `الشحنة «${priorTransfer.shipment_id || shipment?.shipment_id || ''}» رُفعت مسبقاً${at ? ` يوم ${at}` : ''} (${priorTransfer.line_count ?? 0} سطر، ${priorTransfer.total_units ?? 0} وحدة) — ممنوع التكرار`
          : `Shipment «${priorTransfer.shipment_id || shipment?.shipment_id || ''}» already transferred${at ? ` on ${at}` : ''} (${priorTransfer.line_count ?? 0} lines, ${priorTransfer.total_units ?? 0} units) — re-upload blocked`
      );
    }

    return {
      issues,
      skippedCount,
      activeCount: activeItems.length,
      canExecute: issues.length === 0 && activeItems.length > 0,
    };
  }, [
    sourceLocationId,
    destinationLocationId,
    matchedItems,
    unmatchedItems,
    fileTotalUnits,
    previewUnits,
    sourceAvailMap.size,
    locations,
    sourceSkus,
    destSkus,
    isAr,
    t,
    priorTransfer,
    shipment?.shipment_id,
  ]);

  const displayIssues = useMemo(
    () => [...validation.issues, ...submitIssues],
    [validation.issues, submitIssues]
  );

  const constraintIssueMskus = useMemo(() => {
    const mskus = new Set<string>();
    for (const issue of displayIssues) {
      const match = issue.match(/^([A-Z0-9-]+):/i);
      if (match?.[1]) mskus.add(match[1]);
    }
    return mskus;
  }, [displayIssues]);

  const resolveRowDestImage = (row: MatchedItem): string => {
    if (row.dest_image_url) return row.dest_image_url;
    if (row.to_sku_id) return destSkus.find((d) => d.sku_id === String(row.to_sku_id))?.image || '';
    return '';
  };

  const resolveRowSourceImage = (row: MatchedItem): string => {
    if (row.source_image_url) return row.source_image_url;
    return sourceSkus.find((s) => s.sku_id === String(row.sku_id))?.image || '';
  };

  const executeTransfer = async () => {
    if (!validation.canExecute) {
      toast.error(t('transfers.fbaRequestPreviewBlocked'));
      return;
    }

    const shipmentId = shipment?.shipment_id || 'fba-shipment';
    const fc = shipment?.ship_to_fc || '';
    const notesParts = [`FBA Shipment ${shipmentId}`, `Units ${previewUnits}`];
    if (fc) notesParts.push(`FC ${fc}`);

    setIsExecuting(true);
    setSubmitIssues([]);
    try {
      await api.post('transactions/transfer-batch', {
        from_location_id: Number(sourceLocationId),
        to_location_id: Number(destinationLocationId),
        notes: notesParts.join(' | '),
        items: matchedItems
          .filter((row) => row.quantity > 0)
          .map((row) => ({
            client_transfer_id: `fba:${shipmentId}:${row.amazon_msku}`,
            sku_id: row.sku_id,
            to_sku_id: row.to_sku_id,
            quantity: row.quantity,
            file_quantity: row.file_quantity ?? row.quantity,
          })),
      });

      setTransferSummary(buildFbaTransferSummary(matchedItems, unmatchedItems, shipment));
      toast.success(isAr ? 'تم التحويل — راجع الملخص أدناه' : 'Transfer complete — review summary below');
    } catch (error: any) {
      const insufficient = error?.response?.data?.insufficient;
      const apiIssues = error?.response?.data?.issues;
      if (error?.response?.data?.error === 'fba_shipment_already_transferred') {
        const prior = error?.response?.data?.prior_transfer;
        if (prior?.exists) setPriorTransfer(prior);
        toast.error(
          error?.response?.data?.message ||
            (isAr ? 'هذه الشحنة رُفعت مسبقاً — ممنوع التكرار' : 'Shipment already transferred — blocked')
        );
      } else if (Array.isArray(apiIssues) && apiIssues.length) {
        const active = matchedItems.filter((r) => r.quantity > 0);
        const lines = apiIssues.map((issue: { index?: number; message?: string }) => {
          const idx = Number(issue.index ?? -1);
          const msku = idx >= 0 ? active[idx]?.amazon_msku : '';
          const msg = translateTransferIssueMessage(String(issue.message || ''), isAr);
          return msku ? `${msku}: ${msg}` : msg;
        });
        setSubmitIssues(lines);
        toast.error(
          isAr
            ? `فشل التحويل — ${lines.length} صف فيه مشكلة (راجع التفاصيل أعلاه)`
            : `Transfer failed — ${lines.length} row issue(s) (see details above)`
        );
      } else if (Array.isArray(insufficient) && insufficient.length) {
        toast.error(
          isAr
            ? `مخزون غير كافٍ لـ ${insufficient.length} SKU في المحل`
            : `Insufficient shop stock for ${insufficient.length} SKU(s)`
        );
      } else {
        toast.error(error?.response?.data?.message || (isAr ? 'فشل التحويل' : 'Transfer failed'));
      }
    } finally {
      setIsExecuting(false);
    }
  };

  const copySheetSku = async (sku: string) => {
    try {
      await navigator.clipboard.writeText(sku);
      toast.success(isAr ? `تم نسخ SKU: ${sku}` : `Copied SKU: ${sku}`);
    } catch {
      toast.error(isAr ? 'تعذّر النسخ' : 'Could not copy');
    }
  };

  const renderSkuPicker = (
    rowKey: string,
    options: SkuOption[],
    selectedSkuId: string | number | null | undefined,
    placeholder: string,
    pickerOpen: Record<string, boolean>,
    setPickerOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
    onSelect: (opt: SkuOption) => void,
    imageUrl?: string,
    sheetReference?: string
  ) => {
    const showingSheetRef = !selectedSkuId && !!sheetReference;
    const displayLabel = selectedSkuId
      ? options.find((o) => o.sku_id === String(selectedSkuId))?.sku_code || selectedSkuId
      : sheetReference || placeholder;

    return (
    <div className="flex items-center gap-1 w-full min-w-0 max-w-[185px]">
      {selectedSkuId ? <SkuThumb src={imageUrl} alt="" /> : null}
      {showingSheetRef ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-purple-700 hover:text-purple-900 hover:bg-purple-100"
          title={isAr ? 'نسخ SKU من الشيت' : 'Copy SKU from file'}
          onClick={() => copySheetSku(sheetReference!)}
        >
          <Copy className="h-3 w-3" />
        </Button>
      ) : null}
      <Popover
        open={!!pickerOpen[rowKey]}
        onOpenChange={(o) => setPickerOpen((prev) => ({ ...prev, [rowKey]: o }))}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              'flex-1 justify-between text-xs h-7 min-w-[110px] px-1.5',
              selectedSkuId
                ? 'border-teal-400 text-teal-800 bg-teal-50'
                : showingSheetRef
                  ? 'border-purple-400 border-dashed bg-purple-50/80 text-purple-900'
                  : 'border-dashed border-amber-400 bg-amber-50 text-amber-900'
            )}
            title={
              showingSheetRef
                ? isAr
                  ? `SKU من ملف الشحنة — انسخه واربطه في النظام ثم اختره هنا`
                  : `SKU from shipment file — copy, link in catalog, then select here`
                : undefined
            }
          >
            <span className="truncate font-mono text-start">{displayLabel}</span>
            <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ms-1" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(92vw,440px)] p-0" align="start">
          <Command>
            <CommandInput
              placeholder={isAr ? 'ابحث بالـ SKU أو الاسم...' : 'Search SKU or name...'}
              defaultValue={showingSheetRef ? sheetReference : undefined}
            />
            <CommandList>
              <CommandEmpty>{isAr ? 'لا يوجد SKU' : 'No SKU found'}</CommandEmpty>
              <CommandGroup>
                {options.map((opt) => (
                  <CommandItem
                    key={opt.sku_id}
                    value={`${opt.sku_code} ${opt.marketplace_id} ${opt.name}`}
                    className="items-center py-2"
                    onSelect={() => {
                      onSelect(opt);
                      setPickerOpen((prev) => ({ ...prev, [rowKey]: false }));
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4 shrink-0',
                        String(selectedSkuId) === opt.sku_id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <SkuThumb src={opt.image} alt={opt.sku_code} />
                    <div className="flex-1 min-w-0 ml-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="font-mono text-xs font-bold truncate">{opt.sku_code}</div>
                        <Badge
                          variant="outline"
                          className={cn(
                            'shrink-0 text-[10px] font-semibold px-1.5 py-0.5',
                            resolveSkuKind(opt, dir).className
                          )}
                          title={opt.channel_name || opt.channel_slug || opt.channel_type || undefined}
                        >
                          {resolveSkuKind(opt, dir).label}
                        </Badge>
                      </div>
                      {opt.marketplace_id && (
                        <div className="text-[10px] text-muted-foreground font-mono">{opt.marketplace_id}</div>
                      )}
                      <div className="text-xs text-muted-foreground truncate">{opt.name}</div>
                    </div>
                    <Badge variant="outline" className="ml-2 shrink-0 text-xs font-mono">
                      {opt.available}
                    </Badge>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="w-[99vw] max-w-[99vw] h-[96vh] max-h-[96vh] overflow-hidden !flex flex-col gap-2 p-3 sm:p-3">
        <DialogHeader className="shrink-0 space-y-0.5">
          <DialogTitle className="flex items-center gap-1.5 text-base">
            {transferSummary ? (
              <CheckCircle2 className="w-4 h-4 text-green-600" />
            ) : (
              <Package className="w-4 h-4" />
            )}
            {transferSummary
              ? isAr
                ? 'ملخص تحويل FBA'
                : 'FBA transfer summary'
              : t('transfers.fbaRequest')}
          </DialogTitle>
          <DialogDescription className="text-xs leading-snug">
            {transferSummary
              ? isAr
                ? 'كمية الشيت من ملف أمازون مقابل ما تم تحويله فعلياً — الفرق = الشيت − المحوّل.'
                : 'Sheet quantity from the Amazon file vs what was actually transferred — diff = sheet − transferred.'
              : t('transfers.fbaRequestDesc')}
          </DialogDescription>
        </DialogHeader>

        {transferSummary ? (
          <>
            <FbaTransferSummaryTable summary={transferSummary} isAr={isAr} className="flex-1 min-h-0" />
            <DialogFooter className="shrink-0 gap-2 pt-1.5 border-t">
              <Button className="h-8 min-w-[140px] text-xs" onClick={finishAndClose}>
                {isAr ? 'إغلاق' : 'Close'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 shrink-0">
          <div className="space-y-1">
            <Label className="text-xs">{isAr ? 'من (المحل)' : 'From (shop)'}</Label>
            <Select
              value={sourceLocationId}
              onValueChange={(v) => {
                setSourceLocationId(v);
                if (matchedItems.length) setMatchedItems((prev) => refreshMatchedStock(prev));
              }}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder={isAr ? 'اختر المصدر' : 'Select source'} />
              </SelectTrigger>
              <SelectContent>
                {sourceOptions.map((loc: any) => (
                  <SelectItem key={loc.id} value={String(loc.id)}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{isAr ? 'إلى (FBA)' : 'To (FBA)'}</Label>
            <Select value={destinationLocationId} onValueChange={setDestinationLocationId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder={isAr ? 'مستودع FBA' : 'FBA warehouse'} />
              </SelectTrigger>
              <SelectContent>
                {fbaDestinationOptions.map((loc: any) => (
                  <SelectItem key={loc.id} value={String(loc.id)}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2 xl:col-span-2 flex flex-col">
            <Label className="text-xs">{isAr ? 'ملف شحنة Amazon (TSV)' : 'Amazon shipment TSV'}</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 h-8 justify-start text-xs font-normal min-w-0"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-4 h-4 me-2 shrink-0" />
                <span className="truncate">{file ? file.name : isAr ? 'اختر TSV' : 'Choose TSV'}</span>
              </Button>
              <Button
                className="h-8 px-3 shrink-0 text-xs"
                onClick={parseTsv}
                disabled={!file || isParsing || !sourceLocationId || !destinationLocationId}
              >
                {isParsing ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : null}
                {isAr ? 'تحليل' : 'Parse'}
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".tsv,.txt,.csv"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>

        {(shipment?.shipment_id || shipment?.shipment_name || matchedItems.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 shrink-0">
            {shipment && (shipment.shipment_id || shipment.shipment_name) ? (
              <div className="rounded-md border bg-muted/20 px-2.5 py-1 text-[11px] flex flex-wrap items-center gap-x-3 gap-y-0.5 h-[56px] overflow-hidden">
                <div className="font-bold text-teal-800 flex items-center gap-1">
                  <Package className="w-3.5 h-3.5" />
                  {isAr ? 'بيانات الشحنة:' : 'Shipment:'}
                </div>
                <div className="font-mono space-y-0.5 text-[11px] flex items-center gap-3">
                  {shipment.shipment_id && <div><span className="text-muted-foreground">ID:</span> {shipment.shipment_id}</div>}
                  {shipment.ship_to_fc && <div><span className="text-muted-foreground">FC:</span> {shipment.ship_to_fc}</div>}
                  {fileTotalUnits != null && (
                    <div>
                      <span className="text-muted-foreground">{isAr ? 'أمازون:' : 'AMZ:'}</span> <strong>{fileTotalUnits}</strong>
                      {' · '}
                      <span className="text-muted-foreground">{isAr ? 'معاينة:' : 'Prev:'}</span>{' '}
                      <strong
                        className={
                          previewUnits === fileTotalUnits
                            ? 'text-green-700'
                            : previewUnits > fileTotalUnits
                              ? 'text-red-600'
                              : 'text-amber-700'
                        }
                      >
                        {previewUnits}
                      </strong>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="hidden md:block" />
            )}
            {matchedItems.length > 0 && (
              <div
                className={cn(
                  'rounded-md border px-2.5 py-1 text-[11px] leading-snug min-h-[56px] max-h-[140px] overflow-y-auto',
                  priorTransfer?.exists
                    ? 'border-red-300 bg-red-50/70 text-red-950'
                    : validation.canExecute
                      ? 'border-green-200 bg-green-50/50 text-green-900'
                      : 'border-amber-200 bg-amber-50/50 text-amber-950'
                )}
              >
                {priorTransfer?.exists ? (
                  <div className="font-bold flex items-center gap-1.5 text-[11px] text-red-800">
                    <AlertCircle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                    {isAr
                      ? `شحنة مكررة: رُفعت مسبقاً${
                          priorTransfer.transferred_at
                            ? ` يوم ${new Date(priorTransfer.transferred_at).toLocaleString('ar-EG')}`
                            : ''
                        } — ${priorTransfer.line_count ?? 0} سطر / ${priorTransfer.total_units ?? 0} وحدة`
                      : `Duplicate shipment: already transferred${
                          priorTransfer.transferred_at
                            ? ` on ${new Date(priorTransfer.transferred_at).toLocaleString('en-GB')}`
                            : ''
                        } — ${priorTransfer.line_count ?? 0} lines / ${priorTransfer.total_units ?? 0} units`}
                  </div>
                ) : null}
                <div className="font-bold flex items-center gap-1.5 text-[11px]">
                  {validation.canExecute ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                  )}
                  {validation.canExecute ? t('transfers.fbaRequestPreviewReady') : t('transfers.fbaRequestPreviewBlocked')}
                </div>
                {validation.canExecute && validation.skippedCount > 0 && (
                  <div className="mt-1 text-[10.5px]">
                    {isAr
                      ? `${validation.skippedCount} صف بكمية 0 — لن يُرحَّل`
                      : `${validation.skippedCount} row(s) at qty 0 — skipped`}
                  </div>
                )}
                {validation.canExecute &&
                  fileTotalUnits != null &&
                  fileTotalUnits > 0 &&
                  previewUnits < fileTotalUnits && (
                    <div className="mt-1 text-[10.5px] text-amber-800">
                      {isAr
                        ? `تحويل جزئي: ${previewUnits} من ${fileTotalUnits} وحدة في الملف`
                        : `Partial transfer: ${previewUnits} of ${fileTotalUnits} file units`}
                    </div>
                  )}
                {displayIssues.length > 0 && (
                  <ul className="mt-1 list-disc list-inside space-y-0.5 text-[10.5px]">
                    {displayIssues.map((issue, idx) => (
                      <li key={idx}>{issue}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {matchedItems.length === 0 && unmatchedItems.length === 0 ? (
          <div className="flex-1 min-h-[200px] flex items-center justify-center rounded-lg border border-dashed bg-muted/20 text-muted-foreground text-sm px-6 text-center">
            {isAr
              ? 'بعد رفع ملف TSV اضغط «تحليل» — ستظهر المنتجات الجاهزة للتحويل هنا.'
              : 'Upload TSV and click «Parse» — ready-to-transfer products appear here.'}
          </div>
        ) : (
        <div className="flex flex-row flex-1 min-h-0 gap-2 overflow-hidden">
          <div className="flex-[3] min-h-0 flex flex-col border-2 border-green-200 rounded-lg overflow-hidden bg-background shadow-sm">
            <div className="px-2.5 py-1.5 border-b bg-green-50/80 font-semibold text-xs flex items-center gap-1.5 shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
              {isAr
                ? `جاهز للتحويل (${matchedItems.length}) — المنتجات التي ستُرحَّل`
                : `Ready to transfer (${matchedItems.length})`}
            </div>
            <div className="flex-1 overflow-auto overflow-x-auto">
              <table className="w-full text-xs table-fixed min-w-[720px]">
                <colgroup>
                  <col className="w-[120px]" />
                  <col className="w-[185px]" />
                  <col className="w-[52px]" />
                  <col className="w-[28px]" />
                  <col className="w-[44px]" />
                  <col className="w-[185px]" />
                </colgroup>
                <thead className="sticky top-0 bg-background border-b z-10 shadow-sm">
                  <tr>
                    <th className="text-start p-1.5">MSKU</th>
                    <th className="text-start p-1.5">{t('transfers.fbaRequestToFba')}</th>
                    <th className="text-center p-1">{isAr ? 'كمية' : 'Qty'}</th>
                    <th className="text-center p-0" />
                    <th className="text-center p-1">{isAr ? 'متاح' : 'Avail'}</th>
                    <th className="text-start p-1.5">{t('transfers.fbaRequestFromShop')}</th>
                  </tr>
                </thead>
                <tbody>
                  {matchedItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-3 text-muted-foreground text-center">
                        {isAr ? 'حلّل الملف أولاً' : 'Parse the file first'}
                      </td>
                    </tr>
                  ) : (
                    matchedItems.map((row, i) => (
                      <tr
                        key={`${row.amazon_msku}-${i}`}
                        className={cn(
                          'border-b align-middle',
                          row.quantity <= 0 && 'bg-muted/40 opacity-75',
                          constraintIssueMskus.has(row.amazon_msku) && 'bg-amber-50/90 ring-1 ring-inset ring-amber-300',
                          row.quantity > 0 && row.stock_status === 'insufficient' && 'bg-red-50/80',
                          row.quantity > 0 && row.stock_status === 'ok' && row.to_sku_id && !constraintIssueMskus.has(row.amazon_msku) && 'bg-green-50/30'
                        )}
                      >
                        <td className="p-1.5">
                          <div className="font-mono font-semibold text-[11px] leading-tight">{row.amazon_msku}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{row.asin}</div>
                        </td>
                        <td className="p-1 pe-0">
                          {loadingDest ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            renderSkuPicker(
                              `dst-${row.amazon_msku}`,
                              destSkus,
                              row.to_sku_id,
                              isAr ? 'SKU FBA' : 'FBA SKU',
                              destSkuPickerOpen,
                              setDestSkuPickerOpen,
                              (opt) => setRowDestSku(row.amazon_msku, opt),
                              resolveRowDestImage(row)
                            )
                          )}
                        </td>
                        <td className="p-1 px-0.5">
                          <Input
                            type="number"
                            min={1}
                            className="h-7 w-full min-w-0 font-mono text-xs px-1 text-center"
                            value={row.quantity}
                            onChange={(e) => setRowQuantity(row.amazon_msku, Number(e.target.value))}
                          />
                        </td>
                        <td className="p-0 text-muted-foreground text-center">
                          {dir === 'rtl' ? <ArrowRight className="h-3.5 w-3.5 inline-block" /> : <ArrowLeft className="h-3.5 w-3.5 inline-block" />}
                        </td>
                        <td
                          className={cn(
                            'p-1 font-mono text-center text-xs ps-0',
                            row.stock_status === 'insufficient' ? 'text-red-600 font-bold' : 'text-green-700'
                          )}
                        >
                          {row.source_available ?? '—'}
                        </td>
                        <td className="p-1 ps-0">
                          {loadingSource ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            renderSkuPicker(
                              `src-${row.amazon_msku}`,
                              sourceSkus,
                              row.sku_id,
                              isAr ? 'SKU المحل' : 'Shop SKU',
                              sourceSkuPickerOpen,
                              setSourceSkuPickerOpen,
                              (opt) => setRowSourceSku(row.amazon_msku, opt),
                              resolveRowSourceImage(row)
                            )
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {unmatchedItems.length > 0 && (
          <div className="w-[min(400px,34%)] shrink-0 min-h-0 flex flex-col border border-red-200/80 rounded-md overflow-hidden bg-red-50/20">
            <div className="px-2 py-1 border-b bg-red-50/60 shrink-0">
              <div className="font-medium text-[11px] flex items-center gap-1">
                <AlertCircle className="w-3 h-3 text-red-600" />
                {isAr ? `غير مربوط (${unmatchedItems.length}) — ربط يدوي` : `Unlinked (${unmatchedItems.length}) — link manually`}
              </div>
              <div className="text-[10px] text-red-800/80 mt-0.5 leading-snug">
                {isAr
                  ? 'SKU أمازون من الشيت ظاهر في عمود FBA — انسخه واربطه في النظام ثم اختره.'
                  : 'Amazon SKU from the file is shown in the FBA column — copy, link in catalog, then select.'}
              </div>
            </div>
            <div className="flex-1 overflow-auto overflow-x-auto min-h-0">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-background border-b z-10 shadow-sm">
                  <tr>
                    <th className="text-start p-1.5">MSKU</th>
                    <th className="text-center p-1 w-10">{isAr ? 'كمية' : 'Qty'}</th>
                    <th className="text-start p-1.5">{t('transfers.fbaRequestFromShop')}</th>
                    <th className="text-start p-1.5">{t('transfers.fbaRequestToFba')}</th>
                    <th className="p-1 w-[72px]" />
                  </tr>
                </thead>
                <tbody>
                  {unmatchedItems.map((row, i) => {
                      const draft = unmatchedDraft[row.amazon_msku] || { sourceSkuId: '', destSkuId: '' };
                      return (
                        <tr key={`${row.amazon_msku}-${i}`} className="border-b align-middle bg-red-50/40">
                          <td className="p-1.5">
                            <div className="font-mono font-semibold text-[11px] leading-tight">{row.amazon_msku}</div>
                            <div className="text-[10px] text-muted-foreground">{row.asin}</div>
                          </td>
                          <td className="p-1 font-mono font-medium text-center">{row.quantity}</td>
                          <td className="p-1">
                            {renderSkuPicker(
                              `un-src-${row.amazon_msku}`,
                              sourceSkus,
                              draft.sourceSkuId,
                              isAr ? 'المحل' : 'Shop',
                              sourceSkuPickerOpen,
                              setSourceSkuPickerOpen,
                              (opt) =>
                                setUnmatchedDraft((prev) => ({
                                  ...prev,
                                  [row.amazon_msku]: { ...draft, sourceSkuId: opt.sku_id },
                                })),
                              sourceSkus.find((s) => s.sku_id === draft.sourceSkuId)?.image
                            )}
                          </td>
                          <td className="p-1">
                            {renderSkuPicker(
                              `un-dst-${row.amazon_msku}`,
                              destSkus,
                              draft.destSkuId,
                              'FBA',
                              destSkuPickerOpen,
                              setDestSkuPickerOpen,
                              (opt) =>
                                setUnmatchedDraft((prev) => ({
                                  ...prev,
                                  [row.amazon_msku]: { ...draft, destSkuId: opt.sku_id },
                                })),
                              destSkus.find((s) => s.sku_id === draft.destSkuId)?.image,
                              row.amazon_msku
                            )}
                          </td>
                          <td className="p-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="text-[10px] h-7 px-2 whitespace-nowrap"
                              onClick={() => linkUnmatchedRow(row)}
                            >
                              {t('transfers.fbaRequestLinkRow')}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </div>
        )}

        <DialogFooter className="shrink-0 gap-2 pt-1.5 border-t">
          <Button variant="outline" className="h-8 text-xs" onClick={() => handleDialogOpenChange(false)}>
            {t('transfers.modal.cancel')}
          </Button>
          <Button className="h-8 min-w-[160px] text-xs" onClick={executeTransfer} disabled={!validation.canExecute || isExecuting}>
            {isExecuting ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : null}
            {t('transfers.fbaRequestConfirm')} ({previewUnits})
          </Button>
        </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
