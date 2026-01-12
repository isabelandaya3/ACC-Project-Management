# ACC Project Management System - Architecture & Implementation Guide

## Executive Summary

This document provides the comprehensive architecture for a multi-user web application that integrates with Autodesk Construction Cloud (ACC) to manage internal review workflows for RFIs and Submittals before posting official responses back to ACC.

---

## 1. SYSTEM ARCHITECTURE

### 1.1 Technology Stack

**Backend:**
- **Framework:** Express.js (chosen for maturity, middleware ecosystem, and team familiarity)
- **Language:** TypeScript 5.x
- **Database:** PostgreSQL with Prisma ORM
- **Authentication:** JWT-based sessions, future Azure AD/Entra SSO
- **Background Jobs:** node-cron for scheduled sync jobs
- **File Operations:** Native Node.js fs module for network share access
- **Logging:** Pino (structured logging)

**Frontend:**
- **Framework:** Next.js 14+ (App Router)
- **Language:** TypeScript
- **State Management:** React Context + hooks
- **UI Components:** Tailwind CSS + Radix UI or shadcn/ui
- **Data Fetching:** React Query (TanStack Query)

**Infrastructure:**
- **OAuth:** 3-legged OAuth 2.0 with ACC (per project admin)
- **File Storage:** On-premises network share (UNC paths)
- **Deployment:** Windows Server or Docker containers

### 1.2 Service Architecture

The backend is organized into modular services with clear boundaries:

```
┌─────────────────────────────────────────────────────────────┐
│                      API Layer (Express)                     │
│  ┌──────────┬──────────┬──────────┬──────────┬───────────┐ │
│  │   Auth   │   API    │  Health  │   ACC    │  WebSocket│ │
│  │  Routes  │  Routes  │  Routes  │  OAuth   │  (future) │ │
│  └──────────┴──────────┴──────────┴──────────┴───────────┘ │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────────┐
│                    Service Layer                             │
│  ┌─────────────────┬──────────────────┬──────────────────┐ │
│  │  User Service   │ Project Service  │  RFI Service     │ │
│  │  - Auth         │ - Settings       │  - CRUD          │ │
│  │  - Permissions  │ - Membership     │  - Assignments   │ │
│  │  - Roles        │ - Configuration  │  - Comments      │ │
│  └─────────────────┴──────────────────┴──────────────────┘ │
│  ┌─────────────────┬──────────────────┬──────────────────┐ │
│  │Submittal Service│  Sync Service    │ Workflow Service │ │
│  │  - CRUD         │  - ACC Polling   │  - Status Trans. │ │
│  │  - Assignments  │  - Change Detect │  - Deadlines     │ │
│  │  - Comments     │  - File Download │  - Auto-assign   │ │
│  └─────────────────┴──────────────────┴──────────────────┘ │
│  ┌─────────────────┬──────────────────┬──────────────────┐ │
│  │  File Service   │Notification Svc  │  ACC API Client  │ │
│  │  - Network FS   │  - In-app notifs │  - OAuth         │ │
│  │  - File Picker  │  - Email (future)│  - RFI API       │ │
│  │  - Validation   │  - Push (future) │  - Submittal API │ │
│  └─────────────────┴──────────────────┴──────────────────┘ │
│  ┌─────────────────┬──────────────────┬──────────────────┐ │
│  │  Audit Service  │  Export Service  │ Response Service │ │
│  │  - Action Log   │  - Excel Export  │  - Send to ACC   │ │
│  │  - History      │  - PDF Export    │  - File Upload   │ │
│  │  - Compliance   │  - Reports       │  - Validation    │ │
│  └─────────────────┴──────────────────┴──────────────────┘ │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────────┐
│              Data Layer (Prisma + PostgreSQL)                │
│  - Users, Projects, ProjectMembership                        │
│  - RFIs, Submittals, Assignments                             │
│  - Comments, Notifications, Attachments                      │
│  - StatusHistory, AuditLog, SyncCursor                       │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│            External Integrations                              │
│  ┌────────────────┬─────────────────┬──────────────────┐    │
│  │  ACC API       │ Network Share   │ Email (future)   │    │
│  │  - OAuth       │ - UNC Paths     │ - SMTP           │    │
│  │  - RFIs        │ - Read/Write    │ - Notifications  │    │
│  │  - Submittals  │ - File Listing  │                  │    │
│  └────────────────┴─────────────────┴──────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. DATABASE SCHEMA OVERVIEW

**Key Tables:**
- `User` - Internal app users (email/password, future SSO)
- `Project` - Internal project representation with settings
- `ProjectMembership` - User-project associations with roles
- `AccOAuthToken` - ACC OAuth tokens (encrypted)
- `AccProjectLink` - Links internal project to ACC project
- `Rfi` / `Submittal` - Core entities synced from ACC
- `RfiAssignment` / `SubmittalAssignment` - User assignments
- `Attachment` - File metadata with network paths
- `Comment` - Threaded internal discussions
- `Notification` - In-app notifications
- `StatusHistory` - Audit trail of changes
- `AuditLog` - Comprehensive action logging
- `SyncCursor` - Tracks last sync position
- `SyncLog` - Sync job execution logs

**Schema Features:**
- Change detection via `accDataHash` and `hasUnacknowledgedChange`
- Polymorphic relationships (RFI/Submittal → Comment/Attachment)
- JSON fields for flexible configuration
- Comprehensive indexing for performance
- Soft deletes via `isDeleted` flag

---

## 3. ACC API CLIENT LAYER

### 3.1 Module Structure

```typescript
// lib/accClient.ts
├── OAuth Functions
│   ├── getAuthorizationUrl()
│   ├── exchangeCodeForTokens()
│   ├── refreshAccessToken()
│   └── getValidToken() // Auto-refresh if expired
├── RFI Module
│   ├── listRFIs()
│   ├── getRFI()
│   ├── updateRFIStatus()
│   ├── postRFIResponse()
│   └── exportRFIPdf() // Combined PDF export
├── Submittal Module
│   ├── listSubmittals()
│   ├── getSubmittal()
│   ├── updateSubmittalStatus()
│   ├── postSubmittalResponse()
│   └── exportSubmittalPdf()
└── Attachment Module
    ├── listAttachments()
    ├── downloadAttachment()
    ├── uploadAttachment()
    └── getAttachmentMetadata()
```

### 3.2 Rate Limiting & Error Handling

**Strategy:**
- Implement exponential backoff with jitter
- Respect `Retry-After` headers
- Queue requests during rate limit windows
- Log all API errors with context
- Implement circuit breaker pattern for resilience

```typescript
// lib/accClient.ts - Rate limiting example
const rateLimiter = {
  maxRetries: 3,
  backoffMs: 1000,
  async executeWithRetry(fn: () => Promise<any>) {
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (error.response?.status === 429) {
          const retryAfter = error.response.headers['retry-after'];
          await sleep(retryAfter * 1000 || this.backoffMs * Math.pow(2, i));
        } else {
          throw error;
        }
      }
    }
  }
};
```

### 3.3 Export Combined PDF Strategy

ACC provides an "Export" feature that generates a combined PDF of all attachments. Implementation options:

**Option A: Use ACC Export API** (if available)
```typescript
async function exportRFIPdf(rfiId: string, accessToken: string): Promise<Buffer> {
  // Call ACC export endpoint
  const response = await axios.post(
    `${ACC_API_BASE}/rfis/${rfiId}/export`,
    { format: 'pdf', includeAttachments: true },
    { headers: { Authorization: `Bearer ${accessToken}` }, responseType: 'arraybuffer' }
  );
  return Buffer.from(response.data);
}
```

**Option B: Generate Combined PDF** (fallback)
- Download all attachments individually
- Use pdf-lib or similar to merge PDFs
- Generate cover page with RFI metadata

---

## 4. SYNC ALGORITHM SPECIFICATION

### 4.1 Sync Triggers

1. **Scheduled (Cron):** Every N minutes (configurable per project, default 15 min)
2. **Manual:** Project admin triggers sync via UI button
3. **Project Open:** When admin opens project in UI, trigger immediate sync

### 4.2 Sync Flow

```
┌─────────────────────────────────────────────────────────────┐
│ START SYNC                                                   │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Get Project & ACC Link (including OAuth token)           │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Refresh Access Token (if expired)                        │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Fetch RFIs/Submittals from ACC API                       │
│    - Use pagination if needed                                │
│    - Filter by updatedAt > lastSeenAt (if supported)        │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. For Each Item:                                            │
│    a. Calculate accDataHash                                  │
│    b. Check if exists in DB                                  │
│    c. Compare hash to detect changes                         │
│    d. If changed:                                            │
│       - Set hasUnacknowledgedChange = true                   │
│       - Generate changesSummary JSON                         │
│       - Update lastAccChangeAt                               │
│    e. UPSERT item (preserve internal fields)                 │
│    f. Create StatusHistory entry if changed                  │
│    g. Download export PDF to network folder                  │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Update SyncCursor with lastSeenAt = now()                │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Create SyncLog entry with results                         │
│    - itemsProcessed, newItems, updatedItems, errors          │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Update AccProjectLink.lastSyncStatus                      │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ END SYNC                                                     │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 Change Detection & User Notification

**Change Detection:**
```typescript
// Hash relevant ACC fields
const accDataHash = crypto.createHash('sha256')
  .update(JSON.stringify({
    status: accRfi.status,
    dueDate: accRfi.dueDate,
    title: accRfi.title,
    priority: accRfi.priority,
    // ... other fields
  }))
  .digest('hex');

// Compare with existing
if (existing && existing.accDataHash !== accDataHash) {
  // ACC data changed!
  const changes = {
    status: { old: existing.accStatus, new: accRfi.status },
    dueDate: { old: existing.accDueDate, new: accRfi.dueDate },
    // ...
  };
}
```

**User-Facing Behavior:**
- Items with `hasUnacknowledgedChange = true` display a **yellow banner** in the UI
- Banner shows: "ACC Updated • Status changed: Draft → Open • Due date changed"
- User clicks "X" or "Acknowledge" to dismiss → sets `hasUnacknowledgedChange = false`
- Internal comments, assignments, draft responses are **never overwritten**
- StatusHistory table records all changes for audit trail

### 4.4 Concurrency Safeguards

**Principles:**
- Sync updates **only ACC-sourced fields** (`acc*` prefix in schema)
- Internal workflow fields are **never touched by sync**:
  - `internalStatus`
  - `responseStatus`
  - `responseText`
  - `reviewDeadline` (unless recalculated on assignment change)
  - Assignments
  - Comments
- Use database transactions for multi-step updates
- Implement optimistic locking if users can edit simultaneously

---

## 5. REST API ENDPOINTS

### 5.1 Authentication

```
POST   /api/auth/register          # Create new user (MVP)
POST   /api/auth/login             # Email/password login
POST   /api/auth/logout            # Clear session
GET    /api/auth/me                # Get current user
GET    /api/auth/acc/authorize     # Redirect to ACC OAuth
GET    /api/auth/acc/callback      # ACC OAuth callback
```

### 5.2 Projects

```
GET    /api/projects               # List user's projects
POST   /api/projects               # Create project
GET    /api/projects/:id           # Get project details
PATCH  /api/projects/:id           # Update project settings
DELETE /api/projects/:id           # Soft delete project

POST   /api/projects/:id/link-acc  # Link to ACC project
DELETE /api/projects/:id/link-acc  # Unlink from ACC
POST   /api/projects/:id/sync      # Trigger manual sync

GET    /api/projects/:id/members   # List project members
POST   /api/projects/:id/members   # Add member
PATCH  /api/projects/:id/members/:userId  # Update role/permissions
DELETE /api/projects/:id/members/:userId  # Remove member
```

### 5.3 RFIs

```
GET    /api/projects/:projectId/rfis
  ?status=UNDER_REVIEW
  &priority=high
  &assignedTo=userId
  &showClosed=false
  &search=keyword

POST   /api/projects/:projectId/rfis  # Create RFI (manual entry)
GET    /api/rfis/:id                   # Get RFI details
PATCH  /api/rfis/:id                   # Update RFI
DELETE /api/rfis/:id                   # Soft delete

POST   /api/rfis/:id/assign            # Assign user
PATCH  /api/rfis/:id/assign/:userId    # Update assignment
DELETE /api/rfis/:id/assign/:userId    # Remove assignment

POST   /api/rfis/:id/comments          # Add comment
GET    /api/rfis/:id/comments          # List comments
PATCH  /api/comments/:id               # Edit comment
DELETE /api/comments/:id               # Delete comment

GET    /api/rfis/:id/history           # Get status history
GET    /api/rfis/:id/files             # List files in network folder
POST   /api/rfis/:id/send-to-acc       # Send official response to ACC
POST   /api/rfis/:id/acknowledge       # Acknowledge ACC changes
```

### 5.4 Submittals

```
GET    /api/projects/:projectId/submittals  # Similar to RFIs
POST   /api/projects/:projectId/submittals
GET    /api/submittals/:id
PATCH  /api/submittals/:id
DELETE /api/submittals/:id

POST   /api/submittals/:id/assign
POST   /api/submittals/:id/comments
GET    /api/submittals/:id/history
GET    /api/submittals/:id/files
POST   /api/submittals/:id/send-to-acc
POST   /api/submittals/:id/acknowledge
```

### 5.5 My Work

```
GET    /api/my-work
  ?projectId=xxx
  &type=RFI|SUBMITTAL|ALL
  &priority=high
```

Returns user's assigned items across all projects with:
- Unread assignments
- Upcoming deadlines
- Overdue items
- Items with ACC changes

### 5.6 Notifications

```
GET    /api/notifications            # List user notifications
PATCH  /api/notifications/:id/read   # Mark as read
PATCH  /api/notifications/read-all   # Mark all as read
DELETE /api/notifications/:id        # Delete notification
```

### 5.7 Dashboard & Reports

```
GET    /api/projects/:id/dashboard   # Project metrics
GET    /api/projects/:id/export      # Export to Excel
```

Dashboard returns:
```json
{
  "rfis": {
    "total": 120,
    "open": 45,
    "closed": 75,
    "byStatus": { "UNDER_REVIEW": 20, "UNDER_QC": 10, ... },
    "byPriority": { "high": 15, "normal": 25, ... },
    "overdue": 5
  },
  "submittals": { ... },
  "workload": [
    { "userId": "...", "name": "...", "assigned": 10, "completed": 5 }
  ],
  "avgTurnaroundDays": 3.5
}
```

---

## 6. INTERNAL WORKFLOW IMPLEMENTATION

### 6.1 Internal Status Transitions

```
UNASSIGNED
    ↓ (Admin assigns reviewer)
ASSIGNED_FOR_REVIEW
    ↓ (Reviewer starts work)
UNDER_REVIEW
    ↓ (Reviewer submits for QC)
UNDER_QC
    ↓ (QC approves)
READY_FOR_RESPONSE
    ↓ (Admin sends to ACC)
SENT_TO_ACC
    ↓ (Optional: Admin marks complete)
CLOSED
```

**Permissions:**
- PROJECT_ADMIN: Can change any status, assign, send to ACC
- REVIEWER: Can move from ASSIGNED_FOR_REVIEW → UNDER_REVIEW → UNDER_QC
- QC_REVIEWER: Can move from UNDER_QC → READY_FOR_RESPONSE or back to UNDER_REVIEW
- VIEWER: Read-only

### 6.2 Auto-Assignment Rules

Project admins can configure JSON rules:

```json
{
  "disciplines": {
    "Structural": "userId123",
    "Mechanical": "userId456",
    "Electrical": "userId789"
  },
  "defaultReviewer": "userIdABC",
  "defaultQC": "userIdXYZ"
}
```

When new RFI/Submittal is synced, `workflowService.autoAssign()` checks discipline and assigns automatically.

### 6.3 Deadline Calculation

```json
// Project.deadlineRules
{
  "high": { "reviewPercent": 40, "qcPercent": 70 },
  "normal": { "reviewPercent": 50, "qcPercent": 80 },
  "low": { "reviewPercent": 60, "qcPercent": 85 }
}
```

Example:
- ACC due date: 10 days from now
- Priority: high
- Review deadline: Day 0 + (10 * 0.4) = Day 4
- QC deadline: Day 0 + (10 * 0.7) = Day 7

### 6.4 Notification Rules

```json
// Project.notificationRules
{
  "enabled": true,
  "daysBeforeDue": [3, 1],  // Notify 3 days and 1 day before
  "notifyOnAssignment": true,
  "notifyOnAccChange": true,
  "notifyOnMention": true
}
```

Notifications are created by `notificationService.createNotification()` and displayed in-app. Future: email integration.

---

## 7. FILE HANDLING & NETWORK SHARE

### 7.1 Network Folder Structure

```
\\server\share\Project123\ACC_Backup\
├── RFIs\
│   ├── RFI-0001\
│   │   ├── RFI-0001_CombinedExport.pdf  (ACC export)
│   │   ├── Markup_Sheet1.pdf            (response attachment)
│   │   └── Response_Letter.pdf
│   ├── RFI-0002\
│   └── ...
└── Submittals\
    ├── SUB-0045\
    │   ├── SUB-0045_CombinedExport.pdf
    │   ├── ReviewComments.pdf
    │   └── ApprovedStampedDrawing.pdf
    └── ...
```

### 7.2 File Picker Implementation

**Backend Endpoint:**
```
GET /api/rfis/:id/files
Returns:
[
  {
    "fileName": "RFI-0001_CombinedExport.pdf",
    "filePath": "\\\\server\\share\\...\\RFI-0001\\RFI-0001_CombinedExport.pdf",
    "size": 1048576,
    "mtime": "2026-01-10T14:30:00Z",
    "source": "ACC_EXPORT"
  },
  {
    "fileName": "Markup_Sheet1.pdf",
    "filePath": "...",
    "size": 524288,
    "mtime": "2026-01-11T09:15:00Z",
    "source": "RESPONSE_ATTACHMENT"
  }
]
```

**Frontend Component:**
```tsx
<FilePickerModal>
  {files.map(file => (
    <FileItem
      key={file.fileName}
      name={file.fileName}
      size={formatBytes(file.size)}
      date={formatDate(file.mtime)}
      isSelected={selectedFiles.includes(file.filePath)}
      onToggle={() => toggleFile(file.filePath)}
    />
  ))}
</FilePickerModal>
```

**NO UPLOAD:** Users cannot upload arbitrary files. Files must already exist in the network folder (either from ACC export or manually placed by admins).

### 7.3 Send to ACC Workflow

When user clicks "Send to ACC":

1. **Validation:**
   - Response status selected
   - Response text provided (if required)
   - At least one file selected from network folder

2. **Backend Process:**
   ```typescript
   async function sendResponseToAcc(rfiId: string, data: {
     responseStatus: string;
     responseText: string;
     selectedFilePaths: string[];
   }) {
     // 1. Update RFI status in ACC
     await accClient.updateRFIStatus(rfi.accRfiId, data.responseStatus, accessToken);
     
     // 2. Post response comment in ACC
     await accClient.postRFIResponse(rfi.accRfiId, data.responseText, accessToken);
     
     // 3. Upload selected files to ACC
     for (const filePath of data.selectedFilePaths) {
       const buffer = await fs.readFile(filePath);
       await accClient.uploadAttachment(rfi.accRfiId, buffer, path.basename(filePath), accessToken);
     }
     
     // 4. Update internal RFI record
     await prisma.rfi.update({
       where: { id: rfiId },
       data: {
         responseStatus: data.responseStatus,
         responseText: data.responseText,
         responseSentAt: new Date(),
         responseSentBy: userId,
         internalStatus: 'SENT_TO_ACC',
       },
     });
     
     // 5. Create audit log
     await prisma.auditLog.create({
       data: {
         userId,
         action: 'SEND_TO_ACC',
         entityType: 'RFI',
         entityId: rfiId,
         details: JSON.stringify({ responseStatus, fileCount: selectedFilePaths.length }),
       },
     });
   }
   ```

---

## 8. FRONTEND UX SPECIFICATION

### 8.1 Global Layout

```
┌────────────────────────────────────────────────────────────┐
│ [Logo] [Project Selector ▼]     RFI Manager    [🔔] [User▼]│
├────────────┬───────────────────────────────────────────────┤
│ My Work    │                                               │
│ RFIs       │                                               │
│ Submittals │          MAIN CONTENT AREA                    │
│ Dashboard  │                                               │
│ Settings   │                                               │
│            │                                               │
└────────────┴───────────────────────────────────────────────┘
```

### 8.2 Page: My Work

**Features:**
- Combined view of user's assigned RFIs and Submittals
- Filters: Type (All/RFIs/Submittals), Status, Priority
- Toggle between List and Calendar views
- Visual indicators:
  - 🆕 Unread/newly assigned (badge)
  - ⚠️ Overdue (red text)
  - 🔶 ACC Updated (yellow highlight)
  - ⏰ Due soon (orange badge)

**List View:**
```
Type    | Number    | Title                  | Priority | Due Date   | Int. Deadline | Status
--------|-----------|------------------------|----------|------------|---------------|-------------
RFI     | RFI-0123  | 🔶 Structural clarif..| High     | Jan 20     | Jan 15        | UNDER_REVIEW
SUB     | SUB-0045  | 🆕 MEP Submittal      | Normal   | Jan 25     | Jan 18        | ASSIGNED
```

### 8.3 Page: RFIs

**Tabs:** Open | Closed | All

**Filters:** Status dropdown, Priority dropdown, Assignee dropdown, Date range, Search box

**Detail Drawer/Page:**

```
┌─────────────────────────────────────────────────────────────┐
│ RFI-0123: Structural clarification                         │
│ [🔶 ACC Updated: Status changed Draft→Open, Due date...] [X]│
├─────────────────────────────────────────────────────────────┤
│ ACC METADATA          │  INTERNAL WORKFLOW                  │
│ Status: Open          │  Internal Status: [UNDER_REVIEW ▼]  │
│ Due Date: Jan 20      │  Review Deadline: Jan 15            │
│ Priority: High        │  QC Deadline: Jan 17                │
│ Created By: John Doe  │  Assigned Reviewer: Jane Smith      │
│ Description: ...      │  Assigned QC: Bob Johnson           │
├───────────────────────┴─────────────────────────────────────┤
│ [ACC Details] [Internal Comments] [History] [Official Resp] │
│                                                              │
│ [Internal Comments Tab - Active]                            │
│ ┌──────────────────────────────────────────────────────────┐│
│ │ Jane Smith · 2 hours ago                                 ││
│ │ I reviewed the plans and need clarification on...        ││
│ │   └─ Bob Johnson · 1 hour ago                            ││
│ │     Good catch. @JohnDoe can you provide this?           ││
│ └──────────────────────────────────────────────────────────┘│
│ [Write a comment...]                            [Post]      │
│                                                              │
│ [Official Response Tab]                                     │
│ Response Status: [Approved as Noted ▼]                      │
│ Response Text: [Textarea...]                                │
│ Attachments from Network Folder:                            │
│  ☑ RFI-0123_CombinedExport.pdf                              │
│  ☑ Markup_Sheet1.pdf                                        │
│  ☐ Response_Letter.pdf                                      │
│  [Select Files from Network Folder...]                      │
│                                                              │
│ [Send to ACC] [Save Draft]                                  │
└──────────────────────────────────────────────────────────────┘
```

### 8.4 Page: Dashboard

**Widgets:**
1. **Status Overview** (Donut charts)
   - RFIs by internal status
   - Submittals by internal status

2. **Priority Distribution** (Bar chart)

3. **Overdue Items** (Table with quick links)

4. **Workload Per User** (Bar chart)

5. **Average Turnaround Time** (Metric card)

6. **Recent Activity** (Timeline)

**Export Button:** "Export to Excel" → Downloads current filtered view

### 8.5 Closed Items

- Default: Hidden from lists (filter `internalStatus != 'CLOSED'`)
- Toggle: "Show Closed Items" checkbox
- Visual: Greyed out, "CLOSED" badge, collapsed by default
- Permissions: All users can view closed items (read-only)

---

## 9. EXCEL EXPORT IMPLEMENTATION

**Endpoint:** `GET /api/projects/:id/export?type=rfis&filters=...`

**Implementation:**
```typescript
import ExcelJS from 'exceljs';

async function exportRfisToExcel(projectId: string, filters: any) {
  const rfis = await rfiService.listRfis({ projectId, ...filters });
  
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('RFIs');
  
  worksheet.columns = [
    { header: 'Number', key: 'accNumber', width: 15 },
    { header: 'Title', key: 'title', width: 40 },
    { header: 'ACC Status', key: 'accStatus', width: 15 },
    { header: 'Internal Status', key: 'internalStatus', width: 20 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'ACC Due Date', key: 'accDueDate', width: 15 },
    { header: 'Review Deadline', key: 'reviewDeadline', width: 15 },
    { header: 'Assigned Reviewer', key: 'reviewer', width: 25 },
    { header: 'Assigned QC', key: 'qc', width: 25 },
    { header: 'Response Status', key: 'responseStatus', width: 20 },
  ];
  
  rfis.forEach(rfi => {
    worksheet.addRow({
      accNumber: rfi.accNumber,
      title: rfi.title,
      accStatus: rfi.accStatus,
      internalStatus: rfi.internalStatus,
      priority: rfi.priority,
      accDueDate: rfi.accDueDate,
      reviewDeadline: rfi.reviewDeadline,
      reviewer: rfi.assignments.find(a => a.role === 'REVIEWER')?.user.email,
      qc: rfi.assignments.find(a => a.role === 'QC_REVIEWER')?.user.email,
      responseStatus: rfi.responseStatus,
    });
  });
  
  return await workbook.xlsx.writeBuffer();
}
```

---

## 10. MAJOR RISKS & MITIGATIONS

### 10.1 Network Path Permissions

**Risk:** Node.js backend cannot access UNC paths due to:
- Different service account
- Network authentication
- Path not mounted

**Mitigation:**
- Run Node.js service as domain user with network access
- Map network drive on server (e.g., `Z:\`)
- Implement permission check on project creation:
  ```typescript
  async function validateNetworkPath(path: string): Promise<boolean> {
    try {
      await fs.access(path, fs.constants.R_OK | fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
  ```
- Show clear error to admin if path is inaccessible
- Provide fallback: store files in database BLOB if network unavailable (future)

### 10.2 ACC API Rate Limits

**Risk:** Autodesk APIs have rate limits (e.g., 100 req/min). Syncing many projects can hit limits.

**Mitigation:**
- Implement request queue with concurrency control
- Respect `Retry-After` headers
- Exponential backoff on 429 errors
- Batch requests where possible
- Cache frequently accessed data (project metadata)
- Stagger sync jobs (don't sync all projects at once)

### 10.3 Concurrent Edits

**Risk:** User A and User B edit same RFI simultaneously → one overwrites the other.

**Mitigation:**
- Implement optimistic locking with `updatedAt` timestamp:
  ```typescript
  await prisma.rfi.update({
    where: { id: rfiId, updatedAt: lastKnownUpdatedAt },
    data: { ... }
  });
  // If updatedAt doesn't match, throw conflict error
  ```
- Use WebSocket (future) for real-time presence indicators
- Show "Someone else is editing" warning
- Merge non-conflicting changes where possible

### 10.4 Token Expiration During Long Operations

**Risk:** Access token expires mid-sync → partial sync failure.

**Mitigation:**
- Always check token expiry before API calls:
  ```typescript
  async function getValidToken(oauthToken: AccOAuthToken): Promise<string> {
    if (new Date() >= oauthToken.expiresAt) {
      // Refresh token
      const newTokens = await refreshAccessToken(decrypt(oauthToken.refreshToken));
      // Update DB
      await prisma.accOAuthToken.update({ ... });
      return newTokens.access_token;
    }
    return decrypt(oauthToken.accessToken);
  }
  ```
- Implement retry logic with fresh token on 401 errors

### 10.5 Large File Uploads to ACC

**Risk:** Uploading large PDFs (e.g., 50MB) can timeout or fail.

**Mitigation:**
- Stream files instead of loading into memory
- Implement chunked upload if ACC supports it
- Set appropriate timeout values
- Show progress indicator to user
- Validate file size before upload (e.g., max 100MB)

### 10.6 Database Migrations in Production

**Risk:** Schema changes can cause downtime or data loss.

**Mitigation:**
- Use Prisma migrations (`prisma migrate deploy`)
- Test migrations on staging database first
- Implement backward-compatible changes when possible
- Schedule migrations during maintenance windows
- Keep backups before migrations

### 10.7 Scalability Beyond MVP

**Anticipated Growth:**
- 10 projects → 100 projects
- 5 users → 50 users
- 100 RFIs → 10,000 RFIs

**Future Enhancements:**
- Implement pagination on all list endpoints
- Add database read replicas for reporting
- Cache frequently accessed data (Redis)
- Move to message queue (BullMQ) for background jobs
- Implement GraphQL for flexible frontend queries
- Add Elasticsearch for full-text search

---

## 11. IMPLEMENTATION PRIORITY (PHASED ROLLOUT)

### Phase 1: Core MVP (4-6 weeks)
✅ Database schema
✅ User authentication (email/password)
✅ Project creation & ACC OAuth link
✅ Basic RFI sync from ACC
✅ Manual assignment & comments
✅ Simple list/detail views
✅ Send response to ACC (basic)

### Phase 2: Workflow (2-3 weeks)
- Internal status workflow
- Auto-assignment rules
- Deadline calculation & notifications
- Change detection & flagging
- File picker from network folder
- Status history

### Phase 3: Polish & Submittals (2-3 weeks)
- Submittal sync & management
- Dashboard & metrics
- Excel export
- QC workflow
- My Work page

### Phase 4: Production Ready (2 weeks)
- Comprehensive error handling
- Audit logging
- Performance optimization
- Security hardening
- Documentation & training

### Phase 5: Future Enhancements
- Azure AD SSO
- Email notifications
- Mobile-responsive UI
- Real-time collaboration (WebSocket)
- Advanced reporting
- PDF generation

---

## 12. SECURITY CONSIDERATIONS

**Authentication:**
- Store password hashes using bcrypt (salt rounds: 10)
- Use httpOnly, secure cookies for sessions
- Implement CSRF protection
- Rate limit login attempts

**Authorization:**
- Middleware checks user's project membership and role
- Permissions: `canAssign`, `canSendToAcc`, `canEditSettings`
- Audit all sensitive actions

**Data Protection:**
- Encrypt OAuth tokens at rest (use `crypto` library)
- Use HTTPS in production
- Validate all user inputs
- Sanitize SQL queries (Prisma handles this)
- Implement XSS protection

**Network Access:**
- Ensure backend server has minimal network privileges
- Use read-only access where possible
- Log all file system operations

---

## 13. TESTING STRATEGY

**Unit Tests:**
- Service layer functions
- Utility functions (hashing, file operations)
- Use Jest

**Integration Tests:**
- API endpoints
- Database operations
- ACC API mocking

**E2E Tests:**
- Critical user flows (assign RFI, send to ACC)
- Use Playwright or Cypress

**Manual Testing:**
- ACC OAuth flow
- File picker on actual network share
- Multi-user concurrency

---

## CONCLUSION

This architecture provides a solid foundation for a production-ready ACC integration system. The modular service design, comprehensive database schema, and clear API boundaries enable:

- **Scalability:** Add users, projects, and items without architectural changes
- **Maintainability:** Clear separation of concerns, well-documented code
- **Extensibility:** Easy to add new modules (e.g., Issues, Changes)
- **Reliability:** Error handling, audit trails, change detection
- **User Experience:** Fast, intuitive, with clear feedback

The phased implementation approach allows for incremental delivery of value while maintaining quality and stability.
