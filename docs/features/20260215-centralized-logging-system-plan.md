# Centralized Logging System Refactoring - Implementation Plan

**Status**: Not Started  
**Date Started**: 2026-02-15  
**Complexity**: COMPLEX  
**Total Phases**: 10

> **Note**: This plan provides explicit, file-by-file implementation steps organized into logical phases. Each file is listed as a separate step. See the [design document](./20260215-centralized-logging-system-design.md) for full requirements, architecture details, and design decisions.

## Implementation Progress

### Phase 1: Infrastructure Setup
- [x] **Step 1.1: Create src/lib/utils/logger.js**
- [x] **Step 1.2: Update package.json**
- [x] **Step 1.3: Update .env.example**

### Phase 2: Core Library Files
- [x] **Step 2.1: Update src/lib/utils/config.js**
- [x] **Step 2.2: Update src/lib/imap-client.js**
- [x] **Step 2.3: Update src/lib/rspamd-client.js**
- [x] **Step 2.4: Update src/lib/rspamd.js**
- [x] **Step 2.5: Update src/lib/utils/email.js**
- [x] **Step 2.6: Update src/lib/utils/rspamd-maps.js**

### Phase 3: Training Scripts
- [x] **Step 3.1: Update src/train-spam.js**
- [x] **Step 3.2: Update src/train-ham.js**
- [x] **Step 3.3: Update src/train-whitelist.js**
- [x] **Step 3.4: Update src/train-blacklist.js**

### Phase 4: CLI & Utility Scripts
- [x] **Step 4.1: Update src/list-all.js**
- [x] **Step 4.2: Update src/read-email.js**
- [x] **Step 4.3: Update src/uid-on-date.js**
- [x] **Step 4.4: Update src/scan-inbox.js**

### Phase 5: State Management Scripts
- [x] **Step 5.1: Update src/init-folders.js**
- [x] **Step 5.2: Update src/read-state.js**
- [x] **Step 5.3: Update src/write-state.js**
- [x] **Step 5.4: Update src/delete-state.js**
- [x] **Step 5.5: Update src/reset-state.js**

### Phase 6: Message Logger Implementation
- [x] **Step 6.1: Add message loggers to src/lib/rspamd.js**
- [x] **Step 6.2: Add message loggers to src/lib/imap-client.js**

### Phase 7: Testing
- [x] **Step 7.1: Create test/logger.test.js**
- [x] **Step 7.2: Update test/email-parser.test.js**
- [x] **Step 7.3: Update test/email.test.js**
- [x] **Step 7.4: Update test/mailboxes-utils.test.js**
- [x] **Step 7.5: Update test/rspamd-client.test.js**
- [x] **Step 7.6: Update test/rspamd-maps.test.js**
- [x] **Step 7.7: Update test/spam-classifier.test.js**
- [x] **Step 7.8: Update test/state-utils.test.js**

### Phase 8: Manual Testing & Validation
- [x] **Step 8.1: Test LOG_FORMAT=pretty**
- [x] **Step 8.2: Test LOG_FORMAT=json**
- [x] **Step 8.3: Test LOG_LEVEL=debug**
- [x] **Step 8.4: Test UID correlation**
- [x] **Step 8.5: Test ImapFlow integration**
- [x] **Step 8.6: Run all automated tests**

### Phase 9: Documentation Updates
- [x] **Step 9.1: Update README.md**
- [x] **Step 9.2: Verify .env.example**

---

## Implementation Steps

### Phase 1: Infrastructure Setup

#### Step 1.1: Create src/lib/utils/logger.js
- **Files**: `src/lib/utils/logger.js` (new file)
- **Action**: 
  - Import pino
  - Read LOG_LEVEL and LOG_FORMAT environment variables
  - Configure Pino options (level, formatters, timestamp)
  - Conditionally add pino-pretty transport if LOG_FORMAT='pretty'
  - Create root Pino logger instance
  - Implement forComponent method on root logger that returns child logger with {component} context
  - Implement forMessage method on component loggers that returns child logger with {uid} context
  - Export rootLogger
- **Module**: nodejs

---

### Phase 2: Update Dependencies

#### Step 2.1: Update package.json
- **Files**: `package.json`
- **Action**: 
  - Add "pino-pretty" to devDependencies
- **Module**: nodejs

---

### Phase 3: Environment Configuration

#### Step 3.1: Update .env.example
- **Files**: `.env.example` (create if doesn't exist)
- **Action**: 
  - Add LOG_LEVEL with default 'info' and valid options documented
  - Add LOG_FORMAT with default 'json' and valid options documented
- **Module**: documentation

---

### Phase 4: Update config.js

#### Step 4.1: Update src/lib/utils/config.js
- **Files**: `src/lib/utils/config.js`
- **Action**: 
  - Remove `import pino from 'pino'`
  - Remove `const logger = pino()`
  - Add `import { rootLogger } from './logger.js'`
  - Add `const logger = rootLogger.forComponent('config')`
  - Keep all existing logger calls unchanged
- **Module**: nodejs

---

### Phase 5: Update imap-client.js

#### Step 5.1: Update src/lib/imap-client.js
- **Files**: `src/lib/imap-client.js`
- **Action**: 
  - Remove `import pino from 'pino'`
  - Remove `const logger = pino()`
  - Add `import { rootLogger } from './utils/logger.js'`
  - Add `const logger = rootLogger.forComponent('imap')`
  - In newClient() function, verify ImapFlow logger option uses `logger` (component logger)
  - Keep all existing logger calls unchanged
- **Module**: nodejs

---

### Phase 6: Update rspamd-client.js

#### Step 6.1: Update src/lib/rspamd-client.js
- **Files**: `src/lib/rspamd-client.js`
- **Action**: 
  - Remove `import pino from 'pino'`
  - Remove `const logger = pino()`
  - Add `import { rootLogger } from './utils/logger.js'`
  - Add `const logger = rootLogger.forComponent('rspamd')`
  - Keep all existing logger calls unchanged
- **Module**: nodejs

---

### Phase 7: Update rspamd.js (Basic Migration)

#### Step 7.1: Update src/lib/rspamd.js
- **Files**: `src/lib/rspamd.js`
- **Action**: 
  - Remove `import pino from 'pino'`
  - Remove `const logger = pino()`
  - Add `import { rootLogger } from './utils/logger.js'`
  - Add `const logger = rootLogger.forComponent('rspamd')`
  - Keep all existing logger calls unchanged (message loggers added in Phase 23)
- **Module**: nodejs

---

### Phase 8: Update email.js

#### Step 8.1: Update src/lib/utils/email.js
- **Files**: `src/lib/utils/email.js`
- **Action**: 
  - Remove `import pino from 'pino'`
  - Remove `const logger = pino()`
  - Add `import { rootLogger } from './logger.js'`
  - Add `const logger = rootLogger.forComponent('email-utils')`
  - Keep all existing logger calls unchanged
- **Module**: nodejs

---

### Phase 9: Update rspamd-maps.js

#### Step 9.1: Update src/lib/utils/rspamd-maps.js
- **Files**: `src/lib/utils/rspamd-maps.js`
- **Action**: 
  - Remove `import pino from 'pino'`
  - Remove `const logger = pino()`
  - Add `import { rootLogger } from './logger.js'`
  - Add `const logger = rootLogger.forComponent('rspamd-maps')`
  - Keep all existing logger calls unchanged
- **Module**: nodejs

---

### Phase 10: Update train-spam.js

#### Step 10.1: Update src/train-spam.js
- **Files**: `src/train-spam.js`
- **Action**: 
  - Remove `import pino from 'pino'` (if present)
  - Remove `const logger = pino()` (if present)
  - Add `import { rootLogger } from './lib/utils/logger.js'`
  - Add `const logger = rootLogger.forComponent('train-spam')`
  - Keep all existing logger calls unchanged
- **Module**: nodejs

---

### Phase 11: Update train-ham.js

#### Step 11.1: Update src/train-ham.js
- **Files**: `src/train-ham.js`
- **Action**: 
  - Remove `import pino from 'pino'` (if present)
  - Remove `const logger = pino()` (if present)
  - Add `import { rootLogger } from './lib/utils/logger.js'`
  - Add `const logger = rootLogger.forComponent('train-ham')`
  - Keep all existing logger calls unchanged
- **Module**: nodejs

---

### Phase 12: Update train-whitelist.js

#### Step 12.1: Update src/train-whitelist.js
- **Files**: `src/train-whitelist.js`
- **Action**: 
  - Remove `import pino from 'pino'` (if present)
  - Remove `const logger = pino()` (if present)
  - Add `import { rootLogger } from './lib/utils/logger.js'`
  - Add `const logger = rootLogger.forComponent('train-whitelist')`
  - Keep all existing logger calls unchanged
- **Module**: nodejs

---

### Phase 13: Update train-blacklist.js

#### Step 13.1: Update src/train-blacklist.js
- **Files**: `src/train-blacklist.js`
- **Action**: 
  - Remove `import pino from 'pino'` (if present)
  - Remove `const logger = pino()` (if present)
  - Add `import { rootLogger } from './lib/utils/logger.js'`
  - Add `const logger = rootLogger.forComponent('train-blacklist')`
  - Keep all existing logger calls unchanged
- **Module**: nodejs

---

### Phase 14: Update list-all.js

#### Step 14.1: Update src/list-all.js
- **Files**: `src/list-all.js`
- **Action**: 
  - Remove `import pino from 'pino'`
  - Remove `const logger = pino()`
  - Add `import { rootLogger } from './lib/utils/logger.js'`
  - Add `const logger = rootLogger.forComponent('list-all')`
  - Keep all existing logger calls unchanged (message loggers can be added later if needed)
- **Module**: nodejs

---

### Phase 15: Update read-email.js

#### Step 15.1: Update src/read-email.js
- **Files**: `src/read-email.js`
- **Action**: 
  - Remove `import pino from 'pino'`
  - Remove `const logger = pino()`
  - Add `import { rootLogger } from './lib/utils/logger.js'`
  - Add `const logger = rootLogger.forComponent('read-email')`
  - Keep all existing logger calls unchanged (message loggers can be added later if needed)
- **Module**: nodejs

---

### Phase 16: Update uid-on-date.js

#### Step 16.1: Update src/uid-on-date.js
- **Files**: `src/uid-on-date.js`
- **Action**: 
  - Remove `import pino from 'pino'` (if present)
  - Remove `const logger = pino()` (if present)
  - Add `import { rootLogger } from './lib/utils/logger.js'`
  - Add `const logger = rootLogger.forComponent('uid-on-date')`
  - Keep all existing logger calls unchanged
- **Module**: nodejs

---

### Phase 17: Update scan-inbox.js

#### Step 17.1: Update src/scan-inbox.js
- **Files**: `src/scan-inbox.js`
- **Action**: 
  - Remove `import pino from 'pino'` (if present)
  - Remove `const logger = pino()` (if present)
  - Add `import { rootLogger } from './lib/utils/logger.js'`
  - Add `const logger = rootLogger.forComponent('scan-inbox')`
  - Keep all existing logger calls unchanged
- **Module**: nodejs

---

### Phase 18: Update init-folders.js

#### Step 18.1: Update src/init-folders.js
- **Files**: `src/init-folders.js`
- **Action**: 
  - Remove `import pino from 'pino'`
  - Remove `const logger = pino()`
  - Add `import { rootLogger } from './lib/utils/logger.js'`
  - Add `const logger = rootLogger.forComponent('init-folders')`
  - Keep all existing logger calls unchanged
- **Module**: nodejs

---

### Phase 19: Update read-state.js

#### Step 19.1: Update src/read-state.js
- **Files**: `src/read-state.js`
- **Action**: 
  - Remove `import pino from 'pino'` (if present)
  - Remove `const logger = pino()` (if present)
  - Add `import { rootLogger } from './lib/utils/logger.js'`
  - Add `const logger = rootLogger.forComponent('read-state')`
  - Keep all existing logger calls unchanged
- **Module**: nodejs

---

### Phase 20: Update write-state.js

#### Step 20.1: Update src/write-state.js
- **Files**: `src/write-state.js`
- **Action**: 
  - Remove `import pino from 'pino'` (if present)
  - Remove `const logger = pino()` (if present)
  - Add `import { rootLogger } from './lib/utils/logger.js'`
  - Add `const logger = rootLogger.forComponent('write-state')`
  - Keep all existing logger calls unchanged
- **Module**: nodejs

---

### Phase 21: Update delete-state.js

#### Step 21.1: Update src/delete-state.js
- **Files**: `src/delete-state.js`
- **Action**: 
  - Remove `import pino from 'pino'` (if present)
  - Remove `const logger = pino()` (if present)
  - Add `import { rootLogger } from './lib/utils/logger.js'`
  - Add `const logger = rootLogger.forComponent('delete-state')`
  - Keep all existing logger calls unchanged
- **Module**: nodejs

---

### Phase 22: Update reset-state.js

#### Step 22.1: Update src/reset-state.js
- **Files**: `src/reset-state.js`
- **Action**: 
  - Remove `import pino from 'pino'` (if present)
  - Remove `const logger = pino()` (if present)
  - Add `import { rootLogger } from './lib/utils/logger.js'`
  - Add `const logger = rootLogger.forComponent('reset-state')`
  - Keep all existing logger calls unchanged
- **Module**: nodejs

---

### Phase 23: Add Message Loggers to rspamd.js

#### Step 23.1: Update src/lib/rspamd.js (message loggers)
- **Files**: `src/lib/rspamd.js`
- **Action**: 
  - In `processWithRspamdLearn()`: Create `const messageLogger = logger.forMessage(uid)`, use messageLogger for all logs in function
  - In `checkMessagesWithRspamd()`: Create message logger per message in loop, use for message-specific logs
  - In `scanInbox()`: Pass message loggers to processing functions where appropriate
  - In `learnFromFolder()`: Create message logger per message, use for message-specific logs
  - In `learnFromMap()`: Create message logger per message, use for message-specific logs
  - Review all functions that process individual messages and ensure they use message logger
- **Module**: nodejs

---

### Phase 24: Add Message Loggers to imap-client.js

#### Step 24.1: Update src/lib/imap-client.js (message loggers)
- **Files**: `src/lib/imap-client.js`
- **Action**: 
  - In `moveMessage()`: Add optional `messageLogger` parameter, use if provided or create from component logger
  - In `moveMessages()`: Consider creating message logger per UID if detailed logging needed
  - In `fetchMessagesByUIDs()`: Consider message logger per UID if needed
  - Review functions that process individual messages by UID
  - Update function JSDoc comments to document optional messageLogger parameter
- **Module**: nodejs

---

### Phase 25: Create Logger Tests

#### Step 25.1: Create test/logger.test.js
- **Files**: `test/logger.test.js` (new file)
- **Action**: 
  - Test rootLogger is valid Pino instance
  - Test rootLogger.forComponent('test') creates child logger
  - Test component logger has forMessage method
  - Test componentLogger.forMessage(123) creates child with both component and uid
  - Test LOG_LEVEL environment variable controls log level
  - Test LOG_FORMAT environment variable (mock or test output format)
  - Test invalid LOG_LEVEL defaults to 'info'
  - Test invalid LOG_FORMAT defaults to 'json'
  - Test hierarchy produces correct nested context {component, uid}
- **Module**: nodejs

---

### Phase 26: Update Existing Tests

#### Step 26.1: Update test/email-parser.test.js
- **Files**: `test/email-parser.test.js`
- **Action**: 
  - Review if test imports or mocks logger
  - Update imports if needed
  - Ensure test passes with new logger structure
- **Module**: nodejs

#### Step 26.2: Update test/email.test.js
- **Files**: `test/email.test.js`
- **Action**: 
  - Review if test imports or mocks logger
  - Update imports if needed
  - Ensure test passes with new logger structure
- **Module**: nodejs

#### Step 26.3: Update test/mailboxes-utils.test.js
- **Files**: `test/mailboxes-utils.test.js`
- **Action**: 
  - Review if test imports or mocks logger
  - Update imports if needed
  - Ensure test passes with new logger structure
- **Module**: nodejs

#### Step 26.4: Update test/rspamd-client.test.js
- **Files**: `test/rspamd-client.test.js`
- **Action**: 
  - Review if test imports or mocks logger
  - Update imports if needed
  - Ensure test passes with new logger structure
- **Module**: nodejs

#### Step 26.5: Update test/rspamd-maps.test.js
- **Files**: `test/rspamd-maps.test.js`
- **Action**: 
  - Review if test imports or mocks logger
  - Update imports if needed
  - Ensure test passes with new logger structure
- **Module**: nodejs

#### Step 26.6: Update test/spam-classifier.test.js
- **Files**: `test/spam-classifier.test.js`
- **Action**: 
  - Review if test imports or mocks logger
  - Update imports if needed
  - Ensure test passes with new logger structure
- **Module**: nodejs

#### Step 26.7: Update test/state-utils.test.js
- **Files**: `test/state-utils.test.js`
- **Action**: 
  - Review if test imports or mocks logger
  - Update imports if needed
  - Ensure test passes with new logger structure
- **Module**: nodejs

---

### Phase 27: Manual Testing

#### Step 27.1: Test LOG_FORMAT=pretty
- **Files**: N/A
- **Action**: 
  - Set LOG_FORMAT=pretty in environment
  - Run application
  - Verify human-readable colored output
  - Verify output is not JSON
- **Module**: Manual validation

#### Step 27.2: Test LOG_FORMAT=json
- **Files**: N/A
- **Action**: 
  - Set LOG_FORMAT=json in environment
  - Run application
  - Verify JSONL output
  - Verify each log line is valid JSON
- **Module**: Manual validation

#### Step 27.3: Test LOG_LEVEL=debug
- **Files**: N/A
- **Action**: 
  - Set LOG_LEVEL=debug in environment
  - Run application
  - Verify DEBUG level messages appear in output
  - Verify more verbose logging
- **Module**: Manual validation

#### Step 27.4: Test UID correlation
- **Files**: N/A
- **Action**: 
  - Process test messages with known UIDs
  - Verify logs contain both component and uid fields
  - Search/filter logs by UID
  - Verify complete processing flow traced by UID
- **Module**: Manual validation

#### Step 27.5: Test ImapFlow integration
- **Files**: N/A
- **Action**: 
  - Run application with IMAP operations
  - Verify ImapFlow logs contain component: 'imapflow'
  - Verify ImapFlow logs integrate with root logger
  - Verify proper log format and level
- **Module**: Manual validation

---

### Phase 28: Update Documentation

#### Step 28.1: Update README.md
- **Files**: `README.md`
- **Action**: 
  - Document LOG_LEVEL environment variable and valid options
  - Document LOG_FORMAT environment variable and valid options
  - Add section on logging configuration
  - Add examples of log output in different formats
  - Document component logger pattern for developers
- **Module**: documentation

#### Step 28.2: Verify .env.example
- **Files**: `.env.example`
- **Action**: 
  - Verify LOG_LEVEL and LOG_FORMAT are documented
  - Verify default values are clear
  - Verify examples are helpful
- **Module**: documentation

---

## Validation Checklist

### Code Quality
- [ ] All `const logger = pino()` occurrences removed
- [ ] All files import from centralized logger module
- [ ] Component loggers declared at file level with appropriate names
- [ ] Message loggers created where UIDs are available
- [ ] Code follows `.github/instructions/nodejs.instructions.md` standards
- [ ] No sensitive data logged (credentials, email content)

### Functionality
- [ ] Root logger available for app-level operations
- [ ] Component logger pattern enforced (one declaration per file)
- [ ] Message logger hierarchy works (component → message)
- [ ] All message-related logs contain both `component` and `uid` fields
- [ ] LOG_FORMAT environment variable switches between pretty and JSON
- [ ] LOG_LEVEL environment variable controls verbosity
- [ ] ImapFlow integration uses component logger correctly
- [ ] Error logs include appropriate context

### Testing
- [ ] All new unit tests pass
- [ ] All existing tests still pass
- [ ] Manual testing scenarios completed (see Step 5.3)
- [ ] Log output verified in both formats (pretty, JSON)
- [ ] UID correlation verified across log entries
- [ ] No performance degradation observed

### Migration Completeness
- [ ] All 9+ files migrated from independent loggers
- [ ] Component name mapping consistent across files
- [ ] Logger hierarchy properly implemented in message processing
- [ ] Function signatures updated for logger passing where needed
- [ ] No regression in existing logging behavior

### Documentation
- [ ] Environment variables documented
- [ ] Logger usage patterns documented
- [ ] Component name conventions documented
- [ ] Examples provided for common scenarios

---

## References

- **Design Document**: [20260215-centralized-logging-system-design.md](./20260215-centralized-logging-system-design.md) - Full requirements, architecture, and context
- **Module Instructions**: 
  - Node.js: `../../.github/instructions/nodejs.instructions.md`
  - Documentation: `../../.github/instructions/documentation.instructions.md`
- **Pino Documentation**: https://getpino.io/
- **pino-pretty Documentation**: https://github.com/pinojs/pino-pretty
