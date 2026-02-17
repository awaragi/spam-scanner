```
spam-scanner/
├── README.md                       ← Entry documentation
├── docs
│   ├── DESIGN.md                   ← Design and architecture documentation
│   ├── STRUCTURE.md                ← Structure of the project documentation
│   ├── SPAMASSASSIN.md             ← SpamAssassin documentation
│   └── features/                   ← Feature design and implementation plans
├── src
│   ├── /lib
│   │   ├── /workflows              ← High-level orchestration
│   │   │   ├── scan-workflow.js    ← Inbox scanning orchestration
│   │   │   ├── train-workflow.js   ← Training orchestration (spam/ham)
│   │   │   └── map-workflow.js     ← Map management orchestration (whitelist/blacklist)
│   │   ├── /processors             ← Processing strategies (strategy pattern)
│   │   │   ├── base-processor.js   ← Abstract processor and factory
│   │   │   ├── label-processor.js  ← Apply/remove spam labels (current default)
│   │   │   ├── folder-processor.js ← Move to spam likelihood folders (future)
│   │   │   └── color-processor.js  ← Apply color flags (future)
│   │   ├── /services               ← Business logic
│   │   │   ├── message-service.js  ← Message processing with Rspamd
│   │   │   ├── training-service.js ← Spam/ham training logic
│   │   │   └── map-service.js      ← Map extraction and update logic
│   │   ├── /clients                ← External I/O operations
│   │   │   ├── imap-client.js      ← IMAP connection and operations
│   │   │   └── rspamd-client.js    ← Rspamd HTTP API client
│   │   ├── state-manager.js        ← State persistence
│   │   └── /utils                  ← Utility functions
│   │       ├── config.js           ← Configuration from environment variables
│   │       ├── email.js            ← Email utility functions
│   │       ├── email-parser.js     ← Parse email and Rspamd output
│   │       ├── logger.js           ← Structured logging (Pino)
│   │       ├── mailboxes-utils.js  ← Mailbox utility functions
│   │       ├── rspamd-maps.js      ← Rspamd map file operations
│   │       ├── spam-classifier.js  ← Classify messages based on spam score
│   │       └── state-utils.js      ← State utility functions
│   ├── train-spam.js               ← Entry: Train with spam
│   ├── train-ham.js                ← Entry: Train with ham
│   ├── train-whitelist.js          ← Entry: Update whitelist map
│   ├── train-blacklist.js          ← Entry: Update blacklist map
│   ├── scan-inbox.js               ← Entry: Scan inbox for spam
│   ├── init-folders.js             ← Entry: Create required IMAP folders
│   └── /admin                      ← Admin and utility scripts
│       ├── read-state.js           ← Reads and displays scanner state
│       ├── write-state.js          ← Writes state from stdin
│       ├── reset-state.js          ← Resets state to last_uid=0
│       ├── delete-state.js         ← Deletes IMAP state
│       ├── list-all.js             ← Lists all messages in a folder
│       ├── read-email.js           ← Reads and displays a specific email
│       └── uid-on-date.js          ← Finds UID by date
├── bin/
│   └── local/
│       ├── start.sh                ← Orchestration: runs workflows in sequence
│       ├── check-rspamd.sh         ← Check Rspamd health
│       └── sort-maps.sh            ← Sort and deduplicate map files
├── rspamd/                         ← Rspamd Docker configuration
│   ├── docker-compose.yml
│   ├── config/                     ← Rspamd configuration files
│   ├── data/                       ← Rspamd data files (Bayes, cache)
│   ├── logs/                       ← Rspamd logs
│   └── maps/                       ← Whitelist/blacklist maps
├── test/                           ← Unit tests
├── package.json                    ← Node.js project file
├── vitest.config.js                ← Vitest test configuration
└── LICENSE                         ← MIT
```

## Architecture

### Layer Responsibilities

**Workflows** (lib/workflows/)
- High-level orchestration of business processes
- Coordinate services, clients, and state management
- Manage batch processing loops
- Handle error propagation
- No business logic or complex algorithms

**Processors** (lib/processors/)
- Strategy pattern for message processing
- Implement different spam handling modes (label/folder/color)
- Base processor defines interface, factory creates instances
- Extensible for new processing strategies

**Services** (lib/services/)
- Pure business logic when possible
- Stateless operations
- Minimal dependencies
- Highly testable
- Examples: Spam checking, training, sender extraction

**Clients** (lib/clients/)
- External I/O boundaries (IMAP, HTTP)
- Connection management
- Protocol-specific operations
- Error handling for network failures

**State Manager** (lib/state-manager.js)
- Persist scanner state to IMAP
- Read/write/delete operations
- State validation and defaults

**Utils** (lib/utils/)
- Shared utility functions
- Configuration management
- Email parsing and classification
- Pure functions where possible

### Data Flow

**Scanning**: Entry Script → Workflow → Service (Rspamd check) → Processor (label/move) → Client (IMAP) → State Update

**Training**: Entry Script → Workflow → Service (Rspamd learn) → Client (IMAP move) → Complete

**Map Management**: Entry Script → Workflow → Service (extract/update) → State Backup → Client (IMAP move) → Complete

### Processing Modes

The scanner supports multiple processing modes via the `SPAM_PROCESSING_MODE` environment variable:

- **label** (default): Apply Gmail-style labels (Spam:Low, Spam:High)
- **folder** (future): Move messages to spam likelihood folders
- **color** (future): Apply color flags to messages

The processor factory (`base-processor.js`) creates the appropriate processor instance based on configuration.
