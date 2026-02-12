# GitHub Copilot Guidelines

This directory contains GitHub Copilot instructions organized by module to provide context-aware assistance across the project.

## Structure

- **copilot-instructions.md** (root): General project-wide guidelines that apply to all modules
- **instructions/**: Path-specific guidelines with YAML `applyTo` directives

### Path-Specific Guidelines

Each module has dedicated guidelines that automatically apply when working in files matching the specified patterns:

| File | Applies To | Description |
|------|-----------|-------------|
| `nodejs.instructions.md` | `src/**/*.js,test/**/*.js` | Node.js development and testing guidelines |
| `scripts.instructions.md` | `bin/**/*.sh` | Shell scripting and automation guidelines |
| `documentation.instructions.md` | `docs/**/*.md,**/*.md` | Documentation writing guidelines |

## How It Works

GitHub Copilot uses the YAML frontmatter `applyTo` directive to automatically activate the appropriate guidelines based on the file you're working in:

```yaml
---
applyTo: "frontend/**/*.ts,frontend/**/*.html"
---
```

When you work in a file matching these patterns, Copilot will use those specific guidelines in addition to the general project guidelines.

## Guidelines Priority

1. **Path-specific guidelines**: Applied first based on file path matching
2. **General guidelines**: Applied as baseline for all files

## Adding New Guidelines

To add guidelines for a new module:

1. Create a new `NAME.instructions.md` file in `instructions/`
2. Add YAML frontmatter with quoted `applyTo` glob patterns (comma-separated)
3. Document best practices, patterns, and conventions
4. Update this README to include the new guideline file

## Example

When editing `src/lib/imap-client.js`, Copilot will use:
- General project guidelines from `copilot-instructions.md`
- Node.js-specific guidelines from `instructions/nodejs.instructions.md`

This ensures you get relevant, context-aware suggestions based on what you're working on.
