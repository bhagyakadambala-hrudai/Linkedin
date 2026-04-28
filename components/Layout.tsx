import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Settings, LogOut, Bot, ClipboardList } from 'lucide-react';
import { Button } from './ui/Button';
import { PLANS } from '../constants';
import { supabase } from '../lib/supabase';
import { getCurrentUserDisplayInfo, type CurrentUserDisplayInfo } from '../lib/api';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const [userInfo, setUserInfo] = useState<CurrentUserDisplayInfo | null>(null);

  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/app/dashboard' },
    { icon: ClipboardList, label: 'Activity Log', path: '/app/logs' },
    { icon: Settings, label: 'Settings', path: '/app/settings' },
  ];

  useEffect(() => {
    let cancelled = false;
    const loadUserInfo = async () => {
      const info = await getCurrentUserDisplayInfo();
      if (!cancelled) setUserInfo(info);
    };
    loadUserInfo();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      loadUserInfo();
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  const planInfo = userInfo ? PLANS.find(p => p.id === userInfo.planId) : null;
  const planLabel = planInfo ? `${planInfo.name.toUpperCase()} PLAN` : 'STARTER PLAN';
  const displayText = userInfo?.displayName ?? '';
  const initials = displayText
    ? displayText.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : (userInfo?.email?.slice(0, 2).toUpperCase() ?? 'U');

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 fixed h-full z-10 hidden md:flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-gray-200">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/app/dashboard')}>
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">AutoLink AI</span>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }: { isActive: boolean }) => `
                flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors
                ${isActive 
                  ? 'bg-indigo-50 text-indigo-600' 
                  : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'}
              `}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-200">
          {userInfo && (
            <div className="flex items-center gap-3 px-3 py-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{displayText || userInfo.email}</p>
                <p className="text-[10px] font-medium text-gray-500 truncate uppercase tracking-wider">
                  {planLabel}
                </p>
              </div>
            </div>
          )}
          <Button variant="ghost" size="sm" fullWidth onClick={handleLogout} className="justify-start gap-3 text-gray-500 hover:text-red-600 hover:bg-red-50">
            <LogOut className="w-4 h-4" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:ml-64">
        <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
};
