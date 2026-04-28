import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { AdminLayout } from '../components/AdminLayout';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { supabase } from '../lib/supabase';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import {
  Users, CreditCard, Activity, Search, Filter,
  ArrowUpRight, CheckCircle2, AlertCircle,
  ExternalLink, Zap, Bot, Loader2, FileText
} from 'lucide-react';

// ─── Admin API helper ────────────────────────────────────────────────────────
// Always use a relative URL so the Vite proxy (→ Express:3000 in dev) and
// the same-origin Next.js API routes (on Vercel) are both hit correctly.
// NEVER point this at VITE_API_BASE_URL — that's the production domain and
// causes CORS failures in local dev.
const ADMIN_API = '';

/** Safe JSON fetch — throws a readable error when the server returns HTML. */
async function adminFetch(path: string): Promise<unknown> {
  const res = await fetch(`${ADMIN_API}${path}`);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    const text = await res.text();
    throw new Error(
      `Admin API returned non-JSON (${res.status}): ${text.slice(0, 120)}\n` +
      `→ Make sure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your Vercel project env vars.`
    );
  }
  return res.json();
}

// ─── Interfaces ──────────────────────────────────────────────────────────────
// Matches the real `posts` table schema exactly:
// id, user_id, content, post_url, created_at, updated_at, post_id, posted_at, status
interface PublishedPost {
  id: string;
  user_id: string;
  content: string | null;
  post_url: string | null;
  created_at: string;
  updated_at: string | null;
  post_id: string | null;   // LinkedIn share URN (e.g. urn:li:share:...)
  posted_at: string | null; // text field set when post is published
  status: string;
}

interface OverviewStats {
  totalRevenue: number;
  activeUsers: number;
  postsGenerated: number;
  systemHealth: string;
  revenueTrend: { name: string; revenue: number; posts: number }[];
  planDistribution: { name: string; value: number }[];
}

interface AdminUser {
  id: string;
  email: string;
  auth_roles: string;
  joined: string;
}

interface SubscriptionRow {
  id: string;
  user: string;
  amount: number;
  plan: string;
  date: string;
  status: string;
}

interface ActivityLogRow {
  id: string;
  type: string;
  user: string;
  action: string;
  status: string;
  time: string;
}

const COLORS = ['#4F46E5', '#10B981', '#F59E0B', '#6B7280'];


// --- OVERVIEW ---
const OverviewSection: React.FC<{ stats: OverviewStats | null; loading: boolean }> = ({ stats, loading }) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }
  const s = stats ?? {
    totalRevenue: 0,
    activeUsers: 0,
    postsGenerated: 0,
    systemHealth: '—',
    revenueTrend: [],
    planDistribution: [],
  };
  const avgPosts = s.activeUsers > 0 ? (s.postsGenerated / s.activeUsers).toFixed(1) : '0';
  return (
    <div className="space-y-8 animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="p-6 border-indigo-50 shadow-sm">
          <div className="flex justify-between items-start">
            <p className="text-sm text-gray-500 font-bold uppercase tracking-wider">Total Revenue</p>
            <div className="p-2 bg-green-50 rounded-lg"><ArrowUpRight className="w-4 h-4 text-green-600" /></div>
          </div>
          <p className="text-3xl font-extrabold text-gray-900 mt-2">${s.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
          <span className="text-gray-400 text-xs font-bold">Subscriptions disabled</span>
        </Card>
        <Card className="p-6 border-indigo-50 shadow-sm">
          <div className="flex justify-between items-start">
            <p className="text-sm text-gray-500 font-bold uppercase tracking-wider">Total Users</p>
            <div className="p-2 bg-indigo-50 rounded-lg"><Users className="w-4 h-4 text-indigo-600" /></div>
          </div>
          <p className="text-3xl font-extrabold text-gray-900 mt-2">{s.activeUsers}</p>
          <span className="text-gray-400 text-xs font-bold">Registered users</span>
        </Card>
        <Card className="p-6 border-indigo-50 shadow-sm">
          <div className="flex justify-between items-start">
            <p className="text-sm text-gray-500 font-bold uppercase tracking-wider">Posts Generated</p>
            <div className="p-2 bg-yellow-50 rounded-lg"><Zap className="w-4 h-4 text-yellow-600" /></div>
          </div>
          <p className="text-3xl font-extrabold text-gray-900 mt-2">{s.postsGenerated}</p>
          <span className="text-gray-400 text-xs font-bold">{avgPosts} posts/user avg</span>
        </Card>
        <Card className="p-6 border-indigo-50 shadow-sm">
          <div className="flex justify-between items-start">
            <p className="text-sm text-gray-500 font-bold uppercase tracking-wider">System Health</p>
            <div className="p-2 bg-green-50 rounded-lg"><CheckCircle2 className="w-4 h-4 text-green-600" /></div>
          </div>
          <p className="text-3xl font-extrabold text-gray-900 mt-2">{s.systemHealth}</p>
          <span className="text-green-500 text-xs font-bold">API status</span>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Revenue & Activity Trend" className="lg:col-span-2 min-h-[400px]">
          {s.revenueTrend.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-gray-500">No data available</div>
          ) : (
            <div className="h-[300px] w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={s.revenueTrend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 12 }} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                  <Line type="monotone" dataKey="revenue" stroke="#4F46E5" strokeWidth={2} dot={{ r: 4, fill: '#4F46E5' }} name="Revenue" />
                  <Line type="monotone" dataKey="posts" stroke="#10B981" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Posts" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card title="Plan Distribution" className="min-h-[400px]">
          {s.planDistribution.length === 0 ? (
            <div className="h-[250px] flex items-center justify-center text-gray-500">No data available</div>
          ) : (
            <>
              <div className="h-[250px] w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={s.planDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {s.planDistribution.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 space-y-2">
                {s.planDistribution.map((entry, i) => (
                  <div key={entry.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                      <span className="font-medium text-gray-600">{entry.name}</span>
                    </div>
                    <span className="font-bold text-gray-900">{entry.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
};

const UserManagementSection: React.FC<{
  users: AdminUser[];
  loading: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}> = ({ users, loading, searchQuery, onSearchChange }) => (
  <div className="space-y-6 animate-fade-in">
    <div className="flex justify-between items-center">
      <h2 className="text-xl font-bold text-gray-900">User Directory</h2>
      <div className="flex gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by email..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 w-64"
          />
        </div>
        <Button variant="outline" size="sm" className="gap-2"><Filter className="w-4 h-4" /> Filter</Button>
      </div>
    </div>

    <Card className="p-0 overflow-hidden border-gray-100">
      <table className="w-full text-left border-collapse">
        <thead className="bg-gray-50 text-gray-400 text-[10px] font-bold uppercase tracking-widest border-b border-gray-100">
          <tr>
            <th className="px-6 py-4">Email</th>
            <th className="px-6 py-4">Role</th>
            <th className="px-6 py-4 text-right">Joined</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {loading ? (
            <tr>
              <td colSpan={3} className="px-6 py-12 text-center">
                <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
              </td>
            </tr>
          ) : users.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-6 py-12 text-center text-gray-500">
                {searchQuery ? 'No users match your search.' : 'No users found.'}
              </td>
            </tr>
          ) : (
            users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs uppercase">
                      {user.email.slice(0, 2).toUpperCase()}
                    </div>
                    <p className="font-medium text-gray-900">{user.email}</p>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${user.auth_roles === 'admin' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}>
                    {user.auth_roles || 'user'}
                  </span>
                </td>
                <td className="px-6 py-4 text-right text-xs text-gray-500">{user.joined}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  </div>
);

const SubscriptionsSection: React.FC<{ subscriptions: SubscriptionRow[]; loading: boolean }> = ({ subscriptions, loading }) => (
  <div className="space-y-6 animate-fade-in">
    <div className="flex justify-between items-center">
      <h2 className="text-xl font-bold text-gray-900">Subscription Ledger</h2>
      <Button variant="primary" size="sm" className="gap-2"><CreditCard className="w-4 h-4" /> Export CSV</Button>
    </div>

    <Card className="p-0 overflow-hidden border-gray-100">
      <table className="w-full text-left border-collapse">
        <thead className="bg-gray-50 text-gray-400 text-[10px] font-bold uppercase tracking-widest border-b border-gray-100">
          <tr>
            <th className="px-6 py-4">Transaction ID</th>
            <th className="px-6 py-4">Subscriber</th>
            <th className="px-6 py-4">Amount</th>
            <th className="px-6 py-4">Plan Tier</th>
            <th className="px-6 py-4 text-center">Status</th>
            <th className="px-6 py-4 text-right">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {loading ? (
            <tr>
              <td colSpan={6} className="px-6 py-12 text-center">
                <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
              </td>
            </tr>
          ) : subscriptions.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-6 py-12 text-center text-gray-500">No data available</td>
            </tr>
          ) : (
            subscriptions.map((sub) => (
              <tr key={sub.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-6 py-4 text-xs font-mono text-gray-400">#{sub.id.slice(0, 8)}</td>
                <td className="px-6 py-4 font-bold text-gray-900">{sub.user}</td>
                <td className="px-6 py-4 font-extrabold text-indigo-600">${sub.amount.toFixed(2)}</td>
                <td className="px-6 py-4 text-xs font-medium">{sub.plan}</td>
                <td className="px-6 py-4 text-center">
                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                    sub.status === 'Paid' || sub.status === 'Active' ? 'bg-green-100 text-green-700' :
                    sub.status === 'Overdue' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {sub.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right text-xs text-gray-500">{sub.date}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  </div>
);

const PublishedPostsSection: React.FC<{
  posts: PublishedPost[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  userEmailById: Map<string, string>;
}> = ({ posts, loading, error, onRefresh, userEmailById }) => (
  <div className="space-y-6 animate-fade-in">
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900">All LinkedIn Posts</h2>
        <p className="text-gray-500 text-sm">All posts from all users — columns match the Supabase <code className="bg-gray-100 px-1 rounded text-xs">posts</code> table.</p>
      </div>
      <Button variant="outline" onClick={onRefresh} disabled={loading} className="gap-2">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
        Refresh
      </Button>
    </div>

    {error && (
      <div className="bg-red-50 border border-red-100 text-red-700 p-4 rounded-xl flex items-start gap-3">
        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
        <pre className="text-xs font-medium whitespace-pre-wrap break-words">{error}</pre>
      </div>
    )}

    <Card className="p-0 overflow-hidden border-gray-100">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-gray-50 text-gray-400 text-[10px] font-bold uppercase tracking-widest border-b border-gray-100">
            <tr>
              {/* Columns mirror the Supabase `posts` table schema */}
              <th className="px-4 py-3 whitespace-nowrap">created_at</th>
              <th className="px-4 py-3 whitespace-nowrap">posted_at</th>
              <th className="px-4 py-3 whitespace-nowrap">user_id → email</th>
              <th className="px-4 py-3">content</th>
              <th className="px-4 py-3 whitespace-nowrap text-center">status</th>
              <th className="px-4 py-3 whitespace-nowrap">post_id</th>
              <th className="px-4 py-3 whitespace-nowrap text-right">post_url</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
                    <span className="text-gray-500">Loading posts...</span>
                  </div>
                </td>
              </tr>
            ) : posts.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                  No posts found in the posts table.
                </td>
              </tr>
            ) : (
              posts.map((post) => {
                const email = userEmailById.get(post.user_id) ?? post.user_id;
                const statusColor =
                  post.status === 'posted'   ? 'bg-green-100 text-green-800' :
                  post.status === 'failed'   ? 'bg-red-100 text-red-700'    :
                  post.status === 'pending'  ? 'bg-yellow-100 text-yellow-800' :
                  post.status === ''         ? 'bg-gray-100 text-gray-500'  :
                                               'bg-indigo-100 text-indigo-700';
                return (
                  <tr key={post.id} className="hover:bg-gray-50/50 transition-colors">
                    {/* created_at */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-gray-800">
                          {new Date(post.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {new Date(post.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </td>
                    {/* posted_at */}
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-600">
                      {post.posted_at
                        ? (() => {
                            const d = new Date(post.posted_at);
                            return isNaN(d.getTime())
                              ? post.posted_at
                              : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                          })()
                        : <span className="text-gray-300">—</span>}
                    </td>
                    {/* user_id → email */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-[9px] uppercase shrink-0">
                          {email.slice(0, 2)}
                        </div>
                        <span className="text-xs text-gray-700 truncate max-w-[140px]">{email}</span>
                      </div>
                    </td>
                    {/* content */}
                    <td className="px-4 py-3 max-w-[300px]">
                      <p className="line-clamp-2 text-xs text-gray-700">
                        {post.content ?? <span className="text-gray-300 italic">—</span>}
                      </p>
                    </td>
                    {/* status */}
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${statusColor}`}>
                        {post.status || 'empty'}
                      </span>
                    </td>
                    {/* post_id */}
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-mono text-gray-400 truncate max-w-[120px] block">
                        {post.post_id ?? '—'}
                      </span>
                    </td>
                    {/* post_url */}
                    <td className="px-4 py-3 text-right">
                      {post.post_url ? (
                        <a
                          href={post.post_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-900 font-semibold text-xs transition-colors"
                        >
                          View <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  </div>
);

const AgentLogsSection: React.FC<{ logs: ActivityLogRow[]; loading: boolean }> = ({ logs, loading }) => (
  <div className="space-y-6 animate-fade-in">
    <div className="flex justify-between items-center">
      <h2 className="text-xl font-bold text-gray-900">System Activity Pulse</h2>
      <div className="flex items-center gap-2 px-3 py-1 bg-green-50 rounded-full border border-green-100">
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <span className="text-[10px] font-bold text-green-700 uppercase tracking-wider">From posted activity</span>
      </div>
    </div>

    <Card className="p-0 overflow-hidden border-gray-100 shadow-xl shadow-indigo-50/20">
      <div className="bg-gray-900 p-4 font-mono text-xs text-indigo-400 flex items-center justify-between">
        <span>root@autolink-ai-agent:~/system-logs$ tail -f agent.log</span>
        <Activity className="w-4 h-4 animate-pulse" />
      </div>
      <table className="w-full text-left border-collapse">
        <thead className="bg-gray-50 text-gray-400 text-[10px] font-bold uppercase tracking-widest border-b border-gray-100">
          <tr>
            <th className="px-6 py-4">Log Type</th>
            <th className="px-6 py-4">User / Scope</th>
            <th className="px-6 py-4">Action Event</th>
            <th className="px-6 py-4 text-center">Result</th>
            <th className="px-6 py-4 text-right">Timestamp</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {loading ? (
            <tr>
              <td colSpan={5} className="px-6 py-12 text-center">
                <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
              </td>
            </tr>
          ) : logs.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-6 py-12 text-center text-gray-500">No data available</td>
            </tr>
          ) : (
            logs.map((log) => (
              <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${log.type === 'Error' ? 'bg-red-500' : 'bg-indigo-500'}`} />
                    <span className="text-xs font-bold text-gray-900">{log.type}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">{log.user}</td>
                <td className="px-6 py-4 font-medium text-gray-800">{log.action}</td>
                <td className="px-6 py-4 text-center">
                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${log.status === 'Success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {log.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right text-xs text-gray-400 italic">{log.time}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  </div>
);

// --- MAIN DASHBOARD CONTROLLER ---

export const AdminDashboard: React.FC = () => {
  const location = useLocation();
  const pathname = location.pathname;

  const [overviewStats, setOverviewStats]         = useState<OverviewStats | null>(null);
  const [overviewLoading, setOverviewLoading]     = useState(true);
  const [adminUsers, setAdminUsers]               = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading]           = useState(true);
  const [subscriptions, setSubscriptions]         = useState<SubscriptionRow[]>([]);
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(true);
  const [publishedPosts, setPublishedPosts]       = useState<PublishedPost[]>([]);
  const [postsLoading, setPostsLoading]           = useState(true);
  const [postsError, setPostsError]               = useState<string | null>(null);
  const [agentLogs, setAgentLogs]                 = useState<ActivityLogRow[]>([]);
  const [agentLogsLoading, setAgentLogsLoading]   = useState(true);
  const [userSearchQuery, setUserSearchQuery]     = useState('');
  // Map user_id → email for resolving post ownership in the table
  const [userEmailById, setUserEmailById]         = useState<Map<string, string>>(new Map());

  const filteredAdminUsers = React.useMemo(() => {
    const q = userSearchQuery.trim().toLowerCase();
    if (!q) return adminUsers;
    return adminUsers.filter((u) => u.email.toLowerCase().includes(q));
  }, [adminUsers, userSearchQuery]);

  const fetchAllAdminData = useCallback(async () => {
    setOverviewLoading(true);
    setUsersLoading(true);
    setSubscriptionsLoading(true);
    setPostsLoading(true);
    setAgentLogsLoading(true);
    setPostsError(null);

    try {
      // ─── Fetch via service-role API routes (bypass RLS, see all data) ─────
      // Uses relative URLs so the Vite proxy (dev) and Next.js routes (prod)
      // both work without CORS issues.
      console.log('[AdminDashboard] Fetching from /api/admin/users and /api/admin/posts ...');

      const [usersJson, postsJson] = await Promise.all([
        adminFetch('/api/admin/users') as Promise<{ users: { user_id: string; email?: string; auth_roles?: string; created_at?: string }[] }>,
        adminFetch('/api/admin/posts') as Promise<{ posts: PublishedPost[] }>,
      ]);

      const profiles = usersJson.users ?? [];
      const posts    = postsJson.posts  ?? [];

      console.log(`[AdminDashboard] Loaded ${profiles.length} users, ${posts.length} posts`);

      // Build the user_id → email lookup used by the posts table
      const emailMap = new Map(profiles.map((p) => [p.user_id, p.email ?? p.user_id]));
      setUserEmailById(emailMap);

      // ── Posts ──────────────────────────────────────────────────────────────
      setPublishedPosts(posts);

      // ── Overview stats ────────────────────────────────────────────────────
      const revenueByDay: Record<string, { revenue: number; posts: number }> = {};
      posts.forEach((p) => {
        const day = p.created_at
          ? new Date(p.created_at).toLocaleDateString(undefined, { weekday: 'short' })
          : '—';
        if (!revenueByDay[day]) revenueByDay[day] = { revenue: 0, posts: 0 };
        revenueByDay[day].posts += 1;
      });

      let systemHealth = 'OK';
      try {
        const { error } = await supabase.from('profiles').select('user_id').limit(1);
        if (error) systemHealth = 'Error';
      } catch { systemHealth = 'Error'; }

      setOverviewStats({
        totalRevenue: 0,
        activeUsers: profiles.length,
        postsGenerated: posts.length,
        systemHealth,
        revenueTrend: Object.entries(revenueByDay).map(([name, v]) => ({ name, ...v })),
        planDistribution: [],
      });

      // ── User Management table ─────────────────────────────────────────────
      setAdminUsers(profiles.map((p) => ({
        id: p.user_id,
        email: p.email ?? '—',
        auth_roles: p.auth_roles ?? 'user',
        joined: p.created_at
          ? new Date(p.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
          : '—',
      })));

      setSubscriptions([]);

      // ── Agent Logs (derived from posts) ───────────────────────────────────
      setAgentLogs(posts.slice(0, 50).map((p) => {
        const createdAt = p.created_at ? new Date(p.created_at) : new Date();
        const diffMs    = Date.now() - createdAt.getTime();
        const mins      = Math.floor(diffMs / 60000);
        const hours     = Math.floor(mins / 60);
        const time      = mins < 60
          ? `${mins} mins ago`
          : hours < 24
            ? `${hours} hour(s) ago`
            : createdAt.toLocaleString();
        return {
          id: p.id,
          type: 'Automation',
          user: emailMap.get(p.user_id) ?? p.user_id ?? '—',
          action: 'LinkedIn Post Published',
          status: p.status === 'posted' ? 'Success' : p.status || 'Unknown',
          time,
        };
      }));

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[AdminDashboard] fetchAllAdminData failed:', msg);
      setPostsError(msg);
    } finally {
      setOverviewLoading(false);
      setUsersLoading(false);
      setSubscriptionsLoading(false);
      setPostsLoading(false);
      setAgentLogsLoading(false);
    }
  }, []);

  useEffect(() => { fetchAllAdminData(); }, [fetchAllAdminData]);

  // Refresh button on the posts page — re-fetches only posts
  const fetchPublishedPosts = useCallback(async () => {
    setPostsLoading(true);
    setPostsError(null);
    try {
      const json = await adminFetch('/api/admin/posts') as { posts: PublishedPost[] };
      setPublishedPosts(json.posts ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[AdminDashboard] fetchPublishedPosts failed:', msg);
      setPostsError(msg);
    } finally {
      setPostsLoading(false);
    }
  }, []);

  const renderContent = () => {
    if (pathname.includes('/admin/users')) return (
      <UserManagementSection
        users={filteredAdminUsers}
        loading={usersLoading}
        searchQuery={userSearchQuery}
        onSearchChange={setUserSearchQuery}
      />
    );
    if (pathname.includes('/admin/billing'))
      return <SubscriptionsSection subscriptions={subscriptions} loading={subscriptionsLoading} />;
    if (pathname.includes('/admin/posts')) return (
      <PublishedPostsSection
        posts={publishedPosts}
        loading={postsLoading}
        error={postsError}
        onRefresh={fetchPublishedPosts}
        userEmailById={userEmailById}
      />
    );
    if (pathname.includes('/admin/logs'))
      return <AgentLogsSection logs={agentLogs} loading={agentLogsLoading} />;
    return <OverviewSection stats={overviewStats} loading={overviewLoading} />;
  };

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div className="min-h-[600px]">
          {renderContent()}
        </div>
      </div>
    </AdminLayout>
  );
};
