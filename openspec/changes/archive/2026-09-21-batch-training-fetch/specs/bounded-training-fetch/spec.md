# Spec Delta

## Purpose

Bounds how much of a training folder's content is held in memory at once during
spam/ham/whitelist/blacklist training, and how much of each message is downloaded,
so training a large backlog of messages doesn't exhaust container memory and a
mid-run failure doesn't discard work already completed in the same run.

## ADDED Requirements

### Requirement: Training workflows search UIDs before fetching

Before fetching any message content, the spam/ham training workflow and the
whitelist/blacklist map-training workflow SHALL search the training folder for the
full set of message UIDs present, rather than fetching all messages' content
directly.

#### Scenario: UIDs are searched before any content is fetched

- **WHEN** a training folder contains messages and its training workflow runs
- **THEN** the workflow issues a UID search for the folder before issuing any
  per-message content fetch

### Requirement: Message content is fetched in bounded batches

The spam/ham training workflow and the whitelist/blacklist map-training workflow
SHALL fetch message content in chunks of at most `PROCESS_BATCH_SIZE` UIDs at a
time, processing (learning/extracting and moving) each fetched batch before
fetching the next, rather than fetching every message in the folder in a single
call.

#### Scenario: A folder larger than PROCESS_BATCH_SIZE is processed in multiple fetches

- **WHEN** a training folder contains more messages than `PROCESS_BATCH_SIZE`
- **THEN** the workflow issues more than one content-fetch call, each for at most
  `PROCESS_BATCH_SIZE` UIDs, rather than a single call covering the whole folder

#### Scenario: A batch already processed survives a later batch's fetch failure

- **WHEN** a training run has already trained/extracted-and-moved one batch and a
  subsequent batch's content fetch then fails
- **THEN** the earlier batch's learned/extracted state and moved messages are
  unaffected by the later failure

### Requirement: Map training fetches headers only, not full message content

The whitelist/blacklist map-training workflow SHALL fetch only message headers for
sender extraction, not the full message source or body.

#### Scenario: Map training does not request message source or body

- **WHEN** the whitelist or blacklist map-training workflow fetches a batch of
  messages
- **THEN** the fetch requests only header data, not the message's raw source or
  body content
