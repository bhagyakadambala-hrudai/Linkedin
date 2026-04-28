import React, { useState, useEffect, useCallback } from 'react';
import { Layout } from '../components/Layout';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface ActivityLog {
  id: string;
  posted_date: string;
  content_preview: string;
  status: string;
  post_url: string | null;
}

export const ActivityLogPage: React.FC = () => {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        setError("Please sign in to view your activity log.");
        setLogs([]);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("posts")
        .select("id, created_at, content, status, post_url")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const logs: ActivityLog[] = (data ?? []).map((row) => ({
        id: row.id,
        posted_date: row.created_at,
        content_preview: (row.content ?? "").substring(0, 80),
        status: row.status ?? "",
        post_url: row.post_url ?? null,
      }));

      setLogs(logs);
    } catch (e) {
      console.error("Failed to load activity logs", e);
      setError(e instanceof Error ? e.message : "Unable to load activity log.");
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Activity Log</h1>
            <p className="text-gray-500">Posts in this table are created by the Make automation after a successful LinkedIn publish.</p>
          </div>
          <Button variant="outline" onClick={fetchHistory} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh Logs
          </Button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-100 text-red-700 p-4 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="text-sm font-medium">{error}</span>
          </div>
        )}

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-6 py-4">Posted Date</th>
                  <th className="px-6 py-4">Content Preview</th>
                  <th className="px-6 py-4 text-center">Status</th>
                  <th className="px-6 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
                        <span className="text-gray-500">Loading activity log…</span>
                      </div>
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center gap-2 text-gray-500">
                        <p className="font-medium">No posts yet.</p>
                        <p className="text-sm">Posts appear here only after the Make automation successfully publishes to LinkedIn.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="bg-white hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-900">
                            {new Date(log.posted_date).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                          <span className="text-xs text-gray-400">
                            {new Date(log.posted_date).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="max-w-[450px] font-medium text-gray-700">{log.content_preview}</div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-gray-100 text-gray-700">
                          {log.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {log.post_url ? (
                          <a
                            href={log.post_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-600 hover:text-indigo-800 font-medium text-sm underline"
                          >
                            View
                          </a>
                        ) : (
                          <span className="text-gray-400 text-sm">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Layout>
  );
};
