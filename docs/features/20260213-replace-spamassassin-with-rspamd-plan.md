# Replace SpamAssassin with Rspamd - Implementation Plan

**Status**: Not Started  
**Date Started**: 2026-02-13  
**Complexity**: COMPLEX

> **Note**: This plan provides concise implementation steps. See the [design document](./20260213-replace-spamassassin-with-rspamd-design.md) for full requirements, architecture details, and design decisions.

## Implementation Progress

### Phase 1: Configuration Setup
- [ ] **Step 1.1: Add Rspamd configuration to config.js**
- [ ] **Step 1.2: Update .env.example with Rspamd variables**

### Phase 2: Rspamd HTTP Client
- [ ] **Step 2.1: Create rspamd-client.js module**
- [ ] **Step 2.2: Create unit tests for rspamd-client**

### Phase 3: Email Parser Updates
- [ ] **Step 3.1: Add parseRspamdOutput function**
- [ ] **Step 3.2: Update email-parser unit tests**

### Phase 4: Replace SpamAssassin Module
- [ ] **Step 4.1: Create rspamd.js from spamassassin.js**
- [ ] **Step 4.2: Update script imports**
- [ ] **Step 4.3: Delete spamassassin.js**
- [ ] **Step 4.4: Remove whitelist/blacklist scripts**

### Phase 5: Testing & Validation
- [ ] **Step 5.1: Run unit tests**
- [ ] **Step 5.2: Manual testing with Docker Rspamd**

### Phase 6: Documentation & Cleanup
- [ ] **Step 6.1: Update README.md**
- [ ] **Step 6.2: Remove spawn-async if unused**

---

## Implementation Steps

### Phase 1: Configuration Setup

#### Step 1.1: Add Rspamd configuration to config.js
- **Files**: `src/lib/utils/config.js`
- **Action**: Add `RSPAMD_URL` and `RSPAMD_PASSWORD` configuration properties with defaults
- **Module**: nodejs (follow `.github/instructions/nodejs.instructions.md`)

#### Step 1.2: Update .env.example with Rspamd variables
- **Files**: `.env.example`
- **Action**: Add RSPAMD_URL and RSPAMD_PASSWORD environment variable documentation
- **Module**: documentation

---

### Phase 2: Rspamd HTTP Client

#### Step 2.1: Create rspamd-client.js module
- **Files**: `src/lib/rspamd-client.js` (create new)
- **Action**: Implement checkEmail(), learnHam(), and learnSpam() functions using fetch API to communicate with Rspamd HTTP endpoints
- **Module**: nodejs

#### Step 2.2: Create unit tests for rspamd-client
- **Files**: `test/rspamd-client.test.js` (create new)
- **Action**: Write tests for client functions with mocked fetch responses (success, error, network failure scenarios)
- **Module**: nodejs

---

### Phase 3: Email Parser Updates

#### Step 3.1: Add parseRspamdOutput function
- **Files**: `src/lib/utils/email-parser.js`
- **Action**: Create parseRspamdOutput() to parse Rspamd JSON responses and extract score, required, isSpam fields; map Rspamd actions to isSpam boolean
- **Module**: nodejs

#### Step 3.2: Update email-parser unit tests
- **Files**: `test/email-parser.test.js`
- **Action**: Add tests for parseRspamdOutput() with various JSON response formats and edge cases
- **Module**: nodejs

---

### Phase 4: Replace SpamAssassin Module

#### Step 4.1: Create rspamd.js from spamassassin.js
- **Files**: `src/lib/rspamd.js` (create new from spamassassin.js)
- **Action**: Replace processWithSpamc() with processWithRspamd() using rspamd-client; replace processWithSALearn() with processWithRspamdLearn(); update imports to use parseRspamdOutput and rspamd-client; remove whitelist/blacklist functions
- **Module**: nodejs

#### Step 4.2: Update script imports
- **Files**: `src/scan-inbox.js`, `src/train-ham.js`, `src/train-spam.js`
- **Action**: Change imports from './lib/spamassassin.js' to './lib/rspamd.js'
- **Module**: nodejs

#### Step 4.3: Delete spamassassin.js
- **Files**: `src/lib/spamassassin.js` (delete)
- **Action**: Remove old SpamAssassin integration module
- **Module**: nodejs

#### Step 4.4: Remove whitelist/blacklist scripts
- **Files**: `src/train-whitelist.js`, `src/train-blacklist.js` (delete)
- **Action**: Remove scripts as whitelist/blacklist functionality is out of scope
- **Module**: nodejs

---

### Phase 5: Testing & Validation

#### Step 5.1: Run unit tests
- **Files**: All test files
- **Action**: Execute `npm test` and verify all tests pass, fix any failures
- **Module**: nodejs

#### Step 5.2: Manual testing with Docker Rspamd
- **Files**: Scripts in `src/`
- **Action**: Run scan-inbox.js, train-spam.js, and train-ham.js with real Rspamd to verify functionality; test error handling with Rspamd stopped
- **Module**: nodejs

---

### Phase 6: Documentation & Cleanup

#### Step 6.1: Update README.md
- **Files**: `README.md`
- **Action**: Replace SpamAssassin references with Rspamd; update setup instructions for Docker configuration; document new environment variables
- **Module**: documentation (follow `.github/instructions/documentation.instructions.md`)

#### Step 6.2: Remove spawn-async if unused
- **Files**: `src/lib/utils/spawn-async.js`, check usage across codebase
- **Action**: If spawn-async is only used for SpamAssassin (grep to verify), remove the module and its tests
- **Module**: nodejs

---

## Validation Checklist

### Code Quality
- [ ] Code is clean, readable, and follows Node.js standards
- [ ] Proper error handling with try/catch blocks
- [ ] Structured logging with Pino
- [ ] JSDoc comments on public functions
- [ ] ES6+ syntax (async/await, const/let, arrow functions)

### Functionality
- [ ] Spam scanning works via Rspamd /checkv2 endpoint
- [ ] Ham learning works via Rspamd /learnham endpoint
- [ ] Spam learning works via Rspamd /learnspam endpoint
- [ ] Email classification (low/high spam) works correctly
- [ ] IMAP labeling and moving operations work
- [ ] Configuration loads from environment variables

### Testing
- [ ] All unit tests pass
- [ ] New rspamd-client tests cover success and error cases
- [ ] Updated email-parser tests pass
- [ ] spam-classifier tests still pass
- [ ] Manual testing confirms end-to-end functionality
- [ ] Error handling tested (Rspamd not running, auth failure)

### Cleanup
- [ ] No SpamAssassin references in code
- [ ] No unused imports or modules
- [ ] Whitelist/blacklist code removed
- [ ] Documentation updated

---

## References

- **Design Document**: [20260213-replace-spamassassin-with-rspamd-design.md](./20260213-replace-spamassassin-with-rspamd-design.md) - Full requirements, architecture, and context
- **Node.js Instructions**: `../../.github/instructions/nodejs.instructions.md`
- **Documentation Instructions**: `../../.github/instructions/documentation.instructions.md`
- **Rspamd Documentation**: https://rspamd.com/doc/architecture/protocol.html
