'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AuthSuccess() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to home page after a short delay
    const timer = setTimeout(() => {
      router.push('/');
    }, 1500);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="container">
      <div className="auth-card card">
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✓</div>
        <h2>Authentication Successful</h2>
        <p>You have been successfully connected to Autodesk.</p>
        <div className="loading" style={{ justifyContent: 'center', marginTop: '1rem' }}>
          <div className="spinner" />
          <span>Redirecting...</span>
        </div>
      </div>
    </div>
  );
}
