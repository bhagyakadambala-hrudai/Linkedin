import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUserHasSubscription } from '../lib/api';

type SubscriptionGuardProps = {
  children: React.ReactNode;
};

/** When CHECKOUT_DISABLED is true, subscription check is bypassed (no orders table). Re-enable for real payments. */
const CHECKOUT_DISABLED = true;

/** Redirects to /pricing if user does not have an active subscription; otherwise renders children. */
export const SubscriptionGuard: React.FC<SubscriptionGuardProps> = ({ children }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const initialCheckDone = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const checkSubscription = async () => {
      if (CHECKOUT_DISABLED) {
        if (cancelled) return;
        initialCheckDone.current = true;
        setAllowed(true);
        setLoading(false);
        return;
      }
      const hasSubscription = await getUserHasSubscription();
      if (cancelled) return;
      initialCheckDone.current = true;
      setAllowed(hasSubscription);
      setLoading(false);
    };

    checkSubscription();
  }, []);

  useEffect(() => {
    if (!loading && !allowed) {
      navigate('/pricing', { replace: true });
    }
  }, [loading, allowed, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return <>{children}</>;
};
