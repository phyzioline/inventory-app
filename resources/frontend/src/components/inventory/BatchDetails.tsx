import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";
import { useSmartImportBatch } from "@/hooks/useSmartImport";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Loader2, Package, Truck, MapPin, AlertTriangle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface BatchDetailsProps {
    batchId: number;
    onClose: () => void;
}

export function BatchDetails({ batchId, onClose }: BatchDetailsProps) {
    const { data: batch, isLoading } = useSmartImportBatch(batchId.toString());

    return (
        <Sheet open={true} onOpenChange={onClose}>
            <SheetContent className="w-full sm:max-w-2xl bg-gray-900 border-gray-800 text-white overflow-y-auto">
                <SheetHeader className="pb-6 border-b border-gray-800">
                    <div className="flex justify-between items-start">
                        <div>
                            <SheetTitle className="text-xl font-bold text-white">
                                Batch Details: {batch?.batch_number}
                            </SheetTitle>
                            <SheetDescription className="text-gray-400">
                                View line item breakdown and cost analysis
                            </SheetDescription>
                        </div>
                        {batch?.status && (
                            <Badge variant="outline" className="border-emerald-500 text-emerald-500">
                                {batch.status.toUpperCase()}
                            </Badge>
                        )}
                    </div>
                </SheetHeader>

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-4">
                        <Loader2 className="animate-spin text-emerald-500" size={32} />
                        <p className="text-gray-400">Loading batch details...</p>
                    </div>
                ) : !batch ? (
                    <div className="p-8 text-center text-gray-500">
                        Batch not found.
                    </div>
                ) : (
                    <div className="py-6 space-y-8">
                        {/* Summary Cards */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700">
                                <div className="text-xs text-gray-500 uppercase flex items-center gap-2 mb-1">
                                    <Truck size={14} /> Vendor
                                </div>
                                <div className="font-medium text-white">{batch.vendor?.name || batch.supplier_name_raw || '-'}</div>
                            </div>
                            <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700">
                                <div className="text-xs text-gray-500 uppercase flex items-center gap-2 mb-1">
                                    <MapPin size={14} /> Received At
                                </div>
                                <div className="font-medium text-white">{batch.location?.name || '-'}</div>
                            </div>
                        </div>

                        {/* Financial Overview */}
                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                                <AlertTriangle size={16} className="text-amber-500" /> Cost Summary
                            </h3>
                            <div className="rounded-lg bg-gray-800/20 border border-gray-700 divide-y divide-gray-700">
                                <div className="flex justify-between p-3">
                                    <span className="text-gray-400">Subtotal</span>
                                    <span className="text-white">{formatCurrency(batch.subtotal, batch.currency)}</span>
                                </div>
                                <div className="flex justify-between p-3">
                                    <span className="text-gray-400">Tax</span>
                                    <span className="text-white">{formatCurrency(batch.tax_amount, batch.currency)}</span>
                                </div>
                                <div className="flex justify-between p-3 bg-emerald-500/5">
                                    <span className="font-bold text-white">Grand Total</span>
                                    <span className="font-bold text-emerald-400">{formatCurrency(batch.grand_total, batch.currency)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Line Items Table */}
                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                                <Package size={16} /> Line Items ({batch.items?.length || 0})
                            </h3>
                            <div className="rounded-lg border border-gray-800 overflow-hidden">
                                <Table>
                                    <TableHeader className="bg-gray-800/50">
                                        <TableRow className="border-gray-800">
                                            <TableHead className="text-gray-400 text-xs">Product</TableHead>
                                            <TableHead className="text-gray-400 text-xs">Qty</TableHead>
                                            <TableHead className="text-gray-400 text-xs">Unit Cost</TableHead>
                                            <TableHead className="text-gray-400 text-xs text-right">Total</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {batch.items?.map((item: any) => (
                                            <TableRow key={item.id} className="border-gray-800 hover:bg-gray-800/30">
                                                <TableCell>
                                                    <div className="text-sm font-medium text-white line-clamp-2">
                                                        {item.master_product?.internal_name || item.raw_description}
                                                    </div>
                                                    <div className="text-xs text-emerald-500/70 font-mono">
                                                        {item.sku?.sku}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="text-sm text-white">{item.received_quantity || item.quantity}</div>
                                                    {item.variance_quantity !== 0 && (
                                                        <div className="text-[10px] text-red-400">
                                                            Var: {item.variance_quantity}
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-sm text-gray-300">
                                                    {formatCurrency(item.unit_price, batch.currency)}
                                                </TableCell>
                                                <TableCell className="text-sm text-gray-300 text-right">
                                                    {formatCurrency(item.total_price, batch.currency)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>

                        {/* Notes Section */}
                        {batch.notes && (
                            <div className="p-4 rounded-lg bg-gray-800/30 border border-gray-700">
                                <div className="text-xs text-gray-500 uppercase mb-2">Notes</div>
                                <p className="text-sm text-gray-300">{batch.notes}</p>
                            </div>
                        )}
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}
