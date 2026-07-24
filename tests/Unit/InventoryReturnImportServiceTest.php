<?php

uses(Tests\TestCase::class);

use App\Application\Services\InventoryReturnImportService;

it('allows same inventory return status', function () {
    $imports = new InventoryReturnImportService;

    expect($imports->canTransitionStatus('pending', 'pending'))->toBeTrue();
});

it('rejects invalid inventory return status transition', function () {
    $imports = new InventoryReturnImportService;

    expect($imports->canTransitionStatus('completed', 'pending'))->toBeFalse();
});

it('normalizes empty datetime to null', function () {
    $imports = new InventoryReturnImportService;

    expect($imports->normalizeDateTime(null))->toBeNull()
        ->and($imports->normalizeDateTime(''))->toBeNull();
});
