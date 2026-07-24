<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    // FK columns on high-traffic tables that need indexes for join performance.
    // Only added if table + column exist AND index does not already exist.
    private array $targets = [
        'sessions' => ['therapist_id', 'patient_id', 'clinic_id', 'appointment_date'],
        'home_visits' => ['patient_id', 'therapist_id', 'clinic_id', 'scheduled_at', 'status'],
        'clinic_appointments' => ['clinic_id', 'patient_id', 'therapist_id', 'appointment_date', 'status'],
        'enrollments' => ['user_id', 'course_id', 'payment_status', 'enrolled_at'],
        'orders' => ['user_id', 'status', 'payment_status', 'created_at'],
        'analytics_events' => ['session_id', 'event_type'],
        'analytics_sessions' => ['user_id', 'lead_id', 'campaign_id'],
        'crm_leads' => ['status', 'assigned_to', 'created_at'],
        'whatsapp_message_logs' => ['status', 'scenario_key', 'scheduled_at'],
        'earnings_transactions' => ['user_id', 'source', 'status'],
        'clinic_staff' => ['user_id', 'clinic_id', 'is_active'],
        'patients' => ['clinic_id', 'user_id'],
        'treatment_programs' => ['clinic_id', 'patient_id'],
        'insurance_claims' => ['clinic_id', 'patient_id', 'status'],
        'jobs' => ['status', 'company_id'],
        'job_applications' => ['job_id', 'user_id', 'status'],
        'inventory_orders' => ['channel_id', 'status', 'order_date'],
        'inventory_transactions' => ['sku_id', 'location_id', 'transaction_type'],
    ];

    public function up(): void
    {
        foreach ($this->targets as $table => $columns) {
            if (! Schema::hasTable($table)) {
                continue;
            }

            Schema::table($table, function (Blueprint $blueprint) use ($table, $columns) {
                foreach ($columns as $column) {
                    if (! Schema::hasColumn($table, $column)) {
                        continue;
                    }

                    $indexName = "{$table}_{$column}_index";
                    if (! migration_index_exists($table, $indexName)) {
                        $blueprint->index($column, $indexName);
                    }
                }
            });
        }
    }

    public function down(): void
    {
        foreach ($this->targets as $table => $columns) {
            if (! Schema::hasTable($table)) {
                continue;
            }

            Schema::table($table, function (Blueprint $blueprint) use ($table, $columns) {
                foreach ($columns as $column) {
                    if (Schema::hasColumn($table, $column)) {
                        try {
                            $blueprint->dropIndex([$column]);
                        } catch (\Throwable) {
                        }
                    }
                }
            });
        }
    }
};
