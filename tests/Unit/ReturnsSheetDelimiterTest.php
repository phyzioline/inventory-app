<?php

uses(Tests\TestCase::class);

use App\Application\Services\InventoryReturnImportService;

/**
 * Amazon's FBA customer returns report downloads as tab-separated .txt. The parser read it with a
 * comma delimiter, so each row became one column with no order-id / sku and nothing imported.
 * A .txt and a .csv of the same report must parse to the same records.
 */
function parseReturnsSheet(string $content): array
{
    $path = tempnam(sys_get_temp_dir(), 'ret');
    file_put_contents($path, $content);
    $service = app(InventoryReturnImportService::class);
    $method = new ReflectionMethod($service, 'parseReturnsCsv');
    $method->setAccessible(true);
    $records = $method->invoke($service, $path);
    @unlink($path);

    return array_map(fn ($r) => [
        $r['order_id'], $r['sku_code'], $r['return_quantity'], $r['disposition'], $r['platform_return_id'], $r['reason'],
    ], $records);
}

it('parses a tab-separated returns report exactly like the comma-separated one', function () {
    $cols = ['return-date', 'order-id', 'sku', 'asin', 'fnsku', 'product-name', 'quantity', 'fulfillment-center-id', 'detailed-disposition', 'reason', 'status', 'license-plate-number', 'customer-comments'];
    $rows = [
        ['2026-11-02T10:00:00+00:00', '402-1111111-2222222', 'PHYZ-1393', 'B0TEST1', 'X00TEST1', 'Massage Gun, black', '1', 'SPX5', 'SELLABLE', 'NOT_AS_DESCRIBED', 'Unit returned to inventory', 'LPN111', 'too heavy, returned'],
        ['2026-11-05T10:00:00+00:00', '402-3333333-4444444', 'OH-9CZV-37NB', 'B0TEST2', 'X00TEST2', 'Band set', '2', 'SPX5', 'CUSTOMER_DAMAGED', 'DEFECTIVE', 'Unit returned to inventory', 'LPN222', ''],
    ];
    $csvLine = fn (array $r) => implode(',', array_map(fn ($v) => str_contains($v, ',') ? '"'.$v.'"' : $v, $r));
    $csv = implode("\n", array_merge([$csvLine($cols)], array_map($csvLine, $rows)))."\n";
    $tsv = implode("\n", array_merge([implode("\t", $cols)], array_map(fn ($r) => implode("\t", $r), $rows)))."\n";

    $fromTsv = parseReturnsSheet($tsv);

    expect($fromTsv)->toBe(parseReturnsSheet($csv))
        ->and($fromTsv)->toHaveCount(2)
        ->and($fromTsv[0])->toBe(['402-1111111-2222222', 'PHYZ-1393', 1, 'SELLABLE', 'LPN111', 'NOT_AS_DESCRIBED'])
        ->and($fromTsv[1][2])->toBe(2);
});
