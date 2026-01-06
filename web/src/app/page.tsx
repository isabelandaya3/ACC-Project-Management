'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  getAuthStatus,
  getLoginUrl,
  getLogoutUrl,
  getProjects,
  getProjectFolders,
  runSync,
  testUpload,
  type AuthStatus,
  type HubWithProjects,
  type ProjectListItem,
  type FolderItem,
  type SyncRunResponse,
  type UploadTestResponse,
} from '@/lib/api';

export default function Home() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [hubs, setHubs] = useState<HubWithProjects[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ProjectListItem | null>(null);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<FolderItem | null>(null);
  const [syncResult, setSyncResult] = useState<SyncRunResponse | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadTestResponse | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check auth status on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    setLoading(true);
    const result = await getAuthStatus();
    if (result.success && result.data) {
      setAuthStatus(result.data);
    }
    setLoading(false);
  };

  // Load projects when authenticated
  useEffect(() => {
    if (authStatus?.authenticated) {
      loadProjects();
    }
  }, [authStatus?.authenticated]);

  const loadProjects = async () => {
    setProjectsLoading(true);
    setError(null);
    const result = await getProjects();
    if (result.success && result.data) {
      setHubs(result.data);
    } else {
      setError(result.error || 'Failed to load projects');
    }
    setProjectsLoading(false);
  };

  // Load folders when project is selected
  const handleSelectProject = useCallback(async (project: ProjectListItem) => {
    setSelectedProject(project);
    setSelectedFolder(null);
    setSyncResult(null);
    setUploadResult(null);
    setFoldersLoading(true);
    setError(null);

    const result = await getProjectFolders(project.hubId, project.id);
    if (result.success && result.data) {
      setFolders(result.data);
    } else {
      setError(result.error || 'Failed to load folders');
    }
    setFoldersLoading(false);
  }, []);

  // Run sync
  const handleRunSync = async () => {
    if (!selectedProject) return;
    
    setSyncLoading(true);
    setSyncResult(null);
    setError(null);

    const result = await runSync(selectedProject.id, ['rfi', 'submittal']);
    if (result.success && result.data) {
      setSyncResult(result.data);
    } else {
      setError(result.error || 'Sync failed');
    }
    setSyncLoading(false);
  };

  // Test upload
  const handleTestUpload = async () => {
    if (!selectedProject || !selectedFolder) return;
    
    setUploadLoading(true);
    setUploadResult(null);
    setError(null);

    const result = await testUpload(
      selectedProject.id,
      selectedFolder.id,
      `test-upload-${Date.now()}.txt`,
      `Test file uploaded at ${new Date().toISOString()}\nProject: ${selectedProject.name}\nFolder: ${selectedFolder.name}`
    );
    if (result.success && result.data) {
      setUploadResult(result.data);
    } else {
      setError(result.error || 'Upload failed');
    }
    setUploadLoading(false);
  };

  // Loading state
  if (loading) {
    return (
      <div className="container">
        <div className="auth-card">
          <div className="loading">
            <div className="spinner" />
            <span>Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!authStatus?.authenticated) {
    return (
      <div className="container">
        <div className="auth-card card">
          <h2>ACC Integration MVP</h2>
          <p>Connect your Autodesk account to get started.</p>
          <a href={getLoginUrl()} className="btn btn-primary">
            Connect Autodesk
          </a>
        </div>
      </div>
    );
  }

  // Authenticated
  return (
    <>
      <header className="header">
        <h1>ACC Integration MVP</h1>
        <div className="header-actions">
          <div className="user-info">
            <div className="user-avatar">
              {authStatus.name?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="user-details">
              <div className="name">{authStatus.name || 'User'}</div>
              <div className="email">{authStatus.email}</div>
            </div>
          </div>
          <a href={getLogoutUrl()} className="btn btn-secondary">
            Logout
          </a>
        </div>
      </header>

      <div className="container">
        {error && (
          <div className="alert error">
            {error}
            <button onClick={() => setError(null)} style={{ marginLeft: '1rem' }}>×</button>
          </div>
        )}

        <div className="section-header">
          <h2>Projects</h2>
          <button 
            className="btn btn-secondary" 
            onClick={loadProjects}
            disabled={projectsLoading}
          >
            {projectsLoading ? (
              <>
                <div className="spinner" style={{ width: 16, height: 16 }} />
                Loading...
              </>
            ) : (
              'Refresh'
            )}
          </button>
        </div>

        {projectsLoading && hubs.length === 0 ? (
          <div className="card">
            <div className="loading">
              <div className="spinner" />
              <span>Loading projects...</span>
            </div>
          </div>
        ) : hubs.length === 0 ? (
          <div className="card empty-state">
            <h3>No projects found</h3>
            <p>Make sure your Autodesk account has access to ACC projects.</p>
          </div>
        ) : (
          <div className="card">
            <div className="project-list">
              {hubs.map((hub) => (
                <div key={hub.id} className="hub-section">
                  <div className="hub-header">
                    <h3>{hub.name}</h3>
                    <span>{hub.region} • {hub.projects.length} projects</span>
                  </div>
                  {hub.projects.map((project) => (
                    <div
                      key={project.id}
                      className={`project-item ${selectedProject?.id === project.id ? 'selected' : ''}`}
                      onClick={() => handleSelectProject(project)}
                      style={{
                        cursor: 'pointer',
                        borderColor: selectedProject?.id === project.id ? 'var(--accent)' : undefined,
                      }}
                    >
                      <div className="project-info">
                        <h4>{project.name}</h4>
                        <p>{project.projectType}</p>
                      </div>
                      {selectedProject?.id === project.id && (
                        <span className="status-badge success">Selected</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {selectedProject && (
          <>
            <div className="section-header" style={{ marginTop: '2rem' }}>
              <h2>Actions for {selectedProject.name}</h2>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {/* Sync Card */}
              <div className="card">
                <div className="card-header">
                  <h3>Sync RFIs & Submittals</h3>
                </div>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  Polls for new RFIs and Submittals (stub implementation for MVP).
                </p>
                <button
                  className="btn btn-primary"
                  onClick={handleRunSync}
                  disabled={syncLoading}
                >
                  {syncLoading ? (
                    <>
                      <div className="spinner" style={{ width: 16, height: 16 }} />
                      Running...
                    </>
                  ) : (
                    'Run Sync Now'
                  )}
                </button>

                {syncResult && (
                  <div className="results-panel">
                    <pre>{JSON.stringify(syncResult, null, 2)}</pre>
                  </div>
                )}
              </div>

              {/* Upload Card */}
              <div className="card">
                <div className="card-header">
                  <h3>Test File Upload</h3>
                </div>
                
                {foldersLoading ? (
                  <div className="loading">
                    <div className="spinner" />
                    <span>Loading folders...</span>
                  </div>
                ) : folders.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)' }}>No folders found in this project.</p>
                ) : (
                  <>
                    <div className="form-group">
                      <label>Select Folder</label>
                      <select
                        value={selectedFolder?.id || ''}
                        onChange={(e) => {
                          const folder = folders.find(f => f.id === e.target.value);
                          setSelectedFolder(folder || null);
                        }}
                      >
                        <option value="">-- Select a folder --</option>
                        {folders.map((folder) => (
                          <option key={folder.id} value={folder.id}>
                            {folder.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      className="btn btn-primary"
                      onClick={handleTestUpload}
                      disabled={uploadLoading || !selectedFolder}
                    >
                      {uploadLoading ? (
                        <>
                          <div className="spinner" style={{ width: 16, height: 16 }} />
                          Uploading...
                        </>
                      ) : (
                        'Upload Test File'
                      )}
                    </button>
                  </>
                )}

                {uploadResult && (
                  <div className="results-panel">
                    <div className="alert success" style={{ marginTop: '1rem' }}>
                      File uploaded successfully!
                    </div>
                    <pre>{JSON.stringify(uploadResult, null, 2)}</pre>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
