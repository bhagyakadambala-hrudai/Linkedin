
import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, CreditCard, FileText, Activity, LogOut, Shield } from 'lucide-react';
import { Button } from './ui/Button';
import { supabase } from '../lib/supabase';

interface AdminLayoutProps {
  children: React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/';
  };
  
  const navItems = [
    { icon: LayoutDashboard, label: 'Overview', path: '/admin/dashboard' },
    { icon: Users, label: 'User Management', path: '/admin/users' },
    { icon: CreditCard, label: 'Subscriptions', path: '/admin/billing' },
    { icon: FileText, label: 'Published Posts', path: '/admin/posts' },
    { icon: Activity, label: 'Agent Logs', path: '/admin/logs' },
  ];

  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* Dark Sidebar for Admin */}
      <aside className="w-64 bg-gray-900 text-white border-r border-gray-800 fixed h-full z-10 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-400" />
            <span className="text-xl font-bold text-white">Admin Panel</span>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }: { isActive: boolean }) => `
                flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors
                ${isActive 
                  ? 'bg-gray-800 text-white' 
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'}
              `}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-800">
           <Button variant="danger" size="sm" fullWidth onClick={handleLogout} className="justify-start gap-3">
            <LogOut className="w-4 h-4" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-64">
        <div className="max-w-7xl mx-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
};
