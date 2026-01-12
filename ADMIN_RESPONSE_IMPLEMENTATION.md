# Admin-Only Response Upload & Manual Response Detection - Implementation Summary

## Changes Completed

### 1. Database Schema Updates (schema.prisma)

**Added to both `Rfi` and `Submittal` models:**

```prisma
// Manual response detection (response added directly in ACC)
hasManualResponse           Boolean   @default(false)
manualResponseDetectedAt    DateTime?
manualResponseData          String?   // JSON: ACC response details
manualResponseConfirmedBy   String?   // Admin who confirmed
manualResponseConfirmedAt   DateTime?
```

**Purpose:** Track responses that were added manually in ACC (bypassing the app) and require admin confirmation before closing.

---

### 2. Response Service - Permission Checks (responseService.ts)

**Updated Functions:**
- `sendRfiResponseToAcc()` 
- `sendSubmittalResponseToAcc()`

**Added Permission Validation:**

```typescript
// PERMISSION CHECK: Only admins can send responses to ACC
const membership = rfi.project.memberships[0];
if (!membership) {
  throw new Error('User is not a member of this project');
}

const isAdmin = membership.role === 'PROJECT_ADMIN' || membership.canSendToAcc === true;
if (!isAdmin) {
  log.warn({ rfiId, userId, role: membership.role }, 'Non-admin attempted to send response to ACC');
  throw new Error('Only project admins are authorized to send responses to ACC');
}
```

**Result:** Only users with `PROJECT_ADMIN` role or `canSendToAcc = true` can upload responses to ACC.

---

### 3. Sync Service - Manual Response Detection (enhancedSyncService.ts)

**Updated Functions:**
- `processRfi()` 
- `processSubmittal()`

**Added Detection Logic:**

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
  
  log.info({ rfiId: accRfi.id }, 'Manual response detected in ACC - requires admin confirmation');
}
```

**How It Works:**
1. During sync, checks if ACC has a response
2. Verifies we didn't send it (no `responseSentAt`)
3. If true, flags `hasManualResponse = true`
4. Stores response details in JSON format
5. Logs detection event

**Updated Upsert Operations:**

```typescript
update: {
  // ... other fields
  hasManualResponse: hasManualResponse ? true : undefined,
  manualResponseDetectedAt: hasManualResponse ? now : undefined,
  manualResponseData: hasManualResponse ? manualResponseData : undefined,
  // ...
}
```

---

### 4. Response Service - Admin Confirmation Functions (responseService.ts)

**New Functions Added:**

#### List Pending Manual Responses

```typescript
export async function listRfisWithManualResponses(projectId: string)
export async function listSubmittalsWithManualResponses(projectId: string)
```

Returns items with `hasManualResponse = true` and `manualResponseConfirmedAt = null`, ordered by detection time.

#### Confirm Manual Response

```typescript
export async function confirmManualRfiResponse(rfiId: string, userId: string)
export async function confirmManualSubmittalResponse(submittalId: string, userId: string)
```

**Workflow:**
1. **Permission Check** - Validates user is admin
2. **Validation** - Ensures manual response exists and not already confirmed
3. **Parse Response Data** - Extracts response from JSON
4. **Update Record:**
   - Set `manualResponseConfirmedBy` and `manualResponseConfirmedAt`
   - Change `internalStatus` to `CLOSED`
   - Copy response data to `responseStatus` and `responseText`
5. **Audit Trail:**
   - Create audit log entry with action `CONFIRM_MANUAL_RESPONSE`
   - Create status history entry

---

## Complete Workflow

### Normal Workflow (App-Controlled)

```
1. User prepares RFI response in app
2. Admin clicks "Send to ACC" 
3. ✅ Permission check passes (admin only)
4. System sends to ACC via API
5. Sets responseSentAt timestamp
6. Changes internalStatus to SENT_TO_ACC
7. Creates audit log
```

### Manual Response Workflow (Bypass Detection)

```
1. Someone adds response directly in ACC website (bypassing app)
2. System syncs with ACC (every 15 min)
3. 🚨 Detects response without responseSentAt timestamp
4. Flags hasManualResponse = true
5. Stores response details in manualResponseData
6. Logs detection event
7. Admin sees alert in dashboard
8. Admin reviews response details
9. Admin clicks "Confirm & Close Out"
10. ✅ Permission check passes (admin only)
11. System closes item and creates audit trail
```

---

## Security Features

### Permission Enforcement

| Action | Required Permission | Error if Not Met |
|--------|---------------------|------------------|
| Send RFI to ACC | `PROJECT_ADMIN` or `canSendToAcc = true` | "Only project admins are authorized" |
| Send Submittal to ACC | `PROJECT_ADMIN` or `canSendToAcc = true` | "Only project admins are authorized" |
| Confirm Manual RFI Response | `PROJECT_ADMIN` or `canSendToAcc = true` | "Only project admins can confirm" |
| Confirm Manual Submittal Response | `PROJECT_ADMIN` or `canSendToAcc = true` | "Only project admins can confirm" |

### Audit Logging

All sensitive operations create audit log entries:

**Sending to ACC:**
```typescript
action: 'SEND_TO_ACC'
entityType: 'RFI' or 'SUBMITTAL'
details: { responseStatus, fileCount, files }
```

**Confirming Manual Response:**
```typescript
action: 'CONFIRM_MANUAL_RESPONSE'
entityType: 'RFI' or 'SUBMITTAL'
details: { 
  manualResponseStatus,
  respondedBy,
  respondedAt,
  confirmedAt
}
```

**Failed Attempts:**
```typescript
action: 'SEND_TO_ACC_FAILED'
details: { error: errorMessage }
```

### Logging

All permission violations are logged with `log.warn()`:

```typescript
log.warn({ 
  rfiId, 
  userId, 
  role: membership.role 
}, 'Non-admin attempted to send response to ACC');
```

---

## Database Indexes Needed (Future)

For optimal query performance, consider adding:

```prisma
model Rfi {
  // ... existing fields
  
  @@index([hasManualResponse, manualResponseConfirmedAt])
  @@index([projectId, hasManualResponse])
}

model Submittal {
  // ... existing fields
  
  @@index([hasManualResponse, manualResponseConfirmedAt])
  @@index([projectId, hasManualResponse])
}
```

---

## API Endpoints to Create

```
GET    /api/projects/:projectId/rfis/manual-responses
       Returns: RFI[] with hasManualResponse=true & manualResponseConfirmedAt=null
       Permission: Any project member can view

GET    /api/projects/:projectId/submittals/manual-responses
       Returns: Submittal[] with hasManualResponse=true & manualResponseConfirmedAt=null
       Permission: Any project member can view

POST   /api/rfis/:rfiId/confirm-manual-response
       Body: { userId }
       Returns: Updated RFI
       Permission: PROJECT_ADMIN or canSendToAcc=true

POST   /api/submittals/:submittalId/confirm-manual-response
       Body: { userId }
       Returns: Updated Submittal
       Permission: PROJECT_ADMIN or canSendToAcc=true

POST   /api/rfis/:rfiId/send-to-acc
       Body: { responseStatus, responseText, selectedFilePaths }
       Permission: PROJECT_ADMIN or canSendToAcc=true
       Updated: Now includes permission check

POST   /api/submittals/:submittalId/send-to-acc
       Body: { responseStatus, responseText, selectedFilePaths }
       Permission: PROJECT_ADMIN or canSendToAcc=true
       Updated: Now includes permission check
```

---

## UI Components to Build

### 1. Dashboard Alert Badge

```tsx
// Show count of pending manual responses
const ManualResponseAlert = ({ projectId }) => {
  const [count, setCount] = useState(0);
  
  useEffect(() => {
    async function fetchCount() {
      const rfis = await fetch(`/api/projects/${projectId}/rfis/manual-responses`);
      const submittals = await fetch(`/api/projects/${projectId}/submittals/manual-responses`);
      setCount(rfis.length + submittals.length);
    }
    fetchCount();
  }, [projectId]);
  
  if (count === 0) return null;
  
  return (
    <div className="alert alert-warning">
      ⚠️ {count} manual response{count > 1 ? 's' : ''} require admin confirmation
      <Link to={`/projects/${projectId}/manual-responses`}>Review Now</Link>
    </div>
  );
};
```

### 2. Manual Response Review Page

```tsx
const ManualResponsesPage = ({ projectId, currentUserId, isAdmin }) => {
  const [rfis, setRfis] = useState([]);
  const [submittals, setSubmittals] = useState([]);
  
  const handleConfirmRfi = async (rfiId) => {
    await fetch(`/api/rfis/${rfiId}/confirm-manual-response`, {
      method: 'POST',
      body: JSON.stringify({ userId: currentUserId }),
    });
    // Refresh list
  };
  
  return (
    <div>
      <h1>Manual Responses Requiring Confirmation</h1>
      
      <section>
        <h2>RFIs ({rfis.length})</h2>
        {rfis.map(rfi => {
          const response = JSON.parse(rfi.manualResponseData);
          return (
            <Card key={rfi.id}>
              <h3>{rfi.accNumber} - {rfi.title}</h3>
              <p>ACC Project: {rfi.accProjectLink.accProjectName}</p>
              <p>Detected: {formatDate(rfi.manualResponseDetectedAt)}</p>
              
              <details>
                <summary>Response Details</summary>
                <dl>
                  <dt>Status:</dt>
                  <dd>{response.status}</dd>
                  
                  <dt>Text:</dt>
                  <dd>{response.text}</dd>
                  
                  <dt>Responded By:</dt>
                  <dd>{response.respondedBy}</dd>
                  
                  <dt>Responded At:</dt>
                  <dd>{formatDate(response.respondedAt)}</dd>
                </dl>
              </details>
              
              {isAdmin && (
                <button onClick={() => handleConfirmRfi(rfi.id)}>
                  Confirm & Close Out
                </button>
              )}
            </Card>
          );
        })}
      </section>
      
      {/* Similar section for Submittals */}
    </div>
  );
};
```

### 3. Item Detail Page - Manual Response Indicator

```tsx
{rfi.hasManualResponse && !rfi.manualResponseConfirmedAt && (
  <Alert severity="warning">
    ⚠️ Manual response detected in ACC on {formatDate(rfi.manualResponseDetectedAt)}
    <br />
    This response was added directly in ACC, bypassing the app workflow.
    {isAdmin && (
      <>
        <br />
        <ViewResponseButton rfiId={rfi.id} />
        <ConfirmButton onClick={() => confirmManualRfiResponse(rfi.id, userId)}>
          Confirm & Close Out
        </ConfirmButton>
      </>
    )}
  </Alert>
)}

{rfi.hasManualResponse && rfi.manualResponseConfirmedAt && (
  <Alert severity="success">
    ✓ Manual response confirmed and closed out on {formatDate(rfi.manualResponseConfirmedAt)}
  </Alert>
)}
```

### 4. Send to ACC Button - Permission Check

```tsx
const SendToAccButton = ({ rfi, user }) => {
  const membership = user.projectMemberships.find(m => m.projectId === rfi.projectId);
  
  const canSendToAcc = membership?.role === 'PROJECT_ADMIN' || 
                       membership?.canSendToAcc === true;
  
  if (!canSendToAcc) {
    return (
      <Tooltip title="Only project admins can send responses to ACC">
        <span>
          <Button disabled>Send to ACC</Button>
        </span>
      </Tooltip>
    );
  }
  
  return (
    <Button onClick={() => handleSendToAcc(rfi.id)}>
      Send to ACC
    </Button>
  );
};
```

---

## Testing Checklist

### Permission Tests

- [ ] Admin can send RFI response to ACC
- [ ] Admin can send Submittal response to ACC
- [ ] Reviewer CANNOT send RFI response (gets error)
- [ ] Reviewer CANNOT send Submittal response (gets error)
- [ ] User with `canSendToAcc=true` CAN send responses
- [ ] Permission check logged when violated

### Manual Response Detection Tests

- [ ] Add response in ACC website for RFI
- [ ] Trigger sync (wait 15 min or manual sync)
- [ ] Verify `hasManualResponse=true` in database
- [ ] Verify `manualResponseData` contains correct JSON
- [ ] Verify detection logged
- [ ] Response appears in pending list

### Confirmation Tests

- [ ] Admin can confirm manual RFI response
- [ ] Admin can confirm manual Submittal response
- [ ] Non-admin CANNOT confirm (gets error)
- [ ] Confirmation sets `manualResponseConfirmedAt`
- [ ] Confirmation changes `internalStatus` to CLOSED
- [ ] Audit log created with `CONFIRM_MANUAL_RESPONSE`
- [ ] Status history created
- [ ] Item removed from pending list after confirmation

### Edge Case Tests

- [ ] Attempt to confirm already-confirmed response (error)
- [ ] Attempt to confirm RFI without manual response (error)
- [ ] Response modified in ACC after detection (updates data)
- [ ] Malformed response data (error handled gracefully)

---

## Migration Script (If Needed)

If you have existing data, add the new fields with defaults:

```sql
-- Add new columns to Rfi table
ALTER TABLE "Rfi" 
  ADD COLUMN "hasManualResponse" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "manualResponseDetectedAt" TIMESTAMP,
  ADD COLUMN "manualResponseData" TEXT,
  ADD COLUMN "manualResponseConfirmedBy" TEXT,
  ADD COLUMN "manualResponseConfirmedAt" TIMESTAMP;

-- Add new columns to Submittal table
ALTER TABLE "Submittal" 
  ADD COLUMN "hasManualResponse" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "manualResponseDetectedAt" TIMESTAMP,
  ADD COLUMN "manualResponseData" TEXT,
  ADD COLUMN "manualResponseConfirmedBy" TEXT,
  ADD COLUMN "manualResponseConfirmedAt" TIMESTAMP;
```

Prisma will handle this automatically when you run:
```bash
npx prisma migrate dev --name add_manual_response_detection
```

---

## Documentation Files

1. **[MANUAL_RESPONSE_DETECTION.md](MANUAL_RESPONSE_DETECTION.md)** - Complete feature documentation
2. **This file** - Implementation summary and technical reference

---

## Summary

**✅ Implemented:**
- Admin-only permission checks for sending responses to ACC
- Manual response detection during every sync
- Database fields to track manual responses
- Admin confirmation functions with full audit trail
- Comprehensive error handling and validation

**⏭️ Next Steps:**
1. Run Prisma migration to add new database fields
2. Create API endpoints for frontend
3. Build UI components for manual response review
4. Add dashboard alert badge
5. Test with real ACC responses

**Security:** All sensitive operations now require admin permissions and are fully audited.
