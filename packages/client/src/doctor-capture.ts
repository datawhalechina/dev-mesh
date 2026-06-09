import type { DevMeshDoctorCheck, DoctorContext } from './doctor-types.js';

export async function checkCapture(_context: DoctorContext): Promise<DevMeshDoctorCheck[]> {
  return [
    {
      id: 'capture.auto',
      category: 'capture',
      status: 'ok',
      message:
        'Assistant-led knowledge capture is always available through MCP tool prompts; there is no local capture toggle.'
    }
  ];
}
