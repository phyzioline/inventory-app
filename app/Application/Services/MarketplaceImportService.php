<?php

namespace App\Application\Services;

use Exception;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use PhpOffice\PhpSpreadsheet\IOFactory;

class MarketplaceImportService
{
    /** Persists the last sheet import batch per user (survives cache flush; enables rollback without re-importing). */
    private const LAST_IMPORT_BATCH_TABLE = 'marketplace_order_import_last_batches';

    private const LEGACY_IMPORT_BATCH_CACHE_PREFIX = 'marketplace_order_import_last_batch:';

    private ?array $orderColumns = null;

    private ?array $orderItemColumns = null;

    private ?array $transactionColumns = null;

    /** Preview table rows returned (full file is still analyzed for blocking). */
    private const PREVIEW_ROWS_LIMIT = 2000;

    /**
     * Inventory order IDs created during the current {@see import()} run.
     * Stock is only deducted for lines belonging to these orders so re-uploading historical order sheets
     * does not sell the same order twice from local stock.
     *
     * @var array<int, true>
     */
    private array $importBatchNewOrderIds = [];

    /**
     * OUT inventory_transaction ids created during the current {@see import()} (marketplace import deductions only).
     *
     * @var list<int>
     */
    private array $importBatchStockOutTransactionIds = [];

    /**
     * Deduction skipped: no location or insufficient stock (surfaced in API for the user).
     *
     * @var list<array<string, mixed>>
     */
    private array $importStockShortages = [];

    /**
     * Large Amazon/Noon order sheets can exceed the default 60s PHP limit on shared hosting.
     */
    private function extendImportRuntime(): void
    {
        if (function_exists('set_time_limit')) {
            @set_time_limit(600);
        }

        $memory = (string) ini_get('memory_limit');
        if ($memory !== '-1' && $this->parseIniBytes($memory) < 512 * 1024 * 1024) {
            @ini_set('memory_limit', '512M');
        }
    }

    private function parseIniBytes(string $value): int
    {
        $value = trim($value);
        if ($value === '' || $value === '-1') {
            return PHP_INT_MAX;
        }
        $unit = strtolower(substr($value, -1));
        $num = (int) $value;

        return match ($unit) {
            'g' => $num * 1024 * 1024 * 1024,
            'm' => $num * 1024 * 1024,
            'k' => $num * 1024,
            default => (int) $value,
        };
    }

    /**
     * Import orders from a CSV file for a specific channel.
     */
    public function import(UploadedFile $file, int $channelId, bool $lockChannel = false)
    {
        $this->extendImportRuntime();
        $uid = Auth::check() ? (int) Auth::id() : 0;

        // Serialize all imports for this user so no two import sessions run concurrently.
        // This eliminates the TOCTOU races between hasPriorImportedOrderDeduction checks
        // and the deduction commits. The lock TTL (300 s) is a safety ceiling — normal imports
        // release it in the finally block below well before expiry.
        $importLock = Cache::lock('marketplace_import:user:'.$uid, 300);
        if (! $importLock->block(10)) {
            throw ValidationException::withMessages([
                'file' => ['يجري استيراد آخر الآن لهذا الحساب. يُرجى الانتظار حتى ينتهي ثم حاول مجدداً.'],
            ]);
        }

        try {
            return $this->runImport($file, $channelId, $lockChannel, $uid);
        } finally {
            $importLock->release();
        }
    }

    private function runImport(UploadedFile $file, int $channelId, bool $lockChannel, int $uid): array
    {
        $this->importBatchNewOrderIds = [];
        $this->importBatchStockOutTransactionIds = [];
        $this->importStockShortages = [];
        $channelId = $this->resolveImportChannelId($channelId, $lockChannel);
        ['platform' => $platform, 'channels' => $channels, 'defaultChannel' => $defaultChannel] = $this->buildImportContext($channelId);

        $data = $this->parseFile($file);

        // Record the import session before gate check so partial failures are always traceable.
        $sessionId = $this->openImportSession($uid, $channelId, $file, count($data));

        try {
            $gate = $this->buildImportAnalysis($data, $channelId, $lockChannel, false);
            if (! empty($gate['import_blocked'])) {
                $this->closeImportSession($sessionId, 'blocked', 0, 0, 0);
                throw ValidationException::withMessages([
                    'file' => [$gate['import_blocked_message_ar'] ?? 'لا يمكن تأكيد الاستيراد: يوجد أخطاء في الشيت أو نقص مخزون للصفوف التي تتطلب خصماً.'],
                ]);
            }

            $results = [
                'total' => count($data),
                'imported' => 0,
                'failed' => 0,
                'skipped' => 0,
                'errors' => [],
                'import_session_id' => $sessionId,
            ];

            foreach ($data as $row) {
                try {
                    if ($this->processOrderRow($row, $platform, $channelId, $defaultChannel, $channels, $lockChannel)) {
                        $results['imported']++;
                    } else {
                        $results['skipped']++;
                    }
                } catch (Exception $e) {
                    $results['failed']++;
                    $results['errors'][] = 'Row error: '.$e->getMessage();
                    Log::error('Import Error: '.$e->getMessage(), ['row' => $row]);
                }
            }

            if ($uid > 0) {
                $newOrderIds = array_values(array_unique(array_map('intval', array_keys($this->importBatchNewOrderIds))));
                $txIds = array_values(array_unique(array_map('intval', $this->importBatchStockOutTransactionIds)));
                $this->writeLastImportBatchToDatabase($uid, $channelId, $txIds, $newOrderIds);
            }

            $newOrderCount = count($this->importBatchNewOrderIds);
            $txCount = count($this->importBatchStockOutTransactionIds);

            $this->closeImportSession(
                $sessionId,
                $results['failed'] > 0 ? 'partial' : 'completed',
                $results['imported'],
                $results['skipped'],
                $results['failed']
            );

            return array_merge($results, [
                'rollback_stock_transactions' => $txCount,
                'rollback_new_orders' => $newOrderCount,
                'rollback_available' => $txCount > 0 || $newOrderCount > 0,
                'stock_shortages' => $this->importStockShortages,
                'stock_shortage_count' => count($this->importStockShortages),
            ]);
        } catch (Exception $e) {
            $this->closeImportSession($sessionId, 'failed', 0, 0, 0);
            throw $e;
        }
    }

    /**
     * Open a row in inventory_import_sessions before processing begins.
     * Returns the session id (or 0 if the table does not exist yet — during migration).
     */
    private function openImportSession(int $uid, int $channelId, UploadedFile $file, int $totalRows): int
    {
        if (! Schema::hasTable('inventory_import_sessions')) {
            return 0;
        }

        try {
            $fileHash = hash_file('sha256', $file->getRealPath()) ?: '';

            return (int) DB::table('inventory_import_sessions')->insertGetId([
                'user_id' => $uid > 0 ? $uid : null,
                'channel_id' => $channelId,
                'file_hash' => $fileHash,
                'status' => 'processing',
                'total_rows' => $totalRows,
                'imported_rows' => 0,
                'skipped_rows' => 0,
                'failed_rows' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (Exception $e) {
            Log::warning('Could not open import session record', ['error' => $e->getMessage()]);

            return 0;
        }
    }

    private function closeImportSession(int $sessionId, string $status, int $imported, int $skipped, int $failed): void
    {
        if ($sessionId <= 0 || ! Schema::hasTable('inventory_import_sessions')) {
            return;
        }

        try {
            DB::table('inventory_import_sessions')->where('id', $sessionId)->update([
                'status' => $status,
                'imported_rows' => $imported,
                'skipped_rows' => $skipped,
                'failed_rows' => $failed,
                'completed_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (Exception $e) {
            Log::warning('Could not close import session record', ['session_id' => $sessionId, 'error' => $e->getMessage()]);
        }
    }

    /**
     * @return array{available: bool, transaction_count: int, new_orders_count: int, recorded_at: ?string, hint: ?string}
     */
    public function lastStockDeductionBatchSnapshot(): array
    {
        if (! Auth::check()) {
            return ['available' => false, 'transaction_count' => 0, 'new_orders_count' => 0, 'recorded_at' => null, 'hint' => 'not_authenticated'];
        }
        $uid = (int) Auth::id();
        $batch = $this->readLastImportBatchForUser($uid);
        if ($batch === null) {
            return ['available' => false, 'transaction_count' => 0, 'new_orders_count' => 0, 'recorded_at' => null, 'hint' => 'no_recent_import'];
        }

        $ids = $batch['transaction_ids'];
        $newOrderIds = $batch['new_inventory_order_ids'];
        $recordedAt = $batch['recorded_at'];

        if ($ids !== [] || $newOrderIds !== []) {
            return [
                'available' => true,
                'transaction_count' => count($ids),
                'new_orders_count' => count($newOrderIds),
                'recorded_at' => $recordedAt,
                'hint' => null,
            ];
        }

        $importChannelId = $batch['import_channel_id'];
        if ($importChannelId > 0 && $this->isFbaChannel($importChannelId)) {
            return [
                'available' => false,
                'transaction_count' => 0,
                'new_orders_count' => 0,
                'recorded_at' => $recordedAt,
                'hint' => 'fba_no_local_deduction',
            ];
        }

        return [
            'available' => false,
            'transaction_count' => 0,
            'new_orders_count' => 0,
            'recorded_at' => $recordedAt,
            'hint' => 'no_deduction_lines',
        ];
    }

    /**
     * Undo the last marketplace order import for this user: restock from recorded OUT lines,
     * delete orders created in that import run, then remove ImportedOrder audit rows for those orders.
     *
     * @return array{reversed: int, skipped: int, orders_deleted: int, orders_skipped: int}
     */
    public function rollbackLastStockDeductionBatch(): array
    {
        $uid = (int) Auth::id();
        if ($uid <= 0) {
            throw new \RuntimeException('Not authenticated.');
        }
        $batch = $this->readLastImportBatchForUser($uid);
        if ($batch === null) {
            throw new \RuntimeException('No recent import batch to roll back.');
        }

        $transactionIds = $batch['transaction_ids'];
        $newOrderIds = $batch['new_inventory_order_ids'];

        if ($transactionIds === [] && $newOrderIds === []) {
            throw new \RuntimeException('No recent import batch to roll back.');
        }

        $reversed = 0;
        $skipped = 0;
        $ordersDeleted = 0;
        $ordersSkipped = 0;

        DB::transaction(function () use ($uid, $transactionIds, $newOrderIds, &$reversed, &$skipped, &$ordersDeleted, &$ordersSkipped) {
            foreach ($transactionIds as $tid) {
                $tid = (int) $tid;
                if ($tid <= 0) {
                    $skipped++;

                    continue;
                }
                $tx = InventoryTransaction::query()
                    ->where('id', $tid)
                    ->where('user_id', $uid)
                    ->lockForUpdate()
                    ->first();
                if (! $tx) {
                    $skipped++;

                    continue;
                }
                if (strtoupper((string) $tx->type) !== 'OUT' || (string) $tx->reference_type !== 'ImportedOrder') {
                    $skipped++;

                    continue;
                }

                $qty = (int) ($tx->quantity ?? 0);
                if ($qty <= 0) {
                    $skipped++;

                    continue;
                }

                $inv = SkuInventory::query()
                    ->where('sku_id', $tx->sku_id)
                    ->where('location_id', $tx->location_id)
                    ->lockForUpdate()
                    ->first();

                if ($inv) {
                    $inv->increment('quantity', $qty);
                }

                InventoryTransaction::create($this->filterTransactionColumns([
                    'sku_id' => $tx->sku_id,
                    'location_id' => $tx->location_id,
                    'type' => 'IN',
                    'quantity' => $qty,
                    'reference_type' => 'ImportedOrder',
                    'reference_id' => (string) ($tx->reference_id ?? ''),
                    'user_id' => $uid,
                    'notes' => 'Rollback: UI reversed marketplace order import deduction (tx #'.$tx->id.')',
                ]));
                $reversed++;
            }

            if ($newOrderIds !== []) {
                if (Schema::hasTable('settlement_items')) {
                    DB::table('settlement_items')->whereIn('inventory_order_id', $newOrderIds)->delete();
                }
                if (Schema::hasTable('order_costs')) {
                    DB::table('order_costs')->whereIn('inventory_order_id', $newOrderIds)->delete();
                }
                if (Schema::hasTable('inventory_returns')) {
                    DB::table('inventory_returns')->whereIn('inventory_order_id', $newOrderIds)->update(['inventory_order_id' => null]);
                }
                if (Schema::hasTable('inv_receipts') && Schema::hasColumn('inv_receipts', 'linked_inventory_order_id')) {
                    DB::table('inv_receipts')->where('user_id', $uid)->whereIn('linked_inventory_order_id', $newOrderIds)->update(['linked_inventory_order_id' => null]);
                }
            }

            foreach ($newOrderIds as $orderId) {
                $orderId = (int) $orderId;
                if ($orderId <= 0) {
                    $ordersSkipped++;

                    continue;
                }
                $deleted = InventoryOrder::query()->withoutGlobalScopes()->where('id', $orderId)->where('user_id', $uid)->delete();
                if ($deleted > 0) {
                    $ordersDeleted++;
                } else {
                    $ordersSkipped++;
                }
            }

            $refStrings = array_map(static fn (int $id): string => (string) $id, $newOrderIds);
            if ($refStrings !== []) {
                InventoryTransaction::query()
                    ->where('user_id', $uid)
                    ->where('reference_type', 'ImportedOrder')
                    ->whereIn('reference_id', $refStrings)
                    ->delete();
            }

            $this->forgetLastImportBatchForUser($uid);
        });

        return [
            'reversed' => $reversed,
            'skipped' => $skipped,
            'orders_deleted' => $ordersDeleted,
            'orders_skipped' => $ordersSkipped,
        ];
    }

    private function legacyImportBatchCacheKey(int $userId): string
    {
        return self::LEGACY_IMPORT_BATCH_CACHE_PREFIX.$userId;
    }

    /**
     * @return list<int>
     */
    private function decodeJsonIdList(mixed $raw): array
    {
        if (is_array($raw)) {
            return array_values(array_unique(array_map('intval', $raw)));
        }
        $decoded = json_decode((string) $raw, true);

        return is_array($decoded) ? array_values(array_unique(array_map('intval', $decoded))) : [];
    }

    /**
     * @return array{transaction_ids: list<int>, new_inventory_order_ids: list<int>, import_channel_id: int, recorded_at: ?string}|null
     */
    private function readLastImportBatchForUser(int $uid): ?array
    {
        if (Schema::hasTable(self::LAST_IMPORT_BATCH_TABLE)) {
            $row = DB::table(self::LAST_IMPORT_BATCH_TABLE)->where('user_id', $uid)->first();
            if ($row) {
                return [
                    'transaction_ids' => $this->decodeJsonIdList($row->transaction_ids),
                    'new_inventory_order_ids' => $this->decodeJsonIdList($row->new_inventory_order_ids),
                    'import_channel_id' => (int) ($row->import_channel_id ?? 0),
                    'recorded_at' => isset($row->recorded_at) && $row->recorded_at ? (string) $row->recorded_at : null,
                ];
            }
        }

        $legacy = Cache::get($this->legacyImportBatchCacheKey($uid));
        if (! is_array($legacy)) {
            return null;
        }

        $normalized = [
            'transaction_ids' => isset($legacy['transaction_ids']) && is_array($legacy['transaction_ids'])
                ? array_values(array_unique(array_map('intval', $legacy['transaction_ids'])))
                : [],
            'new_inventory_order_ids' => isset($legacy['new_inventory_order_ids']) && is_array($legacy['new_inventory_order_ids'])
                ? array_values(array_unique(array_map('intval', $legacy['new_inventory_order_ids'])))
                : [],
            'import_channel_id' => (int) ($legacy['import_channel_id'] ?? 0),
            'recorded_at' => isset($legacy['recorded_at']) ? (string) $legacy['recorded_at'] : null,
        ];

        if (Schema::hasTable(self::LAST_IMPORT_BATCH_TABLE)) {
            $this->writeLastImportBatchToDatabase(
                $uid,
                $normalized['import_channel_id'],
                $normalized['transaction_ids'],
                $normalized['new_inventory_order_ids']
            );
            Cache::forget($this->legacyImportBatchCacheKey($uid));
        }

        return $normalized;
    }

    /**
     * @param  list<int>  $transactionIds
     * @param  list<int>  $newOrderIds
     */
    private function writeLastImportBatchToDatabase(int $uid, int $importChannelId, array $transactionIds, array $newOrderIds): void
    {
        $transactionIds = array_values(array_unique(array_map('intval', $transactionIds)));
        $newOrderIds = array_values(array_unique(array_map('intval', $newOrderIds)));

        if (! Schema::hasTable(self::LAST_IMPORT_BATCH_TABLE)) {
            Cache::put(
                $this->legacyImportBatchCacheKey($uid),
                [
                    'transaction_ids' => $transactionIds,
                    'recorded_at' => now()->toIso8601String(),
                    'import_channel_id' => $importChannelId,
                    'new_inventory_order_ids' => $newOrderIds,
                ],
                now()->addDays(14),
            );

            return;
        }

        $now = now();
        $payload = [
            'transaction_ids' => json_encode($transactionIds),
            'new_inventory_order_ids' => json_encode($newOrderIds),
            'import_channel_id' => $importChannelId > 0 ? $importChannelId : null,
            'recorded_at' => $now,
            'updated_at' => $now,
        ];

        $existing = DB::table(self::LAST_IMPORT_BATCH_TABLE)->where('user_id', $uid)->first();
        if ($existing) {
            DB::table(self::LAST_IMPORT_BATCH_TABLE)
                ->where('user_id', $uid)
                ->update($payload);
        } else {
            DB::table(self::LAST_IMPORT_BATCH_TABLE)->insert(array_merge($payload, [
                'user_id' => $uid,
                'created_at' => $now,
            ]));
        }
    }

    private function forgetLastImportBatchForUser(int $uid): void
    {
        if (Schema::hasTable(self::LAST_IMPORT_BATCH_TABLE)) {
            DB::table(self::LAST_IMPORT_BATCH_TABLE)->where('user_id', $uid)->delete();
        }
        Cache::forget($this->legacyImportBatchCacheKey($uid));
    }

    /**
     * Preview order import without persisting data.
     */
    public function preview(UploadedFile $file, int $channelId, bool $lockChannel = false): array
    {
        $this->extendImportRuntime();
        $data = $this->parseFile($file);
        $channelId = $this->resolveImportChannelId($channelId, $lockChannel);

        return $this->buildImportAnalysis($data, $channelId, $lockChannel, true);
    }

    /**
     * @return array{
     *   summary: array,
     *   rows?: list<array<string, mixed>>,
     *   stock_shortages: list<array<string, mixed>>,
     *   stock_shortage_count: int,
     *   truncated?: bool,
     *   rows_shown?: int,
     *   import_blocked: bool,
     *   import_blocked_message_ar: string,
     * }
     */
    private function buildImportAnalysis(array $data, int $channelId, bool $lockChannel, bool $includeRowSamples): array
    {
        ['platform' => $platform, 'channels' => $channels, 'defaultChannel' => $defaultChannel] = $this->buildImportContext($channelId);

        $rows = [];
        $stockShortages = [];
        $stockShortageCount = 0;       // only new/update rows — drives import_blocked
        $backfillShortageCount = 0;    // duplicate rows with pending deduction — warning only
        $summary = [
            'total_rows' => count($data),
            'new_orders' => 0,
            'update_orders' => 0,
            'duplicates' => 0,
            'errors' => 0,
            'will_import' => 0,
            'ignored' => 0,
        ];

        // Simulate running inventory within this sheet so row N sees deductions from rows 1…N−1 (matches import order).
        $stockSimRemaining = [];

        foreach ($data as $index => $row) {
            $analysis = $this->analyzeOrderRow($row, $platform, $channelId, $defaultChannel, $channels, $lockChannel, $stockSimRemaining);
            $status = $analysis['status'];
            if ($status === 'new') {
                $summary['new_orders']++;
                $summary['will_import']++;
            } elseif ($status === 'update') {
                $summary['update_orders']++;
                $summary['will_import']++;
            } elseif ($status === 'duplicate') {
                $summary['duplicates']++;
                $summary['ignored']++;
            } else {
                $summary['errors']++;
                $summary['ignored']++;
            }

            $stockPreview = $analysis['stock_preview'] ?? null;
            if (is_array($stockPreview) && ! empty($stockPreview['shortage'])) {
                // Duplicate rows have a pending backfill deduction (order already saved but no OUT recorded).
                // Insufficient stock on a backfill is a warning, not a blocker — the order already exists
                // and the deduction gap is a historical anomaly. Only new/update rows are import blockers.
                if ($status === 'duplicate') {
                    $backfillShortageCount++;
                } else {
                    $stockShortageCount++;
                }
                if (count($stockShortages) < 200) {
                    $skuId = (int) ($stockPreview['sku_id'] ?? 0);
                    $locId = (int) ($stockPreview['deduction_location_id'] ?? 0);
                    $requested = (int) ($stockPreview['requested'] ?? 0);
                    $available = (float) ($stockPreview['available'] ?? 0);
                    $orderId = (string) ($analysis['uploaded_data']['order_number'] ?? '');
                    $sheetSku = (string) ($analysis['uploaded_data']['sku'] ?? '');

                    $displayCode = trim($sheetSku) !== '' ? trim($sheetSku) : ((string) ($stockPreview['sku_code_internal'] ?? ''));
                    if ($displayCode === '') {
                        $displayCode = $skuId > 0 ? (string) $skuId : 'UNKNOWN';
                    }
                    $fromMerchant = (bool) ($stockPreview['deducts_from_store_bucket'] ?? false);
                    $msgs = $this->marketplaceImportStockShortageMessages(
                        $orderId,
                        $displayCode,
                        $requested,
                        $available,
                        $fromMerchant,
                        isset($stockPreview['merchant_available']) ? (float) $stockPreview['merchant_available'] : null,
                        isset($stockPreview['store_available']) ? (float) $stockPreview['store_available'] : null
                    );

                    $stockShortages[] = [
                        'platform_order_id' => $orderId,
                        'sku_code_sheet' => $sheetSku ?: null,
                        'sku_code_internal' => $stockPreview['sku_code_internal'] ?? null,
                        'sku_id' => $skuId,
                        'location_id' => $locId > 0 ? $locId : null,
                        'requested' => $requested,
                        'available' => $available,
                        'reason' => 'insufficient',
                        'deducts_from_store_bucket' => $fromMerchant,
                        'message_ar' => $msgs['ar'],
                        'message_en' => $msgs['en'],
                        'is_backfill_warning' => $status === 'duplicate',
                    ];
                }
            }

            if ($includeRowSamples) {
                $rowNumber = $index + 1;
                $withinPreviewWindow = $index < self::PREVIEW_ROWS_LIMIT;
                $blockingIssue = $this->previewRowHasBlockingIssue($analysis);
                // Always surface blocking rows even past PREVIEW_ROWS_LIMIT so the issues filter can find them.
                if ($withinPreviewWindow || $blockingIssue) {
                    $rows[] = array_merge(['row_number' => $rowNumber], $analysis);
                }
            }
        }

        $catalogBlocked = $summary['errors'] > 0;
        $stockBlocked = $stockShortageCount > 0;   // backfill shortages on duplicates are warnings, not blockers
        $importBlocked = $catalogBlocked || $stockBlocked;

        $parts = [];
        if ($catalogBlocked) {
            $parts[] = 'يوجد '.$summary['errors'].' صفّاً بمنتج غير مربوط أو غير موجود في النظام.';
        }
        if ($stockBlocked) {
            $parts[] = 'يوجد '.$stockShortageCount.' صفّاً يتطلب خصماً من المخزون لكن الرصيد غير كافٍ (بما في ذلك مخزون المحل للطلبات التجارية).';
        }
        $blockedMsgAr = $importBlocked ? implode(' ', $parts) : '';

        $out = [
            'summary' => $summary,
            'stock_shortages' => $stockShortages,
            'stock_shortage_count' => $stockShortageCount + $backfillShortageCount,
            'blocking_shortage_count' => $stockShortageCount,
            'backfill_shortage_count' => $backfillShortageCount,
            'import_blocked' => $importBlocked,
            'import_blocked_message_ar' => $blockedMsgAr,
        ];

        if ($includeRowSamples) {
            usort($rows, static fn (array $a, array $b): int => ($a['row_number'] ?? 0) <=> ($b['row_number'] ?? 0));
            $out['rows'] = $rows;
            $out['truncated'] = count($data) > self::PREVIEW_ROWS_LIMIT;
            $out['rows_shown'] = count($rows);
            $out['preview_issue_row_count'] = $summary['errors'] + $stockShortageCount;
        }

        return $out;
    }

    /**
     * Blocking preview issue: catalog error or stock shortage on a new/update row (not backfill warning).
     *
     * @param  array<string, mixed>  $analysis
     */
    private function previewRowHasBlockingIssue(array $analysis): bool
    {
        if (($analysis['status'] ?? '') === 'error') {
            return true;
        }

        $stockPreview = $analysis['stock_preview'] ?? null;
        if (! is_array($stockPreview) || empty($stockPreview['shortage'])) {
            return false;
        }

        return ($analysis['status'] ?? '') !== 'duplicate';
    }

    /**
     * Parse file (CSV or Excel) into array.
     */
    private function parseFile(UploadedFile $file): array
    {
        $path = $file->getRealPath();
        $reader = IOFactory::createReaderForFile($path);
        if ($reader instanceof \PhpOffice\PhpSpreadsheet\Reader\Csv) {
            $extension = strtolower($file->getClientOriginalExtension());
            $reader->setDelimiter($this->detectCsvDelimiter($path, in_array($extension, ['txt', 'tsv']) ? "\t" : ','));
            $reader->setEnclosure('"');
            $reader->setInputEncoding($this->detectCsvInputEncoding($path));
        }

        $spreadsheet = $reader->load($path);
        $worksheet = $spreadsheet->getActiveSheet();
        $rows = $this->normalizeRowsEncoding($worksheet->toArray());

        if (empty($rows)) {
            return [];
        }

        // Skip leading empty rows to find the header
        $header = [];
        while (! empty($rows)) {
            $potentialHeader = array_shift($rows);
            if (! empty(array_filter($potentialHeader))) {
                $header = $potentialHeader;
                break;
            }
        }

        if (empty($header)) {
            return [];
        }

        // Clean header (trim and lower)
        $header = array_map(function ($h) {
            $name = (string) $h;
            // Remove UTF-8 BOM if present.
            $name = preg_replace('/^\xEF\xBB\xBF/', '', $name);

            return strtolower(trim($name));
        }, $header);

        $data = [];
        foreach ($rows as $row) {
            // Some marketplace TXT/CSV rows may end with missing trailing columns.
            // Pad them to header length instead of dropping the row.
            if (count($row) < count($header)) {
                $row = array_pad($row, count($header), null);
            }

            $rowData = array_combine($header, array_slice($row, 0, count($header)));
            if (! empty(array_filter($rowData, fn ($v) => $v !== null && $v !== ''))) { // Skip fully empty rows
                $data[] = $rowData;
            }
        }

        return $data;
    }

    /**
     * Process a single row based on platform.
     */
    private function processOrderRow(array $row, string $platform, int $defaultChannelId, ?Channel $defaultChannel, $channels, bool $lockChannel = false): bool
    {
        $orderData = $this->mapRowToOrderData($row, $platform);

        if (! $orderData || empty($orderData['platform_order_id'])) {
            return false;
        }

        DB::beginTransaction();
        try {
            $headerUpdated = false;
            $platformOrderKey = $this->normalizeMarketplaceOrderId((string) ($orderData['platform_order_id'] ?? ''));
            $order = $this->findInventoryOrderForImport($row, $platform, $orderData);

            if ($order && (int) ($order->user_id ?? 0) <= 0) {
                try {
                    $uid = auth()->id();
                    InventoryOrder::withoutGlobalScope('user_isolation')
                        ->where('id', $order->id)
                        ->update(['user_id' => $uid]);
                    InventoryOrderItem::withoutGlobalScope('user_isolation')
                        ->where('inventory_order_id', $order->id)
                        ->whereNull('user_id')
                        ->update(['user_id' => $uid]);

                    $order = $order->fresh();
                } catch (Exception $e) {
                    Log::warning('Import: orphan order adoption failed', [
                        'platform_order_id' => $order->platform_order_id,
                        'error' => $e->getMessage(),
                    ]);
                }
            }

            if (! $order) {
                $channelId = $lockChannel
                    ? $defaultChannelId
                    : $this->resolveChannelIdFromRow(
                        $orderData['channel_hint'] ?? null,
                        $orderData['fulfillment_hint'] ?? null,
                        $orderData['sku_hint'] ?? null,
                        $channels,
                        $defaultChannelId,
                        $defaultChannel
                    );

                $isCancelled = ! empty($orderData['is_cancelled']);
                $orderPayload = $this->buildImportOrderHeaderPayload($orderData, $channelId, $isCancelled);
                $orderPayload['platform_order_id'] = $platformOrderKey;

                // Ensure imported orders can be filtered by warehouse in Sales page:
                // map the order's channel to an inventory location (merchant channels map to main store).
                $locationId = ChannelStockResolver::resolveDeductionLocationIdForChannel((int) $channelId);
                if ($locationId) {
                    if (Schema::hasColumn('inventory_orders', 'warehouse_id')) {
                        $orderPayload['warehouse_id'] = $locationId;
                    }
                    if (Schema::hasColumn('inventory_orders', 'fulfillment_warehouse_id')) {
                        $orderPayload['fulfillment_warehouse_id'] = $locationId;
                    }
                    if (Schema::hasColumn('inventory_orders', 'credit_warehouse_id')) {
                        $orderPayload['credit_warehouse_id'] = $locationId;
                    }
                }

                $order = InventoryOrder::create($orderPayload);
                $this->importBatchNewOrderIds[(int) $order->id] = true;
            } else {
                $headerUpdated = $this->applyOrderHeaderUpdatesFromImport($order, $orderData);
            }

            $anyNewItem = $headerUpdated;
            $isOrderCancelled = ! empty($orderData['is_cancelled']);
            foreach ($orderData['items'] as $itemData) {
                $externalSkuCode = (string) ($itemData['sku_code'] ?? '');
                // Find SKU (map merchant/FBA SKU to store SKU for inventory deduction when needed)
                $sku = $this->resolveSkuForOrderItem($externalSkuCode, (int) $order->channel_id);

                if (! $sku) {
                    Log::warning('Order import: SKU not found in catalog: '.$externalSkuCode.' - order ID: '.$order->platform_order_id);

                    // We still don't fail, but we don't have an item to link
                    continue;
                }

                $lineQty = (int) ($itemData['quantity'] ?? 0);
                $lineUnit = (float) ($itemData['unit_price'] ?? 0);

                // Look up by sku_code (external marketplace code) first so that SKU re-mappings
                // (where the internal sku_id changed after original import) still find the historical item.
                $existingItem = $this->findExistingOrderItem((int) $order->id, (int) $sku->id, $externalSkuCode);

                if ($isOrderCancelled || $lineQty <= 0) {
                    if ($existingItem) {
                        $oldQty = (int) $existingItem->quantity;
                        if ($oldQty > 0 && $this->shouldDeductInventoryForChannel((int) $order->channel_id)) {
                            $this->restockInventoryForImportedOrder($order, $sku, $oldQty);
                        }
                        $existingItem->update($this->filterOrderItemColumns([
                            'quantity' => 0,
                            'unit_price' => 0,
                            'total_price' => 0,
                        ]));
                        $anyNewItem = true;
                    }

                    continue;
                }

                if ($existingItem) {
                    // Use the sku_id stored on the item (may differ from current resolved $sku->id after remapping).
                    $itemSkuId = (int) ($existingItem->sku_id ?? $sku->id);
                    if ((int) $existingItem->quantity === $lineQty && (float) $existingItem->unit_price === $lineUnit) {
                        // Backfill: if this line exists but stock was never deducted (historical bug / prior imports),
                        // deduct once for this order+SKU when eligible.
                        if (
                            $this->shouldDeductInventoryForChannel((int) $order->channel_id)
                            && ! $this->hasPriorImportedOrderDeduction((int) $order->id, $itemSkuId, $externalSkuCode)
                            && isset($this->importBatchNewOrderIds[(int) $order->id]) === false
                        ) {
                            if ($this->deductInventoryForImportedOrder(
                                $order,
                                $sku,
                                $lineQty,
                                $externalSkuCode !== '' ? $externalSkuCode : null
                            )) {
                                $anyNewItem = true;
                            }
                        }

                        continue;
                    }
                    // Price-only correction (e.g. SellerCentral line totals previously treated as unit price).
                    // Do not touch inventory on update: qty is unchanged and we are only fixing money fields.
                    if ((int) $existingItem->quantity === $lineQty && (float) $existingItem->unit_price !== $lineUnit) {
                        $existingItem->update($this->filterOrderItemColumns([
                            'unit_price' => $lineUnit,
                            'total_price' => $lineQty * $lineUnit,
                        ]));
                        $anyNewItem = true;

                        continue;
                    }

                    // Same SKU already linked to this order; avoid inserting a second line on re-import.
                    continue;
                }

                InventoryOrderItem::create($this->filterOrderItemColumns([
                    'inventory_order_id' => $order->id,
                    'sku_id' => $sku->id,
                    // Keep external SKU code for traceability, while sku_id points to the internal SKU used for inventory.
                    'sku_code' => $externalSkuCode !== '' ? $externalSkuCode : ($sku->sku ?? null),
                    'product_name' => $sku->name ?? $sku->sku ?? ($externalSkuCode !== '' ? $externalSkuCode : 'UNKNOWN'),
                    'quantity' => $lineQty,
                    'unit_price' => $lineUnit,
                    'total_price' => $lineQty * $lineUnit,
                ]));
                // Never deduct stock when re-importing sheets for orders that already existed before this import run.
                // Multi-line NEW orders still deduct: parent order id was registered in $importBatchNewOrderIds on create.
                // Pass $externalSkuCode so hasPriorImportedOrderDeduction can find the original OUT even when sku_id changed.
                if (
                    $this->shouldDeductInventoryForChannel((int) $order->channel_id)
                    && (
                        isset($this->importBatchNewOrderIds[(int) $order->id])
                        || ! $this->hasPriorImportedOrderDeduction((int) $order->id, (int) $sku->id, $externalSkuCode)
                    )
                ) {
                    $this->deductInventoryForImportedOrder(
                        $order,
                        $sku,
                        $lineQty,
                        $externalSkuCode !== '' ? $externalSkuCode : null
                    );
                }
                $anyNewItem = true;
            }

            DB::commit();

            // Return true if we created a new order OR added at least one new item
            // This ensures re-uploading the same file shows as "Skipped/Ignored" correctly
            return $anyNewItem || $order->wasRecentlyCreated || $headerUpdated;
        } catch (Exception $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * Manual import requires an explicit channel. Auto-from-sheet may omit channel_id and uses a marketplace anchor.
     */
    private function resolveImportChannelId(int $requestedChannelId, bool $lockChannel): int
    {
        if ($lockChannel) {
            if ($requestedChannelId <= 0) {
                throw ValidationException::withMessages([
                    'channel_id' => ['اختر قناة البيع عند رفع الشيت لقناة واحدة محددة.'],
                ]);
            }

            return $requestedChannelId;
        }

        if ($requestedChannelId > 0) {
            return $requestedChannelId;
        }

        return $this->pickAutoImportAnchorChannelId();
    }

    private function pickAutoImportAnchorChannelId(): int
    {
        $channels = Channel::query()
            ->where(function ($q) {
                $q->where('is_active', true)->orWhereNull('is_active');
            })
            ->orderBy('id')
            ->get();

        if ($channels->isEmpty()) {
            throw ValidationException::withMessages([
                'channel_id' => ['لا توجد قناة بيع في النظام. أضف قناة أمازون/نون أولاً أو اختر وضع القناة اليدوي.'],
            ]);
        }

        $amazonLike = $channels->first(fn (Channel $c) => $this->channelLooksLikeAmazonImportAnchor($c));
        if ($amazonLike) {
            return (int) $amazonLike->id;
        }

        $noonLike = $channels->first(fn (Channel $c) => $this->channelLooksLikeNoonImportAnchor($c));
        if ($noonLike) {
            return (int) $noonLike->id;
        }

        return (int) $channels->first()->id;
    }

    private function channelLooksLikeAmazonImportAnchor(Channel $channel): bool
    {
        $name = strtolower((string) ($channel->name ?? ''));
        $slug = strtolower((string) ($channel->slug ?? ''));

        return str_contains($name, 'amazon')
            || str_contains($name, 'أمازون')
            || str_contains($slug, 'amazon')
            || str_contains($name, 'fba')
            || str_contains($name, 'merchant')
            || str_contains($name, 'fbm')
            || str_contains($name, 'mfn')
            || str_contains($name, 'تاجر');
    }

    private function channelLooksLikeNoonImportAnchor(Channel $channel): bool
    {
        $name = strtolower((string) ($channel->name ?? ''));
        $slug = strtolower((string) ($channel->slug ?? ''));

        return str_contains($name, 'noon')
            || str_contains($name, 'نون')
            || str_contains($slug, 'noon');
    }

    private function buildImportContext(int $channelId): array
    {
        $channel = Channel::findOrFail($channelId);
        $slug = strtolower((string) ($channel->slug ?? ''));
        $name = strtolower((string) ($channel->name ?? ''));

        // Detect Noon platform even if slug is not "noon" (Arabic names, legacy slugs).
        // This only affects the row-mapping strategy; Amazon parsing remains unchanged otherwise.
        $isNoon = str_contains($slug, 'noon')
            || str_contains($name, 'noon')
            || str_contains((string) ($channel->name ?? ''), 'نون');

        $platform = $isNoon ? 'noon' : 'amazon';
        $channels = Channel::all();
        $defaultChannel = $channels->firstWhere('id', $channelId);

        return compact('platform', 'channels', 'defaultChannel');
    }

    /**
     * @param  array<string, float>  $stockSimRemaining  keyed by "{skuId}:{locationId}", remaining qty after prior sheet rows
     */
    private function analyzeOrderRow(array $row, string $platform, int $defaultChannelId, ?Channel $defaultChannel, $channels, bool $lockChannel, array &$stockSimRemaining): array
    {
        $orderData = $this->mapRowToOrderData($row, $platform);
        $uploadedOrderId = (string) ($orderData['platform_order_id'] ?? '');
        $uploadedSku = (string) ($orderData['items'][0]['sku_code'] ?? '');
        $uploadedQty = (int) ($orderData['items'][0]['quantity'] ?? 0);
        $uploadedUnitPrice = (float) ($orderData['items'][0]['unit_price'] ?? 0);

        if (! $orderData || $uploadedOrderId === '') {
            return [
                'status' => 'error',
                'reason' => 'Missing order number',
                'catalog_issue' => null,
                'uploaded_data' => [
                    'order_number' => $uploadedOrderId ?: null,
                    'sku' => $uploadedSku ?: null,
                    'quantity' => $uploadedQty ?: null,
                    'unit_price' => $uploadedUnitPrice ?: null,
                    'channel' => null,
                ],
                'existing_data' => null,
            ];
        }

        $resolvedChannelId = $lockChannel
            ? $defaultChannelId
            : $this->resolveChannelIdFromRow(
                $orderData['channel_hint'] ?? null,
                $orderData['fulfillment_hint'] ?? null,
                $orderData['sku_hint'] ?? null,
                $channels,
                $defaultChannelId,
                $defaultChannel
            );
        $resolvedChannelName = optional($channels->firstWhere('id', $resolvedChannelId))->name;

        $fulfillmentRaw = strtolower(trim((string) ($orderData['fulfillment_hint'] ?? '')));
        $detectedFulfillment = null;
        if ($fulfillmentRaw !== '') {
            if ($this->looksLikeFbaFulfillment($fulfillmentRaw)) {
                $detectedFulfillment = 'fba';
            } elseif ($this->looksLikeMerchantFulfillment($fulfillmentRaw)) {
                $detectedFulfillment = 'merchant';
            }
        }
        $resolvedChannelType = $this->isFbaChannel((int) $resolvedChannelId)
            ? 'fba'
            : (ChannelStockResolver::deductsFromMainStoreBucket((int) $resolvedChannelId) ? 'merchant' : 'other');
        $fulfillmentMismatch = $detectedFulfillment !== null
            && $resolvedChannelType !== 'other'
            && $detectedFulfillment !== $resolvedChannelType;

        $order = $this->findInventoryOrderForImport($row, $platform, $orderData);
        $matchedOrderId = $order ? (string) $order->platform_order_id : null;

        // Existing orders deduct using their saved channel, not the channel re-detected from the sheet row.
        $stockChannelId = $order ? (int) $order->channel_id : (int) $resolvedChannelId;

        $validItemFound = false;
        $existingSameItem = false;
        $sameSkuDifferentQty = false;
        $missingSkuCodes = [];
        $isCancelledRow = ! empty($orderData['is_cancelled']);
        if ($isCancelledRow && $uploadedOrderId !== '') {
            $validItemFound = true;
        }
        foreach (($orderData['items'] ?? []) as $itemData) {
            $skuCode = (string) ($itemData['sku_code'] ?? '');
            if ($skuCode === '' || strtoupper($skuCode) === 'UNKNOWN') {
                $missingSkuCodes[] = $skuCode ?: 'UNKNOWN';

                continue;
            }

            $sku = $this->resolveSkuForOrderItem($skuCode, $stockChannelId);
            if (! $sku) {
                $missingSkuCodes[] = $skuCode;

                continue;
            }

            $validItemFound = true;
            if ($order) {
                // Duplicate when order + SKU (tolerates sku_id drift) + quantity all match — mirrors {@see processOrderRow()}.
                $itemQty = (int) ($itemData['quantity'] ?? 1);
                $existingOi = $this->findExistingOrderItem((int) $order->id, (int) $sku->id, $skuCode);

                if ($existingOi && (int) $existingOi->quantity === $itemQty) {
                    $existingSameItem = true;
                } elseif ($this->orderHasSkuLineWithDifferentQty((int) $order->id, $skuCode, (int) $sku->id, $itemQty)) {
                    $sameSkuDifferentQty = true;
                }
            }
        }

        $status = 'new';
        $reason = 'Will be inserted as new order';
        $catalogIssue = null;

        $catalogSkuProblem = ! $validItemFound || ! empty($missingSkuCodes);
        if ($catalogSkuProblem) {
            $status = 'error';
            $uniqueSkus = array_values(array_unique($missingSkuCodes));
            $skuListStr = implode('», «', array_filter($uniqueSkus, static fn ($s) => $s !== null && $s !== ''));

            if (! $validItemFound && empty($missingSkuCodes)) {
                $catalogIssue = [
                    'ar' => 'لا يوجد في الكتالوج أي SKU صالح لهذا السطر.',
                    'en' => 'No valid SKU in catalog for this row.',
                ];
            } elseif ($skuListStr !== '') {
                $catalogIssue = [
                    'ar' => 'المنتج غير موجود أو غير مربوط بالنظام: «'.$skuListStr.'»',
                    'en' => 'SKU not found or not linked: «'.$skuListStr.'»',
                ];
            } else {
                $catalogIssue = [
                    'ar' => 'رمز المنتج (SKU) مفقود أو غير صالح.',
                    'en' => 'SKU code missing or invalid.',
                ];
            }
            // Keep {@see $reason} short — details live in {@see $catalogIssue} for the preview table.
            $reason = '';
        } elseif ($order) {
            if ($isCancelledRow) {
                if ($existingSameItem || $this->orderAlreadyReflectsSheetCancellation($order)) {
                    $status = 'duplicate';
                    $reason = 'Order already imported — cancellation unchanged';
                } else {
                    $status = 'update';
                    $reason = 'Existing order will be marked cancelled / line cleared from sheet';
                }
            } elseif ($existingSameItem) {
                $status = 'duplicate';
                $reason = 'Order item already exists (duplicate row)';
            } elseif ($sameSkuDifferentQty) {
                $status = 'new';
                $reason = 'Same order and SKU but quantity differs — treated as new line';
            } else {
                $status = 'update';
                $reason = 'Existing order will be updated with new item(s)';
            }
        } elseif ($uploadedOrderId !== '' && $matchedOrderId === null) {
            $reason = 'Will be inserted as new order | No matching order in system for sheet id «'.$uploadedOrderId.'» (check amazon-order-id vs merchant-order-id)';
        }

        if ($detectedFulfillment !== null) {
            $reason .= ($reason !== '' ? ' | ' : '').'Fulfillment: '.strtoupper($detectedFulfillment);
        }
        if ($fulfillmentMismatch) {
            $reason .= ($reason !== '' ? ' | ' : '').'⚠️ Fulfillment mismatch vs detected channel';
        }
        if (trim((string) $reason) === '') {
            $reason = '—';
        }

        // Stock preview must mirror {@see resolveSkuForOrderItem()} + deduction rules in {@see processOrderRow()}.
        $firstItem = ($orderData['items'][0] ?? []);
        $sheetSkuCode = (string) ($firstItem['sku_code'] ?? '');
        $qty = (int) ($firstItem['quantity'] ?? 0);
        $uploadedUnitPriceForStock = (float) ($firstItem['unit_price'] ?? 0);
        $resolvedSku = null;
        if ($sheetSkuCode !== '' && strtoupper($sheetSkuCode) !== 'UNKNOWN') {
            $resolvedSku = $this->resolveSkuForOrderItem($sheetSkuCode, $stockChannelId);
        }

        $wouldRequireStockDeduction = $this->sheetRowWillDeductStock(
            $status,
            $order,
            $resolvedSku,
            $qty,
            $uploadedUnitPriceForStock,
            $isCancelledRow,
            $stockChannelId,
            $sheetSkuCode   // pass external code so hasPriorImportedOrderDeduction survives SKU re-mappings
        );

        if ($wouldRequireStockDeduction && $status === 'duplicate') {
            $reason .= ($reason !== '' && $reason !== '—' ? ' | ' : '')
                .'Pending stock deduction for existing order (no prior inventory OUT)';
        }

        $stockPreview = null;
        if ($wouldRequireStockDeduction) {
            $fromMerchantBucket = ChannelStockResolver::deductsFromMainStoreBucket($stockChannelId);
            $merchantAvailBefore = 0.0;
            $storeAvailBefore = 0.0;
            $availableBeforeRow = 0.0;
            $shortage = true;
            $locId = 0;

            if ($fromMerchantBucket) {
                // planMerchantOrderDeduction deducts only from the main store (merchant channels have no
                // physical stock). The preview mirrors this: only store availability is counted.
                // Merchant channel locations may hold phantom stock (see reconcilePhantomMerchantStockForListingSku);
                // those are excluded here so the preview does not overcount available units.
                $cacheKey = $resolvedSku->id > 0
                    ? ('mplan:'.(string) $resolvedSku->id.':'.(string) $stockChannelId)
                    : null;
                $storeChannelId = ChannelStockResolver::resolveMainStoreChannelId();
                $storeSkuId = (int) (ChannelStockResolver::resolveStoreSkuIdForListingSku($resolvedSku) ?? 0);

                if ($cacheKey !== null) {
                    if (! array_key_exists($cacheKey, $stockSimRemaining)) {
                        $storeOnly = ($storeSkuId > 0 && $storeChannelId > 0)
                            ? ChannelStockResolver::availableQuantityForChannelSku($storeSkuId, $storeChannelId)
                            : 0.0;
                        $stockSimRemaining[$cacheKey] = [
                            'merchant' => 0.0,   // deduction never touches merchant channel locations
                            'store' => $storeOnly,
                        ];
                    }
                    $pool = $stockSimRemaining[$cacheKey];
                    if (! is_array($pool)) {
                        $pool = ['merchant' => 0.0, 'store' => (float) $pool];
                    }
                    $merchantAvailBefore = 0.0;
                    $storeAvailBefore = max(0.0, (float) ($pool['store'] ?? 0));
                    $availableBeforeRow = $storeAvailBefore;

                    $takeStore = min((float) $qty, $storeAvailBefore);
                    $shortage = ($takeStore + 1e-9) < (float) $qty;

                    if (! $shortage) {
                        $stockSimRemaining[$cacheKey] = [
                            'merchant' => 0.0,
                            'store' => max(0.0, $storeAvailBefore - $takeStore),
                        ];
                    }

                    $plan = ChannelStockResolver::planMerchantOrderDeduction((int) $resolvedSku->id, $stockChannelId, $qty);
                    $locId = (int) ($plan['store_location_id'] ?? $plan['merchant_location_id'] ?? 0);
                }
            } else {
                $stockScopeChannelId = ChannelStockResolver::resolveStockChannelIdForSku(
                    $resolvedSku,
                    $stockChannelId
                );
                $cacheKey = $resolvedSku->id > 0
                    ? ((string) $resolvedSku->id.':stkch:'.(string) $stockScopeChannelId)
                    : null;

                $locId = (int) (ChannelStockResolver::resolveDeductionLocationIdForSku(
                    (int) $resolvedSku->id,
                    $stockScopeChannelId,
                    $qty
                ) ?? 0);

                if ($cacheKey !== null) {
                    if (! array_key_exists($cacheKey, $stockSimRemaining)) {
                        $stockSimRemaining[$cacheKey] = ChannelStockResolver::availableQuantityForSkuAtChannelLocations(
                            $resolvedSku,
                            $stockScopeChannelId
                        );
                    }
                    $availableBeforeRow = max(0.0, (float) $stockSimRemaining[$cacheKey]);
                }

                $canFulfillAtOneLocation = ChannelStockResolver::hasFulfillableLocationForSku(
                    (int) $resolvedSku->id,
                    $stockScopeChannelId,
                    $qty
                );
                $shortage = ($cacheKey === null)
                    || ($availableBeforeRow + 1e-9 < (float) $qty)
                    || ! $canFulfillAtOneLocation;

                if (! $shortage && $cacheKey !== null) {
                    $stockSimRemaining[$cacheKey] = max(0.0, $availableBeforeRow - (float) $qty);
                }
            }

            $stockPreview = [
                'sku_id' => (int) $resolvedSku->id,
                'sku_code_internal' => trim((string) ($resolvedSku->sku ?? '')) ?: null,
                'deduction_location_id' => $locId > 0 ? $locId : null,
                'requested' => $qty,
                'available' => $availableBeforeRow,
                'merchant_available' => $fromMerchantBucket ? $merchantAvailBefore : null,
                'store_available' => $fromMerchantBucket ? $storeAvailBefore : null,
                'shortage' => $shortage,
                'deducts_from_store_bucket' => $fromMerchantBucket,
                'merchant_first_then_store' => $fromMerchantBucket,
                'would_require_deduction' => true,
                'backfill_pending' => $status === 'duplicate',
            ];
        }

        return [
            'status' => $status,
            'reason' => $reason,
            'catalog_issue' => $catalogIssue,
            'stock_preview' => $stockPreview,
            'fulfillment_detected' => $detectedFulfillment,
            'fulfillment_hint' => $orderData['fulfillment_hint'] ?? null,
            'fulfillment_mismatch' => $fulfillmentMismatch,
            'uploaded_data' => [
                'order_number' => $uploadedOrderId,
                'matched_order_number' => $matchedOrderId,
                'sku' => $uploadedSku ?: null,
                'quantity' => $uploadedQty,
                'unit_price' => $uploadedUnitPrice,
                'channel' => $resolvedChannelName,
                'order_date' => $orderData['order_date'] ?? null,
                'total_amount' => (float) ($orderData['total_amount'] ?? 0),
            ],
            'existing_data' => $order ? [
                'order_number' => $order->platform_order_id,
                'status' => $order->status,
                'channel' => optional($order->channel)->name,
                'order_date' => $order->order_date,
                'imported_at' => $order->created_at,
                'total_amount' => (float) ($order->total_amount ?? 0),
                'skus' => $order->items->pluck('sku_code')->filter()->values()->all(),
            ] : null,
        ];
    }

    /**
     * Map CSV row to standardized order data.
     */
    private function mapRowToOrderData(array $row, string $platform): ?array
    {
        if ($platform === 'amazon') {
            $orderId = $this->pick($row, [
                'amazon-order-id',
                'amazon order id',
                'order-id',
                'order_id',
                'order id',
                'order number',
                'order-number',
                'order_number',
                'merchant-order-id',
                'merchant order id',
                'amazon order number',
                'رقم الطلب من أمازون',
                'رقم الطلب',
                'رقم طلب',
                'رقم طلب التاجر',
            ]);
            $sku = $this->pick($row, [
                'sku',
                'merchant-sku',
                'merchant_sku',
                'merchant sku',
                'msku',
                'seller-sku',
                'seller_sku',
                'seller sku',
                'asin',
                'ASIN',
                'رقم تخزين سلعة التاجر msku',
                'رقم تخزين سلعة التاجر',
            ]);
            $purchaseDateParsed = $this->resolveAmazonPurchaseDate($row);
            $itemStatusRaw = $this->pick($row, [
                'item-status',
                'item_status',
                'item status',
                'order-item-status',
                'order_item_status',
                'order item status',
                'line-item-status',
                'line item status',
                'حالة السلعة',
                'حالة البند',
            ]);
            $orderStatusRaw = $this->pick($row, [
                'order-status',
                'order_status',
                'order status',
                'amazon-order-status',
                'amazon_order_status',
                'amazon order status',
                'order-status-primary',
                'order state',
                'order-state',
                'fulfillment-order-status',
                'fulfillment_order_status',
                'حالة الطلب',
                'حالة طلب أمازون',
                'حالة الطلب من أمازون',
                'حالة الطلب من امازون',
                'حالة الطلبية',
                'payment-status',
                'payment_status',
                'payment status',
                'حالة الدفع',
                // Last resort: some flat files use a single "status" for the order row.
                'status',
            ]);
            $isCancelled = $this->amazonSheetStatusIndicatesCancelled(
                (string) ($itemStatusRaw ?? ''),
                (string) ($orderStatusRaw ?? '')
            );

            $qtyRaw = $this->pick($row, [
                'quantity-purchased',
                'quantity_purchased',
                'quantity purchased',
                'quantity',
                'الكمية المشحونة',
                'الكمية',
            ]);
            $qtyParsed = $qtyRaw !== null && $qtyRaw !== '' ? (int) $qtyRaw : ($isCancelled ? 0 : 1);
            $qty = $isCancelled ? max(0, $qtyParsed) : max(1, $qtyParsed ?: 1);

            $itemPrice = $this->toNumber($this->pick($row, [
                'item-price',
                'item_price',
                'item price',
                'سعر المنتج',
                'price',
                'إجمالي رسوم المنتج',
                'الإجمالي',
            ]));
            $shippingPrice = $this->toNumber($this->pick($row, [
                'shipping-price',
                'shipping_price',
                'shipping price',
                'سعر الشحن',
                'shipping',
                'رسوم الشحن',
            ]));
            $customerEmail = $this->pick($row, [
                'buyer-email',
                'buyer_email',
                'buyer email',
                'البريد الإلكتروني للمشتري',
                'customer-email',
            ]);
            $customerName = $this->pick($row, [
                'buyer-name',
                'buyer_name',
                'buyer name',
                'اسم المشتري',
                'recipient-name',
                'اسم المستلم',
            ]);
            $channelHint = $this->pick($row, [
                'sales-channel',
                'sales_channel',
                'sales channel',
                'قناة المبيعات',
                'marketplace-name',
                'marketplace name',
            ]);
            $currency = $this->pick($row, ['currency', 'العملة', 'currency code', 'currency-code']) ?: 'EGP';

            if (empty($orderId)) {
                return null;
            }
            $orderId = $this->normalizeMarketplaceOrderId($this->normalizeImportSheetScalar($orderId));
            if ($orderId === '') {
                return null;
            }
            if ($isCancelled) {
                $unitPrice = 0.0;
                $total = 0.0;
            } else {
                // Seller Central exports often store *line total* (already multiplied by quantity),
                // so treating it as a unit price would double-count when we later compute qty * unit_price.
                $total = ($itemPrice + $shippingPrice);
                $unitPrice = ($qty > 0 && $total > 0) ? ($total / max(1, $qty)) : 0.0;
                if ($total <= 0) {
                    $total = $unitPrice * max(1, $qty);
                }
            }

            return [
                'platform_order_id' => $orderId,
                'order_date' => $purchaseDateParsed,
                'customer_email' => $customerEmail,
                'customer_name' => $customerName ?: 'Guest',
                'currency' => $currency,
                'shipping_amount' => $isCancelled ? 0.0 : $shippingPrice,
                'total_amount' => $total,
                'is_cancelled' => $isCancelled,
                'amazon_order_status' => trim((string) ($orderStatusRaw ?? '')),
                'item_status' => trim((string) ($itemStatusRaw ?? '')),
                'import_platform' => 'amazon',
                'channel_hint' => $channelHint,
                'fulfillment_hint' => $this->pick($row, [
                    'fulfillment-channel',
                    'fulfillment channel',
                    'fulfillment_channel',
                    'fulfilled-by',
                    'نوع التنفيذ',
                    'قناة الشحن',
                ]),
                'sku_hint' => $sku,
                'items' => [
                    [
                        'sku_code' => $sku ?: 'UNKNOWN',
                        'quantity' => $qty,
                        'unit_price' => $unitPrice > 0 ? $unitPrice : 0,
                    ],
                ],
            ];
        }

        // Noon implementation
        if ($platform === 'noon') {
            // Noon partners "Sales export" commonly has `item_nr` (e.g. NEGI....-2) and `offer_price`.
            // We treat `item_nr` as the stable order/item key for inventory_orders.platform_order_id.
            $unitPrice = $this->toNumber($this->pick($row, [
                'unit_price',
                'offer_price',
                'gmv_lcy',
                'price',
                'سعر المنتج',
            ]));
            $noonOid = $this->pick($row, [
                'order_number',
                'order nr',
                'order_nr',
                'order-id',
                'order_id',
                'رقم الطلب',
                'item_nr',
                'item nr',
                'item_nr',
            ]);
            $noonOid = $noonOid !== null ? $this->normalizeMarketplaceOrderId($noonOid) : null;
            if ($noonOid === '') {
                $noonOid = null;
            }
            $statusRaw = strtolower(trim((string) ($this->pick($row, ['status', 'الحالة']) ?? '')));
            $isCancelled = $statusRaw !== '' && (bool) preg_match('/cancel|cancell|ملغ|إلغاء/i', $statusRaw);
            $isReturn = ! $isCancelled && $statusRaw !== '' && (bool) preg_match('/\bcir\b|customer.*initiated.*return|مرتجع|إرجاع/i', $statusRaw);

            return [
                'platform_order_id' => $noonOid,
                'order_date' => date('Y-m-d H:i:s', strtotime($this->pick($row, [
                    'order_timestamp',
                    'order date',
                    'order_date',
                    'تاريخ الطلب',
                ]) ?? 'now')),
                'currency' => $this->pick($row, ['currency', 'العملة', 'currency code', 'currency-code']) ?: 'EGP',
                'shipping_amount' => 0.0,
                'total_amount' => $isCancelled ? 0.0 : $unitPrice,
                'is_cancelled' => $isCancelled,
                'noon_status_raw' => $statusRaw,
                'is_return' => $isReturn,
                'import_platform' => 'noon',
                'channel_hint' => $this->pick($row, ['sales-channel', 'قناة المبيعات']),
                'fulfillment_hint' => $this->pick($row, [
                    'fulfillment_model',
                    'fulfillment-channel',
                    'fulfillment channel',
                    'نوع التنفيذ',
                ]),
                'sku_hint' => $this->pick($row, ['partner_sku', 'partner sku', 'sku', 'msku', 'رقم تخزين سلعة التاجر msku']),
                'items' => [
                    [
                        'sku_code' => $this->pick($row, ['partner_sku', 'partner sku', 'sku', 'msku', 'رقم تخزين سلعة التاجر msku']) ?? 'UNKNOWN',
                        'quantity' => $isCancelled ? 0 : 1,
                        'unit_price' => $isCancelled ? 0.0 : $unitPrice,
                    ],
                ],
            ];
        }

        return null;
    }

    /**
     * Whether an Amazon orders-sheet row represents a cancelled line (item and/or order level).
     * Exports differ: cancellation often appears only in order-status (Arabic/English), not item-status.
     */
    private function amazonSheetStatusIndicatesCancelled(string ...$statusParts): bool
    {
        $chunks = [];
        foreach ($statusParts as $p) {
            $p = trim((string) $p);
            if ($p !== '') {
                $chunks[] = $p;
            }
        }
        if ($chunks === []) {
            return false;
        }
        $haystack = mb_strtolower(implode(' ', $chunks), 'UTF-8');

        return (bool) preg_match(
            '/\b(cancel(?:led|lation|ing)?|cancell)\b|'
            .'ملغ|إلغاء|الغاء|الإلغاء|تم\s*الإلغاء|تم\s*الغاء|طلب\s*ملغ|'
            .'voided|void\b|'
            .'payment\s*complete.*cancel|cancel.*payment/u',
            $haystack
        );
    }

    /**
     * Normalize marketplace order ids so DB lookups stay stable (BOM, unicode dashes, spaces).
     */
    private function normalizeMarketplaceOrderId(string $raw): string
    {
        $s = trim($raw);
        if ($s === '') {
            return '';
        }
        $s = preg_replace('/^\xEF\xBB\xBF/', '', $s);
        $s = trim($s, "'\"");
        $s = preg_replace('/[\x{2012}\x{2013}\x{2014}\x{2015}\x{2212}]/u', '-', $s);

        return (string) preg_replace('/\s+/u', '', $s);
    }

    /**
     * Excel / CSV cells may arrive as scientific notation (e.g. 1.11E+14) — normalize before order lookup.
     */
    private function normalizeImportSheetScalar(?string $value): string
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return '';
        }

        if (preg_match('/^[\d.]+[eE][+\-]?\d+$/', $raw)) {
            $float = (float) $raw;
            if ($float > 0) {
                return preg_replace('/\.0+$/', '', sprintf('%.0f', $float));
            }
        }

        return $raw;
    }

    /**
     * Resolve Amazon purchase / order date from named headers or known column positions (incl. column S).
     */
    private function resolveAmazonPurchaseDate(array $row): ?string
    {
        $named = $this->pick($row, [
            'purchase-date',
            'purchase_date',
            'purchase date',
            'تاريخ الشراء',
            'التاريخ',
            'payments-date',
            'payments date',
            'payments_date',
            'تاريخ المدفوعات',
            'posted-date',
            'posted date',
            's',
        ]);

        if ($named !== null && $named !== '') {
            $parsed = $this->parseMarketplaceDateTime($named);
            if ($parsed !== null) {
                return $parsed;
            }
        }

        // Positional fallbacks for common Amazon exports (0-based index).
        foreach ([2, 6, 18] as $index) {
            $positional = $this->amazonRowValueByPosition($row, $index);
            if ($positional === null) {
                continue;
            }
            $parsed = $this->parseMarketplaceDateTime($positional);
            if ($parsed !== null) {
                return $parsed;
            }
        }

        return null;
    }

    private function amazonRowValueByPosition(array $row, int $zeroBasedIndex): ?string
    {
        $values = array_values($row);
        if (! array_key_exists($zeroBasedIndex, $values)) {
            return null;
        }

        $value = trim((string) ($values[$zeroBasedIndex] ?? ''));
        if ($value === '') {
            return null;
        }

        return $this->normalizeImportSheetScalar($value);
    }

    private function parseMarketplaceDateTime(?string $raw): ?string
    {
        $value = trim((string) ($raw ?? ''));
        if ($value === '') {
            return null;
        }

        if (is_numeric($value)) {
            $serial = (float) $value;
            if ($serial > 20000 && $serial < 80000) {
                $unix = (int) round(($serial - 25569) * 86400);

                return date('Y-m-d H:i:s', $unix);
            }
        }

        $ts = strtotime($value);
        if ($ts !== false && $ts > 0) {
            return date('Y-m-d H:i:s', $ts);
        }

        return null;
    }

    private function orderAlreadyReflectsSheetCancellation(InventoryOrder $order): bool
    {
        $status = strtolower(trim((string) ($order->status ?? '')));
        $financial = strtolower(trim((string) ($order->financial_status ?? '')));

        return in_array($status, ['cancelled', 'canceled'], true)
            || in_array($financial, ['cancelled', 'canceled'], true);
    }

    /**
     * @return list<string>
     */
    private function extractOrderIdCandidates(string $rawOrderId): array
    {
        $raw = trim($rawOrderId);
        if ($raw === '') {
            return [];
        }

        $candidates = [$raw, trim($raw, " \t\n\r\0\x0B'\""), preg_replace('/\s+/', '', $raw)];
        $norm = $this->normalizeMarketplaceOrderId($this->normalizeImportSheetScalar($raw));
        if ($norm !== '') {
            $candidates[] = $norm;
        }

        if (preg_match('/\b\d{3}-\d{7}-\d{7}\b/', $raw, $m)) {
            $candidates[] = $m[0];
        }

        return array_values(array_unique(array_filter(array_map(
            static fn ($v) => trim((string) $v) !== '' ? trim((string) $v) : null,
            $candidates
        ))));
    }

    /**
     * Collect every order-id column from a sheet row (amazon + merchant + noon item_nr, etc.).
     *
     * @return list<string>
     */
    private function extractOrderIdCandidatesFromImportRow(array $row, string $platform): array
    {
        $keys = match ($platform) {
            'amazon' => [
                'amazon-order-id', 'amazon order id', 'order-id', 'order_id', 'order id',
                'order number', 'order-number', 'order_number',
                'merchant-order-id', 'merchant order id',
                'رقم الطلب من أمازون', 'رقم الطلب', 'رقم طلب', 'رقم طلب التاجر',
            ],
            'noon' => [
                'order_number', 'order nr', 'order_nr', 'order-id', 'order_id', 'رقم الطلب',
                'item_nr', 'item nr', 'item-nr',
            ],
            default => ['order-id', 'order_id', 'order id', 'order number', 'order-number', 'order_number'],
        };

        $collected = [];
        foreach ($keys as $key) {
            if (! array_key_exists($key, $row) || $row[$key] === null || trim((string) $row[$key]) === '') {
                continue;
            }
            $collected = array_merge($collected, $this->extractOrderIdCandidates(
                $this->normalizeImportSheetScalar((string) $row[$key])
            ));
        }

        return array_values(array_unique($collected));
    }

    /**
     * Find an existing order using every id variant present in the sheet row.
     *
     * @param  array<string, mixed>  $orderData
     */
    private function findInventoryOrderForImport(array $row, string $platform, array $orderData): ?InventoryOrder
    {
        $candidates = array_values(array_unique(array_merge(
            $this->extractOrderIdCandidatesFromImportRow($row, $platform),
            $this->extractOrderIdCandidates((string) ($orderData['platform_order_id'] ?? ''))
        )));

        if ($candidates === []) {
            return null;
        }

        $order = InventoryOrder::query()
            ->whereIn('platform_order_id', $candidates)
            ->where('user_id', auth()->id())
            ->with(['channel', 'items'])
            ->orderByDesc('id')
            ->first();

        if ($order) {
            return $order;
        }

        return InventoryOrder::withoutGlobalScope('user_isolation')
            ->whereIn('platform_order_id', $candidates)
            ->whereNull('user_id')
            ->with(['channel', 'items'])
            ->orderByDesc('id')
            ->first();
    }

    /**
     * True when the order already has this SKU but with a different quantity (not a duplicate re-upload).
     */
    private function orderHasSkuLineWithDifferentQty(int $orderId, string $skuCode, int $skuId, int $sheetQty): bool
    {
        if ($orderId <= 0 || $sheetQty <= 0) {
            return false;
        }

        return InventoryOrderItem::query()
            ->where('inventory_order_id', $orderId)
            ->where(function ($q) use ($skuId, $skuCode) {
                $q->where('sku_id', $skuId);
                if ($skuCode !== '') {
                    $q->orWhere('sku_code', $skuCode);
                }
            })
            ->where('quantity', '!=', $sheetQty)
            ->exists();
    }

    private function pick(array $row, array $keys): ?string
    {
        foreach ($keys as $key) {
            if (array_key_exists($key, $row) && $row[$key] !== null && $row[$key] !== '') {
                return $this->normalizeImportSheetScalar(trim((string) $row[$key]));
            }
        }

        return null;
    }

    private function filterOrderColumns(array $payload): array
    {
        if ($this->orderColumns === null) {
            $this->orderColumns = array_flip(
                Schema::getColumnListing((new InventoryOrder)->getTable())
            );
        }

        return array_intersect_key($payload, $this->orderColumns);
    }

    private function resolveImportOrderCurrency(array $orderData): string
    {
        $currency = strtoupper(trim((string) ($orderData['currency'] ?? '')));

        return strlen($currency) === 3 ? $currency : 'EGP';
    }

    /**
     * Header row for a newly imported marketplace order — fills PostgreSQL NOT NULL money columns.
     */
    private function buildImportOrderHeaderPayload(array $orderData, int $channelId, bool $isCancelled): array
    {
        $totalAmount = $isCancelled ? 0.0 : (float) ($orderData['total_amount'] ?? 0);
        $orderStatus = $this->resolveImportOrderStatus($orderData, $isCancelled);

        return $this->filterOrderColumns([
            'channel_id' => $channelId,
            'order_date' => $orderData['order_date'] ?? now()->toDateTimeString(),
            'customer_name' => $orderData['customer_name'] ?? 'Guest',
            'customer_email' => $orderData['customer_email'] ?? null,
            'shipping_address' => $orderData['shipping_address'] ?? null,
            'currency' => $this->resolveImportOrderCurrency($orderData),
            'total_amount' => $totalAmount,
            'shipping_amount' => $isCancelled ? 0.0 : (float) ($orderData['shipping_amount'] ?? 0),
            'tax_amount' => $isCancelled ? 0.0 : (float) ($orderData['tax_amount'] ?? 0),
            'discount_amount' => $isCancelled ? 0.0 : (float) ($orderData['discount_amount'] ?? 0),
            'payment_type' => 'credit',
            'paid_amount' => 0,
            'remaining_amount' => $totalAmount,
            'status' => $orderStatus,
            'financial_status' => $isCancelled ? 'cancelled' : 'pending',
            'settlement_status' => $isCancelled ? 'cancelled' : 'pending',
            'user_id' => auth()->id(),
        ]);
    }

    /**
     * Map Amazon order-status / item-status from Seller Central export to inventory_orders.status.
     */
    private function mapAmazonOrderStatusToInternal(string $orderStatusRaw, string $itemStatusRaw): string
    {
        $haystack = mb_strtolower(trim($orderStatusRaw.' '.$itemStatusRaw), 'UTF-8');
        if ($haystack === '') {
            return 'processing';
        }

        if ((bool) preg_match(
            '/\b(cancel(?:led|lation|ing)?|cancell)\b|ملغ|إلغاء|الغاء|voided|void\b/u',
            $haystack
        )) {
            return 'cancelled';
        }

        if ((bool) preg_match(
            '/return(?:ed|ing)?\s*to\s*seller|returned\s*to\s*seller|reject(?:ed|ion)?\s*by\s*buyer|'
            .'returning\s*to\s*seller|مرتجع|إرجاع|رفض/u',
            $haystack
        )) {
            return 'returned';
        }

        if ((bool) preg_match('/delivered|تم\s*التسليم|تم\s*التوصيل/u', $haystack)) {
            return 'delivered';
        }

        if ((bool) preg_match('/\bshipped\b|تم\s*الشحن/u', $haystack)) {
            return 'shipped';
        }

        if ((bool) preg_match('/\b(pending|unshipped|awaiting)\b|في\s*الانتظار/u', $haystack)) {
            return 'pending';
        }

        if ((bool) preg_match('/\b(sold|completed|complete)\b/u', $haystack)) {
            return 'sold';
        }

        return 'processing';
    }

    private function resolveImportOrderStatus(array $orderData, bool $isCancelled): string
    {
        if ($isCancelled) {
            return 'cancelled';
        }

        $platform = strtolower(trim((string) ($orderData['import_platform'] ?? '')));

        if ($platform === 'amazon') {
            return $this->mapAmazonOrderStatusToInternal(
                (string) ($orderData['amazon_order_status'] ?? ''),
                (string) ($orderData['item_status'] ?? '')
            );
        }

        if ($platform === 'noon') {
            return $this->mapNoonOrderStatusToInternal(
                (string) ($orderData['noon_status_raw'] ?? ''),
                (bool) ($orderData['is_return'] ?? false)
            );
        }

        return 'processing';
    }

    /**
     * Map Noon sales-export `status` column to inventory_orders.status values.
     * Noon statuses: Delivered, Shipped, Processing, CIR (Customer Initiated Return),
     * Could Not Be Delivered, Cancelled (handled separately via is_cancelled).
     */
    private function mapNoonOrderStatusToInternal(string $statusRaw, bool $isReturn): string
    {
        if ($isReturn || (bool) preg_match('/\bcir\b|customer.*initiated.*return|مرتجع|إرجاع/i', $statusRaw)) {
            return 'returned';
        }

        $s = strtolower(trim($statusRaw));

        if ((bool) preg_match('/\bdelivered\b|تم\s*التسليم|تم\s*التوصيل/u', $s)) {
            return 'delivered';
        }

        if ((bool) preg_match('/\bshipped\b|تم\s*الشحن/u', $s)) {
            return 'shipped';
        }

        if ((bool) preg_match('/could\s*not\s*be\s*delivered|undeliverable|فشل\s*التوصيل|لم\s*يتم\s*التوصيل/u', $s)) {
            return 'rejected';
        }

        if ((bool) preg_match('/\bprocessing\b|قيد\s*المعالجة/u', $s)) {
            return 'processing';
        }

        return 'processing';
    }

    /**
     * When one Amazon order id spans multiple import rows, keep the most advanced fulfillment status.
     */
    private function mergeImportOrderStatus(?string $current, string $incoming): string
    {
        $current = strtolower(trim((string) ($current ?? '')));
        $incoming = strtolower(trim($incoming));
        if ($incoming === '') {
            return $current !== '' ? $current : 'processing';
        }
        if ($current === '') {
            return $incoming;
        }
        if ($current === 'cancelled' || $incoming === 'cancelled') {
            return 'cancelled';
        }
        if ($current === 'returned' || $incoming === 'returned') {
            return 'returned';
        }

        $rank = [
            'pending' => 1,
            'processing' => 2,
            'shipped' => 3,
            'sold' => 4,
            'delivered' => 5,
            'rejected' => 3,
            'return_in_progress' => 4,
        ];

        $curRank = $rank[$current] ?? 2;
        $inRank = $rank[$incoming] ?? 2;

        return $inRank >= $curRank ? $incoming : $current;
    }

    private function filterOrderItemColumns(array $payload): array
    {
        if ($this->orderItemColumns === null) {
            $this->orderItemColumns = array_flip(
                Schema::getColumnListing((new InventoryOrderItem)->getTable())
            );
        }

        return array_intersect_key($payload, $this->orderItemColumns);
    }

    private function filterTransactionColumns(array $payload): array
    {
        if ($this->transactionColumns === null) {
            $this->transactionColumns = array_flip(
                Schema::getColumnListing((new InventoryTransaction)->getTable())
            );
        }

        return array_intersect_key($payload, $this->transactionColumns);
    }

    private function toNumber($value): float
    {
        $raw = trim((string) ($value ?? '0'));
        if ($raw === '') {
            return 0;
        }
        $normalized = str_replace([',', ' '], '', $raw);

        return (float) $normalized;
    }

    /**
     * Whether {@see processOrderRow()} will attempt stock deduction for this analyzed sheet line.
     *
     * Uses $externalSkuCode alongside $sku->id so that the preview/gate correctly mirrors the
     * sku_code-aware lookups in processOrderRow after SKU re-mappings.
     */
    private function sheetRowWillDeductStock(
        string $rowStatus,
        ?InventoryOrder $existingOrder,
        ?Sku $sku,
        int $quantity,
        float $unitPrice,
        bool $isCancelledRow,
        int $channelIdForStock,
        string $externalSkuCode = ''
    ): bool {
        if ($rowStatus === 'error' || $isCancelledRow || $quantity <= 0 || ! $sku) {
            return false;
        }

        if (! $this->shouldDeductInventoryForChannel($channelIdForStock)) {
            return false;
        }

        if ($rowStatus === 'new') {
            return true;
        }

        if (! $existingOrder) {
            return false;
        }

        $existingOi = $this->findExistingOrderItem((int) $existingOrder->id, (int) $sku->id, $externalSkuCode);

        if ($rowStatus === 'update') {
            return $existingOi === null;
        }

        if ($rowStatus === 'duplicate' && $existingOi) {
            $itemSkuId = (int) ($existingOi->sku_id ?? $sku->id);

            return (int) $existingOi->quantity === $quantity
                && abs((float) $existingOi->unit_price - $unitPrice) < 0.0001
                && ! $this->hasPriorImportedOrderDeduction((int) $existingOrder->id, $itemSkuId, $externalSkuCode);
        }

        return false;
    }

    /**
     * Find an InventoryOrderItem matching this order, tolerating SKU re-mappings.
     *
     * Checks by sku_id first; if not found and an external marketplace code is available,
     * also checks by sku_code so that historical items imported under a different sku_id
     * (before a re-mapping) are still recognised as the same line.
     */
    private function findExistingOrderItem(int $orderId, int $skuId, string $externalSkuCode = ''): ?InventoryOrderItem
    {
        $q = InventoryOrderItem::query()->where('inventory_order_id', $orderId);

        if ($externalSkuCode !== '') {
            return $q->where(function ($inner) use ($skuId, $externalSkuCode) {
                $inner->where('sku_id', $skuId)
                    ->orWhere('sku_code', $externalSkuCode);
            })->first();
        }

        return $q->where('sku_id', $skuId)->first();
    }

    private function findSkuByCode(string $skuCode): ?Sku
    {
        $c = trim($skuCode);
        if ($c === '') {
            return null;
        }

        $match = static fn ($q) => $q->where('sku', $c)->orWhere('marketplace_id', $c);

        return Sku::query()
            ->with('offer')
            ->where($match)
            ->where('user_id', auth()->id())
            ->first()
            ?? Sku::query()->with('offer')->where($match)->first();
    }

    /**
     * SKU row for a specific sales channel (e.g. main store channel).
     */
    private function findSkuByCodeForChannel(string $skuCode, int $channelId): ?Sku
    {
        $c = trim($skuCode);
        if ($c === '' || $channelId <= 0) {
            return null;
        }

        return Sku::query()
            ->where('channel_id', $channelId)
            ->where(function ($q) use ($c) {
                $q->where('sku', $c)->orWhere('marketplace_id', $c);
            })
            ->orderByDesc('id')
            ->first();
    }

    /**
     * Pick sku_id that has positive stock at this location for the given MSKU (sheet code).
     * Fixes wrong row selection when multiple sku rows share the same code or main-store channel id mismatches.
     *
     * @return int|null sku_id or null
     */
    private function findBestSkuIdForCodeAtLocation(string $skuCode, int $locationId): ?int
    {
        $code = trim($skuCode);
        if ($code === '' || $locationId <= 0) {
            return null;
        }

        $row = SkuInventory::query()
            ->where('location_id', $locationId)
            ->where('quantity', '>', 0)
            ->whereHas('sku', static fn ($q) => $q->where('sku', $code))
            ->orderByDesc('quantity')
            ->first(['sku_id']);

        if ($row) {
            return (int) $row->sku_id;
        }

        // Sheet MSKU often differs from المحل SKU (e.g. 1X-HWKQ-* vs PHY…): use same master product stock at this location.
        $sheetSku = $this->findSkuByCode($code);
        $masterId = (int) ($sheetSku?->offer?->master_product_id ?? 0);
        if ($masterId <= 0) {
            return null;
        }

        $siblingRow = SkuInventory::query()
            ->where('location_id', $locationId)
            ->where('quantity', '>', 0)
            ->whereHas('sku', static function ($q) use ($masterId) {
                $q->whereHas('offer', static fn ($oq) => $oq->where('master_product_id', $masterId));
            })
            ->orderByDesc('quantity')
            ->first(['sku_id']);

        return $siblingRow ? (int) $siblingRow->sku_id : null;
    }

    /**
     * Store-channel SKU for a master product that has fulfillable qty at the deduction location.
     */
    private function findStoreSkuForMasterAtLocation(int $masterProductId, int $storeChannelId, int $locationId, int $minQty = 1): ?Sku
    {
        if ($masterProductId <= 0 || $storeChannelId <= 0 || $locationId <= 0) {
            return null;
        }

        $skuId = (int) (SkuInventory::query()
            ->where('location_id', $locationId)
            ->where('quantity', '>=', max(1, $minQty))
            ->whereHas('sku', static function ($q) use ($storeChannelId, $masterProductId) {
                $q->where('channel_id', $storeChannelId)
                    ->whereHas('offer', static fn ($oq) => $oq->where('master_product_id', $masterProductId));
            })
            ->orderByDesc('quantity')
            ->value('sku_id') ?? 0);

        return $skuId > 0 ? Sku::query()->find($skuId) : null;
    }

    /**
     * Fallback store listing row for a master product (may have zero stock).
     */
    private function findStoreSkuForMaster(int $masterProductId, int $storeChannelId): ?Sku
    {
        if ($masterProductId <= 0 || $storeChannelId <= 0) {
            return null;
        }

        return Sku::query()
            ->where('channel_id', $storeChannelId)
            ->whereHas('offer', static fn ($q) => $q->where('master_product_id', $masterProductId))
            ->orderByDesc('id')
            ->first();
    }

    private function resolveSkuForOrderItem(string $externalSkuCode, int $orderChannelId): ?Sku
    {
        $externalSkuCode = trim($externalSkuCode);
        if ($externalSkuCode === '' || strtoupper($externalSkuCode) === 'UNKNOWN') {
            return null;
        }

        if (! ChannelStockResolver::deductsFromMainStoreBucket($orderChannelId)) {
            $onChannel = $this->findSkuByCodeForChannel($externalSkuCode, $orderChannelId);

            return $onChannel ?? $this->findSkuByCode($externalSkuCode);
        }

        // Merchant/MFN: order line uses listing SKU; deduction tries merchant stock first, then المحل (see planMerchantOrderDeduction).
        return $this->findSkuByCodeForChannel($externalSkuCode, $orderChannelId)
            ?? $this->findSkuByCode($externalSkuCode);
    }

    /**
     * True when at least one OUT inventory_transaction exists for this order+SKU pair.
     *
     * Accepts $externalSkuCode so that re-imports after a SKU re-mapping still find the original
     * deduction: if sku_id changed (old=42 → new=99) but sku_code "ASIN-ABC" stays on the item,
     * we retrieve all sku_ids ever linked to this order via that code and check any of them.
     * Without this, hasPriorImportedOrderDeduction(orderId, 99) returns false even though the
     * original OUT transaction was recorded for sku_id=42, triggering a double deduction.
     */
    private function hasPriorImportedOrderDeduction(int $orderId, int $skuId, string $externalSkuCode = ''): bool
    {
        if ($orderId <= 0) {
            return false;
        }

        // Build the candidate set of sku_ids to probe.  The OUT may be recorded under a
        // different sku_id than what's on the order item for two distinct reasons:
        //
        //   A) SKU drift: 2026-02-25 migration made SKUs per-channel, so sku_id can change
        //      after a re-mapping while sku_code on the item stays constant.
        //
        //   B) Merchant-channel deduction: planMerchantOrderDeduction always deducts from
        //      the STORE's sku_id (resolved via master_product link, not sku_code string).
        //      The listing (merchant) sku_id on the order item is a different row even for
        //      the same physical product — the store may also use a completely different
        //      sku/marketplace_id string, so string-based lookup misses it entirely.

        $skuIds = $skuId > 0 ? [$skuId] : [];

        if ($externalSkuCode !== '') {
            // A-1: sku_ids stored on this order's items for the same sku_code (handles drift).
            $fromItems = InventoryOrderItem::query()
                ->where('inventory_order_id', $orderId)
                ->where('sku_code', $externalSkuCode)
                ->pluck('sku_id')
                ->filter(fn ($id) => (int) $id > 0)
                ->map(fn ($id) => (int) $id)
                ->all();

            // A-2: all sku_ids sharing this sku/marketplace_id string across channels for
            //      this user (covers cases where the store also registers the same code).
            $userId = InventoryOrder::withoutGlobalScope('user_isolation')->where('id', $orderId)->value('user_id');
            $fromAllChannels = $userId
                ? Sku::query()
                    ->where('user_id', (int) $userId)
                    ->where(function ($q) use ($externalSkuCode) {
                        $q->where('sku', $externalSkuCode)
                            ->orWhere('marketplace_id', $externalSkuCode);
                    })
                    ->pluck('id')
                    ->map(fn ($id) => (int) $id)
                    ->all()
                : [];

            $skuIds = array_values(array_unique(array_merge($skuIds, $fromItems, $fromAllChannels)));
        }

        // B: for each candidate sku, resolve its store counterpart via master_product link —
        //    this is the same logic used by planMerchantOrderDeduction when choosing which
        //    sku_id to record the OUT transaction under.  Without this step, merchant orders
        //    whose store SKU uses a different code are permanently flagged as un-deducted.
        $storeIds = [];
        foreach ($skuIds as $candidateSkuId) {
            $candidateSku = Sku::with('offer')->find($candidateSkuId);
            if (! $candidateSku) {
                continue;
            }
            $resolved = ChannelStockResolver::resolveStoreSkuIdForListingSku($candidateSku);
            if ($resolved && (int) $resolved > 0) {
                $storeIds[] = (int) $resolved;
            }
        }
        $skuIds = array_values(array_unique(array_merge($skuIds, $storeIds)));

        if ($skuIds === []) {
            return false;
        }

        return InventoryTransaction::query()
            ->where('reference_type', 'ImportedOrder')
            ->where('reference_id', (string) $orderId)
            ->whereIn('sku_id', $skuIds)
            ->where('type', 'OUT')
            ->exists();
    }

    /**
     * @return bool True if stock was deducted; false if skipped (recorded in {@see $importStockShortages}).
     */
    private function deductInventoryForImportedOrder(InventoryOrder $order, Sku $sku, int $quantity, ?string $sheetSkuCode = null): bool
    {
        if ($quantity <= 0) {
            return true;
        }

        $channelId = (int) $order->channel_id;
        if (ChannelStockResolver::deductsFromMainStoreBucket($channelId)) {
            $plan = ChannelStockResolver::planMerchantOrderDeduction((int) $sku->id, $channelId, (float) $quantity);
            if (! $plan['can_fulfill']) {
                $combined = (float) $plan['merchant_available'] + (float) $plan['store_available'];
                $this->recordImportStockShortage($order, $sku, $quantity, $combined, 'insufficient', $sheetSkuCode, $plan);

                return false;
            }

            $ok = true;
            if ($plan['deduct_merchant_qty'] > 0.0000001) {
                $ok = $this->applyImportStockOutAtLocation(
                    $order,
                    (int) $sku->id,
                    (int) $plan['merchant_location_id'],
                    (float) $plan['deduct_merchant_qty'],
                    $sheetSkuCode,
                    'Marketplace order import (merchant channel)'
                ) && $ok;
            }
            if ($plan['deduct_store_qty'] > 0.0000001 && ! empty($plan['store_sku_id'])) {
                $ok = $this->applyImportStockOutAtLocation(
                    $order,
                    (int) $plan['store_sku_id'],
                    (int) $plan['store_location_id'],
                    (float) $plan['deduct_store_qty'],
                    $sheetSkuCode,
                    'Marketplace order import (main store fallback)'
                ) && $ok;
            }

            return $ok;
        }

        $locationId = ChannelStockResolver::resolveDeductionLocationIdForSku(
            (int) $sku->id,
            ChannelStockResolver::resolveStockChannelIdForSku($sku, $channelId),
            $quantity
        );
        if (! $locationId) {
            Log::warning('Order import inventory deduction skipped: no location', [
                'order_id' => $order->id,
                'platform_order_id' => $order->platform_order_id,
                'channel_id' => $order->channel_id,
                'sku_id' => $sku->id,
            ]);
            $this->recordImportStockShortage($order, $sku, $quantity, 0.0, 'no_location', $sheetSkuCode);

            return false;
        }

        return $this->applyImportStockOutAtLocation(
            $order,
            (int) $sku->id,
            (int) $locationId,
            (float) $quantity,
            $sheetSkuCode,
            'Marketplace order import deduction'
        );
    }

    private function applyImportStockOutAtLocation(
        InventoryOrder $order,
        int $skuId,
        int $locationId,
        float $quantity,
        ?string $sheetSkuCode,
        string $note
    ): bool {
        if ($skuId <= 0 || $locationId <= 0 || $quantity <= 0) {
            return false;
        }

        $inventory = SkuInventory::query()
            ->where('sku_id', $skuId)
            ->where('location_id', $locationId)
            ->lockForUpdate()
            ->first();

        if (! $inventory) {
            $inventory = SkuInventory::create([
                'sku_id' => $skuId,
                'location_id' => $locationId,
                'quantity' => 0,
                'reserved' => 0,
                'user_id' => Auth::id(),
            ]);
            $inventory = SkuInventory::query()->whereKey($inventory->id)->lockForUpdate()->first();
        }

        $rawAvailable = (float) ($inventory->quantity ?? 0);
        $available = max(0.0, $rawAvailable);
        if ($available + 1e-9 < (float) $quantity) {
            $sku = Sku::query()->find($skuId);
            $this->recordImportStockShortage(
                $order,
                $sku ?? new Sku(['id' => $skuId]),
                (int) ceil($quantity),
                $available,
                'insufficient',
                $sheetSkuCode
            );

            return false;
        }

        $affected = SkuInventory::query()
            ->whereKey($inventory->id)
            ->where('quantity', '>=', $quantity)
            ->decrement('quantity', $quantity);

        if ($affected !== 1) {
            $fresh = SkuInventory::query()->whereKey($inventory->id)->first();
            $freshAvailable = max(0.0, (float) ($fresh?->quantity ?? 0));
            $sku = Sku::query()->find($skuId);
            $this->recordImportStockShortage(
                $order,
                $sku ?? new Sku(['id' => $skuId]),
                (int) ceil($quantity),
                $freshAvailable,
                'insufficient',
                $sheetSkuCode
            );

            return false;
        }

        // SAVEPOINT wraps decrement + INSERT as a nested unit inside the outer processOrderRow
        // transaction. If the unique index uq_txn_one_out_per_order_sku fires (concurrent import
        // won the race), we ROLLBACK TO the savepoint — undoing the decrement atomically — without
        // aborting the outer transaction. A plain try/catch is NOT enough in PostgreSQL: after a
        // failed query the connection enters an aborted state and every subsequent query throws
        // "current transaction is aborted", making the outer commit() also fail.
        $savepointName = 'sp_deduct_'.$skuId.'_'.(int) $order->id;
        DB::statement("SAVEPOINT {$savepointName}");

        try {
            $created = InventoryTransaction::create($this->filterTransactionColumns([
                'sku_id' => $skuId,
                'location_id' => $locationId,
                'type' => 'OUT',
                'quantity' => $quantity,
                'reference_type' => 'ImportedOrder',
                'reference_id' => (string) $order->id,
                'user_id' => Auth::id(),
                'notes' => $note,
            ]));

            DB::statement("RELEASE SAVEPOINT {$savepointName}");
            $this->importBatchStockOutTransactionIds[] = (int) $created->id;
        } catch (\Illuminate\Database\UniqueConstraintViolationException $e) {
            // Concurrent import already inserted the OUT for this (order, sku_id).
            // Roll back to the savepoint: this undoes the stock decrement above.
            // The outer transaction (InventoryOrderItem creation, order updates) is unharmed.
            DB::statement("ROLLBACK TO SAVEPOINT {$savepointName}");
            DB::statement("RELEASE SAVEPOINT {$savepointName}");

            Log::info('Import deduction skipped: concurrent import already deducted', [
                'order_id' => $order->id,
                'platform_id' => $order->platform_order_id,
                'sku_id' => $skuId,
            ]);
        }

        return true;
    }

    /**
     * Preview + post-import shortage lines. Must say clearly that deduction did not run (avoid “will deduct from store” wording).
     *
     * @return array{ar: string, en: string}
     */
    private function marketplaceImportStockShortageMessages(
        string $orderId,
        string $skuDisplay,
        int $requested,
        float $available,
        bool $merchantDeductionBucket,
        ?float $merchantAvailable = null,
        ?float $storeAvailable = null
    ): array {
        $availStr = abs($available - round($available)) < 1e-9
            ? (string) (int) round($available)
            : (string) round($available, 4);

        if ($merchantDeductionBucket) {
            $mStr = $merchantAvailable !== null
                ? (string) (int) round(max(0.0, $merchantAvailable))
                : '?';
            $sStr = $storeAvailable !== null
                ? (string) (int) round(max(0.0, $storeAvailable))
                : '?';

            return [
                'ar' => 'لم يُنفَّذ خصم المخزون. الطلب «'.$orderId.'» — SKU «'.$skuDisplay.'»: المطلوب '.$requested
                    .' — متاح تاجر '.$mStr.' + محل '.$sStr.' (= '.$availStr.'). '
                    .'يُخصم من التاجر أولاً ثم المحل؛ الرصيد الإجمالي غير كافٍ.',
                'en' => 'Stock was NOT deducted. Order «'.$orderId.'», SKU «'.$skuDisplay.'»: need '.$requested
                    .', merchant '.$mStr.' + store '.$sStr.' (= '.$availStr.'). '
                    .'Merchant channel first, then main store — insufficient combined stock.',
            ];
        }

        return [
            'ar' => 'لم يُنفَّذ خصم المخزون. الطلب «'.$orderId.'» — SKU «'.$skuDisplay.'»: المطلوب '.$requested.' والمتاح '.$availStr.' في موقع الخصم.',
            'en' => 'Stock was NOT deducted. Order «'.$orderId.'», SKU «'.$skuDisplay.'»: requested '.$requested.', available '.$availStr.' at the deduction location.',
        ];
    }

    /**
     * @param  'no_location'|'insufficient'  $reason
     */
    private function recordImportStockShortage(
        InventoryOrder $order,
        Sku $sku,
        int $requested,
        float $available,
        string $reason,
        ?string $sheetSkuCode = null,
        ?array $merchantPlan = null
    ): void {
        $displayCode = trim((string) ($sheetSkuCode ?? '')) !== ''
            ? trim((string) $sheetSkuCode)
            : trim((string) ($sku->sku ?? ''));
        if ($displayCode === '') {
            $displayCode = (string) $sku->id;
        }
        $platformId = (string) ($order->platform_order_id ?? '');
        $internalSku = trim((string) ($sku->sku ?? ''));
        $fromMerchant = ChannelStockResolver::deductsFromMainStoreBucket((int) $order->channel_id);

        if ($reason === 'no_location') {
            $messageAr = "تعذر تحديد موقع المخزون — لم يُخصم. الطلب «{$platformId}» — SKU «{$displayCode}».";
            $messageEn = "No deduction: inventory location missing for order «{$platformId}», SKU «{$displayCode}».";
        } else {
            $msgs = $this->marketplaceImportStockShortageMessages(
                $platformId,
                $displayCode,
                $requested,
                $available,
                $fromMerchant,
                is_array($merchantPlan) ? (float) ($merchantPlan['merchant_available'] ?? null) : null,
                is_array($merchantPlan) ? (float) ($merchantPlan['store_available'] ?? null) : null
            );
            $messageAr = $msgs['ar'];
            $messageEn = $msgs['en'];
        }

        $this->importStockShortages[] = [
            'platform_order_id' => $platformId,
            'sku_code_sheet' => $sheetSkuCode,
            'sku_code_internal' => $internalSku !== '' ? $internalSku : null,
            'sku_id' => (int) $sku->id,
            'location_id' => ChannelStockResolver::resolveDeductionLocationIdForChannel((int) $order->channel_id),
            'requested' => $requested,
            'available' => $available,
            'reason' => $reason,
            'deducts_from_store_bucket' => $fromMerchant,
            'message_ar' => $messageAr,
            'message_en' => $messageEn,
        ];
    }

    /**
     * Reverse a prior import deduction when a line is cancelled in a newer orders report.
     */
    private function restockInventoryForImportedOrder(InventoryOrder $order, Sku $sku, int $quantity): void
    {
        if ($quantity <= 0) {
            return;
        }

        $locationId = ChannelStockResolver::resolveDeductionLocationIdForChannel((int) $order->channel_id);
        if (! $locationId) {
            Log::warning('Order import inventory restock skipped: no location', [
                'order_id' => $order->id,
                'platform_order_id' => $order->platform_order_id,
                'channel_id' => $order->channel_id,
                'sku_id' => $sku->id,
            ]);

            return;
        }

        $inventory = SkuInventory::firstOrCreate(
            ['sku_id' => $sku->id, 'location_id' => $locationId],
            ['quantity' => 0, 'reserved' => 0, 'user_id' => Auth::id()]
        );

        $inventory->increment('quantity', $quantity);

        InventoryTransaction::create($this->filterTransactionColumns([
            'sku_id' => $sku->id,
            'location_id' => $locationId,
            'type' => 'IN',
            'quantity' => $quantity,
            'reference_type' => 'ImportedOrder',
            'reference_id' => (string) $order->id,
            'user_id' => Auth::id(),
            'notes' => 'Marketplace order import restock (cancelled line)',
        ]));
    }

    /**
     * When re-uploading order reports, sync header fields for cancelled vs active rows.
     */
    private function applyOrderHeaderUpdatesFromImport(InventoryOrder $order, array $orderData): bool
    {
        $isCancelled = ! empty($orderData['is_cancelled']);
        $sheetStatus = $this->resolveImportOrderStatus($orderData, $isCancelled);

        if ($isCancelled) {
            $order->fill($this->filterOrderColumns([
                'status' => 'cancelled',
                'financial_status' => 'cancelled',
                'settlement_status' => 'cancelled',
                'total_amount' => 0,
                'order_date' => $orderData['order_date'] ?? $order->order_date,
            ]));
            $order->save();

            return $order->wasChanged();
        }

        $updates = [
            'status' => $this->mergeImportOrderStatus($order->status, $sheetStatus),
            'order_date' => $orderData['order_date'] ?? $order->order_date,
        ];

        if ($order->status === 'cancelled' && ($order->financial_status ?? '') === 'cancelled') {
            $updates['financial_status'] = 'pending';
            $updates['settlement_status'] = 'pending';
        }

        $order->fill($this->filterOrderColumns($updates));
        $order->save();

        return $order->wasChanged();
    }

    private function shouldDeductInventoryForChannel(int $channelId): bool
    {
        // We deduct for all channels that have an inventory location.
        // Merchant channels are mapped to main store location; FBA/AFN channels map to their own location.
        return true;
    }

    private function isFbaChannel(int $channelId): bool
    {
        $channel = Channel::query()->find($channelId);
        if (! $channel) {
            return false;
        }
        $name = strtolower((string) ($channel->name ?? ''));
        $slug = strtolower((string) ($channel->slug ?? ''));

        return str_contains($name, 'fba')
            || str_contains($name, 'afn')
            || str_contains($slug, 'fba')
            || str_contains($slug, 'afn');
    }

    private function resolveChannelIdFromRow(
        ?string $hint,
        ?string $fulfillmentHint,
        ?string $skuHint,
        $channels,
        int $fallbackId,
        ?Channel $fallbackChannel = null
    ): int {
        $fulfillment = strtolower(trim((string) $fulfillmentHint));
        $targetType = $this->inferFulfillmentTargetType($fulfillment);

        // 0) Catalog MSKU → account family (Art vs Phyzioline, etc.) before default Amazon anchor.
        $catalogAnchor = $this->resolveChannelAnchorFromSkuCatalog($skuHint, $channels);
        $familyChannel = $catalogAnchor ?? $fallbackChannel;
        $familyFallbackId = $catalogAnchor ? (int) $catalogAnchor->id : $fallbackId;

        if ($targetType && $familyChannel) {
            $sibling = $this->findSiblingChannelByType($familyChannel, $channels, $targetType);
            if ($sibling) {
                return (int) $sibling->id;
            }
        }

        if ($catalogAnchor) {
            return (int) $catalogAnchor->id;
        }

        // 1) Fulfillment-channel on explicit fallback anchor (when SKU not in catalog).
        if ($targetType && $fallbackChannel) {
            $sibling = $this->findSiblingChannelByType($fallbackChannel, $channels, $targetType);
            if ($sibling) {
                return (int) $sibling->id;
            }
        }

        // 2) Fall back to sales-channel hint.
        $h = strtolower(trim((string) $hint));
        if ($h !== '') {
            foreach ($channels as $channel) {
                $name = strtolower((string) $channel->name);
                $slug = strtolower((string) $channel->slug);
                if ($name === $h || $slug === $h || str_contains($h, $slug) || str_contains($h, $name)) {
                    return (int) $channel->id;
                }
            }
        }

        // 3) SKU prefix heuristics (Art / ارض listings when catalog row missing).
        $sku = strtoupper(trim((string) $skuHint));
        if ($sku !== '') {
            $prefixChannel = $this->resolveChannelFromSkuPrefix($sku, $channels, $targetType);
            if ($prefixChannel) {
                return (int) $prefixChannel->id;
            }
        }

        return $familyFallbackId;
    }

    private function inferFulfillmentTargetType(string $fulfillment): ?string
    {
        if ($fulfillment === '') {
            return null;
        }
        if ($this->looksLikeMerchantFulfillment($fulfillment)) {
            return 'merchant';
        }
        if ($this->looksLikeFbaFulfillment($fulfillment)) {
            return 'fba';
        }

        return null;
    }

    /**
     * Pick a channel anchor from catalog listings for this sheet MSKU (strongest multi-account signal).
     */
    private function resolveChannelAnchorFromSkuCatalog(?string $skuHint, $channels): ?Channel
    {
        $code = trim((string) $skuHint);
        if ($code === '' || strtoupper($code) === 'UNKNOWN') {
            return null;
        }

        $listings = Sku::query()
            ->with('channel')
            ->where(function ($q) use ($code) {
                $q->where('sku', $code)->orWhere('marketplace_id', $code);
            })
            ->whereNotNull('channel_id')
            ->where('channel_id', '>', 0)
            ->get();

        if ($listings->isEmpty()) {
            return null;
        }

        $channelIds = $listings->pluck('channel_id')->unique()->values();
        $catalogChannels = collect($channels)->filter(fn ($c) => $channelIds->contains((int) $c->id));

        if ($catalogChannels->isEmpty()) {
            return null;
        }

        if ($catalogChannels->count() === 1) {
            return $catalogChannels->first();
        }

        $byFamily = [];
        foreach ($catalogChannels as $channel) {
            $key = $this->channelFamilyKey($channel);
            if ($key === '') {
                $key = 'id:'.$channel->id;
            }
            $byFamily[$key][] = $channel;
        }

        if (count($byFamily) !== 1) {
            return null;
        }

        $familyChannels = collect(reset($byFamily));

        return $familyChannels->first(fn ($c) => $this->channelIsMerchantType($c))
            ?? $familyChannels->first();
    }

    private function channelFamilyKey(Channel $channel): string
    {
        $name = strtolower((string) $channel->name);
        $slug = strtolower((string) $channel->slug);
        $familyKey = preg_replace(
            '/\b(fba|merchant|mfn|fbm|afn|fbn|تاجر|نون|noon|amazon|أمازون|امازون)\b/u',
            '',
            $name.' '.$slug
        );
        $tokens = array_filter(
            preg_split('/[^a-z0-9\x{0600}-\x{06FF}]+/u', $familyKey),
            fn ($t) => strlen((string) $t) >= 2
        );
        sort($tokens);

        return implode('|', $tokens);
    }

    private function channelIsMerchantType(Channel $channel): bool
    {
        $name = strtolower((string) $channel->name);
        $slug = strtolower((string) $channel->slug);

        return str_contains($name, 'merchant')
            || str_contains($name, 'mfn')
            || str_contains($name, 'fbm')
            || str_contains($name, 'تاجر')
            || str_contains($slug, 'merchant')
            || str_contains($slug, 'mfn')
            || str_contains($slug, 'fbm')
            || ChannelStockResolver::deductsFromMainStoreBucket((int) $channel->id);
    }

    private function channelBelongsToArtFamily(Channel $channel): bool
    {
        $name = strtolower((string) $channel->name);
        $slug = strtolower((string) $channel->slug);
        $haystack = $name.' '.$slug;

        return str_contains($haystack, 'ارت')
            || str_contains($haystack, 'ارض')
            || str_contains($haystack, 'art')
            || str_contains($haystack, 'ard');
    }

    private function resolveChannelFromSkuPrefix(string $sku, $channels, ?string $targetType): ?Channel
    {
        $isArtSku = str_starts_with($sku, 'ARD') || (bool) preg_match('/^DR\d/', $sku);
        if (! $isArtSku) {
            return null;
        }

        $artChannels = collect($channels)->filter(fn ($c) => $this->channelBelongsToArtFamily($c));
        if ($artChannels->isEmpty()) {
            return null;
        }

        $anchor = $artChannels->first(fn ($c) => $this->channelIsMerchantType($c)) ?? $artChannels->first();
        if ($targetType && $anchor) {
            return $this->findSiblingChannelByType($anchor, $channels, $targetType) ?? $anchor;
        }

        return $anchor;
    }

    private function looksLikeMerchantFulfillment(string $fulfillment): bool
    {
        return str_contains($fulfillment, 'merchant')
            || str_contains($fulfillment, 'mfn')
            || str_contains($fulfillment, 'fbm')
            || str_contains($fulfillment, 'seller')
            || str_contains($fulfillment, 'self')
            || str_contains($fulfillment, 'by merchant')
            || str_contains($fulfillment, 'by seller')
            || str_contains($fulfillment, 'التاجر')
            || str_contains($fulfillment, 'البائع')
            || str_contains($fulfillment, 'بواسطة التاجر')
            || str_contains($fulfillment, 'بواسطة البائع')
            || str_contains($fulfillment, 'تاجر');
    }

    private function looksLikeFbaFulfillment(string $fulfillment): bool
    {
        return str_contains($fulfillment, 'amazon')
            || str_contains($fulfillment, 'afn')
            || str_contains($fulfillment, 'fba')
            || str_contains($fulfillment, 'prime')
            || str_contains($fulfillment, 'by amazon')
            || str_contains($fulfillment, 'fulfilled by amazon')
            || str_contains($fulfillment, 'امازون')
            || str_contains($fulfillment, 'أمازون')
            || str_contains($fulfillment, 'بواسطة أمازون')
            || str_contains($fulfillment, 'تنفيذ بواسطة أمازون');
    }

    private function findSiblingChannelByType(Channel $fallbackChannel, $channels, string $targetType): ?Channel
    {
        $fallbackName = strtolower((string) $fallbackChannel->name);
        $fallbackSlug = strtolower((string) $fallbackChannel->slug);

        // Normalize family key (same account family, different merchant/fba flavor)
        $familyKey = preg_replace('/\b(fba|merchant|mfn|fbm|تاجر)\b/u', '', $fallbackName.' '.$fallbackSlug);
        $familyTokens = array_filter(preg_split('/[^a-z0-9\x{0600}-\x{06FF}]+/u', $familyKey), fn ($t) => strlen((string) $t) >= 2);

        foreach ($channels as $channel) {
            $name = strtolower((string) $channel->name);
            $slug = strtolower((string) $channel->slug);

            $isTarget = $targetType === 'merchant'
                ? (
                    str_contains($name, 'merchant')
                    || str_contains($name, 'mfn')
                    || str_contains($name, 'fbm')
                    || str_contains($name, 'تاجر')
                    || str_contains($slug, 'merchant')
                    || str_contains($slug, 'mfn')
                    || str_contains($slug, 'fbm')
                )
                : (
                    str_contains($name, 'fba')
                    || str_contains($name, 'afn')
                    || str_contains($slug, 'fba')
                    || str_contains($slug, 'afn')
                );

            if (! $isTarget) {
                continue;
            }

            // Prefer channels sharing the same family token (e.g. phyzioline vs ard)
            $haystack = $name.' '.$slug;
            $sharedFamily = empty($familyTokens);
            foreach ($familyTokens as $token) {
                if (str_contains($haystack, $token)) {
                    $sharedFamily = true;
                    break;
                }
            }

            if ($sharedFamily) {
                return $channel;
            }
        }

        return null;
    }

    private function detectCsvInputEncoding(string $path): string
    {
        $sample = @file_get_contents($path, false, null, 0, 65536);
        if ($sample === false || $sample === '') {
            return 'UTF-8';
        }

        if (str_starts_with($sample, "\xEF\xBB\xBF")) {
            return 'UTF-8';
        }

        // If bytes are valid UTF-8, keep UTF-8 and avoid false Arabic recoding.
        if (mb_check_encoding($sample, 'UTF-8')) {
            return 'UTF-8';
        }

        $encodings = $this->filterSupportedEncodings([
            'UTF-8', 'CP1256', 'ISO-8859-6', 'Windows-1252', 'ISO-8859-1', 'ASCII',
        ]);
        if (empty($encodings)) {
            return 'UTF-8';
        }

        // Prefer Arabic legacy code pages when source bytes are non-UTF8.
        foreach (['CP1256', 'ISO-8859-6'] as $preferred) {
            if (in_array($preferred, $encodings, true)) {
                return $preferred;
            }
        }

        $detected = mb_detect_encoding(
            $sample,
            $encodings,
            true
        );

        return $detected ?: 'UTF-8';
    }

    private function detectCsvDelimiter(string $path, string $fallback = ','): string
    {
        $sample = @file_get_contents($path, false, null, 0, 65536);
        if ($sample === false || $sample === '') {
            return $fallback;
        }

        $lines = preg_split('/\r\n|\n|\r/', $sample) ?: [];
        $lines = array_values(array_filter(array_map('trim', $lines), fn ($line) => $line !== ''));
        if (empty($lines)) {
            return $fallback;
        }

        $lines = array_slice($lines, 0, 20);
        $candidates = array_values(array_unique(["\t", ';', ',', '|', $fallback]));

        $bestDelimiter = $fallback;
        $bestScore = 0.0;

        foreach ($candidates as $candidate) {
            $counts = [];
            foreach ($lines as $line) {
                $counts[] = count(str_getcsv($line, $candidate));
            }

            if (max($counts) < 2) {
                continue;
            }

            $score = array_sum($counts) / max(1, count($counts));
            if ($score > $bestScore) {
                $bestScore = $score;
                $bestDelimiter = $candidate;
            }
        }

        return $bestDelimiter;
    }

    private function normalizeRowsEncoding(array $rows): array
    {
        array_walk_recursive($rows, function (&$value) {
            if (! is_string($value)) {
                return;
            }

            $value = $this->normalizeStringEncoding($value);
        });

        return $rows;
    }

    private function normalizeStringEncoding(string $value): string
    {
        if ($value === '') {
            return $value;
        }

        $value = preg_replace('/^\xEF\xBB\xBF/', '', $value) ?? $value;

        if ($this->looksLikeArabicMojibake($value)) {
            $recovered = $this->recoverArabicMojibake($value);
            if ($recovered !== null) {
                return $recovered;
            }
        }

        if (preg_match('//u', $value)) {
            return $value;
        }

        $encodings = $this->filterSupportedEncodings(['CP1256', 'ISO-8859-6', 'Windows-1252', 'ISO-8859-1']);
        foreach ($encodings as $encoding) {
            $converted = @mb_convert_encoding($value, 'UTF-8', $encoding);
            if (is_string($converted) && $converted !== '' && preg_match('//u', $converted)) {
                return $converted;
            }
        }

        return $value;
    }

    private function looksLikeArabicMojibake(string $value): bool
    {
        if (preg_match('/[\x{0600}-\x{06FF}]/u', $value)) {
            return false;
        }

        return preg_match('/[\x{00C0}-\x{00FF}]/u', $value) === 1;
    }

    private function recoverArabicMojibake(string $value): ?string
    {
        $encodings = $this->filterSupportedEncodings(['Windows-1252', 'ISO-8859-1']);
        $targets = $this->filterSupportedEncodings(['CP1256', 'ISO-8859-6']);

        foreach ($encodings as $from) {
            $bytes = @mb_convert_encoding($value, $from, 'UTF-8');
            if (! is_string($bytes) || $bytes === '') {
                continue;
            }

            foreach ($targets as $to) {
                $fixed = @mb_convert_encoding($bytes, 'UTF-8', $to);
                if (is_string($fixed) && preg_match('/[\x{0600}-\x{06FF}]/u', $fixed)) {
                    return $fixed;
                }
            }
        }

        return null;
    }

    private function filterSupportedEncodings(array $encodings): array
    {
        $supported = array_map('strtolower', mb_list_encodings());

        return array_values(array_filter($encodings, function ($encoding) use ($supported) {
            return in_array(strtolower($encoding), $supported, true);
        }));
    }

    // Note: the monolith's marketplace-order buyer -> CRM contact resolver
    // (Modules\CRM\...\MarketplaceBuyerResolver) relied on the monolith's
    // CRM contact-matching/lead-intake engine and is not part of the
    // Inventory extraction's CRM decoupling scope (that only covers the
    // Customer/Vendor observer sync + manual "sync-crm" actions, both
    // replaced with an outbound webhook — see App\Infrastructure\External\
    // MonolithCrmWebhookClient). This best-effort hook was removed rather
    // than guessed at.
}
