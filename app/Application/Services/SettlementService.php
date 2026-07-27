<?php

namespace App\Application\Services;

use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryReturn;
use App\Domain\Models\Wms\Settlement;
use App\Domain\Models\Wms\SettlementItem;

class SettlementService
{
    private const STATUS_RELEASED = 'released';

    private const STATUS_DEFERRED = 'deferred';

    private const STATUS_PENDING = 'pending';

    private const STATUS_REVERSED = 'reversed';

    /**
     * Import Amazon settlement (XML/TXT/CSV) and store lines.
     */
    public function importAmazonSettlement(int $channelId, string $filePath): array
    {
        $fileContents = @file_get_contents($filePath);
        if ($fileContents === false) {
            throw new \RuntimeException('Unable to read settlement file.');
        }

        // Detect XML robustly (some exports start with UTF-8 BOM or whitespace).
        // If we mis-detect XML as CSV/TXT, we generate a fallback report_id each upload → duplicates.
        $leading = ltrim($fileContents);
        if (str_starts_with($leading, "\xEF\xBB\xBF")) {
            $leading = substr($leading, 3);
        }
        $isXml = preg_match('/^\s*<\?xml/i', $leading) === 1;
        if ($isXml) {
            $merchantIdentifier = $this->extractMerchantIdentifierFromXml($fileContents);
            $channelId = $this->resolveChannelIdByMerchantIdentifier($merchantIdentifier, $channelId);
        }

        return $isXml
            ? $this->importAmazonSettlementXml($channelId, $fileContents)
            : $this->importAmazonSettlementDelimited($channelId, $filePath, $fileContents);
    }

    private function importAmazonSettlementDelimited(int $channelId, string $filePath, string $fileContents): array
    {
        $rows = $this->parseDelimitedRows($fileContents);
        if (empty($rows)) {
            throw new \RuntimeException('Settlement file is empty.');
        }

        $stats = [
            'total_rows' => 0,
            'orders' => 0,
            'refunds' => 0,
            'fees' => 0,
            'settlement_id' => null,
            'amount' => 0,
            'merchant_identifier' => null,
        ];

        DB::beginTransaction();
        try {
            $settlement = null;
            $settlementReportId = null;
            $linesBuffer = [];
            // Exact duplicate lines in the same file (common with copy/paste or merged exports)
            // must not create duplicate settlement_items.
            $seenCsvRowHashes = [];

            foreach ($rows as $data) {
                if (! is_array($data) || empty(array_filter($data, fn ($v) => $v !== null && $v !== ''))) {
                    continue;
                }

                $rowFingerprint = md5(json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
                if (isset($seenCsvRowHashes[$rowFingerprint])) {
                    $stats['skipped_duplicates'] = (int) ($stats['skipped_duplicates'] ?? 0) + 1;

                    continue;
                }
                $seenCsvRowHashes[$rowFingerprint] = true;

                $stats['total_rows']++;

                if (! $settlement) {
                    $settlementReportId = $this->pickValue($data, ['settlement-id', 'settlement id', 'report-id', 'report id']);
                    $merchantIdentifier = $this->cleanMerchantId((string) $this->pickValue($data, ['merchant-id', 'merchant id', 'merchant_identifier']));
                    if ($merchantIdentifier === '') {
                        // Noon files usually expose seller account in "Contract".
                        $merchantIdentifier = $this->cleanMerchantId((string) $this->pickValue($data, ['contract', 'contract id']));
                    }
                    $resolvedChannelId = $this->resolveChannelIdByMerchantIdentifier($merchantIdentifier, $channelId);

                    $settlement = $this->prepareSettlementForImport(
                        $resolvedChannelId,
                        ($settlementReportId ?: $this->pickValue($data, ['reference nr', 'reference no', 'reference number', 'reference_nr']))
                            ?: $this->buildFallbackReportIdFromContents($fileContents, $filePath),
                        $this->pickValue($data, ['settlement-start-date', 'start-date', 'start_date', 'period-start', 'period start', 'order date', 'order_date', 'transaction date', 'transaction_date']),
                        $this->pickValue($data, ['settlement-end-date', 'end-date', 'end_date', 'period-end', 'period end', 'transaction date', 'transaction_date']),
                        $merchantIdentifier ?: null
                    );
                    $stats['settlement_id'] = $settlement->id;
                    $stats['merchant_identifier'] = $merchantIdentifier ?: null;
                }

                $line = $this->mapDelimitedRowToSettlementLine($data);
                if (! $line) {
                    continue;
                }

                $linesBuffer[] = $line;
            }

            if ($settlement && ! empty($linesBuffer)) {
                foreach ($linesBuffer as $lineSeq => $line) {
                    $raw = is_array($line['raw_data'] ?? null) ? $line['raw_data'] : [];
                    $raw['import_line_seq'] = $lineSeq;
                    $line['raw_data'] = $raw;

                    $decision = $this->resolveDeduplicationDecision($settlement, $line);
                    if (($decision['action'] ?? 'create') === 'skip_duplicate') {
                        $stats['skipped_duplicates'] = (int) ($stats['skipped_duplicates'] ?? 0) + 1;

                        continue;
                    }

                    if (($decision['action'] ?? 'create') === 'update_existing' && ! empty($decision['item'])) {
                        /** @var SettlementItem $existing */
                        $existing = $decision['item'];
                        $existing->update([
                            'amount' => $line['amount'] ?? $existing->amount,
                            'fee_amount' => $line['fee_amount'] ?? $existing->fee_amount,
                            'quantity' => $line['quantity'] ?? $existing->quantity,
                            'sku' => $line['sku'] ?? $existing->sku,
                            'description' => $line['description'] ?? $existing->description,
                            'transaction_status' => $line['transaction_status'] ?? $existing->transaction_status,
                            'transaction_date' => $line['transaction_date'] ?? $existing->transaction_date,
                            'merchant_identifier' => $line['merchant_identifier'] ?? $existing->merchant_identifier,
                            'fulfillment_channel' => $line['fulfillment_channel'] ?? $existing->fulfillment_channel,
                            'marketplace_name' => $line['marketplace_name'] ?? $existing->marketplace_name,
                            'currency' => $line['currency'] ?? $existing->currency,
                            'raw_data' => $line['raw_data'] ?? $existing->raw_data,
                        ]);
                        $stats['updated_lines'] = (int) ($stats['updated_lines'] ?? 0) + 1;
                    } else {
                        SettlementItem::create($this->withSettlementItemDefaults(array_merge([
                            'settlement_id' => $settlement->id,
                            'raw_data' => $line['raw_data'] ?? [],
                        ], $line)));
                        $stats['new_lines'] = (int) ($stats['new_lines'] ?? 0) + 1;
                    }

                    $amount = (float) ($line['amount'] ?? 0);
                    $stats['amount'] += $amount;
                    $bucket = $this->bucketByTransactionType((string) ($line['transaction_type'] ?? ''), $amount);
                    if ($bucket === 'order') {
                        $stats['orders']++;
                    } elseif ($bucket === 'refund') {
                        $stats['refunds']++;
                    } else {
                        $stats['fees']++;
                    }
                }
            }

            if ($settlement) {
                $settlement->update([
                    'total_amount' => $stats['amount'],
                    'status' => 'draft',
                ]);
            }

            DB::commit();

            return $stats;
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Settlement Import Error: '.$e->getMessage());
            throw $e;
        }
    }

    private function importAmazonSettlementXml(int $channelId, string $xmlText): array
    {
        $xml = simplexml_load_string($xmlText);
        if (! $xml || ! isset($xml->Message->SettlementReport)) {
            throw new \RuntimeException('Invalid Amazon settlement XML.');
        }

        $report = $xml->Message->SettlementReport;
        $settlementData = $report->SettlementData;
        $merchantIdentifier = $this->cleanMerchantId((string) ($xml->Header->MerchantIdentifier ?? ''));
        $reportId = (string) ($settlementData->AmazonSettlementID ?? '');
        if ($reportId === '') {
            throw new \RuntimeException('Missing AmazonSettlementID in XML file.');
        }

        $stats = [
            'total_rows' => 0,
            'orders' => 0,
            'refunds' => 0,
            'fees' => 0,
            'settlement_id' => null,
            'amount' => 0.0,
            'merchant_identifier' => $merchantIdentifier ?: null,
        ];

        DB::beginTransaction();
        try {
            $settlement = Settlement::where('report_id', $reportId)->first();
            if ($settlement) {
                $settlement->update([
                    'channel_id' => $channelId,
                    'start_date' => $this->parseDate((string) ($settlementData->StartDate ?? now())),
                    'end_date' => $this->parseDate((string) ($settlementData->EndDate ?? now())),
                    'status' => 'processing',
                    'merchant_identifier' => $merchantIdentifier ?: $settlement->merchant_identifier,
                ]);
                SettlementItem::where('settlement_id', $settlement->id)->delete();
            } else {
                $settlement = Settlement::create([
                    'channel_id' => $channelId,
                    'report_id' => $reportId,
                    'start_date' => $this->parseDate((string) ($settlementData->StartDate ?? now())),
                    'end_date' => $this->parseDate((string) ($settlementData->EndDate ?? now())),
                    'total_amount' => 0,
                    'status' => 'processing',
                    'merchant_identifier' => $merchantIdentifier ?: null,
                ]);
            }

            if ($merchantIdentifier && empty($settlement->merchant_identifier)) {
                $settlement->merchant_identifier = $merchantIdentifier;
                $settlement->save();
            }

            $stats['settlement_id'] = $settlement->id;

            foreach ($this->xmlList($report->Order ?? null) as $orderNode) {
                $this->consumeOrderNode($settlement, $orderNode, $merchantIdentifier, $stats);
            }

            foreach ($this->xmlList($report->Refund ?? null) as $refundNode) {
                $this->consumeRefundNode($settlement, $refundNode, $merchantIdentifier, $stats);
            }

            foreach ($this->xmlList($report->OtherTransaction ?? null) as $otherNode) {
                $this->consumeOtherTransactionNode($settlement, $otherNode, $merchantIdentifier, $stats);
            }

            foreach ($this->xmlList($report->AdvertisingTransactionDetails ?? null) as $adNode) {
                $this->consumeAdvertisingTransactionNode($settlement, $adNode, $merchantIdentifier, $stats);
            }

            $headerTotal = (float) ($settlementData->TotalAmount ?? 0);
            $settlement->update([
                'total_amount' => $headerTotal !== 0.0 ? $headerTotal : $stats['amount'],
                'status' => 'draft',
            ]);

            DB::commit();

            return $stats;
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Settlement XML Import Error: '.$e->getMessage());
            throw $e;
        }
    }

    private function consumeOrderNode(Settlement $settlement, \SimpleXMLElement $orderNode, string $merchantIdentifier, array &$stats): void
    {
        $orderId = (string) ($orderNode->AmazonOrderID ?? '');
        $marketplace = (string) ($orderNode->MarketplaceName ?? '');
        $fulfillment = $orderNode->Fulfillment;
        $fulfillmentChannel = (string) ($fulfillment->MerchantFulfillmentID ?? '');
        $postedDate = (string) ($fulfillment->PostedDate ?? '');

        foreach ($this->xmlList($fulfillment->Item ?? null) as $item) {
            $sku = (string) ($item->SKU ?? '');
            $qty = (int) ($item->Quantity ?? 0);

            foreach ($this->xmlList($item->ItemPrice->Component ?? null) as $component) {
                $amount = (float) ($component->Amount ?? 0);
                $this->createSettlementLine($settlement, [
                    'platform_order_id' => $orderId ?: null,
                    'transaction_type' => 'Order',
                    'transaction_status' => self::STATUS_RELEASED,
                    'sku' => $sku ?: null,
                    'description' => 'ItemPrice: '.(string) ($component->Type ?? 'Unknown'),
                    'amount' => $amount,
                    'fee_amount' => 0,
                    'quantity' => $qty,
                    'currency' => (string) ($component->Amount['currency'] ?? 'EGP'),
                    'transaction_date' => $this->parseDate($postedDate),
                    'merchant_identifier' => $merchantIdentifier ?: null,
                    'fulfillment_channel' => $fulfillmentChannel ?: null,
                    'marketplace_name' => $marketplace ?: null,
                    'raw_data' => ['source' => 'item_price_component'],
                ], $stats, 'Order');
            }

            foreach ($this->xmlList($item->ItemFees->Fee ?? null) as $fee) {
                $amount = (float) ($fee->Amount ?? 0);
                $this->createSettlementLine($settlement, [
                    'platform_order_id' => $orderId ?: null,
                    'transaction_type' => 'Order',
                    'transaction_status' => self::STATUS_RELEASED,
                    'sku' => $sku ?: null,
                    'description' => 'ItemFee: '.(string) ($fee->Type ?? 'Unknown'),
                    'amount' => $amount,
                    'fee_amount' => 0,
                    'quantity' => $qty,
                    'currency' => (string) ($fee->Amount['currency'] ?? 'EGP'),
                    'transaction_date' => $this->parseDate($postedDate),
                    'merchant_identifier' => $merchantIdentifier ?: null,
                    'fulfillment_channel' => $fulfillmentChannel ?: null,
                    'marketplace_name' => $marketplace ?: null,
                    'raw_data' => ['source' => 'item_fee'],
                ], $stats, 'Fee');
            }

            foreach ($this->xmlList($item->Promotion ?? null) as $promotion) {
                $amount = (float) ($promotion->Amount ?? 0);
                $this->createSettlementLine($settlement, [
                    'platform_order_id' => $orderId ?: null,
                    'transaction_type' => 'Order',
                    'transaction_status' => self::STATUS_RELEASED,
                    'sku' => $sku ?: null,
                    'description' => 'Promotion: '.(string) ($promotion->Type ?? 'Unknown'),
                    'amount' => $amount,
                    'fee_amount' => 0,
                    'quantity' => $qty,
                    'currency' => (string) ($promotion->Amount['currency'] ?? 'EGP'),
                    'transaction_date' => $this->parseDate($postedDate),
                    'merchant_identifier' => $merchantIdentifier ?: null,
                    'fulfillment_channel' => $fulfillmentChannel ?: null,
                    'marketplace_name' => $marketplace ?: null,
                    'raw_data' => ['source' => 'promotion'],
                ], $stats, 'Fee');
            }
        }
    }

    private function consumeRefundNode(Settlement $settlement, \SimpleXMLElement $refundNode, string $merchantIdentifier, array &$stats): void
    {
        $orderId = (string) ($refundNode->AmazonOrderID ?? '');
        $marketplace = (string) ($refundNode->MarketplaceName ?? '');
        $fulfillment = $refundNode->Fulfillment;
        $fulfillmentChannel = (string) ($fulfillment->MerchantFulfillmentID ?? '');
        $postedDate = (string) ($fulfillment->PostedDate ?? '');

        foreach ($this->xmlList($fulfillment->AdjustedItem ?? null) as $item) {
            $sku = (string) ($item->SKU ?? '');
            $qty = (int) ($item->Quantity ?? 0);

            foreach ($this->xmlList($item->ItemPriceAdjustments->Component ?? null) as $component) {
                $amount = (float) ($component->Amount ?? 0);
                $this->createSettlementLine($settlement, [
                    'platform_order_id' => $orderId ?: null,
                    'transaction_type' => 'Refund',
                    'transaction_status' => self::STATUS_RELEASED,
                    'sku' => $sku ?: null,
                    'description' => 'RefundPrice: '.(string) ($component->Type ?? 'Unknown'),
                    'amount' => $amount,
                    'fee_amount' => 0,
                    'quantity' => $qty,
                    'currency' => (string) ($component->Amount['currency'] ?? 'EGP'),
                    'transaction_date' => $this->parseDate($postedDate),
                    'merchant_identifier' => $merchantIdentifier ?: null,
                    'fulfillment_channel' => $fulfillmentChannel ?: null,
                    'marketplace_name' => $marketplace ?: null,
                    'raw_data' => ['source' => 'refund_price_component'],
                ], $stats, 'Refund');
            }

            foreach ($this->xmlList($item->ItemFeeAdjustments->Fee ?? null) as $fee) {
                $amount = (float) ($fee->Amount ?? 0);
                $this->createSettlementLine($settlement, [
                    'platform_order_id' => $orderId ?: null,
                    'transaction_type' => 'Refund',
                    'transaction_status' => self::STATUS_RELEASED,
                    'sku' => $sku ?: null,
                    'description' => 'RefundFee: '.(string) ($fee->Type ?? 'Unknown'),
                    'amount' => $amount,
                    'fee_amount' => 0,
                    'quantity' => $qty,
                    'currency' => (string) ($fee->Amount['currency'] ?? 'EGP'),
                    'transaction_date' => $this->parseDate($postedDate),
                    'merchant_identifier' => $merchantIdentifier ?: null,
                    'fulfillment_channel' => $fulfillmentChannel ?: null,
                    'marketplace_name' => $marketplace ?: null,
                    'raw_data' => ['source' => 'refund_fee'],
                ], $stats, 'Fee');
            }

            foreach ($this->xmlList($item->PromotionAdjustment ?? null) as $promotion) {
                $amount = (float) ($promotion->Amount ?? 0);
                $this->createSettlementLine($settlement, [
                    'platform_order_id' => $orderId ?: null,
                    'transaction_type' => 'Refund',
                    'transaction_status' => self::STATUS_RELEASED,
                    'sku' => $sku ?: null,
                    'description' => 'RefundPromotion: '.(string) ($promotion->Type ?? 'Unknown'),
                    'amount' => $amount,
                    'fee_amount' => 0,
                    'quantity' => $qty,
                    'currency' => (string) ($promotion->Amount['currency'] ?? 'EGP'),
                    'transaction_date' => $this->parseDate($postedDate),
                    'merchant_identifier' => $merchantIdentifier ?: null,
                    'fulfillment_channel' => $fulfillmentChannel ?: null,
                    'marketplace_name' => $marketplace ?: null,
                    'raw_data' => ['source' => 'refund_promotion'],
                ], $stats, 'Fee');
            }
        }
    }

    private function consumeOtherTransactionNode(Settlement $settlement, \SimpleXMLElement $node, string $merchantIdentifier, array &$stats): void
    {
        $amount = (float) ($node->Amount ?? 0);
        $orderId = (string) ($node->AmazonOrderID ?? null);
        $postedDate = (string) ($node->PostedDate ?? '');
        $fulfillmentChannel = (string) ($node->MerchantFulfillmentID ?? '');
        $marketplace = (string) ($node->MarketplaceName ?? '');
        $type = (string) ($node->TransactionType ?? 'Other');

        $sku = null;
        $itemPayloads = [];
        foreach ($this->xmlList($node->OtherTransactionItem ?? null) as $oti) {
            $itemSku = trim((string) ($oti->SKU ?? ''));
            $qty = (int) ($oti->Quantity ?? 0);
            $itemAmt = (float) ($oti->Amount ?? 0);
            if ($itemSku !== '') {
                $itemPayloads[] = [
                    'sku' => $itemSku,
                    'quantity' => $qty,
                    'amount' => $itemAmt,
                ];
                if ($sku === null) {
                    $sku = $itemSku;
                }
            }
        }

        $payload = [
            'platform_order_id' => $orderId ?: null,
            'transaction_type' => $this->normalizeTransactionType($type !== '' && $type !== 'Other' ? $type : 'OtherTransaction'),
            'transaction_status' => self::STATUS_RELEASED,
            'sku' => $sku,
            'description' => 'OtherTransaction: '.$type,
            'amount' => $amount,
            'fee_amount' => $amount,
            'quantity' => count($itemPayloads) > 0 ? max(1, (int) ($itemPayloads[0]['quantity'] ?? 1)) : 0,
            'currency' => (string) ($node->Amount['currency'] ?? 'EGP'),
            'transaction_date' => $this->parseDate($postedDate),
            'merchant_identifier' => $merchantIdentifier ?: null,
            'fulfillment_channel' => $fulfillmentChannel ?: null,
            'marketplace_name' => $marketplace ?: null,
            'raw_data' => array_filter([
                'source' => 'other_transaction',
                'amazon_transaction_type' => $type,
                'other_transaction_items' => $itemPayloads !== [] ? $itemPayloads : null,
            ]),
        ];
        if ($orderId === '') {
            $payload['reconciliation_status'] = 'account_level';
        }

        $this->createSettlementLine($settlement, $payload, $stats, 'Fee');
    }

    private function consumeAdvertisingTransactionNode(Settlement $settlement, \SimpleXMLElement $node, string $merchantIdentifier, array &$stats): void
    {
        $type = (string) ($node->TransactionType ?? 'Cost of Advertising');
        $postedDate = (string) ($node->PostedDate ?? '');
        $invoiceId = trim((string) ($node->InvoiceId ?? ''));
        $amount = (float) ($node->TransactionAmount ?? $node->BaseAmount ?? 0);
        $currency = (string) (($node->TransactionAmount ?? $node->BaseAmount)['currency'] ?? 'EGP');

        $this->createSettlementLine($settlement, [
            'platform_order_id' => null,
            'transaction_type' => 'Advertising',
            'transaction_status' => self::STATUS_RELEASED,
            'description' => 'Advertising: '.$type,
            'amount' => $amount,
            'fee_amount' => $amount,
            'quantity' => 0,
            'currency' => $currency !== '' ? $currency : 'EGP',
            'transaction_date' => $this->parseDate($postedDate),
            'merchant_identifier' => $merchantIdentifier ?: null,
            'raw_data' => array_filter([
                'source' => 'advertising',
                'amazon_transaction_type' => $type,
                'invoice_id' => $invoiceId !== '' ? $invoiceId : null,
                'base_amount' => isset($node->BaseAmount) ? (float) $node->BaseAmount : null,
                'tax_amount' => isset($node->TaxAmount) ? (float) $node->TaxAmount : null,
            ]),
            'reconciliation_status' => 'account_level',
        ], $stats, 'Fee');
    }

    private function createSettlementLine(Settlement $settlement, array $payload, array &$stats, string $bucket): void
    {
        SettlementItem::create($this->withSettlementItemDefaults(array_merge(['settlement_id' => $settlement->id], $payload)));
        $stats['total_rows']++;
        $stats['amount'] += (float) ($payload['amount'] ?? 0);

        if ($bucket === 'Order') {
            $stats['orders']++;
        } elseif ($bucket === 'Refund') {
            $stats['refunds']++;
        } else {
            $stats['fees']++;
        }
    }

    private function cleanMerchantId(string $raw): string
    {
        return trim(str_replace("'", '', $raw));
    }

    private function extractMerchantIdentifierFromXml(string $xmlText): ?string
    {
        try {
            $xml = simplexml_load_string($xmlText);
            if (! $xml) {
                return null;
            }
            $raw = (string) ($xml->Header->MerchantIdentifier ?? '');
            $clean = $this->cleanMerchantId($raw);

            return $clean !== '' ? $clean : null;
        } catch (\Throwable) {
            return null;
        }
    }

    private function resolveChannelIdByMerchantIdentifier(?string $merchantIdentifier, int $fallbackChannelId): int
    {
        $merchantIdentifier = $this->cleanMerchantId((string) $merchantIdentifier);
        if ($merchantIdentifier === '') {
            return $fallbackChannelId;
        }

        $matched = Channel::query()
            ->where('merchant_identifier', $merchantIdentifier)
            ->where('is_active', true)
            ->first();

        return $matched ? (int) $matched->id : $fallbackChannelId;
    }

    /**
     * Match line items to internal orders.
     */
    public function reconcile(Settlement $settlement): int
    {
        $items = SettlementItem::where('settlement_id', $settlement->id)->get();

        $matchedCount = 0;
        $matchedByOrder = [];

        foreach ($items as $item) {
            if ($this->settlementItemIsAccountLevel($item)) {
                $item->update([
                    'inventory_order_id' => null,
                    'reconciliation_status' => 'account_level',
                ]);

                continue;
            }

            $preferredChannelIds = $this->resolveCandidateChannelIdsForSettlementItem($settlement, $item);
            $orderIdCandidates = array_values(array_unique(array_merge(
                $this->extractOrderIdCandidates((string) ($item->platform_order_id ?? '')),
                $this->extractOrderIdCandidatesFromItemRawData($item)
            )));

            $order = null;
            if (! empty($preferredChannelIds) && ! empty($orderIdCandidates)) {
                $order = InventoryOrder::whereIn('platform_order_id', $orderIdCandidates)
                    ->whereIn('channel_id', $preferredChannelIds)
                    ->orderByRaw('CASE WHEN channel_id = ? THEN 0 ELSE 1 END', [$preferredChannelIds[0]])
                    ->first();
            }

            if (! $order) {
                // Fallback: normalize stored `platform_order_id` (trim/strip quotes/whitespace + normalize unicode dashes)
                // so settlement imports match orders even when the saved key contains hidden chars.
                $normalizedCandidates = array_values(array_unique(array_filter(array_map(
                    fn ($v) => $this->normalizeImportedPlatformOrderId((string) $v),
                    $orderIdCandidates
                ))));
                if (! empty($normalizedCandidates)) {
                    // Keep expression compatible with older MySQL/MariaDB versions (no REGEXP_REPLACE).
                    // Normalize:
                    // - trim + remove quotes
                    // - remove whitespace (space/tab/cr/lf)
                    // - convert common unicode dash variants to '-'
                    // MySQL-safe normalization: strip quotes + whitespace only.
                    // (Unicode dash folding is already handled in PHP candidates; keeping SQL simple avoids
                    // syntax/charset edge-cases on older MySQL/MariaDB setups.)
                    $charFn = DB::getDriverName() === 'pgsql' ? 'CHR' : 'CHAR';
                    $oidNormSql = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(platform_order_id,'')), '\"', ''), {$charFn}(39), ''), ' ', ''), {$charFn}(9), ''), {$charFn}(10), ''), {$charFn}(13), '')";
                    $placeholders = implode(',', array_fill(0, count($normalizedCandidates), '?'));

                    $normQuery = InventoryOrder::query()
                        ->whereRaw("{$oidNormSql} IN ({$placeholders})", $normalizedCandidates);

                    if (! empty($preferredChannelIds)) {
                        // Try preferred channels first, but do not block matching completely if the order
                        // was imported under the wrong channel (common after migrations / channel remaps).
                        $order = (clone $normQuery)
                            ->whereIn('channel_id', $preferredChannelIds)
                            ->orderByRaw('CASE WHEN channel_id = ? THEN 0 ELSE 1 END', [$preferredChannelIds[0]])
                            ->first();
                        if ($order) {
                            // Found under preferred channel; skip the wide lookup below.
                            // (Keeps deterministic channel preference behavior.)
                            // no-op
                        } else {
                            $order = $normQuery->first();
                        }
                    } else {
                        $order = $normQuery->first();
                    }
                }
            }

            if (! $order) {
                // Last fallback: same order id on any channel for this user.
                if (! empty($orderIdCandidates)) {
                    $order = InventoryOrder::whereIn('platform_order_id', $orderIdCandidates)->first();
                }
            }

            if ($order) {
                $item->update([
                    'inventory_order_id' => $order->id,
                    'reconciliation_status' => 'matched',
                ]);
                $matchedByOrder[(int) $order->id][] = $item;
                $matchedCount++;
            } else {
                $item->update(['reconciliation_status' => 'unreconciled']);
            }
        }

        if (! empty($matchedByOrder)) {
            foreach ($matchedByOrder as $orderId => $itemsFromThisSettlement) {
                $order = InventoryOrder::find($orderId);
                foreach ($itemsFromThisSettlement as $item) {
                    if ($this->isSettlementClaimMarkerLine($item) && $order) {
                        $this->syncReturnFromSettlementItem($settlement, $item, $order);
                    }
                    if ($order && $this->isReversalReimbursementSettlementLine($item)) {
                        $this->markReturnsReimbursementPaidFromReversal($settlement, $item, $order);
                    }
                }

                // Status must reflect *all* matched settlement lines for this order across every uploaded sheet.
                // Amazon repeats order ids across cycles with fee-only rows; using only the current file wrongly
                // cleared older "charged/settled" states (e.g. Feb orders still showing pending after April import).
                $allMatchedForOrder = SettlementItem::query()
                    ->where('inventory_order_id', $orderId)
                    ->where('reconciliation_status', 'matched')
                    ->get();

                $hasProductRefund = false;
                $hasNonProductRefund = false;
                $hasOrderRevenue = false;
                foreach ($allMatchedForOrder as $item) {
                    if ($this->isReleasedTransaction($item) && $this->isRefundLine($item)) {
                        if ($this->isProductRefundSettlementLine($item)) {
                            $hasProductRefund = true;
                        } else {
                            $hasNonProductRefund = true;
                        }
                    }
                    if ($this->isOrderRevenueLine($item) && $this->isReleasedTransaction($item)) {
                        $hasOrderRevenue = true;
                    }
                }

                InventoryOrder::where('id', $orderId)->update([
                    // Do not use net amount here; fees/shipping lines are often negative and can flip status incorrectly.
                    'financial_status' => $this->resolveOrderFinancialStatus($hasOrderRevenue, $hasProductRefund, $hasNonProductRefund),
                    // Only released product-payment lines mark order as settled.
                    // Fees/service charges alone must NOT close settlement.
                    'settlement_status' => $hasOrderRevenue ? 'settled' : 'pending',
                ]);

                $this->reconcileSettlementReturnsForOrder((int) $orderId, false);
            }
        }

        $settlement->update([
            // Reconcile action finished even if some rows were not matched to internal orders.
            'status' => 'reconciled',
        ]);

        return $matchedCount;
    }

    /**
     * Settlement lines that are not tied to a specific sales order (ads, reserves, seller incentives, etc.).
     */
    private function settlementItemIsAccountLevel(SettlementItem $item): bool
    {
        if (strtolower(trim((string) ($item->reconciliation_status ?? ''))) === 'account_level') {
            return true;
        }

        $type = strtolower(trim((string) ($item->transaction_type ?? '')));
        // Noon payment disbursements (bank transfer rows) and balance_transfer are account-level.
        if (in_array($type, ['advertising', 'accountfee', 'servicefee', 'subscriptionfee', 'couponredemptionfee', 'payment', 'balance_transfer', 'payment disbursal'], true)
            || str_contains($type, 'advertising')
            || str_contains($type, 'payment disbursal')
            || str_contains($type, 'balance_transfer')
            || str_contains($type, 'balance transfer')) {
            return true;
        }

        $raw = is_array($item->raw_data) ? $item->raw_data : [];
        $source = strtolower(trim((string) ($raw['source'] ?? '')));
        if (in_array($source, ['advertising', 'account_adjustment', 'seller_reward'], true)) {
            return true;
        }

        $desc = strtolower(trim((string) ($item->description ?? '')));
        if (str_starts_with($desc, 'advertising:')) {
            return true;
        }

        $orderIdCandidates = array_values(array_unique(array_merge(
            $this->extractOrderIdCandidates((string) ($item->platform_order_id ?? '')),
            $this->extractOrderIdCandidatesFromItemRawData($item)
        )));

        if ($orderIdCandidates === []) {
            return true;
        }

        if (str_starts_with($desc, 'othertransaction:') && trim((string) ($item->platform_order_id ?? '')) === '') {
            return true;
        }

        return false;
    }

    /**
     * @return array{
     *   matched_lines:int,
     *   unmatched_lines:int,
     *   unmatched_orders:int,
     *   account_level_lines:int,
     *   unmatched_order_ids:list<string>,
     *   summary_message_ar:string,
     *   summary_message_en:string
     * }
     */
    public function buildReconciliationSummary(Settlement $settlement): array
    {
        $settlementId = (int) $settlement->id;

        $accountLevelLines = SettlementItem::query()
            ->where('settlement_id', $settlementId)
            ->where('reconciliation_status', 'account_level')
            ->count();

        $orderLinkedQuery = SettlementItem::query()
            ->where('settlement_id', $settlementId)
            ->whereNotNull('platform_order_id')
            ->where('platform_order_id', '!=', '');

        $matchedLines = (clone $orderLinkedQuery)
            ->where('reconciliation_status', 'matched')
            ->count();

        $unmatchedQuery = (clone $orderLinkedQuery)
            ->where('reconciliation_status', 'unreconciled');

        $unmatchedLines = (clone $unmatchedQuery)->count();

        $unmatchedOrders = (int) (clone $unmatchedQuery)
            ->distinct('platform_order_id')
            ->count('platform_order_id');

        $unmatchedOrderIds = (clone $unmatchedQuery)
            ->select('platform_order_id')
            ->distinct()
            ->orderBy('platform_order_id')
            ->limit(10)
            ->pluck('platform_order_id')
            ->map(fn ($id) => (string) $id)
            ->filter()
            ->values()
            ->all();

        $summaryAr = "تمت التسوية. أسطر مربوطة بطلبات: {$matchedLines}";
        $summaryEn = "Reconciled. Order-linked lines matched: {$matchedLines}";
        if ($accountLevelLines > 0) {
            $summaryAr .= " | بنود حساب (إعلانات/رسوم بدون طلب): {$accountLevelLines}";
            $summaryEn .= " | Account-level lines (ads/fees without order): {$accountLevelLines}";
        }
        if ($unmatchedOrders > 0) {
            $summaryAr .= " | طلبات في الشيت غير موجودة في النظام: {$unmatchedOrders} ({$unmatchedLines} سطر)";
            $summaryEn .= " | Orders in sheet missing from system: {$unmatchedOrders} ({$unmatchedLines} lines)";
        }

        return [
            'matched_lines' => $matchedLines,
            'unmatched_lines' => $unmatchedLines,
            'unmatched_orders' => $unmatchedOrders,
            'account_level_lines' => $accountLevelLines,
            'unmatched_order_ids' => $unmatchedOrderIds,
            'summary_message_ar' => $summaryAr,
            'summary_message_en' => $summaryEn,
        ];
    }

    /**
     * Recompute order statuses after settlement changes (delete/reimport).
     */
    public function recomputeOrderFinancialStatuses(int $orderId): void
    {
        if ($orderId <= 0) {
            return;
        }

        $order = InventoryOrder::query()->where('id', $orderId)->first();
        if (! $order) {
            return;
        }

        $allMatchedForOrder = SettlementItem::query()
            ->where('inventory_order_id', $orderId)
            ->where('reconciliation_status', 'matched')
            ->get();

        $hasProductRefund = false;
        $hasNonProductRefund = false;
        $hasOrderRevenue = false;
        foreach ($allMatchedForOrder as $item) {
            if ($this->isReleasedTransaction($item) && $this->isRefundLine($item)) {
                if ($this->isProductRefundSettlementLine($item)) {
                    $hasProductRefund = true;
                } else {
                    $hasNonProductRefund = true;
                }
            }
            if ($this->isOrderRevenueLine($item) && $this->isReleasedTransaction($item)) {
                $hasOrderRevenue = true;
            }
        }

        InventoryOrder::query()
            ->where('id', $orderId)
            ->update([
                'financial_status' => $this->resolveOrderFinancialStatus($hasOrderRevenue, $hasProductRefund, $hasNonProductRefund),
                'settlement_status' => $hasOrderRevenue ? 'settled' : 'pending',
            ]);
    }

    /**
     * When the order already has product settlement revenue, keep "charged" so the UI shows pending/settled flow.
     * Otherwise distinguish product refunds from shipping/fee-only adjustments.
     */
    private function resolveOrderFinancialStatus(bool $hasOrderRevenue, bool $hasProductRefund, bool $hasNonProductRefund): string
    {
        if ($hasOrderRevenue) {
            return 'charged';
        }
        if ($hasProductRefund) {
            return 'refunded';
        }
        if ($hasNonProductRefund) {
            return 'shipping_adjustment';
        }

        return 'pending';
    }

    private function isRefundLine(SettlementItem $item): bool
    {
        $type = strtolower((string) ($item->transaction_type ?? ''));
        $desc = strtolower(trim((string) ($item->description ?? '')));
        $amount = (float) ($item->amount ?? 0);

        if (str_contains($type, 'refund')) {
            return true;
        }

        if ($desc !== '' && preg_match('/\brefundprice:|\brefundfee:|\brefundpromotion:/i', $desc)) {
            return true;
        }

        if (str_contains($desc, 'refund')) {
            return true;
        }

        if (str_contains($desc, 'return')) {
            return true;
        }

        if ($amount >= 0) {
            return false;
        }

        // Negative amounts on normal Order catalog lines (fees, shipping chargebacks) are NOT customer refunds.
        if ($this->isNegativeOrderCatalogLine($item)) {
            return false;
        }

        return true;
    }

    /**
     * Order settlement rows for ItemPrice / ItemFee / Promotion (sales cycle), not Refund blocks.
     */
    private function isNegativeOrderCatalogLine(SettlementItem $item): bool
    {
        $type = strtolower((string) ($item->transaction_type ?? ''));
        $desc = strtolower(trim((string) ($item->description ?? '')));
        if (! str_contains($type, 'order')) {
            return false;
        }

        return (bool) preg_match('/^(itemprice|itemfee|promotion):/i', $desc);
    }

    /**
     * Hidden claim-tracking rows from payment sheet (Principal / product refund only — not shipping).
     * Shown in Claims Hub, excluded from the physical returns table.
     */
    public function settlementLineQualifiesForInventoryReturn(SettlementItem $item): bool
    {
        return $this->isSettlementClaimMarkerLine($item);
    }

    /**
     * Product refund on payment sheet — includes deferred rows for claim tracking before Amazon releases funds.
     */
    private function isSettlementClaimMarkerLine(SettlementItem $item): bool
    {
        if (! $this->isRefundLine($item)) {
            return false;
        }

        $rawDesc = (string) ($item->description ?? '');
        $desc = strtolower(trim($rawDesc));
        $amount = abs((float) ($item->amount ?? 0));
        if ($amount <= 0.00001) {
            return false;
        }

        if ($this->isNonProductRefundSettlementDescription($rawDesc, $desc)) {
            return false;
        }

        if (preg_match('/refundprice:\s*principal\b/i', $rawDesc)) {
            return true;
        }

        if (preg_match('/^principal$/i', trim($rawDesc))) {
            return true;
        }

        if ($this->hasActualProductReturnSignal($desc, $rawDesc)) {
            return true;
        }

        $type = strtolower((string) ($item->transaction_type ?? ''));
        $isRefundType = str_contains($type, 'refund')
            || str_contains($type, 'return')
            || str_contains($type, 'استرداد')
            || str_contains($type, 'استرجاع');
        $hasSku = trim((string) ($item->sku ?? '')) !== '';

        return $isRefundType && $hasSku && (float) ($item->amount ?? 0) < 0;
    }

    /**
     * Void settlement-generated return rows that no longer match any qualifying settlement line.
     *
     * @return array{kept: int, voided: int, skipped_fba_sheet: int, skipped_completed: int}
     */
    public function reconcileSettlementReturnsForOrder(int $orderId, bool $dryRun = false): array
    {
        $stats = ['kept' => 0, 'voided' => 0, 'skipped_fba_sheet' => 0, 'skipped_completed' => 0];

        if ($orderId <= 0) {
            return $stats;
        }

        $order = InventoryOrder::query()->find($orderId);
        if (! $order) {
            return $stats;
        }

        $expectedPlatformReturnIds = $this->expectedSettlementReturnPlatformIdsForOrder($order);

        $returns = InventoryReturn::query()
            ->where('inventory_order_id', $orderId)
            ->where(function ($q) {
                $q->where('external_status', 'refund_from_payment_sheet')
                    ->orWhere('platform_return_id', 'like', 'STL-%');
            })
            ->where(function ($q) {
                $q->whereNull('status')->orWhere('status', '!=', 'void');
            })
            ->get();

        foreach ($returns as $return) {
            if ($this->returnHasFbaReturnsSheetEvidence($return)) {
                $stats['skipped_fba_sheet']++;

                continue;
            }

            $platformId = (string) ($return->platform_return_id ?? '');
            $isExpected = $platformId !== '' && isset($expectedPlatformReturnIds[$platformId]);

            if ((string) ($return->status ?? '') === 'completed') {
                if ($isExpected) {
                    $stats['kept']++;
                } else {
                    $stats['skipped_completed']++;
                }

                continue;
            }

            if ($isExpected) {
                $stats['kept']++;

                continue;
            }

            if (! $dryRun) {
                $meta = is_array($return->metadata) ? $return->metadata : [];
                $meta['void_reason'] = 'shipping_only_or_non_return';
                $meta['voided_at'] = now()->toIso8601String();
                $return->update([
                    'status' => 'void',
                    'metadata' => $meta,
                ]);
            }

            $stats['voided']++;
        }

        return $stats;
    }

    /**
     * @return array<string, true>
     */
    private function expectedSettlementReturnPlatformIdsForOrder(InventoryOrder $order): array
    {
        $expected = [];

        $matchedItems = SettlementItem::query()
            ->where('inventory_order_id', $order->id)
            ->where('reconciliation_status', 'matched')
            ->get();

        foreach ($matchedItems as $item) {
            if (! $this->isSettlementClaimMarkerLine($item)) {
                continue;
            }

            $settlement = Settlement::query()->find($item->settlement_id);
            if (! $settlement) {
                continue;
            }

            $expected[$this->settlementReturnPlatformId($settlement, $order, $item)] = true;
        }

        return $expected;
    }

    private function settlementReturnPlatformId(Settlement $settlement, InventoryOrder $order, SettlementItem $item): string
    {
        $sku = trim((string) ($item->sku ?? ''));
        $raw = is_array($item->raw_data) ? $item->raw_data : [];
        $lineSeq = (string) ($raw['import_line_seq'] ?? '');
        $fingerprint = implode('|', [
            $sku !== '' ? $sku : '-',
            (string) ($item->description ?? ''),
            number_format(abs((float) ($item->amount ?? 0)), 6, '.', ''),
            number_format((float) ($item->fee_amount ?? 0), 6, '.', ''),
            (string) max(0, (int) ($item->quantity ?? 0)),
            $item->transaction_date ? (string) $item->transaction_date : '-',
            $lineSeq !== '' ? 'seq:'.$lineSeq : '',
            $item->id ? 'item:'.$item->id : '',
        ]);

        return 'STL-'.$settlement->id.'-'.$order->platform_order_id.'-'.md5($fingerprint);
    }

    /**
     * Creates inventory return rows only for product principal refunds — not shipping-only,
     * fee reversals, or promotions from the settlement sheet.
     */
    private function isProductRefundSettlementLine(SettlementItem $item): bool
    {
        if (! $this->isReleasedTransaction($item)) {
            return false;
        }

        return $this->isSettlementClaimMarkerLine($item);
    }

    private function isNonProductRefundSettlementDescription(string $rawDesc, string $descLower): bool
    {
        if (preg_match('/refundprice:\s*(shipping|tax|giftwrap|gift\s*wrap|shippingtax|shipping\s*tax)\b/i', $rawDesc)) {
            return true;
        }

        if (preg_match('/refundfee:/i', $rawDesc) || preg_match('/refundpromotion:/i', $rawDesc)) {
            return true;
        }

        if ($this->looksLikeShippingOnlyRefundDescription($descLower)) {
            return true;
        }

        if (preg_match('/^(shipping|tax|giftwrap|gift\s*wrap|shippingtax|shipping\s*tax)$/i', trim($rawDesc))) {
            return true;
        }

        return false;
    }

    private function hasActualProductReturnSignal(string $descLower, string $rawDesc): bool
    {
        $returnKeywords = ['refund', 'return', 'استرداد', 'مرتجع', 'استرجاع'];
        $productHints = ['principal', 'product', 'item price', 'سعر المنتج', 'item-price', 'merchandise', 'itemprice', 'منتج'];

        $hasReturnKeyword = false;
        foreach ($returnKeywords as $keyword) {
            if (str_contains($descLower, strtolower($keyword)) || str_contains($rawDesc, $keyword)) {
                $hasReturnKeyword = true;
                break;
            }
        }

        if (! $hasReturnKeyword) {
            return false;
        }

        foreach ($productHints as $hint) {
            if (str_contains($descLower, $hint)) {
                return true;
            }
        }

        return false;
    }

    private function looksLikeShippingOnlyRefundDescription(string $descLower): bool
    {
        if ($descLower === '') {
            return false;
        }

        $shippingHints = ['shipping', 'شحن', 'postage', 'delivery', 'chargeback', 'postageback', 'fba shipping'];
        $productHints = ['principal', 'product', 'item price', 'سعر المنتج', 'item-price', 'merchandise'];

        $hasShip = false;
        foreach ($shippingHints as $h) {
            if (str_contains($descLower, $h)) {
                $hasShip = true;
                break;
            }
        }
        if (! $hasShip) {
            return false;
        }

        foreach ($productHints as $h) {
            if (str_contains($descLower, $h)) {
                return false;
            }
        }

        return true;
    }

    private function isOrderRevenueLine(SettlementItem $item): bool
    {
        $type = strtolower((string) ($item->transaction_type ?? ''));
        $desc = strtolower((string) ($item->description ?? ''));
        $amount = (float) ($item->amount ?? 0);

        if ($amount <= 0) {
            return false;
        }
        if (str_contains($type, 'refund') || str_contains($desc, 'refund') || str_contains($desc, 'return')) {
            return false;
        }
        if (
            str_contains($type, 'fee')
            || str_contains($type, 'commission')
            || str_contains($type, 'shipping')
            || str_contains($type, 'service')
            || str_contains($type, 'storage')
            || str_contains($type, 'handling')
            || str_contains($type, 'رسوم')
            || str_contains($type, 'عمولة')
            || str_contains($type, 'شحن')
            || str_contains($type, 'خدمة')
            || str_contains($type, 'تخزين')
            || str_contains($desc, 'fee')
            || str_contains($desc, 'commission')
            || str_contains($desc, 'chargeback')
            || str_contains($desc, 'shipping')
            || str_contains($desc, 'fba')
            || str_contains($desc, 'cod')
        ) {
            return false;
        }

        // Noon / item-level finance exports: types like "ItemPrice", "Item Charges", "item price" (not caught by "order").
        $descCompact = str_replace([' ', "\t", '_', '-'], '', $desc);
        $isItemProductLine = (str_contains($type, 'item') && (str_contains($type, 'price') || str_contains($type, 'charg') || str_contains($type, 'sale')))
            || (bool) preg_match('/\bitem\s*(price|charges?|payment)\b/i', (string) ($item->transaction_type ?? '').' '.$desc)
            || str_contains($descCompact, 'itemprice')
            || str_contains($desc, 'product payment')
            || str_contains($desc, 'order payment')
            || str_contains($type, 'مبلغ المنتج')
            || str_contains($desc, 'مبلغ المنتج');

        // Noon finance: transaction_type = "order" or "order_update" with positive Net Proceeds = revenue.
        $isNoonOrderRevenue = (str_contains($type, 'order') && ! str_contains($type, 'non')) && $amount > 0;

        // Product payment indicators only.
        return $isNoonOrderRevenue
            || str_contains($type, 'payment')
            || str_contains($type, 'مبلغ الطلب')
            || str_contains($desc, 'itemprice')
            || $isItemProductLine;
    }

    private function isReleasedTransaction(SettlementItem $item): bool
    {
        $status = strtolower(trim((string) ($item->transaction_status ?? self::STATUS_RELEASED)));

        return ! in_array($status, [self::STATUS_DEFERRED, self::STATUS_PENDING, self::STATUS_REVERSED], true);
    }

    private function extractOrderIdCandidates(string $rawOrderId): array
    {
        $raw = trim((string) $rawOrderId);
        if ($raw === '') {
            return [];
        }

        $candidates = [];
        $candidates[] = $raw;
        $candidates[] = trim($raw, " \t\n\r\0\x0B'\"");
        $candidates[] = preg_replace('/\s+/', '', $raw);
        $norm = $this->normalizeImportedPlatformOrderId($raw);
        if ($norm !== null) {
            $candidates[] = $norm;
        }

        if (preg_match('/\b\d{3}-\d{7}-\d{7}\b/', $raw, $m)) {
            $candidates[] = $m[0];
        }

        return array_values(array_unique(array_filter(array_map(function ($v) {
            $val = trim((string) $v);

            return $val === '' ? null : $val;
        }, $candidates))));
    }

    private function extractOrderIdCandidatesFromItemRawData(SettlementItem $item): array
    {
        $raw = $item->raw_data;
        if (! is_array($raw)) {
            return [];
        }

        $keys = [
            'platform_order_id',
            'order-id',
            'order id',
            'order_id',
            'amazon-order-id',
            'amazon order id',
            'merchant-order-id',
            'merchant order id',
            'رقم الطلب من أمازون',
            'رقم الطلب',
            'رقم طلب التاجر',
            'order number',
            // Noon sales + finance (item-level) exports
            'item_nr',
            'item nr',
            'item-nr',
            'item id',
            'item_id',
        ];

        $collected = [];
        foreach ($keys as $key) {
            if (array_key_exists($key, $raw) && $raw[$key] !== null && trim((string) $raw[$key]) !== '') {
                $collected = array_merge($collected, $this->extractOrderIdCandidates((string) $raw[$key]));
            }
        }

        return array_values(array_unique($collected));
    }

    /**
     * Resolve candidate channels for this settlement line.
     * Handles Amazon account split (FBA / Merchant) based on fulfillment channel.
     */
    private function resolveCandidateChannelIdsForSettlementItem(Settlement $settlement, SettlementItem $item): array
    {
        $channels = Channel::query()->get();
        if ($channels->isEmpty()) {
            return [(int) $settlement->channel_id];
        }

        $baseChannel = $channels->firstWhere('id', (int) $settlement->channel_id);

        // Prefer merchant identifier when present on the item.
        $lineMerchantId = $this->cleanMerchantId((string) ($item->merchant_identifier ?? ''));
        if ($lineMerchantId !== '') {
            $byMerchant = $channels->first(function ($c) use ($lineMerchantId) {
                return $this->cleanMerchantId((string) ($c->merchant_identifier ?? '')) === $lineMerchantId;
            });
            if ($byMerchant) {
                $baseChannel = $byMerchant;
            }
        }

        if (! $baseChannel) {
            return [(int) $settlement->channel_id];
        }

        $preferredId = (int) $baseChannel->id;
        $fulfillment = strtolower(trim((string) ($item->fulfillment_channel ?? '')));

        if ($fulfillment !== '') {
            $targetType = null;
            if ($this->looksLikeMerchantFulfillment($fulfillment)) {
                $targetType = 'merchant';
            } elseif ($this->looksLikeFbaFulfillment($fulfillment)) {
                $targetType = 'fba';
            }

            if ($targetType) {
                $sibling = $this->findSiblingChannelByType($baseChannel, $channels, $targetType);
                if ($sibling) {
                    $preferredId = (int) $sibling->id;
                }
            }
        }

        $ordered = [$preferredId];
        if ((int) $baseChannel->id !== $preferredId) {
            $ordered[] = (int) $baseChannel->id;
        }
        if (! in_array((int) $settlement->channel_id, $ordered, true)) {
            $ordered[] = (int) $settlement->channel_id;
        }

        return array_values(array_unique($ordered));
    }

    private function looksLikeMerchantFulfillment(string $fulfillment): bool
    {
        return str_contains($fulfillment, 'merchant')
            || str_contains($fulfillment, 'mfn')
            || str_contains($fulfillment, 'fbm')
            || str_contains($fulfillment, 'تاجر');
    }

    private function looksLikeFbaFulfillment(string $fulfillment): bool
    {
        return str_contains($fulfillment, 'amazon')
            || str_contains($fulfillment, 'afn')
            || str_contains($fulfillment, 'fba');
    }

    private function findSiblingChannelByType(Channel $baseChannel, $channels, string $targetType): ?Channel
    {
        $baseName = strtolower((string) $baseChannel->name);
        $baseSlug = strtolower((string) $baseChannel->slug);
        $baseMerchant = $this->cleanMerchantId((string) ($baseChannel->merchant_identifier ?? ''));
        $familyKey = preg_replace('/\b(fba|merchant|mfn|fbm|تاجر)\b/u', '', $baseName.' '.$baseSlug);
        $familyTokens = array_values(array_filter(
            preg_split('/[^a-z0-9\x{0600}-\x{06FF}]+/u', (string) $familyKey) ?: [],
            fn ($t) => strlen((string) $t) >= 2
        ));

        foreach ($channels as $channel) {
            $name = strtolower((string) $channel->name);
            $slug = strtolower((string) $channel->slug);
            $merchant = $this->cleanMerchantId((string) ($channel->merchant_identifier ?? ''));

            $sameMerchant = $baseMerchant !== '' && $merchant !== '' && $baseMerchant === $merchant;
            $sameFamily = false;
            if (! $sameMerchant && ! empty($familyTokens)) {
                $haystack = $name.' '.$slug;
                foreach ($familyTokens as $token) {
                    if (str_contains($haystack, $token)) {
                        $sameFamily = true;
                        break;
                    }
                }
            }

            if (! $sameMerchant && ! $sameFamily) {
                continue;
            }

            $isTarget = $targetType === 'merchant'
                ? (str_contains($name, 'merchant') || str_contains($name, 'mfn') || str_contains($name, 'fbm') || str_contains($name, 'تاجر') || str_contains($slug, 'merchant'))
                : (str_contains($name, 'fba') || str_contains($name, 'afn') || str_contains($slug, 'fba'));

            if ($isTarget) {
                return $channel;
            }
        }

        return null;
    }

    /**
     * FBA inventory reimbursement / SAFE-T style payouts (XML TransactionType REVERSAL_REIMBURSEMENT or Arabic CSV labels).
     */
    private function isReversalReimbursementSettlementLine(SettlementItem $item): bool
    {
        if (! $this->isReleasedTransaction($item)) {
            return false;
        }

        $raw = is_array($item->raw_data) ? $item->raw_data : [];
        $amazonType = strtoupper(trim((string) ($raw['amazon_transaction_type'] ?? '')));
        if ($amazonType === 'REVERSAL_REIMBURSEMENT') {
            return true;
        }

        $desc = mb_strtoupper((string) ($item->description ?? ''), 'UTF-8');
        if (str_contains($desc, 'REVERSAL_REIMBURSEMENT')) {
            return true;
        }

        $typeStr = mb_strtoupper((string) ($item->transaction_type ?? ''), 'UTF-8');
        if (str_contains($typeStr, 'REVERSAL_REIMBURSEMENT')) {
            return true;
        }

        return $this->settlementRowTextMatchesReversalReimbursement($item, $raw);
    }

    /**
     * Seller Central CSV / Arabic transaction view: "استرداد تكاليف مخزون FBA", etc.
     *
     * @param  array<string, mixed>  $raw
     */
    private function settlementRowTextMatchesReversalReimbursement(SettlementItem $item, array $raw): bool
    {
        $parts = [];
        foreach ($raw as $k => $v) {
            if (is_string($v) || is_numeric($v)) {
                $parts[] = (string) $v;
            }
        }
        $haystack = mb_strtolower(implode(' ', $parts).' '.($item->description ?? '').' '.($item->transaction_type ?? ''), 'UTF-8');

        if (str_contains($haystack, 'reversal_reimbursement')) {
            return true;
        }
        if (str_contains($haystack, 'fba inventory reimbursement')) {
            return true;
        }
        // Arabic: FBA inventory cost reimbursement (payment sheet).
        if (str_contains($haystack, 'استرداد تكاليف مخزون')) {
            return true;
        }

        return false;
    }

    private function markReturnsReimbursementPaidFromReversal(Settlement $settlement, SettlementItem $item, InventoryOrder $order): void
    {
        $raw = is_array($item->raw_data) ? $item->raw_data : [];
        $skus = [];
        $primary = trim((string) ($item->sku ?? ''));
        if ($primary !== '') {
            $skus[] = $primary;
        }
        foreach ($raw['other_transaction_items'] ?? [] as $oti) {
            if (! empty($oti['sku'])) {
                $skus[] = trim((string) $oti['sku']);
            }
        }
        $skus = array_values(array_unique(array_filter($skus)));

        if ($skus !== []) {
            foreach ($skus as $sku) {
                $this->applyReversalClaimPaidToReturnsQuery($settlement, $item, $order, $sku);
            }

            return;
        }

        $this->applyReversalClaimPaidToReturnsQuery($settlement, $item, $order, null);
    }

    /**
     * @param  array<string, mixed>  $extraClaimMeta  Optional merged into reimbursement block (per SKU pass).
     */
    private function applyReversalClaimPaidToReturnsQuery(
        Settlement $settlement,
        SettlementItem $item,
        InventoryOrder $order,
        ?string $sku,
    ): void {
        $q = InventoryReturn::query()->where('inventory_order_id', $order->id);
        if ($sku !== null && $sku !== '') {
            $q->where('sku_code', $sku);
        }

        $paidAtIso = $item->transaction_date
            ? Carbon::parse($item->transaction_date)->toIso8601String()
            : Carbon::now()->toIso8601String();
        $amount = abs((float) ($item->amount ?? 0));

        foreach ($q->get() as $return) {
            $meta = is_array($return->metadata) ? $return->metadata : [];
            $rm = isset($meta['reimbursement']) && is_array($meta['reimbursement']) ? $meta['reimbursement'] : [];
            $rm['claim_paid'] = true;
            $rm['claim_paid_at'] = $paidAtIso;
            $rm['claim_paid_amount'] = $amount;
            $rm['claim_paid_currency'] = (string) ($item->currency ?? 'EGP');
            $rm['claim_paid_source'] = 'REVERSAL_REIMBURSEMENT';
            $rm['claim_paid_settlement_item_id'] = $item->id;
            $rm['claim_paid_settlement_id'] = $settlement->id;
            unset($rm['ready_immediate']);
            $meta['reimbursement'] = $rm;
            $return->update([
                'metadata' => $meta,
                'last_update_date' => Carbon::now(),
            ]);
        }
    }

    private function syncReturnFromSettlementItem(Settlement $settlement, SettlementItem $item, InventoryOrder $order): void
    {
        if (! $this->isSettlementClaimMarkerLine($item)) {
            return;
        }

        $rawSku = trim((string) ($item->sku ?? ''));
        $sku = $rawSku !== '' ? $rawSku : null;
        $refundAmount = abs((float) ($item->amount ?? 0));
        if ($refundAmount <= 0) {
            return;
        }

        $platformReturnId = $this->settlementReturnPlatformId($settlement, $order, $item);

        $return = null;
        if ($item->id) {
            $return = InventoryReturn::query()
                ->where('metadata->settlement_item_id', $item->id)
                ->first();
        }
        if (! $return) {
            $return = InventoryReturn::query()->where('platform_return_id', $platformReturnId)->first();
        }
        $isCompleted = $return && (string) ($return->status ?? '') === 'completed';

        $payload = [
            'inventory_order_id' => $order->id,
            'sku_code' => $sku,
            'return_quantity' => max(1, (int) ($item->quantity ?? 1)),
            'return_date' => $item->transaction_date ?: now(),
            'external_status' => 'refund_from_payment_sheet',
            'refund_amount' => $refundAmount,
            'financial_deduction' => 0,
            'extra_shipping_fee' => 0,
            'return_status' => 'refunded',
            'inventory_status' => 'on_hold',
            'source_channel' => strtolower((string) ($settlement->channel->slug ?? $settlement->channel->name ?? 'channel')),
            'merchant_identifier' => $item->merchant_identifier ?: $settlement->merchant_identifier,
            'fulfillment_channel' => $item->fulfillment_channel,
            'status' => $isCompleted ? 'completed' : 'pending',
            'reason' => 'Amazon financial refund — claim tracking (not a physical return)',
            'disposition' => 'unsellable',
            'metadata' => array_filter([
                'settlement_id' => $settlement->id,
                'settlement_report_id' => $settlement->report_id,
                'settlement_item_id' => $item->id,
                'settlement_line_description' => $item->description,
                'claim_marker' => true,
                'raw_data' => $item->raw_data,
            ]),
        ];

        if ($return) {
            $return->update($payload);
        } else {
            $return = InventoryReturn::create(InventoryReturn::mergeCreateDefaults(array_merge([
                'platform_return_id' => $platformReturnId,
                'user_id' => auth()->id(),
            ], $payload)));
        }

        $this->applySettlementGapReimbursementMetadata($return->fresh(), $item);
    }

    /**
     * Payment sheet shows a refund line but FBA returns sheet may have no matching row yet.
     * Store a 45-day eligibility window from the return's registration date; after that, the UI shows
     * "ready to file refund claim" until the FBA returns CSV merges and clears this block.
     */
    private function applySettlementGapReimbursementMetadata(InventoryReturn $return, SettlementItem $item): void
    {
        if ((string) ($return->external_status ?? '') !== 'refund_from_payment_sheet') {
            return;
        }

        $meta = is_array($return->metadata) ? $return->metadata : [];

        $existingRm = $meta['reimbursement'] ?? null;
        if (is_array($existingRm)
            && ($existingRm['source'] ?? '') !== 'settlement_refund_missing_returns_sheet'
            && ! empty($existingRm['anchor_date'])
            && empty($existingRm['ready_immediate'])) {
            return;
        }

        if ($this->returnHasFbaReturnsSheetEvidence($return)) {
            if (isset($meta['reimbursement']) && is_array($meta['reimbursement'])) {
                $src = (string) ($meta['reimbursement']['source'] ?? '');
                if ($src === 'settlement_refund_missing_returns_sheet' || ! empty($meta['reimbursement']['ready_immediate'])) {
                    unset($meta['reimbursement']);
                    $return->update(['metadata' => $meta]);
                }
            }

            return;
        }

        // No FBA returns sheet row yet: wait 45 days from return registration date (not "ready immediately").
        $anchorTime = $return->return_date
            ? Carbon::parse($return->return_date)
            : ($item->transaction_date ? Carbon::parse($item->transaction_date) : Carbon::now());
        $anchorDate = $anchorTime->toIso8601String();

        $meta['reimbursement'] = [
            'source' => 'settlement_refund_missing_returns_sheet',
            'anchor_date' => $anchorDate,
            'window_days' => 45,
            'kind' => 'settlement_vs_returns_sheet_gap',
        ];

        $return->update(['metadata' => $meta]);
    }

    private function returnHasFbaReturnsSheetEvidence(InventoryReturn $return): bool
    {
        $ext = strtolower((string) ($return->external_status ?? ''));
        if (str_starts_with($ext, 'fba_returns:')) {
            return true;
        }

        $meta = is_array($return->metadata) ? $return->metadata : [];
        if (! empty($meta['fba_license_plate']) || ! empty($meta['fba_row_hash'])) {
            return true;
        }

        $sku = $return->sku_code;
        if ($sku === null || $sku === '') {
            return false;
        }

        return InventoryReturn::query()
            ->where('inventory_order_id', $return->inventory_order_id)
            ->where('sku_code', $sku)
            ->where('id', '!=', $return->id)
            ->where('external_status', 'like', 'fba_returns:%')
            ->exists();
    }

    private function parseDelimitedRows(string $content): array
    {
        $lines = preg_split('/\r\n|\n|\r/', $content) ?: [];
        $lines = array_values(array_filter($lines, fn ($line) => trim((string) $line) !== ''));
        if (empty($lines)) {
            return [];
        }

        $delimiter = $this->detectDelimiter($lines);
        $headerRaw = str_getcsv((string) array_shift($lines), $delimiter);
        if (empty($headerRaw)) {
            return [];
        }

        $header = array_map(function ($h) {
            $name = (string) $h;
            $name = preg_replace('/^\xEF\xBB\xBF/', '', $name);

            return strtolower(trim($name, "\"' \t\n\r\0\x0B"));
        }, $headerRaw);

        $rows = [];
        foreach ($lines as $line) {
            $row = str_getcsv((string) $line, $delimiter);
            if (! is_array($row) || empty(array_filter($row, fn ($v) => $v !== null && $v !== ''))) {
                continue;
            }
            if (count($row) < count($header)) {
                $row = array_pad($row, count($header), null);
            }
            $rows[] = array_combine($header, array_slice($row, 0, count($header)));
        }

        return $rows;
    }

    private function detectDelimiter(array $lines): string
    {
        $candidates = ["\t", ',', ';', '|'];
        $sample = array_slice($lines, 0, 20);

        $best = ',';
        $bestScore = 0;
        foreach ($candidates as $candidate) {
            $score = 0;
            foreach ($sample as $line) {
                $score += count(str_getcsv((string) $line, $candidate));
            }
            if ($score > $bestScore) {
                $bestScore = $score;
                $best = $candidate;
            }
        }

        return $best;
    }

    /**
     * Amazon Seller Central transaction rows (EG + VAT exports) often expose the true settlement
     * net as the left "الإجمالي" column while a generic English "total" column is only product charges.
     * When fee / other / discount columns are present, sum them with product + shipping so `amount`
     * matches the cash impact of that row (and orderNetTotals stays aligned with the UI).
     */
    private function computeStructuredSellerCentralNetAmount(array $data): ?float
    {
        $productRaw = $this->pickValue($data, [
            'إجمالي رسوم المنتج',
            'product sales',
            'product charges',
            'product charge',
            'item-price',
            'item price',
            'سعر المنتج',
        ]);
        $discountRaw = $this->pickValue($data, [
            'إجمالي التخفيضات',
            'total discounts',
            'promotional rebates',
            'promo rebates',
        ]);
        $amazonRaw = $this->pickValue($data, [
            'رسوم أمازون',
            'amazon fees',
            'selling fees',
            'selling fee',
            'referral fee including vat',
            'fullfilment & logistics fees including vat',
            'fulfilment & logistics fees including vat',
            'other order fees including vat',
            'non-order fees including vat',
        ]);
        $otherRaw = $this->pickValue($data, [
            'أخرى',
            'اخرى',
            'other',
            'other transaction amounts',
            'miscellaneous fees',
        ]);

        $hasProduct = $productRaw !== null && trim((string) $productRaw) !== '';
        $hasDiscount = $discountRaw !== null && trim((string) $discountRaw) !== '';
        $hasAmazon = $amazonRaw !== null && trim((string) $amazonRaw) !== '';
        $hasOther = $otherRaw !== null && trim((string) $otherRaw) !== '';

        if (! $hasAmazon && ! $hasOther && ! $hasDiscount && ! $hasProduct) {
            return null;
        }
        // Avoid replacing a genuine single-column net file with product-only rows (no fee breakdown).
        if (! $hasAmazon && ! $hasOther && ! $hasDiscount && $hasProduct) {
            return null;
        }

        $product = $hasProduct ? $this->toFloat($productRaw) : 0.0;
        $discounts = $hasDiscount ? $this->toFloat($discountRaw) : 0.0;
        $amazon = $hasAmazon ? $this->toFloat($amazonRaw) : 0.0;
        $other = $hasOther ? $this->toFloat($otherRaw) : 0.0;

        $shipping = $this->toFloat($this->pickValue($data, [
            'shipping-price',
            'shipping price',
            'shipping credits',
            'shipping credit',
            'سعر الشحن',
            'مبلغ الشحن',
        ]));

        return $product + $discounts + $amazon + $other + $shipping;
    }

    /**
     * Recompute amount + fee_amount from a stored delimited-import row (settlement_items.raw_data).
     * Returns null for XML-derived payloads and other non-CSV snapshots.
     *
     * @return array{amount: float, fee_amount: float}|null
     */
    public function recomputeMoneyFieldsFromStoredRawRow(?array $data): ?array
    {
        if ($data === null || $data === []) {
            return null;
        }
        if (! $this->looksLikeDelimitedSettlementImportRawRow($data)) {
            return null;
        }

        return $this->resolveDelimitedRowAmountAndFee($data);
    }

    private function looksLikeDelimitedSettlementImportRawRow(array $data): bool
    {
        if (isset($data['source'])) {
            $markers = [
                'item_price_component',
                'item_fee',
                'promotion',
                'refund_price_component',
                'refund_fee',
                'refund_promotion',
                'other_transaction',
            ];
            if (in_array((string) $data['source'], $markers, true)) {
                return false;
            }
        }

        return count($data) >= 2;
    }

    /**
     * @return array{amount: float, fee_amount: float}
     */
    private function resolveDelimitedRowAmountAndFee(array $data): array
    {
        $structuredNet = $this->computeStructuredSellerCentralNetAmount($data);

        $explicitNetRaw = $this->pickValue($data, [
            'net-amount',
            'net amount',
            'net_amount',
            'net proceeds',
            'net credit',
            'netcredit',
            'total-amount',
            'total amount',
            'الإجمالي',
            'الإجمالي (egp)',
            'transaction-amount',
            'transaction amount',
            'paid-amount',
            'paid amount',
            'amount',
        ]);

        if ($explicitNetRaw !== null && trim((string) $explicitNetRaw) !== '') {
            $amount = $this->toFloat($explicitNetRaw);
        } elseif ($structuredNet !== null) {
            $amount = $structuredNet;
        } else {
            $amount = $this->toFloat($this->pickValue($data, [
                'amount',
                'القيمة',
                'total',
                'gross proceeds',
            ]));
        }

        if ($amount === 0.0) {
            $itemPrice = $this->toFloat($this->pickValue($data, ['item-price', 'item price', 'سعر المنتج']));
            $shipping = $this->toFloat($this->pickValue($data, ['shipping-price', 'shipping price', 'سعر الشحن']));
            $refund = $this->toFloat($this->pickValue($data, ['refund-amount', 'refund amount', 'قيمة الاسترجاع']));
            $amount = $refund !== 0.0 ? -abs($refund) : ($itemPrice + $shipping);
        }

        $feeAmount = $this->toFloat($this->pickValue($data, [
            'fee-amount', 'fee amount', 'fees', 'رسوم', 'الرسوم', 'shipping-fee', 'shipping fee',
            'referral fee including vat', 'fullfilment & logistics fees including vat',
            'other order fees including vat', 'non-order fees including vat',
        ]));
        if ($feeAmount === 0.0) {
            $feeAmount = $this->toFloat($this->pickValue($data, ['إجمالي رسوم المنتج']))
                + $this->toFloat($this->pickValue($data, ['إجمالي التخفيضات']))
                + $this->toFloat($this->pickValue($data, ['رسوم أمازون']))
                + $this->toFloat($this->pickValue($data, ['أخرى']))
                + $this->toFloat($this->pickValue($data, ['referral fee including vat']))
                + $this->toFloat($this->pickValue($data, ['fullfilment & logistics fees including vat']))
                + $this->toFloat($this->pickValue($data, ['other order fees including vat']))
                + $this->toFloat($this->pickValue($data, ['non-order fees including vat']));
        }

        return ['amount' => $amount, 'fee_amount' => $feeAmount];
    }

    /**
     * Same rules as MarketplaceImportService::normalizeMarketplaceOrderId so orders ↔ settlement lines align.
     */
    private function normalizeImportedPlatformOrderId(?string $raw): ?string
    {
        if ($raw === null) {
            return null;
        }
        $s = trim($raw);
        if ($s === '') {
            return null;
        }
        $s = preg_replace('/^\xEF\xBB\xBF/', '', $s);
        $s = trim($s, "'\"");
        $s = preg_replace('/[\x{2012}\x{2013}\x{2014}\x{2015}\x{2212}]/u', '-', $s);
        $s = (string) preg_replace('/\s+/u', '', $s);

        return $s !== '' ? $s : null;
    }

    private function mapDelimitedRowToSettlementLine(array $data): ?array
    {
        $orderId = $this->pickValue($data, [
            'order-id', 'order id', 'order_id',
            'order nr', 'order number', 'order-nr',
            'amazon-order-id', 'amazon order id',
            'merchant-order-id', 'merchant order id',
            'رقم الطلب من أمازون', 'رقم الطلب', 'رقم طلب التاجر', 'order number',
            // Noon: same stable key as sales export (inventory_orders.platform_order_id)
            'item_nr', 'item nr', 'item-nr',
            'noon order id', 'noon_order_id',
        ]);
        $orderId = $orderId !== null ? $this->normalizeImportedPlatformOrderId($orderId) : null;

        $money = $this->resolveDelimitedRowAmountAndFee($data);
        $amount = $money['amount'];
        $feeAmount = $money['fee_amount'];

        $rawTypeValue = (string) ($this->pickValue($data, ['transaction-type', 'transaction type', 'type', 'نوع المعاملة']) ?? '');
        $typeRaw = strtolower($rawTypeValue);
        $transactionStatus = $this->normalizeTransactionStatus(
            $this->pickValue($data, ['transaction-status', 'transaction status', 'status', 'حالة المعاملة'])
        );
        $amountType = trim((string) ($this->pickValue($data, [
            'amount-type', 'amount type', 'price-type', 'price type', 'amount type',
        ]) ?? ''));

        $description = trim((string) $this->pickValue($data, [
            'description', 'title', 'amount-description', 'amount-description', 'amount type', 'amount-type', 'details',
        ]));

        $descLower = strtolower($description);
        $isRefund = str_contains($typeRaw, 'refund')
            || str_contains($typeRaw, 'return')
            || str_contains($typeRaw, 'استرداد')
            || str_contains($typeRaw, 'استرجاع')
            || str_contains($descLower, 'refund')
            || str_contains($descLower, 'return')
            || str_contains($description, 'استرداد')
            || str_contains($description, 'مرتجع')
            || $amount < 0;
        $type = $isRefund ? 'Refund' : (str_contains($typeRaw, 'order') || $amount > 0 ? 'Order' : 'OtherTransaction');

        if ($orderId === null && $amount === 0.0) {
            return null;
        }

        $normalizedDescription = $this->normalizeDelimitedRefundDescription(
            $isRefund,
            $amountType,
            $description,
            $rawTypeValue
        );

        return [
            'platform_order_id' => $orderId,
            'transaction_type' => $this->normalizeTransactionType($rawTypeValue !== '' ? $rawTypeValue : $type),
            'transaction_status' => $transactionStatus,
            'sku' => $this->pickValue($data, ['sku', 'skus', 'partner skus', 'partner-skus', 'merchant-sku', 'merchant sku', 'msku', 'رقم تخزين سلعة التاجر msku']),
            'description' => $normalizedDescription,
            'amount' => $amount,
            'fee_amount' => $feeAmount,
            'quantity' => max(0, (int) ($this->pickValue($data, ['quantity-purchased', 'quantity purchased', 'quantity', 'الكمية']) ?: 0)),
            'currency' => $this->pickValue($data, ['currency', 'العملة']) ?: 'EGP',
            'transaction_date' => $this->parseDate($this->pickValue($data, ['posted-date-time', 'posted-date', 'transaction-date', 'transaction date', 'transaction_date', 'date', 'تاريخ المدفوعات', 'تاريخ الشحن', 'التاريخ'])),
            'merchant_identifier' => $this->pickValue($data, ['merchant-id', 'merchant id', 'merchant_identifier', 'contract']),
            'fulfillment_channel' => $this->pickValue($data, ['fulfillment-channel', 'fulfilled-by', 'قناة الشحن']),
            'marketplace_name' => $this->pickValue($data, ['marketplace-name', 'sales-channel', 'contract title', 'قناة المبيعات']),
            'raw_data' => $data,
            'reconciliation_status' => 'unreconciled',
        ];
    }

    /**
     * PostgreSQL may require reconciliation_status on insert (no server default).
     */
    private function withSettlementItemDefaults(array $payload): array
    {
        if (! isset($payload['reconciliation_status']) || $payload['reconciliation_status'] === '') {
            $payload['reconciliation_status'] = 'unreconciled';
        }
        if (! isset($payload['transaction_status']) || $payload['transaction_status'] === '') {
            $payload['transaction_status'] = 'released';
        }

        return $payload;
    }

    private function pickValue(array $row, array $keys): ?string
    {
        foreach ($keys as $key) {
            if (array_key_exists($key, $row) && $row[$key] !== null && trim((string) $row[$key]) !== '') {
                return trim((string) $row[$key]);
            }
        }

        $normalized = [];
        foreach ($row as $k => $v) {
            $normalized[$this->normalizeHeaderKey((string) $k)] = $v;
        }
        foreach ($keys as $key) {
            $nk = $this->normalizeHeaderKey((string) $key);
            if (array_key_exists($nk, $normalized) && $normalized[$nk] !== null && trim((string) $normalized[$nk]) !== '') {
                return trim((string) $normalized[$nk]);
            }
        }

        return null;
    }

    private function normalizeHeaderKey(string $value): string
    {
        $v = mb_strtolower(trim($value), 'UTF-8');
        $v = str_replace(['_', '-', "\t"], ' ', $v);
        $v = preg_replace('/\s+/', ' ', $v) ?? $v;
        $v = str_replace(['(', ')', '[', ']', '{', '}', ':'], '', $v);

        return trim($v);
    }

    /**
     * Align flat-file refund rows with XML-style RefundPrice: Principal|Shipping labels.
     */
    private function normalizeDelimitedRefundDescription(
        bool $isRefund,
        string $amountType,
        string $description,
        string $rawTypeValue
    ): string {
        if ($description !== '' && preg_match('/\brefundprice:/i', $description)) {
            return $description;
        }

        if ($isRefund && $amountType !== '') {
            return 'RefundPrice: '.$amountType;
        }

        if ($description !== '') {
            return $description;
        }

        if ($rawTypeValue !== '') {
            return $rawTypeValue;
        }

        return 'Imported transaction';
    }

    private function toFloat(?string $value): float
    {
        $raw = trim((string) ($value ?? '0'));
        if ($raw === '') {
            return 0.0;
        }
        $normalized = str_replace([',', ' '], '', $raw);

        return (float) $normalized;
    }

    /**
     * Normalize Seller Central / CSV status strings to released|deferred|pending|reversed.
     * Public so KPI aggregators (e.g. settlements summary) stay aligned with import rules.
     */
    public function normalizeTransactionStatus(?string $raw): string
    {
        $value = strtolower(trim((string) $raw));
        if ($value === '') {
            return self::STATUS_RELEASED;
        }
        // Must run before generic "defer" match: Seller Central uses strings like "Secured/Deferred".
        if (str_contains($value, 'secure') || str_contains($value, 'reserved') || str_contains($value, 'insured') || str_contains($value, 'تأمين')) {
            return self::STATUS_RELEASED;
        }
        if (str_contains($value, 'defer') || str_contains($value, 'delay') || str_contains($value, 'تأجيل') || str_contains($value, 'تم التأجيل')) {
            return self::STATUS_DEFERRED;
        }
        if (str_contains($value, 'release') || str_contains($value, 'issued') || str_contains($value, 'تم الإصدار') || str_contains($value, 'deposit') || str_contains($value, 'إيداع')) {
            return self::STATUS_RELEASED;
        }
        if (str_contains($value, 'pend') || str_contains($value, 'انتظار')) {
            return self::STATUS_PENDING;
        }
        if (str_contains($value, 'reverse') || str_contains($value, 'reversal') || str_contains($value, 'عكس')) {
            return self::STATUS_REVERSED;
        }

        return self::STATUS_RELEASED;
    }

    private function normalizeTransactionType(?string $raw): string
    {
        $value = trim((string) $raw);
        if ($value === '') {
            return 'OtherTransaction';
        }

        $v = strtolower($value);
        if (str_contains($v, 'refund') || str_contains($v, 'return') || str_contains($v, 'استرجاع') || str_contains($v, 'استرداد')) {
            return 'Refund';
        }
        if (
            str_contains($v, 'shipping fee')
            || str_contains($v, 'commission')
            || str_contains($v, 'storage fee')
            || str_contains($v, 'adjustment')
            || str_contains($v, 'رسوم')
        ) {
            return $value;
        }
        // Noon bank disbursement rows — preserve as-is so settlementItemIsAccountLevel can match them.
        if (str_contains($v, 'payment disbursal') || str_contains($v, 'balance_transfer') || str_contains($v, 'balance transfer')) {
            return $value;
        }
        if (str_contains($v, 'order') || str_contains($v, 'طلب')) {
            return 'Order';
        }
        if (str_contains($v, 'payment')) {
            return 'Order';
        }

        return $value;
    }

    private function resolveDeduplicationDecision(Settlement $settlement, array $line): array
    {
        $orderId = trim((string) ($line['platform_order_id'] ?? ''));
        $transactionType = strtolower(trim((string) ($line['transaction_type'] ?? '')));
        $incomingDate = $this->parseDate((string) ($line['transaction_date'] ?? null));

        // Missing order/type cannot be deduped safely; missing date still dedupe (Arabic/odd CSV headers often drop dates).
        if ($orderId === '' || $transactionType === '') {
            return ['action' => 'create', 'item' => null];
        }

        // IMPORTANT:
        // An order can have multiple transactions on the same day (item charge, refund, shipping, fee adjustments, etc).
        // We only skip if the incoming line is an *exact duplicate* of an existing row in the SAME settlement.
        $incomingSku = trim((string) ($line['sku'] ?? ''));
        $incomingDesc = trim((string) ($line['description'] ?? ''));
        $incomingAmount = (float) ($line['amount'] ?? 0);
        $incomingFee = (float) ($line['fee_amount'] ?? 0);
        $incomingQty = (int) ($line['quantity'] ?? 0);
        $incomingStatus = strtolower((string) ($line['transaction_status'] ?? self::STATUS_RELEASED));

        $exactDuplicate = SettlementItem::query()
            ->where('settlement_id', $settlement->id)
            ->where('platform_order_id', $orderId)
            ->whereRaw('LOWER(transaction_type) = ?', [$transactionType])
            ->when(
                $incomingDate !== null,
                fn ($q) => $q->where('transaction_date', $incomingDate),
                fn ($q) => $q->whereNull('transaction_date')
            )
            ->whereRaw('COALESCE(sku, \'\') = ?', [$incomingSku])
            ->whereRaw('COALESCE(description, \'\') = ?', [$incomingDesc])
            ->where('amount', $incomingAmount)
            ->where('fee_amount', $incomingFee)
            ->where('quantity', $incomingQty)
            ->whereRaw('LOWER(COALESCE(transaction_status, \''.self::STATUS_RELEASED.'\')) = ?', [$incomingStatus])
            ->orderByDesc('id')
            ->first();

        if ($exactDuplicate) {
            return ['action' => 'skip_duplicate', 'item' => $exactDuplicate];
        }

        // Always create a new row if it isn't an exact duplicate.
        return ['action' => 'create', 'item' => null];
    }

    private function bucketByTransactionType(string $type, float $amount): string
    {
        $t = strtolower($type);
        if (str_contains($t, 'refund') || str_contains($t, 'return') || $amount < 0) {
            return 'refund';
        }
        if (str_contains($t, 'order') || $amount > 0) {
            return 'order';
        }

        return 'fee';
    }

    private function prepareSettlementForImport(
        int $channelId,
        string $reportId,
        ?string $startDate,
        ?string $endDate,
        ?string $merchantIdentifier
    ): Settlement {
        $settlement = Settlement::where('report_id', $reportId)->first();
        if ($settlement) {
            $settlement->update([
                'channel_id' => $channelId,
                'start_date' => $this->parseDate($startDate ?: now()),
                'end_date' => $this->parseDate($endDate ?: now()),
                'status' => 'processing',
                'merchant_identifier' => $merchantIdentifier ?: $settlement->merchant_identifier,
            ]);
            SettlementItem::where('settlement_id', $settlement->id)->delete();

            return $settlement;
        }

        return Settlement::create([
            'channel_id' => $channelId,
            'report_id' => $reportId,
            'start_date' => $this->parseDate($startDate ?: now()),
            'end_date' => $this->parseDate($endDate ?: now()),
            'total_amount' => 0,
            'status' => 'processing',
            'merchant_identifier' => $merchantIdentifier,
        ]);
    }

    private function buildFallbackReportId(string $filePath): string
    {
        $base = pathinfo($filePath, PATHINFO_BASENAME);

        return 'IMPORT-'.date('Ymd-His').'-'.substr(sha1($base.microtime(true)), 0, 8);
    }

    private function buildFallbackReportIdFromContents(string $fileContents, string $filePath): string
    {
        $base = pathinfo($filePath, PATHINFO_BASENAME);

        // Stable per file contents to prevent duplicates when a file is uploaded twice.
        return 'IMPORT-'.substr(sha1($base.'|'.$fileContents), 0, 16);
    }

    private function parseDate($dateString)
    {
        if (! $dateString) {
            return null;
        }
        $raw = trim((string) $dateString);
        if ($raw === '') {
            return null;
        }

        $formats = [
            'd/m/Y H:i:s',
            'd/m/Y H:i',
            'd/m/Y',
            'd-m-Y H:i:s',
            'd-m-Y H:i',
            'd-m-Y',
            'd.m.Y H:i:s',
            'd.m.Y H:i',
            'd.m.Y',
            'Y-m-d H:i:s',
            'Y-m-d',
            'm/d/Y H:i:s',
            'm/d/Y H:i',
            'm/d/Y',
        ];
        foreach ($formats as $format) {
            $dt = \DateTime::createFromFormat('!'.$format, $raw);
            if ($dt instanceof \DateTime) {
                $errors = \DateTime::getLastErrors();
                if (is_array($errors) && (($errors['warning_count'] ?? 0) > 0 || ($errors['error_count'] ?? 0) > 0)) {
                    continue;
                }

                return $dt->format('Y-m-d H:i:s');
            }
        }

        // Avoid US-centric strtotime for ambiguous numeric slash dates (d/m vs m/d).
        if (preg_match('/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}/', $raw)) {
            return null;
        }

        try {
            return date('Y-m-d H:i:s', strtotime($raw));
        } catch (\Exception $e) {
            return null;
        }
    }

    /**
     * Safe list wrapper for optional SimpleXML nodes.
     *
     * @param  mixed  $node
     */
    private function xmlList($node): array
    {
        if ($node === null) {
            return [];
        }

        if (is_array($node)) {
            return $node;
        }

        if ($node instanceof \SimpleXMLElement) {
            /**
             * SimpleXML quirk:
             * - When an element appears multiple times (<Order>...</Order> repeated), `$xml->Order` is "array-like".
             * - When it appears once, `$xml->Order` is a single node, and iterating it yields its *children* (wrong for our use).
             *
             * We detect "array-like" lists by checking index 1.
             */
            if (isset($node[1])) {
                $items = [];
                foreach ($node as $entry) {
                    if ($entry instanceof \SimpleXMLElement) {
                        $items[] = $entry;
                    }
                }

                return $items;
            }

            return [$node];
        }

        if ($node instanceof \Traversable) {
            return iterator_to_array($node);
        }

        return [];
    }
}
