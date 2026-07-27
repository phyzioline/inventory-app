<?php

namespace App\Support;

use RuntimeException;

/**
 * Hard stop against destructive DB operations on production databases.
 *
 * Incident (2026-07-27): Pest RefreshDatabase wiped phyzioline_inventory because
 * .env.testing was missing and phpunit.xml did not force DB_DATABASE.
 */
final class DatabaseSafetyGuard
{
    /** Exact production / shared DB names that must never be used by tests or wipe commands. */
    public const FORBIDDEN_DATABASES = [
        'phyzioline_inventory',
        'phyzioline',
        'phyziolinedb',
        'postgres',
        'mysql',
        'production',
    ];

    /** Artisan commands that drop/rebuild schema or wipe all tables. */
    public const DESTRUCTIVE_COMMANDS = [
        'migrate:fresh',
        'migrate:refresh',
        'migrate:reset',
        'db:wipe',
    ];

    public static function configuredDatabaseName(): string
    {
        $connection = (string) config('database.default', 'pgsql');

        return (string) config("database.connections.{$connection}.database", '');
    }

    public static function isForbiddenDatabase(?string $database = null): bool
    {
        $database = strtolower(trim((string) ($database ?? self::configuredDatabaseName())));

        if ($database === '') {
            return true;
        }

        if (in_array($database, self::FORBIDDEN_DATABASES, true)) {
            return true;
        }

        // Any name that does not look like an isolated test/dev scratch DB is treated
        // as unsafe when APP_ENV=testing (tests must use *_test / *_testing).
        return false;
    }

    public static function isSafeTestingDatabase(?string $database = null): bool
    {
        $database = strtolower(trim((string) ($database ?? self::configuredDatabaseName())));

        if ($database === '' || self::isForbiddenDatabase($database)) {
            return false;
        }

        return str_ends_with($database, '_test')
            || str_ends_with($database, '_testing')
            || str_contains($database, '_test_');
    }

    /**
     * Abort before RefreshDatabase / migrate:fresh can run.
     *
     * @throws RuntimeException
     */
    public static function assertSafeForAutomatedTests(): void
    {
        $database = self::configuredDatabaseName();

        if (! self::isSafeTestingDatabase($database)) {
            throw new RuntimeException(
                self::blockedMessage(
                    'PHPUnit/Pest refused to start',
                    $database,
                    'Tests may only use an isolated DB whose name ends with _test or _testing '
                    .'(e.g. phyzioline_inventory_test). Copy .env.testing.example → .env.testing '
                    .'and never point tests at phyzioline_inventory.'
                )
            );
        }

        if (! is_file(base_path('.env.testing'))) {
            throw new RuntimeException(
                self::blockedMessage(
                    'PHPUnit/Pest refused to start',
                    $database,
                    'Missing .env.testing. Copy .env.testing.example and set DB_DATABASE=phyzioline_inventory_test.'
                )
            );
        }
    }

    /**
     * Block wipe/fresh against production DB names even if APP_ENV was mis-set.
     *
     * @throws RuntimeException
     */
    public static function assertSafeForDestructiveArtisan(string $command): void
    {
        $base = explode(' ', trim($command))[0] ?? '';
        if (! in_array($base, self::DESTRUCTIVE_COMMANDS, true)) {
            return;
        }

        $database = self::configuredDatabaseName();
        $env = (string) config('app.env', env('APP_ENV', 'production'));

        if (self::isForbiddenDatabase($database) || $env === 'production') {
            throw new RuntimeException(
                self::blockedMessage(
                    "Artisan [{$base}] blocked",
                    $database,
                    'Destructive schema commands are forbidden against production DB names '
                    .'and when APP_ENV=production. Use phyzioline_inventory_test (or another *_test DB) instead.'
                )
            );
        }

        // migrate:fresh / db:wipe on a non-_test database still require an explicit allow flag.
        if (in_array($base, ['migrate:fresh', 'migrate:refresh', 'migrate:reset', 'db:wipe'], true)
            && ! self::isSafeTestingDatabase($database)
            && env('ALLOW_DESTRUCTIVE_DB') !== '1'
        ) {
            throw new RuntimeException(
                self::blockedMessage(
                    "Artisan [{$base}] blocked",
                    $database,
                    'Refusing wipe/fresh on a non-test database. Switch DB_DATABASE to a *_test database, '
                    .'or set ALLOW_DESTRUCTIVE_DB=1 only if you intentionally accept data loss.'
                )
            );
        }
    }

    private static function blockedMessage(string $title, string $database, string $hint): string
    {
        return "[DATABASE SAFETY] {$title}.\n"
            ."  Connected database: ".($database !== '' ? $database : '(empty)')."\n"
            ."  {$hint}";
    }
}
