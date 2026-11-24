<?php

use App\Application\Services\SettlementService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\Settlement;
use App\Domain\Models\Wms\SettlementItem;
use App\Models\User;

function importSheetRows(int $channelId, array $rows, string $delimiter = "\t"): array
{
    $path = tempnam(sys_get_temp_dir(), 'stl_').'.txt';
    file_put_contents($path, implode("\n", array_map(fn ($r) => implode($delimiter, $r), $rows)));

    return app(SettlementService::class)->importAmazonSettlement($channelId, $path);
}

function amazonChannelFor(User $user): Channel
{
    return Channel::factory()->create([
        'user_id' => $user->id, 'name' => 'Amazon', 'slug' => 'amz-'.uniqid(), 'type' => 'fba', 'is_active' => true,
    ]);
}

const V1_HEADER = ['settlement-id', 'settlement-start-date', 'settlement-end-date', 'deposit-date', 'total-amount', 'currency',
    'transaction-type', 'order-id', 'order-item-code', 'sku', 'quantity-purchased', 'amount-type', 'amount-description', 'amount', 'posted-date'];

it('does not store the flat-file summary row as a line or count it twice in the sheet total', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $channel = amazonChannelFor($user);

    importSheetRows($channel->id, [
        V1_HEADER,
        ['S-TOT-1', '2026-03-11', '2026-03-12', '2026-03-14', '250.00', 'EGP', '', '', '', '', '', '', '', '', ''],
        ['S-TOT-1', '', '', '', '', 'EGP', 'Order', '111-0000001-0000001', 'A1', 'SKU-A', '1', 'ItemPrice', 'Principal', '300.00', '2026-03-11'],
        ['S-TOT-1', '', '', '', '', 'EGP', 'Order', '111-0000001-0000001', 'A1', 'SKU-A', '1', 'ItemFees', 'Commission', '-50.00', '2026-03-11'],
    ]);

    $settlement = Settlement::where('report_id', 'S-TOT-1')->firstOrFail();
    expect(SettlementItem::where('settlement_id', $settlement->id)->count())->toBe(2)
        ->and((float) $settlement->total_amount)->toBe(250.0)
        ->and((float) SettlementItem::where('settlement_id', $settlement->id)->sum('amount'))->toBe(250.0);

    $summary = app(SettlementService::class)->buildReconciliationSummary($settlement);
    expect($summary['total_gap'])->toBe(0.0);
});

it('keeps two real lines that differ only by order-item-code, and re-import does not double them', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $channel = amazonChannelFor($user);

    $rows = [
        V1_HEADER,
        ['S-DUP-1', '2026-03-11', '2026-03-12', '2026-03-14', '200.00', 'EGP', '', '', '', '', '', '', '', '', ''],
        ['S-DUP-1', '', '', '', '', 'EGP', 'Order', '111-0000002-0000002', 'U1', 'SKU-B', '1', 'ItemPrice', 'Principal', '100.00', '2026-03-11'],
        ['S-DUP-1', '', '', '', '', 'EGP', 'Order', '111-0000002-0000002', 'U2', 'SKU-B', '1', 'ItemPrice', 'Principal', '100.00', '2026-03-11'],
    ];
    importSheetRows($channel->id, $rows);
    importSheetRows($channel->id, $rows);

    $settlement = Settlement::where('report_id', 'S-DUP-1')->firstOrFail();
    expect(SettlementItem::where('settlement_id', $settlement->id)->count())->toBe(2)
        ->and((float) SettlementItem::where('settlement_id', $settlement->id)->sum('amount'))->toBe(200.0);
});

it('still drops a row that is repeated byte-for-byte in the same file', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $channel = amazonChannelFor($user);

    $line = ['S-DUP-2', '', '', '', '', 'EGP', 'Order', '111-0000003-0000003', 'U1', 'SKU-C', '1', 'ItemPrice', 'Principal', '80.00', '2026-03-11'];
    importSheetRows($channel->id, [V1_HEADER, $line, $line]);

    $settlement = Settlement::where('report_id', 'S-DUP-2')->firstOrFail();
    expect(SettlementItem::where('settlement_id', $settlement->id)->count())->toBe(1);
});

it('reads the money columns of the Amazon V2 flat file', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $channel = amazonChannelFor($user);

    $header = ['settlement-id', 'settlement-start-date', 'settlement-end-date', 'deposit-date', 'total-amount', 'currency',
        'transaction-type', 'order-id', 'order-item-code', 'sku', 'quantity-purchased', 'price-type', 'price-amount',
        'item-related-fee-type', 'item-related-fee-amount', 'other-amount', 'posted-date'];
    importSheetRows($channel->id, [
        $header,
        ['S-V2-1', '2026-05-24', '2026-05-31', '2026-06-02', '153.60', '', '', '', '', '', '', '', '', '', '', '', ''],
        ['S-V2-1', '', '', '', '', '', 'Order', '405-0000004-0000004', 'C1', 'SKU-D', '1', 'Principal', '200.00', '', '', '', '2026-05-24'],
        ['S-V2-1', '', '', '', '', '', 'Order', '405-0000004-0000004', 'C1', 'SKU-D', '1', '', '', 'Commission', '-35.00', '', '2026-05-24'],
        ['S-V2-1', '', '', '', '', '', 'RemovalComplete', '26050916T8', '', '', '', '', '', '', '', '-11.40', '2026-05-25'],
    ]);

    $settlement = Settlement::where('report_id', 'S-V2-1')->firstOrFail();
    $items = SettlementItem::where('settlement_id', $settlement->id)->orderBy('id')->get();
    expect($items)->toHaveCount(3)
        ->and($items->pluck('description')->all())->toBe(['Principal', 'Commission', 'RemovalComplete'])
        ->and($items->map(fn ($i) => (float) $i->amount)->all())->toBe([200.0, -35.0, -11.4])
        ->and((float) $settlement->total_amount)->toBe(153.6);
});

it('repairs a legacy summary row: removes it, sets the transfer total and re-books the auto receipt (audited)', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $channel = amazonChannelFor($user);

    $settlement = Settlement::create([
        'channel_id' => $channel->id, 'report_id' => 'S-LEGACY-1', 'start_date' => '2026-03-11', 'end_date' => '2026-03-12',
        'total_amount' => 500.0, 'status' => 'reconciled',
    ]);
    SettlementItem::create([
        'settlement_id' => $settlement->id, 'transaction_type' => 'Order', 'description' => 'Imported transaction',
        'amount' => 250.0, 'fee_amount' => 0, 'quantity' => 0, 'reconciliation_status' => 'unreconciled', 'transaction_status' => 'released',
        'raw_data' => ['settlement-id' => 'S-LEGACY-1', 'total-amount' => '250.00', 'transaction-type' => '', 'order-id' => '', 'amount-type' => ''],
    ]);
    SettlementItem::create([
        'settlement_id' => $settlement->id, 'platform_order_id' => '111-0000009-0000009', 'transaction_type' => 'Order', 'description' => 'Principal',
        'amount' => 250.0, 'fee_amount' => 0, 'quantity' => 1, 'reconciliation_status' => 'unreconciled', 'transaction_status' => 'released',
        'raw_data' => ['settlement-id' => 'S-LEGACY-1', 'total-amount' => '', 'transaction-type' => 'Order', 'order-id' => '111-0000009-0000009', 'amount' => '250.00'],
    ]);
    app(\App\Application\Services\ReceiptApplicationService::class)->upsertForSettlement($settlement);
    expect((float) \App\Domain\Models\Wms\Receipt::where('reference_id', $settlement->id)->value('amount'))->toBe(500.0);

    $this->artisan('inventory:repair-settlement-totals', ['--user' => $user->id])->assertSuccessful();
    expect(SettlementItem::where('settlement_id', $settlement->id)->count())->toBe(2);

    $this->artisan('inventory:repair-settlement-totals', ['--user' => $user->id, '--apply' => true])->assertSuccessful();

    expect(SettlementItem::where('settlement_id', $settlement->id)->count())->toBe(1)
        ->and((float) $settlement->fresh()->total_amount)->toBe(250.0)
        ->and((float) \App\Domain\Models\Wms\Receipt::where('reference_id', $settlement->id)->value('amount'))->toBe(250.0)
        ->and(\App\Domain\Models\Wms\InventoryAuditLog::where('action', 'settlement.summary_row_removed')->count())->toBe(1);
});

it('re-uploading a sheet whose receipt has the legacy monolith class name does not book a second receipt', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $channel = amazonChannelFor($user);
    $settlement = Settlement::create([
        'channel_id' => $channel->id, 'report_id' => 'S-LEGACY-RCPT', 'start_date' => '2026-07-01', 'end_date' => '2026-07-07',
        'total_amount' => 3668.89, 'status' => 'reconciled',
    ]);
    \App\Domain\Models\Wms\Receipt::create([
        'receipt_number' => 'SET-'.$settlement->id, 'type' => 'settlement', 'category' => 'channel_collection', 'amount' => 3668.89,
        'receipt_date' => '2026-07-07', 'user_id' => $user->id,
        'reference_type' => 'Modules\Inventory\app\Domain\Models\Wms\Settlement', 'reference_id' => $settlement->id,
    ]);

    app(\App\Application\Services\ReceiptApplicationService::class)->upsertForSettlement($settlement);

    expect(\App\Domain\Models\Wms\Receipt::where('reference_id', $settlement->id)->count())->toBe(1)
        ->and((float) \App\Domain\Models\Wms\Receipt::where('reference_id', $settlement->id)->sum('amount'))->toBe(3668.89);
});

it('flags a sheet whose lines do not add up to its transfer, and re-uploading the full file completes the same sheet', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $channel = amazonChannelFor($user);
    $head = ['S-INC-1', '2026-03-11', '2026-03-12', '2026-03-14', '1000.00', 'EGP', '', '', '', '', '', '', '', '', ''];
    $fee = ['S-INC-1', '', '', '', '', 'EGP', 'Order', '111-0000009-0000009', 'Z1', 'SKU-Z', '1', 'ItemFees', 'Commission', '-50.00', '2026-03-11'];
    $sale = ['S-INC-1', '', '', '', '', 'EGP', 'Order', '111-0000009-0000009', 'Z1', 'SKU-Z', '1', 'ItemPrice', 'Principal', '1050.00', '2026-03-11'];

    importSheetRows($channel->id, [V1_HEADER, $head, $fee]);
    $settlement = Settlement::where('report_id', 'S-INC-1')->firstOrFail();
    $svc = app(SettlementService::class);
    expect($svc->buildReconciliationSummary($settlement)['completeness'])->toBe(SettlementService::SHEET_INCOMPLETE);

    $list = $this->getJson('/api/inventory/settlements')->assertOk();
    expect($list->json('incomplete_sheets.count'))->toBe(1)
        ->and(collect($list->json('data'))->firstWhere('report_id', 'S-INC-1')['completeness'])->toBe('incomplete');

    importSheetRows($channel->id, [V1_HEADER, $head, $fee, $sale]);
    expect(Settlement::where('report_id', 'S-INC-1')->count())->toBe(1)
        ->and(SettlementItem::where('settlement_id', $settlement->id)->count())->toBe(2)
        ->and($svc->buildReconciliationSummary($settlement->fresh())['completeness'])->toBe(SettlementService::SHEET_COMPLETE);
    expect($this->getJson('/api/inventory/settlements')->json('incomplete_sheets.count'))->toBe(0);
});

it('reads Amazon reserve rows so a held reserve does not show as missing lines', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $channel = amazonChannelFor($user);

    importSheetRows($channel->id, [
        V1_HEADER,
        ['S-RES-1', '2026-03-11', '2026-03-12', '2026-03-14', '700.00', 'EGP', '', '', '', '', '', '', '', '', ''],
        ['S-RES-1', '', '', '', '', 'EGP', 'Previous Reserve Amount Balance', '', '', '', '', 'Other', 'Previous Reserve Amount Balance', '300.00', '2026-03-11'],
        ['S-RES-1', '', '', '', '', 'EGP', 'Order', '111-0000010-0000010', 'R1', 'SKU-R', '1', 'ItemPrice', 'Principal', '800.00', '2026-03-11'],
        ['S-RES-1', '', '', '', '', 'EGP', 'Current Reserve Amount', '', '', '', '', 'Other', 'Current Reserve Amount', '-400.00', '2026-03-12'],
    ]);

    $settlement = Settlement::where('report_id', 'S-RES-1')->firstOrFail();
    expect(SettlementItem::where('settlement_id', $settlement->id)->count())->toBe(3)
        ->and(app(SettlementService::class)->buildReconciliationSummary($settlement)['completeness'])->toBe(SettlementService::SHEET_COMPLETE);
});
