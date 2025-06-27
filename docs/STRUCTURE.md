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
│   │   └── state-manager.js        ← read/write/delete state
│   ├── train-spam.js               ← sa-learn --spam
│   ├── train-ham.js                ← sa-learn --ham
│   ├── scan-inbox.js               ← scans inbox, updates state
│   ├── init-folders.js             ← creates folders
│   ├── read-state.js               ← reads state, prints to stdout
│   ├── write-state.js              ← writes state from stdin
│   ├── delete-state.js             ← deletes IMAP state
│   ├── start.sh                    ← entrypoint
│   └── uid-on-date.js              ← finds UID by date
├── package.json                    ← Node.js project file
├── Dockerfile                      ← container definition
└── LICENSE                         ← MIT
```