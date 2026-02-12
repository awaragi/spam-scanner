---
applyTo: "src/**/*.js,test/**/*.js"
---

# Node.js Development Guidelines

You are an expert in Node.js, JavaScript, and building maintainable server-side applications.

## Core Principles

### JavaScript/Node.js
- Use modern ES6+ syntax (const/let, arrow functions, async/await)
- Prefer async/await over promise chains
- Use strict mode implicitly (ES modules) or explicitly
- Handle errors properly with try-catch blocks
- Use meaningful variable and function names

### Code Organization
- Keep functions small and focused on a single task
- Use modules to organize related functionality
- Separate concerns (business logic, IMAP operations, file I/O)
- Follow the existing project structure

## Project Structure

This is a modular Node.js application for IMAP spam scanning using SpamAssassin:

```
src/
├── lib/                     # Core reusable modules
│   ├── imap-client.js      # IMAP connection and operations
│   ├── spamassassin.js     # SpamAssassin integration
│   ├── state-manager.js    # State persistence logic
│   └── utils/              # Utility functions
│       ├── config.js       # Configuration management
│       ├── email-parser.js # Email parsing utilities
│       ├── email.js        # Email operations
│       ├── mailboxes-utils.js # Mailbox helpers
│       ├── spam-classifier.js # Spam classification logic
│       ├── spawn-async.js  # Process spawning utilities
│       └── state-utils.js  # State management utilities
├── scan-inbox.js           # Main inbox scanning script
├── train-spam.js           # Spam training script
├── train-ham.js            # Ham (non-spam) training script
├── train-whitelist.js      # Whitelist training script
├── train-blacklist.js      # Blacklist training script
└── [other scripts]         # CLI utilities
test/                        # Unit tests
```

## Best Practices

### Error Handling
- Always use try-catch for async operations
- Log errors with context using pino logger
- Don't expose sensitive information in error messages
- Exit with appropriate status codes (0 for success, non-zero for errors)
- Clean up resources (IMAP connections) in finally blocks

### Async Operations
- Use async/await for all asynchronous code
- Handle promise rejections explicitly
- Avoid callback-based APIs when promise-based alternatives exist
- Use Promise.all for concurrent operations when appropriate
- Consider rate limiting for batch operations

### IMAP Operations
- Always close IMAP connections properly
- Use UIDs (not sequence numbers) for message operations
- Handle mailbox state changes gracefully
- Implement proper error recovery
- Respect IMAP server rate limits

### State Management
- Store state in IMAP mailbox for persistence
- Use JSON for state serialization
- Validate state structure on read
- Handle missing or corrupted state gracefully
- Keep state minimal and focused

### Configuration
- Use environment variables for all configuration
- Provide default values where sensible
- Validate required configuration on startup
- Document all environment variables
- Never hardcode sensitive data

### Logging
- Use structured logging (JSON format via pino)
- Include relevant context in log messages
- Use appropriate log levels (info, warn, error)
- Log important state changes
- Don't log sensitive information (passwords, email content)

### Testing
- Write unit tests for utility functions
- Use vitest for testing
- Mock external dependencies (IMAP, SpamAssassin)
- Test edge cases and error conditions
- Keep tests independent and isolated

### Performance
- Process emails in batches to manage memory
- Use streaming for large email processing
- Avoid loading all messages into memory
- Implement proper cleanup of temporary data
- Monitor resource usage for long-running processes

### SpamAssassin Integration
- Run spamc/spamd with appropriate user permissions
- Handle SpamAssassin errors gracefully
- Parse SpamAssassin output correctly
- Respect SpamAssassin configuration
- Test training operations thoroughly

### Code Style
- Use consistent indentation (2 spaces)
- Use semicolons consistently
- Follow existing code formatting patterns
- Use descriptive variable names
- Add comments for complex logic only

### Security
- Validate and sanitize all email-related operations
- Use secure IMAP connections (TLS)
- Handle credentials securely via environment variables
- Be cautious with email parsing (potential malicious content)
- Run SpamAssassin operations with appropriate user permissions

## Common Patterns

### IMAP Client Usage
```javascript
const client = await createImapClient();
try {
  await client.connect();
  await client.selectMailbox('INBOX');
  // ... operations
} finally {
  await client.closeConnection();
}
```

### State Management
```javascript
const state = await readState(client);
// ... modify state
await writeState(client, state);
```

### Error Handling with Logging
```javascript
try {
  await operation();
} catch (error) {
  logger.error({ error, context: 'operation' }, 'Operation failed');
  throw error;
}
```

### Batch Processing
```javascript
for (let i = 0; i < uids.length; i += batchSize) {
  const batch = uids.slice(i, i + batchSize);
  await processBatch(batch);
}
```

## Dependencies

### Core Dependencies
- `node-imap` - IMAP client library
- `pino` - Fast JSON logger
- `dotenv` - Environment variable management
- `mailparser` - Email parsing

### Development Dependencies
- `vitest` - Testing framework

## Scripts

### Development
- Run script: `node src/script-name.js`
- Run tests: `npm test`
- Run specific test: `npm test -- test/file-name.test.js`

### Production
- Use shell scripts in `bin/` directory for orchestration
- Run as systemd service for continuous operation
- Ensure proper SpamAssassin user permissions

## Debugging

- Use `console.log` for quick debugging (remove before commit)
- Use logger for permanent debug information
- Check IMAP server logs for connection issues
- Verify SpamAssassin configuration and logs
- Test with small batches first

## Module-Specific Notes

### lib/imap-client.js
- Handles all IMAP connection and mailbox operations
- Provides high-level abstractions over node-imap
- Manages connection lifecycle

### lib/spamassassin.js
- Integrates with spamc/spamd processes
- Parses SpamAssassin output
- Handles training operations

### lib/state-manager.js
- Persists scanner state to IMAP mailbox
- Provides state read/write/reset operations
- Handles state validation

### Utility Modules
- Keep pure functions without side effects when possible
- Export focused, reusable functionality
- Document non-obvious behavior
- Include unit tests
