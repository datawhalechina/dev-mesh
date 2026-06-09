import type { DevMeshDoctorCheck, DoctorContext } from './doctor-types.js';

export async function checkCapture(context: DoctorContext): Promise<DevMeshDoctorCheck[]> {
  const autoCapture = context.projectConfig?.automation.autoCapture ?? true;

  if (!autoCapture) {
    return [
      {
        id: 'capture.auto',
        category: 'capture',
        status: 'warn',
        message: 'Assistant-led knowledge capture is disabled in project automation settings.',
        fixHint: 'Set automation.auto_capture to true when you want MCP hosts to be prompted to preserve durable knowledge.'
      }
    ];
  }

  return [
    {
      id: 'capture.auto',
      category: 'capture',
      status: 'ok',
      message:
        'Assistant-led knowledge capture is enabled; MCP hosts decide when to call capture tools from the active coding context.'
    }
  ];
}
