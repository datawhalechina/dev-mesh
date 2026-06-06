import type {
  CaptureProvider,
  DevMeshExtension,
  ExtensionComponent,
  ExtensionKind,
  ExtensionRegistry,
  Extractor,
  QualityScorer,
  Redactor,
  SearchBackend,
  StorageBackend,
  SyncBackend,
  ToolAdapter
} from '@mcp-dev-mesh/extension-api';

export class DefaultExtensionRegistry implements ExtensionRegistry {
  private readonly components = new Map<ExtensionKind, ExtensionComponent[]>();

  registerAdapter(adapter: ToolAdapter): void {
    this.registerComponent('tool-adapter', adapter);
  }

  registerProvider(provider: CaptureProvider): void {
    this.registerComponent('capture-provider', provider);
  }

  registerExtractor(extractor: Extractor): void {
    this.registerComponent('extractor', extractor);
  }

  registerRedactor(redactor: Redactor): void {
    this.registerComponent('redactor', redactor);
  }

  registerScorer(scorer: QualityScorer): void {
    this.registerComponent('quality-scorer', scorer);
  }

  registerSearchBackend(search: SearchBackend): void {
    this.registerComponent('search-backend', search);
  }

  registerStorageBackend(storage: StorageBackend): void {
    this.registerComponent('storage-backend', storage);
  }

  registerSyncBackend(sync: SyncBackend): void {
    this.registerComponent('sync-backend', sync);
  }

  async registerExtension(extension: DevMeshExtension): Promise<void> {
    await extension.register(this);
  }

  resolve<T extends ExtensionComponent = ExtensionComponent>(kind: ExtensionKind, capability: string): T[] {
    return this.list<T>(kind)
      .filter((component) => component.capabilities.includes(capability))
      .sort(sortByPriorityThenId);
  }

  list<T extends ExtensionComponent = ExtensionComponent>(kind?: ExtensionKind): T[] {
    if (!kind) {
      return [...this.components.values()].flat().sort(sortByPriorityThenId) as T[];
    }

    return [...(this.components.get(kind) ?? [])].sort(sortByPriorityThenId) as T[];
  }

  private registerComponent(kind: ExtensionKind, component: ExtensionComponent): void {
    if (component.kind !== kind) {
      throw new Error(`Cannot register ${component.id} as ${kind}; component kind is ${component.kind}`);
    }

    const bucket = this.components.get(kind) ?? [];
    const next = bucket.filter((existing) => existing.id !== component.id);
    next.push(component);
    this.components.set(kind, next);
  }
}

function sortByPriorityThenId(a: ExtensionComponent, b: ExtensionComponent): number {
  const priority = (b.priority ?? 0) - (a.priority ?? 0);

  if (priority !== 0) {
    return priority;
  }

  return a.id.localeCompare(b.id);
}

export function createExtensionRegistry(): ExtensionRegistry {
  return new DefaultExtensionRegistry();
}

export type { ExtensionRegistry };
