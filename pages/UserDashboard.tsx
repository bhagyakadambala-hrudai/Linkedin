
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Card } from '../components/ui/Card';
import { CheckCircle, RefreshCw, FileText, Loader2, ArrowRight, Play, Square, Power, Send, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { getPosts, startAgent, stopAgent, getAgentStatus, triggerWebhook, getCurrentUserDisplayInfo, getSupabaseSettings } from '../lib/api';
import { supabase } from '../lib/supabase';
import { PLANS } from '../constants';

export const UserDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<any[]>([]);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [planId, setPlanId] = useState('starter');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAgentActive, setIsAgentActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [publishState, setPublishState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [publishMessage, setPublishMessage] = useState('');
  const [linkedinConnected, setLinkedinConnected] = useState(false);

  /**
   * Debounce / dedup guards for the Publish button.
   * - lastPublishAt: timestamp of the last successful trigger call
   * - publishInFlight: true while a request is in-flight (blocks concurrent clicks)
   * These live in refs so they don't cause re-renders.
   */
  const lastPublishAt = React.useRef<number>(0);
  const publishInFlight = React.useRef<boolean>(false);

  /** Minimum milliseconds between two publish triggers (10 seconds). */
  const PUBLISH_DEBOUNCE_MS = 10_000;

  const planInfo = PLANS.find(p => p.id === planId);

  const fetchData = useCallback(async () => {
    if (!authUserId) return;
    setLoading(true);
    try {
      const data = await getPosts(authUserId);
      
      // Filter unique posted logs strictly using status and deduplicating by URL/Content
      const uniquePosted = data
        .filter((post: any) => post.status === 'posted')
        .reduce((acc: any[], current: any) => {
          const isDuplicate = acc.find(item => 
            (item.post_url && item.post_url === current.post_url) || 
            (item.content === current.content)
          );
          if (!isDuplicate) acc.push(current);
          return acc;
        }, []);

      setJobs(uniquePosted);
      const status = await getAgentStatus();
      setIsAgentActive(status.status === 'running');
    } catch (e) {
      console.error('Dashboard sync failed:', e);
    } finally {
      setLoading(false);
    }
  }, [authUserId]);

  const loadDashboardUser = React.useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        setAuthUserId(null);
        setDisplayName('');
        setPlanId('starter');
        setLinkedinConnected(false);
        return;
      }
      setAuthUserId(user.id);
      const info = await getCurrentUserDisplayInfo();
      if (info) {
        setDisplayName(info.displayName);
        setPlanId(info.planId);
      }
      const settings = await getSupabaseSettings(user.id);
      setLinkedinConnected(settings.linkedInConnected ?? false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await loadDashboardUser();
    };
    void run();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      if (!cancelled) void loadDashboardUser();
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [loadDashboardUser]);

  useEffect(() => {
    if (authUserId) fetchData();
  }, [authUserId, fetchData]);

  const handleToggleAgent = async () => {
    if (!linkedinConnected && !isAgentActive) {
      alert("Connect LinkedIn first to enable automation. Go to Settings or Profile Setup to connect your account.");
      return;
    }
    setIsSyncing(true);
    try {
      if (isAgentActive) {
        await stopAgent();
        setIsAgentActive(false);
      } else {
        await startAgent({});
        setIsAgentActive(true);
        setTimeout(fetchData, 1500);
      }
    } catch (error: any) {
      alert(error?.message ?? 'Failed to update agent status.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handlePublish = async () => {
    // ── Dedup guard: block concurrent clicks ──────────────────────────────────
    if (publishInFlight.current) {
      console.warn('[handlePublish] Request already in-flight — ignoring duplicate click.');
      return;
    }

    // ── Debounce guard: prevent rapid re-triggers (10 s window) ───────────────
    const now = Date.now();
    if (now - lastPublishAt.current < PUBLISH_DEBOUNCE_MS) {
      const secondsLeft = Math.ceil((PUBLISH_DEBOUNCE_MS - (now - lastPublishAt.current)) / 1000);
      setPublishState('error');
      setPublishMessage(`Please wait ${secondsLeft}s before publishing again.`);
      setTimeout(() => { setPublishState('idle'); setPublishMessage(''); }, 3000);
      return;
    }

    try {
      console.log('[handlePublish] Publish button clicked — automation active:', isAgentActive);
      publishInFlight.current = true;
      setPublishState('loading');
      setPublishMessage('');

      /**
       * Always use triggerWebhook() — the secure, authenticated route that
       * fetches the full profile (role, skills, topics, linkedin_token,
       * linkedin_profile_id) from Supabase server-side and sends it all to
       * Make.com so the scenario can generate and post without a separate
       * Supabase lookup.
       */
      const result = await triggerWebhook();

      lastPublishAt.current = Date.now(); // record timestamp on every attempt
      setPublishState(result.success ? 'success' : 'error');
      setPublishMessage(result.message);

      setTimeout(() => {
        setPublishState('idle');
        setPublishMessage('');
      }, 5000);

      if (result.success) setTimeout(fetchData, 3000);
    } catch (e) {
      console.error('[handlePublish] Unexpected error:', e);
      setPublishState('error');
      setPublishMessage('Unexpected error. Please try again.');
    } finally {
      publishInFlight.current = false;
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Welcome, {displayName || 'User'}</h1>
            <p className="text-gray-500">
              Active on the <span className="font-bold text-indigo-600">{planInfo?.name || 'Starter'}</span> plan.
            </p>
          </div>
          <div className="flex items-center gap-3">
             <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border ${isAgentActive ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                <div className={`w-2 h-2 rounded-full ${isAgentActive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                {isAgentActive ? 'AUTOMATION ACTIVE' : 'AUTOMATION PAUSED'}
             </div>
             <Button variant="outline" onClick={fetchData} disabled={loading}>
               <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
             </Button>
             {/* Manual one-shot publish trigger — disabled when LinkedIn not connected */}
             <span title={!linkedinConnected ? 'Connect LinkedIn first' : undefined} className="inline-block">
               <Button
                 variant="primary"
                 onClick={handlePublish}
                 disabled={publishState === 'loading' || !linkedinConnected}
                 className={`gap-2 ${
                   publishState === 'success' ? 'bg-green-600 hover:bg-green-700 border-green-600' :
                   publishState === 'error'   ? 'bg-red-600 hover:bg-red-700 border-red-600' : ''
                 } ${!linkedinConnected ? 'opacity-60 cursor-not-allowed' : ''}`}
               >
                 {publishState === 'loading' ? (
                   <><Loader2 className="w-4 h-4 animate-spin" /> Publishing...</>
                 ) : publishState === 'success' ? (
                   <><CheckCircle2 className="w-4 h-4" /> Sent!</>
                 ) : publishState === 'error' ? (
                   <><AlertCircle className="w-4 h-4" /> Failed</>
                 ) : (
                   <><Send className="w-4 h-4" /> Publish Now</>
                 )}
               </Button>
             </span>
          </div>
          {/* Inline status message below header row */}
          {publishMessage && (
            <div className={`mt-2 px-4 py-2 rounded-xl text-sm font-medium ${
              publishState === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
              'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {publishMessage}
            </div>
          )}
        </div>

        {/* Master Control Card */}
        <div className={`p-6 rounded-2xl border transition-all duration-300 ${isAgentActive ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white text-gray-900 border-gray-200 shadow-xl'}`}>
           <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-4 text-center md:text-left">
                 <div className={`p-4 rounded-xl ${isAgentActive ? 'bg-white/10' : 'bg-indigo-100 text-indigo-600'}`}>
                    <Power className="w-8 h-8" />
                 </div>
                 <div>
                    <h2 className="text-xl font-extrabold">{isAgentActive ? 'Your Agent is Active' : 'Start Your Personal Brand'}</h2>
                    <p className={`text-sm opacity-80 ${isAgentActive ? 'text-indigo-100' : 'text-gray-500'}`}>
                       {isAgentActive ? 'Gemini is monitoring industry trends. Visit Activity Log for live posts.' : 'Enable automation to allow Gemini to post on your behalf.'}
                    </p>
                 </div>
              </div>
              <Button
                variant={isAgentActive ? 'outline' : 'primary'}
                size="lg"
                className={`min-w-[200px] h-14 text-lg font-bold ${isAgentActive ? 'bg-white/10 hover:bg-white/20 border-white text-white' : 'shadow-xl shadow-indigo-100'} ${!linkedinConnected && !isAgentActive ? 'opacity-70' : ''}`}
                onClick={handleToggleAgent}
                disabled={isSyncing}
                title={!linkedinConnected && !isAgentActive ? 'Connect LinkedIn first to enable automation' : undefined}
              >
                {isSyncing ? <Loader2 className="w-6 h-6 animate-spin" /> : isAgentActive ? <><Square className="w-5 h-5 mr-2" /> Stop Automation</> : <><Play className="w-5 h-5 mr-2" /> Enable Automation</>}
              </Button>
           </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="flex items-center p-6 border-green-50">
            <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center mr-4">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Total Published</p>
              <p className="text-2xl font-bold text-gray-900">{jobs.length}</p>
            </div>
          </Card>
          <Card className="flex items-center p-6 border-yellow-50">
            <div className="w-12 h-12 rounded-xl bg-yellow-100 flex items-center justify-center mr-4">
              <FileText className="w-6 h-6 text-yellow-600" />
            </div>
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Latest Insight</p>
              <p className="text-2xl font-bold text-gray-900">Analyzed</p>
            </div>
          </Card>
        </div>

        {/* Recent Activity */}
        <Card title="Latest Published Posts" description="Verified successful posts pulled from your automation history.">
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="bg-gray-50 text-gray-500 font-bold text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Post Content</th>
                  <th className="px-6 py-4">Date Published</th>
                  <th className="px-6 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={4} className="px-6 py-12 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />Syncing with Supabase...</td></tr>
                ) : jobs.length === 0 ? (
                  <tr><td colSpan={4} className="px-6 py-12 text-center text-gray-400">
                    {isAgentActive
                      ? 'No posts have been published yet. Try Publish Now or check the Activity Log after a few minutes.'
                      : 'No posts have been published yet. Enable automation to get started.'}
                  </td></tr>
                ) : (
                  jobs.slice(0, 5).map((job: any) => (
                    <tr key={job.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase bg-green-100 text-green-800">
                          Posted
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-semibold text-gray-900 line-clamp-1 max-w-[350px]">{job.content}</p>
                      </td>
                      <td className="px-6 py-4 text-gray-500 whitespace-nowrap">
                        {new Date(job.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {job.post_url ? (
                          <a 
                            href={job.post_url} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="text-indigo-600 font-bold hover:underline inline-flex items-center gap-1"
                          >
                             View Post <ArrowRight className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-gray-400 italic">Syncing Link...</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-6 border-t pt-4">
             <Button variant="ghost" fullWidth size="sm" onClick={() => navigate('/app/logs')} className="text-indigo-600 gap-2">
                View Full Activity Log <FileText className="w-4 h-4" />
             </Button>
          </div>
        </Card>
      </div>
    </Layout>
  );
};
