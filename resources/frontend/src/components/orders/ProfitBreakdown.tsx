import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";
import { useOrderProfitability } from "@/hooks/useSales";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { Loader2, TrendingUp, TrendingDown, Percent, Info, DollarSign } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ProfitBreakdownProps {
    orderId: string;
    onClose: () => void;
}

export function ProfitBreakdown({ orderId, onClose }: ProfitBreakdownProps) {
    const { data: profit, isLoading } = useOrderProfitability(orderId);

    return (
        <Sheet open={true} onOpenChange={onClose}>
            <SheetContent className="w-full sm:max-w-2xl bg-gray-900 border-gray-800 text-white overflow-y-auto">
                <SheetHeader className="pb-6 border-b border-gray-800">
                    <div className="flex justify-between items-start">
                        <div>
                            <SheetTitle className="text-xl font-bold text-white">
                                Profit Analysis: {orderId}
                            </SheetTitle>
                            <SheetDescription className="text-gray-400">
                                Detailed breakdown of revenue, costs, and margins
                            </SheetDescription>
                        </div>
                        {profit && (
                            <Badge
                                variant="outline"
                                className={profit.profit >= 0 ? "border-emerald-500 text-emerald-500" : "border-red-500 text-red-500"}
                            >
                                {profit.margin_percentage}% Margin
                            </Badge>
                        )}
                    </div>
                </SheetHeader>

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-4">
                        <Loader2 className="animate-spin text-emerald-500" size={32} />
                        <p className="text-gray-400">Calculating profitability...</p>
                    </div>
                ) : !profit ? (
                    <div className="p-8 text-center text-gray-500">
                        Analysis data not available.
                    </div>
                ) : (
                    <div className="py-6 space-y-8">
                        {/* Visual Margin indicator */}
                        <div className="p-6 rounded-xl bg-gray-800/50 border border-gray-700 space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-400 uppercase font-medium">Net Profit</span>
                                {profit.profit >= 0 ? (
                                    <div className="flex items-center gap-1 text-emerald-400">
                                        <TrendingUp size={20} />
                                        <span className="text-2xl font-bold">{formatCurrency(profit.profit)}</span>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-1 text-red-400">
                                        <TrendingDown size={20} />
                                        <span className="text-2xl font-bold">{formatCurrency(profit.profit)}</span>
                                    </div>
                                )}
                            </div>

                            <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                                <div
                                    className={`h-full transition-all duration-1000 ${profit.profit >= 0 ? "bg-emerald-500" : "bg-red-500"}`}
                                    style={{ width: `${Math.min(Math.max(profit.margin_percentage, 0), 100)}%` }}
                                />
                            </div>
                        </div>

                        {/* Financial Breakdown */}
                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                                <DollarSign size={16} className="text-emerald-500" /> Revenue & Costs
                            </h3>
                            <div className="rounded-lg bg-gray-800/20 border border-gray-700 divide-y divide-gray-700 text-sm">
                                <div className="flex justify-between p-4">
                                    <div className="flex items-center gap-2 text-gray-300">
                                        <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                        Total Revenue
                                    </div>
                                    <span className="font-bold text-white">{formatCurrency(profit.revenue)}</span>
                                </div>
                                <div className="flex justify-between p-4">
                                    <div className="flex items-center gap-2 text-gray-400">
                                        <span className="ml-4">- COGS (Product Cost)</span>
                                    </div>
                                    <span className="text-gray-300">({formatCurrency(profit.costs.cogs)})</span>
                                </div>
                                <div className="flex justify-between p-4">
                                    <div className="flex items-center gap-2 text-gray-400">
                                        <span className="ml-4">- Shipping Cost</span>
                                    </div>
                                    <span className="text-gray-300">({formatCurrency(profit.costs.shipping)})</span>
                                </div>
                                <div className="flex justify-between p-4">
                                    <div className="flex items-center gap-2 text-gray-400">
                                        <span className="ml-4">- Platform Fees</span>
                                    </div>
                                    <span className="text-gray-300">({formatCurrency(profit.costs.platform_fees)})</span>
                                </div>
                                <div className="flex justify-between p-4">
                                    <div className="flex items-center gap-2 text-gray-400">
                                        <span className="ml-4">- Tax</span>
                                    </div>
                                    <span className="text-gray-300">({formatCurrency(profit.costs.tax)})</span>
                                </div>
                                <div className="flex justify-between p-4 bg-emerald-500/5">
                                    <div className="font-bold text-white">Gross Profit</div>
                                    <div className={`font-bold ${profit.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                        {formatCurrency(profit.profit)}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Efficiency Box */}
                        <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 flex gap-4">
                            <div className="p-2 rounded-full bg-blue-500/20 h-fit">
                                <Percent size={18} className="text-blue-400" />
                            </div>
                            <div className="space-y-1">
                                <h4 className="text-sm font-medium text-blue-300">Margin Efficiency</h4>
                                <p className="text-xs text-blue-300/70">
                                    This order has a gross margin of {profit.margin_percentage}%.
                                    {profit.margin_percentage > 20 ? " This is above your average efficiency." : " Consider reviewing supplier costs or platform fees for this channel."}
                                </p>
                            </div>
                        </div>

                        <div className="p-4 border border-dashed border-gray-700 rounded-lg flex items-start gap-2 text-xs text-gray-500">
                            <Info size={14} className="shrink-0 mt-0.5" />
                            <p>
                                Calculations are based on SKU landing costs associated with batches received.
                                If no batch mapping is available, default SKU cost price is used.
                            </p>
                        </div>
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}
