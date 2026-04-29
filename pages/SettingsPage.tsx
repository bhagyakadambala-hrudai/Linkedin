
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { 
  User as UserIcon, 
  Save, 
  Loader2, 
  Linkedin, 
  ExternalLink, 
  CheckCircle, 
  Mail, 
  AlertCircle,
  ShieldCheck,
  Link as LinkIcon,
  Zap
} from 'lucide-react';
import { getSupabaseSettings, requireSessionUserId, saveSettings } from '../lib/api';
import { User } from '../types';
import { supabase } from '../lib/supabase';

export const SettingsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connectingLinkedIn, setConnectingLinkedIn] = useState(false);
  const [disconnectingLinkedIn, setDisconnectingLinkedIn] = useState(false);
  const [success, setSuccess] = useState(false);
  const [linkedInSuccess, setLinkedInSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [authReady, setAuthReady] = useState(false);

  const [formData, setFormData] = useState<Partial<User>>({
    name: '',
    email: '',
    role: '',
    skills: [],
    topics: [],
    tone: 'Professional and Insightful',
    notifications: true,
    linkedInConnected: false
  });

  const getOAuthParams = () => {
    const fromRouter = new URLSearchParams(searchParams.toString());

    if (typeof window === 'undefined') {
      return fromRouter;
    }

    const hash = window.location.hash || '';
    const queryIndex = hash.indexOf('?');
    if (queryIndex === -1) {
      return fromRouter;
    }

    const hashQuery = hash.slice(queryIndex + 1);
    return new URLSearchParams(hashQuery);
  };

  const fetchSettings = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      setAuthReady(true);
      if (!user?.id) {
        setUserId('');
        setFormData(prev => ({
          ...prev,
          name: '',
          email: '',
          role: '',
          skills: [],
          topics: [],
          linkedInConnected: false,
        }));
        setLoading(false);
        return;
      }
      setUserId(user.id);
      const data: any = await getSupabaseSettings(user.id);
      setFormData(prev => ({
        ...prev,
        ...data,
        name: (user.user_metadata?.full_name as string) || data.name || 'User',
        email: user.email ?? '',
        linkedInConnected: data.linkedInConnected || false
      }));
    } catch (e) {
      console.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  const initialFetchDoneRef = useRef(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = window.location.hash.includes("?")
      ? new URLSearchParams(window.location.hash.split("?")[1] || "")
      : new URLSearchParams();
    const isLinkedInConnected = urlParams.get("linkedin") === "connected" || hashParams.get("linkedin") === "connected";
    if (isLinkedInConnected) {
      const reloadKey = "li_connected_reload_done";
      if (typeof sessionStorage !== "undefined" && !sessionStorage.getItem(reloadKey)) {
        sessionStorage.setItem(reloadKey, "1");
        window.location.reload();
        return;
      }
      sessionStorage.removeItem(reloadKey);
      fetchSettings();
      const cleanHash = (window.location.hash || "#/app/settings").split("?")[0];
      window.history.replaceState({}, "", window.location.pathname + window.location.search + cleanHash);
    }
  }, [fetchSettings]);

  useEffect(() => {
    const restoreSession = async () => {
      try {
        await fetchSettings();
      } catch (err) {
        console.error('Error restoring session:', err);
        setAuthReady(true);
      }
    };

    if (!initialFetchDoneRef.current) {
      initialFetchDoneRef.current = true;
      restoreSession();
    }

    const oauthParams = getOAuthParams();
    const oauthSuccess = oauthParams.get('success') === 'true' || oauthParams.get('linkedin_connected') === 'true';
    const oauthError = oauthParams.get('error');
    const oauthPending = localStorage.getItem('li_oauth_pending') === 'true';

    if (oauthSuccess && oauthPending) {
      setError(null);
      setLinkedInSuccess(true);
      setTimeout(() => setLinkedInSuccess(false), 5000);
      localStorage.removeItem('li_return_path');
      localStorage.removeItem('li_auth_state');
      localStorage.removeItem('li_oauth_pending');
      setTimeout(() => fetchSettings(), 300);

      if (typeof window !== 'undefined') {
        const cleanPath = window.location.hash?.split('?')[0] || '#/app/settings';
        window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}${cleanPath}`);
      }
    }

    if (oauthError) {
      setLinkedInSuccess(false);
      setError(oauthParams.get('msg') || 'Failed to connect LinkedIn');
      localStorage.removeItem('li_oauth_pending');
    }

    // Handle LinkedIn data passed from server (for networks where server can't reach Supabase)
    const linkedinDataParam = oauthParams.get('linkedin_data');
    if (linkedinDataParam && oauthPending) {
      (async () => {
        try {
          const decoded = JSON.parse(atob(decodeURIComponent(linkedinDataParam)));
          const sessionUserId = await requireSessionUserId();
          if (decoded.user_id !== sessionUserId) {
            setError('LinkedIn connection does not match the signed-in user. Please sign in again.');
            return;
          }
          const { data: existingLi, error: fetchLiErr } = await supabase
            .from('profiles')
            .select('*')
            .eq('user_id', sessionUserId)
            .maybeSingle();
          if (fetchLiErr) throw fetchLiErr;

          const profileData = {
            ...(existingLi || {}),
            user_id: sessionUserId,
            linkedin_token: decoded.token,
            email: decoded.email,
            linkedin_profile_url: decoded.profile_id,
            linkedin_connected: true,
            updated_at: new Date().toISOString(),
          };
          console.log('Saving profile for user:', sessionUserId);
          console.log('Saving profile:', profileData);

          const { error: upsertError } = await supabase
            .from('profiles')
            .upsert(profileData, { onConflict: 'user_id' });

          if (upsertError) {
            console.error('Failed to save LinkedIn data:', upsertError);
            setError('Failed to save LinkedIn connection: ' + upsertError.message);
          } else {
            console.log('LinkedIn data saved successfully');
            setLinkedInSuccess(true);
            setTimeout(() => setLinkedInSuccess(false), 5000);
            setTimeout(() => fetchSettings(), 300);
          }
        } catch (err: any) {
          console.error('Error processing LinkedIn data:', err);
          setError('Failed to process LinkedIn data: ' + err.message);
        } finally {
          localStorage.removeItem('li_return_path');
          localStorage.removeItem('li_auth_state');
          localStorage.removeItem('li_oauth_pending');
          
          // Clean URL
          if (typeof window !== 'undefined') {
            const cleanPath = window.location.hash?.split('?')[0] || '#/app/settings';
            window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}${cleanPath}`);
          }
        }
      })();
    }

    if (oauthSuccess && !oauthPending) {
      if (typeof window !== 'undefined') {
        const cleanPath = window.location.hash?.split('?')[0] || '#/app/settings';
        window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}${cleanPath}`);
      }
      setTimeout(() => fetchSettings(), 200);
    }

    // Always refetch profile when returning from LinkedIn OAuth so UI shows "Connected" immediately
    if (oauthParams.get('linkedin_connected') === 'true') {
      fetchSettings();
    }
  }, [searchParams, fetchSettings]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      void fetchSettings();
    });
    return () => subscription.unsubscribe();
  }, [fetchSettings]);

  const handleConnectLinkedIn = async () => {
    const clientId = import.meta.env.VITE_LINKEDIN_CLIENT_ID;
    if (!clientId) {
      alert("LinkedIn client ID not configured");
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    const email = user?.email;
    const userId = user?.id;
    if (!email || !userId) {
      setError("Please sign in to connect LinkedIn.");
      return;
    }

    const state = btoa(JSON.stringify({
      email,
      userId,
      appOrigin: window.location.origin,
      returnPath: "/app/settings",
    }));
    const redirectUri = encodeURIComponent(
      "https://linkedin-theta-seven.vercel.app/api/linkedin/callback"
    );
    const scope = encodeURIComponent("openid profile email w_member_social");
    const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${encodeURIComponent(state)}`;

    console.log("Redirecting to LinkedIn...");
    window.location.replace(url);
  };

  const handleDisconnectLinkedIn = async () => {
    setDisconnectingLinkedIn(true);
    setError(null);
    try {
      const sessionUserId = await requireSessionUserId();
      const { data: existingDc, error: fetchDcErr } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", sessionUserId)
        .maybeSingle();
      if (fetchDcErr) throw fetchDcErr;
      const disconnectRow = {
        ...(existingDc || {}),
        user_id: sessionUserId,
        linkedin_token: null,
        linkedin_connected: false,
        updated_at: new Date().toISOString(),
      };
      console.log("Saving profile for user:", sessionUserId);
      console.log("Saving profile:", { linkedin_token: null, linkedin_connected: false });
      const { error: updateError } = await supabase
        .from("profiles")
        .upsert(disconnectRow, { onConflict: "user_id" });
      if (updateError) throw updateError;
      await fetchSettings();
    } catch (err: any) {
      setError("Failed to disconnect: " + (err?.message || "Unknown error"));
    } finally {
      setDisconnectingLinkedIn(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveSettings(formData);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      await fetchSettings();
    } catch (e: any) {
      console.error('Settings save error:', e);
      setError("Failed to save settings: " + (e.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
            <p className="text-gray-500">Manage your profile and account connections.</p>
          </div>
          {success && (
            <div className="flex items-center gap-2 text-green-600 bg-green-50 px-4 py-2 rounded-lg border border-green-100 shadow-sm animate-fade-in">
              <CheckCircle className="w-4 h-4" />
              <span className="text-sm font-medium">Changes saved successfully!</span>
            </div>
          )}
        </div>

        {linkedInSuccess && (
          <div className="p-4 bg-green-50 border border-green-100 text-green-700 rounded-xl flex items-center gap-3 animate-fade-in">
            <CheckCircle className="w-5 h-5" />
            <p className="text-sm font-medium">LinkedIn connected successfully.</p>
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-100 text-red-700 rounded-xl flex items-center gap-3 animate-shake">
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-6 pb-20">
          <Card title="Personal Profile">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-indigo-500 outline-none text-sm"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                  <input
                    type="email"
                    readOnly
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-600 outline-none text-sm"
                    value={formData.email}
                    title="Email is managed by your account sign-in"
                  />
                </div>
              </div>
            </div>
          </Card>

          <Card title="Connections" description="Link your LinkedIn account to enable automated posting.">
            <div className="p-4 border border-gray-100 rounded-xl bg-white shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${formData.linkedInConnected ? 'bg-green-50' : 'bg-[#0077b5]/10'}`}>
                  <Linkedin className={`w-5 h-5 ${formData.linkedInConnected ? 'text-green-600' : 'text-[#0077b5]'}`} />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">LinkedIn Profile</p>
                  <p className="text-xs text-gray-500">
                    Status: {formData.linkedInConnected ? <span className="text-green-600 font-bold">Connected & Automated</span> : 'Not Linked'}
                  </p>
                </div>
              </div>
              {formData.linkedInConnected ? (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" type="button" className="gap-2" onClick={handleConnectLinkedIn} disabled={loading || !authReady}>
                    {connectingLinkedIn ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                    Reconnect
                  </Button>
                  <Button variant="outline" size="sm" type="button" className="gap-2 text-red-600 border-red-200 hover:bg-red-50" onClick={handleDisconnectLinkedIn} disabled={loading || !authReady || disconnectingLinkedIn}>
                    {disconnectingLinkedIn ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Disconnect
                  </Button>
                </div>
              ) : (
                <Button variant="primary" size="sm" type="button" className="gap-2" onClick={handleConnectLinkedIn} disabled={loading || !authReady}>
                  {connectingLinkedIn ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                  Connect LinkedIn
                </Button>
              )}
            </div>
            
            <div className="mt-4 p-3 bg-indigo-50 border border-indigo-100 rounded-lg flex items-start gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-600 shrink-0" />
              <p className="text-xs text-indigo-700">
                You will be redirected to LinkedIn to authorize the Agent. An access token will be securely stored to automate your posts.
              </p>
            </div>
          </Card>

          <Card title="Expertise Context">
             <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role / Designation</label>
                <input
                  type="text"
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-indigo-500 outline-none text-sm"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Content Topics (Comma Separated)</label>
                <input
                  type="text"
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-indigo-500 outline-none text-sm"
                  value={formData.topics?.join(', ')}
                  onChange={(e) => setFormData({ ...formData, topics: e.target.value.split(',').map(s => s.trim()) })}
                />
              </div>
            </div>
          </Card>

          <div className="flex justify-end pt-6">
            <Button size="lg" disabled={saving} className="min-w-[150px] gap-2 shadow-lg shadow-indigo-100">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </Layout>
  );
};
