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
        // Add barcode field to existing products table if not exists
        if (Schema::hasTable('products') && ! Schema::hasColumn('products', 'barcode')) {
            Schema::table('products', function (Blueprint $table) {
                $table->string('barcode')->nullable()->unique();
            });
        }

        // Create suppliers table if not exists
        if (! Schema::hasTable('suppliers')) {
            Schema::create('suppliers', function (Blueprint $table) {
                $table->id();
                $table->string('name');
                $table->string('email')->nullable()->unique();
                $table->string('phone')->nullable();
                $table->text('address')->nullable();
                $table->decimal('balance', 15, 2)->default(0);
                $table->timestamps();
            });
        }

        // Create ASINs table if not exists
        if (! Schema::hasTable('asins')) {
            Schema::create('asins', function (Blueprint $table) {
                $table->id();
                $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
                $table->string('asin_code', 10)->unique();
                $table->string('marketplace')->nullable();
                $table->decimal('display_price', 10, 2)->nullable();
                $table->string('status')->default('active');
                $table->text('notes')->nullable();
                $table->string('image_url')->nullable();
                $table->timestamps();
            });
        }

        // Create ASIN Price History if not exists
        if (! Schema::hasTable('asin_price_history')) {
            Schema::create('asin_price_history', function (Blueprint $table) {
                $table->id();
                $table->foreignId('asin_id')->constrained('asins')->cascadeOnDelete();
                $table->decimal('price', 10, 2);
                $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
            });
        }

        // Create warehouses table if not exists
        if (! Schema::hasTable('warehouses')) {
            Schema::create('warehouses', function (Blueprint $table) {
                $table->id();
                $table->string('name');
                $table->string('type')->nullable();
                $table->string('location')->nullable();
                $table->boolean('is_active')->default(true);
                $table->timestamps();
            });
        }

        // Create inventory table if not exists
        if (! Schema::hasTable('inventory')) {
            Schema::create('inventory', function (Blueprint $table) {
                $table->id();
                $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
                $table->foreignId('warehouse_id')->constrained('warehouses')->cascadeOnDelete();
                $table->integer('quantity')->default(0);
                $table->timestamps();

                $table->unique(['product_id', 'warehouse_id']);
            });
        }

        // Create sales_orders table if not exists
        if (! Schema::hasTable('sales_orders')) {
            Schema::create('sales_orders', function (Blueprint $table) {
                $table->id();
                $table->string('order_number')->unique();
                $table->string('external_order_number')->nullable();
                $table->foreignId('warehouse_id')->nullable()->constrained('warehouses')->nullOnDelete();
                $table->string('status')->default('pending');
                $table->decimal('total_amount', 10, 2)->default(0);
                $table->dateTime('order_date');
                $table->timestamps();
            });
        }

        // Create sales_order_items table if not exists
        if (! Schema::hasTable('sales_order_items')) {
            Schema::create('sales_order_items', function (Blueprint $table) {
                $table->id();
                $table->foreignId('sales_order_id')->constrained('sales_orders')->cascadeOnDelete();
                $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
                $table->integer('quantity');
                $table->decimal('unit_price', 10, 2);
                $table->decimal('total_price', 10, 2);
                $table->timestamps();
            });
        }

        // Add fields to existing returns table OR create if not exists
        if (Schema::hasTable('returns')) {
            // Add new fields to existing returns table
            if (! Schema::hasColumn('returns', 'condition')) {
                Schema::table('returns', function (Blueprint $table) {
                    $table->enum('condition', ['good', 'damaged'])->default('good');
                });
            }
            if (! Schema::hasColumn('returns', 'detected_channel')) {
                Schema::table('returns', function (Blueprint $table) {
                    $table->string('detected_channel')->nullable();
                });
            }
        } else {
            // Create returns table if it doesn't exist
            Schema::create('returns', function (Blueprint $table) {
                $table->id();
                $table->string('return_number')->unique();
                $table->foreignId('sales_order_id')->nullable()->constrained('sales_orders')->nullOnDelete();
                $table->foreignId('product_id')->nullable()->constrained('products')->nullOnDelete();
                $table->foreignId('warehouse_id')->nullable()->constrained('warehouses')->nullOnDelete();
                $table->string('amazon_order_number')->nullable();
                $table->string('return_type')->default('stock');
                $table->string('return_status')->default('pending');
                $table->enum('condition', ['good', 'damaged'])->default('good');
                $table->string('detected_channel')->nullable();
                $table->integer('quantity')->default(1);
                $table->string('reason')->nullable();
                $table->text('notes')->nullable();
                $table->string('status')->default('pending');
                $table->decimal('refund_amount', 10, 2)->nullable();
                $table->timestamps();
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // Remove added fields
        if (Schema::hasColumn('products', 'barcode')) {
            Schema::table('products', function (Blueprint $table) {
                $table->dropColumn('barcode');
            });
        }

        if (Schema::hasColumn('returns', 'condition')) {
            Schema::table('returns', function (Blueprint $table) {
                $table->dropColumn(['condition', 'detected_channel']);
            });
        }

        // Drop created tables
        Schema::dropIfExists('sales_order_items');
        Schema::dropIfExists('sales_orders');
        Schema::dropIfExists('inventory');
        Schema::dropIfExists('warehouses');
        Schema::dropIfExists('asin_price_history');
        Schema::dropIfExists('asins');
        Schema::dropIfExists('suppliers');
    }
};
