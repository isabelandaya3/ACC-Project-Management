# Manual Response Detection and Admin Confirmation

## Overview

The system enforces that **only project admins** can upload responses to ACC. However, if someone adds a response manually in the ACC website (bypassing the app), the system detects this during sync and requires admin confirmation before closing out the item.

## Permission Control

### Who Can Send Responses to ACC?

Only users with one of these permissions:
- **PROJECT_ADMIN** role
- **canSendToAcc** permission set to `true`

### Permission Check Implementation

Both `sendRfiResponseToAcc()` and `sendSubmittalResponseToAcc()` functions now include:

```typescript
// PERMISSION CHECK: Only admins can send responses to ACC
const membership = rfi.project.memberships[0];
if (!membership) {
  throw new Error('User is not a member of this project');
}

const isAdmin = membership.role === 'PROJECT_ADMIN' || membership.canSendToAcc === true;
if (!isAdmin) {
  throw new Error('Only project admins are authorized to send responses to ACC');
}
```

**Result:** Non-admin users will receive an error if they attempt to send responses to ACC.

---

## Manual Response Detection

### How It Works

During every sync with ACC (every 15 minutes by default), the system checks if:
1. ACC has a response for an RFI/Submittal
2. The response was **NOT** sent by our app (no `responseSentAt` timestamp)

If both conditions are true, the system flags it as a manual response requiring admin confirmation.

### Database Fields

Added to both `Rfi` and `Submittal` models:

```prisma
hasManualResponse           Boolean   @default(false)
manualResponseDetectedAt    DateTime?
manualResponseData          String?   // JSON with response details
manualResponseConfirmedBy   String?   // Admin user ID
manualResponseConfirmedAt   DateTime?
```

### Detection Logic

In `enhancedSyncService.ts`:

```typescript
// Check if ACC has a response that we didn't send
if (accRfi.response && accRfi.response.text && !existing.responseSentAt) {
  hasManualResponse = true;
  manualResponseData = JSON.stringify({
    status: accRfi.response.status || accRfi.status,
    text: accRfi.response.text,
    respondedBy: accRfi.response.respondedBy,
    respondedAt: accRfi.response.respondedAt,
    detectedAt: now.toISOString(),
  });
  
  log.info({ 
    rfiId: accRfi.id, 
    accNumber: accRfi.number 
  }, 'Manual response detected in ACC - requires admin confirmation');
}
```

The same logic applies to Submittals.

---

## Admin Confirmation Workflow

### Step 1: Sync Detects Manual Response

When the system syncs with ACC and finds a manual response:
- Sets `hasManualResponse = true`
- Records `manualResponseDetectedAt` timestamp
- Stores response details in `manualResponseData` (JSON)
- Logs the detection

### Step 2: Admin Reviews Pending Manual Responses

List all RFIs with manual responses awaiting confirmation:

```typescript
import { listRfisWithManualResponses } from './services/responseService';

const pendingRfis = await listRfisWithManualResponses(projectId);
```

List all Submittals with manual responses:

```typescript
import { listSubmittalsWithManualResponses } from './services/responseService';

const pendingSubmittals = await listSubmittalsWithManualResponses(projectId);
```

### Step 3: Admin Confirms Manual Response

Once admin reviews and confirms the manual response:

**For RFIs:**
```typescript
import { confirmManualRfiResponse } from './services/responseService';

await confirmManualRfiResponse(rfiId, adminUserId);
```

**For Submittals:**
```typescript
import { confirmManualSubmittalResponse } from './services/responseService';

await confirmManualSubmittalResponse(submittalId, adminUserId);
```

### Step 4: System Closes Out Item

When admin confirms:
1. Sets `manualResponseConfirmedBy` to admin user ID
2. Sets `manualResponseConfirmedAt` to current timestamp
3. Changes `internalStatus` to `CLOSED`
4. Copies response data from `manualResponseData` to `responseStatus` and `responseText`
5. Creates audit log entry with action `CONFIRM_MANUAL_RESPONSE`
6. Creates status history entry

---

## UI Implementation Examples

### Dashboard Alert Badge

Show count of items with manual responses needing confirmation:

```typescript
const pendingRfis = await listRfisWithManualResponses(projectId);
const pendingSubmittals = await listSubmittalsWithManualResponses(projectId);

const totalPending = pendingRfis.length + pendingSubmittals.length;

// Display: "⚠️ 3 manual responses need confirmation"
```

### Manual Response Review Page

Display list of items with manual responses:

```typescript
<div className="manual-responses">
  <h2>Manual Responses Requiring Confirmation</h2>
  
  {pendingRfis.map(rfi => {
    const responseData = JSON.parse(rfi.manualResponseData);
    
    return (
      <div key={rfi.id} className="pending-item">
        <h3>{rfi.accNumber} - {rfi.title}</h3>
        <p>ACC Project: {rfi.accProjectLink.accProjectName}</p>
        <p>Detected: {rfi.manualResponseDetectedAt}</p>
        
        <div className="response-details">
          <strong>Response Status:</strong> {responseData.status}
          <strong>Response Text:</strong> {responseData.text}
          <strong>Responded By:</strong> {responseData.respondedBy}
          <strong>Responded At:</strong> {responseData.respondedAt}
        </div>
        
        <button onClick={() => confirmManualRfiResponse(rfi.id, currentUserId)}>
          Confirm & Close Out
        </button>
      </div>
    );
  })}
</div>
```

### RFI/Submittal Detail Page - Flag Indicator

Show warning badge on items with manual responses:

```typescript
{rfi.hasManualResponse && !rfi.manualResponseConfirmedAt && (
  <div className="alert alert-warning">
    ⚠️ Manual response detected in ACC on {rfi.manualResponseDetectedAt}
    <br />
    Requires admin confirmation before closing.
    
    {isAdmin && (
      <button onClick={() => confirmManualRfiResponse(rfi.id, userId)}>
        Review & Confirm
      </button>
    )}
  </div>
)}

{rfi.hasManualResponse && rfi.manualResponseConfirmedAt && (
  <div className="alert alert-success">
    ✓ Manual response confirmed by admin on {rfi.manualResponseConfirmedAt}
  </div>
)}
```

---

## API Endpoints (Planned)

```
GET    /api/projects/:id/rfis/manual-responses
       Returns list of RFIs with unconfirmed manual responses

GET    /api/projects/:id/submittals/manual-responses
       Returns list of Submittals with unconfirmed manual responses

POST   /api/rfis/:id/confirm-manual-response
       Admin confirms a manual RFI response and closes it out

POST   /api/submittals/:id/confirm-manual-response
       Admin confirms a manual Submittal response and closes it out
```

---

## Security & Audit Trail

### Permission Validation

All sensitive operations validate admin permissions:
- `sendRfiResponseToAcc()` - Checks before sending
- `sendSubmittalResponseToAcc()` - Checks before sending
- `confirmManualRfiResponse()` - Checks before confirming
- `confirmManualSubmittalResponse()` - Checks before confirming

Non-admin attempts are:
1. Logged with `log.warn()`
2. Rejected with error message
3. Not allowed to proceed

### Audit Logging

All manual response confirmations create audit log entries:

```typescript
await prisma.auditLog.create({
  data: {
    userId: adminUserId,
    action: 'CONFIRM_MANUAL_RESPONSE',
    entityType: 'RFI',
    entityId: rfiId,
    rfiId,
    details: JSON.stringify({
      manualResponseStatus: responseData.status,
      respondedBy: responseData.respondedBy,
      respondedAt: responseData.respondedAt,
      confirmedAt: new Date().toISOString(),
    }),
  },
});
```

### Status History

Status changes are tracked:

```typescript
await prisma.statusHistory.create({
  data: {
    rfiId,
    fieldName: 'internalStatus',
    oldValue: 'READY_FOR_RESPONSE',
    newValue: 'CLOSED',
    changeReason: 'Manual response confirmed by admin',
  },
});
```

---

## Edge Cases & Error Handling

### Case 1: Response Added Then Modified in ACC

**Scenario:** Someone adds response in ACC, then edits it before admin confirms.

**Behavior:** 
- First sync detects manual response and flags it
- Subsequent syncs update `manualResponseData` with latest version
- `manualResponseDetectedAt` remains original detection time
- Admin always sees most recent response data

### Case 2: Admin Confirms Already-Confirmed Response

**Behavior:** System throws error:
```
Error: Manual response has already been confirmed
```

### Case 3: Non-Admin Attempts to Confirm

**Behavior:** System throws error:
```
Error: Only project admins can confirm manual responses
```

Logged as warning in system logs.

### Case 4: Malformed Response Data from ACC

**Behavior:** 
- System catches JSON parse error
- Throws error: `Invalid manual response data`
- Logs error for investigation
- Admin can retry after sync re-fetches data

### Case 5: Item Deleted from ACC After Manual Response

**Behavior:**
- Next sync won't find the item
- `lastSeenAt` timestamp stops updating
- Admin can still confirm (closes internal record)
- Alternative: Archive logic can clean up old items

---

## Sync Frequency & Timing

**Default Sync Interval:** 15 minutes (configurable per project)

**Manual Response Detection Timing:**
- Manual response added in ACC at 10:00 AM
- Next sync runs at 10:15 AM → **Detected**
- Admin notified immediately
- Admin can confirm anytime after detection

**Recommendation:** Set up email/Slack notifications for admins when manual responses are detected so they can review promptly.

---

## Testing Scenarios

### Test 1: Admin Can Send Response
1. Login as PROJECT_ADMIN
2. Prepare RFI response
3. Click "Send to ACC"
4. ✅ Should succeed and log audit entry

### Test 2: Non-Admin Cannot Send Response
1. Login as REVIEWER
2. Prepare RFI response
3. Click "Send to ACC"
4. ❌ Should fail with permission error

### Test 3: Manual Response Detection
1. Add response directly in ACC website
2. Wait for sync (or trigger manual sync)
3. Check database: `hasManualResponse = true`
4. Check logs: "Manual response detected" message
5. ✅ Item should appear in pending confirmation list

### Test 4: Admin Confirmation
1. View manual responses list
2. Click "Confirm & Close Out" as admin
3. Check database: `manualResponseConfirmedAt` set, `internalStatus = CLOSED`
4. Check audit log: `CONFIRM_MANUAL_RESPONSE` entry created
5. ✅ Item should no longer appear in pending list

### Test 5: Non-Admin Cannot Confirm
1. Attempt to call `confirmManualRfiResponse()` as REVIEWER
2. ❌ Should fail with permission error
3. Check logs: Warning logged

---

## Database Queries

### Find All Unconfirmed Manual Responses

```sql
-- RFIs
SELECT r.id, r.accNumber, r.title, r.manualResponseDetectedAt, r.manualResponseData
FROM "Rfi" r
WHERE r."hasManualResponse" = true
  AND r."manualResponseConfirmedAt" IS NULL
  AND r."projectId" = 'project-id-here'
ORDER BY r."manualResponseDetectedAt" DESC;

-- Submittals
SELECT s.id, s.accNumber, s.title, s.manualResponseDetectedAt, s.manualResponseData
FROM "Submittal" s
WHERE s."hasManualResponse" = true
  AND s."manualResponseConfirmedAt" IS NULL
  AND s."projectId" = 'project-id-here'
ORDER BY s."manualResponseDetectedAt" DESC;
```

### Audit Trail for Manual Response

```sql
SELECT al.*, u.email, u.firstName, u.lastName
FROM "AuditLog" al
JOIN "User" u ON al."userId" = u.id
WHERE al.action = 'CONFIRM_MANUAL_RESPONSE'
  AND al."rfiId" = 'rfi-id-here'
ORDER BY al."createdAt" DESC;
```

---

## Configuration

### Enable/Disable Manual Response Detection

Currently enabled by default. To disable (not recommended):

Comment out detection logic in `enhancedSyncService.ts`:

```typescript
// DISABLED: Manual response detection
// if (accRfi.response && accRfi.response.text && !existing.responseSentAt) {
//   hasManualResponse = true;
//   ...
// }
```

### Customize Sync Interval

Per-project setting in `Project` table:

```typescript
await prisma.project.update({
  where: { id: projectId },
  data: {
    syncIntervalMinutes: 5, // Check every 5 minutes for faster detection
  },
});
```

---

## Future Enhancements

- [ ] Email notification to admins when manual response detected
- [ ] Slack/Teams integration for alerts
- [ ] Bulk confirm multiple manual responses
- [ ] Auto-confirm if response matches pre-approved templates
- [ ] Response comparison tool (show diff between expected and manual)
- [ ] Metrics dashboard: # manual responses per month, avg time to confirm
