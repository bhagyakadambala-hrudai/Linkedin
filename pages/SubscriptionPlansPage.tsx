import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Bot } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { PLANS } from '../constants';
import { supabase } from '../lib/supabase';
import { getSupabaseSettings, getUserHasSubscription, saveSelectedPlan } from '../lib/api';
import { isProfileComplete } from '../lib/profileCompletion';

/** /landing: requires auth; if user has subscription → dashboard; else show subscription plans. */
export const SubscriptionPlansPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [showPlans, setShowPlans] = useState(false);
  const initialCheckDone = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const runInitialCheck = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setLoading(false);
        navigate('/auth', { replace: true });
        return;
      }
      initialCheckDone.current = true;
      const hasSubscription = await getUserHasSubscription();
      if (cancelled) return;
      if (hasSubscription) {
        const settings = await getSupabaseSettings(user.id);
        if (cancelled) return;
        navigate(
          isProfileComplete(settings) ? '/app/dashboard' : '/app/profile-setup',
          { replace: true }
        );
        return;
      }
      setShowPlans(true);
      setLoading(false);
    };

    runInitialCheck();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async () => {
      if (!initialCheckDone.current || cancelled) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/auth', { replace: true });
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
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

  if (loading || !showPlans) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="fixed w-full bg-white/80 backdrop-blur-md border-b border-gray-100 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">AutoLink AI</span>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate('/')}>
              Home
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate('/auth', { replace: true });
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <section className="pt-24 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-center text-gray-900 mb-4">
          Choose your plan
        </h1>
        <p className="text-center text-gray-600 mb-12 max-w-xl mx-auto">
          Select a plan to get started with AI-powered LinkedIn content and scheduling.
        </p>

        <div className="grid md:grid-cols-3 gap-8">
          {PLANS.filter((p) => p.id !== 'dev').map((plan) => (
            <div
              key={plan.id}
              className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 flex flex-col relative overflow-hidden"
            >
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
      </section>
    </div>
  );
};
