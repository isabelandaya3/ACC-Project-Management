'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error') || 'unknown_error';

  const errorMessages: Record<string, string> = {
    missing_params: 'Missing required parameters. Please try again.',
    invalid_state: 'Invalid or expired session. Please try again.',
    callback_failed: 'Authentication callback failed. Please try again.',
    access_denied: 'Access was denied. Please grant the required permissions.',
    unknown_error: 'An unknown error occurred. Please try again.',
  };

  const message = errorMessages[error] || errorMessages.unknown_error;

  return (
    <div className="container">
      <div className="auth-card card">
        <div style={{ fontSize: '3rem', marginBottom: '1rem', color: 'var(--error)' }}>✕</div>
        <h2>Authentication Failed</h2>
        <p style={{ marginBottom: '1rem' }}>{message}</p>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '2rem' }}>
          Error code: {error}
        </p>
        <Link href="/" className="btn btn-primary">
          Try Again
        </Link>
      </div>
    </div>
  );
}

export default function AuthError() {
  return (
    <Suspense fallback={
      <div className="container">
        <div className="auth-card card">
          <div className="loading" style={{ justifyContent: 'center' }}>
            <div className="spinner" />
            <span>Loading...</span>
          </div>
        </div>
      </div>
    }>
      <ErrorContent />
    </Suspense>
  );
}
