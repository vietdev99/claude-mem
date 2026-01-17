# Claude-Mem Project Context

## Overview
Claude-Mem is a persistent memory system for Claude Code/AI assistants. This project aims to deploy it as a SaaS with account-level features.

## Project Structure
```
ClaudeMem/
├── server/          # Claude-mem backend (from github.com/thedotmack/claude-mem)
│   ├── src/         # TypeScript source
│   │   ├── cli/           # CLI handlers (hooks)
│   │   ├── servers/       # MCP server
│   │   ├── services/      # Core services
│   │   │   ├── server/    # Express server
│   │   │   ├── sqlite/    # Database layer
│   │   │   ├── worker/    # Background workers
│   │   │   └── sync/      # Chroma sync
│   │   └── ui/            # Web viewer
│   ├── scripts/     # Build & utility scripts
│   └── docs/        # Documentation
│
└── client/          # VSCode Extension
    ├── extension.js # Extension code
    └── package.json # Manifest
```

## Key Technical Details

### Server (Port 37777)
- **Runtime**: Bun (fast JS runtime)
- **Database**: SQLite + ChromaDB (vector search)
- **API Framework**: Express.js

### Key API Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/sessions/init` | POST | Initialize session (required first) |
| `/api/sessions/observations` | POST | Save observation |
| `/api/observations` | GET | List observations |
| `/api/observations/batch` | POST | Batch fetch by IDs |

### Session Flow (Required Order)
1. **Init Session**: `POST /api/sessions/init`
   ```json
   {
     "contentSessionId": "unique-session-id",
     "project": "project-name",
     "prompt": "user prompt text"
   }
   ```

2. **Save Observation**: `POST /api/sessions/observations`
   ```json
   {
     "contentSessionId": "same-session-id",
     "tool_name": "Tool-Name",
     "tool_input": { ... },
     "tool_response": "response text",
     "cwd": "D:/path/to/project"
   }
   ```

### Privacy Check
- Observations are skipped if user prompt is empty/private
- Returns: `{"status":"skipped","reason":"private"}`

## VSCode Extension

### Commands
- `Claude-Mem: Save Context` - Manual context save
- `Claude-Mem: Open Viewer` - Open web UI
- `Claude-Mem: Start Worker` - Start background worker

### Keybinding
- `Ctrl+Alt+M` - Quick save context

### Status Bar
- Shows worker status (running/offline)
- Click to open web viewer

## Planned Features (Account Levels)

### Free Tier
- Limited observations per month
- Local storage only
- Single user

### Pro Tier
- Unlimited observations
- Cloud sync
- Cross-device access
- Priority support

### Team Tier
- Multi-user support
- Shared memories/knowledge base
- Team analytics
- Admin controls

## Dependencies

### Server
- Bun v1.3.6+
- SQLite (better-sqlite3)
- ChromaDB (vector embeddings)
- Express.js

### Client
- VSCode ^1.85.0
- Node.js http module

## Development Commands

### Server
```bash
cd server
bun install
bun run build
bun run scripts/worker-service.cjs start
```

### Client
```bash
cd client
npx @vscode/vsce package --allow-missing-repository
code --install-extension claude-mem-hooks-1.0.0.vsix
```

## Configuration Files

### Server paths (Windows)
- Database: `~/.claude-mem/claude-mem.db`
- Chroma: `~/.claude-mem/chroma/`
- Logs: `~/.claude-mem/logs/`

### Client paths
- Extension: `~/.vscode/extensions/local.claude-mem-hooks-1.0.0/`

## Web Viewer
- URL: `http://localhost:37777`
- Features: Timeline, search, observations list, summaries

## Notes
- Worker must be running for API to work
- Session must be initialized before saving observations
- Tool names affect filtering (some may be skipped)
