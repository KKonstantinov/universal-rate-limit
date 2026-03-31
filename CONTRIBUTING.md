# Contributing

Thanks for your interest in contributing to `universal-rate-limit`. This document covers the development workflow, coding standards, and how to submit changes.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 10
- [Bun](https://bun.sh/) >= 1.0 (for runtime tests)
- [Deno](https://deno.com/) >= 2.0 (for runtime tests)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/KKonstantinov/universal-rate-limit.git
cd universal-rate-limit

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## Project Structure

This is a monorepo managed with [pnpm workspaces](https://pnpm.io/workspaces):

```
packages/
  core/                       # universal-rate-limit
    src/
      index.ts                # rateLimit(), MemoryStore, buildRateLimitResponse
    test/
      index.test.ts           # Core unit tests
  middleware/
    express/                  # @universal-rate-limit/express
    fastify/                  # @universal-rate-limit/fastify
    hono/                     # @universal-rate-limit/hono
    nextjs/                   # @universal-rate-limit/nextjs
tests/
  integration/                # Cross-package integration tests
  bun/                        # Bun runtime tests
  deno/                       # Deno runtime tests
packages/site/                # Fumadocs documentation (Next.js)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for design decisions and internal details.

## Scripts

All scripts can be run from the root of the monorepo:

| Command             | Description                                    |
| ------------------- | ---------------------------------------------- |
| `pnpm build`        | Build all packages (tsdown)                    |
| `pnpm test`         | Run all unit tests (vitest)                    |
| `pnpm test:watch`   | Run tests in watch mode                        |
| `pnpm test:bun`     | Run Bun runtime tests                          |
| `pnpm test:deno`    | Run Deno runtime tests                         |
| `pnpm test:all`     | Run all tests (Node + Bun + Deno)              |
| `pnpm lint`         | Run ESLint (includes Prettier checks)          |
| `pnpm lint:fix`     | Run ESLint with auto-fix (includes formatting) |
| `pnpm format`       | Format all files with Prettier                 |
| `pnpm format:check` | Check formatting without writing               |
| `pnpm typecheck`    | Run TypeScript type checking (tsgo)            |

## Testing

### Unit Tests

Unit tests use [Vitest](https://vitest.dev/) and live in each package's `test/` directory:

```bash
pnpm test
```

### Integration Tests

Integration tests verify cross-package behavior and runtime compatibility:

```bash
pnpm test:integration   # Cross-package tests
pnpm test:bun           # Bun runtime
pnpm test:deno          # Deno runtime
pnpm test:all           # Everything
```

### Writing Tests

- Test behavior through the public `rateLimit()` API when possible
- Use `toEqual` / `toBe` for result assertions
- Middleware tests use real framework instances (Express, Fastify, Hono)
- Use `vi.useFakeTimers()` for window expiration tests

## Code Style

- **ESM only** — `"type": "module"` throughout
- **Prettier** — 140 char width, 4-space indent, single quotes, no trailing commas
- **Null for empty** — consistent use of `null`
- **Keep it simple** — prefer straightforward code over abstractions

### Lint Rules

The project uses ESLint v10 with:

- [`typescript-eslint`](https://typescript-eslint.io/) — strict type-checked rules
- [`eslint-plugin-unicorn`](https://github.com/sindresorhus/eslint-plugin-unicorn) — recommended rules
- [`eslint-plugin-import-x`](https://github.com/un-ts/eslint-plugin-import-x) — enforces `import type` discipline

## Making Changes

### Adding a New Store

1. Implement the `Store` interface from `universal-rate-limit`
2. Add tests covering `increment`, `decrement`, `resetKey`, `resetAll`
3. Document it in `packages/site/content/docs/`

### Adding a New Middleware

1. Create a new package under `packages/middleware/`
2. Add `package.json`, `tsconfig.json`, `vitest.config.ts`
3. Implement the adapter in `src/index.ts`, importing from `universal-rate-limit`
4. Add tests using a real server instance
5. Document it in `packages/site/content/docs/`

## Submitting Changes

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Run the full validation suite:
    ```bash
    pnpm lint && pnpm typecheck && pnpm test
    ```
5. Open a pull request with a clear description of the change

### Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include tests for new functionality
- Update documentation if the public API changes
- Ensure all CI checks pass

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
