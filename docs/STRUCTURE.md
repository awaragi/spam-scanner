```
spam-scanner/
├── README.md                       ← Entry documentation
├── docs
│   ├── DESIGN.md                       ← Design and architecture documentation
│   └── STRUCTURE.md                    ← Structure of the project documentation
├── src
│   ├── /lib
│   │   ├── imap-client.js          ← common IMAP functions
│   │   ├── spamassassin.js         ← spamc + sa-learn helpers
│   │   ├── state-manager.js        ← read/write/delete state
│   │   └── /utils
│   │       ├── config.js           ← configuration from environment variables
│   │       ├── email.js            ← email utility functions
│   │       ├── email-parser.js     ← parse email and SpamAssassin output
│   │       ├── mailboxes-utils.js  ← mailbox utility functions
│   │       ├── spam-classifier.js  ← classify messages based on spam score
│   │       ├── spawn-async.js      ← async process spawning
│   │       └── state-utils.js      ← state utility functions
│   ├── train-spam.js               ← sa-learn --spam
│   ├── train-ham.js                ← sa-learn --ham
│   ├── train-whitelist.js          ← whitelist training
│   ├── train-blacklist.js          ← blacklist training
│   ├── scan-inbox.js               ← scans inbox, updates state
│   ├── init-folders.js             ← creates folders
│   ├── read-state.js               ← reads state, prints to stdout
│   ├── write-state.js              ← writes state from stdin
│   ├── reset-state.js              ← resets state to last_uid=0
│   ├── delete-state.js             ← deletes IMAP state
│   ├── list-all.js                 ← lists all messages in a folder
│   ├── read-email.js               ← reads and displays a specific email
│   └── uid-on-date.js              ← finds UID by date
├── start.sh                        ← entrypoint
├── package.json                    ← Node.js project file
├── Dockerfile                      ← container definition
├── test                            ← test directory
└── LICENSE                         ← MIT
```
