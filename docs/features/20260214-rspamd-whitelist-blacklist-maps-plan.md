# Rspamd Whitelist/Blacklist Maps - Implementation Plan

**Status**: Not Started | In Progress | Complete  
**Date Started**: 2026-02-14  
**Complexity**: COMPLEX

> **Note**: This plan provides concise implementation steps. See the [design document](./20260214-rspamd-whitelist-blacklist-maps-design.md) for full requirements, architecture details, and design decisions.

## Implementation Progress

### Phase 1: Configuration And Files
- [x] **Step 1.1: Add map files**
- [x] **Step 1.2: Update Rspamd multimap config**
- [x] **Step 1.3: Update Docker Compose mounts**

### Phase 2: Application Updates
- [x] **Step 2.1: Add config for map paths**
- [x] **Step 2.2: Implement map update logic**
- [x] **Step 2.3: Convert JSON lists to maps**
- [x] **Step 2.4: Wire training scripts**

### Phase 3: Tests And Docs
- [x] **Step 3.1: Update or add tests**
- [x] **Step 3.2: Document new env vars**

---

## Implementation Steps

### Phase 1: Configuration And Files

#### Step 1.1: Add map files
- **Files**: `rspamd/maps/whitelist.map`, `rspamd/maps/blacklist.map`
- **Action**: Create empty map files with one-email-per-line format
- **Module**: documentation (follow `.github/instructions/documentation.instructions.md` for any md updates)

#### Step 1.2: Update Rspamd multimap config
- **Files**: `rspamd/config/...`
- **Action**: Define two multimap rules referencing whitelist/blacklist map files with fixed scores in config
- **Module**: N/A

#### Step 1.3: Update Docker Compose mounts
- **Files**: `rspamd/docker-compose.yml`
- **Action**: Mount whitelist/blacklist map files into container paths used by multimap rules
- **Module**: N/A

---

### Phase 2: Application Updates

#### Step 2.1: Add config for map paths
- **Files**: `src/lib/utils/config.js` (or existing config module)
- **Action**: Add env vars for map file paths, resolved relative to repo root
- **Module**: nodejs (follow `.github/instructions/nodejs.instructions.md`)

#### Step 2.2: Implement map update logic
- **Files**: `src/lib/utils/...` (new or existing map utility)
- **Action**: Read map file, normalize and de-duplicate entries, append missing emails while preserving existing content
- **Module**: nodejs

#### Step 2.3: Convert JSON lists to maps
- **Files**: `docs/features/Whitelist - State <state@localhost> - 2026-02-14 0859.eml`, `docs/features/Blacklist - State <state@localhost> - 2026-02-14 0859.eml`, `rspamd/maps/whitelist.map`, `rspamd/maps/blacklist.map`
- **Action**: Convert existing JSON lists to one-email-per-line map format and seed map files
- **Module**: nodejs

#### Step 2.4: Wire training scripts
- **Files**: `src/train-whitelist.js`, `src/train-blacklist.js`
- **Action**: Use map update utility to add senders to the corresponding map file
- **Module**: nodejs

---

### Phase 3: Tests And Docs

#### Step 3.1: Update or add tests
- **Files**: `test/...`
- **Action**: Add unit tests for map update logic and verify de-duplication and append behavior
- **Module**: nodejs

#### Step 3.2: Document new env vars
- **Files**: `README.md` or `docs/...`
- **Action**: Document map file env vars and list formats
- **Module**: documentation

---

## Validation Checklist

### Code Quality
- [ ] Code is clean, readable, and follows standards
- [ ] Proper error handling and types
- [ ] Module-specific guidelines followed

### Functionality
- [ ] All requirements from design document met
- [ ] All implementation steps completed
- [ ] Edge cases handled

### Testing
- [ ] Required tests written and passing
- [ ] Manual testing completed

---

## References

- **Design Document**: [20260214-rspamd-whitelist-blacklist-maps-design.md](./20260214-rspamd-whitelist-blacklist-maps-design.md) - Full requirements, architecture, and context
- **Module Instructions**: `../../.github/instructions/nodejs.instructions.md`
