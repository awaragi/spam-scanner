# Proposal

## Why

The Angular control UI (`front/`) currently behaves like a raw API debug console: plain unstyled buttons, one button per HTTP call, and every response - success or error - dumped as JSON into a `<pre>` block. It works for a developer who knows the API, but it isn't an admin experience: there's no structure, no contextual relevance (every action is always shown regardless of whether it applies), and no confirmation before destructive calls. This change turns it into an actual admin product: structured, modular, purpose-built views and actions, with JSON never shown on screen.

## What Changes

- Add Angular Material (`@angular/material`, `@angular/cdk`) as the app's component and theming library, with a single Material 3 theme applied app-wide. (No animations package - see design.md D1: Angular Material 22 doesn't need one.)
- Introduce a single shared layout shell (toolbar + page container) used by every page instead of each page rendering its own bare markup. The toolbar's navigation adapts to the current session context - admin context shows admin-level nav (accounts/mailboxes, logout); mailbox context shows mailbox-scoped nav (current mailbox, back-to-admin, logout) - as one shared component with role-aware content, not separate markup per page.
- Build a small set of reusable, modular pieces shared across pages instead of one-off hand-rolled markup per page: a status badge, a confirm-dialog service, and a notification (snackbar) service. See design.md D2 for why these three and not a generic data-table/action-group wrapper (only two, differently-shaped tables exist).
- Redesign the login page: a Material form field/card layout with inline validation and error messages instead of raw error JSON.
- Redesign the admin page: one merged Material table (not two) showing each mailbox's persisted account config and live runner status together as a single row - previously two separate tables (one from each of two different API resources) listed the same mailbox ids side by side with duplicate "Enabled" toggles wired to the same endpoint, which read as two different things to an admin rather than one mailbox (design.md D11); row actions (enable/disable, AI on/off, open, delete); a confirmation dialog gates destructive actions (e.g. delete account); a snackbar reports success/failure of each action.
- Redesign the mailbox detail page: replace the flat "one button per endpoint" layout with purpose-built views -
  - enabled/disabled is a single contextual toggle (not separate enable/disable buttons, not a manual "GET status" button - status loads and stays current automatically)
  - settings are an editable form, not a JSON dump, grouped into 5 sections each with its own "Override defaults" checkbox - unchecked, a section shows (read-only) its resolved/default value and is left out of the save entirely; checked, it becomes editable and is included. Opening settings and saving with nothing touched no longer silently pins every default in place as a permanent override (design.md D12 - this needed a small server change, see "Modified Capabilities" below).
  - state is a structured summary (e.g. progress, last scan) with a "Reset state" action gated by a confirmation dialog, replacing the raw "DELETE state" button
  - job triggers are disabled while that specific job is already running, read from the per-job status (`idle`/`running`) the server already tracks and returns on the mailbox's status endpoint - no new server-side state needed
  - every action reports success/failure via snackbar; **no JSON is ever rendered on screen**, in any page, for any action
- Redesign the sender-list panel: restyled with Material (card, icon buttons) around the existing bulk-edit textarea for whitelist and blacklist entries. A chip-based preview was tried and removed - see design.md D7.
- Create-account and edit-mailbox-settings each get their own route (`/admin/accounts/new`, `/mailbox/:id/settings`) instead of being inline panels on the admin/mailbox overview pages.
- A new account's mailbox id is derived from its IMAP username when that username is itself an email address (the common case); when it isn't (a bare, non-email IMAP login), a conditional "Email" field appears to supply the id instead - the server requires `id` to be an email (`accountRecordSchema`) regardless of what the IMAP username looks like (design.md D9).
- The layout is responsive: no horizontal page overflow and all controls stay reachable from phone width up.
- A 401 from any API call - not just a missing token at navigation time - clears the session and redirects to `/login` with a readable notice, so a token expiring while the user is sitting on an already-loaded page doesn't strand them on a dead screen (design.md D13). The login page's own wrong-password 401 is unaffected (its existing inline error, not a session-expiry signal).
- Routing gains two new routes (both reachable only through the existing `adminGuard`/`mailboxGuard`), and a new `HttpInterceptorFn` is registered in `app.config.ts` - `ApiService` itself, auth-storage, and the guards are unchanged.

## Capabilities

### New Capabilities
- `front-end/control-ui`: the durable UX behavior of the admin/control UI - every API result is presented through a purpose-built view (never raw JSON), actions are shown/enabled only when contextually relevant to current state (e.g. a job's own trigger is disabled while it is running), destructive actions require confirmation, every action reports success/failure feedback, navigation adapts to the current session's role (admin vs. mailbox), a mailbox's account config and live status are one entity rather than two separate listings, a setting shown as editable is distinguishable from one merely showing its default, and an expired/invalid session redirects to login rather than stranding the user on a dead page. This capability's requirements hold regardless of which specific component library or page layout implements them.

### Modified Capabilities
- `server/mailbox-api`: `GET .../settings`'s response shape changes from bare resolved settings to `{ settings, overriddenKeys }`, so the control UI can tell a real stored override apart from a value that merely equals its default (design.md D12). No change to what's stored, how `PUT .../settings` behaves, or any other endpoint.

## Impact

- `front/package.json` - new dependencies: `@angular/material`, `@angular/cdk`.
- `front/src/app/**` - every page component (`login`, `admin`, `mailbox`, `sender-list-panel`), a new shared layout/toolbar component, three shared pieces (status badge, confirm-dialog service, notification service), a new routed create-account page, the mailbox-settings panel promoted to its own routed page with per-section override checkboxes, and a new `auth.interceptor.ts`.
- `front/src/app/app.routes.ts` - two new routes.
- `front/src/app/app.config.ts` - registers the new HTTP interceptor.
- `front/src/styles.css` - Material theme setup (typography, palette).
- `server/src/runtime/mailbox-runner.ts`, `runner-registry.ts`, `server/src/api/mailbox/mailbox.controller.ts` - `GET .../settings` additionally returns `overriddenKeys` (design.md D12).
- No changes to `shared/`.
