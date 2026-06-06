export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  [key: string]: unknown;
};

export type ExtensionKind =
  | 'tool-adapter'
  | 'capture-provider'
  | 'extractor'
  | 'redactor'
  | 'quality-scorer'
  | 'search-backend'
  | 'storage-backend'
  | 'sync-backend'
  | 'knowledge-type-plugin';

export interface ExtensionComponent {
  id: string;
  kind: ExtensionKind;
  capabilities: string[];
  priority?: number;
  configSchema?: JsonSchema;
}

export interface DevMeshExtension extends ExtensionComponent {
  version: string;
  register(registry: ExtensionRegistry): void | Promise<void>;
}

export interface ExtensionManifest extends ExtensionComponent {
  version: string;
  entry: string;
}

export const extensionManifestJsonSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'version', 'kind', 'entry', 'capabilities'],
  properties: {
    id: { type: 'string' },
    version: { type: 'string' },
    kind: {
      type: 'string',
      enum: [
        'tool-adapter',
        'capture-provider',
        'extractor',
        'redactor',
        'quality-scorer',
        'search-backend',
        'storage-backend',
        'sync-backend',
        'knowledge-type-plugin'
      ]
    },
    entry: { type: 'string' },
    capabilities: {
      type: 'array',
      items: { type: 'string' }
    },
    priority: { type: 'number' },
    configSchema: { type: 'object' }
  },
  additionalProperties: false
};

export type ToolCapability = 'tool.detect' | 'mcp.configure' | 'session.observe' | string;
export type CaptureCapability = 'capture.git' | 'capture.filesystem' | 'capture.command' | 'capture.mcp-tool' | string;

export interface DetectResult {
  detected: boolean;
  name?: string;
  version?: string;
  path?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface ConfigureInput {
  projectRoot: string;
  mcpUrl: string;
  scope?: 'user' | 'project';
  dryRun?: boolean;
}

export interface ConfigureResult {
  changed: boolean;
  targetPath?: string;
  message?: string;
}

export interface RemoveInput {
  projectRoot: string;
  scope?: 'user' | 'project';
}

export interface DoctorCheck {
  id: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fixHint?: string;
}

export interface ToolAdapter extends ExtensionComponent {
  kind: 'tool-adapter';
  capabilities: ToolCapability[];
  detect(): Promise<DetectResult>;
  isConfigured(projectRoot: string): Promise<boolean>;
  configure(input: ConfigureInput): Promise<ConfigureResult>;
  remove(input: RemoveInput): Promise<void>;
  doctor(projectRoot: string): Promise<DoctorCheck[]>;
}

export interface CaptureContext {
  projectRoot: string;
  since?: string;
  metadata?: Record<string, unknown>;
}

export interface RawEvent {
  id: string;
  kind: string;
  summary: string;
  payload?: Record<string, unknown>;
  createdAt: string;
  source?: Record<string, unknown>;
}

export interface CaptureProvider extends ExtensionComponent {
  kind: 'capture-provider';
  capabilities: CaptureCapability[];
  detect(projectRoot: string): Promise<boolean>;
  collect(ctx: CaptureContext): AsyncIterable<RawEvent>;
}

export interface ExtractInput {
  event: RawEvent;
  projectRoot: string;
}

export interface ExtractProposal {
  type: string;
  title: string;
  summary: string;
  confidence?: number;
  para?: {
    category: 'projects' | 'areas' | 'resources' | 'archives';
    key: string;
  };
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface Extractor extends ExtensionComponent {
  kind: 'extractor';
  supports(event: RawEvent): boolean;
  extract(input: ExtractInput): Promise<ExtractProposal[]>;
}

export interface RedactionInput {
  text: string;
  source?: Record<string, unknown>;
}

export interface RedactionFinding {
  kind: 'secret' | 'pii' | 'credential' | string;
  start: number;
  end: number;
  severity: 'low' | 'medium' | 'high';
  label?: string;
}

export interface RedactionResult {
  text: string;
  findings: RedactionFinding[];
}

export interface Redactor extends ExtensionComponent {
  kind: 'redactor';
  scan(input: RedactionInput): Promise<RedactionFinding[]>;
  redact(input: RedactionInput): Promise<RedactionResult>;
}

export interface KnowledgeItemLike {
  id: string;
  type?: string;
  layer?: string;
  para?: {
    category: string;
    key: string;
  };
  quality?: Record<string, number | undefined>;
  createdAt?: string;
  updatedAt?: string;
}

export interface QualityScoreInput<TItem extends KnowledgeItemLike = KnowledgeItemLike> {
  item: TItem;
  metadata?: Record<string, unknown>;
}

export interface QualityScorePatch {
  confidenceDelta?: number;
  weightDelta?: number;
  ratingDelta?: number;
  adoptionScoreDelta?: number;
  sourceTrustDelta?: number;
  freshnessDelta?: number;
  reasons: string[];
}

export interface QualityScorer<TItem extends KnowledgeItemLike = KnowledgeItemLike> extends ExtensionComponent {
  kind: 'quality-scorer';
  supports(item: TItem): boolean;
  score(input: QualityScoreInput<TItem>): Promise<QualityScorePatch>;
}

export interface IndexInput {
  documents: Array<{
    id: string;
    text: string;
    metadata?: Record<string, unknown>;
  }>;
}

export interface RemoveIndexInput {
  ids: string[];
}

export interface SearchInput {
  query: string;
  limit?: number;
  filters?: Record<string, unknown>;
}

export interface SearchCandidate {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface SearchBackend extends ExtensionComponent {
  kind: 'search-backend';
  index(input: IndexInput): Promise<void>;
  remove(input: RemoveIndexInput): Promise<void>;
  search(input: SearchInput): Promise<SearchCandidate[]>;
}

export interface StorageBackend extends ExtensionComponent {
  kind: 'storage-backend';
  knowledgeItems: unknown;
  events: unknown;
  cursors: unknown;
}

export interface SyncPushInput {
  clientId: string;
  events: RawEvent[];
}

export interface SyncPushResult {
  accepted: number;
  rejected: Array<{ id: string; reason: string }>;
  cursor?: string;
}

export interface SyncPullInput {
  cursor?: string;
  limit?: number;
}

export interface SyncBackend extends ExtensionComponent {
  kind: 'sync-backend';
  push(input: SyncPushInput): Promise<SyncPushResult>;
  pull(input: SyncPullInput): AsyncIterable<RawEvent>;
}

export interface ExtensionRegistry {
  registerAdapter(adapter: ToolAdapter): void;
  registerProvider(provider: CaptureProvider): void;
  registerExtractor(extractor: Extractor): void;
  registerRedactor(redactor: Redactor): void;
  registerScorer(scorer: QualityScorer): void;
  registerSearchBackend(search: SearchBackend): void;
  registerStorageBackend(storage: StorageBackend): void;
  registerSyncBackend(sync: SyncBackend): void;
  registerExtension(extension: DevMeshExtension): Promise<void>;
  resolve<T extends ExtensionComponent = ExtensionComponent>(kind: ExtensionKind, capability: string): T[];
  list<T extends ExtensionComponent = ExtensionComponent>(kind?: ExtensionKind): T[];
}
