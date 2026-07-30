<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Application\Services\StaffMembershipService;
use App\Http\Controllers\Controller;
use App\Presentation\Http\Requests\InviteStaffRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class StaffMembershipController extends Controller
{
    public function __construct(
        private readonly StaffMembershipService $staff,
    ) {}

    public function index(): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => $this->staff->listForTenant(),
        ]);
    }

    public function store(InviteStaffRequest $request): JsonResponse
    {
        $data = $request->validated();

        $result = $this->staff->invite(
            $data['email'],
            (string) ($data['name'] ?? ''),
            $data['role'],
        );

        return response()->json([
            'success' => true,
            'data' => [
                'id' => $result['membership']->id,
                'role' => $result['membership']->role,
                'member' => [
                    'id' => $result['membership']->member?->id,
                    'name' => $result['membership']->member?->name,
                    'email' => $result['membership']->member?->email,
                ],
                'temporary_password' => $result['temporary_password'],
            ],
        ], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $data = $request->validate([
            'role' => ['required', 'string', 'in:manager,warehouse,accountant,viewer'],
        ]);

        $membership = $this->staff->updateRole($id, $data['role']);

        return response()->json([
            'success' => true,
            'data' => [
                'id' => $membership->id,
                'role' => $membership->role,
                'member' => [
                    'id' => $membership->member?->id,
                    'name' => $membership->member?->name,
                    'email' => $membership->member?->email,
                ],
            ],
        ]);
    }

    public function destroy(int $id): JsonResponse
    {
        $this->staff->revoke($id);

        return response()->json(['success' => true]);
    }
}
