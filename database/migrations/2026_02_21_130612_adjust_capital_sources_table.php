<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('capital_sources', function (Blueprint $table) {
            $table->string('type', 100)->change();
            if (! Schema::hasColumn('capital_sources', 'ownership_percentage')) {
                $table->decimal('ownership_percentage', 8, 2)->default(0)->after('amount');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('capital_sources', function (Blueprint $table) {
            // Cannot easily revert string back to enum without defining same values exactly
            // and might lose data if types were added. We'll leave it as string for safety.
            if (Schema::hasColumn('capital_sources', 'ownership_percentage')) {
                $table->dropColumn('ownership_percentage');
            }
        });
    }
};
