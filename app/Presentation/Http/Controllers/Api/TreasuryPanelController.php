<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\Settlement;
use App\Domain\Models\Wms\TreasurySulfa;
use App\Infrastructure\Support\InventoryMorphTypes;

/**
 * Treasury UI panels: operational net (receipts − outflow) and inbound split by channel (all active), then other receipts, then sulfa at the bottom of the inbound column.
 */
class TreasuryPanelController extends Controller
{
    public function panels(): JsonResponse
    {
        $uid = (int) Auth::id();

        $cashFlow = app(CashFlowSummaryController::class);
        $stats = $cashFlow->getCoreStats();
        $stats['estimated_balance'] = round((float) ($stats['total_receipts'] ?? 0) - (float) ($stats['total_outflow'] ?? 0), 2);
        $totalReceipts = (float) ($stats['total_receipts'] ?? 0);
        $totalOutflow = (float) ($stats['total_outflow'] ?? 0);
        $operationalNet = round($totalReceipts - $totalOutflow, 2);

        $sulfaBorrow = (float) Receipt::query()
            ->where('user_id', $uid)
            ->where('reference_type', TreasurySulfa::class)
            ->sum('amount');

        $amountsByChannelId = $this->receiptAmountsGroupedByChannelId($uid);

        $channels = Channel::query()
            ->where('is_active', true)
            ->orderBy('name')
            ->get(['id', 'name', 'slug']);

        $inboundItems = [];

        // 1) وارد منصات — كل القنوات النشطة عند المستخدم باسمها (نوون، أمازون، محل، …)
        $inboundItems[] = [
            'type' => 'section',
            'id' => 'section_platform_inbound',
            'name_ar' => 'وارد منصات',
            'name_en' => 'Platform inbound',
            'amount' => 0,
            'path' => '',
        ];

        foreach ($channels as $ch) {
            $amt = (float) ($amountsByChannelId[(int) $ch->id] ?? 0.0);
            $inboundItems[] = [
                'type' => 'channel',
                'id' => 'channel_'.$ch->id,
                'channel_id' => (int) $ch->id,
                'name_ar' => (string) $ch->name,
                'name_en' => (string) $ch->name,
                'amount' => round($amt, 2),
                'path' => '/finance/receipts',
            ];
        }

        $otherReceipts = $this->unattributedReceiptsTotal($uid);
        if ($otherReceipts > 0.00001) {
            $inboundItems[] = [
                'type' => 'other',
                'id' => 'other_receipts',
                'name_ar' => 'مقبوضات أخرى',
                'name_en' => 'Other receipts',
                'amount' => round($otherReceipts, 2),
                'path' => '/finance/receipts',
            ];
        }

        // السُلفة — في أسفل عمود الوارد (مبالغها مقبوضات مفصولة في الـ API عن «أخرى» لتفادي الازدواج)
        $inboundItems[] = [
            'type' => 'section',
            'id' => 'section_sulfa',
            'name_ar' => 'السُلفة',
            'name_en' => 'Sulfa',
            'amount' => 0,
            'path' => '',
        ];
        $inboundItems[] = [
            'type' => 'sulfa',
            'id' => 'sulfa',
            'name_ar' => 'سُلفة (تمويل)',
            'name_en' => 'Sulfa (borrowing)',
            'amount' => round($sulfaBorrow, 2),
            'path' => '/finance/sulfa',
        ];

        $inboundDisplayedTotal = round(array_sum(array_map(
            static fn (array $row): float => ($row['type'] ?? '') === 'section' ? 0.0 : (float) ($row['amount'] ?? 0),
            $inboundItems
        )), 2);

        return response()->json([
            'operational_net' => $operationalNet,
            'total_receipts' => round($totalReceipts, 2),
            'total_outflow' => round($totalOutflow, 2),
            'inbound_items' => $inboundItems,
            'inbound_displayed_total' => $inboundDisplayedTotal,
        ]);
    }

    private function inventoryOrderMorphTypes(): array
    {
        return InventoryMorphTypes::inventoryOrderReferenceTypes();
    }

    /**
     * @return list<string>
     */
    private function settlementMorphTypes(): array
    {
        return array_values(array_unique([
            Settlement::class,
        ]));
    }

    /**
     * @return array<int, float> channel_id => sum(amount)
     */
    private function receiptAmountsGroupedByChannelId(int $userId): array
    {
        $orderTypes = $this->inventoryOrderMorphTypes();
        $settlementTypes = $this->settlementMorphTypes();

        $fromOrders = Receipt::query()
            ->where('inv_receipts.user_id', $userId)
            ->whereIn('inv_receipts.reference_type', $orderTypes)
            ->whereNotNull('inv_receipts.reference_id')
            ->join('inventory_orders as o', 'o.id', '=', 'inv_receipts.reference_id')
            ->whereNotNull('o.channel_id')
            ->groupBy('o.channel_id')
            ->selectRaw('o.channel_id as channel_id, sum(inv_receipts.amount) as total')
            ->pluck('total', 'channel_id')
            ->map(fn ($v) => (float) $v)
            ->all();

        $fromSettlements = Receipt::query()
            ->where('inv_receipts.user_id', $userId)
            ->whereIn('inv_receipts.reference_type', $settlementTypes)
            ->whereNotNull('inv_receipts.reference_id')
            ->join('settlements as s', 's.id', '=', 'inv_receipts.reference_id')
            ->whereNotNull('s.channel_id')
            ->groupBy('s.channel_id')
            ->selectRaw('s.channel_id as channel_id, sum(inv_receipts.amount) as total')
            ->pluck('total', 'channel_id')
            ->map(fn ($v) => (float) $v)
            ->all();

        $merged = [];
        foreach ($fromOrders as $cid => $amt) {
            $merged[(int) $cid] = ($merged[(int) $cid] ?? 0) + $amt;
        }
        foreach ($fromSettlements as $cid => $amt) {
            $merged[(int) $cid] = ($merged[(int) $cid] ?? 0) + $amt;
        }

        return $merged;
    }

    private function unattributedReceiptsTotal(int $userId): float
    {
        $orderTypes = $this->inventoryOrderMorphTypes();
        $settlementTypes = $this->settlementMorphTypes();

        $linked = (float) (Receipt::query()
            ->where('user_id', $userId)
            ->where(function ($q) use ($orderTypes, $settlementTypes) {
                $q->where(function ($q2) use ($orderTypes) {
                    $q2->whereIn('reference_type', $orderTypes)->whereNotNull('reference_id');
                })->orWhere(function ($q2) use ($settlementTypes) {
                    $q2->whereIn('reference_type', $settlementTypes)->whereNotNull('reference_id');
                });
            })
            ->sum('amount') ?? 0);

        $all = (float) (Receipt::query()->where('user_id', $userId)->sum('amount') ?? 0);

        $sulfaReceipts = (float) (Receipt::query()
            ->where('user_id', $userId)
            ->where('reference_type', TreasurySulfa::class)
            ->sum('amount') ?? 0);

        return max(0.0, round($all - $linked - $sulfaReceipts, 2));
    }
}
