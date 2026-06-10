import { formatMeshToolOutput, type MeshToolName } from '@devmesh/mcp-contracts';

export function printJsonOrText(toolName: MeshToolName, value: unknown, json?: boolean): void {
  console.log(json === true ? JSON.stringify(value, null, 2) : formatMeshToolOutput(toolName, value));
}
