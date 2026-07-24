<?php

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

use App\Application\Services\InventoryReportQueryService;

it('returns margin alerts scoped to user without postgres having errors', function () {
    $service = app(InventoryReportQueryService::class);

    expect($service->marginAlerts(0))->toHaveCount(0);
    expect($service->marginAlerts(1))->toBeInstanceOf(\Illuminate\Support\Collection::class);
});

it('returns return rates without division by zero errors', function () {
    $service = app(InventoryReportQueryService::class);

    expect($service->returnRates(0))->toHaveCount(0);
    expect($service->returnRates(1))->toBeInstanceOf(\Illuminate\Support\Collection::class);
});
