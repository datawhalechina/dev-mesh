import { readDaemonAutoCaptureStatus } from './daemon-auto-capture.js';
import type { DevMeshDoctorCheck, DoctorContext } from './doctor-types.js';

export async function checkCapture(context: DoctorContext): Promise<DevMeshDoctorCheck[]> {
  const autoCapture = context.projectConfig?.automation.autoCapture ?? true;
  const status = await readDaemonAutoCaptureStatus(context.projectRoot);

  if (!autoCapture) {
    return [
      {
        id: 'capture.auto',
        category: 'capture',
        status: 'ok',
        message: 'Project auto_capture is disabled; background development signal capture is idle.'
      }
    ];
  }

  if (status === undefined) {
    return [
      {
        id: 'capture.auto',
        category: 'capture',
        status: 'ok',
        message: 'Daemon auto capture has not run yet; dmx serve --mcp will start it on demand.'
      }
    ];
  }

  const errors = status.providers.filter((provider) => provider.lastError !== undefined);

  if (errors.length > 0) {
    return [
      {
        id: 'capture.auto',
        category: 'capture',
        status: 'warn',
        message: `Daemon auto capture checked ${status.providers.length} provider(s), captured ${status.capturedEvents} signal(s), and reported ${errors.length} error(s).`,
        fixHint: 'Check .dev-mesh/capture/status.json for the latest provider error.'
      }
    ];
  }

  return [
    {
      id: 'capture.auto',
      category: 'capture',
      status: 'ok',
      message: `Daemon auto capture checked ${status.providers.length} provider(s), captured ${status.capturedEvents} signal(s), and skipped ${status.skippedEvents} duplicate or empty signal(s).`
    }
  ];
}
