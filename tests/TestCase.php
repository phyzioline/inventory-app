<?php

namespace Tests;

use App\Application\Services\ChannelStockResolver;
use App\Support\DatabaseSafetyGuard;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    /**
     * Runs after the app boots and BEFORE RefreshDatabase / DatabaseMigrations traits.
     * This is the last line of defense if phpunit.xml or .env.testing are wrong.
     */
    protected function refreshApplication(): void
    {
        parent::refreshApplication();

        DatabaseSafetyGuard::assertSafeForAutomatedTests();
    }

    protected function setUp(): void
    {
        parent::setUp();

        // Static caches outlive RefreshDatabase: a main-store channel id cached by
        // an earlier test points at a row that no longer exists, so stock lands
        // in the wrong bucket (MerchantReturnReceiveRestockTest failed in the full
        // suite while passing alone).
        ChannelStockResolver::clearCache();
    }
}
