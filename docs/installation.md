# Installation and Package Contract

Status: target release requirements. No npm registry name or published release is asserted by this document. Examples use `<package-name>` until an actual package is published; users must not execute that placeholder literally.

## Executable delivery

The installable artifact must expose the `mindmap` executable through package `bin` metadata. A published package must support execution through `npx <package-name>@<version> ...` and installation through `npm install -g <package-name>@<version>`. Publication naming and version are release inputs, not inferred from the working directory.

The package includes compiled runtime code, command/schema definitions, runtime dependencies, platform locking adapters, the agent skill, and referenced documentation. Runtime use must not require a repository checkout, source compilation, development-only TypeScript runners, personal absolute paths, an agent host installation or a global native build toolchain.

The initial writable-storage adapters target macOS and Linux, with exact OS/architecture/filesystem support advertised only after passing the relevant gates. Node runtime versions are pinned in package engine metadata and tested in the release matrix. Windows support requires its own locking and durable-publication adapter and is not implied by the CLI's platform-neutral command syntax.

## Data placement

Package directories are immutable program assets. Documents are created only at explicitly requested paths. Per-document coordination files follow [persistence](persistence-and-concurrency.md) and never reside in an npm cache or plugin cache. Invocations from different directories using the same physical document must coordinate correctly.

Downloading an npm package may require a network connection. Once its artifact and dependencies are available, graph commands work offline. They do not contact a model provider, start a server, bind a port, or request an account.

## Human and agent use

A person runs the CLI directly. An agent platform with permission to execute local commands uses the same executable and help/schema discovery. Platforms without local command execution are outside this release's direct integration scope.

The optional [skill](../skills/mindmap-cli/SKILL.md) is shipped in the package and is self-contained and may be copied into a platform's skill location using that platform's supported mechanism. Ordinary graph commands do not register tools or modify host configuration. Installing the executable and making a skill discoverable are separate operations; an unavailable skill does not block direct CLI use.

## Release verification

Use the built package artifact in a clean temporary project and runtime environment. Verify bin resolution, engine constraints, dependency closure, locking adapter availability, paths containing spaces and a read-only package directory. Run the complete headless workflow and concurrency gates from this installation, not from source-only imports. Record exact artifact hash and environment in the test report.

A package that merely installs or prints help has not passed the [release acceptance](acceptance.md). No first-delivery browser assets, visual launcher or persistent service are needed.
