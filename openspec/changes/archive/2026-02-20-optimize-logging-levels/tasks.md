## 1. Workflows

- [x] 1.1 `scan-workflow.js`: demote "No new messages to process" to `.debug`
- [x] 1.2 `scan-workflow.js`: demote "Scanning batch" to `.debug`
- [x] 1.3 `scan-workflow.js`: demote "Moving spam messages to spam folder" to `.debug`
- [x] 1.4 `train-workflow.js`: demote "No messages in folder to process" to `.debug`
- [x] 1.5 `train-workflow.js`: demote "Learn batch" to `.debug`
- [x] 1.6 `map-workflow.js`: demote "No messages in training folder" to `.debug`
- [x] 1.7 `map-workflow.js`: demote "No extractable senders found in training folder" to `.debug`
- [x] 1.8 `map-workflow.js`: demote "Map state backup updated" to `.debug`
- [x] 1.9 `map-workflow.js`: demote "Training messages moved" to `.debug`
- [x] 1.10 `map-workflow.js`: demote "Map file not found for state backup" to `.debug`

## 2. IMAP Client

- [x] 2.1 `imap-client.js`: demote "Opened folder" to `.debug`
- [x] 2.2 `imap-client.js`: demote "Searching messages" to `.debug`
- [x] 2.3 `imap-client.js`: demote "No messages found" to `.debug`
- [x] 2.4 `imap-client.js`: demote "Found messages" to `.debug`
- [x] 2.5 `imap-client.js`: demote "Fetched all messages" to `.debug`
- [x] 2.6 `imap-client.js`: demote "Fetched messages by UIDs" to `.debug`
- [x] 2.7 `imap-client.js`: demote "Successfully moved message by UID" to `.debug`
- [x] 2.8 `imap-client.js`: demote "Move completed with expunge" to `.debug`
- [x] 2.9 `imap-client.js`: demote "All messages moved" to `.debug`
- [x] 2.10 `imap-client.js`: demote "Flags added successfully" to `.debug`
- [x] 2.11 `imap-client.js`: demote "Flags removed successfully" to `.debug`
- [x] 2.12 `imap-client.js`: demote "All message flags updated" to `.debug`

## 3. Services

- [x] 3.1 `message-service.js`: demote "Starting Rspamd check" to `.debug`
- [x] 3.2 `message-service.js`: demote "Rspamd check completed" to `.debug`
- [x] 3.3 `message-service.js`: demote "Rspamd scan results" to `.debug`
- [x] 3.4 `training-service.js`: demote "Learning message with rspamd" to `.debug`
- [x] 3.5 `training-service.js`: demote "Message processed with rspamd learn" to `.debug`

## 4. Processors

- [x] 4.1 `label-processor.js`: demote "Processing messages with label strategy" to `.debug`
- [x] 4.2 `label-processor.js`: demote "Resetting spam labels on clean messages" to `.debug`
- [x] 4.3 `label-processor.js`: demote "Applying Spam:Low label" to `.debug`
- [x] 4.4 `label-processor.js`: demote "Applying Spam:High label" to `.debug`
- [x] 4.5 `folder-processor.js`: demote "Processing messages with folder strategy" to `.debug`
- [x] 4.8 `color-processor.js`: demote "Processing messages with color strategy" to `.debug`
- [x] 4.6 `folder-processor.js`: demote "Moving low spam messages" to `.debug`
- [x] 4.7 `folder-processor.js`: demote "Moving high spam messages" to `.debug`

## 5. Utilities and Clients

- [x] 5.1 `rspamd-client.js`: demote "Rspamd learn ham skipped" to `.debug`
- [x] 5.2 `rspamd-client.js`: demote "Rspamd learn spam skipped" to `.debug`
- [x] 5.3 `map-service.js`: demote "Map file updated" to `.debug`
- [x] 5.4 `email.js`: demote "Email address rejected as non-human-readable" to `.debug`
- [x] 5.5 `init-folders.js`: demote "Processing mode is folder, including spam likelihood folders" to `.debug`
