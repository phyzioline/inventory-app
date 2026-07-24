import { useEffect, useMemo, useRef, useState } from 'react';
import api from '@/lib/api';
import { toast } from 'sonner';
import { Loader2, Upload, Printer, CheckCircle2, AlertCircle, FileText, ChevronsUpDown, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useQuery } from '@tanstack/react-query';

type MatchedItem = {
  partner_barcode: string;
  partner_sku: string;
  sku_code: string;
  quantity: number;
  sku_id: number;
  system_sku: string;
  product_name: string;
  matched_by: string;
  source_available: number | null;
  stock_status: 'ok' | 'insufficient' | 'unknown';
  to_sku_id?: string;
  dest_sku_code?: string;
};

type UnmatchedItem = {
  partner_barcode: string;
  partner_sku: string;
  sku_code: string;
  quantity: number;
  reason: string;
};

interface NoonAsnTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export default function NoonAsnTransferDialog({ open, onOpenChange, onSuccess }: NoonAsnTransferDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [asnNumber, setAsnNumber] = useState('');
  const [matchedItems, setMatchedItems] = useState<MatchedItem[]>([]);
  const [unmatchedItems, setUnmatchedItems] = useState<UnmatchedItem[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const { t, language } = useLanguage();
  const isAr = language === 'ar';
  const [destSkuPickerOpen, setDestSkuPickerOpen] = useState<Record<string, boolean>>({});

  const looksLikeNoon = (loc: any) => {
    const name = String(loc?.name || '').toLowerCase();
    const type = String(loc?.type || '').toLowerCase();
    return name.includes('noon') || name.includes('zara') || name.includes('زارا') || type.includes('fbn');
  };

  const resetState = () => {
    setFile(null);
    setMatchedItems([]);
    setUnmatchedItems([]);
    setAsnNumber('');
    setDestSkuPickerOpen({});
  };

  const loadLocations = async () => {
    try {
      const rows = await api.getArray('warehouses');
      setLocations(rows);
      if (!rows.length) return;

      // Auto-select destination as Noon/Zara/FBN when available.
      if (!destinationLocationId) {
        const suggestedDestination = rows.find((loc: any) => looksLikeNoon(loc));
        if (suggestedDestination) {
          setDestinationLocationId(String(suggestedDestination.id));
        }
      }

      // Auto-select source as first non-Noon location.
      if (!sourceLocationId) {
        const suggestedSource = rows.find((loc: any) => !looksLikeNoon(loc)) || rows[0];
        if (suggestedSource) {
          setSourceLocationId(String(suggestedSource.id));
        }
      }
    } catch {
      toast.error('Failed to load locations');
    }
  };

  // Fetch ALL destination inventory (for manual SKU search)
  const { data: destInventory = [], isLoading: loadingDest } = useQuery({
      queryKey: ['transfer-dest-inventory', destinationLocationId],
      queryFn: () => api.getArray(`warehouses/${destinationLocationId}/inventory?per_page=500`),
      enabled: open && !!destinationLocationId,
  });

  // All destination SKUs (all of them, searchable)
  const allDestSkus = useMemo(() => {
      return (destInventory || []).map((item: any) => ({
          sku_id: String(item?.sku?.id || ''),
          sku_code: item?.sku?.sku || '',
          name: item?.sku?.offer?.master_product?.internal_name ||
              item?.sku?.offer?.masterProduct?.internal_name ||
              item?.sku?.name ||
              item?.sku?.offer?.name ||
              '',
          available: Number(item?.quantity || 0),
      })).filter((s: any) => s.sku_id);
  }, [destInventory]);

  useEffect(() => {
    if (open) {
      loadLocations();
      return;
    }
    resetState();
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
  };

  const parsePdf = async () => {
    if (!file) {
      toast.error('Please select ASN PDF first');
      return;
    }
    if (!sourceLocationId) {
      toast.error('Please choose source location');
      return;
    }

    setIsParsing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('source_location_id', sourceLocationId);

      const response = await api.post('transfers/asn/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const matched = (response?.matched_items || []) as MatchedItem[];
      const unmatched = (response?.unmatched_items || []) as UnmatchedItem[];
      setMatchedItems(matched);
      setUnmatchedItems(unmatched);

      if (response?.suggested_destination_location && !destinationLocationId) {
        setDestinationLocationId(String(response.suggested_destination_location.id));
      }

      toast.success(`Parsed ASN: ${matched.length} matched, ${unmatched.length} unmatched`);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to parse ASN PDF');
    } finally {
      setIsParsing(false);
    }
  };

  const canExecute = useMemo(() => {
    if (!sourceLocationId || !destinationLocationId) return false;
    if (matchedItems.length === 0) return false;
    // ensure all matched items have valid stock AND a destination SKU selected
    return matchedItems.every((row) => row.stock_status !== 'insufficient' && !!row.to_sku_id);
  }, [sourceLocationId, destinationLocationId, matchedItems]);

  const setRowDestSku = (partnerBarcode: string, to_sku_id: string, dest_sku_code: string) => {
    setMatchedItems(prev => prev.map(row => 
      row.partner_barcode === partnerBarcode 
        ? { ...row, to_sku_id, dest_sku_code } 
        : row
    ));
  };

  const sourceOptions = useMemo(() => {
    const options = locations.filter((loc: any) => String(loc.id) !== destinationLocationId);
    const nonNoonFirst = [...options].sort((a: any, b: any) => {
      const aNoon = looksLikeNoon(a) ? 1 : 0;
      const bNoon = looksLikeNoon(b) ? 1 : 0;
      return aNoon - bNoon;
    });
    return nonNoonFirst;
  }, [locations, destinationLocationId]);

  const destinationOptions = useMemo(() => {
    const noonFirst = [...locations].sort((a: any, b: any) => {
      const aNoon = looksLikeNoon(a) ? 0 : 1;
      const bNoon = looksLikeNoon(b) ? 0 : 1;
      return aNoon - bNoon;
    });
    return noonFirst.filter((loc: any) => String(loc.id) !== sourceLocationId);
  }, [locations, sourceLocationId]);

  const executeTransfer = async () => {
    if (!canExecute) {
      toast.error('Fix stock/mapping issues before executing');
      return;
    }

    setIsExecuting(true);
    try {
      await api.post('transfers/asn/execute', {
        source_location_id: Number(sourceLocationId),
        destination_location_id: Number(destinationLocationId),
        asn_number: asnNumber || undefined,
        items: matchedItems.map((row) => ({
          sku_id: row.sku_id,
          to_sku_id: row.to_sku_id,
          quantity: row.quantity,
          partner_barcode: row.partner_barcode,
          partner_sku: row.partner_sku,
          sku_code: row.sku_code,
        })),
      });

      toast.success('ASN transfer completed');
      onSuccess();
      onOpenChange(false);
      resetState();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Transfer failed');
    } finally {
      setIsExecuting(false);
    }
  };

  const printPartnerBarcodes = async () => {
    const itemsForPrint = matchedItems
      .filter((row) => !!row.partner_barcode && row.quantity > 0)
      .map((row) => ({
        partner_barcode: row.partner_barcode,
        partner_sku: row.partner_sku,
        quantity: row.quantity,
      }));

    if (itemsForPrint.length === 0) {
      toast.error('No printable barcodes found');
      return;
    }

    setIsPrinting(true);
    try {
      const response = await api.post('transfers/asn/print-barcodes', { items: itemsForPrint });
      const html = response?.html;
      if (!html) {
        toast.error('No print output generated');
        return;
      }

      const printWindow = window.open('', '_blank', 'width=900,height=700');
      if (!printWindow) {
        toast.error('Popup blocked. Allow popups then try again.');
        return;
      }

      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to generate barcode print');
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[1050px] max-h-[92vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Noon / Zara ASN Transfer
          </DialogTitle>
          <DialogDescription>
            Upload ASN PDF, review matched items, transfer stock, then print Partner Barcode labels.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="space-y-2">
            <Label>Source Location</Label>
            <Select value={sourceLocationId} onValueChange={setSourceLocationId}>
              <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
              <SelectContent>
                {sourceOptions.map((loc: any) => (
                  <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Noon/Zara Location</Label>
            <Select value={destinationLocationId} onValueChange={setDestinationLocationId}>
              <SelectTrigger><SelectValue placeholder="Select destination" /></SelectTrigger>
              <SelectContent>
                {destinationOptions.map((loc: any) => (
                  <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>ASN Number (Optional)</Label>
            <input
              className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={asnNumber}
              onChange={(e) => setAsnNumber(e.target.value)}
              placeholder="A04846479PN"
            />
          </div>
          <div className="space-y-2">
            <Label>ASN PDF</Label>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-4 h-4 mr-2" />
              {file ? file.name : 'Choose PDF'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={parsePdf} disabled={!file || isParsing}>
            {isParsing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Parse ASN PDF
          </Button>
          <Button variant="outline" onClick={printPartnerBarcodes} disabled={matchedItems.length === 0 || isPrinting}>
            {isPrinting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Printer className="w-4 h-4 mr-2" />}
            Print Partner Barcodes
          </Button>
        </div>

        {matchedItems.some((r) => r.stock_status === 'insufficient') && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Insufficient stock detected</AlertTitle>
            <AlertDescription>
              Some rows do not have enough source stock. Please adjust stock before execution.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">
          <div className="border rounded-md">
            <div className="px-3 py-2 border-b font-medium text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              Matched Items ({matchedItems.length})
            </div>
            <ScrollArea className="h-[330px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background border-b">
                  <tr>
                    <th className="text-left p-2">Partner SKU</th>
                    <th className="text-left p-2">System SKU</th>
                    <th className="text-left p-2 min-w-[200px]">Dest SKU (Search)</th>
                    <th className="text-left p-2">Qty</th>
                    <th className="text-left p-2">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {matchedItems.length === 0 ? (
                    <tr><td className="p-3 text-muted-foreground" colSpan={5}>No matched rows yet.</td></tr>
                  ) : (
                    matchedItems.map((row, i) => (
                      <tr key={`${row.partner_barcode}-${i}`} className="border-b">
                        <td className="p-2">
                          <div className="font-medium">{row.partner_sku}</div>
                          <div className="text-xs text-muted-foreground font-mono">{row.partner_barcode}</div>
                        </td>
                        <td className="p-2">{row.system_sku}</td>
                        <td className="p-2">
                            {/* Destination SKU - Manual Search */}
                            {!destinationLocationId ? (
                                <span className="text-xs text-muted-foreground">{isAr ? 'اختر الوجهة' : 'Select dest'}</span>
                            ) : loadingDest ? (
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            ) : (
                                <Popover
                                    open={!!destSkuPickerOpen[row.partner_barcode]}
                                    onOpenChange={(o) => setDestSkuPickerOpen(prev => ({ ...prev, [row.partner_barcode]: o }))}
                                >
                                    <PopoverTrigger asChild>
                                        <Button type="button" variant="outline" size="sm" className={cn('w-full justify-between text-xs h-8',
                                            row.to_sku_id ? 'border-teal-400 text-teal-700 bg-teal-50' : 'border-dashed border-red-300 bg-red-50 text-red-600'
                                        )}>
                                            <span className="truncate font-mono">
                                                {row.to_sku_id
                                                    ? (row.dest_sku_code || row.to_sku_id)
                                                    : (isAr ? '🔍 يتطلب اختيار SKU' : '🔍 Select dest. SKU')}
                                            </span>
                                            <ChevronsUpDown className="h-3 w-3 opacity-40 shrink-0 ml-1" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[320px] p-0" align="start">
                                        <Command>
                                            <CommandInput
                                                placeholder={isAr ? 'ابحث بـ SKU أو اسم المنتج...' : 'Search by SKU or product name...'}
                                            />
                                            <CommandList>
                                                <CommandEmpty>
                                                    {isAr ? 'لا يوجد SKU مطابق' : 'No matching SKU'}
                                                </CommandEmpty>
                                                <CommandGroup heading={isAr ? `${allDestSkus.length} SKU في الوجهة` : `${allDestSkus.length} SKUs at destination`}>
                                                    {allDestSkus.map((dsku: any) => (
                                                        <CommandItem
                                                            key={dsku.sku_id}
                                                            value={`${dsku.sku_code} ${dsku.name}`}
                                                            onSelect={() => {
                                                                setRowDestSku(row.partner_barcode, dsku.sku_id, dsku.sku_code);
                                                                setDestSkuPickerOpen(prev => ({ ...prev, [row.partner_barcode]: false }));
                                                            }}
                                                        >
                                                            <Check className={cn('mr-2 h-4 w-4 shrink-0', row.to_sku_id === dsku.sku_id ? 'opacity-100' : 'opacity-0')} />
                                                            <div className="flex-1 min-w-0">
                                                                <div className="font-mono text-xs font-bold truncate">{dsku.sku_code}</div>
                                                                <div className="text-xs text-muted-foreground truncate">{dsku.name}</div>
                                                            </div>
                                                            <Badge variant="outline" className={cn('ml-2 shrink-0 text-xs font-mono',
                                                                dsku.available > 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-muted text-muted-foreground'
                                                            )}>
                                                                {dsku.available}
                                                            </Badge>
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                            )}
                        </td>
                        <td className="p-2">{row.quantity}</td>
                        <td className={`p-2 font-mono ${row.stock_status === 'insufficient' ? 'text-red-600 font-bold' : 'text-green-700'}`}>
                          {row.source_available ?? '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </ScrollArea>
          </div>

          <div className="border rounded-md">
            <div className="px-3 py-2 border-b font-medium text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              Unmatched Items ({unmatchedItems.length})
            </div>
            <ScrollArea className="h-[330px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background border-b">
                  <tr>
                    <th className="text-left p-2">Partner SKU</th>
                    <th className="text-left p-2">Barcode</th>
                    <th className="text-left p-2">SKU</th>
                    <th className="text-left p-2">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatchedItems.length === 0 ? (
                    <tr><td className="p-3 text-muted-foreground" colSpan={4}>No unmatched rows.</td></tr>
                  ) : (
                    unmatchedItems.map((row, i) => (
                      <tr key={`${row.partner_barcode}-${i}`} className="border-b">
                        <td className="p-2">{row.partner_sku}</td>
                        <td className="p-2 font-mono">{row.partner_barcode}</td>
                        <td className="p-2">{row.sku_code}</td>
                        <td className="p-2">{row.quantity}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={executeTransfer} disabled={!canExecute || isExecuting}>
            {isExecuting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Confirm ASN Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

