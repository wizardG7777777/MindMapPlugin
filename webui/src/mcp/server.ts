import { callTool, errorToToolPayload } from './tools.js';

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: Record<string, unknown>;
};

type StdioMessage = {
  payload: unknown;
  mode: 'content-length' | 'jsonl';
};

export function toolSchema(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: Array<string>,
): Record<string, unknown> {
  return {
    name: `mindmap_${name}`,
    description,
    inputSchema: {
      type: 'object',
      properties: {
        documentPath: {
          type: 'string',
          description: 'Path to the canonical graph JSON document.',
        },
        ...properties,
      },
      required: ['documentPath', ...required],
      additionalProperties: false,
    },
  };
}

export const tools = [
  toolSchema('get_document_summary', 'Read document metadata and compact graph summary.', {}, []),
  toolSchema('get_node', 'Read one canonical node by id.', { nodeId: { type: 'string' } }, ['nodeId']),
  toolSchema(
    'get_neighbors',
    'Read incoming and/or outgoing relationships around one node.',
    {
      nodeId: { type: 'string' },
      direction: { type: 'string', enum: ['incoming', 'outgoing', 'both'], default: 'both' },
    },
    ['nodeId'],
  ),
  toolSchema(
    'extract_subtree',
    'Extract a focused acyclic projection with cycle/repeated markers.',
    {
      startNodeId: { type: 'string' },
      direction: { type: 'string', enum: ['incoming', 'outgoing', 'both'], default: 'outgoing' },
      maxDepth: { type: 'integer', default: 3, minimum: 0 },
      cyclePolicy: { type: 'string', enum: ['mark'], default: 'mark' },
    },
    ['startNodeId'],
  ),
  toolSchema(
    'compile_mermaid_context',
    'Compile a graph or focused projection into Mermaid plus projection support data.',
    {
      startNodeId: { type: 'string' },
      direction: { type: 'string', enum: ['incoming', 'outgoing', 'both'], default: 'outgoing' },
      maxDepth: { type: 'integer', default: 3, minimum: 0 },
      orientation: { type: 'string', enum: ['LR', 'TD'], default: 'LR' },
      includeEdgeKinds: { type: 'boolean', default: true },
      includeNodeContent: { type: 'string', enum: ['none', 'card', 'notes'], default: 'card' },
      maxNodes: { type: 'integer', minimum: 1 },
      maxEdges: { type: 'integer', minimum: 1 },
    },
    [],
  ),
  toolSchema(
    'preview_operations',
    'Validate and preview a GraphOperation envelope without writing the document.',
    { operationEnvelope: { type: 'object' } },
    ['operationEnvelope'],
  ),
  toolSchema(
    'apply_operations',
    'Apply a validated GraphOperation envelope and save the next graphVersion.',
    {
      operationEnvelope: { type: 'object' },
      outputPath: { type: 'string' },
    },
    ['operationEnvelope'],
  ),
  toolSchema(
    'render_reactflow_view',
    'Project canonical graph data into ReactFlow-compatible nodes and edges.',
    { viewStatePath: { type: 'string' } },
    [],
  ),
  toolSchema(
    'get_current_selection',
    'Read the current WebUI selection from the running local sidecar.',
    { runtimePath: { type: 'string' } },
    [],
  ),
  toolSchema(
    'build_context_from_selection',
    'Build an agent context packet from the current WebUI selection.',
    {
      runtimePath: { type: 'string' },
      purpose: { type: 'string', default: 'webui_selection_context' },
      orientation: { type: 'string', enum: ['LR', 'TD'], default: 'LR' },
      includeEdgeKinds: { type: 'boolean', default: true },
      includeNodeContent: { type: 'string', enum: ['none', 'card', 'notes'], default: 'card' },
    },
    [],
  ),
  toolSchema('validate_document', 'Validate canonical graph invariants.', {}, []),
];

const toolNameMap = Object.fromEntries(tools.map((tool) => [tool.name, String(tool.name).replace('mindmap_', '')]));

export async function handle(request: JsonRpcRequest): Promise<Record<string, unknown> | null> {
  const method = request.method;
  const requestId = request.id;
  if (method === 'initialize') {
    return response(requestId, {
      protocolVersion: (request.params?.protocolVersion as string | undefined) ?? '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'mind-map', version: '0.1.0' },
    });
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'tools/list') return response(requestId, { tools });
  if (method === 'tools/call') {
    const params = request.params ?? {};
    const toolName = params.name;
    const internalName = typeof toolName === 'string' ? toolNameMap[toolName] : undefined;
    if (!internalName) return errorResponse(requestId, -32602, `Unknown tool: ${String(toolName)}`);
    try {
      const result = await callTool(internalName, (params.arguments as Record<string, unknown> | undefined) ?? {});
      return response(requestId, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: false,
      });
    } catch (error) {
      return response(requestId, {
        content: [{ type: 'text', text: JSON.stringify(errorToToolPayload(error), null, 2) }],
        isError: true,
      });
    }
  }
  return errorResponse(requestId, -32601, `Method not found: ${String(method)}`);
}

export function response(requestId: unknown, result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id: requestId, result };
}

export function errorResponse(requestId: unknown, code: number, message: string, data?: unknown): Record<string, unknown> {
  const error: Record<string, unknown> = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: requestId, error };
}

async function main(): Promise<void> {
  const reader = new StdioJsonRpcReader(process.stdin);
  for (;;) {
    const message = await reader.readMessage();
    if (!message) return;
    const result = await handle(message.payload as JsonRpcRequest);
    if (result) writeMessage(result, message.mode);
  }
}

class StdioJsonRpcReader {
  private buffer = Buffer.alloc(0);

  constructor(private readonly stream: NodeJS.ReadStream) {}

  async readMessage(): Promise<StdioMessage | null> {
    for (;;) {
      const jsonl = this.readJsonLineMessage();
      if (jsonl) return jsonl;

      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        const header = this.buffer.subarray(0, headerEnd).toString('utf8');
        const contentLength = Number(
          header
            .split('\r\n')
            .map((line) => line.split(':'))
            .find(([key]) => key?.toLowerCase() === 'content-length')?.[1]
            ?.trim() ?? 0,
        );
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + contentLength;
        if (this.buffer.length >= bodyEnd) {
          const body = this.buffer.subarray(bodyStart, bodyEnd);
          this.buffer = this.buffer.subarray(bodyEnd);
          return { payload: JSON.parse(body.toString('utf8')), mode: 'content-length' };
        }
      }
      const chunk = await this.readChunk();
      if (!chunk) return null;
      this.buffer = Buffer.concat([this.buffer, chunk]);
    }
  }

  private readJsonLineMessage(): StdioMessage | null {
    const firstNonWhitespace = this.buffer.findIndex((byte) => byte !== 0x20 && byte !== 0x09 && byte !== 0x0d);
    if (firstNonWhitespace === -1 || this.buffer[firstNonWhitespace] !== 0x7b) return null;
    const lineEnd = this.buffer.indexOf('\n', firstNonWhitespace);
    if (lineEnd === -1) return null;
    const line = this.buffer.subarray(firstNonWhitespace, lineEnd).toString('utf8').trimEnd();
    this.buffer = this.buffer.subarray(lineEnd + 1);
    if (!line.trim()) return null;
    return { payload: JSON.parse(line), mode: 'jsonl' };
  }

  private async readChunk(): Promise<Buffer | null> {
    const existing = this.stream.read() as Buffer | null;
    if (existing) return existing;
    if (this.stream.readableEnded) return null;
    return new Promise((resolveChunk) => {
      const onReadable = () => {
        cleanup();
        resolveChunk((this.stream.read() as Buffer | null) ?? Buffer.alloc(0));
      };
      const onEnd = () => {
        cleanup();
        resolveChunk(null);
      };
      const cleanup = () => {
        this.stream.off('readable', onReadable);
        this.stream.off('end', onEnd);
      };
      this.stream.once('readable', onReadable);
      this.stream.once('end', onEnd);
    });
  }
}

function writeMessage(message: Record<string, unknown>, mode: 'content-length' | 'jsonl' = 'jsonl'): void {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (mode === 'jsonl') {
    process.stdout.write(`${body.toString('utf8')}\n`);
    return;
  }
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
