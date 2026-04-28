import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Bot,
  Sparkles,
  Calendar,
  TrendingUp,
  BarChart3,
  FileText,
  Brain,
  Send,
  Zap,
  Target,
  RefreshCw,
  LineChart,
  Check,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { supabase } from '../lib/supabase';
import { getSupabaseSettings, saveSelectedPlan } from '../lib/api';
import { isProfileComplete } from '../lib/profileCompletion';

const DEMO_PLANS = [
  { id: 'Starter', name: 'Starter (Demo)', price: 19, features: ['3 posts/week', 'Text only', 'Basic Analytics'] },
  { id: 'Pro', name: 'Pro (Demo)', price: 39, features: ['5 posts/week', 'Text + Image', 'Engagement AI'], popular: true },
  { id: 'Business', name: 'Business (Demo)', price: 79, features: ['Daily posts', 'All formats', 'Priority Support'] },
];

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const syncAuthAndPlan = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      setIsLoggedIn(!!user);
      if (user?.id) {
        const settings = await getSupabaseSettings(user.id);
        const p = settings.selected_plan ? String(settings.selected_plan) : null;
        if (!cancelled) setSelectedPlan(p);
      } else if (!cancelled) {
        setSelectedPlan(null);
      }
    };
    syncAuthAndPlan();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      syncAuthAndPlan();
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsLoggedIn(false);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');
    if (code || error) {
      navigate(`/auth/linkedin/callback?${params.toString()}`, { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    if ((location.state as { scrollToPricing?: boolean })?.scrollToPricing) {
      document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  const handleChoosePlan = async (plan: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      navigate('/auth', { replace: true });
      return;
    }
    try {
      await saveSelectedPlan(user.id, plan, user.email ?? undefined);
      setSelectedPlan(plan);
      const settings = await getSupabaseSettings(user.id);
      navigate(
        isProfileComplete(settings) ? '/app/dashboard' : '/app/profile-setup',
        { replace: true }
      );
    } catch (e) {
      console.warn('Could not save plan to Supabase', e);
    }
  };

  const handleGetStarted = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const settings = await getSupabaseSettings(user.id);
    const plan = settings.selected_plan ? String(settings.selected_plan) : null;
    const profileReady = isProfileComplete(settings);
    if (!plan) {
      document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
    } else if (!profileReady) {
      navigate('/app/profile-setup');
    } else {
      navigate('/app/dashboard');
    }
  };

  const scrollToPricing = () => {
    document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header - only Sign In and View Plans */}
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
                <Button variant="ghost" onClick={() => navigate('/app/dashboard')}>
                  Dashboard
                </Button>
                <Button variant="outline" onClick={handleLogout}>
                  Log out
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => navigate('/auth')}>
                Sign In
              </Button>
            )}
            {selectedPlan ? (
              <Button onClick={handleGetStarted}>Get Started</Button>
            ) : (
              <Button onClick={scrollToPricing}>View Plans</Button>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-center">
        <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 tracking-tight mb-6">
          Automate Your LinkedIn <br />
          <span className="text-indigo-600">with AI</span>
        </h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-10">
          Create, schedule, and publish LinkedIn posts automatically using AI.
        </p>
        <div className="flex justify-center">
          <Button size="lg" onClick={scrollToPricing}>
            View Plans
          </Button>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">
            Everything you need to grow on LinkedIn
          </h2>
          <p className="text-center text-gray-600 mb-16 max-w-xl mx-auto">
            From AI-generated content to smart scheduling and analytics — all in one place.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="p-6 bg-white rounded-2xl shadow-sm border border-gray-100">
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-4">
                <Sparkles className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">AI Post Generation</h3>
              <p className="text-gray-600">
                Our AI writes professional, on-brand posts based on your resume and preferences.
              </p>
            </div>
            <div className="p-6 bg-white rounded-2xl shadow-sm border border-gray-100">
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-4">
                <Calendar className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Smart Scheduling</h3>
              <p className="text-gray-600">
                Schedule posts for optimal engagement and never miss a beat.
              </p>
            </div>
            <div className="p-6 bg-white rounded-2xl shadow-sm border border-gray-100">
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-4">
                <TrendingUp className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Personal Brand Growth</h3>
              <p className="text-gray-600">
                Build a consistent, professional presence that attracts opportunities.
              </p>
            </div>
            <div className="p-6 bg-white rounded-2xl shadow-sm border border-gray-100">
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-4">
                <BarChart3 className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Analytics & Insights</h3>
              <p className="text-gray-600">
                Track performance and refine your strategy with clear metrics.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">
            How it works
          </h2>
          <p className="text-center text-gray-600 mb-16 max-w-xl mx-auto">
            Get from resume to published posts in four simple steps.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="flex flex-col items-center text-center">
              <div className="w-14 h-14 bg-indigo-600 text-white rounded-2xl flex items-center justify-center mb-4 font-bold text-lg">
                1
              </div>
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-3">
                <FileText className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Upload Resume</h3>
              <p className="text-gray-600 text-sm">
                Add your resume so our AI understands your experience and expertise.
              </p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="w-14 h-14 bg-indigo-600 text-white rounded-2xl flex items-center justify-center mb-4 font-bold text-lg">
                2
              </div>
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-3">
                <Brain className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">AI Learns Your Voice</h3>
              <p className="text-gray-600 text-sm">
                Our AI adapts to your tone and style for authentic content.
              </p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="w-14 h-14 bg-indigo-600 text-white rounded-2xl flex items-center justify-center mb-4 font-bold text-lg">
                3
              </div>
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-3">
                <Sparkles className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Auto Generate Posts</h3>
              <p className="text-gray-600 text-sm">
                Generate and edit posts with one click. No more writer's block.
              </p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="w-14 h-14 bg-indigo-600 text-white rounded-2xl flex items-center justify-center mb-4 font-bold text-lg">
                4
              </div>
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-3">
                <Send className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Publish to LinkedIn</h3>
              <p className="text-gray-600 text-sm">
                Connect LinkedIn and publish directly — safe, official API.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">
            Why choose AutoLink AI?
          </h2>
          <p className="text-center text-gray-600 mb-16 max-w-xl mx-auto">
            Focus on your career while we handle your LinkedIn presence.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="p-6 bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-4">
                <Zap className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Save Time</h3>
              <p className="text-gray-600 text-sm">
                Stop spending hours on posts. Let AI do the heavy lifting.
              </p>
            </div>
            <div className="p-6 bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-4">
                <Target className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Grow Personal Brand</h3>
              <p className="text-gray-600 text-sm">
                Build authority and visibility in your industry.
              </p>
            </div>
            <div className="p-6 bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-4">
                <RefreshCw className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Consistent Posting</h3>
              <p className="text-gray-600 text-sm">
                Maintain a steady cadence without the stress.
              </p>
            </div>
            <div className="p-6 bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-4">
                <LineChart className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">AI-Powered Insights</h3>
              <p className="text-gray-600 text-sm">
                Data-driven suggestions to improve engagement.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section - Demo plans only, no payment */}
      <section id="pricing" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">
            Simple, Transparent Pricing
          </h2>
          <p className="text-center text-gray-600 mb-12 max-w-xl mx-auto">
            Choose a plan to get started. Demo only — no payment required.
          </p>
          <div className="grid md:grid-cols-3 gap-8">
            {DEMO_PLANS.map((plan) => (
              <div
                key={plan.id}
                className="bg-gray-50 rounded-2xl shadow-sm border border-gray-200 p-8 flex flex-col relative overflow-hidden"
              >
                {plan.popular && (
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
                  variant={plan.popular ? 'primary' : 'outline'}
                  fullWidth
                  onClick={() => handleChoosePlan(plan.id)}
                >
                  Choose Plan
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center bg-indigo-600 rounded-3xl p-12 md:p-16">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Start growing your LinkedIn presence today.
          </h2>
          <p className="text-indigo-100 text-lg mb-8">
            Join professionals who automate their LinkedIn with AutoLink AI.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-center sm:justify-between gap-4">
          <div className="flex items-center justify-center gap-2">
            <div className="w-6 h-6 bg-indigo-600 rounded-md flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-gray-900">AutoLink AI</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
