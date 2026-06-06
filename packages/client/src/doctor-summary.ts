import type { DevMeshDoctorCheck, DevMeshDoctorStatus } from './doctor-types.js';

export function summarizeChecks(checks: DevMeshDoctorCheck[]): Record<DevMeshDoctorStatus, number> {
  return checks.reduce(
    (summary, check) => {
      summary[check.status] += 1;
      return summary;
    },
    {
      ok: 0,
      warn: 0,
      error: 0
    }
  );
}

export function compactCheck(check: DevMeshDoctorCheck): DevMeshDoctorCheck {
  if (check.fixHint === undefined) {
    return {
      id: check.id,
      category: check.category,
      status: check.status,
      message: check.message
    };
  }

  return check;
}

export function compactChecks(checks: DevMeshDoctorCheck[]): DevMeshDoctorCheck[] {
  return checks.map(compactCheck);
}
