# @scasella/undefined-engine

The Undefined gates (compile, tests, properties, invariants), evidence, mutation check, spec-gap decisions and
provenance, shared by the static site (`apps/site`, browser Workers), the CLI (`packages/cli`) and the GitHub Action
(`packages/action`, both Node `worker_thread`s, same watchdog semantics). Host-neutral TypeScript source; it certifies
code from any source and never generates code.

Workspace-internal for now (`private: true`): its `exports` point at TypeScript source, which the site reads through
Vite and the CLI and Action bundle. Publishing it would need a build step first.

**The Node host is not a secure sandbox** — read [SECURITY.md](SECURITY.md).

MIT licensed ([LICENSE](LICENSE)).
