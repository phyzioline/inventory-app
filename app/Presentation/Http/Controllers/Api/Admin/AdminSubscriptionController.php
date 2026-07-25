<?php

declare(strict_types=1);

namespace App\Presentation\Http\Controllers\Api\Admin;

use App\Domain\Models\Subscription;
use App\Http\Controllers\Controller;

class AdminSubscriptionController extends Controller
{
    public function index()
    {
        return response()->json(
            Subscription::with(['plan', 'user:id,name,email'])
                ->latest('id')
                ->paginate(50)
        );
    }
}
