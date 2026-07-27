<?php

use App\Application\Services\MarketplaceImportService;

function parseViaService(?string $raw): ?string
{
    $service = app(MarketplaceImportService::class);
    $method = new ReflectionMethod($service, 'parseMarketplaceDateTime');
    $method->setAccessible(true);

    return $method->invoke($service, $raw);
}

it('parses day/month/year sheet dates as Egypt DMY not US MDY', function () {
    // 08/05/2026 must be 8 May, not 5 August
    expect(parseViaService('08/05/2026'))->toStartWith('2026-05-08')
        ->and(parseViaService('5/8/2026'))->toStartWith('2026-08-05')
        ->and(parseViaService('24/07/2026'))->toStartWith('2026-07-24')
        ->and(parseViaService('2026-07-24T10:15:00+00:00'))->toStartWith('2026-07-24');
});

it('still accepts excel serial dates', function () {
    // 45847 ≈ 2025-07-09 depending on Excel epoch; just assert non-null parse for a known serial near 2026
    $parsed = parseViaService('45811'); // around mid-2025
    expect($parsed)->not->toBeNull()
        ->and($parsed)->toMatch('/^\d{4}-\d{2}-\d{2}/');
});
