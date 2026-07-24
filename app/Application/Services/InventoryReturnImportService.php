<?php

namespace App\Application\Services;

use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryReturn;

class InventoryReturnImportService
{
    /**
     * Import marketplace returns (Amazon XML or CSV/TXT) and optionally process stock updates.
     */
    public function importFromRequest(Request $request)
    {
        $request->validate([
            'file' => 'required|file|mimes:xml,csv,txt',
            'channel' => 'nullable|string|max:100',
            'merchant_identifier' => 'nullable|string|max:100',
            'auto_process' => 'nullable|boolean',
            /** Only update rows matched by LP/hash/order+SKU — never create new returns from the sheet. */
            'update_only' => 'nullable|boolean',
            /** After import, run local restock for sellable FBA units (SkuInventory at order warehouse). */
            'auto_process_sellable' => 'nullable|boolean',
        ]);

        $channel = $request->input('channel', 'amazon');
        $merchantIdentifier = $request->input('merchant_identifier');
        $autoProcess = (bool) $request->boolean('auto_process', false);
        $updateOnly = (bool) $request->boolean('update_only', false);
        $autoProcessSellable = (bool) $request->boolean('auto_process_sellable', false);
        $file = $request->file('file');
        $content = @file_get_contents($file->getRealPath());
        if ($content === false) {
            return response()->json(['message' => 'Cannot read returns file'], 422);
        }

        $records = str_starts_with(ltrim($content), '<?xml')
            ? $this->parseReturnsXml($content)
            : $this->parseReturnsCsv($file->getRealPath());

        $summary = [
            'total_rows' => count($records),
            'created' => 0,
            'updated' => 0,
            'processed' => 0,
            'unmatched_orders' => 0,
            'skipped' => 0,
            'skipped_outdated' => 0,
            'skipped_update_only_no_match' => 0,
            'errors' => [],
        ];

        foreach ($records as $record) {
            $orderId = trim((string) ($record['order_id'] ?? ''));
            if ($orderId === '') {
                $summary['skipped']++;

                continue;
            }

            $order = InventoryOrder::with('channel')->where('platform_order_id', $orderId)->first();
            if (! $order) {
                $summary['unmatched_orders']++;

                continue;
            }

            $payload = [
                'inventory_order_id' => $order->id,
                'platform_return_id' => $record['platform_return_id'] ?? null,
                'sku_code' => $record['sku_code'] ?? null,
                'return_quantity' => max(1, (int) ($record['return_quantity'] ?? 1)),
                'return_date' => $record['return_date'] ?? null,
                'last_update_date' => $record['last_update_date'] ?? $record['return_date'] ?? now()->toDateTimeString(),
                'external_status' => $record['external_status'] ?? null,
                'refund_amount' => (float) ($record['refund_amount'] ?? 0),
                'financial_deduction' => (float) ($record['financial_deduction'] ?? 0),
                'extra_shipping_fee' => (float) ($record['extra_shipping_fee'] ?? 0),
                'source_channel' => $channel,
                'channel' => $record['channel'] ?? $channel,
                'return_location' => $record['return_location'] ?? null,
                'merchant_identifier' => $record['merchant_identifier'] ?? $merchantIdentifier,
                'fulfillment_channel' => $record['fulfillment_channel'] ?? null,
                'status' => $this->mapInternalStatus($record['external_status'] ?? null),
                'return_status' => $this->mapReturnStatus($record['external_status'] ?? null),
                'inventory_status' => $this->mapInventoryStatus($record['external_status'] ?? null),
                'reason' => $record['reason'] ?? null,
                'disposition' => $this->mapDisposition($record['disposition'] ?? null),
                'metadata' => $record['metadata'] ?? [],
                'user_id' => auth()->id(),
            ];

            if (! empty($record['fba_row_hash'])) {
                $payload['metadata'] = array_merge(
                    is_array($payload['metadata']) ? $payload['metadata'] : [],
                    [
                        'fba_row_hash' => $record['fba_row_hash'],
                        'fba_license_plate' => trim((string) ($record['platform_return_id'] ?? '')),
                    ]
                );
            }

            $fulfillmentFromOrder = $this->inferFulfillmentChannelFromOrder($order);
            if ($fulfillmentFromOrder !== null && empty($payload['fulfillment_channel'])) {
                $payload['fulfillment_channel'] = $fulfillmentFromOrder;
            }

            try {
                $payload['last_update_date'] = $this->normalizeDateTime($payload['last_update_date']) ?? now();
                $return = $this->findExistingReturn($payload, $record);

                if (! $return && $updateOnly) {
                    $summary['skipped_update_only_no_match']++;

                    continue;
                }

                if ($return) {
                    if (! $this->shouldApplyIncomingUpdate($return, $payload['last_update_date'])) {
                        $summary['skipped_outdated']++;

                        continue;
                    }
                    $mergedMeta = array_merge(
                        is_array($return->metadata) ? $return->metadata : [],
                        is_array($payload['metadata']) ? $payload['metadata'] : []
                    );
                    // Row matched this uploaded returns file → no longer "missing from sheets"; drop gap tracking.
                    $mergedMeta = $this->stripSettlementGapReimbursementFromMetadata($mergedMeta);
                    $payload['metadata'] = $mergedMeta;
                    $payload = $this->preserveFinancialAmountsWhenMergingFbaReturnsSheet($return, $payload, $record);
                    $return->update($payload);
                    $summary['updated']++;
                } else {
                    $return = InventoryReturn::create($payload);
                    $summary['created']++;
                }

                $isFbaRestocked = $this->isFbaRestocked($return);
                $shouldProcess = false;
                if ((string) ($return->status ?? '') !== 'completed' && (string) ($return->status ?? '') !== 'rejected') {
                    if (
                        $autoProcessSellable
                        && $return->disposition === 'sellable'
                        && $this->isFbaChannelReturn($return)
                    ) {
                        $shouldProcess = true;
                    } elseif (
                        ($autoProcess || $isFbaRestocked)
                        && in_array((string) ($return->status ?? ''), ['approved', 'completed'], true)
                        && (string) ($return->status ?? '') !== 'completed'
                    ) {
                        $shouldProcess = true;
                    }
                }
                if ($shouldProcess && $return->processReturn()) {
                    $summary['processed']++;
                }

                // Order/SKU appeared in this upload → remove settlement "missing returns sheet" queue from any twin payment line.
                $this->stripSettlementGapForPaymentSheetReturnsByOrderSku($orderId, (string) ($payload['sku_code'] ?? ''), auth()->id());
            } catch (\Throwable $e) {
                $summary['errors'][] = [
                    'order_id' => $orderId,
                    'sku' => $payload['sku_code'],
                    'message' => $e->getMessage(),
                ];
                if (count($summary['errors']) > 30) {
                    array_shift($summary['errors']);
                }
                Log::warning('Return import row failed', ['order_id' => $orderId, 'error' => $e->getMessage()]);
            }
        }

        return response()->json([
            'message' => 'Returns import completed',
            'summary' => $summary,
        ]);
    }

    /**
     * Import Amazon inventory ledger / adjustments CSV (e.g. Ledger Detail report).
     * Rows with WAREHOUSE_DAMAGED or LOST disposition become reimbursement-tracking lines:
     * anchor date = event time from the sheet, window = 60 days (stored in metadata.reimbursement).
     * Does not require order-id; inventory_order_id is null.
     */
    public function importLedgerFromRequest(Request $request)
    {
        $request->validate([
            'file' => 'required|file|mimes:csv,txt',
        ]);

        $path = $request->file('file')->getRealPath();
        $records = $this->parseInventoryLedgerCsv($path);

        $summary = [
            'total_rows' => count($records),
            'created' => 0,
            'updated' => 0,
            'skipped' => 0,
            'skipped_no_claim_disposition' => 0,
            'skipped_no_date' => 0,
            'errors' => [],
        ];

        foreach ($records as $record) {
            try {
                if (! $this->ledgerDispositionNeedsClaim((string) ($record['disposition_raw'] ?? ''))) {
                    $summary['skipped_no_claim_disposition']++;

                    continue;
                }

                $eventDate = $record['event_datetime'] ?? null;
                if (! $eventDate) {
                    $summary['skipped_no_date']++;

                    continue;
                }

                $dispRaw = (string) ($record['disposition_raw'] ?? '');
                $fc = trim((string) ($record['fc'] ?? ''));
                $ref = trim((string) ($record['reference_id'] ?? ''));
                $ledgerHash = (string) ($record['ledger_row_hash'] ?? '');
                if ($ledgerHash === '') {
                    $summary['skipped']++;

                    continue;
                }

                $platformReturnId = 'INVLEDGER-'.$ledgerHash;
                $anchorIso = Carbon::parse($eventDate)->toIso8601String();

                $extDisp = strtoupper(preg_replace('/\s+/', '_', trim($dispRaw)));
                $ext = 'inventory_ledger:'.$extDisp.($fc !== '' ? '@'.$fc : '');

                $kind = preg_match('/\bLOST\b/i', $dispRaw) ? 'lost' : 'warehouse_damaged';

                $payload = [
                    'inventory_order_id' => null,
                    'platform_return_id' => $platformReturnId,
                    'sku_code' => $record['sku'] ?? null,
                    'return_quantity' => max(1, abs((int) ($record['quantity'] ?? 1))),
                    'return_date' => $this->normalizeDateTime($eventDate),
                    'last_update_date' => now(),
                    'external_status' => $ext,
                    'refund_amount' => 0,
                    'financial_deduction' => 0,
                    'extra_shipping_fee' => 0,
                    'source_channel' => 'amazon',
                    'channel' => 'amazon',
                    'return_location' => $fc !== '' ? $fc : null,
                    'merchant_identifier' => null,
                    'fulfillment_channel' => 'AFN',
                    'status' => 'pending',
                    'return_status' => $this->mapReturnStatus($ext),
                    'inventory_status' => $this->mapInventoryStatus($ext),
                    'reason' => trim('inventory_ledger '.$dispRaw.($ref !== '' ? ' ('.$ref.')' : '')),
                    'disposition' => $this->mapDisposition($dispRaw),
                    'metadata' => [
                        'reimbursement' => [
                            'source' => 'inventory_ledger',
                            'anchor_date' => $anchorIso,
                            'window_days' => 60,
                            'kind' => $kind,
                            'reference_id' => $ref,
                            'event_type' => (string) ($record['event_type'] ?? ''),
                            'disposition_raw' => $dispRaw,
                        ],
                        'ledger_row_hash' => $ledgerHash,
                        'raw' => $record['raw'] ?? [],
                    ],
                    'user_id' => auth()->id(),
                ];

                $return = InventoryReturn::query()
                    ->where('platform_return_id', $platformReturnId)
                    ->when(auth()->id(), function ($q) {
                        $q->where('user_id', auth()->id());
                    })
                    ->first();

                if ($return) {
                    $mergedMeta = array_merge(
                        is_array($return->metadata) ? $return->metadata : [],
                        is_array($payload['metadata']) ? $payload['metadata'] : []
                    );
                    $payload['metadata'] = $mergedMeta;
                    $return->update($payload);
                    $summary['updated']++;
                } else {
                    InventoryReturn::create($payload);
                    $summary['created']++;
                }

                $this->stripSettlementGapForPaymentSheetReturnsByOrderSku($ref, (string) ($record['sku'] ?? ''), auth()->id());
            } catch (\Throwable $e) {
                $summary['errors'][] = [
                    'message' => $e->getMessage(),
                ];
                if (count($summary['errors']) > 30) {
                    array_shift($summary['errors']);
                }
                Log::warning('inventory_ledger.import_row_failed', ['error' => $e->getMessage()]);
            }
        }

        return response()->json([
            'message' => 'Inventory ledger import completed',
            'summary' => $summary,
        ]);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function parseInventoryLedgerCsv(string $filePath): array
    {
        $probe = @file_get_contents($filePath, false, null, 0, 65536);
        $delimiter = ',';
        if ($probe !== false && substr_count($probe, "\t") > substr_count($probe, ',')) {
            $delimiter = "\t";
        }

        $handle = fopen($filePath, 'r');
        if (! $handle) {
            return [];
        }

        $header = fgetcsv($handle, 0, $delimiter);
        if (! $header) {
            fclose($handle);

            return [];
        }

        $normalizedHeader = array_map(function ($h) {
            $name = (string) $h;

            return $this->normalizeLedgerHeaderKey($name);
        }, $header);

        $records = [];

        while (($row = fgetcsv($handle, 0, $delimiter)) !== false) {
            if (! is_array($row) || empty(array_filter($row))) {
                continue;
            }
            if (count($row) < count($normalizedHeader)) {
                $row = array_pad($row, count($normalizedHeader), null);
            }
            $data = array_combine($normalizedHeader, array_slice($row, 0, count($normalizedHeader)));
            if (! is_array($data)) {
                continue;
            }

            $disp = $this->ledgerPickColumn($data, ['disposition', 'inventory disposition', 'detailed disposition']);
            $ref = $this->ledgerPickColumn($data, ['reference id', 'reference-id', 'reference_id', 'reference']);
            $qtyRaw = $this->ledgerPickColumn($data, ['quantity', 'qty']);
            $fc = $this->ledgerPickColumn($data, ['fulfillment center', 'fulfillment-center-id', 'fulfillment center id', 'fc']);
            $eventType = $this->ledgerPickColumn($data, ['event type', 'event-type', 'type']);
            $reason = $this->ledgerPickColumn($data, ['reason']);
            $dateRaw = $this->ledgerPickColumn($data, [
                'date and time',
                'date/time',
                'date & time',
                'event date',
                'transaction date',
                'date time',
                'datetime',
            ]);
            $sku = $this->ledgerPickColumn($data, ['sku', 'merchant sku', 'msku', 'fnsku']);

            $eventDt = $this->parseLedgerEventDateTime($dateRaw);
            $qty = is_numeric($qtyRaw) ? (int) $qtyRaw : 1;

            $ledgerRowHash = hash('sha256', $ref.'|'.((string) ($eventDt ?? '')).'|'.$disp.'|'.$qty.'|'.$fc);

            $records[] = [
                'reference_id' => $ref,
                'event_type' => $eventType,
                'disposition_raw' => $disp,
                'quantity' => $qty,
                'fc' => $fc,
                'event_datetime' => $eventDt,
                'sku' => $sku !== '' ? $sku : null,
                'reason' => $reason,
                'ledger_row_hash' => $ledgerRowHash,
                'raw' => $data,
            ];
        }

        fclose($handle);

        return $records;
    }

    private function normalizeLedgerHeaderKey(string $name): string
    {
        $name = preg_replace('/^\xEF\xBB\xBF/', '', $name);

        return strtolower(trim($name, "\"' \t\n\r\0\x0B"));
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function ledgerPickColumn(array $data, array $keys): string
    {
        foreach ($keys as $k) {
            $nk = $this->normalizeLedgerHeaderKey($k);
            if (! array_key_exists($nk, $data)) {
                continue;
            }
            $v = $data[$nk];
            if ($v === null) {
                continue;
            }
            $s = trim((string) $v);
            if ($s !== '') {
                return $s;
            }
        }

        return '';
    }

    private function ledgerDispositionNeedsClaim(string $disp): bool
    {
        $u = strtoupper(trim($disp));
        if ($u === '') {
            return false;
        }

        if (str_contains($u, 'WAREHOUSE_DAMAGED') || str_contains($u, 'WAREHOUSE_DAMAGE')) {
            return true;
        }

        return (bool) preg_match('/\bLOST\b/', $u);
    }

    /**
     * Parses ledger date columns; prefers day-first when ambiguous (common for EG exports).
     */
    private function parseLedgerEventDateTime(string $raw): ?string
    {
        $raw = trim($raw);
        if ($raw === '') {
            return null;
        }

        // Prefer explicit D/M/Y vs M/D/Y when the cell looks like 01/05/2026 (Amazon EG exports often use day-first).
        if (preg_match('#^(\d{1,2})[/.](\d{1,2})[/.](\d{4})\s*(.*)$#', $raw, $m)) {
            $p1 = (int) $m[1];
            $p2 = (int) $m[2];
            $y = (int) $m[3];
            $tail = trim((string) ($m[4] ?? ''));
            if ($tail === '') {
                $tail = '00:00';
            } elseif (! preg_match('/:/', $tail)) {
                $tail = '00:00';
            }

            try {
                if ($p1 > 12) {
                    return Carbon::createFromFormat('d/m/Y H:i', sprintf('%02d/%02d/%04d %s', $p1, $p2, $y, $tail))->format('Y-m-d H:i:s');
                }
                if ($p2 > 12) {
                    return Carbon::createFromFormat('m/d/Y H:i', sprintf('%02d/%02d/%04d %s', $p1, $p2, $y, $tail))->format('Y-m-d H:i:s');
                }

                return Carbon::createFromFormat('d/m/Y H:i', sprintf('%02d/%02d/%04d %s', $p1, $p2, $y, $tail))->format('Y-m-d H:i:s');
            } catch (\Throwable) {
                // fall through
            }
        }

        try {
            return Carbon::parse($raw)->format('Y-m-d H:i:s');
        } catch (\Throwable) {
            return null;
        }
    }

    private function parseReturnsXml(string $xmlText): array
    {
        $xml = simplexml_load_string($xmlText);
        if (! $xml || ! isset($xml->Message)) {
            return [];
        }

        $records = [];
        foreach ($xml->Message->return_details as $node) {
            $item = $node->item_details;
            $records[] = [
                'order_id' => (string) ($node->order_id ?? ''),
                'platform_return_id' => (string) ($node->amazon_rma_id ?? ''),
                'sku_code' => (string) ($item->merchant_sku ?? ''),
                'return_quantity' => (int) ($item->return_quantity ?? 1),
                'return_date' => $this->parseDate((string) ($node->return_request_date ?? null)),
                'external_status' => (string) ($node->return_request_status ?? ''),
                'reason' => (string) ($item->return_reason_code ?? ''),
                'disposition' => $this->deriveDispositionFromReason((string) ($item->return_reason_code ?? '')),
                'refund_amount' => (float) ($item->refund_amount ?? 0),
                'fulfillment_channel' => null,
                'merchant_identifier' => null,
                'metadata' => [
                    'return_type' => (string) ($node->return_type ?? ''),
                    'label_paid_by' => (string) ($node->label_to_be_paid_by ?? ''),
                    'in_policy' => (string) ($item->in_policy ?? ''),
                    'order_item_id' => (string) ($item->order_item_id ?? ''),
                    'raw' => json_decode(json_encode($node), true),
                ],
            ];
        }

        return $records;
    }

    private function parseReturnsCsv(string $filePath): array
    {
        $handle = fopen($filePath, 'r');
        if (! $handle) {
            return [];
        }

        $header = fgetcsv($handle);
        if (! $header) {
            fclose($handle);

            return [];
        }

        $normalizedHeader = array_map(function ($h) {
            $name = (string) $h;
            // Remove UTF-8 BOM if present in first column header.
            $name = preg_replace('/^\xEF\xBB\xBF/', '', $name);

            return strtolower(trim($name, "\"' \t\n\r\0\x0B"));
        }, $header);
        $records = [];

        while (($row = fgetcsv($handle)) !== false) {
            if (! is_array($row) || empty(array_filter($row))) {
                continue;
            }
            if (count($row) < count($normalizedHeader)) {
                $row = array_pad($row, count($normalizedHeader), null);
            }
            $data = array_combine($normalizedHeader, array_slice($row, 0, count($normalizedHeader)));
            $oid = trim((string) ($data['order-id'] ?? ''));
            $msku = trim((string) ($data['sku'] ?? ''));
            $lp = trim((string) ($data['license-plate-number'] ?? ''));
            $fc = trim((string) ($data['fulfillment-center-id'] ?? ''));
            $detailed = trim((string) ($data['detailed-disposition'] ?? ''));
            $retDateRaw = trim((string) ($data['return-date'] ?? ''));
            $rowHash = hash('sha256', $oid.'|'.$msku.'|'.$lp.'|'.$retDateRaw);
            $extStatus = $detailed !== '' || $fc !== ''
                ? 'fba_returns:'.strtoupper($detailed !== '' ? $detailed : 'UNKNOWN').($fc !== '' ? '@'.$fc : '')
                : trim((string) ($data['status'] ?? $data['return-status'] ?? 'fba_returns_sheet'));
            $records[] = [
                'order_id' => $oid,
                'platform_return_id' => $lp,
                'sku_code' => $msku,
                'return_quantity' => (int) ($data['quantity'] ?? 1),
                'return_date' => $this->parseDate((string) ($data['return-date'] ?? null)),
                'external_status' => $extStatus,
                'last_update_date' => $this->parseDate((string) ($data['date'] ?? $data['return-date'] ?? null)),
                'reason' => trim((string) ($data['reason'] ?? '')),
                'disposition' => $detailed,
                'refund_amount' => 0,
                'financial_deduction' => (float) ($data['financial-deduction'] ?? 0),
                'extra_shipping_fee' => (float) ($data['extra-shipping-fee'] ?? 0),
                'return_location' => trim((string) ($data['return-location'] ?? $data['fulfillment-center-id'] ?? '')),
                'channel' => trim((string) ($data['channel'] ?? '')),
                'fulfillment_channel' => null,
                'merchant_identifier' => null,
                'fba_row_hash' => $rowHash,
                'metadata' => [
                    'asin' => $data['asin'] ?? null,
                    'fnsku' => $data['fnsku'] ?? null,
                    'fulfillment_center_id' => $data['fulfillment-center-id'] ?? null,
                    'customer_comments' => $data['customer-comments'] ?? null,
                    'product_name' => $data['product-name'] ?? null,
                    'raw' => $data,
                ],
            ];
        }

        fclose($handle);

        return $records;
    }

    private function mapExternalReturnStatus(?string $externalStatus): string
    {
        $status = strtolower(trim((string) $externalStatus));
        if ($status === '') {
            return 'pending';
        }

        if (str_contains($status, 'transit') || str_contains($status, 'pickup') || str_contains($status, 'carrier')) {
            return 'in_transit';
        }
        if (in_array($status, ['approved', 'received', 'completed', 'closed'], true)) {
            // For auto-processing, we map these to 'approved' if they are back
            return 'approved';
        }
        if (in_array($status, ['rejected', 'declined', 'cancelled'], true)) {
            return 'rejected';
        }

        return 'pending';
    }

    private function mapInternalStatus(?string $externalStatus): string
    {
        return $this->mapExternalReturnStatus($externalStatus);
    }

    private function mapReturnStatus(?string $externalStatus): string
    {
        $status = strtolower(trim((string) $externalStatus));
        if ($status === '') {
            return 'return_requested';
        }

        if (str_starts_with($status, 'fba_returns:')) {
            return 'arrived_to_warehouse';
        }

        if (str_starts_with($status, 'inventory_ledger:')) {
            return 'arrived_to_warehouse';
        }

        if (str_contains($status, 'transit') || str_contains($status, 'pickup') || str_contains($status, 'carrier')) {
            return 'in_transit';
        }

        if (str_contains($status, 'warehouse') || str_contains($status, 'received') || str_contains($status, 'arrived')) {
            return 'arrived_to_warehouse';
        }

        if (str_contains($status, 'restock') || str_contains($status, 'returned to fba warehouse')) {
            return 'restocked';
        }

        if (str_contains($status, 'closed') || str_contains($status, 'complete')) {
            return 'closed';
        }

        if (str_contains($status, 'cancel')) {
            return 'cancelled';
        }

        if (str_contains($status, 'lost')) {
            return 'lost';
        }

        return 'return_requested';
    }

    private function mapInventoryStatus(?string $externalStatus): string
    {
        $status = strtolower(trim((string) $externalStatus));

        if (str_starts_with($status, 'fba_returns:')) {
            return 'pending_confirmation';
        }

        if (str_starts_with($status, 'inventory_ledger:')) {
            return 'pending_confirmation';
        }

        if (str_contains($status, 'returned to fba warehouse') || str_contains($status, 'restock')) {
            return 'restocked';
        }

        if (str_contains($status, 'arrived') || str_contains($status, 'received') || str_contains($status, 'warehouse')) {
            return 'pending_confirmation';
        }

        if (str_contains($status, 'lost')) {
            return 'lost';
        }

        return 'on_hold';
    }

    public function canTransitionStatus(string $current, string $next): bool
    {
        if ($current === $next) {
            return true;
        }

        $allowed = [
            'pending' => ['in_transit', 'approved', 'rejected'],
            'in_transit' => ['approved', 'rejected'],
            'approved' => ['completed'],
            'rejected' => [],
            'completed' => [],
        ];

        return in_array($next, $allowed[$current] ?? [], true);
    }

    private function mapDisposition(?string $raw): string
    {
        $value = strtolower(trim((string) $raw));
        if ($value === '') {
            // Unknown FBA disposition — do not assume sellable until graded on the returns sheet.
            return 'unsellable';
        }
        if (in_array($value, ['sellable', 'good'], true)) {
            return 'sellable';
        }
        if (str_contains($value, 'lost')) {
            return 'unsellable';
        }
        if (str_contains($value, 'warehouse') && str_contains($value, 'damage')) {
            return 'unsellable';
        }
        if (in_array($value, ['defective', 'damaged', 'customer_damaged'], true)) {
            return 'damaged';
        }
        if (in_array($value, ['unsellable', 'not_sellable'], true)) {
            return 'unsellable';
        }

        return 'unsellable';
    }

    private function deriveDispositionFromReason(string $reason): string
    {
        $r = strtolower($reason);
        if (str_contains($r, 'defect') || str_contains($r, 'quality')) {
            return 'damaged';
        }

        return 'sellable';
    }

    private function parseDate(?string $value): ?string
    {
        if (! $value) {
            return null;
        }
        try {
            return date('Y-m-d H:i:s', strtotime($value));
        } catch (\Throwable) {
            return null;
        }
    }

    public function normalizeDateTime($value): ?string
    {
        if (empty($value)) {
            return null;
        }

        try {
            return Carbon::parse((string) $value)->format('Y-m-d H:i:s');
        } catch (\Throwable) {
            return null;
        }
    }

    public function shouldApplyIncomingUpdate(InventoryReturn $existing, $incomingDate): bool
    {
        $incoming = $this->normalizeDateTime($incomingDate);
        if (! $incoming) {
            return true;
        }

        $existingDate = $existing->last_update_date
            ? Carbon::parse($existing->last_update_date)->format('Y-m-d H:i:s')
            : null;

        if (! $existingDate) {
            return true;
        }

        return $incoming >= $existingDate;
    }

    public function findExistingReturn(array $payload, array $record = []): ?InventoryReturn
    {
        $fromImport = ! empty($record);
        $lp = trim((string) ($payload['platform_return_id'] ?? ''));

        if ($lp !== '') {
            $byLp = InventoryReturn::query()
                ->where('platform_return_id', $lp)
                ->when(! empty($payload['user_id']), function ($q) use ($payload) {
                    $q->where('user_id', $payload['user_id']);
                })
                ->first();
            if ($byLp) {
                return $byLp;
            }

            if ($fromImport) {
                $byMetaLp = InventoryReturn::query()
                    ->where('metadata->fba_license_plate', $lp)
                    ->when(! empty($payload['user_id']), function ($q) use ($payload) {
                        $q->where('user_id', $payload['user_id']);
                    })
                    ->first();
                if ($byMetaLp) {
                    return $byMetaLp;
                }
            }

            if (! $fromImport) {
                // Manual/API create: do not fall back to order+SKU (keeps LP globally unique).
                return null;
            }
        }

        if ($fromImport && ! empty($record['fba_row_hash'])) {
            $byHash = InventoryReturn::query()
                ->where('metadata->fba_row_hash', $record['fba_row_hash'])
                ->when(! empty($payload['user_id']), function ($q) use ($payload) {
                    $q->where('user_id', $payload['user_id']);
                })
                ->first();
            if ($byHash) {
                return $byHash;
            }
        }

        if ($fromImport) {
            $merged = $this->findSettlementReturnToMergeWithFbaSheet($payload, $record);
            if ($merged) {
                return $merged;
            }
        }

        if ($lp !== '' && ! $fromImport) {
            return null;
        }

        $query = InventoryReturn::query()
            ->where('inventory_order_id', $payload['inventory_order_id'] ?? null);

        if (! empty($payload['sku_code'])) {
            $query->where('sku_code', $payload['sku_code']);
        }

        if (! empty($payload['user_id'])) {
            $query->where('user_id', $payload['user_id']);
        }

        if ($fromImport) {
            $candidates = $query->get();
            if ($candidates->count() === 1) {
                return $candidates->first();
            }

            return null;
        }

        return $query->first();
    }

    /**
     * When the FBA returns report is imported, merge onto settlement-generated rows (same order+SKU)
     * so we do not create a second return line for the same physical unit.
     */
    private function findSettlementReturnToMergeWithFbaSheet(array $payload, array $record): ?InventoryReturn
    {
        $orderId = $payload['inventory_order_id'] ?? null;
        $sku = trim((string) ($payload['sku_code'] ?? ''));
        if (! $orderId || $sku === '') {
            return null;
        }

        $query = InventoryReturn::query()
            ->where('inventory_order_id', $orderId)
            ->where('sku_code', $sku)
            ->where(function ($w) {
                $w->where('external_status', 'refund_from_payment_sheet')
                    ->orWhere('platform_return_id', 'like', 'STL-%');
            })
            ->when(! empty($payload['user_id']), function ($q) use ($payload) {
                $q->where('user_id', $payload['user_id']);
            });

        $candidates = $query->orderByRaw('COALESCE(return_date, created_at) ASC')->get();
        if ($candidates->isEmpty()) {
            return null;
        }
        if ($candidates->count() === 1) {
            return $candidates->first();
        }

        $csvDate = $record['return_date'] ?? $payload['return_date'] ?? null;
        if ($csvDate) {
            try {
                $day = Carbon::parse($csvDate)->startOfDay();
                $sameDay = $candidates->filter(function ($r) use ($day) {
                    if (! $r->return_date) {
                        return false;
                    }

                    return Carbon::parse($r->return_date)->isSameDay($day);
                });
                if ($sameDay->count() === 1) {
                    $chosen = $sameDay->first();
                    $this->voidOrphanSettlementReturnsExcept($chosen, $candidates);

                    return $chosen;
                }
            } catch (\Throwable) {
                // ignore date parse failures
            }
        }

        $unlinked = $candidates->filter(function ($r) {
            $m = is_array($r->metadata) ? $r->metadata : [];

            return empty($m['fba_license_plate']) && empty($m['fba_row_hash']);
        });
        if ($unlinked->count() >= 1) {
            $chosen = $unlinked->first();
            $this->voidOrphanSettlementReturnsExcept($chosen, $candidates);

            return $chosen;
        }

        $chosen = $candidates->first();
        if ($chosen) {
            $this->voidOrphanSettlementReturnsExcept($chosen, $candidates);
        }

        return $chosen;
    }

    /**
     * @param  \Illuminate\Support\Collection<int, InventoryReturn>  $candidates
     */
    private function voidOrphanSettlementReturnsExcept(InventoryReturn $keep, $candidates): void
    {
        foreach ($candidates as $candidate) {
            if ((int) $candidate->id === (int) $keep->id) {
                continue;
            }

            if ((string) ($candidate->status ?? '') === 'completed') {
                continue;
            }

            if ($this->returnRowHasFbaSheetEvidence($candidate)) {
                continue;
            }

            if ((string) ($candidate->external_status ?? '') !== 'refund_from_payment_sheet'
                && ! str_starts_with((string) ($candidate->platform_return_id ?? ''), 'STL-')) {
                continue;
            }

            $meta = is_array($candidate->metadata) ? $candidate->metadata : [];
            $meta['void_reason'] = 'duplicate_settlement_return_orphan';
            $meta['voided_at'] = now()->toIso8601String();
            $meta['merged_into_return_id'] = $keep->id;
            $candidate->update([
                'status' => 'void',
                'metadata' => $meta,
            ]);
        }
    }

    private function returnRowHasFbaSheetEvidence(InventoryReturn $return): bool
    {
        $ext = strtolower((string) ($return->external_status ?? ''));
        if (str_starts_with($ext, 'fba_returns:')) {
            return true;
        }

        $meta = is_array($return->metadata) ? $return->metadata : [];

        return ! empty($meta['fba_license_plate']) || ! empty($meta['fba_row_hash']);
    }

    /**
     * @param  array<string, mixed>  $meta
     * @return array<string, mixed>
     */
    private function stripSettlementGapReimbursementFromMetadata(array $meta): array
    {
        $rm = $meta['reimbursement'] ?? null;
        if (! is_array($rm)) {
            return $meta;
        }
        $src = (string) ($rm['source'] ?? '');
        if ($src === 'settlement_refund_missing_returns_sheet' || ! empty($rm['ready_immediate'])) {
            unset($meta['reimbursement']);
        }

        return $meta;
    }

    /**
     * When a ledger sheet row references an Amazon order id + SKU, clear gap reimbursement on the
     * payment-sheet return line(s) for that order — ledger counts as "appeared on an uploaded sheet".
     */
    private function stripSettlementGapForPaymentSheetReturnsByOrderSku(?string $referenceId, ?string $sku, ?int $userId): void
    {
        $ref = trim((string) $referenceId);
        $skuNorm = trim((string) $sku);
        if ($ref === '' || $skuNorm === '') {
            return;
        }

        $order = InventoryOrder::query()
            ->where('platform_order_id', $ref)
            ->when($userId, function ($q) use ($userId) {
                $q->where('user_id', $userId);
            })
            ->first();
        if (! $order) {
            return;
        }

        $returns = InventoryReturn::query()
            ->where('inventory_order_id', $order->id)
            ->where('sku_code', $skuNorm)
            ->where('external_status', 'refund_from_payment_sheet')
            ->when($userId, function ($q) use ($userId) {
                $q->where('user_id', $userId);
            })
            ->get();

        foreach ($returns as $ret) {
            $meta = is_array($ret->metadata) ? $ret->metadata : [];
            $meta = $this->stripSettlementGapReimbursementFromMetadata($meta);
            $ret->update(['metadata' => $meta]);
        }
    }

    /**
     * FBA returns CSV is operational (LP, FC, disposition); it does not include customer refund like Seller Central.
     * parseReturnsCsv sets refund_amount to 0 — re-import must not wipe amounts synced from settlement/payment sheet.
     *
     * @param  array<string, mixed>  $payload
     * @param  array<string, mixed>  $record
     * @return array<string, mixed>
     */
    private function preserveFinancialAmountsWhenMergingFbaReturnsSheet(InventoryReturn $existing, array $payload, array $record): array
    {
        $incomingRefund = (float) ($record['refund_amount'] ?? 0);
        $incomingFd = (float) ($record['financial_deduction'] ?? 0);
        $incomingShip = (float) ($record['extra_shipping_fee'] ?? 0);

        $existingRefund = (float) ($existing->refund_amount ?? 0);
        $existingFd = (float) ($existing->financial_deduction ?? 0);
        $existingShip = (float) ($existing->extra_shipping_fee ?? 0);

        // Parser always sends refund_amount = 0 for standard FBA returns reports.
        if ($incomingRefund === 0.0 && $existingRefund !== 0.0) {
            $payload['refund_amount'] = $existingRefund;
        }

        // Empty/missing fee columns parse as 0 and would erase settlement-backed deductions.
        if ($incomingFd === 0.0 && $existingFd !== 0.0) {
            $payload['financial_deduction'] = $existingFd;
        }
        if ($incomingShip === 0.0 && $existingShip !== 0.0) {
            $payload['extra_shipping_fee'] = $existingShip;
        }

        return $payload;
    }

    private function inferFulfillmentChannelFromOrder(InventoryOrder $order): ?string
    {
        $ch = $order->channel;
        if (! $ch) {
            return 'AFN';
        }
        $slug = strtolower((string) ($ch->slug ?? ''));
        $name = strtolower((string) ($ch->name ?? ''));
        if (str_contains($slug, 'fba') || str_contains($name, 'fba') || str_contains($slug, 'afn') || str_contains($name, 'afn')) {
            return 'AFN';
        }

        return null;
    }

    private function isFbaChannelReturn(InventoryReturn $return): bool
    {
        $fulfillment = strtolower((string) ($return->fulfillment_channel ?? ''));
        if (str_contains($fulfillment, 'afn') || str_contains($fulfillment, 'fba')) {
            return true;
        }
        $return->loadMissing('inventoryOrder.channel');
        $order = $return->inventoryOrder;
        if (! $order?->channel) {
            return str_contains(strtolower((string) ($return->source_channel ?? '')), 'amazon');
        }
        $slug = strtolower((string) ($order->channel->slug ?? ''));
        $name = strtolower((string) ($order->channel->name ?? ''));

        return str_contains($slug, 'fba') || str_contains($name, 'fba') || str_contains($slug, 'afn') || str_contains($name, 'afn');
    }

    private function isFbaRestocked(InventoryReturn $return): bool
    {
        $fulfillment = strtolower((string) ($return->fulfillment_channel ?? ''));
        $externalStatus = strtolower((string) ($return->external_status ?? ''));

        $isFba = str_contains($fulfillment, 'fba')
            || str_contains(strtolower((string) ($return->source_channel ?? '')), 'amazon');

        return $isFba && (
            str_contains($externalStatus, 'returned to fba warehouse')
            || $return->inventory_status === 'restocked'
            || $return->return_status === 'restocked'
        );
    }
}
