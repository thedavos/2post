# PR ready

Prepare this branch for a pull request.

## Steps

1. Summarize what changed and why (user-facing impact first).
2. Run or report how to run:
   - `ruff check .` and `ruff format --check .`
   - `mypy apps/ config/ providers/ tests/ --ignore-missing-imports`
   - `pytest` (or the narrowest relevant path)
3. Scan the diff for:
   - queries missing `for_org` / `for_workspace`
   - secrets or tokens in logs/fixtures
   - provider call sites that skip `resolve_platform_credentials`
4. Draft PR title (conventional: `feat(scope):`, `fix(scope):`) and body using `.github/pull_request_template.md`:
   - What / Why / How to test / Checklist
5. List leftover risks or manual test steps (OAuth, publish, analytics) if automated coverage is thin.

Do not push or open the PR unless the user asks.
