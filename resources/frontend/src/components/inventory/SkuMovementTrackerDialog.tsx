import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import {
    ArrowDownToLine,
    ArrowUpFromLine,
    ArrowRightLeft,
    RotateCcw,
    ShoppingCart,
    PackageCheck,
    SlidersHorizontal,
    Zap,
    Route,
    Minus,
    Loader2,
} from 'lucide-react';

/* ─── Types ─── */
export type SkuMovementRow = {
    id: number;
    created_at: string | null;
    sku_id: number;
    sku_code: string;
    listing_channel?: string | null;
    master_product_name?: string | null;
    movement_kind: string;
    type: string;
    quantity: number;
    label_ar: string;
    from_location?: { name: string; channel_name?: string | null } | null;
    to_location?: { name: string; channel_name?: string | null } | null;
    at_location?: { name: string; channel_name?: string | null } | null;
    order_number?: string | null;
    summary_ar: string;
    notes?: string | null;
};

type CurrentBalance = {
    sku_id: number;
    sku_code: string;
    channel_name?: string | null;
    current_quantity: number;
};

type TrackerResponse = {
    sku_ids_resolved: number[];
    movements: SkuMovementRow[];
    current_balances?: CurrentBalance[];
};

export type SkuMovementTrackerDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Single listing — movements for this SKU only (no siblings). */
    skuId?: number | null;
    /** Master product — movements for every SKU under this master. */
    masterProductId?: number | null;
    title?: string;
};

/* ─── Kind config ─── */
type KindCfg = {
    badge: string;
    row: string;
    qty: string;
    sign: string;
    icon: React.ElementType;
    isOut: boolean;
};

const KIND: Record<string, KindCfg> = {
    purchase:      { badge: 'bg-emerald-100 text-emerald-800 border-emerald-200', row: 'bg-emerald-50/40',  qty: 'text-emerald-700', sign: '+', icon: PackageCheck,    isOut: false },
    in:            { badge: 'bg-emerald-100 text-emerald-800 border-emerald-200', row: 'bg-emerald-50/40',  qty: 'text-emerald-700', sign: '+', icon: ArrowDownToLine, isOut: false },
    return_in:     { badge: 'bg-teal-100    text-teal-800    border-teal-200',    row: 'bg-teal-50/40',     qty: 'text-teal-700',    sign: '+', icon: RotateCcw,       isOut: false },
    import_sale:   { badge: 'bg-rose-100    text-rose-800    border-rose-200',    row: 'bg-rose-50/30',     qty: 'text-rose-700',    sign: '−', icon: ShoppingCart,    isOut: true  },
    sale:          { badge: 'bg-rose-100    text-rose-800    border-rose-200',    row: 'bg-rose-50/30',     qty: 'text-rose-700',    sign: '−', icon: ShoppingCart,    isOut: true  },
    out:           { badge: 'bg-red-100     text-red-800     border-red-200',     row: 'bg-red-50/30',      qty: 'text-red-700',     sign: '−', icon: ArrowUpFromLine, isOut: true  },
    transfer_out:  { badge: 'bg-blue-100    text-blue-800    border-blue-200',    row: 'bg-blue-50/30',     qty: 'text-blue-700',    sign: '↗', icon: ArrowRightLeft,  isOut: true  },
    transfer_in:   { badge: 'bg-violet-100  text-violet-800  border-violet-200',  row: 'bg-violet-50/30',   qty: 'text-violet-700',  sign: '↙', icon: ArrowRightLeft,  isOut: false },
    auto_transfer: { badge: 'bg-indigo-100  text-indigo-800  border-indigo-200',  row: 'bg-indigo-50/30',   qty: 'text-indigo-700',  sign: '→', icon: Zap,             isOut: false },
    adjustment:    { badge: 'bg-amber-100   text-amber-800   border-amber-200',   row: 'bg-amber-50/30',    qty: 'text-amber-700',   sign: '±', icon: SlidersHorizontal, isOut: false },
};
const DEFAULT_KIND: KindCfg = { badge: 'bg-slate-100 text-slate-700 border-slate-200', row: '', qty: 'text-slate-700', sign: '·', icon: Minus, isOut: false };

function kindCfg(kind: string): KindCfg {
    return KIND[kind] ?? DEFAULT_KIND;
}

/* ─── Helpers ─── */
function locName(loc?: { name: string; channel_name?: string | null } | null): string {
    if (!loc?.name) return '—';
    return loc.channel_name ? `${loc.name}` : loc.name;
}

function formatDate(iso: string | null): { date: string; time: string } {
    if (!iso) return { date: '—', time: '' };
    const d = new Date(iso);
    return {
        date: d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' }),
        time: d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
    };
}

/** Build running balances (newest→oldest order). currentQty is after ALL transactions. */
function buildRunningBalances(movements: SkuMovementRow[], balancesBySku: Map<number, number>): number[] {
    // We iterate newest→oldest. At index 0 (newest), balance AFTER = current.
    // For index i, balance_before_i = balance_after_i ± movement_i
    const result: number[] = new Array(movements.length).fill(0);
    // group by sku_id for per-sku running balance
    const cursor = new Map<number, number>(balancesBySku);

    for (let i = 0; i < movements.length; i++) {
        const m = movements[i];
        const cfg = kindCfg(m.movement_kind);
        const cur = cursor.get(m.sku_id) ?? 0;
        result[i] = cur; // balance AFTER this transaction
        // undo this transaction to get balance BEFORE
        const delta = cfg.isOut ? m.quantity : -m.quantity;
        cursor.set(m.sku_id, cur + delta);
    }
    return result;
}

/* ─── Component ─── */
export function SkuMovementTrackerDialog({
    open,
    onOpenChange,
    skuId,
    masterProductId,
    title,
}: SkuMovementTrackerDialogProps) {
    // Single SKU → that SKU only. Master product → all its listing SKUs.
    const qs = new URLSearchParams();
    if (skuId) {
        qs.set('sku_id', String(skuId));
        qs.set('include_related', '0');
    }
    if (masterProductId) qs.set('master_product_id', String(masterProductId));

    const scope: 'sku' | 'master' | null = skuId ? 'sku' : masterProductId ? 'master' : null;

    const { data, isLoading, isError, error } = useQuery({
        queryKey: ['sku-tracker', scope, skuId ?? 0, masterProductId ?? 0],
        queryFn: async () => api.get<TrackerResponse>(`/transactions/sku-tracker?${qs.toString()}`),
        enabled: open && (!!skuId || !!masterProductId),
    });

    const movements = data?.movements ?? [];
    const balances  = data?.current_balances ?? [];

    // Build balance map: sku_id → current_quantity
    const balanceBySku = new Map<number, number>(balances.map(b => [b.sku_id, b.current_quantity]));

    // Running balances (one per movement row)
    const runningBalances = movements.length > 0 ? buildRunningBalances(movements, new Map(balanceBySku)) : [];

    const description =
        scope === 'sku'
            ? 'حركات هذا الـ SKU فقط'
            : scope === 'master'
              ? 'كل حركات عروض البيع لهذا المنتج الأساسي'
              : 'اختر صنفاً لعرض حركاته';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="flex max-h-[95vh] w-[98vw] max-w-[1200px] flex-col gap-0 overflow-hidden rounded-xl p-0 shadow-2xl"
                dir="rtl"
            >
                {/* ── Header ── */}
                <div className="shrink-0 border-b bg-gradient-to-l from-slate-50 to-white px-6 py-4">
                    <DialogHeader className="space-y-1 text-right">
                        <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-800">
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                                <Route className="h-4 w-4 text-primary" />
                            </span>
                            {title || 'تتبع حركات المخزون'}
                        </DialogTitle>
                        <DialogDescription className="text-xs text-slate-500">
                            {description}
                        </DialogDescription>
                    </DialogHeader>
                </div>

                {/* ── Loading ── */}
                {isLoading && (
                    <div className="flex flex-1 items-center justify-center gap-2 py-16 text-slate-400">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span className="text-sm">جاري تحميل الحركات…</span>
                    </div>
                )}

                {/* ── Error ── */}
                {isError && (
                    <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                        {(error as Error)?.message || 'تعذر تحميل بيانات التتبع'}
                    </div>
                )}

                {/* ── Empty ── */}
                {!isLoading && !isError && movements.length === 0 && (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-slate-400">
                        <Route className="h-10 w-10 opacity-30" />
                        <p className="text-sm">لا توجد حركات مسجّلة لهذا الصنف</p>
                    </div>
                )}

                {/* ── Content (table only — no mixed SKU summary strip) ── */}
                {!isLoading && movements.length > 0 && (
                    <>
                        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto overscroll-contain">
                            <table className="w-full border-collapse text-sm">
                                <thead className="sticky top-0 z-10">
                                    <tr className="border-b bg-slate-100/90 backdrop-blur-sm text-right text-xs font-semibold text-slate-600 uppercase tracking-wide">
                                        <th className="px-4 py-2.5 w-[110px]">التاريخ</th>
                                        <th className="px-4 py-2.5 w-[160px]">النوع</th>
                                        <th className="px-4 py-2.5 w-[70px] text-center">كمية</th>
                                        <th className="px-4 py-2.5 w-[80px] text-center">الرصيد</th>
                                        <th className="px-4 py-2.5">من ← إلى</th>
                                        <th className="px-4 py-2.5 w-[120px]">SKU / قناة</th>
                                        <th className="px-4 py-2.5 w-[180px]">مرجع</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {movements.map((m, idx) => {
                                        const cfg = kindCfg(m.movement_kind);
                                        const Icon = cfg.icon;
                                        const { date, time } = formatDate(m.created_at);
                                        const balance = runningBalances[idx] ?? '—';
                                        const fromLoc = locName(m.from_location ?? m.at_location);
                                        const toLoc   = locName(m.to_location ?? m.at_location);
                                        const showArrow = m.from_location && m.to_location && m.from_location.name !== m.to_location.name;

                                        return (
                                            <tr key={m.id} className={`transition-colors hover:brightness-95 ${cfg.row}`}>
                                                {/* Date */}
                                                <td className="px-4 py-2.5 align-top">
                                                    <div className="font-medium text-slate-700 text-xs">{date}</div>
                                                    <div className="text-[11px] text-slate-400 font-mono">{time}</div>
                                                </td>

                                                {/* Kind badge */}
                                                <td className="px-4 py-2.5 align-top">
                                                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${cfg.badge}`}>
                                                        <Icon className="h-3 w-3 shrink-0" />
                                                        {m.label_ar}
                                                    </span>
                                                </td>

                                                {/* Quantity */}
                                                <td className="px-4 py-2.5 align-top text-center">
                                                    <span className={`font-bold tabular-nums text-base ${cfg.qty}`}>
                                                        {cfg.sign}{m.quantity}
                                                    </span>
                                                </td>

                                                {/* Running balance */}
                                                <td className="px-4 py-2.5 align-top text-center">
                                                    <span className={`font-mono text-xs font-semibold tabular-nums ${typeof balance === 'number' && balance > 0 ? 'text-slate-600' : 'text-rose-500'}`}>
                                                        {balance}
                                                    </span>
                                                </td>

                                                {/* From → To */}
                                                <td className="px-4 py-2.5 align-top max-w-[240px]">
                                                    {showArrow ? (
                                                        <div className="flex flex-wrap items-center gap-1 text-xs">
                                                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">{fromLoc}</span>
                                                            <span className="text-slate-400">→</span>
                                                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">{toLoc}</span>
                                                        </div>
                                                    ) : (
                                                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                                                            {fromLoc !== '—' ? fromLoc : toLoc}
                                                        </span>
                                                    )}
                                                </td>

                                                {/* SKU / channel */}
                                                <td className="px-4 py-2.5 align-top">
                                                    <div className="font-mono text-xs font-semibold text-slate-700">{m.sku_code}</div>
                                                    {m.listing_channel && (
                                                        <div className="mt-0.5 text-[10px] text-slate-400 leading-tight">{m.listing_channel}</div>
                                                    )}
                                                </td>

                                                {/* Reference */}
                                                <td className="px-4 py-2.5 align-top">
                                                    {m.order_number ? (
                                                        <span className="font-mono text-[11px] text-slate-600 break-all leading-snug">
                                                            {m.order_number}
                                                        </span>
                                                    ) : (
                                                        <span className="text-[11px] text-slate-300">—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Legend */}
                        <div className="shrink-0 border-t bg-slate-50/60 px-6 py-2.5">
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                                {Object.entries(KIND).map(([k, v]) => (
                                    <span key={k} className="flex items-center gap-1">
                                        <span className={`inline-flex h-2 w-2 rounded-full ${v.badge.split(' ')[0]}`} />
                                        {k === 'purchase' ? 'شراء' : k === 'import_sale' ? 'بيع شيت' : k === 'sale' ? 'بيع' : k === 'return_in' ? 'مرتجع' : k === 'transfer_out' ? 'تحويل صادر' : k === 'transfer_in' ? 'تحويل وارد' : k === 'adjustment' ? 'تسوية' : k === 'auto_transfer' ? 'تحويل تلقائي' : k === 'in' ? 'وارد' : k === 'out' ? 'صادر' : k}
                                    </span>
                                ))}
                                <span className="mr-auto text-slate-400">الرصيد = رصيد ما بعد كل حركة</span>
                            </div>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
