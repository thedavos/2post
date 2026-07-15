---
name: tenant-safe-django
description: >-
  Implements org/workspace-scoped Django queries, permissions, and encrypted
  credentials for 2post multi-tenancy. Use when writing models, views, API/MCP
  handlers, client portal routes, or fixing cross-tenant data leaks.
---

# Tenant-safe Django

## Query scoping

```python
# ✅
Post.objects.for_workspace(workspace_id).filter(...)
MyModel.objects.for_org(organization_id).get(pk=...)

# ❌ — unscoped then filter ad hoc without membership proof
Post.objects.filter(id=client_supplied_id)
```

- Prefer `OrgScopedModel` / `WorkspaceScopedModel` or the managers in `apps/common/managers.py`.
- After fetching by PK, assert the object belongs to the current org/workspace (or use scoped get).
- Membership / RBAC: follow patterns in `apps/members` and existing view decorators. Client portal uses separate auth (`apps/client_portal`) — never reuse staff session assumptions.

## API & MCP

- REST (`apps/api`) and MCP (`apps/mcp`) handlers receive workspace context from the API key — re-check permissions the same way in both.
- Do not accept raw `organization_id` / `workspace_id` from the client to widen scope.

## Secrets

- Platform credentials and tokens: `EncryptedJSONField` / encryption helpers in `apps/common/encryption.py`.
- Never print or log credential dicts, Authorization headers, or magic-link secrets.

## Review gate

Before finishing: grep the diff for `.objects.get(`, `.objects.filter(`, and template queries that omit workspace/org constraints.
