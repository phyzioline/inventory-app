<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Import session ledger — one row per approved import execution.
 *
 * Purpose:
 *  ✔ Forensic debugging: know exactly what file caused what stock change
 *  ✔ Partial failure detection: 'partial' status = some rows failed mid-batch
 *  ✔ Replay safety: re-importing the same file (same file_hash) can be detected
 *    and fast-pathed (only unprocessed rows need work)
 *  ✔ Audit trail: timestamp + user + channel on every import
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_import_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->unsignedBigInteger('channel_id')->nullable()->index();

            // SHA-256 of the uploaded file bytes.
            // Same hash = same file bytes. Two sessions with the same hash mean the file
            // was uploaded twice; the application can warn the user or fast-path the second run.
            $table->string('file_hash', 64)->nullable()->index();

            // Processing lifecycle: processing → completed | partial | failed | blocked | rolled_back
            $table->string('status', 20)->default('processing')->index();

            $table->unsignedInteger('total_rows')->default(0);
            $table->unsignedInteger('imported_rows')->default(0);
            $table->unsignedInteger('skipped_rows')->default(0);
            $table->unsignedInteger('failed_rows')->default(0);

            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            // Find recent sessions for a given user/channel quickly.
            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_import_sessions');
    }
};
