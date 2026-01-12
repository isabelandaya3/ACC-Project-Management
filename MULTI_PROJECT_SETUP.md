# Multi-ACC-Project Configuration Guide

## Overview

The system supports linking **multiple ACC projects** to a single internal project. This enables:

- Unified workflow management across multiple ACC projects
- Separate network folder structure for each ACC project
- Combined view of all RFIs and Submittals in one interface
- Individual sync settings per ACC project link

## Folder Structure

When multiple ACC projects are linked, the network folder structure is organized as follows:

```
\\server\share\ProjectName\
├── AccProject1\
│   ├── RFIs\
│   │   ├── RFI-0001\
│   │   │   └── RFI-0001.pdf
│   │   ├── RFI-0002\
│   │   │   └── RFI-0002.pdf
│   ├── Submittals\
│   │   ├── SUB-0001\
│   │   │   └── SUB-0001.pdf
│   │   ├── SUB-0002\
│   │   │   └── SUB-0002.pdf
├── AccProject2\
│   ├── RFIs\
│   │   ├── RFI-0001\
│   │   └── RFI-0002\
│   ├── Submittals\
│   │   ├── SUB-0001\
│   │   └── SUB-0002\
```

Each ACC project has its own top-level folder (named via `folderName` field), maintaining separation for file organization while combining workflows in the application.

## Database Structure

### AccProjectLink Table

Each link between an internal project and an ACC project is stored in the `AccProjectLink` table:

```prisma
model AccProjectLink {
  id              String   @id @default(cuid())
  projectId       String   // Internal project ID
  accProjectId    String   // ACC project ID (from Autodesk)
  accHubId        String   // ACC hub ID
  accProjectName  String   // Human-readable ACC project name
  folderName      String   // Network folder name (e.g., "Building-A")
  oauthTokenId    String   // OAuth token for API access
  syncRfis        Boolean  @default(true)
  syncSubmittals  Boolean  @default(true)
  
  project         Project  @relation(fields: [projectId], references: [id])
  oauthToken      OAuthToken @relation(fields: [oauthTokenId], references: [id])
  rfis            Rfi[]
  submittals      Submittal[]
  
  @@unique([projectId, accProjectId])
}
```

### RFI and Submittal Links

Each RFI and Submittal is linked to a specific ACC project link:

```prisma
model Rfi {
  id                String   @id @default(cuid())
  projectId         String   // Internal project
  accProjectLinkId  String   // Which ACC project this came from
  accRfiId          String   // ACC's RFI ID
  // ... other fields
  
  @@unique([accProjectLinkId, accRfiId])
}

model Submittal {
  id                String   @id @default(cuid())
  projectId         String   // Internal project
  accProjectLinkId  String   // Which ACC project this came from
  accSubmittalId    String   // ACC's Submittal ID
  // ... other fields
  
  @@unique([accProjectLinkId, accSubmittalId])
}
```

## Service Layer Functions

### Project Service

**Add an ACC Project Link:**

```typescript
import { addAccProjectLink } from './services/projectService';

const link = await addAccProjectLink(
  projectId,
  accProjectId,       // From ACC API
  accHubId,           // From ACC API
  'Building A',       // Display name
  'Building-A',       // Folder name (no spaces/special chars recommended)
  oauthTokenId,       // User's OAuth token
  true,               // syncRfis
  true                // syncSubmittals
);
```

**Update an ACC Project Link:**

```typescript
import { updateAccProjectLink } from './services/projectService';

await updateAccProjectLink(linkId, {
  folderName: 'Building-A-Updated',
  syncRfis: false,
  syncSubmittals: true,
});
```

**Remove an ACC Project Link:**

```typescript
import { removeAccProjectLink } from './services/projectService';

// Will fail if RFIs or Submittals exist for this link
await removeAccProjectLink(linkId);
```

**List All Links:**

```typescript
import { listAccProjectLinks } from './services/projectService';

const links = await listAccProjectLinks(projectId);
// Returns array with counts of RFIs and Submittals per link
```

### Sync Service

The sync service automatically handles multiple ACC project links:

```typescript
import { syncProject } from './services/enhancedSyncService';

// Syncs all ACC project links for this project
await syncProject(projectId, 'MANUAL');
```

**How it works:**

1. Fetches project with all `accProjectLinks`
2. For each link:
   - Syncs RFIs if `syncRfis` is enabled
   - Syncs Submittals if `syncSubmittals` is enabled
   - Downloads PDFs to correct folder: `\\basePath\folderName\RFIs\RFI-0001\`
3. Updates `project.lastSyncAt` timestamp

### File Service

The file service now requires the ACC project folder name:

```typescript
import { saveFileToItemFolder, listItemFiles } from './services/fileService';

// Save a file
const filePath = await saveFileToItemFolder(
  '\\\\server\\share\\Project',  // Base network path
  'Building-A',                   // ACC project folder name
  'RFI',                          // Item type
  'RFI-0001',                     // Item number
  'response.pdf',                 // File name
  pdfBuffer                       // File content
);
// Saves to: \\server\share\Project\Building-A\RFIs\RFI-0001\response.pdf

// List files
const files = await listItemFiles(
  '\\\\server\\share\\Project',
  'Building-A',
  'RFI',
  'RFI-0001'
);
```

## Workflow Integration

### In the Application UI

**Project Selection:**
- User selects one internal project
- All linked ACC projects are loaded

**RFI/Submittal List:**
- Shows combined list from all ACC project links
- Optional filter/grouping by ACC project
- Each item displays which ACC project it belongs to

**Item Details:**
- Show `accProjectLink.accProjectName` (e.g., "Building A")
- Display correct network folder path
- All internal workflow steps (assign, review, QC) work the same

### API Endpoints (Planned)

```
POST   /api/projects/:id/acc-links          - Add ACC project link
GET    /api/projects/:id/acc-links          - List all links
GET    /api/projects/:id/acc-links/:linkId  - Get link details
PATCH  /api/projects/:id/acc-links/:linkId  - Update link
DELETE /api/projects/:id/acc-links/:linkId  - Remove link

GET    /api/projects/:id/rfis               - List all RFIs (from all ACC links)
GET    /api/projects/:id/submittals         - List all Submittals (from all ACC links)
```

Query parameters for filtering by ACC project:
```
GET /api/projects/:id/rfis?accProjectLinkId=xyz
```

## Admin Setup Workflow

1. **Create Internal Project:**
   ```typescript
   const project = await createProject({
     name: 'Hospital Project',
     networkBasePath: '\\\\server\\share\\Hospital'
   }, userId);
   ```

2. **Connect First ACC Project:**
   ```typescript
   const link1 = await addAccProjectLink(
     project.id,
     'acc-project-id-1',
     'acc-hub-id',
     'Building A - North Tower',
     'Building-A',
     oauthTokenId
   );
   ```

3. **Connect Second ACC Project:**
   ```typescript
   const link2 = await addAccProjectLink(
     project.id,
     'acc-project-id-2',
     'acc-hub-id',
     'Building B - South Tower',
     'Building-B',
     oauthTokenId
   );
   ```

4. **Trigger Initial Sync:**
   ```typescript
   await syncProject(project.id, 'MANUAL');
   ```

5. **Verify Folder Structure:**
   - Check that `\\server\share\Hospital\Building-A\RFIs\` exists
   - Check that `\\server\share\Hospital\Building-B\RFIs\` exists
   - PDFs should be downloaded to appropriate folders

## Change Detection

Each RFI/Submittal maintains its own:
- `accDataHash` - Hash of ACC data for change detection
- `hasUnacknowledgedChange` - Flag for user notification
- `lastAccChangeAt` - Timestamp of last ACC change
- `changesSummary` - JSON describing what changed

This works independently across all ACC project links.

## Migration from Single ACC Project

If you have existing data with a single ACC project link:

1. The old `accProjectLink` relation is now `accProjectLinks[]`
2. Existing data should be preserved via Prisma migration
3. You can add additional ACC projects to existing internal projects
4. Folder structure will be created on first sync after adding new links

## Best Practices

1. **Folder Naming:**
   - Use descriptive, filesystem-safe names
   - Avoid spaces, special characters
   - Examples: `Building-A`, `Tower-North`, `Phase-1`

2. **ACC Project Selection:**
   - Only link ACC projects that share similar workflows
   - Keep unrelated ACC projects in separate internal projects

3. **Sync Settings:**
   - Enable/disable RFI or Submittal sync per ACC project link
   - Useful if some ACC projects only have RFIs

4. **Network Path Management:**
   - Ensure network share has sufficient storage
   - Set proper permissions for all users
   - Monitor disk space as multiple ACC projects accumulate files

## Troubleshooting

**Sync fails for one ACC project:**
- Check `accProjectLink.lastSyncStatus` and `lastSyncError`
- Each link syncs independently
- One failing link won't block others

**Files not appearing:**
- Verify `folderName` field is set correctly
- Check network path: `{networkBasePath}\{folderName}\RFIs\`
- Ensure sync is enabled for that link

**Duplicate ACC project link:**
- System prevents linking same ACC project twice to one internal project
- Unique constraint: `@@unique([projectId, accProjectId])`

## Future Enhancements

- [ ] Bulk ACC project import from ACC hub
- [ ] Cross-project reporting and analytics
- [ ] Automated folder name generation
- [ ] ACC project link templates
- [ ] Sync scheduling per link
