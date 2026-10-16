# Installation and Package Contract

Status: release 0.2.0 package and installation contract. No npm registry name or published release is asserted by this document. Examples use `<package-name>` until an actual package is published; users must not execute that placeholder literally.

The program version is **0.2.0**, MindMap's second version. The root package manifest names the artifact `mindmap-cli`, exposes the `mindmap` executable and remains private until a registry publication is explicitly arranged. The CLI contract is version 1, document schema version 2 and operation envelope version 1.

## Executable delivery

The installable artifact must expose the `mindmap` executable through package `bin` metadata. A published package must support execution through `npx <package-name>@<version> ...` and installation through `npm install -g <package-name>@<version>`. Publication naming and version are release inputs, not inferred from the working directory.

The package includes executable JavaScript runtime code, command/schema definitions, the agent skill and referenced documentation. Exact runtime dependencies are Ajv 8.20.0, Koffi 3.2.1 and Fontkit 2.0.4; Koffi provides its native locking adapter through a platform-specific prebuilt dependency. Runtime use must not require a repository checkout, source compilation, development-only TypeScript runners, personal absolute paths, an agent host installation or a global native build toolchain.

The initial writable-storage adapters target macOS and Linux, with exact OS/architecture/filesystem support advertised only after passing the relevant gates. Node runtime versions are pinned in package engine metadata and tested in the release matrix. Windows support requires its own locking and durable-publication adapter and is not implied by the CLI's platform-neutral command syntax.

## Build and install the artifact

The current tested writable configuration is **macOS 26.6.2, arm64, APFS, Node 24.15.0**. Package engine metadata pins that Node version. Linux adapters remain a future verification target and Linux writes are not advertised; unsupported platforms fail explicitly. Read-only graph commands do not load the native locking adapter.

From a checkout:

```sh
npm ci
npm run build
node ./bin/mindmap.js --version --json
npm pack
```

The pack command produces `mindmap-cli-0.2.0.tgz`, containing its executable and runtime assets. Copy that artifact to the intended machine and install it in an existing project directory:

```sh
npm install /absolute/path/to/mindmap-cli-0.2.0.tgz
npx --no-install mindmap --version --json
npx --no-install mindmap create ./plan.json --id plan --json
```

The installed executable is also available at `node_modules/.bin/mindmap`. Installation resolves the declared dependencies; it does not register an agent host or install a skill globally. A native build toolchain is unnecessary on the advertised platform. The package acceptance script verifies installation with all dependency install scripts disabled.

Rendering assets include Noto Sans CJK SC Regular 2.004, its SIL Open Font License and source/hash metadata. SVG uses measured glyph outlines and needs no fonts or external resources in the viewing application. PNG rasterization is an acceptance-only dependency, not a product runtime requirement.

## Data placement

Package directories are immutable program assets. Documents are created only at explicitly requested paths. Per-document coordination files follow [persistence](persistence-and-concurrency.md) and never reside in an npm cache or plugin cache. Invocations from different directories using the same physical document must coordinate correctly.

Downloading an npm package may require a network connection. Once its artifact and dependencies are available, graph commands work offline. They do not contact a model provider, start a server, bind a port, or request an account. The separately invoked `ui` command binds an optional loopback service for the browser.

## Human and agent use

A person runs the CLI directly. An agent platform with permission to execute local commands uses the same executable and help/schema discovery. Platforms without local command execution are outside this release's direct integration scope.

The optional [skill](../skills/mindmap-cli/SKILL.md) is shipped in the package and is self-contained and may be copied into a platform's skill location using that platform's supported mechanism. Ordinary graph commands do not register tools or modify host configuration. Installing the executable and making a skill discoverable are separate operations; an unavailable skill does not block direct CLI use.

## Release verification

Use the built package artifact in a clean temporary project and runtime environment. Verify bin resolution, engine constraints, dependency closure, locking adapter availability, paths containing spaces and a read-only package directory. Run the complete headless workflow and concurrency gates from this installation, not from source-only imports. Record exact artifact hash and environment in the test report.

A package that merely installs or prints help has not passed the [release acceptance](acceptance.md). The package includes the local UI assets under `web/`. They are used only by `ui`; all other graph commands remain server-independent.
