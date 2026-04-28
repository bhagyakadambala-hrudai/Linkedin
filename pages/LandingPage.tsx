
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Bot, Zap, TrendingUp, Shield } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { PLANS } from '../constants';
import { getSupabaseSettings, saveSelectedPlan } from '../lib/api';
import { isProfileComplete } from '../lib/profileCompletion';
import { supabase } from '../lib/supabase';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!cancelled) setIsLoggedIn(!!user);
    };
    sync();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      sync();
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    // Intercept LinkedIn OAuth callback at root
    // LinkedIn redirects to origin/?code=...
    // We need to move this to /#/auth/linkedin/callback?code=...
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    if (code || error) {
      // Construct the search string for the hash route
      const searchString = params.toString();
      navigate(`/auth/linkedin/callback?${searchString}`, { replace: true });
    }
  }, [navigate]);

  const handleGetStarted = async (planId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      navigate('/auth', { replace: true });
      return;
    }
    try {
      await saveSelectedPlan(user.id, planId, user.email ?? undefined);
    } catch (e) {
      console.warn('Could not save plan', e);
    }
    const settings = await getSupabaseSettings(user.id);
    navigate(
      isProfileComplete(settings) ? '/app/dashboard' : '/app/profile-setup',
      { replace: true }
    );
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="fixed w-full bg-white/80 backdrop-blur-md border-b border-gray-100 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">AutoLink AI</span>
          </div>
          <div className="flex items-center gap-4">
            {isLoggedIn ? (
              <>
                <Button variant="ghost" onClick={() => navigate('/app/dashboard')}>Dashboard</Button>
                <Button variant="outline" onClick={() => supabase.auth.signOut()}>Log out</Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => navigate('/auth')}>Sign In</Button>
            )}
            <Button onClick={() => handleGetStarted('starter')}>Get Started</Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-center">
        <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 tracking-tight mb-6">
          Automate your LinkedIn <br />
          <span className="text-indigo-600">Personal Brand</span>
        </h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-10">
          Our AI Agent analyzes your resume and industry trends to write and schedule high-impact posts tailored to your voice.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button size="lg" onClick={() => handleGetStarted('professional')}>
            Start Free Trial
          </Button>
          <Button size="lg" variant="secondary">
            View Demo
          </Button>
        </div>
        
        {/* Features Grid */}
        <div className="mt-24 grid md:grid-cols-3 gap-8 text-left">
          <div className="p-6 bg-gray-50 rounded-2xl">
            <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-4">
              <Zap className="w-6 h-6 text-indigo-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Zero Effort</h3>
            <p className="text-gray-600">You set the topics, our Agent writes, formats, and posts for you automatically.</p>
          </div>
          <div className="p-6 bg-gray-50 rounded-2xl">
            <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-4">
              <TrendingUp className="w-6 h-6 text-indigo-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Resume Aware</h3>
            <p className="text-gray-600">Content is contextualized by your actual experience and skills from your resume.</p>
          </div>
          <div className="p-6 bg-gray-50 rounded-2xl">
            <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-4">
              <Shield className="w-6 h-6 text-indigo-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Safe & Secure</h3>
            <p className="text-gray-600">We use official LinkedIn APIs. No sketchy automation scripts or password sharing.</p>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center mb-12">Simple, Transparent Pricing</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {PLANS.filter(p => p.id !== 'dev').map((plan) => (
              <div key={plan.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 flex flex-col relative overflow-hidden">
                {plan.id === 'professional' && (
                  <div className="absolute top-0 right-0 bg-indigo-600 text-white text-xs font-bold px-3 py-1 rounded-bl-lg">
                    MOST POPULAR
                  </div>
                )}
                <h3 className="text-xl font-bold text-gray-900">{plan.name}</h3>
                <div className="mt-4 flex items-baseline">
                  <span className="text-4xl font-extrabold text-gray-900">${plan.price}</span>
                  <span className="ml-1 text-gray-500">/month</span>
                </div>
                <ul className="mt-8 space-y-4 flex-1">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start">
                      <Check className="w-5 h-5 text-green-500 mr-2 shrink-0" />
                      <span className="text-gray-600 text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button 
                  className="mt-8" 
                  variant={plan.id === 'professional' ? 'primary' : 'outline'}
                  fullWidth
                  onClick={() => handleGetStarted(plan.id)}
                >
                  Choose {plan.name}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
