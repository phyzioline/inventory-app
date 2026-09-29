<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('settlement_items')) {
            return;
        }

        Schema::table('settlement_items', function (Blueprint $table) {
            if (! Schema::hasColumn('settlement_items', 'line_kind')) {
                $table->string('line_kind', 40)->nullable()->after('transaction_type');
                $table->index('line_kind');
            }
            if (! Schema::hasColumn('settlement_items', 'line_fingerprint')) {
                $table->string('line_fingerprint', 64)->nullable()->after('line_kind');
                $table->index(['settlement_id', 'line_fingerprint']);
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('settlement_items')) {
            return;
        }

        Schema::table('settlement_items', function (Blueprint $table) {
            if (Schema::hasColumn('settlement_items', 'line_fingerprint')) {
                $table->dropIndex(['settlement_id', 'line_fingerprint']);
                $table->dropColumn('line_fingerprint');
            }
            if (Schema::hasColumn('settlement_items', 'line_kind')) {
                $table->dropIndex(['line_kind']);
                $table->dropColumn('line_kind');
            }
        });
    }
};
