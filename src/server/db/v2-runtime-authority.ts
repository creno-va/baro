/** Same fiscal allocation, renewed coordinator lease. The original manifest
 * and proof stay immutable. A freeze/reallocation revision invalidates renewal. */
export function allocationUntilSql(
  control: string,
  proof: string,
  fallback = `${proof}.valid_until`,
) {
  return `coalesce((SELECT renewal.valid_until FROM v2_runtime_refreshes renewal
    JOIN v2_monthly_budget renewal_budget ON renewal_budget.month=renewal.month AND renewal_budget.environment=renewal.environment AND renewal_budget.allocation_version=renewal.allocation_version
    WHERE renewal.environment=${control}.environment AND renewal.month=${control}.month
      AND renewal.control_revision=${control}.revision AND renewal.allocation_proof_id=${proof}.id),${fallback})`;
}
