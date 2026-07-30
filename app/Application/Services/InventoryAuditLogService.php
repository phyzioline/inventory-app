<?php

namespace App\Application\Services;

use Illuminate\Support\Facades\Auth;
use App\Domain\Models\Wms\InventoryAuditLog;

class InventoryAuditLogService
{
    /**
     * @param  array<string, mixed>  $payload
     */
    public function record(string $action, ?string $subjectType = null, ?int $subjectId = null, array $payload = []): void
    {
        try {
            InventoryAuditLog::query()->create([
                'user_id' => Auth::id(),
                'action' => $action,
                'subject_type' => $subjectType,
                'subject_id' => $subjectId,
                'payload' => $payload === [] ? null : $payload,
            ]);
        } catch (\Throwable $e) {
            // Never block money/stock flows on audit write failure.
            report($e);
        }
    }
}
