<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('tenant_memberships')) {
            Schema::create('tenant_memberships', function (Blueprint $table) {
                $table->id();
                $table->foreignId('tenant_user_id')->constrained('users')->cascadeOnDelete();
                $table->foreignId('member_user_id')->constrained('users')->cascadeOnDelete();
                $table->string('role', 32); // owner|manager|warehouse|accountant|viewer
                $table->timestamp('invited_at')->nullable();
                $table->timestamp('accepted_at')->nullable();
                $table->timestamps();
                $table->softDeletes();
                $table->unique(['tenant_user_id', 'member_user_id']);
                $table->index(['member_user_id', 'role']);
            });
        }

        if (Schema::hasTable('sku_inventory')) {
            Schema::table('sku_inventory', function (Blueprint $table) {
                if (! Schema::hasColumn('sku_inventory', 'lot_number')) {
                    $table->string('lot_number', 128)->nullable()->after('reserved');
                }
                if (! Schema::hasColumn('sku_inventory', 'serial_number')) {
                    $table->string('serial_number', 128)->nullable()->after('lot_number');
                }
            });
        }

        if (! Schema::hasTable('inventory_cycle_counts')) {
            Schema::create('inventory_cycle_counts', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
                $table->foreignId('location_id')->constrained('inventory_locations')->cascadeOnDelete();
                $table->string('status', 32)->default('draft'); // draft|counting|posted|cancelled
                $table->string('notes', 500)->nullable();
                $table->timestamp('posted_at')->nullable();
                $table->timestamps();
                $table->index(['user_id', 'status']);
            });
        }

        if (! Schema::hasTable('inventory_cycle_count_items')) {
            Schema::create('inventory_cycle_count_items', function (Blueprint $table) {
                $table->id();
                $table->foreignId('cycle_count_id')->constrained('inventory_cycle_counts')->cascadeOnDelete();
                $table->foreignId('sku_id')->constrained('skus')->cascadeOnDelete();
                $table->decimal('system_qty', 15, 4)->default(0);
                $table->decimal('counted_qty', 15, 4)->nullable();
                $table->decimal('variance_qty', 15, 4)->nullable();
                $table->timestamps();
                $table->unique(['cycle_count_id', 'sku_id']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_cycle_count_items');
        Schema::dropIfExists('inventory_cycle_counts');

        if (Schema::hasTable('sku_inventory')) {
            Schema::table('sku_inventory', function (Blueprint $table) {
                if (Schema::hasColumn('sku_inventory', 'serial_number')) {
                    $table->dropColumn('serial_number');
                }
                if (Schema::hasColumn('sku_inventory', 'lot_number')) {
                    $table->dropColumn('lot_number');
                }
            });
        }

        Schema::dropIfExists('tenant_memberships');
    }
};
