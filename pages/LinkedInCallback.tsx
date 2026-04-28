
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { startAgent } from '../lib/api';

export const LinkedInCallback: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMessage, setErrorMessage] = useState('');
  const returnPath = localStorage.getItem('li_return_path') || '/app/settings';

  useEffect(() => {
    const handleExchange = async () => {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');
      const storedState = localStorage.getItem('li_auth_state');

      if (error) {
        setStatus('error');
        setErrorMessage(searchParams.get('error_description') || 'Access denied by user.');
        return;
      }

      if (!code || state !== storedState) {
        setStatus('error');
        setErrorMessage('Security validation failed (State mismatch).');
        return;
      }

      try {
        const { getLinkedInRedirectUri } = await import('../lib/linkedin');
        const redirectUri = getLinkedInRedirectUri();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          throw new Error('Not signed in. Please sign in and try connecting LinkedIn again.');
        }

        const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
        const exchangeUrl = `${apiBase}/api/linkedin/exchange`;
        const exchangeRes = await fetch(exchangeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ code, redirect_uri: redirectUri }),
        });

        const exchangeJson = await exchangeRes.json().catch(() => ({}));
        if (!exchangeRes.ok || !exchangeJson?.success) {
          throw new Error(exchangeJson?.error || `Token exchange failed (${exchangeRes.status})`);
        }

        // Automatically start the agent now that we are connected
        const { data: authData } = await supabase.auth.getUser();
        if (authData?.user) {
             // We can trigger the agent now
             await startAgent({ id: authData.user.id, email: authData.user.email }).catch(console.error);
        }

        setStatus('success');
        localStorage.removeItem('li_auth_state');
        
        // Redirect back to the page they came from (Settings or Setup), default to Settings
        const returnPath = localStorage.getItem('li_return_path') || '/app/settings';
        localStorage.removeItem('li_return_path');
        setTimeout(() => navigate(`${returnPath}?success=true`), 2000);
      } catch (err: any) {
        console.error('LinkedIn OAuth Error:', err);
        setStatus('error');
        setErrorMessage(err.message);
      }
    };

    handleExchange();
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        {status === 'processing' && (
          <div className="space-y-4">
            <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto" />
            <h2 className="text-xl font-bold text-gray-900">Connecting to LinkedIn</h2>
            <p className="text-gray-500">Securing your access token and triggering agent. One moment...</p>
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-4 animate-fade-in">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
            <h2 className="text-xl font-bold text-gray-900">Success!</h2>
            <p className="text-gray-500">LinkedIn account connected successfully. Redirecting...</p>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-4 animate-fade-in">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
            <h2 className="text-xl font-bold text-gray-900">Connection Failed</h2>
            <p className="text-red-600 font-medium">{errorMessage}</p>
            <button
              onClick={() => {
                localStorage.removeItem('li_return_path');
                navigate(returnPath);
              }}
              className="mt-4 text-indigo-600 font-bold hover:underline"
            >
              {returnPath.includes('onboarding') ? 'Back to Setup' : 'Back to Settings'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
