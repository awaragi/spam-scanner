# Docker Containerization for Production Deployment - Implementation Plan

**Status**: Completed  
**Date Started**: 2026-02-18  
**Date Completed**: 2026-02-18  
**Complexity**: COMPLEX

> **Note**: This plan provides concise implementation steps. See the [design document](./20260218-docker-containerization-design.md) for full requirements, architecture details, and design decisions.

## Implementation Progress

### Phase 1: Docker Configuration Files
- [x] **Step 1.1: Create Dockerfile**
- [x] **Step 1.2: Create .dockerignore**
- [x] **Step 1.3: Create docker-compose.yml**

### Phase 2: Entry Point Script
- [x] **Step 2.1: Create bin/docker directory and entrypoint.sh**

### Phase 3: Documentation
- [x] **Step 3.1: Update .env.example**
- [x] **Step 3.2: Update README.md**

### Phase 4: Testing & Validation
- [x] **Step 4.1: Build and test Docker image**
- [x] **Step 4.2: Test docker-compose deployment**
- [x] **Step 4.3: Verify local development workflow**

---

## Implementation Steps

### Phase 1: Docker Configuration Files

#### Step 1.1: Create Dockerfile
- **Files**: `Dockerfile` (new)
- **Action**: Create multi-stage Dockerfile with builder stage for dependencies and runtime stage with node:20-alpine. Copy only src/ and bin/docker/ to runtime image.
- **Module**: N/A (Docker configuration)

#### Step 1.2: Create .dockerignore
- **Files**: `.dockerignore` (new)
- **Action**: Exclude development files, test directory, docs, .env files, rspamd data/logs, git files, and markdown (except README.md).
- **Module**: N/A (Docker configuration)

#### Step 1.3: Create docker-compose.yml
- **Files**: `docker-compose.yml` (new, root directory)
- **Action**: Define 4 services (spam-scanner, rspamd, redis, unbound) with proper networking, volume mounts, and hardcoded RSPAMD_URL=http://rspamd:11334. Use env_file for .env, interpolate RSPAMD_PASSWORD.
- **Module**: N/A (Docker configuration)

---

### Phase 2: Entry Point Script

#### Step 2.1: Create bin/docker directory and entrypoint.sh
- **Files**: `bin/docker/entrypoint.sh` (new)
- **Action**: Create shell script with environment validation (IMAP_HOST), script execution loop (init-folders, train-*, scan-inbox), and sleep cycle using SCAN_INTERVAL. Make executable.
- **Module**: scripts (follow `.github/instructions/scripts.instructions.md`)

---

### Phase 3: Documentation

#### Step 3.1: Update .env.example
- **Files**: `.env.example`
- **Action**: Add comment explaining RSPAMD_URL is for local dev only (Docker hardcodes it). Document RSPAMD_PASSWORD still needed in .env.
- **Module**: documentation (follow `.github/instructions/documentation.instructions.md`)

#### Step 3.2: Update README.md
- **Files**: `README.md`
- **Action**: Add "Docker Deployment" section with setup instructions, docker-compose commands, volume persistence explanation, log viewing (docker-compose logs -f spam-scanner), and environment variable notes.
- **Module**: documentation (follow `.github/instructions/documentation.instructions.md`)

---

### Phase 4: Testing & Validation

#### Step 4.1: Build and test Docker image
- **Files**: N/A
- **Action**: Run `docker build -t spam-scanner .` and verify successful build, image size < 200MB, no errors.
- **Module**: N/A (manual testing)

#### Step 4.2: Test docker-compose deployment
- **Files**: N/A
- **Action**: Run `docker-compose up --build`, verify all 4 services start, check spam-scanner logs show connection to IMAP and Rspamd, verify script sequence executes. Test stopping/restarting to verify data persistence.
- **Module**: N/A (manual testing)

#### Step 4.3: Verify local development workflow
- **Files**: N/A
- **Action**: Ensure `cd rspamd && docker-compose up -d && ./bin/local/start.sh` still works unchanged. Verify no regression in local dev experience.
- **Module**: N/A (manual testing)

---

## Validation Checklist

### Code Quality
- [ ] Dockerfile follows best practices (multi-stage, minimal layers, proper ENTRYPOINT)
- [ ] Shell script follows `.github/instructions/scripts.instructions.md` guidelines
- [ ] Documentation follows `.github/instructions/documentation.instructions.md` guidelines
- [ ] No secrets baked into Docker image

### Functionality
- [ ] All services defined in docker-compose.yml
- [ ] Environment variables properly configured (hardcoded RSPAMD_URL, interpolated RSPAMD_PASSWORD)
- [ ] Volume mounts configured for data persistence
- [ ] Entry point script validates environment and runs script sequence
- [ ] Sleep interval configurable via SCAN_INTERVAL

### Testing
- [ ] Docker image builds successfully
- [ ] Image size under 200MB
- [ ] All 4 services start with docker-compose up
- [ ] spam-scanner connects to Rspamd successfully
- [ ] spam-scanner connects to IMAP successfully
- [ ] Script sequence runs in correct order
- [ ] Logs accessible via docker-compose logs
- [ ] Data persists across container restarts
- [ ] Local development workflow unaffected
- [ ] Manual testing checklist from design document completed

---

## References

- **Design Document**: [20260218-docker-containerization-design.md](./20260218-docker-containerization-design.md) - Full requirements, architecture, and context
- **Rspamd Compose Reference**: `../../rspamd/docker-compose.yml`
- **Local Start Script Reference**: `../../bin/local/start.sh`
- **Scripts Instructions**: `../../.github/instructions/scripts.instructions.md`
- **Documentation Instructions**: `../../.github/instructions/documentation.instructions.md`
