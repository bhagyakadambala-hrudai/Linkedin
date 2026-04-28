import React, { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Bot, Play, Square, Activity, ShieldCheck, Zap, Loader2, RefreshCcw, CheckCircle, AlertCircle } from 'lucide-react';
import { startAgent, stopAgent, getAgentStatus, AgentStatusResponse } from '../lib/api';

type AgentUiState = {
  agentActive: boolean;
  agentStatus?: 'running' | 'paused' | 'error' | 'idle';
  lastAgentRun?: string;
};

export const AgentStatusPage: React.FC = () => {
  const [user, setUser] = useState<AgentUiState>({ agentActive: false });
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [showConfetti, setShowConfetti] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentDetails, setAgentDetails] = useState<AgentStatusResponse | null>(null);

  const fetchStatus = async () => {
    setStatusLoading(true);
    setError(null);
    try {
      const status = await getAgentStatus();
      setAgentDetails(status);
      
      const updatedUser: AgentUiState = {
        ...user,
        agentActive: status.status === 'running',
        agentStatus: status.status,
        lastAgentRun: status.lastRun || user.lastAgentRun
      };
      setUser(updatedUser);
    } catch (e) {
      console.error("Failed to fetch agent status");
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      if (user.agentActive) fetchStatus();
    }, 30000);
    return () => clearInterval(interval);
  }, [user.agentActive]);

  const handleToggleAgent = async () => {
    setLoading(true);
    setError(null);
    try {
      if (user.agentActive) {
        await stopAgent();
        const updated = { ...user, agentActive: false, agentStatus: 'paused' as const };
        setUser(updated);
        setAgentDetails(prev => prev ? { ...prev, status: 'paused' } : null);
      } else {
        await startAgent({});
        const updated = { ...user, agentActive: true, agentStatus: 'running' as const, lastAgentRun: new Date().toISOString() };
        setUser(updated);
        setAgentDetails(prev => prev ? { ...prev, status: 'running', lastRun: updated.lastAgentRun || null } : null);
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 5000);
      }
    } catch (e: any) {
      setError(e.message || "Failed to trigger automation. Please check your settings.");
    } finally {
      setLoading(false);
    }
  };

  const getStatusDisplay = () => {
    if (statusLoading && !agentDetails) return 'Syncing...';
    switch (agentDetails?.status) {
      case 'running': return 'Agent Online';
      case 'error': return 'System Error';
      default: return 'Agent Offline';
    }
  };

  const getStatusColor = () => {
    if (statusLoading && !agentDetails) return 'bg-gray-200';
    switch (agentDetails?.status) {
      case 'running': return 'bg-green-500 animate-pulse';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-300';
    }
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Bot className="w-8 h-8 text-indigo-600" />
              Agent Control Center
            </h1>
            <p className="text-gray-500 mt-1">Manage your LinkedIn automation engine and monitor performance.</p>
          </div>
          
          <div className="flex items-center gap-4 bg-white p-2 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center gap-2 px-4">
              <div className={`w-3 h-3 rounded-full ${getStatusColor()}`} />
              <span className="text-sm font-bold uppercase tracking-wider text-gray-700">
                {getStatusDisplay()}
              </span>
            </div>
            <Button 
              variant={user.agentActive ? 'danger' : 'primary'}
              onClick={handleToggleAgent}
              disabled={loading || statusLoading}
              className="min-w-[160px]"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : user.agentActive ? (
                <>
                  <Square className="w-4 h-4 mr-2" /> Stop Agent
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" /> Start Automation
                </>
              )}
            </Button>
          </div>
        </div>

        {(error || user.agentStatus === 'error') && (
          <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl flex items-center gap-3 animate-fade-in">
            <AlertCircle className="w-6 h-6 shrink-0" />
            <div>
              <p className="font-bold">Error Occurred</p>
              <p className="text-sm opacity-90">{error || "The agent encountered a connection issue."}</p>
            </div>
          </div>
        )}

        {showConfetti && (
          <div className="bg-indigo-600 text-white p-4 rounded-xl flex items-center justify-between animate-bounce shadow-lg shadow-indigo-200">
            <div className="flex items-center gap-3">
              <Zap className="w-6 h-6 text-yellow-300" />
              <span className="font-bold">Automation Payload Sent! Your agent is now active.</span>
            </div>
            <CheckCircle className="w-6 h-6" />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="text-center p-8 border-indigo-100 bg-gradient-to-b from-indigo-50/50 to-white">
            <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <ShieldCheck className="w-8 h-8 text-indigo-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900">Safety Guard</h3>
            <p className="text-sm text-gray-500 mt-2">LinkedIn anti-spam detection is active. We pace posts naturally.</p>
          </Card>

          <Card className="text-center p-8 border-green-100 bg-gradient-to-b from-green-50/50 to-white">
            <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Activity className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900">Agent Health</h3>
            <p className="text-sm text-gray-500 mt-2">
              {statusLoading ? 'Syncing health...' : `${agentDetails?.healthScore}% Operational. Connected.`}
            </p>
          </Card>

          <Card className="text-center p-8 border-yellow-100 bg-gradient-to-b from-yellow-50/50 to-white relative overflow-hidden">
            <div className="w-16 h-16 bg-yellow-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <RefreshCcw className={`w-8 h-8 text-yellow-600 ${statusLoading ? 'animate-spin' : ''}`} />
            </div>
            <h3 className="text-lg font-bold text-gray-900">Last Sync</h3>
            <p className="text-sm text-gray-500 mt-2">
              {user.lastAgentRun ? new Date(user.lastAgentRun).toLocaleTimeString() : 'Never'}
            </p>
            <button 
              onClick={fetchStatus} 
              className="mt-4 text-xs font-semibold text-indigo-600 hover:underline flex items-center justify-center gap-1 mx-auto"
            >
              Refresh Status
            </button>
          </Card>
        </div>

        <Card title="Automation Overview" description="What happens when the agent is active?">
          <div className="space-y-6">
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0 font-bold text-sm shadow-md">1</div>
              <div>
                <h4 className="font-bold text-gray-900">Content Sourcing</h4>
                <p className="text-gray-500 text-sm">The agent scans your chosen topics and industry trends using Google Search via Gemini 3.</p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0 font-bold text-sm shadow-md">2</div>
              <div>
                <h4 className="font-bold text-gray-900">Personalized Writing</h4>
                <p className="text-gray-500 text-sm">Posts are drafted based on your Resume data to ensure the tone and expertise match your profile.</p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0 font-bold text-sm shadow-md">3</div>
              <div>
                <h4 className="font-bold text-gray-900">Scheduled Delivery</h4>
                <p className="text-gray-500 text-sm">Posts are automatically delivered to Make.com and published to LinkedIn at your preferred times.</p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </Layout>
  );
};