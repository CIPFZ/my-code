# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Common commands

```bash
# Install dependencies
bun install

# Standard build, outputs ./my-code
bun run build

# Dev build, outputs ./my-code-dev
bun run build:dev

# Dev build with experimental features
bun run build:dev:full

# Compiled build, outputs ./dist/my-code
bun run compile

# Run from source without compiling
bun run dev

# Run tests
bun test
```

Run the built binary with `./my-code` or `./my-code-dev`.

Model/provider configuration is loaded from `~/.my-code/models.config.json` by default. Use `MY_CODE_MODEL_CONFIG`, `MY_CODE_CONFIG_DIR`, and `MY_CODE_PROVIDER` to override configuration paths or the active provider.

## High-level architecture

- **CLI bootstrap**: `src/entrypoints/cli.tsx` handles fast paths and dynamically loads the full CLI.
- **Main CLI**: `src/main.tsx` initializes settings, state, commands, tools, MCP, plugins, skills, and launches headless or interactive flows.
- **Interactive UI**: `src/screens/REPL.tsx` is the main Ink/React REPL loop.
- **Command/tool registries**: `src/commands.ts` registers slash commands; `src/tools.ts` registers and filters tool implementations.
- **LLM query pipeline**: `src/query.ts` coordinates message flow, compaction, model calls, tool use, and follow-up turns.
- **API client layer**: `src/services/api/client.ts` creates the Anthropic SDK client and injects provider-specific fetch adapters.
- **Provider/model config**: `src/utils/model/configs.ts`, `src/utils/model/model.ts`, and `src/utils/model/modelOptions.ts` resolve current provider, model metadata, `/model` options, and agent/team routing.

## Core subsystems

- `src/services/`: API clients, compact, MCP, analytics, policy/settings services.
- `src/state/`: app state store and state change handling.
- `src/hooks/`: React hooks used by UI/flows.
- `src/components/`: terminal UI components.
- `src/commands/`: slash command implementations.
- `src/tools/`: built-in tools and agent/team tools.
- `src/skills/`: skill system.
- `src/plugins/`: plugin system.
- `src/bridge/`: remote control / bridge functionality.
- `src/tasks/`: background task management.

## Build system

`scripts/build.ts` is the Bun build script and feature-flag bundler. Feature flags are set with build arguments such as `--feature=ULTRAPLAN` or presets such as `--feature-set=dev-full`.

Build artifacts and runtime state should not be committed: `node_modules/`, `dist/`, `my-code`, `my-code-dev`, `.omc/`, and `.claude/`.

## Documentation

- `README.md`: user-facing setup and usage.
- `docs/project-architecture-overview.md`: detailed architecture notes.
- `docs/test-plan.md`: testing strategy and manual verification checklist.
- `docs/archive/`: historical audits and obsolete notes retained for reference.
