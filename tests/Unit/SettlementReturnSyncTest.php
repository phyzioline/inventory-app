<?php

uses(Tests\TestCase::class);

use App\Application\Services\SettlementService;
use App\Domain\Models\Wms\SettlementItem;

function settlementItem(array $attrs = []): SettlementItem
{
    $item = new SettlementItem;
    $item->forceFill(array_merge([
        'transaction_status' => 'released',
        'transaction_type' => 'Refund',
        'amount' => -100,
    ], $attrs));

    return $item;
}

it('rejects shipping-only refund settlement lines for inventory returns', function () {
    $service = app(SettlementService::class);

    expect($service->settlementLineQualifiesForInventoryReturn(
        settlementItem(['description' => 'RefundPrice: Shipping'])
    ))->toBeFalse()
        ->and($service->settlementLineQualifiesForInventoryReturn(
            settlementItem(['description' => 'Shipping'])
        ))->toBeFalse()
        ->and($service->settlementLineQualifiesForInventoryReturn(
            settlementItem(['description' => 'RefundPrice: Tax'])
        ))->toBeFalse();
});

it('rejects refund fee and promotion settlement lines for inventory returns', function () {
    $service = app(SettlementService::class);

    expect($service->settlementLineQualifiesForInventoryReturn(
        settlementItem(['description' => 'RefundFee: Commission'])
    ))->toBeFalse()
        ->and($service->settlementLineQualifiesForInventoryReturn(
            settlementItem(['description' => 'RefundPromotion: Principal'])
        ))->toBeFalse();
});

it('accepts principal product refund settlement lines as claim markers', function () {
    $service = app(SettlementService::class);

    expect($service->settlementLineQualifiesForInventoryReturn(
        settlementItem(['description' => 'RefundPrice: Principal'])
    ))->toBeTrue()
        ->and($service->settlementLineQualifiesForInventoryReturn(
            settlementItem(['description' => 'Principal'])
        ))->toBeTrue()
        ->and($service->settlementLineQualifiesForInventoryReturn(
            settlementItem(['description' => 'Product refund for item price'])
        ))->toBeTrue()
        ->and($service->settlementLineQualifiesForInventoryReturn(
            settlementItem(['description' => 'استرداد سعر المنتج'])
        ))->toBeTrue()
        ->and($service->settlementLineQualifiesForInventoryReturn(
            settlementItem(['description' => '', 'transaction_type' => 'Refund', 'sku' => 'SKU-1'])
        ))->toBeTrue();
});

it('accepts deferred refund rows for claim tracking', function () {
    $service = app(SettlementService::class);

    expect($service->settlementLineQualifiesForInventoryReturn(
        settlementItem([
            'description' => 'RefundPrice: Principal',
            'transaction_status' => 'deferred',
            'sku' => 'MSKU-1',
        ])
    ))->toBeTrue();
});

it('rejects bare refund transaction type without product signal', function () {
    $service = app(SettlementService::class);

    expect($service->settlementLineQualifiesForInventoryReturn(
        settlementItem(['description' => '', 'transaction_type' => 'Refund'])
    ))->toBeFalse()
        ->and($service->settlementLineQualifiesForInventoryReturn(
            settlementItem(['description' => 'Customer refund adjustment'])
        ))->toBeFalse();
});

it('rejects zero-amount settlement refund lines', function () {
    $service = app(SettlementService::class);

    expect($service->settlementLineQualifiesForInventoryReturn(
        settlementItem(['description' => 'RefundPrice: Principal', 'amount' => 0])
    ))->toBeFalse();
});

it('rejects deferred refund rows without sku or product signal', function () {
    $service = app(SettlementService::class);

    expect($service->settlementLineQualifiesForInventoryReturn(
        settlementItem([
            'description' => 'RefundPrice: Principal',
            'transaction_status' => 'deferred',
        ])
    ))->toBeTrue();
});

it('assigns distinct platform_return_id per product line on the same order', function () {
    $service = app(SettlementService::class);
    $ref = new ReflectionClass($service);
    $method = $ref->getMethod('settlementReturnPlatformId');
    $method->setAccessible(true);

    $settlement = new \App\Domain\Models\Wms\Settlement;
    $settlement->forceFill(['id' => 99]);

    $order = new \App\Domain\Models\Wms\InventoryOrder;
    $order->forceFill(['platform_order_id' => '111-AAAAAA-1111111']);

    $itemA = settlementItem([
        'sku' => 'SKU-A',
        'description' => 'RefundPrice: Principal',
        'amount' => -50,
        'quantity' => 1,
        'raw_data' => ['import_line_seq' => 0],
    ]);
    $itemB = settlementItem([
        'sku' => 'SKU-B',
        'description' => 'RefundPrice: Principal',
        'amount' => -75,
        'quantity' => 1,
        'raw_data' => ['import_line_seq' => 1],
    ]);

    $idA = $method->invoke($service, $settlement, $order, $itemA);
    $idB = $method->invoke($service, $settlement, $order, $itemB);

    expect($idA)->not->toBe($idB);
});
