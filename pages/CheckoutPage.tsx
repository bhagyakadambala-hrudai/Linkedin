import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Bot, Check, ChevronLeft, Loader2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PLANS } from '../constants';
import { getSupabaseSettings, saveSelectedPlan } from '../lib/api';
import { isProfileComplete } from '../lib/profileCompletion';
import { supabase } from '../lib/supabase';

/** Checkout temporarily disabled: no payment, no orders table insert. Continue → onboarding. */
export const CheckoutPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '' });

  const plan = PLANS.find(p => p.id === planId) || PLANS[1];

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setFormData({
          name: (user.user_metadata?.full_name as string) || '',
          email: user.email || ''
        });
      }
    });
  }, []);

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        navigate('/auth', { replace: true });
        return;
      }
      await saveSelectedPlan(user.id, plan.id, user.email ?? undefined);
      const settings = await getSupabaseSettings(user.id);
      navigate(
        isProfileComplete(settings) ? '/app/dashboard' : '/app/profile-setup',
        { replace: true }
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="h-16 bg-white border-b border-gray-200 flex items-center px-4 sm:px-8">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-gray-900">AutoLink AI</span>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full p-4 sm:p-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Form */}
        <div className="lg:col-span-2 space-y-6">
          <button 
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-4"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to plans
          </button>

          <h1 className="text-2xl font-bold text-gray-900">Confirm your plan</h1>
          <p className="text-gray-600 text-sm">Payment is temporarily disabled. Continue to set up your profile.</p>

          <form onSubmit={handleContinue} className="space-y-6">
            <Card title="Your details">
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                    <input
                      type="text"
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                      value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input
                      type="email"
                      readOnly
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-600"
                      value={formData.email}
                      title="Email comes from your signed-in account"
                    />
                  </div>
                </div>
              </div>
            </Card>

            <Button size="lg" fullWidth type="submit" disabled={loading} className="gap-2 h-14 text-lg">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              Continue
            </Button>
          </form>
        </div>

        {/* Right: Summary */}
        <div className="space-y-6">
          <Card title="Order Summary">
            <div className="space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-bold text-gray-900">{plan.name} Plan</p>
                  <p className="text-sm text-gray-500">Subscription billed monthly</p>
                </div>
                <span className="font-bold text-gray-900">${plan.price}</span>
              </div>

              <div className="border-t border-gray-100 pt-4 space-y-2">
                {plan.features.map((feature, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-gray-600">
                    <Check className="w-4 h-4 text-green-500 shrink-0" />
                    {feature}
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-100 pt-4 flex justify-between items-center text-lg font-bold">
                <span>Total Due</span>
                <span className="text-indigo-600">${plan.price}</span>
              </div>
            </div>
          </Card>

          <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl space-y-2">
            <div className="flex items-center gap-2 font-bold text-indigo-900 text-sm">
              <Bot className="w-4 h-4" />
              Next Step: Personalization
            </div>
            <p className="text-xs text-indigo-700">
              After checkout, you'll upload your resume so our AI agent can start learning your professional voice.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};
