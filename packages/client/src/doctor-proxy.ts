import { inspectLocalMcpDaemon } from './local-mcp-daemon.js';
import type { DevMeshDoctorCheck, DoctorContext } from './doctor-types.js';

export async function checkProxy(context: DoctorContext): Promise<DevMeshDoctorCheck[]> {
  const daemon = await inspectLocalMcpDaemon(context.projectRoot);

  if (daemon.running) {
    return [
      {
        id: 'proxy.daemon',
        category: 'proxy',
        status: 'ok',
        message: daemon.message
      }
    ];
  }

  return [
    {
      id: 'proxy.daemon',
      category: 'proxy',
      status: 'ok',
      message: 'No shared daemon is running right now; dmx serve --mcp will start it on demand.'
    }
  ];
}
