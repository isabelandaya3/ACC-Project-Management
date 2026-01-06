# ACC Integration MVP

A proof-of-concept web application for integrating with Autodesk Construction Cloud (ACC) using Autodesk Platform Services (APS) 3-legged OAuth.

## Features

- ✅ 3-legged OAuth authentication with Autodesk
- ✅ List ACC hubs/accounts and projects
- ✅ Poll for RFIs/Submittals (stubbed - ready for implementation)
- ✅ Download attachments (stubbed)
- ✅ Upload files to ACC Docs
- ✅ Automatic token refresh
- ✅ Background polling with node-cron
- ✅ Idempotent ingestion tracking

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Next.js UI    │────▶│  Express API    │────▶│  Autodesk APS   │
│   (port 3000)   │     │   (port 3001)   │     │                 │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                        ┌────────▼────────┐
                        │  Prisma + DB    │
                        │ (SQLite/Postgres)│
                        └─────────────────┘
```

## Prerequisites

- Node.js 18+
- npm or yarn
- Autodesk Platform Services (APS) application

## Autodesk App Configuration

1. Go to [Autodesk Platform Services](https://aps.autodesk.com/)
2. Create a new application
3. Set the following:
   - **Application Type**: Web App
   - **Callback URL**: `http://localhost:3001/auth/callback`
   - **Scopes Required**:
     - `data:read`
     - `data:write`
     - `data:create`
     - `account:read`
     - `user:read`
     - `user-profile:read`

4. Note your **Client ID** and **Client Secret**

## Environment Variables

Create `.env` files in both `/server` and `/web` directories:

### Server (`/server/.env`)

```env
# Server
PORT=3001
WEB_ORIGIN=http://localhost:3000

# Database (SQLite for local dev)
DATABASE_URL="file:./dev.db"
# For Postgres:
# DATABASE_URL="postgresql://user:password@localhost:5432/acc_integration"

# Autodesk APS
AUTODESK_CLIENT_ID=your_client_id_here
AUTODESK_CLIENT_SECRET=your_client_secret_here
AUTODESK_CALLBACK_URL=http://localhost:3001/auth/callback

# Token encryption (generate with: openssl rand -hex 32)
TOKEN_ENCRYPTION_KEY=your_32_plus_character_encryption_key_here

# Optional defaults for testing
DEFAULT_PROJECT_ID=
DEFAULT_DOCS_FOLDER_URN=

# Logging
LOG_LEVEL=debug
```

### Web (`/web/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Installation

```bash
# Install all dependencies
npm run install:all

# Or manually:
cd shared && npm install && npm run build && cd ..
cd server && npm install && cd ..
cd web && npm install && cd ..
```

## Database Setup

```bash
cd server

# Generate Prisma client
npx prisma generate

# Run migrations (creates SQLite file for local dev)
npx prisma migrate dev --name init

# Optional: View database with Prisma Studio
npx prisma studio
```

## Running the Application

### Development Mode

```bash
# Terminal 1 - Start backend
cd server
npm run dev

# Terminal 2 - Start frontend
cd web
npm run dev
```

### Production Build

```bash
# Build all
npm run build:all

# Start server
cd server && npm start

# Start web (or deploy to Vercel)
cd web && npm start
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/auth/login` | Redirect to Autodesk OAuth |
| GET | `/auth/callback` | OAuth callback handler |
| GET | `/auth/logout` | Clear session |
| GET | `/api/me` | Get current user info |
| GET | `/api/projects` | List hubs and projects |
| POST | `/api/sync/run` | Trigger manual sync |
| POST | `/api/upload-test` | Test file upload to ACC |

## Testing the Integration

### 1. Authenticate

1. Open `http://localhost:3000`
2. Click "Connect Autodesk"
3. Log in with your Autodesk account
4. Authorize the application

### 2. List Projects

After authentication, the UI will display your ACC hubs and projects.

### 3. Test Sync

1. Select a project
2. Click "Run Sync Now"
3. View the sync results in the UI

### 4. Test Upload

```bash
# Create a test file
echo "Test content" > ./storage/test-upload.txt

# Trigger upload via API (with valid session)
curl -X POST http://localhost:3001/api/upload-test \
  -H "Content-Type: application/json" \
  -d '{"projectId": "your-project-id", "folderUrn": "your-folder-urn"}'
```

## Project Structure

```
├── server/                 # Express backend
│   ├── src/
│   │   ├── config/        # Configuration
│   │   ├── lib/           # Core libraries
│   │   │   ├── accClient.ts    # ACC API wrapper
│   │   │   ├── crypto.ts       # Token encryption
│   │   │   ├── logger.ts       # Pino logger
│   │   │   └── prisma.ts       # Database client
│   │   ├── middleware/    # Express middleware
│   │   ├── routes/        # API routes
│   │   ├── services/      # Business logic
│   │   ├── jobs/          # Background jobs
│   │   └── index.ts       # Entry point
│   ├── prisma/
│   │   └── schema.prisma  # Database schema
│   └── storage/           # Local file storage
│
├── web/                    # Next.js frontend
│   ├── src/
│   │   ├── app/           # App router pages
│   │   ├── components/    # React components
│   │   └── lib/           # Utilities
│   └── ...
│
└── shared/                 # Shared TypeScript types
    └── src/
        └── types/
```

## Database Schema

### Key Tables

- **AuthToken**: Stores encrypted OAuth tokens per user
- **SyncCursor**: Tracks polling progress per project/module
- **IngestedItem**: Tracks ingested items for idempotency
- **SyncLog**: Audit log of sync operations

## Security Notes

1. **Tokens are encrypted** at rest using AES-256-GCM
2. **Refresh tokens** are stored encrypted, never exposed to frontend
3. **OAuth state parameter** is validated to prevent CSRF
4. **Session cookies** are HTTP-only and secure in production

## Development Notes

### Adding New ACC Modules

1. Add interface in `shared/src/types/acc.ts`
2. Add stub/implementation in `server/src/lib/accClient.ts`
3. Update sync service in `server/src/services/syncService.ts`

### Switching to Postgres

1. Update `DATABASE_URL` in `.env`
2. Update `provider` in `prisma/schema.prisma` to `postgresql`
3. Run `npx prisma migrate dev`

## Troubleshooting

### "Invalid grant" error
- Token may have expired. Re-authenticate via `/auth/login`

### "Access denied" error
- Check that your Autodesk app has the required scopes
- Ensure you have access to the ACC account

### Database errors
- Run `npx prisma generate` after schema changes
- Run `npx prisma migrate dev` to apply migrations

## License

MIT
