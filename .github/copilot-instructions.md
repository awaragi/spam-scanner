# Project-Wide Development Guidelines

This document contains general development guidelines that apply across all modules in the spam-scanner project.

## Project Structure

This is a Node.js-based IMAP spam scanner application:
- **src/**: Main application scripts and library modules
- **src/lib/**: Core reusable modules (IMAP client, SpamAssassin integration, state management)
- **src/lib/utils/**: Utility functions for email parsing, configuration, etc.
- **test/**: Unit tests for utility modules
- **bin/**: Shell scripts for running the application
- **docs/**: Project documentation
- **rspamd/**: Rspamd Docker configuration (alternative spam filter)

## General Best Practices

### Code Quality

- Write clean, readable, and maintainable code
- Follow the DRY (Don't Repeat Yourself) principle
- Use meaningful variable and function names
- Keep functions small and focused on a single task
- Comment complex logic, but prefer self-documenting code
- Use consistent formatting (configured in .editorconfig)

### Version Control

- Write clear, descriptive commit messages
- Use conventional commit format when possible (feat, fix, docs, etc.)
- Keep commits atomic and focused
- Create feature branches for new work
- Review code before merging

### Documentation

- Document public APIs and complex functions
- Keep README files up to date
- Document configuration options
- Include examples in documentation
- Update docs when changing functionality

### JavaScript/Node.js Standards

- Use modern ES6+ syntax (const/let, arrow functions, template literals)
- Use strict mode (implicit with ES modules)
- Use const and let instead of var
- Prefer arrow functions for callbacks
- Use async/await over promise chains
- Handle errors properly - don't ignore them
- Use meaningful variable and function names

### Error Handling

- Use try-catch blocks for async operations
- Return meaningful error messages
- Log errors with appropriate context
- Don't expose sensitive information in error messages
- Handle edge cases explicitly

### Testing

- Write tests for critical business logic
- Follow the AAA pattern (Arrange, Act, Assert)
- Use descriptive test names that explain intent
- Mock external dependencies
- Keep tests independent and isolated
- Run tests before committing code

### Security

- Never commit secrets, API keys, or passwords
- Use environment variables for sensitive configuration
- Validate and sanitize all user inputs
- Keep dependencies up to date
- Follow OWASP security best practices
- Implement proper authentication and authorization

### Performance

- Optimize for readability first, then performance
- Profile before optimizing
- Use appropriate data structures
- Avoid premature optimization
- Consider caching strategies
- Monitor and measure performance

### Dependencies

- Review dependencies before adding them
- Keep dependencies up to date
- Use exact versions in production
- Document why specific dependencies are used
- Regularly audit dependencies for vulnerabilities

### Environment Configuration

- Use .env files for environment-specific configuration
- Never commit .env files to version control
- Document required environment variables
- Provide .env.example files
- Validate environment configuration on startup

## Module-Specific Guidelines

Each module has its own specific guidelines:
- Node.js Scripts: `.github/instructions/nodejs.instructions.md`
- Shell Scripts: `.github/instructions/scripts.instructions.md`
- Documentation: `.github/instructions/documentation.instructions.md`

## Development Workflow

1. Create a feature branch from main
2. Implement changes following module-specific guidelines
3. Write/update tests as needed
4. Run linting and formatting
5. Test changes locally
6. Commit with clear messages
7. Create pull request for review
8. Address review feedback
9. Merge after approval

## Scripts

Use the shell script in the `bin/` directory:
- `bin/local/start.sh`: Run all training and scanning scripts in continuous mode

Refer to the main README.md file for detailed usage instructions.
