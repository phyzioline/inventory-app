<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private function indexExists(string $table, string $indexName): bool
    {
        return migration_index_exists($table, $indexName);
    }

    public function up(): void
    {
        if (! Schema::hasTable('channels')) {
            return;
        }

        Schema::table('channels', function (Blueprint $table) {
            if (! Schema::hasColumn('channels', 'user_id')) {
                $table->foreignId('user_id')->nullable()->after('id')->constrained('users')->nullOnDelete();
                $table->index('user_id');
            }
        });

        // Drop legacy global unique on slug (if present) then add per-user uniqueness.
        // Default index name for $table->string('slug')->unique() is usually: channels_slug_unique
        if ($this->indexExists('channels', 'channels_slug_unique')) {
            Schema::table('channels', function (Blueprint $table) {
                $table->dropUnique('channels_slug_unique');
            });
        }

        // Ensure we don't already have the composite unique.
        if (! $this->indexExists('channels', 'channels_user_id_slug_unique')) {
            Schema::table('channels', function (Blueprint $table) {
                $table->unique(['user_id', 'slug'], 'channels_user_id_slug_unique');
            });
        }

        // Backfill: keep existing rows visible to some user (optional).
        // If there are old rows with NULL user_id, attach them to the first user (id=1) if it exists.
        // This prevents "hidden channels" after adding tenant isolation.
        if (Schema::hasColumn('channels', 'user_id')) {
            $firstUserId = DB::table('users')->orderBy('id')->value('id');
            if ($firstUserId) {
                DB::table('channels')->whereNull('user_id')->update(['user_id' => $firstUserId]);
            }
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('channels')) {
            return;
        }

        if ($this->indexExists('channels', 'channels_user_id_slug_unique')) {
            Schema::table('channels', function (Blueprint $table) {
                $table->dropUnique('channels_user_id_slug_unique');
            });
        }

        if (! $this->indexExists('channels', 'channels_slug_unique')) {
            Schema::table('channels', function (Blueprint $table) {
                $table->unique('slug', 'channels_slug_unique');
            });
        }

        if (Schema::hasColumn('channels', 'user_id')) {
            Schema::table('channels', function (Blueprint $table) {
                $table->dropConstrainedForeignId('user_id');
            });
        }
    }
};
