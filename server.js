
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const fetch = require('node-fetch');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { analyzeResumeFromUrl } = require('./lib/analyzeResumeOpenAI.cjs');

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

// Initialize Supabase client with service role key (bypasses RLS)
const supabaseUrl = process.env.SUPABASE_URL || 'https://fjghdbrqwbnzebeawvfg.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabaseAdmin = null;
if (supabaseServiceKey) {
  supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  console.log('✅ Supabase admin client initialized');
} else {
  console.warn('⚠️ SUPABASE_SERVICE_ROLE_KEY not set - database operations will fail');
}

const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
let supabaseAuthClient = null;
if (supabaseUrl && supabaseAnonKey) {
  supabaseAuthClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const app = express();
// CHANGED: Default port to 3000 as requested
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev';

// Middleware
app.use(cors());
app.use(express.json());

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Serve uploaded files statically
app.use('/uploads', express.static(uploadDir));

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /pdf|docx|vnd.openxmlformats-officedocument.wordprocessingml.document/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Error: File upload only supports the following filetypes - ' + filetypes));
  }
});

// MongoDB Connection (Optional for development)
const mongoUri = process.env.DATABASE_URL || process.env.MONGODB_URI || process.env.MONGO_URI;

if (mongoUri) {
  mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => console.warn('⚠️ MongoDB connection failed (running in API-only mode):', err.message));
} else {
  console.log('⚠️ No MongoDB URI configured - running in API-only mode (Supabase for data storage)');
}

// User Model
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  role: String,
  skills: [String],
  topics: [String],
  schedule: { type: Array, default: [] },
  agentActive: { type: Boolean, default: false },
  plan: { type: String, default: 'dev' }
});
const User = mongoose.model('User', UserSchema);

// Post Model for Activity Logs
const PostSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  post_url: { type: String, default: '' },
  status: { type: String, default: 'posted' },
  created_at: { type: Date, default: Date.now }
});
const Post = mongoose.model('Post', PostSchema);

// AUTH MIDDLEWARE
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token.' });
    req.user = user;
    next();
  });
};

// POST /api/linkedin/exchange — browser code exchange (replaces Supabase Edge Function)
try {
  const linkedinExchangeHandler = require('./api/linkedin/exchange');
  app.post('/api/linkedin/exchange', (req, res) => linkedinExchangeHandler(req, res));
} catch (e) {
  console.warn('Could not mount /api/linkedin/exchange:', e?.message);
}

// --- LINKEDIN OAUTH CALLBACK (LOCAL DEV ONLY) ---
// Production (Vercel) uses the serverless function at api/linkedin/callback.js.
// This Express route is only for local dev when running: node server.js
// Redirect URI for token exchange must match LinkedIn app config exactly.
const PRODUCTION_APP_URL = 'https://linkedin-theta-seven.vercel.app';
const LINKEDIN_CALLBACK_PATH = '/api/linkedin/callback';
const REDIRECT_URI_EXACT = 'https://linkedin-theta-seven.vercel.app/api/linkedin/callback';

const LINKEDIN_REQUIRED_ENV = [
  'LINKEDIN_CLIENT_ID',
  'LINKEDIN_CLIENT_SECRET',
  'LINKEDIN_REDIRECT_URI',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

function getFrontendUrlLinkedIn() {
  return process.env.FRONTEND_URL || process.env.VITE_APP_URL || PRODUCTION_APP_URL;
}

app.get('/api/linkedin/callback', async (req, res) => {
  const FRONTEND_URL = getFrontendUrlLinkedIn();
  const settingsUrl = `${FRONTEND_URL.replace(/\/$/, '')}/#/app/settings`;
  const failRedirect = `${settingsUrl}?error=linkedin_callback_failed`;

  try {
    console.log('[LinkedIn callback] Callback triggered', { method: req.method, hasQuery: !!req.query });

    // 1. Validate required environment variables
    const missing = LINKEDIN_REQUIRED_ENV.filter((key) => {
      const v = process.env[key];
      return !v || (typeof v === 'string' && !v.trim());
    });
    if (missing.length) {
      console.error('[LinkedIn callback] Missing required environment variables:', missing.join(', '));
      return res.status(500).json({
        error: 'Server configuration error',
        message: 'Missing required environment variables: ' + missing.join(', '),
      });
    }

    if (!supabaseAdmin) {
      console.error('[LinkedIn callback] Supabase admin client not initialized');
      return res.status(500).json({ error: 'Server configuration error', message: 'Database not configured' });
    }

    const code = req.query.code != null ? String(req.query.code).trim() : '';
    const state = req.query.state != null ? String(req.query.state) : '';
    const error = req.query.error;
    const error_description = req.query.error_description;

    if (error) {
      console.log('[LinkedIn callback] LinkedIn returned error:', error, error_description);
      return res.redirect(`${settingsUrl}?error=${encodeURIComponent(error)}&msg=${encodeURIComponent(error_description || '')}`);
    }

    // 2. Validate incoming request: code required
    if (!code) {
      console.error('[LinkedIn callback] Missing code in request query');
      return res.status(400).json({ error: 'Bad Request', message: 'Missing authorization code (code)' });
    }

    if (!state) {
      console.error('[LinkedIn callback] Missing state in request query');
      return res.redirect(302, failRedirect);
    }

    let userId;
    try {
      const stateJson = Buffer.from(state, 'base64').toString('ascii');
      const parsed = JSON.parse(stateJson);
      userId = parsed.userId;
    } catch (parseErr) {
      console.error('[LinkedIn callback] Failed to parse state:', parseErr);
      return res.redirect(302, failRedirect);
    }

    if (!userId || userId === '00000000-0000-0000-0000-000000000000') {
      console.error('[LinkedIn callback] Invalid or missing userId in state');
      return res.redirect(302, failRedirect);
    }

    console.log('[LinkedIn callback] Token exchange starting for userId:', userId);

    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI_EXACT,
        client_id: process.env.LINKEDIN_CLIENT_ID.trim(),
        client_secret: process.env.LINKEDIN_CLIENT_SECRET.trim(),
      }),
    });

    const tokenData = await tokenResponse.json().catch(() => ({}));
    console.log('[LinkedIn callback] LinkedIn API response status:', tokenResponse.status, 'ok:', tokenResponse.ok);

    if (!tokenResponse.ok) {
      console.error('[LinkedIn callback] Token exchange failed. Full response:', {
        status: tokenResponse.status,
        ok: tokenResponse.ok,
        body: tokenData,
      });
      return res.redirect(302, failRedirect);
    }

    const accessToken = tokenData.access_token;
    if (!accessToken || typeof accessToken !== 'string' || accessToken.length < 10) {
      console.error('[LinkedIn callback] Invalid token in response:', {
        hasToken: !!accessToken,
        type: typeof accessToken,
      });
      return res.redirect(302, failRedirect);
    }

    let linkedinId = null;
    try {
      const userInfoResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (userInfoResponse.ok) {
        const userInfo = await userInfoResponse.json();
        linkedinId = userInfo.sub || null;
      }
    } catch (e) {
      console.warn('[LinkedIn callback] LinkedIn userinfo fetch failed (non-fatal):', e?.message);
    }

    const expiresIn = tokenData.expires_in;
    const linkedinTokenExpiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    const updatePayload = {
      linkedin_token: accessToken,
      linkedin_connected: true,
      ...(linkedinId != null && { linkedin_profile_id: linkedinId }),
      ...(linkedinTokenExpiresAt && { linkedin_token_expires_at: linkedinTokenExpiresAt }),
    };

    const { error: dbError } = await supabaseAdmin
      .from('profiles')
      .update(updatePayload)
      .eq('user_id', userId);

    if (dbError) {
      console.error('[LinkedIn callback] Supabase storage failed:', dbError);
      return res.redirect(302, failRedirect);
    }

    console.log('[LinkedIn callback] Supabase storage success for userId:', userId);
    return res.redirect(302, `${settingsUrl}?linkedin=connected`);
  } catch (err) {
    console.error('[LinkedIn callback] Unhandled error:', err);
    return res.redirect(302, failRedirect);
  }
});


/**
 * GET /api/posts/:userId
 * Retrieves the posting history for a specific user (MongoDB fallback)
 */
app.get('/api/posts/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(200).json([]);
    }
    const posts = await Post.find({ userId }).sort({ created_at: -1 });
    res.status(200).json(posts);
  } catch (error) {
    console.error('Fetch Posts Error:', error);
    res.status(500).json({ error: 'Failed to fetch post history' });
  }
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/publish
 * Validates the user profile then triggers the automation engine.
 * In local dev this only validates; the full Gemini+LinkedIn flow runs on Vercel functions.
 */
app.post('/api/publish', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const content =
      typeof body.content === 'string' && body.content.trim() !== ''
        ? body.content
        : 'Test post';
    const userId =
      typeof body.user_id === 'string' && body.user_id.trim() !== ''
        ? body.user_id.trim()
        : null;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'user_id is required for publish' });
    }

    if (!UUID_REGEX.test(userId)) {
      return res.status(400).json({ success: false, error: 'Invalid user_id' });
    }

    if (supabaseAdmin) {
      const { data: prof, error: profErr } = await supabaseAdmin
        .from('profiles')
        .select('linkedin_connected, onboarding_completed')
        .eq('user_id', userId)
        .maybeSingle();
      if (profErr || !prof) {
        return res.status(400).json({
          success: false,
          error: 'Profile not found. Complete onboarding first.',
        });
      }
      if (!prof.linkedin_connected) {
        return res.status(400).json({
          success: false,
          error: 'LinkedIn is not connected. Connect it in Settings.',
        });
      }
      if (!prof.onboarding_completed) {
        return res.status(400).json({
          success: false,
          error: 'Finish onboarding before publishing.',
        });
      }
    }

    return res.status(200).json({ success: true, message: 'Publish queued. Automation runs via Vercel functions in production.' });
  } catch (e) {
    console.error('Publish error:', e);
    return res.status(500).json({ success: false });
  }
});

/**
 * POST /api/automation/toggle
 * Enable or disable automation for the authenticated user.
 * Mirrors app/api/automation/toggle/route.ts for the Vite dev proxy (Express).
 */
app.post('/api/automation/toggle', async (req, res) => {
  if (!supabaseAdmin || !supabaseAuthClient) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }
  try {
    const authHeader = req.headers['authorization'] ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.slice(7);

    // Resolve the user from the Bearer token
    const tokenClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await tokenClient.auth.getUser();
    if (authError || !user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const userId = user.id;

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const action = typeof body.action === 'string' ? body.action : '';
    if (action !== 'enable' && action !== 'disable') {
      return res.status(400).json({ error: 'Invalid action. Must be "enable" or "disable".' });
    }

    if (action === 'disable') {
      await supabaseAdmin.from('profiles').update({ active: false, status: 'paused' }).eq('user_id', userId);
      return res.status(200).json({ success: true, message: 'Automation disabled.' });
    }

    // ENABLE path — validate profile fields
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role, skills, topics')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError) {
      console.error('[automation/toggle] Profile fetch error:', profileError);
      return res.status(500).json({ error: 'Failed to fetch profile. Please try again.' });
    }
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found. Complete your profile setup first.' });
    }

    const role = typeof profile.role === 'string' ? profile.role.trim() : '';
    const parseList = (v) => {
      if (Array.isArray(v)) return v.filter(Boolean);
      if (typeof v === 'string' && v.trim()) {
        try { const p = JSON.parse(v); return Array.isArray(p) ? p.filter(Boolean) : [v.trim()]; } catch { return v.split(',').map(s => s.trim()).filter(Boolean); }
      }
      return [];
    };
    const skills = parseList(profile.skills);
    const topics = parseList(profile.topics);

    const missing = [];
    if (!role) missing.push('role');
    if (skills.length === 0) missing.push('skills');
    if (topics.length === 0) missing.push('topics');

    if (missing.length > 0) {
      return res.status(422).json({
        error: `Complete your profile before enabling automation. Missing: ${missing.join(', ')}.`,
        missing,
      });
    }

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ active: true, status: 'active' })
      .eq('user_id', userId);

    if (updateError) {
      console.error('[automation/toggle] Profile update error:', updateError);
      return res.status(500).json({ error: 'Failed to update automation status. Please try again.' });
    }

    await supabaseAdmin
      .from('automation_rotation')
      .upsert({ user_id: userId, current_step: 1 }, { onConflict: 'user_id', ignoreDuplicates: true });

    return res.status(200).json({ success: true, message: 'Automation enabled.' });
  } catch (error) {
    console.error('[automation/toggle] Unexpected error:', error);
    return res.status(500).json({ error: 'Unexpected server error. Please try again.' });
  }
});

/**
 * GET /api/logs
 * Activity log: fetch posts for a user from Supabase (bypasses RLS via service role).
 * Query: ?user_id=<uuid> (required). Used by Activity Log page.
 */
app.get('/api/logs', async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }
  try {
    const user_id = req.query.user_id;
    if (!user_id || typeof user_id !== 'string' || !UUID_REGEX.test(user_id)) {
      return res.status(400).json({ error: 'Valid user_id (UUID) is required' });
    }
    const { data, error } = await supabaseAdmin
      .from('posts')
      .select('*')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /api/logs] Supabase error:', error);
      return res.status(500).json({ error: error.message || 'Failed to fetch activity log' });
    }
    return res.status(200).json(data ?? []);
  } catch (error) {
    console.error('[GET /api/logs] Error:', error);
    return res.status(500).json({ error: 'Failed to fetch activity log' });
  }
});

/**
 * POST /api/posts
 * Save a published post to Supabase after the automation engine publishes to LinkedIn.
 * Body: { user_id (valid UUID), content, status?, posted_at?, linkedin_post_id? }
 */
app.post('/api/posts', async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }
  try {
    const { user_id, content, status = 'posted', posted_at, linkedin_post_id } = req.body;
    if (!user_id || content == null) {
      return res.status(400).json({ error: 'user_id and content are required' });
    }
    if (typeof user_id !== 'string' || !UUID_REGEX.test(user_id)) {
      console.error('[POST /api/posts] invalid user_id (must be UUID):', user_id);
      return res.status(400).json({ error: 'user_id must be a valid UUID' });
    }
    const row = {
      user_id,
      content: String(content),
      status: ['posted', 'scheduled', 'failed'].includes(String(status)) ? status : 'posted',
    };
    if (linkedin_post_id) {
      row.post_url = `https://www.linkedin.com/feed/update/${linkedin_post_id}`;
    }
    const { data, error } = await supabaseAdmin.from('posts').insert([row]).select('id').single();
    if (error) {
      console.error('Supabase error (POST /api/posts):', error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json({ success: true, id: data?.id });
  } catch (error) {
    console.error('Save Post Error:', error);
    return res.status(500).json({ error: 'Failed to save post' });
  }
});

/**
 * POST /api/auth/register
 */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'User already exists' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      plan: 'dev'
    });

    await newUser.save();
    const token = jwt.sign({ id: newUser._id, email: newUser.email }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      success: true,
      token,
      user: { id: newUser._id, name: newUser.name, email: newUser.email }
    });
  } catch (error) {
    console.error('Registration Error:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

/**
 * POST /api/auth/login
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid email or password' });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      user: { id: user._id, name: user.name, email: user.email }
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

/**
 * POST /api/upload-resume
 */
app.post('/api/upload-resume', upload.single('resume'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please upload a file' });
    }
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.status(200).json({
      success: true,
      url: fileUrl,
      filename: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size
    });
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: error.message || 'Failed to upload file' });
  }
});

/**
 * POST /api/save-schedule
 */
app.post('/api/save-schedule', authenticateToken, async (req, res) => {
  const { schedule } = req.body;
  const email = req.user.email;
  try {
    const user = await User.findOneAndUpdate(
      { email },
      { schedule },
      { new: true, upsert: true }
    );
    res.status(200).json({ success: true, schedule: user.schedule });
  } catch (error) {
    console.error('Save Schedule Error:', error);
    res.status(500).json({ error: 'Failed to save schedule' });
  }
});

/**
 * GET /api/get-schedule
 */
app.get('/api/get-schedule', authenticateToken, async (req, res) => {
  const email = req.user.email;
  try {
    const user = await User.findOne({ email });
    res.status(200).json(user ? user.schedule : []);
  } catch (error) {
    console.error('Get Schedule Error:', error);
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

// Legacy Mongo Agent Start (kept for compatibility)
app.post('/api/start-agent-legacy', authenticateToken, async (req, res) => {
  const { userData } = req.body;
  const email = req.user.email;
  try {
    // ... logic ...
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * POST /api/save-settings
 * Save user profile settings using service role key to bypass RLS
 */
app.post('/api/save-settings', async (req, res) => {
  const { user_id, role, skills, topics, email } = req.body;

  if (!user_id) {
    return res.status(400).json({ success: false, error: 'user_id is required' });
  }

  if (!supabaseAdmin) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY env var. Cannot update database.');
    return res.status(500).json({ success: false, error: 'Server configuration error' });
  }

  try {
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('user_id', user_id)
      .maybeSingle();
    if (fetchErr) {
      console.error('[save-settings] profile fetch:', fetchErr);
      return res.status(500).json({ success: false, error: fetchErr.message });
    }

    const ex = existing || {};
    const payload = {
      ...ex,
      user_id,
      updated_at: new Date().toISOString(),
    };

    if (email && String(email).trim() !== '') {
      payload.email = String(email).trim();
    }
    if (role != null && String(role).trim() !== '') {
      payload.role = String(role).trim();
    }
    const skillsJoined = Array.isArray(skills)
      ? skills.map((s) => String(s).trim()).filter(Boolean).join(', ')
      : String(skills || '').trim();
    if (skillsJoined) {
      payload.skills = skillsJoined;
    }
    const topicsJoined = Array.isArray(topics)
      ? topics.map((t) => String(t).trim()).filter(Boolean).join(', ')
      : String(topics || '').trim();
    if (topicsJoined) {
      payload.topics = topicsJoined;
    }

    console.log(`[save-settings] Upserting profile for userId=${user_id}`);

    const { error: upsertError } = await supabaseAdmin
      .from('profiles')
      .upsert(payload, { onConflict: 'user_id' });

    if (upsertError) {
      console.error(`[save-settings] Database upsert failed: ${upsertError.message}`);
      return res.status(500).json({ success: false, error: `Database error: ${upsertError.message}` });
    }

    console.log(`[save-settings] Successfully saved settings for userId=${user_id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[save-settings] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================================
// ADMIN API ROUTES — use supabaseAdmin (service role key) so RLS is bypassed
// and ALL rows from ALL users are returned. Never filter by session user here.
// =============================================================================

/**
 * GET /api/admin/users
 * Returns every row in the profiles table.
 */
app.get('/api/admin/users', async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Supabase service role key not configured.' });
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('user_id, email, auth_roles, created_at')
      .order('created_at', { ascending: false });
    if (error) { console.error('[admin/users]', error.message); return res.status(500).json({ error: error.message }); }
    console.log(`[admin/users] returning ${data?.length ?? 0} users`);
    return res.json({ users: data ?? [] });
  } catch (err) { return res.status(500).json({ error: err.message || 'Failed' }); }
});

/**
 * GET /api/admin/posts
 * Returns ALL posts from ALL users (no status filter).
 * Columns mirror the Supabase `posts` table schema exactly.
 */
app.get('/api/admin/posts', async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Supabase service role key not configured.' });
  try {
    const { data, error } = await supabaseAdmin
      .from('posts')
      .select('id, user_id, content, post_url, created_at, updated_at, post_id, posted_at, status')
      .order('created_at', { ascending: false });
    if (error) { console.error('[admin/posts]', error.message); return res.status(500).json({ error: error.message }); }
    console.log(`[admin/posts] returning ${data?.length ?? 0} posts`);
    return res.json({ posts: data ?? [] });
  } catch (err) { return res.status(500).json({ error: err.message || 'Failed' }); }
});

/**
 * GET /api/admin/stats
 * Returns { totalUsers, totalPosts } counts.
 */
app.get('/api/admin/stats', async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Supabase service role key not configured.' });
  try {
    const [uRes, pRes] = await Promise.all([
      supabaseAdmin.from('profiles').select('user_id', { count: 'exact', head: true }),
      supabaseAdmin.from('posts').select('id',      { count: 'exact', head: true }),
    ]);
    if (uRes.error) return res.status(500).json({ error: uRes.error.message });
    if (pRes.error) return res.status(500).json({ error: pRes.error.message });
    const stats = { totalUsers: uRes.count ?? 0, totalPosts: pRes.count ?? 0 };
    console.log(`[admin/stats] totalUsers=${stats.totalUsers} totalPosts=${stats.totalPosts}`);
    return res.json(stats);
  } catch (err) { return res.status(500).json({ error: err.message || 'Failed' }); }
});

// =============================================================================

/**
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected' });
});

const resumePipeline = require('./lib/resumePipeline.cjs');

/** POST /api/parse-resume — download PDF/DOCX from Supabase public URL and extract plain text */
app.post('/api/parse-resume', async (req, res) => {
  try {
    const { fileUrl } = req.body || {};
    if (!fileUrl || typeof fileUrl !== 'string') {
      return res.status(400).json({ error: 'fileUrl is required' });
    }
    const text = await resumePipeline.fetchAndExtractText(fileUrl.trim());
    return res.json({ text });
  } catch (err) {
    console.error('[parse-resume]', err);
    return res.status(500).json({ error: err.message || 'parse failed' });
  }
});

/** POST /api/generate-profile — Gemini structured role / skills / topics from resume text */
app.post('/api/generate-profile', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    const profile = await resumePipeline.generateProfileFromText(text.trim());
    return res.json(profile);
  } catch (err) {
    console.error('[generate-profile]', err);
    return res.status(500).json({ error: err.message || 'generation failed' });
  }
});

/**
 * POST /api/analyze-resume — OpenAI extracts role, skills, topics from resume URL.
 */
app.post('/api/analyze-resume', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : null;
    console.log('Incoming request:', body);

    if (!body || !body.fileUrl || typeof body.fileUrl !== 'string' || !body.fileUrl.trim()) {
      return res.status(200).json({
        success: false,
        role: '',
        skills: [],
        topics: [],
      });
    }

    const result = await analyzeResumeFromUrl(body.fileUrl.trim());
    const payload = {
      success: result.success === true,
      role: result.role || '',
      skills: Array.isArray(result.skills) ? result.skills : [],
      topics: Array.isArray(result.topics) ? result.topics : [],
    };
    if (result.error) {
      payload.error = result.error;
    }
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Analyze Resume Error:', error);
    return res.status(200).json({
      success: false,
      role: '',
      skills: [],
      topics: [],
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
