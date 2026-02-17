# Integration Tests

Docker-based integration tests that simulate real-world onboarding and usage scenarios.

## Onboarding Test

Tests the complete first-time developer experience:

1. Fresh environment (no prior setup)
2. Repository access
3. `./scripts/setup.sh` (install + build + link)
4. `ao init` (configuration)
5. `ao start` (dashboard + services)
6. Verify dashboard responds
7. Verify API endpoints work
8. Measure total onboarding time

### Run Locally

```bash
cd tests/integration
docker-compose up --build
```

### Run Manually (for debugging)

```bash
# Build image
docker-compose build

# Run container interactively
docker-compose run --rm onboarding-test /bin/bash

# Inside container, run test manually
/workspace/agent-orchestrator/tests/integration/onboarding-test.sh
```

### Expected Results

- **Total time**: < 180s (3 minutes) for fresh install
- **All steps pass**: ✓ green checkmarks
- **Dashboard accessible**: http://localhost:4000

### Metrics Tracked

- Setup time (pnpm install + build)
- Dashboard startup time
- API response time
- Total onboarding time

### CI Integration

The test runs automatically on:
- Pull requests (when packages/ or scripts/ change)
- Pushes to main branch

View results: `.github/workflows/onboarding-test.yml`

## Future Tests

- **Multi-project test**: Verify multiple projects in one config
- **Port conflict test**: Verify auto-port-selection
- **Config discovery test**: Verify config found from subdirectories
- **Session spawn test**: Verify `ao spawn` creates working sessions
- **Terminal test**: Verify WebSocket terminal connection
- **Upgrade test**: Verify upgrade from previous version

## Adding New Tests

1. Create test script in `tests/integration/<test-name>.sh`
2. Add to `docker-compose.yml` as new service
3. Add to `.github/workflows/integration-tests.yml`
4. Document expected behavior and metrics

## Troubleshooting

**Test fails at setup step:**
- Check `scripts/setup.sh` for errors
- Verify pnpm is installed in Dockerfile

**Dashboard doesn't start:**
- Check port 4000 is not already in use
- Verify `pnpm dev` runs all required services
- Check dashboard logs: `docker logs ao-onboarding-test`

**Test times out:**
- Increase timeout in `docker-compose.yml`
- Check if any step hangs (tmux, npm link, etc.)
