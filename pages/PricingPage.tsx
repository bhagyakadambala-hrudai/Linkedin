import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Bot, LayoutDashboard } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { PLANS } from '../constants';
import { supabase } from '../lib/supabase';
import { getUserHasSubscription } from '../lib/api';

/** Standalone pricing page for /pricing route (e.g. when redirected from app without subscription). */
export const PricingPage: React.FC = () => {
  const navigate = useNavigate();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [subscriptionActive, setSubscriptionActive] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setIsLoggedIn(!!user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      void supabase.auth.getUser().then(({ data: { user } }) => setIsLoggedIn(!!user));
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      getUserHasSubscription().then(setSubscriptionActive);
    } else {
      setSubscriptionActive(false);
    }
  }, [isLoggedIn]);

  const handleChoosePlan = (planId: string) => {
    if (!isLoggedIn) {
      navigate(`/auth?plan=${planId}`);
      return;
    }
    navigate(`/checkout/${planId}`);
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="fixed w-full bg-white/80 backdrop-blur-md border-b border-gray-100 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">AutoLink AI</span>
          </div>
          <div className="flex items-center gap-4">
            {!isLoggedIn && (
              <Button variant="ghost" onClick={() => navigate('/auth')}>
                Sign In
              </Button>
            )}
            {isLoggedIn && !subscriptionActive && (
              <Button variant="ghost" onClick={async () => await supabase.auth.signOut()}>
                Sign out
              </Button>
            )}
            {isLoggedIn && subscriptionActive && (
              <Button onClick={() => navigate('/app/dashboard')} className="gap-2">
                <LayoutDashboard className="w-4 h-4" />
                Get Started
              </Button>
            )}
          </div>
        </div>
      </header>

      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-sm text-indigo-600 hover:text-indigo-700 font-medium mb-6 inline-block"
          >
            ← Back to home
          </button>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Choose your plan</h1>
          <p className="text-gray-600 max-w-xl mx-auto">
            Select a plan to get started with AI-powered LinkedIn content and scheduling.
          </p>
        </div>

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
                onClick={() => handleChoosePlan(plan.id)}
              >
                Choose Plan
              </Button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
