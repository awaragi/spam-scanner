# Spec Delta

## Purpose

Defines the durable UX behavior of the Angular control UI: how it presents API state, gates risky actions, and reports feedback, independent of which component library or specific page layout implements it.

## ADDED Requirements

### Requirement: The control UI never renders raw API payloads
The control UI SHALL present every API result - success or error - through a purpose-built view, and SHALL NOT render raw JSON on screen for any action, on any page.

#### Scenario: An error response is shown as a readable message
- **WHEN** an API call fails
- **THEN** the control UI shows a human-readable error message rather than the raw error payload

#### Scenario: A successful read is shown through a structured view
- **WHEN** a mailbox's settings or scanner state loads successfully
- **THEN** the control UI renders it as structured fields (e.g. a form or summary), not as a JSON dump

### Requirement: Destructive actions require confirmation
The control UI SHALL require explicit user confirmation before executing a destructive action (e.g. deleting an account, resetting a mailbox's scanner state), and SHALL NOT call the corresponding endpoint until the user confirms.

#### Scenario: Deleting an account requires confirmation
- **WHEN** an admin requests to delete an account
- **THEN** the control UI asks for confirmation before calling the delete endpoint

#### Scenario: Resetting scanner state requires confirmation
- **WHEN** a mailbox token holder requests to reset the mailbox's scanner state
- **THEN** the control UI asks for confirmation before calling the reset endpoint

### Requirement: Every action reports success or failure
The control UI SHALL give the user feedback indicating whether a triggered action succeeded or failed, for every action that calls the API.

#### Scenario: A successful action is confirmed
- **WHEN** an action (e.g. toggling enabled, triggering a job) completes successfully
- **THEN** the control UI indicates success to the user without requiring them to inspect a response body

#### Scenario: A failed action is reported
- **WHEN** an action fails
- **THEN** the control UI indicates failure with a readable message, not a raw error object

### Requirement: A job's trigger is disabled while that job is running
The control UI SHALL disable a job's own trigger control while that job is currently running for the mailbox, based on the per-job status already reported by the mailbox status endpoint.

#### Scenario: Triggering the same job while it runs is prevented in the UI
- **WHEN** a mailbox's scan job is running
- **THEN** the control UI disables the scan job's trigger control until that job is no longer running

#### Scenario: A different job's trigger stays available
- **WHEN** one job is running for a mailbox
- **THEN** the control UI leaves the trigger controls for the mailbox's other jobs enabled

### Requirement: Navigation reflects the current session's role
The control UI SHALL present navigation appropriate to the current session: an admin session SHALL see admin-level navigation, and a mailbox session SHALL see mailbox-scoped navigation, rather than one fixed navigation shown regardless of role.

#### Scenario: An admin session sees admin navigation
- **WHEN** a user is on an admin-scoped page
- **THEN** the navigation shown offers admin-level actions (e.g. accounts/mailboxes, logout)

#### Scenario: A mailbox session sees mailbox-scoped navigation
- **WHEN** a user is on a mailbox detail page
- **THEN** the navigation shown is scoped to that mailbox (e.g. back-to-admin, logout) rather than admin-level navigation

### Requirement: Mailbox settings are viewed and edited as structured fields
The control UI SHALL present a mailbox's settings as editable structured fields, and SHALL let a mailbox token holder submit an update through those fields, rather than only displaying settings as a raw read-only payload.

#### Scenario: Settings are editable through fields
- **WHEN** a mailbox token holder opens the mailbox's settings view
- **THEN** the control UI shows the current settings as structured, editable fields and allows submitting changes through them

### Requirement: A settings field shown as the default is distinguishable from one that is actually overridden
The control UI SHALL show, for each group of mailbox settings, whether that group currently has a real stored override or is showing its code default, and SHALL NOT submit a group's values as an override unless the user has explicitly indicated that group should be overridden.

#### Scenario: Opening settings does not implicitly create an override
- **WHEN** a mailbox token holder opens the mailbox's settings view and submits the form without marking any group as overridden
- **THEN** no settings group is written as a stored override, and the mailbox continues to resolve that group from its code default

#### Scenario: Marking a group as overridden allows editing and saves it as a real override
- **WHEN** a mailbox token holder marks a settings group as overridden, changes a value in it, and submits the form
- **THEN** the control UI saves that group's values as a stored override for the mailbox

#### Scenario: Unmarking a previously-overridden group reverts it to the default
- **WHEN** a mailbox token holder unmarks a settings group that previously had a stored override and submits the form
- **THEN** the control UI's submission no longer includes that group, and the mailbox reverts to resolving it from the code default

### Requirement: Mailbox scanner state is shown as a structured summary
The control UI SHALL present a mailbox's scanner state as a structured summary rather than raw JSON, and SHALL offer a reset action in place of an undifferentiated delete action.

#### Scenario: Scanner state is summarized
- **WHEN** a mailbox token holder views the mailbox's scanner state
- **THEN** the control UI shows a structured summary of that state (or that none exists) rather than raw JSON

### Requirement: Account creation and mailbox settings are dedicated routes
Creating an account and editing a mailbox's settings SHALL each be reached via their own route, rather than rendered inline on the admin overview or mailbox overview page.

#### Scenario: Create account is its own route
- **WHEN** an admin starts creating a new account
- **THEN** the control UI shows the create-account form on its own route, separate from the admin overview

#### Scenario: Mailbox settings is its own route
- **WHEN** a mailbox token holder opens that mailbox's settings
- **THEN** the control UI shows the settings form on its own route, separate from the mailbox overview

### Requirement: A new account's mailbox id is derived when possible, and only asked for separately when it can't be
The control UI SHALL derive a new account's mailbox id from its IMAP username field when that value is an email address, without asking the admin to enter the id separately. When the IMAP username is not an email address, the control UI SHALL ask for the email separately, since the mailbox id must be an email regardless of what the IMAP login username looks like.

#### Scenario: Mailbox id is derived from an email-shaped IMAP username
- **WHEN** an admin fills in the IMAP username as an email address and submits the create-account form
- **THEN** the control UI submits that value as the new account's mailbox id, without having asked for it separately

#### Scenario: A non-email IMAP username prompts for the email separately
- **WHEN** an admin fills in the IMAP username as a bare, non-email username
- **THEN** the control UI shows a separate required email field and submits that field's value as the mailbox id

### Requirement: A mailbox's account record and runner status are shown as one entity
The control UI SHALL present a mailbox's persisted account configuration and its live runner status as a single row/entity, not as separate, independently-acted-on listings for the same mailbox id.

#### Scenario: One row per mailbox
- **WHEN** an admin views the list of managed mailboxes
- **THEN** each mailbox appears exactly once, with its configuration and live status shown together, not in two separate tables

### Requirement: The control UI layout is responsive
The control UI SHALL remain usable, with no horizontal page overflow and every control still reachable, across viewport widths from phone to desktop.

#### Scenario: A phone-width viewport does not overflow
- **WHEN** the control UI is viewed at a phone-width viewport
- **THEN** the page content reflows (e.g. a wide table scrolls within its own container) without the page itself overflowing horizontally

### Requirement: An expired or invalid session redirects to login
The control UI SHALL detect an authentication failure from any API call - not only a missing token at navigation time - and SHALL redirect to the login page with a readable notice, rather than leaving the user on a page that can no longer load or change data.

#### Scenario: A 401 while already on a loaded page redirects to login
- **WHEN** an API call made from an already-loaded page fails because the session's token is no longer valid
- **THEN** the control UI clears the session, shows a readable notice, and redirects to the login page

#### Scenario: A failed login attempt does not trigger the same redirect
- **WHEN** a login attempt itself fails because of a wrong password
- **THEN** the control UI shows that failure as an ordinary form error on the login page, without clearing any session or redirecting
