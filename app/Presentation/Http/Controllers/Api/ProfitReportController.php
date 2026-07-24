<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use App\Application\Services\ProfitEngineService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\OrderCost;
use PhpOffice\PhpSpreadsheet\IOFactory;

class ProfitReportController extends Controller
{
    protected $profitEngine;

    public function __construct(ProfitEngineService $profitEngine)
    {
        $this->profitEngine = $profitEngine;
    }

    /**
     * Get profit summary for a period.
     */
    public function summary(Request $request)
    {
        $request->validate([
            'start_date' => 'required|date',
            'end_date' => 'required|date|after_or_equal:start_date',
            'channel' => 'nullable|string',
            'account_email' => 'nullable|email',
        ]);

        $summary = $this->profitEngine->getProfitSummary(
            $request->start_date,
            $request->end_date,
            [
                'channel' => $request->channel,
                'account_email' => $request->account_email,
            ]
        );

        return response()->json($summary);
    }

    /**
     * Cash-based period profit (receipts − linked COGS − expenses).
     */
    public function cashProfitSnapshot(Request $request)
    {
        $request->validate([
            'start_date' => 'required|date',
            'end_date' => 'required|date|after_or_equal:start_date',
        ]);

        return response()->json(
            $this->profitEngine->getCashProfitSnapshot(
                $request->start_date,
                $request->end_date
            )
        );
    }

    /**
     * Get profit by SKU.
     */
    public function bySku(Request $request)
    {
        $request->validate([
            'start_date' => 'required|date',
            'end_date' => 'required|date|after_or_equal:start_date',
            'limit' => 'nullable|integer|min:1|max:500',
            'channel' => 'nullable|string',
            'account_email' => 'nullable|email',
        ]);

        $report = $this->profitEngine->getProfitBySku(
            $request->start_date,
            $request->end_date,
            $request->limit ?? 20,
            [
                'channel' => $request->channel,
                'account_email' => $request->account_email,
            ]
        );

        return response()->json($report);
    }

    /**
     * Lightweight ROI / capital-cycle aggregates (SQL sums only).
     */
    public function roiMetrics(Request $request)
    {
        $request->validate([
            'start_date' => 'nullable|date',
            'end_date' => 'nullable|date|after_or_equal:start_date',
        ]);

        return response()->json($this->profitEngine->getRoiMetrics([
            'start_date' => $request->input('start_date'),
            'end_date' => $request->input('end_date'),
        ]));
    }

    /**
     * Import Amazon/Noon financial transactions and map to order_costs.
     */
    public function importPlatformFees(Request $request)
    {
        $request->validate([
            'channel' => 'nullable|string|max:100',
            'channel_id' => 'nullable|exists:channels,id',
            'account_email' => 'nullable|email|max:255',
            'file' => 'required|file|mimes:xlsx,xls,csv,txt|max:20480',
        ]);

        $channelInput = trim((string) $request->input('channel', ''));
        $channelIdInput = $request->input('channel_id');
        $channelModel = null;
        if ($channelIdInput) {
            $channelModel = Channel::find((int) $channelIdInput);
        }
        if (! $channelModel && $channelInput !== '') {
            $channelModel = Channel::query()
                ->where('slug', $channelInput)
                ->orWhere('name', $channelInput)
                ->orWhere('id', $channelInput)
                ->first();
        }

        if (! $channelModel) {
            return response()->json(['message' => 'Please select a valid channel before importing fees.'], 422);
        }

        // Canonical value to keep channels distinct even if same marketplace (e.g. 2 Amazon accounts).
        $channel = (string) $channelModel->id;
        $accountEmail = trim((string) $request->input('account_email', ''));
        $accountEmail = $accountEmail !== '' ? $accountEmail : null;
        $file = $request->file('file');
        $spreadsheet = IOFactory::load($file->getPathname());
        $sheetData = $spreadsheet->getActiveSheet()->toArray();

        if (count($sheetData) < 2) {
            return response()->json(['message' => 'File is empty'], 422);
        }

        $header = array_map(fn ($h) => strtolower(trim((string) $h)), $sheetData[0]);
        $rows = array_slice($sheetData, 1);

        $findValue = function (array $row, array $candidates) use ($header) {
            foreach ($candidates as $name) {
                $idx = array_search($name, $header, true);
                if ($idx !== false) {
                    return $row[$idx] ?? null;
                }
            }

            return null;
        };

        $aggregated = [];
        $unmatched = [];
        $processedRows = 0;

        foreach ($rows as $rowIdx => $row) {
            if (! is_array($row) || empty(array_filter($row, fn ($v) => $v !== null && $v !== ''))) {
                continue;
            }

            $externalOrderId = trim((string) ($findValue($row, ['order_id', 'platform_order_id', 'amazon-order-id', 'order-id']) ?? ''));
            $skuCode = trim((string) ($findValue($row, ['sku', 'sku_code', 'seller-sku']) ?? ''));
            $rawType = strtolower(trim((string) ($findValue($row, ['fee_type', 'type', 'transaction_type', 'description']) ?? 'platform_fee')));
            $rawAmount = $findValue($row, ['amount', 'fee', 'value', 'cost', 'total']);

            if ($externalOrderId === '' || $rawAmount === null || $rawAmount === '') {
                continue;
            }

            $amount = (float) str_replace([',', ' '], '', (string) $rawAmount);
            if ($amount == 0.0) {
                continue;
            }

            $costType = match (true) {
                str_contains($rawType, 'shipping') => 'shipping',
                str_contains($rawType, 'commission') => 'platform_fee',
                str_contains($rawType, 'fba') => 'fba_fee',
                str_contains($rawType, 'refund') => 'refund_fee',
                default => 'platform_fee',
            };

            $order = InventoryOrder::where('platform_order_id', $externalOrderId)->first();
            if (! $order) {
                $unmatched[] = ['row' => $rowIdx + 2, 'order_id' => $externalOrderId];

                continue;
            }

            $key = implode('|', [
                $order->id,
                $costType,
                $channel,
                $accountEmail,
                $externalOrderId,
                $skuCode,
            ]);

            if (! isset($aggregated[$key])) {
                $aggregated[$key] = [
                    'inventory_order_id' => $order->id,
                    'type' => $costType,
                    'source_channel' => $channel,
                    'account_email' => $accountEmail,
                    'external_order_id' => $externalOrderId,
                    'sku_code' => $skuCode ?: null,
                    'amount' => 0,
                    'notes' => 'Imported from platform statement',
                    'user_id' => Auth::id(),
                ];
            }

            $aggregated[$key]['amount'] += $amount;
            $processedRows++;
        }

        foreach ($aggregated as $item) {
            $existing = OrderCost::where('inventory_order_id', $item['inventory_order_id'])
                ->where('type', $item['type'])
                ->where('source_channel', $item['source_channel'])
                ->where('account_email', $item['account_email'])
                ->where('external_order_id', $item['external_order_id'])
                ->where('sku_code', $item['sku_code'])
                ->first();

            if ($existing) {
                $existing->amount = (float) $existing->amount + (float) $item['amount'];
                $existing->save();
            } else {
                OrderCost::create($item);
            }
        }

        return response()->json([
            'message' => 'Platform fees imported successfully',
            'summary' => [
                'processed_rows' => $processedRows,
                'inserted_or_updated' => count($aggregated),
                'unmatched_orders' => count($unmatched),
            ],
            'unmatched_orders' => array_slice($unmatched, 0, 100),
        ]);
    }

    public function feeDimensions()
    {
        $importedChannels = OrderCost::whereNotNull('source_channel')
            ->select('source_channel')
            ->distinct()
            ->pluck('source_channel')
            ->values();

        $channels = Channel::query()
            ->select(['id', 'name', 'slug'])
            ->orderBy('name')
            ->get()
            ->map(fn ($c) => [
                'value' => (string) $c->id,
                'label' => $c->name ?: ($c->slug ?: ('Channel '.$c->id)),
                'slug' => $c->slug,
            ])
            ->values();

        $accounts = OrderCost::whereNotNull('account_email')
            ->select('account_email')
            ->distinct()
            ->pluck('account_email')
            ->values();

        $accountsByChannel = [];
        foreach ($importedChannels as $channel) {
            $accountsByChannel[$channel] = OrderCost::where('source_channel', $channel)
                ->whereNotNull('account_email')
                ->select('account_email')
                ->distinct()
                ->pluck('account_email')
                ->values();
        }

        return response()->json([
            'channels' => $channels,
            'imported_channels' => $importedChannels,
            'account_emails' => $accounts,
            'accounts_by_channel' => $accountsByChannel,
        ]);
    }
}
