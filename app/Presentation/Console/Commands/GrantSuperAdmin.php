<?php

namespace App\Presentation\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

class GrantSuperAdmin extends Command
{
    protected $signature = 'admin:grant-super {email}';

    protected $description = 'Grant an existing user is_super_admin (idempotent)';

    public function handle(): int
    {
        $email = $this->argument('email');
        $user = User::query()->where('email', $email)->first();

        if (! $user) {
            $this->error("No user found with email {$email}.");

            return self::FAILURE;
        }

        $user->update(['is_super_admin' => true]);
        $this->info("Granted is_super_admin to {$email} (user #{$user->id}).");

        return self::SUCCESS;
    }
}
