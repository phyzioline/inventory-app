<?php

namespace Tests;

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
}
