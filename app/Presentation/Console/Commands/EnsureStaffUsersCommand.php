<?php

namespace App\Presentation\Console\Commands;

use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\TenantMembership;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Idempotent ops command: ensure Alpha Medic staff users exist under the owner tenant.
 *
 * Usage: php artisan inventory:ensure-staff-users
 */
class EnsureStaffUsersCommand extends Command
{
    protected $signature = 'inventory:ensure-staff-users
                            {--owner= : Owner account email (defaults to Alpha Medic candidates)}
                            {--dry-run : Show actions without writing}';

    protected $description = 'Create/update cashier and accountant staff under the Alpha Medic owner tenant';

    /** @var list<string> */
    private const OWNER_CANDIDATES = [
        'alphamedic1@gmail.com',
        'alphamedicg1@gmail.com',
    ];

    /** @var list<array{email: string, name: string, role: string, password: string}> */
    private const STAFF = [
        [
            'email' => 'kasher@gmail.com',
            'name' => 'Cashier',
            'role' => 'cashier',
            'password' => '123456',
        ],
        [
            'email' => 'accountant@gmail.com',
            'name' => 'Accountant',
            'role' => 'accountant',
            'password' => '987654',
        ],
    ];

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $ownerOpt = trim((string) ($this->option('owner') ?? ''));
        $candidates = $ownerOpt !== ''
            ? [strtolower($ownerOpt)]
            : self::OWNER_CANDIDATES;

        $owner = null;
        foreach ($candidates as $email) {
            $owner = User::query()->whereRaw('LOWER(email) = ?', [strtolower($email)])->first();
            if ($owner) {
                break;
            }
        }

        if (! $owner) {
            $this->error('Owner not found. Tried: '.implode(', ', $candidates));

            return self::FAILURE;
        }

        $this->info("Owner #{$owner->id} · {$owner->email}");

        foreach (self::STAFF as $spec) {
            $email = strtolower($spec['email']);
            if ($dryRun) {
                $this->line("[dry-run] upsert {$email} as {$spec['role']} under tenant {$owner->id}");
                continue;
            }

            DB::transaction(function () use ($owner, $spec, $email) {
                $member = User::query()->whereRaw('LOWER(email) = ?', [$email])->first();
                if (! $member) {
                    $member = User::create([
                        'name' => $spec['name'],
                        'email' => $email,
                        'password' => Hash::make($spec['password']),
                    ]);
                    $this->info("Created user #{$member->id} {$email}");
                } else {
                    $member->forceFill([
                        'name' => $member->name ?: $spec['name'],
                        'password' => Hash::make($spec['password']),
                    ])->save();
                    $this->info("Updated password for user #{$member->id} {$email}");
                }

                if ((int) $member->id === (int) $owner->id) {
                    $this->warn("Skipping membership — {$email} is the owner.");

                    return;
                }

                $existing = TenantMembership::withTrashed()
                    ->where('tenant_user_id', $owner->id)
                    ->where('member_user_id', $member->id)
                    ->first();

                if ($existing) {
                    if ($existing->trashed()) {
                        $existing->restore();
                    }
                    $existing->fill([
                        'role' => $spec['role'],
                        'invited_at' => $existing->invited_at ?? now(),
                        'accepted_at' => now(),
                    ])->save();
                    $this->info("Updated membership #{$existing->id} → {$spec['role']}");
                } else {
                    $membership = TenantMembership::create([
                        'tenant_user_id' => $owner->id,
                        'member_user_id' => $member->id,
                        'role' => $spec['role'],
                        'invited_at' => now(),
                        'accepted_at' => now(),
                    ]);
                    $this->info("Created membership #{$membership->id} → {$spec['role']}");
                }
            });
        }

        TenantContext::flush();
        $this->info('Done.');

        return self::SUCCESS;
    }
}
