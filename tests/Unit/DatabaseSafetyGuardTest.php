<?php

use App\Support\DatabaseSafetyGuard;

it('treats production inventory DB as forbidden', function () {
    expect(DatabaseSafetyGuard::isForbiddenDatabase('phyzioline_inventory'))->toBeTrue()
        ->and(DatabaseSafetyGuard::isForbiddenDatabase('phyzioline'))->toBeTrue()
        ->and(DatabaseSafetyGuard::isForbiddenDatabase('phyziolinedb'))->toBeTrue();
});

it('only accepts *_test databases for automated tests', function () {
    expect(DatabaseSafetyGuard::isSafeTestingDatabase('phyzioline_inventory_test'))->toBeTrue()
        ->and(DatabaseSafetyGuard::isSafeTestingDatabase('phyzioline_inventory_testing'))->toBeTrue()
        ->and(DatabaseSafetyGuard::isSafeTestingDatabase('phyzioline_inventory'))->toBeFalse()
        ->and(DatabaseSafetyGuard::isSafeTestingDatabase('something_else'))->toBeFalse();
});
