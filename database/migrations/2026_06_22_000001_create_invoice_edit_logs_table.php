<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inv_invoice_edit_logs', function (Blueprint $table) {
            $table->id();
            // Plain index instead of FK — production DB was migrated from MySQL via pgloader
            // and inventory_orders.id may lack a PRIMARY KEY constraint. We add the FK
            // conditionally below only when the PK is confirmed to exist.
            $table->unsignedBigInteger('inventory_order_id')->index();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->json('before_snapshot');
            $table->json('after_snapshot');
            $table->json('items_delta')->nullable();
            $table->json('payment_delta')->nullable();
            $table->text('reason')->nullable();
            $table->timestamps();
        });

        if (Schema::hasTable('inventory_orders') && $this->tableHasPrimaryKey('inventory_orders')) {
            try {
                Schema::table('inv_invoice_edit_logs', function (Blueprint $table) {
                    $table->foreign('inventory_order_id')
                        ->references('id')->on('inventory_orders')
                        ->cascadeOnDelete();
                });
            } catch (\Illuminate\Database\QueryException $e) {
                // inventory_orders.id lacks a unique constraint on this environment
                // (pgloader MySQL→PostgreSQL migration artifact). The plain index above suffices.
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('inv_invoice_edit_logs');
    }

    private function tableHasPrimaryKey(string $table): bool
    {
        if (DB::getDriverName() !== 'pgsql') {
            return true;
        }

        return (bool) DB::selectOne("
            SELECT 1
            FROM information_schema.table_constraints
            WHERE table_schema = current_schema()
              AND table_name = ?
              AND constraint_type = 'PRIMARY KEY'
        ", [$table]);
    }
};
