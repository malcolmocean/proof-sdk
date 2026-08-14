# Agent Contract: Direct Markdown Sharing

This contract defines the public Proof SDK flow for creating and operating on shared documents over HTTP.

## Endpoints

Canonical route:

`POST /documents`

Compatibility alias:

`POST /share/markdown`

Legacy internal route:

`POST /api/documents`

## Request Formats

### JSON

```http
POST /documents HTTP/1.1
Content-Type: application/json
Authorization: Bearer <apiKey>   # when API-key auth is enabled
```

```json
{
  "markdown": "# Plan\n\nShip the rewrite.",
  "title": "Rewrite Plan",
  "role": "commenter",
  "ownerId": "agent:claude"
}
```

### Raw markdown

```http
POST /documents?title=Rewrite%20Plan&role=commenter HTTP/1.1
Content-Type: text/markdown
Authorization: Bearer <apiKey>   # when API-key auth is enabled
```

````markdown
# Plan

Ship the rewrite.
````

## Response

```json
{
  "success": true,
  "slug": "abc123xy",
  "docId": "b9d9f8e8-5a4e-4af8-a9d4-5e0ecf7ff4ab",
  "url": "/d/abc123xy",
  "shareUrl": "https://your-proof.example/d/abc123xy",
  "tokenPath": "/d/abc123xy?token=...",
  "tokenUrl": "https://your-proof.example/d/abc123xy?token=...",
  "ownerSecret": "8b5f...owner secret...",
  "accessToken": "4d53...link token...",
  "accessRole": "commenter",
  "active": true,
  "shareState": "ACTIVE",
  "snapshotUrl": "https://your-proof.example/snapshots/abc123xy.html",
  "createdAt": "2026-02-12T16:10:00.000Z",
  "_links": {
    "view": "/d/abc123xy",
    "state": "/documents/abc123xy/state",
    "ops": { "method": "POST", "href": "/documents/abc123xy/ops" },
    "events": "/documents/abc123xy/events/pending?after=0",
    "docs": "/agent-docs"
  }
}
```

## Token Semantics

- `ownerSecret`
  - Full-owner credential for that document
  - Can pause, resume, revoke, delete, and perform owner-level agent actions
  - Store securely and do not expose in user-facing UI
- `accessToken`
  - Scoped link credential for `viewer`, `commenter`, or `editor`
  - Use this token for non-owner operations where possible
  - If you need a tokenized share URL, use `tokenUrl`

## Authentication Model

`PROOF_SHARE_MARKDOWN_AUTH_MODE` controls direct-share auth:

- `none`: open route, good for local/dev
- `api_key`: require `PROOF_SHARE_MARKDOWN_API_KEY`
- `auto`: resolve to `none` by default in Proof SDK

`/api/documents` is governed separately by `PROOF_LEGACY_CREATE_MODE`:

- `allow`
- `warn`
- `disabled`
- `auto`

## Minimal Agent Flow

1. `POST /documents`
2. Persist `ownerSecret` securely
3. Return `shareUrl` to the user
4. Use `accessToken` or `ownerSecret` for follow-up operations

## Read + Operate Contract

### Read state

- `GET /documents/:slug/state`
- `GET /api/documents/:slug/open-context`
- `GET /api/documents/:slug/collab-session`
- `GET /api/documents/:slug/info`

### Mutation endpoint

Use `POST /documents/:slug/ops` with:

- `type: "comment.add"`
- `type: "comment.reply"`
- `type: "comment.resolve"`
- `type: "suggestion.add"`
- `type: "suggestion.accept"`
- `type: "suggestion.reject"`
- `type: "rewrite.apply"`

Send `Idempotency-Key` on mutation requests so retries stay safe.

### Event polling

- Poll: `GET /documents/:slug/events/pending?after=<id>&limit=<n>`
- Ack: `POST /documents/:slug/events/ack`

## Blind Review Mode

Create a document with `"blindMode": true` to run an independent (blind)
review: until the owner reveals, each reviewer — human or agent — only sees
their own comments, suggestions, flags, and approvals. The document owner
sees everything throughout.

- Identity is the mark's `by` value, matched case-insensitively and ignoring
  the `human:`/`ai:` prefix. Send a consistent `by` (or `X-Agent-Id`) on
  writes and reads.
- Filtered reads: `GET .../state`, `GET .../marks`, `GET /api/documents/:slug`,
  mutation response echoes, and `events/pending` (other reviewers' comment
  events are withheld pre-reveal; the cursor still advances).
- Bulk `PUT /api/documents/:slug` with a `marks` map cannot delete or modify
  marks hidden from the writer; they are preserved server-side.
- Reveal: `POST /api/documents/:slug/reveal` (owner secret required). Toggle:
  `POST /api/documents/:slug/blind-mode` with `{"enabled": true|false}`.
- State responses include `blindMode` and `revealedAt` so agents can tell
  which regime they are reading under.

Blind mode is a workflow convention for trusted collaborators, not a
security boundary: live collab websocket sync still carries the full marks
map to browser clients, which hide other reviewers' marks at render time.

## Collab Session Lifecycle

1. Resolve open context and capabilities
2. Join collab with `session.collabWsUrl` and `session.token`
3. Refresh with `POST /api/documents/:slug/collab-refresh` before token expiry
4. Reconnect using the refreshed token

## CLI Example

```bash
curl -X POST http://localhost:4000/documents \
  -H "Content-Type: application/json" \
  -d '{"markdown":"# Plan\n\nShip the rewrite.","title":"Rewrite Plan","role":"commenter"}'
```
