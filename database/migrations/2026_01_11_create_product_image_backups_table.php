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
        Schema::create('product_image_backups', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('product_id')->nullable(); // Nullable since product may be deleted
            $table->string('product_sku')->index();
            $table->string('product_name')->nullable();
            $table->string('image_path'); // Path to backed up image file
            $table->string('original_url')->nullable(); // Original URL if imported
            $table->timestamp('deleted_at')->nullable();
            $table->timestamps();

            // Index for cleanup queries
            $table->index('created_at');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('product_image_backups');
    }
};
