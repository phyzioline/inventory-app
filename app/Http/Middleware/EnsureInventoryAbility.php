<?php

namespace App\Http\Middleware;

use App\Application\Services\InventoryAbilityService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureInventoryAbility
{
    public function __construct(
        private readonly InventoryAbilityService $abilities,
    ) {}

    /**
     * @param  string  ...$required  One or more abilities; any match grants access (OR).
     */
    public function handle(Request $request, Closure $next, string ...$required): Response
    {
        if ($required === []) {
            abort(500, 'EnsureInventoryAbility requires at least one ability.');
        }

        foreach ($required as $ability) {
            if ($this->abilities->can($ability)) {
                return $next($request);
            }
        }

        abort(403, 'Missing ability: '.$required[0]);
    }
}
