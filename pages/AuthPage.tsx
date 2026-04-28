import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Lock, User, Loader2, Plane, MapPin, Compass, Eye, EyeOff } from "lucide-react";
import { Button } from "../components/ui/Button";
import { getEmailConfirmRedirectTo, getPasswordResetRedirectTo, supabase } from "../lib/supabase";
import { getSupabaseSettings } from "../lib/api";
import { isProfileComplete } from "../lib/profileCompletion";

type AuthMode = "signin" | "signup";

export default function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [authCheckLoading, setAuthCheckLoading] = useState(true);
  // True when URL contains ?code= (OAuth PKCE callback in progress) — prevents auth form flash
  const [isOAuthPending, setIsOAuthPending] = useState(() =>
    new URLSearchParams(window.location.search).has('code')
  );
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const authCheckDoneRef = useRef(false);

  const getRedirectAfterAuth = async (userId: string): Promise<string> => {
    const settings = await getSupabaseSettings(userId);
    if (settings.auth_role === 'admin') return '/admin/dashboard';
    return isProfileComplete(settings) ? '/app/dashboard' : '/app/profile-setup';
  };

  // Safety timeout: if PKCE exchange takes >8s, stop showing spinner so user can sign in manually
  useEffect(() => {
    if (!isOAuthPending) return;
    const timer = setTimeout(() => setIsOAuthPending(false), 8000);
    return () => clearTimeout(timer);
  }, [isOAuthPending]);

  // Parse Supabase OAuth error params on page load (e.g. ?error=access_denied&error_description=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error');
    const oauthErrorDesc = params.get('error_description');
    if (oauthError) {
      const msg = oauthErrorDesc
        ? oauthErrorDesc.replace(/\+/g, ' ')
        : oauthError;
      setMessage({ type: 'error', text: msg });
      // Strip error params from URL without triggering a navigation
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Initial session check — handles users who are already signed in
    supabase.auth.getUser().then(async ({ data: { user: u } }) => {
      if (cancelled) return;
      authCheckDoneRef.current = true;
      setAuthCheckLoading(false);
      if (u) {
        // Ensure profile row exists for OAuth users landing here after callback
        const isOAuth = u.app_metadata?.provider && u.app_metadata.provider !== 'email';
        if (isOAuth) {
          try { await ensureProfileWithEmail(u.id, u.email ?? ''); } catch (_) { /* non-fatal */ }
        }
        const path = await getRedirectAfterAuth(u.id);
        navigate(path, { replace: true });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (cancelled) return;

      if (event === 'SIGNED_IN' && session?.user) {
        const u = session.user;
        const isOAuth = u.app_metadata?.provider && u.app_metadata.provider !== 'email';

        if (isOAuth) {
          // Google (or any OAuth) callback — handle immediately, no authCheckDoneRef guard
          // needed because this event only fires after the PKCE exchange is complete
          setIsOAuthPending(false);
          try { await ensureProfileWithEmail(u.id, u.email ?? ''); } catch (_) { /* non-fatal */ }
          const path = await getRedirectAfterAuth(u.id);
          navigate(path, { replace: true });
          return;
        }

        // Email sign-in: only act after the initial getUser() check is done to
        // prevent double-navigation (handleSignIn already calls navigate directly)
        if (authCheckDoneRef.current) {
          const path = await getRedirectAfterAuth(u.id);
          navigate(path, { replace: true });
        }
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [navigate]);

  const clearMessage = () => setMessage(null);

  /** Upsert current user's profile row (no role field — never overwrites job/plan role on conflict). */
  const ensureProfileWithEmail = async (userId: string, userEmail: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !session.user) {
      console.error("User not authenticated");
      console.warn(
        "Profile upsert skipped: no session (e.g. email confirmation pending). Row will be created after sign-in."
      );
      return;
    }
    const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authUser?.id || authUser.id !== userId) {
      console.error("User not authenticated");
      return;
    }
    const sessionUserId = authUser.id;
    console.log("Saving profile for user:", sessionUserId);
    console.log("Saving profile:", { email: userEmail, skills: "(existing)", topics: "(existing)" });

    const { data: existing } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", sessionUserId)
      .maybeSingle();

    const ex = (existing || {}) as Record<string, unknown>;

    const { error } = await supabase.from("profiles").upsert(
      {
        ...ex,
        user_id: sessionUserId,
        email: userEmail,
        role: String(ex.role ?? ""),
        skills: String(ex.skills ?? ""),
        topics: String(ex.topics ?? ""),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
    if (error) console.error("Profile upsert error:", error);
    else console.log("Profile upsert complete", { user_id: sessionUserId, email: userEmail });
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!email.trim() || !password) {
      setMessage({ type: "error", text: "Please enter email and password." });
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      const isInvalidCreds = error.message.toLowerCase().includes('invalid login credentials');
      setMessage({
        type: "error",
        text: isInvalidCreds
          ? "Invalid email or password. Please check your credentials and try again."
          : error.message,
      });
      return;
    }
    if (data.user) {
      await ensureProfileWithEmail(data.user.id, data.user.email ?? email.trim());
      setMessage({ type: "success", text: "Signed in. Redirecting..." });
      const path = await getRedirectAfterAuth(data.user.id);
      navigate(path, { replace: true });
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!email.trim() || !password) {
      setMessage({ type: "error", text: "Please enter email and password." });
      return;
    }
    if (password.length < 6) {
      setMessage({ type: "error", text: "Password must be at least 6 characters." });
      return;
    }
    if (password !== confirmPassword) {
      setMessage({ type: "error", text: "Passwords do not match." });
      return;
    }
    setLoading(true);
    const emailRedirectTo = getEmailConfirmRedirectTo();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: emailRedirectTo || undefined,
        data: fullName ? { full_name: fullName } : undefined,
      },
    });
    setLoading(false);
    if (error) {
      setMessage({ type: "error", text: error.message });
      return;
    }
    if (data.session && data.user) {
      // Email confirmation disabled (auto-confirm) — session available immediately
      await ensureProfileWithEmail(data.user.id, data.user.email ?? email.trim());
      setMessage({ type: "success", text: "Account created. Redirecting..." });
      const path = await getRedirectAfterAuth(data.user.id);
      navigate(path, { replace: true });
      return;
    }
    if (data.user) {
      await ensureProfileWithEmail(data.user.id, data.user.email ?? email.trim());
    }
    setMessage({
      type: "success",
      text: "Check your email for the confirmation link, or sign in if already confirmed.",
    });
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!email.trim()) {
      setMessage({ type: "error", text: "Enter your email to reset password." });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: getPasswordResetRedirectTo(),
    });
    setLoading(false);
    if (error) {
      setMessage({ type: "error", text: error.message });
      return;
    }
    setMessage({ type: "success", text: "Check your email for the reset link." });
  };

  const handleGoogleSignIn = async () => {
    setMessage(null);
    setGoogleLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getEmailConfirmRedirectTo(), // → origin/#/auth; Supabase inserts ?code= before hash
      },
    });
    if (error) {
      setMessage({ type: 'error', text: error.message });
      setGoogleLoading(false);
    }
    // On success the browser navigates away — googleLoading stays true intentionally
  };

  if (authCheckLoading || isOAuthPending) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        {isOAuthPending && (
          <p className="text-sm text-gray-500">Signing you in with Google…</p>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Left: Travel Connect hero */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.08\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-80" />
        <div className="relative z-10 flex flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Plane className="w-6 h-6" />
            </div>
            <span className="text-xl font-bold">AutoLink AI</span>
          </div>
          <div>
            <h2 className="text-3xl font-bold mb-4">Connect. Create. Grow.</h2>
            <p className="text-white/90 text-lg max-w-sm">
              Automate your LinkedIn presence and build your personal brand with AI.
            </p>
            <div className="flex gap-6 mt-8 text-white/80">
              <span className="flex items-center gap-2">
                <MapPin className="w-5 h-5" /> Smart scheduling
              </span>
              <span className="flex items-center gap-2">
                <Compass className="w-5 h-5" /> AI-powered content
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Right: Form */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center px-6 sm:px-12 py-12 bg-gray-50">
        <div className="mx-auto w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
              <Plane className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">AutoLink AI</span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900">
              {forgotPassword ? "Reset password" : mode === "signin" ? "Welcome back" : "Create account"}
            </h1>
            <p className="text-gray-500 mt-1">
              {forgotPassword
                ? "We’ll send you a link to reset your password."
                : mode === "signin"
                  ? "Sign in to your account to continue."
                  : "Get started with AutoLink AI in seconds."}
            </p>
          </div>

          {message && (
            <div
              className={`mb-4 p-3 rounded-lg text-sm ${
                message.type === "error"
                  ? "bg-red-50 text-red-700 border border-red-100"
                  : "bg-emerald-50 text-emerald-700 border border-emerald-100"
              }`}
            >
              {message.text}
            </div>
          )}

          {forgotPassword ? (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <label htmlFor="email-reset" className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    id="email-reset"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full h-11 pl-10 pr-4 rounded-xl border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    autoComplete="email"
                  />
                </div>
              </div>
              <Button
                type="submit"
                fullWidth
                size="lg"
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 focus:ring-blue-500"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Send reset link"}
              </Button>
              <button
                type="button"
                onClick={() => { setForgotPassword(false); clearMessage(); }}
                className="w-full text-sm text-gray-600 hover:text-gray-900"
              >
                Back to sign in
              </button>
            </form>
          ) : (
            <>
              <div className="flex rounded-xl bg-gray-200/80 p-1 mb-6">
                <button
                  type="button"
                  onClick={() => { setMode("signin"); clearMessage(); }}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    mode === "signin"
                      ? "bg-white text-gray-900 shadow-sm border-2 border-blue-600"
                      : "text-gray-600 hover:text-gray-900 border-2 border-transparent"
                  }`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => { setMode("signup"); clearMessage(); }}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    mode === "signup"
                      ? "bg-white text-gray-900 shadow-sm border-2 border-blue-600"
                      : "text-gray-600 hover:text-gray-900 border-2 border-transparent"
                  }`}
                >
                  Sign up
                </button>
              </div>

              <form
                onSubmit={mode === "signin" ? handleSignIn : handleSignUp}
                className="space-y-4"
              >
                {mode === "signup" && (
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                      Full name (optional)
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        id="name"
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Jane Doe"
                        className="w-full h-11 pl-10 pr-4 rounded-xl border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                        autoComplete="name"
                      />
                    </div>
                  </div>
                )}
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full h-11 pl-10 pr-4 rounded-xl border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                      autoComplete="email"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full h-11 pl-10 pr-11 rounded-xl border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                      autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
                {mode === "signup" && (
                  <div>
                    <label htmlFor="confirm" className="block text-sm font-medium text-gray-700 mb-1">
                      Confirm password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        id="confirm"
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full h-11 pl-10 pr-11 rounded-xl border border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                        aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                      >
                        {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                )}
                {mode === "signin" && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setForgotPassword(true)}
                      className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}
                <Button
                  type="submit"
                  fullWidth
                  size="lg"
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700 focus:ring-blue-500 text-white border-0"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                  ) : mode === "signin" ? (
                    "Sign in"
                  ) : (
                    "Create account"
                  )}
                </Button>
              </form>
            </>
          )}

          <p className="mt-8 text-center text-sm text-gray-500">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              ← Back to home
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
