import { promises as fs } from 'node:fs';

import { MindMapError } from './core/errors.js';
import type { GraphDocument, OperationEnvelope } from './core/graph.js';
import {
  applyOperations,
  getNeighbors,
  getNode,
  previewOperations,
  summarizeDocument,
  validateDocument,
} from './core/graph.js';
import { toReactFlowView } from './core/layout.js';
import { compileDocumentToMermaidContext } from './core/mermaid.js';
import { extractSubtree } from './core/projections.js';

type CliOptions = Record<string, string | boolean | undefined>;

async function main(args: Array<string>): Promise<number> {
  const command = args[0];
  if (!command || command === '--help' || command === '-h') {
    printUsage();
    return command ? 0 : 1;
  }

  const options = parseOptions(args.slice(1));
  try {
    const payload = await runCommand(command, options);
    printJson(payload);
    return 0;
  } catch (error) {
    printJson(errorToPayload(error));
    return 1;
  }
}

async function runCommand(command: string, options: CliOptions): Promise<Record<string, unknown>> {
  switch (command) {
    case 'validate-document': {
      const document = await documentFromOptions(options);
      validateDocument(document);
      return { ok: true, ...summarizeDocument(document) };
    }
    case 'get-document-summary': {
      return { ok: true, ...summarizeDocument(await documentFromOptions(options)) };
    }
    case 'get-node': {
      return { ok: true, node: getNode(await documentFromOptions(options), requiredString(options, 'node-id')) };
    }
    case 'get-neighbors': {
      return {
        ok: true,
        ...getNeighbors(
          await documentFromOptions(options),
          requiredString(options, 'node-id'),
          enumOption(options, 'direction', ['incoming', 'outgoing', 'both'], 'both'),
        ),
      };
    }
    case 'extract-subtree': {
      return {
        ok: true,
        projection: extractSubtree(
          await documentFromOptions(options),
          requiredString(options, 'start-node-id'),
          enumOption(options, 'direction', ['incoming', 'outgoing', 'both'], 'outgoing'),
          integerOption(options, 'max-depth', 3),
          enumOption(options, 'cycle-policy', ['mark'], 'mark'),
        ),
      };
    }
    case 'compile-mermaid-context': {
      return compileDocumentToMermaidContext(await documentFromOptions(options), {
        startNodeId: optionalString(options, 'start-node-id'),
        direction: enumOption(options, 'direction', ['incoming', 'outgoing', 'both'], 'outgoing'),
        maxDepth: integerOption(options, 'max-depth', 3),
        orientation: enumOption(options, 'orientation', ['LR', 'TD'], 'LR'),
        includeEdgeKinds: !hasFlag(options, 'omit-edge-kinds'),
        includeNodeContent: enumOption(options, 'include-node-content', ['none', 'card', 'notes'], 'card'),
        maxNodes: optionalInteger(options, 'max-nodes'),
        maxEdges: optionalInteger(options, 'max-edges'),
      });
    }
    case 'preview-operations': {
      return previewOperations(await documentFromOptions(options), await operationEnvelopeFromOptions(options));
    }
    case 'apply-operations': {
      const documentPath = requiredString(options, 'document');
      const outputPath = optionalString(options, 'output') ?? documentPath;
      const { document, result } = applyOperations(
        await readJsonFile<GraphDocument>(documentPath),
        await operationEnvelopeFromOptions(options),
      );
      await writeJsonFile(outputPath, document);
      return { ...result, outputPath };
    }
    case 'render-reactflow-view': {
      const viewStatePath = optionalString(options, 'view-state');
      const viewState = viewStatePath ? await readJsonFile<Record<string, unknown>>(viewStatePath) : undefined;
      return toReactFlowView(await documentFromOptions(options), viewState);
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function documentFromOptions(options: CliOptions): Promise<GraphDocument> {
  return readJsonFile<GraphDocument>(requiredString(options, 'document'));
}

async function operationEnvelopeFromOptions(options: CliOptions): Promise<OperationEnvelope> {
  const operationsPath = requiredString(options, 'operations');
  if (operationsPath === '-') {
    const body = await stdinText();
    return JSON.parse(body) as OperationEnvelope;
  }
  return readJsonFile<OperationEnvelope>(operationsPath);
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function stdinText(): Promise<string> {
  const chunks: Array<Buffer> = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function parseOptions(args: Array<string>): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return options;
}

function requiredString(options: CliOptions, key: string): string {
  const value = options[key];
  if (typeof value !== 'string' || !value) throw new Error(`--${key} is required.`);
  return value;
}

function optionalString(options: CliOptions, key: string): string | undefined {
  const value = options[key];
  if (value === undefined || value === false) return undefined;
  if (typeof value !== 'string') throw new Error(`--${key} requires a value.`);
  return value;
}

function hasFlag(options: CliOptions, key: string): boolean {
  return options[key] === true;
}

function integerOption(options: CliOptions, key: string, fallback: number): number {
  return optionalInteger(options, key) ?? fallback;
}

function optionalInteger(options: CliOptions, key: string): number | undefined {
  const value = options[key];
  if (value === undefined || value === false) return undefined;
  if (typeof value !== 'string') throw new Error(`--${key} requires a value.`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`--${key} must be an integer.`);
  return parsed;
}

function enumOption<const T extends string>(options: CliOptions, key: string, values: ReadonlyArray<T>, fallback: T): T {
  const value = optionalString(options, key) ?? fallback;
  if (!values.includes(value as T)) throw new Error(`--${key} must be one of: ${values.join(', ')}.`);
  return value as T;
}

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function errorToPayload(error: unknown): Record<string, unknown> {
  if (error instanceof MindMapError) return error.toPayload();
  return {
    ok: false,
    error: {
      code: 'UNEXPECTED_ERROR',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  };
}

function printUsage(): void {
  process.stderr.write(`Usage: tsx src/cli.ts <command> [options]

Commands:
  validate-document --document <path>
  get-document-summary --document <path>
  get-node --document <path> --node-id <id>
  get-neighbors --document <path> --node-id <id> [--direction incoming|outgoing|both]
  extract-subtree --document <path> --start-node-id <id> [--direction outgoing] [--max-depth 3]
  compile-mermaid-context --document <path> [--start-node-id <id>] [--max-depth 3]
  preview-operations --document <path> --operations <path|->
  apply-operations --document <path> --operations <path|-> [--output <path>]
  render-reactflow-view --document <path> [--view-state <path>]
`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
