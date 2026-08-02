<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Domain\Models\Wms\Employee;
use App\Domain\Models\Wms\Expense;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class EmployeeController extends Controller
{
    public function index(Request $request)
    {
        $query = Employee::query()->orderBy('name');

        if ($request->boolean('active_only')) {
            $query->active();
        }

        return response()->json($query->get());
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'job_title' => 'nullable|string|max:255',
            'phone' => 'nullable|string|max:50',
            'base_salary' => 'nullable|numeric|min:0',
            'is_active' => 'nullable|boolean',
            'hired_at' => 'nullable|date',
            'notes' => 'nullable|string|max:2000',
        ]);

        $validated['user_id'] = Auth::id();
        $validated['is_active'] = $validated['is_active'] ?? true;
        $validated['name'] = trim($validated['name']);

        $employee = Employee::create($validated);

        return response()->json($employee, 201);
    }

    public function show($id)
    {
        return response()->json(Employee::findOrFail($id));
    }

    public function update(Request $request, $id)
    {
        $employee = Employee::findOrFail($id);

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'job_title' => 'nullable|string|max:255',
            'phone' => 'nullable|string|max:50',
            'base_salary' => 'nullable|numeric|min:0',
            'is_active' => 'nullable|boolean',
            'hired_at' => 'nullable|date',
            'notes' => 'nullable|string|max:2000',
        ]);

        if (isset($validated['name'])) {
            $validated['name'] = trim($validated['name']);
        }

        $employee->update($validated);

        return response()->json($employee->fresh());
    }

    public function destroy($id)
    {
        $employee = Employee::findOrFail($id);
        $employee->delete();

        return response()->json(['message' => 'Employee deleted successfully']);
    }

    /**
     * Import distinct salary beneficiaries from inv_expenses into inv_employees.
     */
    public function importFromExpenses()
    {
        $names = Expense::query()
            ->where('category', 'salaries')
            ->whereNotNull('vendor_name')
            ->where('vendor_name', '!=', '')
            ->pluck('vendor_name')
            ->map(fn ($n) => trim((string) $n))
            ->filter()
            ->unique(fn ($n) => mb_strtolower($n))
            ->values();

        $created = 0;
        $skipped = 0;

        foreach ($names as $name) {
            $exists = Employee::query()
                ->whereRaw('LOWER(TRIM(name)) = ?', [mb_strtolower($name)])
                ->exists();

            if ($exists) {
                $skipped++;

                continue;
            }

            Employee::create([
                'user_id' => Auth::id(),
                'name' => $name,
                'is_active' => true,
            ]);
            $created++;
        }

        return response()->json([
            'message' => 'Import completed',
            'created' => $created,
            'skipped' => $skipped,
            'employees' => Employee::query()->orderBy('name')->get(),
        ]);
    }
}
