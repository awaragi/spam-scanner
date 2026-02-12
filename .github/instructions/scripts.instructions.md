---
applyTo: "scripts/**/*.sh,scripts/**/*.bash,scripts/**/*"
---

# Scripts and Automation Guidelines

You are an expert in Bash scripting, shell automation, and DevOps workflows. You write robust, maintainable, and portable shell scripts.

## Shell Script Best Practices

- Always include a shebang: `#!/bin/bash` or `#!/usr/bin/env bash`
- Use `set -e` to exit on errors
- Use `set -u` to exit on undefined variables
- Use `set -o pipefail` to catch errors in pipelines
- Make scripts executable: `chmod +x script.sh`

## Script Structure

- Start with a clear header comment explaining the script's purpose
- Define variables at the top
- Use functions for reusable code blocks
- Keep main logic at the bottom
- Add usage/help messages

## Error Handling

- Check for required commands before using them
- Validate input parameters
- Use meaningful error messages
- Exit with appropriate status codes (0 for success, non-zero for errors)
- Clean up temporary files on exit (trap)

## Variables

- Use uppercase for environment variables and constants
- Use lowercase for local variables
- Quote variables to handle spaces: `"$variable"`
- Use `${variable}` for clarity in complex expressions
- Use readonly for constants

## Functions

- Use descriptive function names
- Document function parameters and return values
- Keep functions focused on a single task
- Use local variables inside functions
- Return status codes, print output to stdout

## Conditionals and Loops

- Use `[[ ]]` for conditional tests (bash)
- Quote strings in comparisons
- Use meaningful variable names in loops
- Prefer `for` over `while read` for arrays
- Use `case` statements for multiple conditions

## Command Execution

- Use command substitution: `$(command)` instead of backticks
- Check command exit status: `if command; then`
- Redirect errors appropriately
- Use pipes carefully and check for failures
- Consider using `xargs` for batch operations

## File Operations

- Check if files exist before operating on them
- Use temporary files safely (mktemp)
- Clean up temporary files on exit
- Preserve file permissions when copying
- Use absolute paths when possible

## Portability

- Target bash 4+ unless broader compatibility needed
- Avoid bashisms if targeting POSIX sh
- Test on target platforms
- Document dependencies
- Use portable command flags

## Security

- Never run scripts as root unless necessary
- Validate and sanitize user input
- Avoid eval and other dangerous constructs
- Quote variables to prevent injection
- Use secure temporary file creation
- Set appropriate file permissions

## Documentation

- Add comments for complex logic
- Document required environment variables
- Provide usage examples
- List dependencies and requirements
- Explain non-obvious decisions

## Logging

- Use consistent log message formats
- Include timestamps for important events
- Use different verbosity levels
- Log to stderr for errors
- Consider log rotation for long-running scripts

## Development Scripts

- Make scripts idempotent when possible
- Provide dry-run mode for destructive operations
- Add verbose mode for debugging
- Check for required services/ports before starting
- Handle cleanup gracefully

## Common Patterns

### Start/Stop Scripts
- Check if service is already running
- Wait for service to start/stop
- Verify successful start/stop
- Provide status command

### Installation Scripts
- Check for existing installations
- Backup before making changes
- Verify prerequisites
- Provide rollback capability

### Deployment Scripts
- Run in stages (build, test, deploy)
- Verify each stage before proceeding
- Provide progress feedback
- Handle failures gracefully
