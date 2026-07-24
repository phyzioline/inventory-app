<?php

uses(Tests\TestCase::class);

use App\Application\Services\InventoryReturnImportService;
use App\Application\Services\InventoryReturnListingService;

describe('Inventory module smoke', function () {
    it('loads the application service provider', function () {
        expect(class_exists(\App\Providers\AppServiceProvider::class))->toBeTrue();
    });

    it('resolves return services from container', function () {
        expect(app(InventoryReturnImportService::class))
            ->toBeInstanceOf(InventoryReturnImportService::class)
            ->and(app(InventoryReturnListingService::class))
            ->toBeInstanceOf(InventoryReturnListingService::class);
    });
});
