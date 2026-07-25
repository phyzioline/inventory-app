<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('channels')) {
            return;
        }

        Schema::table('channels', function (Blueprint $table) {
            if (! Schema::hasColumn('channels', 'merchant_identifier')) {
                $table->string('merchant_identifier')->nullable()->after('type');
                $table->index('merchant_identifier');
            }

            if (! Schema::hasColumn('channels', 'account_label')) {
                $table->string('account_label')->nullable()->after('merchant_identifier');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('channels')) {
            return;
        }

        Schema::table('channels', function (Blueprint $table) {
            if (Schema::hasColumn('channels', 'account_label')) {
                $table->dropColumn('account_label');
            }

            if (Schema::hasColumn('channels', 'merchant_identifier')) {
                $table->dropIndex(['merchant_identifier']);
                $table->dropColumn('merchant_identifier');
            }
        });
    }
};
