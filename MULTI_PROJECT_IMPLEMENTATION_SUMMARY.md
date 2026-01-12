# Multi-ACC-Project Implementation - Summary

## Changes Completed

### 1. Database Schema (schema.prisma)
✅ Already had multi-project support built in:
- `Project` → `AccProjectLink[]` (one-to-many relationship)
- `AccProjectLink.folderName` field for network folder structure
- `Rfi.accProjectLinkId` and `Submittal.accProjectLinkId` foreign keys
- Unique constraints updated: `@@unique([accProjectLinkId, accRfiId])`

### 2. File Service (fileService.ts)
✅ **Updated** to support ACC project folder structure:

**Function Signature Changes:**
```typescript
// OLD
buildItemFolderPath(basePath, itemType, itemNumber)
ensureItemFolder(basePath, itemType, itemNumber)
listItemFiles(basePath, itemType, itemNumber)
saveFileToItemFolder(basePath, itemType, itemNumber, fileName, buffer)

// NEW - Added accProjectFolder parameter
buildItemFolderPath(basePath, accProjectFolder, itemType, itemNumber)
ensureItemFolder(basePath, accProjectFolder, itemType, itemNumber)
listItemFiles(basePath, accProjectFolder, itemType, itemNumber)
saveFileToItemFolder(basePath, accProjectFolder, itemType, itemNumber, fileName, buffer)
```

**New Path Structure:**
```
\\server\share\Project\AccProjectName\RFIs\RFI-0001\
\\server\share\Project\AccProjectName\Submittals\SUB-0001\
```

### 3. Enhanced Sync Service (enhancedSyncService.ts)
✅ **Updated** to sync multiple ACC projects per internal project:

**syncAllProjects():**
- Changed from `accProjectLink` (singular) to `accProjectLinks` (array)
- Now calls `syncProject()` which handles multiple links

**syncProject():**
- Loads all `accProjectLinks` for the project
- Loops through each link and syncs if enabled
- Each link syncs independently with its own error handling

**syncProjectModule():**
- Now accepts `accProjectLinkId` parameter
- Fetches specific ACC project link
- Passes `accProjectLink` to sync functions

**processRfi() and processSubmittal():**
- Updated `where` clause: `accProjectLinkId_accRfiId` instead of `projectId_accRfiId`
- Creates records with `accProjectLinkId` field
- Unique constraint now scoped to ACC project link

**File downloads:**
- Updated calls to `saveFileToItemFolder()` to include `accProjectLink.folderName`
- PDFs saved to correct folder structure

### 4. Project Service (projectService.ts)
✅ **Added** new functions for managing ACC project links:

**New Functions:**
- `addAccProjectLink()` - Link a new ACC project to internal project
- `updateAccProjectLink()` - Update sync settings or folder name
- `removeAccProjectLink()` - Remove link (blocks if RFIs/Submittals exist)
- `listAccProjectLinks()` - Get all links with counts
- `getAccProjectLink()` - Get single link details

**Updated Functions:**
- `getProjectById()` - Now includes `accProjectLinks` array with counts

### 5. Documentation
✅ **Created** comprehensive guide:
- [MULTI_PROJECT_SETUP.md](./MULTI_PROJECT_SETUP.md) - Full implementation guide

---

## Folder Structure Example

For a Hospital project with two ACC projects (Building A and Building B):

```
\\server\share\Hospital\
├── Building-A\
│   ├── RFIs\
│   │   ├── RFI-0001\
│   │   │   ├── RFI-0001.pdf
│   │   │   └── response.pdf
│   │   └── RFI-0002\
│   │       └── RFI-0002.pdf
│   └── Submittals\
│       ├── SUB-0001\
│       │   └── SUB-0001.pdf
│       └── SUB-0002\
│           └── SUB-0002.pdf
└── Building-B\
    ├── RFIs\
    │   └── RFI-0001\
    │       └── RFI-0001.pdf
    └── Submittals\
        └── SUB-0001\
            └── SUB-0001.pdf
```

---

## How It Works

### Admin Setup Workflow

1. **Create internal project:**
   ```typescript
   const project = await createProject({
     name: 'Hospital Project',
     networkBasePath: '\\\\server\\share\\Hospital'
   }, userId);
   ```

2. **Add first ACC project:**
   ```typescript
   await addAccProjectLink(
     project.id,
     'acc-project-id-1',
     'acc-hub-id',
     'Building A - North Tower',  // Display name
     'Building-A',                 // Folder name
     oauthTokenId
   );
   ```

3. **Add second ACC project:**
   ```typescript
   await addAccProjectLink(
     project.id,
     'acc-project-id-2',
     'acc-hub-id',
     'Building B - South Tower',
     'Building-B',
     oauthTokenId
   );
   ```

4. **Sync all linked ACC projects:**
   ```typescript
   await syncProject(project.id, 'MANUAL');
   ```

### User Workflow in Application

1. User selects **one internal project** (e.g., "Hospital Project")
2. System loads **all linked ACC projects** (Building A, Building B)
3. RFI/Submittal list shows **combined items from all ACC projects**
4. Each item displays which ACC project it belongs to
5. Internal workflow (assign, review, QC) works the same regardless of source
6. Files are stored in appropriate ACC project folder on network share

---

## Key Changes Summary

| Component | Change Type | Description |
|-----------|-------------|-------------|
| `schema.prisma` | ✅ Already Done | Multi-project support exists |
| `fileService.ts` | ✅ Updated | Added `accProjectFolder` parameter to all functions |
| `enhancedSyncService.ts` | ✅ Updated | Loop through multiple ACC project links |
| `projectService.ts` | ✅ Updated + New | Added ACC link management functions |
| `MULTI_PROJECT_SETUP.md` | ✅ Created | Complete setup guide |

---

## What's Still Needed

### Backend:
1. **accClient.ts** - Implement ACC API functions:
   - `getValidToken()`
   - `listRFIs()`
   - `listSubmittals()`
   - `downloadFile()`
   - Response posting functions

2. **API Routes** - Create REST endpoints:
   - `POST /api/projects/:id/acc-links`
   - `GET /api/projects/:id/acc-links`
   - `PATCH /api/projects/:id/acc-links/:linkId`
   - `DELETE /api/projects/:id/acc-links/:linkId`

3. **Update Other Services** - Check if rfiService, submittalService, responseService need updates

### Frontend:
1. **Admin UI** - Project settings page to manage ACC links
2. **RFI/Submittal Lists** - Display source ACC project
3. **Filters** - Filter by ACC project link
4. **Project Dashboard** - Show all linked ACC projects

### Testing:
1. Create test project with multiple ACC links
2. Test sync with multiple ACC projects
3. Verify folder structure creation
4. Test file download to correct folders
5. Test add/remove ACC links

---

## Migration Notes

**For Existing Single-Project Data:**
- Old relation: `Project.accProjectLink` (singular)
- New relation: `Project.accProjectLinks` (plural array)
- Prisma migration should handle this automatically
- Existing AccProjectLink records will continue to work
- Can add additional links to existing projects

**Backward Compatibility:**
- Schema maintains all existing constraints
- Unique constraints updated to use `accProjectLinkId` instead of `projectId`
- Existing queries need update from `accProjectLink` to `accProjectLinks[0]` or loop

---

## Benefits

1. **Unified Workflow** - Manage multiple ACC projects in one interface
2. **Organized Files** - Separate folders for each ACC project
3. **Flexible Configuration** - Enable/disable sync per ACC project
4. **Scalable** - Add unlimited ACC projects to internal project
5. **Independent Sync** - One failing ACC project doesn't block others

---

## Example Query

**Get all RFIs from all ACC projects for one internal project:**

```typescript
const rfis = await prisma.rfi.findMany({
  where: { projectId: 'internal-project-id' },
  include: {
    accProjectLink: {
      select: {
        accProjectName: true,
        folderName: true,
      },
    },
  },
  orderBy: { createdAt: 'desc' },
});

// Each RFI shows which ACC project it came from
rfis.forEach(rfi => {
  console.log(`${rfi.accNumber} from ${rfi.accProjectLink.accProjectName}`);
});
```

**Filter by specific ACC project:**

```typescript
const rfis = await prisma.rfi.findMany({
  where: { 
    projectId: 'internal-project-id',
    accProjectLinkId: 'specific-link-id',
  },
});
```

---

## Next Steps

1. ✅ Schema supports multi-project (already done)
2. ✅ File service updated (completed)
3. ✅ Sync service updated (completed)
4. ✅ Project service updated (completed)
5. ✅ Documentation created (completed)
6. ⏭️ Implement ACC API client functions
7. ⏭️ Create REST API routes
8. ⏭️ Build frontend admin UI
9. ⏭️ Add filters and grouping in RFI/Submittal lists
10. ⏭️ Test with real ACC projects
