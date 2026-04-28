import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, LayoutDashboard, Shield } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getUserAuthRole } from '../lib/api';

export const DevNavigation: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [authRole, setAuthRole] = useState<'admin' | 'user' | null>(null);

  const refreshUser = useCallback(async () => {
    const { data: { user: u } } = await supabase.auth.getUser();
    if (u?.id) {
      setUser({ id: u.id });
      const role = await getUserAuthRole(u.id);
      setAuthRole(role);
    } else {
      setUser(null);
      setAuthRole(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!cancelled && u?.id) {
        setUser({ id: u.id });
        const role = await getUserAuthRole(u.id);
        if (!cancelled) setAuthRole(role);
      }
    })();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      void refreshUser();
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [refreshUser]);

  const isAdmin = authRole === 'admin';
  const isUser = !!user && authRole === 'user';

  const allNavs = [
    { label: 'Home', path: '/', icon: Home, isActive: (currentPath: string) => currentPath === '/', showWhen: !user || isUser },
    { label: 'App', path: '/app/dashboard', icon: LayoutDashboard, isActive: (currentPath: string) => currentPath.startsWith('/app'), showWhen: isUser },
    { label: 'Admin', path: '/admin/dashboard', icon: Shield, isActive: (currentPath: string) => currentPath.startsWith('/admin'), showWhen: isAdmin },
  ];

  const navs = allNavs.filter((n) => n.showWhen);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] bg-gray-900/90 backdrop-blur-sm text-white px-2 py-2 rounded-full shadow-2xl flex items-center gap-1 border border-gray-700/50">
      {navs.map((nav) => (
        <button
          key={nav.label}
          onClick={() => navigate(nav.path)}
          className={`
            px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all whitespace-nowrap
            ${nav.isActive(location.pathname)
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
              : 'hover:bg-gray-800 text-gray-300'}
          `}
        >
          <nav.icon className="w-3.5 h-3.5" />
          {nav.label}
        </button>
      ))}
    </div>
  );
};
