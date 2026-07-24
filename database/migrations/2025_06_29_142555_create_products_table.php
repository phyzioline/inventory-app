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
        if (! Schema::hasTable('products')) {
            Schema::create('products', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained('users', 'id')->cascadeOnDelete();
                // category_id / sub_category_id intentionally NOT constrained here: they pointed at
                // the monolith's Ecommerce `categories` / `sub_categories` tables, which this
                // standalone extraction does not carry (Product's category relations were removed —
                // see App\Domain\Models\Product). Columns are kept only because App\Domain\Events\
                // ProductCreated still type-hints Product and the product_status migrations below
                // touch this table; no code in this app reads/writes these two columns.
                $table->unsignedBigInteger('category_id')->nullable();
                $table->unsignedBigInteger('sub_category_id')->nullable();
                $table->string('product_name_ar');
                $table->string('product_name_en');
                $table->string('product_price');
                $table->text('short_description_ar')->nullable();
                $table->text('short_description_en')->nullable();
                $table->text('long_description_ar')->nullable();
                $table->text('long_description_en')->nullable();
                $table->unsignedBigInteger('amount')->nullable();
                $table->string('sku')->unique();
                $table->enum('status', ['active', 'inactive'])->default('inactive');
                $table->timestamps();
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('products');
    }
};
