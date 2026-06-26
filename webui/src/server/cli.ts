import { ensureWebUI } from './launcher.js';

function valueAfter(flag: string, args: Array<string>): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function hasFlag(flag: string, args: Array<string>): boolean {
  return args.includes(flag);
}

async function main(args: Array<string>): Promise<number> {
  if (hasFlag('--help', args) || hasFlag('-h', args)) {
    console.error('Usage: tsx src/server/cli.ts --document <path> [--port <port>] [--runtime-path <path>]');
    return 0;
  }

  const documentPath = valueAfter('--document', args);
  if (!documentPath) {
    console.error('Usage: tsx src/server/cli.ts --document <path> [--port <port>] [--runtime-path <path>]');
    return 1;
  }

  const portValue = valueAfter('--port', args);
  const result = await ensureWebUI({
    documentPath,
    port: portValue ? Number(portValue) : undefined,
    runtimePath: valueAfter('--runtime-path', args),
    staticDir: valueAfter('--static-dir', args),
    viewStateDir: valueAfter('--view-state-dir', args),
  });

  console.log(result.runtime.url);

  if (result.service) {
    await new Promise<void>((resolve) => {
      const shutdown = async () => {
        process.off('SIGINT', shutdown);
        process.off('SIGTERM', shutdown);
        await result.service?.close();
        resolve();
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
  }
  return 0;
}

main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
