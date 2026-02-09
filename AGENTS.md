# AI Agent Guidance for actly

This document provides guidance for AI agents (GitHub Copilot, Claude Code, Augment, and others) working on the actly codebase.

## Project Overview

**actly** is a CLI tool to locally test GitHub Actions and workflows without pushing to remote. It allows developers to validate, dry-run, and execute GitHub Actions locally with support for inputs, secrets, reusable workflows, and remote actions.

## Quick Start for AI Agents

1. **Technology Stack**: TypeScript, Node.js, Jest (testing), ESLint (linting), Prettier (formatting)
2. **Build**: `npm run build`
3. **Test**: `npm test`
4. **Lint**: `npm run lint`
5. **Format**: `npm run format`

## Repository Structure

```
actly/
├── src/                          # Source code
│   ├── cli.ts                    # CLI entry point
│   ├── index.ts                  # Main exports
│   ├── parser/                   # Workflow and action parsing
│   │   ├── workflow-parser.ts    # Parse workflow YAML files
│   │   ├── action-parser.ts      # Parse action YAML files
│   │   └── validator.ts          # Validate syntax
│   ├── runner/                   # Execution logic
│   │   ├── dry-run.ts            # Dry run mode implementation
│   │   ├── executor.ts           # Execute steps and remote actions
│   │   └── action-fetcher.ts     # Fetch remote actions from GitHub
│   ├── utils/                    # Utility functions
│   │   ├── logger.ts             # Logging utility
│   │   └── (future files)        # Inputs, secrets handling
│   └── types/                    # TypeScript type definitions
│       └── index.ts              # Shared types
├── test/                         # Test fixtures
│   └── fixtures/                 # YAML fixtures for tests
├── .github/                      # GitHub-specific files
│   └── agents/                   # Agent-specific guidance
└── dist/                         # Compiled JavaScript output
```

## Core Concepts

### Workflows
- Defined in YAML files (typically `.github/workflows/*.yml`)
- Contain jobs, steps, inputs, and secrets
- Can trigger other workflows and actions

### Actions
- Reusable units of work
- Three types supported:
  - **Composite Actions**: Multiple steps defined in YAML
  - **JavaScript Actions**: Node.js-based (node12, node16, node20, node22+)
  - **Docker Actions**: Show warning (future enhancement)

### Remote Action Support
- Actions cached in `~/.actly/actions-cache` for performance
- Fetched from GitHub repositories
- Supports versioning via git refs (tags, branches, SHAs)

## Development Guidelines

### Making Changes

1. **Test-Driven Development (TDD)**
   - Write tests first
   - Implement features to pass tests
   - Refactor while keeping tests green
   - See [TESTING.md](.github/agents/TESTING.md) for details

2. **Code Style**
   - Follow existing TypeScript conventions
   - Use ESLint and Prettier for consistency
   - See [CODE_STYLE.md](.github/agents/CODE_STYLE.md) for details

3. **Architecture**
   - Keep separation between parser, runner, and utils
   - Use type definitions from `types/index.ts`
   - See [ARCHITECTURE.md](.github/agents/ARCHITECTURE.md) for details

### Before Committing

Run these commands to ensure quality:

```bash
npm run lint          # Check code style
npm run format        # Auto-format code
npm test              # Run all tests
npm run build         # Ensure it builds
```

## Key Files for AI Agents

- **AGENTS.md** (this file): Main guidance for AI agents
- **[TESTING.md](.github/agents/TESTING.md)**: Testing strategy and guidelines
- **[CODE_STYLE.md](.github/agents/CODE_STYLE.md)**: Code styling and formatting rules
- **[ARCHITECTURE.md](.github/agents/ARCHITECTURE.md)**: Detailed architecture and design patterns
- **README.md**: User-facing documentation
- **package.json**: Dependencies and scripts

## Common Tasks

### Adding a New Feature

1. Create test fixtures in `test/fixtures/` if needed
2. Write tests in corresponding `.test.ts` file
3. Implement feature in source file
4. Run tests: `npm test`
5. Lint and format: `npm run lint && npm run format`
6. Build: `npm run build`

### Fixing a Bug

1. Write a failing test that reproduces the bug
2. Fix the bug in the source code
3. Ensure the test passes
4. Check for regressions: `npm test`

### Refactoring Code

1. Ensure all tests pass before refactoring
2. Make incremental changes
3. Run tests after each change
4. Keep test coverage above thresholds (see jest.config.js)

## Testing Strategy

- **Unit Tests**: Test individual functions and modules
- **Integration Tests**: Test interactions between modules
- **Fixtures**: Use YAML files in `test/fixtures/` for realistic scenarios
- **Coverage Thresholds**: Minimum 65% branches, 80% functions/lines/statements

See [TESTING.md](.github/agents/TESTING.md) for comprehensive testing guidelines.

## Code Quality Standards

- **TypeScript**: Strict mode enabled
- **ESLint**: eslint:recommended + @typescript-eslint/recommended
- **Prettier**: @jabraf/prettier configuration
- **Test Coverage**: Enforced minimums in jest.config.js

## Dependencies

### Production Dependencies
- **chalk**: Terminal styling
- **commander**: CLI framework
- **yaml**: YAML parsing

### Development Dependencies
- **typescript**: TypeScript compiler
- **jest**: Testing framework
- **ts-jest**: TypeScript support for Jest
- **eslint**: Linting
- **prettier**: Code formatting

## Environment

- **Node.js**: v24.0.0 (via Volta)
- **Package Manager**: npm
- **Build Output**: `dist/` directory (gitignored)

## Useful Commands

```bash
# Development
npm install              # Install dependencies
npm run dev             # Watch mode compilation
npm run build           # Production build

# Testing
npm test                # Run all tests
npm run test:watch      # Watch mode testing
npm run test:coverage   # Generate coverage report

# Code Quality
npm run lint            # Lint TypeScript files
npm run format          # Format all files with Prettier

# CLI Usage (after build)
./dist/cli.js --help    # Show CLI help
actly --dry-run <file>  # Dry run a workflow
actly --validate <file> # Validate workflow syntax
```

## Agent-Specific Notes

### For GitHub Copilot
- Use TypeScript type annotations for better suggestions
- Follow existing patterns in the codebase
- Reference test files for examples

### For Claude Code
- Consider the full context of the project
- Maintain consistency with existing code style
- Use TDD approach for new features

### For Augment
- Focus on incremental improvements
- Respect the minimal dependencies philosophy
- Keep backward compatibility in mind

## Getting Help

- Check existing tests for usage examples
- Review README.md for user-facing documentation
- Examine similar implementations in the codebase
- Look at test fixtures for valid YAML structures

## Contributing Philosophy

- **Minimal Dependencies**: Only add dependencies when necessary
- **MVP Focus**: Keep features focused and simple
- **Test Coverage**: Maintain or improve test coverage
- **TypeScript First**: Leverage TypeScript's type system
- **User Experience**: Keep CLI simple and intuitive

## Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [YAML Specification](https://yaml.org/spec/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
