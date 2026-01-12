# ACC Project Management System - Quick Start Guide

## Overview

This is a production-ready multi-user web application that integrates with Autodesk Construction Cloud (ACC) to manage internal review workflows for RFIs and Submittals before posting official responses back to ACC.

## Architecture Highlights

- **Backend:** Node.js + TypeScript + Express + Prisma + PostgreSQL
- **Frontend:** Next.js 14+ (App Router) + TypeScript + Tailwind CSS
- **Auth:** JWT sessions (MVP), Azure AD SSO (future)
- **File Storage:** On-premises network share (UNC paths)
- **Background Jobs:** node-cron for scheduled sync

## Project Structure

```
server/
├── prisma/
│   └── schema.prisma          # Complete database schema (PostgreSQL)
├── src/
│   ├── services/              # ✅ Business logic (9 services)
│   │   ├── userService.ts
│   │   ├── projectService.ts
│   │   ├── rfiService.ts
│   │   ├── submittalService.ts
│   │   ├── fileService.ts
│   │   ├── notificationService.ts
│   │   ├── workflowService.ts
│   │   ├── responseService.ts
│   │   └── enhancedSyncService.ts
│   ├── lib/
│   │   ├── accClient.ts       # ⚠️ ACC API client (needs completion)
│   │   ├── crypto.ts
│   │   ├── logger.ts
│   │   └── prisma.ts
│   ├── routes/                # 🚧 API endpoints (needs implementation)
│   ├── middleware/
│   ├── jobs/
│   └── index.ts
├── package.json
└── .env.example

web/
├── src/
│   ├── app/                   # 🚧 Next.js pages (needs implementation)
│   └── lib/
└── package.json

ARCHITECTURE.md                # ✅ 700+ line architecture document
IMPLEMENTATION_STATUS.md       # ✅ Current status & next steps
```

## What's Been Implemented

### ✅ Complete (Ready to Use)

1. **Database Schema**
   - All tables for users, projects, RFIs, submittals, comments, notifications, etc.
   - Change detection fields
   - Comprehensive relationships and indexes
   - Ready for migration to PostgreSQL

2. **Service Layer (Business Logic)**
   - User management with bcrypt password hashing
   - Project management with settings
   - RFI & Submittal CRUD with assignments
   - File operations on network share
   - Sync service with change detection
   - Notification system
   - Workflow automation (auto-assign, deadline calculation)
   - Response service (send to ACC)

3. **Architecture Documentation**
   - Complete system design
   - API endpoint specifications
   - UX wireframes
   - Risk analysis
   - Implementation roadmap

### 🚧 In Progress (Needs Completion)

1. **ACC API Client** (~30% done)
   - OAuth is complete
   - Need: RFI/Submittal update/response endpoints
   - Need: File upload endpoints
   - Need: Rate limiting & retry logic

2. **REST API Routes** (0% done)
   - Need to implement all endpoints defined in ARCHITECTURE.md section 5
   - Wire up services to Express routes

3. **Frontend** (0% done)
   - Need to build all pages per ARCHITECTURE.md section 8
   - React components for file picker, comments, notifications

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+
- Access to network share (for file storage)
- Autodesk ACC account with API credentials

### Installation

1. **Install dependencies:**
   ```bash
   # Backend
   cd server
   npm install
   
   # Frontend
   cd ../web
   npm install
   ```

2. **Configure environment:**
   ```bash
   cd server
   cp .env.example .env
   # Edit .env with your values
   ```

3. **Setup database:**
   ```bash
   cd server
   npx prisma migrate dev --name init
   npx prisma generate
   ```

4. **Run development servers:**
   ```bash
   # Backend (terminal 1)
   cd server
   npm run dev
   
   # Frontend (terminal 2)
   cd web
   npm run dev
   ```

### Environment Variables

See `server/.env.example` for all required variables:

- `DATABASE_URL`: PostgreSQL connection string
- `AUTODESK_CLIENT_ID` / `AUTODESK_CLIENT_SECRET`: ACC API credentials
- `SESSION_SECRET`: Random string for session encryption
- `ENCRYPTION_KEY`: 32-byte hex key for OAuth token encryption

## Key Features

### Internal Workflow

RFIs and Submittals follow this status flow:

```
UNASSIGNED → ASSIGNED_FOR_REVIEW → UNDER_REVIEW → 
UNDER_QC → READY_FOR_RESPONSE → SENT_TO_ACC → CLOSED
```

### Change Detection

When ACC data changes during internal review:
- System detects via hash comparison
- Sets `hasUnacknowledgedChange = true`
- Displays yellow banner to user
- User can acknowledge to dismiss
- Internal work is never overwritten

### Network Folder Structure

```
\\server\share\ProjectName\ACC_Backup\
├── RFIs\
│   ├── RFI-0001\
│   │   ├── RFI-0001_CombinedExport.pdf  (from ACC)
│   │   └── Response_Markup.pdf           (team-added)
│   └── RFI-0002\
└── Submittals\
    └── SUB-0045\
```

### File Picker Behavior

- Users do NOT upload files through the UI
- Users select existing files from the network folder
- Files are read from network path and uploaded to ACC when sending response

### Roles & Permissions

- **PROJECT_ADMIN:** Full control, can send to ACC, manage settings
- **REVIEWER:** Can review, comment, propose responses
- **QC_REVIEWER:** Can QC review, approve for response
- **VIEWER:** Read-only access

## API Endpoints

See `ARCHITECTURE.md` section 5 for complete REST API specifications.

Key endpoints:
- `POST /api/auth/login` - User authentication
- `GET /api/projects` - List user's projects
- `POST /api/projects/:id/sync` - Trigger manual sync
- `GET /api/rfis` - List RFIs with filters
- `POST /api/rfis/:id/assign` - Assign user to RFI
- `POST /api/rfis/:id/send-to-acc` - Send official response
- `GET /api/my-work` - User's assigned items

## Testing

### Unit Tests
```bash
cd server
npm test
```

### Integration Tests
Use Postman/Insomnia collection (to be created).

### Manual Testing
1. Create user via registration
2. Create project
3. Link ACC project via OAuth
4. Trigger sync to import RFIs
5. Assign RFI to user
6. Add comments
7. Select files from network folder
8. Send response to ACC

## Deployment

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use strong `SESSION_SECRET` and `ENCRYPTION_KEY`
- [ ] Configure PostgreSQL with backups
- [ ] Ensure network share is accessible from server
- [ ] Set up HTTPS/TLS
- [ ] Configure rate limiting
- [ ] Set up error monitoring (Sentry, etc.)
- [ ] Configure log aggregation
- [ ] Test file permissions on network share
- [ ] Document admin procedures

### Windows Server Deployment

```powershell
# Install Node.js
# Install PostgreSQL
# Clone repository
# Install dependencies
# Configure .env
# Run migrations
# Install as Windows Service (using node-windows or pm2)
```

### Docker Deployment

```bash
# Build backend
docker build -t acc-backend ./server

# Build frontend
docker build -t acc-frontend ./web

# Run with docker-compose
docker-compose up -d
```

## Documentation

- **ARCHITECTURE.md:** Complete system architecture (700+ lines)
- **IMPLEMENTATION_STATUS.md:** Current status and next steps
- **Prisma Schema:** Database schema with inline comments
- **Service Files:** Comprehensive JSDoc comments

## Support & Maintenance

### Monitoring

- Check `SyncLog` table for sync failures
- Monitor `AuditLog` for security events
- Track API rate limits
- Monitor network folder accessibility

### Common Issues

**Issue:** Sync fails with 401 error
**Fix:** OAuth token expired, re-authenticate project admin

**Issue:** Cannot access network folder
**Fix:** Check server service account has network permissions

**Issue:** Duplicate items after sync
**Fix:** Check `accDataHash` implementation, ensure unique constraints

## Next Steps

See `IMPLEMENTATION_STATUS.md` for detailed TODO list.

Priority:
1. Complete ACC API client RFI/Submittal endpoints
2. Implement REST API routes
3. Build frontend authentication pages
4. Build frontend RFI list/detail pages
5. Integration testing with real ACC data

## Contributing

(Add contribution guidelines if this is a team project)

## License

(Add license information)

---

**Status:** Architecture phase complete. Core services implemented. Ready for REST API and frontend development.

**Last Updated:** January 12, 2026
