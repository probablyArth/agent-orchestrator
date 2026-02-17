# Testing Plan - Hash-Based Architecture

## Overview

This document outlines the testing strategy for the new hash-based project isolation architecture. Tests are organized into unit tests (fast, isolated) and integration tests (end-to-end workflows).

---

## 1. Unit Tests

### 1.1 Path Utilities (`packages/core/src/__tests__/paths.test.ts`)

**Test Suite: Hash Generation**
- ✅ `generateConfigHash()` produces 12-character hex string
- ✅ Same config path produces same hash (deterministic)
- ✅ Different config paths produce different hashes
- ✅ Symlinks resolve before hashing (consistent hash regardless of access path)
- ✅ Hash collision probability calculation (document expected collision rate)

**Test Suite: Project ID Generation**
- ✅ `generateProjectId()` extracts basename correctly
- ✅ Handles paths with trailing slashes
- ✅ Handles relative paths
- ✅ Handles paths with special characters

**Test Suite: Instance ID Generation**
- ✅ `generateInstanceId()` combines hash and project ID correctly
- ✅ Same config + same project = same instance ID
- ✅ Same config + different projects = different instance IDs (same hash prefix)
- ✅ Different config + same project = different instance IDs (different hash)

**Test Suite: Session Prefix Generation**
- ✅ `≤4 chars` → use as-is (lowercase): `"foo"` → `"foo"`
- ✅ CamelCase → extract uppercase: `"PyTorch"` → `"pt"`
- ✅ Single uppercase → first 3 chars: `"Integrator"` → `"int"`
- ✅ kebab-case → initials: `"agent-orchestrator"` → `"ao"`
- ✅ snake_case → initials: `"my_project"` → `"mp"`
- ✅ Mixed case → first 3 chars: `"project123"` → `"pro"`
- ✅ Edge cases: single char, numbers, special chars

**Test Suite: Path Construction**
- ✅ `getProjectBaseDir()` returns correct format: `~/.agent-orchestrator/{hash}-{projectId}`
- ✅ `getSessionsDir()` returns: `{baseDir}/sessions`
- ✅ `getWorktreesDir()` returns: `{baseDir}/worktrees`
- ✅ `getArchiveDir()` returns: `{baseDir}/archive`
- ✅ `getOriginFilePath()` returns: `{baseDir}/.origin`
- ✅ `expandHome()` expands `~/` correctly
- ✅ `expandHome()` handles non-home paths

**Test Suite: Session Naming**
- ✅ `generateSessionName()` format: `{prefix}-{num}`
- ✅ `generateTmuxName()` format: `{hash}-{prefix}-{num}`
- ✅ `parseTmuxName()` correctly extracts components
- ✅ `parseTmuxName()` returns null for invalid formats
- ✅ User-facing name does NOT include hash
- ✅ Tmux name ALWAYS includes hash for global uniqueness

**Test Suite: Origin File Management**
- ✅ `validateAndStoreOrigin()` creates .origin file on first use
- ✅ `.origin` contains resolved config path
- ✅ Second call with same config path succeeds (no error)
- ✅ Call with different config path throws hash collision error
- ✅ Error message includes both config paths for debugging
- ✅ Creates parent directory if needed

---

### 1.2 Config Loading & Validation (`packages/core/src/__tests__/config.test.ts`)

**Test Suite: Config Discovery**
- ✅ `findConfig()` finds config in current directory
- ✅ Searches up directory tree (like git)
- ✅ Stops at filesystem root
- ✅ Prefers `agent-orchestrator.yaml` over `.yml`
- ✅ Respects `AO_CONFIG` environment variable
- ✅ AO_CONFIG takes precedence over file search
- ✅ Returns null if no config found

**Test Suite: Config Loading**
- ✅ `loadConfigWithPath()` sets `configPath` in config object
- ✅ `loadConfigWithPath()` resolves symlinks in config path
- ✅ `loadConfig()` works without explicit path (uses discovery)
- ✅ Path expansion works for project paths
- ✅ Legacy configs with `dataDir`/`worktreeDir` still work
- ✅ New configs without `dataDir`/`worktreeDir` work

**Test Suite: Project Uniqueness Validation**
- ✅ Duplicate project IDs (same basename) → clear error
- ✅ Error message shows conflicting paths
- ✅ Error message suggests fix (rename directories)
- ✅ Unique basenames pass validation

**Test Suite: Session Prefix Validation**
- ✅ Duplicate explicit prefixes → error
- ✅ Duplicate auto-generated prefixes → error
- ✅ Error shows both projects with collision
- ✅ Error suggests explicit `sessionPrefix` override
- ✅ Unique prefixes pass validation
- ✅ Mix of explicit and auto-generated prefixes validated correctly

**Test Suite: Config Schema**
- ✅ `dataDir` and `worktreeDir` are optional
- ✅ `projects` is required
- ✅ Project `path`, `repo`, `defaultBranch` are required
- ✅ Project `sessionPrefix` is optional
- ✅ Invalid session prefix regex rejected (must match `[a-zA-Z0-9_-]+`)

---

### 1.3 Metadata Operations (`packages/core/src/__tests__/metadata.test.ts`)

**Test Suite: Metadata Read/Write**
- ✅ `writeMetadata()` includes `tmuxName` field
- ✅ `readMetadata()` parses `tmuxName` field
- ✅ `tmuxName` is optional (backwards compatibility)
- ✅ Metadata without `tmuxName` still readable
- ✅ All existing metadata fields preserved

**Test Suite: Archive Operations**
- ✅ `deleteMetadata()` with archive=true moves to `archive/` subdir
- ✅ Archive filename includes timestamp
- ✅ Archive timestamp format is filesystem-safe (no colons)
- ✅ Archive preserves all metadata content

---

### 1.4 Session Manager (`packages/core/src/__tests__/session-manager.test.ts`)

**Test Suite: Directory Resolution**
- ✅ New architecture: uses hash-based paths when `configPath` is set
- ✅ Legacy: uses flat `dataDir` when `configPath` is null
- ✅ Throws error if neither `configPath` nor `dataDir` is set
- ✅ `getProjectSessionsDir()` returns correct path for each mode
- ✅ `getProjectWorktreesDir()` returns correct path for each mode

**Test Suite: Session Listing (New Architecture)**
- ✅ `list()` scans all project directories
- ✅ `list(projectId)` filters by project correctly
- ✅ Sessions from different projects are isolated
- ✅ Empty projects (no sessions) handled gracefully
- ✅ Non-existent project directories skipped

**Test Suite: Session Listing (Legacy)**
- ✅ `list()` scans flat directory
- ✅ Filters by `project` field in metadata
- ✅ Sessions without `project` field handled gracefully

**Test Suite: Session Spawning (New Architecture)**
- ✅ Generates user-facing session name: `{prefix}-{num}`
- ✅ Generates tmux name: `{hash}-{prefix}-{num}`
- ✅ Writes metadata with `tmuxName` field
- ✅ Creates project-specific sessions directory
- ✅ Validates and stores `.origin` file
- ✅ Increments session numbers correctly
- ✅ Atomic session ID reservation (concurrent spawn safety)
- ✅ Session number gaps are NOT reused (always increment)
- ✅ Runtime receives tmux name, not user-facing name

**Test Suite: Session Operations**
- ✅ `get()` finds session across all projects
- ✅ `get()` returns null if session not found
- ✅ `kill()` finds session and cleans up correctly
- ✅ `send()` finds session and sends message
- ✅ Operations work in both new and legacy modes

---

## 2. Integration Tests

### 2.1 CLI-Core Integration (`packages/integration-tests/src/cli-spawn-core-read.integration.test.ts`)

**Already Exists (Update Required):**
- ✅ Update to use new hash-based paths
- ✅ Verify CLI spawn writes to project-specific directory
- ✅ Verify core session-manager reads from project-specific directory
- ✅ Test cross-project isolation

**New Tests to Add:**
- ✅ Session spawned by CLI is found by `ao list`
- ✅ Session spawned by CLI is found by `ao list <projectId>`
- ✅ Session metadata includes `tmuxName` field
- ✅ Tmux name matches expected format: `{hash}-{prefix}-{num}`
- ✅ User-facing name matches: `{prefix}-{num}`
- ✅ Multiple projects in same config work correctly
- ✅ `.origin` file created correctly
- ✅ Hash collision detection triggers error

---

### 2.2 Multi-Project Integration (`packages/integration-tests/src/multi-project.integration.test.ts`)

**Test Suite: Same Config, Multiple Projects**
- ✅ Create config with 2 projects (frontend, backend)
- ✅ Spawn session for project 1
- ✅ Spawn session for project 2
- ✅ Both sessions have same hash prefix
- ✅ Both sessions in separate directories
- ✅ `list()` returns both sessions
- ✅ `list("frontend")` returns only frontend sessions
- ✅ `list("backend")` returns only backend sessions
- ✅ Same issue ID in different projects doesn't conflict

**Test Suite: Different Configs, Same Project Name**
- ✅ Create two separate orchestrator configs
- ✅ Both manage a project named "integrator"
- ✅ Projects have different hashes
- ✅ Sessions have different tmux names (different hash prefix)
- ✅ No collisions in tmux session names
- ✅ Each orchestrator only sees its own sessions

---

### 2.3 Config Discovery Integration (`packages/integration-tests/src/config-discovery.integration.test.ts`)

**Test Suite: Directory Tree Search**
- ✅ Config in CWD is found
- ✅ Config in parent directory is found
- ✅ Config in grandparent directory is found
- ✅ Search stops at filesystem root
- ✅ Nearest config is used (not furthest)

**Test Suite: Environment Variable Override**
- ✅ `AO_CONFIG` set → uses specified config
- ✅ `AO_CONFIG` takes precedence over file search
- ✅ Invalid `AO_CONFIG` path → error

**Test Suite: Symlink Handling**
- ✅ Symlinked config file → consistent hash
- ✅ Symlink to config directory → consistent hash
- ✅ Multiple symlinks to same config → same hash

---

### 2.4 Session Lifecycle Integration (`packages/integration-tests/src/session-lifecycle.integration.test.ts`)

**Test Suite: Full Lifecycle**
- ✅ Spawn session → metadata created in correct directory
- ✅ Spawn session → tmux session created with hash-prefixed name
- ✅ List sessions → spawned session appears
- ✅ Get session → session found by user-facing name
- ✅ Send message → message delivered to tmux session
- ✅ Kill session → metadata archived, tmux destroyed

**Test Suite: Concurrent Operations**
- ✅ Spawn 2 sessions simultaneously → both succeed
- ✅ Session numbers don't conflict
- ✅ Atomic ID reservation prevents race conditions

---

### 2.5 Migration Path (`packages/integration-tests/src/migration.integration.test.ts`)

**Test Suite: Legacy to New Migration (Future)**
- ✅ Detect old flat directory structure
- ✅ Migrate sessions to project-specific directories
- ✅ Preserve all metadata fields
- ✅ Update paths in metadata
- ✅ Archive old structure
- ✅ Verify sessions work after migration

---

## 3. Edge Cases & Error Handling

### 3.1 Hash Collision
- ✅ Simulate hash collision (different configs, force same hash)
- ✅ Verify `.origin` file detects collision
- ✅ Error message is clear and actionable

### 3.2 Invalid Session Names
- ✅ Session name with path traversal attempt → rejected
- ✅ Session name with special chars → validated
- ✅ Very long session names → handled

### 3.3 Missing Directories
- ✅ Project sessions directory missing → created on spawn
- ✅ Worktrees directory missing → created on spawn
- ✅ Archive directory missing → created on archive

### 3.4 Config Errors
- ✅ No projects in config → error
- ✅ Project path doesn't exist → error (on spawn)
- ✅ Invalid project path → error
- ✅ Circular symlinks in config path → error

### 3.5 Permissions
- ✅ No write permission to ~/.agent-orchestrator → error
- ✅ No write permission to project directory → error
- ✅ Readonly metadata file → handled gracefully

---

## 4. Performance Tests

### 4.1 Scalability
- ✅ 100 sessions across 10 projects → list() performance
- ✅ 1000 sessions across 100 projects → list() performance
- ✅ Directory scanning performance with many projects
- ✅ Session number calculation with 1000+ existing sessions

### 4.2 Concurrent Access
- ✅ 10 concurrent spawns → no conflicts
- ✅ List while spawning → consistent results
- ✅ Kill while listing → no crashes

---

## 5. Backwards Compatibility Tests

### 5.1 Legacy Config Format
- ✅ Config with explicit `dataDir` and `worktreeDir` works
- ✅ Sessions created in flat directory structure
- ✅ All operations work in legacy mode
- ✅ No migration forced immediately

### 5.2 Mixed Mode
- ✅ Some projects use new arch, some use legacy (via config)
- ✅ Session manager handles both modes simultaneously
- ✅ No cross-contamination between modes

---

## 6. Documentation Tests

### 6.1 Examples
- ✅ All examples in ARCHITECTURE.md are accurate
- ✅ Directory structure examples match actual output
- ✅ Command examples work as shown

### 6.2 Migration Guide
- ✅ Step-by-step migration works
- ✅ Rollback procedure works if needed
- ✅ Migration FAQ addresses common issues

---

## Test Execution Strategy

### Phase 1: Core Unit Tests (Current Priority)
1. Implement `paths.test.ts` - All path utilities
2. Update `config.test.ts` - Config loading & validation
3. Update `metadata.test.ts` - New metadata fields
4. Update `session-manager.test.ts` - New directory logic

### Phase 2: Integration Tests
1. Update existing `cli-spawn-core-read.integration.test.ts`
2. Create `multi-project.integration.test.ts`
3. Create `config-discovery.integration.test.ts`
4. Create `session-lifecycle.integration.test.ts`

### Phase 3: Edge Cases & Performance
1. Implement edge case tests
2. Add performance benchmarks
3. Test backwards compatibility thoroughly

### Phase 4: Documentation & Migration
1. Verify all documentation examples
2. Implement migration tests
3. Create migration guide

---

## Test Coverage Goals

- **Unit Tests**: 90%+ coverage for new code
- **Integration Tests**: All critical paths covered
- **Edge Cases**: All error conditions tested
- **Performance**: Baseline established for regression testing

---

## Running Tests

```bash
# Run all tests
pnpm test

# Run only unit tests
pnpm test:unit

# Run only integration tests
pnpm test:integration

# Run with coverage
pnpm test:coverage

# Run specific test file
pnpm test paths.test.ts

# Watch mode for development
pnpm test:watch
```

---

## Success Criteria

✅ All existing tests pass with new architecture
✅ New unit tests achieve 90%+ coverage
✅ Integration tests verify end-to-end workflows
✅ Legacy configs continue to work (backwards compatibility)
✅ No breaking changes for users with explicit dataDir
✅ Performance meets or exceeds baseline
✅ Documentation examples work as written
