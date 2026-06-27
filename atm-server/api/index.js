// api/index.js
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';

import indexRouter     from '../routes/index.js';
import authRouter      from '../routes/auth.route.js';
import apiRouter       from '../routes/api.route.js';
import productionRouter from '../routes/production.route.js';
import connectDB       from '../db/config/mongoose.config.js';
import insertUser      from '../middleware/insertUser.js';

dotenv.config();

const app = express();
app.use(express.json());

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:5173',
  'https://amtomberge.vercel.app',
  ...(process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map(o => o.trim())
    : []),
];
app.use(cors({
  origin: (origin, cb) => (!origin || allowedOrigins.includes(origin)) ? cb(null, true) : cb(new Error('Not allowed by CORS')),
}));

// ── Health / root ─────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({ success: true, message: 'API is running' }));

app.get('/api/health', async (_req, res) => {
  if (!process.env.MONGO_URI) {
    return res.status(503).json({ success: false, message: 'MONGO_URI missing' });
  }
  try {
    await connectDB();
    res.json({ success: true, message: 'Database connected' });
  } catch (e) {
    res.status(503).json({ success: false, message: 'Database connection failed', hint: 'Check MongoDB Atlas Network Access allows 0.0.0.0/0' });
  }
});

// ── DB middleware ─────────────────────────────────────────────────────────────
// FIX 1: skip more paths, and NEVER crash the process — always return JSON
const skipDbPaths = new Set(['/', '/api/health', '/health']);

app.use(async (req, res, next) => {
  if (skipDbPaths.has(req.path)) return next();

  if (!process.env.MONGO_URI?.trim()) {
    return res.status(503).json({
      success: false,
      message: 'MONGO_URI missing — add env vars in Vercel dashboard and redeploy',
    });
  }

  try {
    await connectDB();
    // FIX 2: insertUser() only runs for auth routes, NOT for every API call
    // Running it on every request was causing hangs/failures on production routes
    if (req.path.startsWith('/api/auth')) {
      await insertUser();
    }
    next();
  } catch (error) {
    console.error('DB middleware error:', error?.message ?? error);
    // FIX 3: Always return JSON — never let Express fall through to Vercel's HTML 500
    return res.status(503).json({
      success: false,
      message: 'Database connection failed',
      hint: 'MongoDB Atlas → Network Access → allow 0.0.0.0/0',
    });
  }
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',       authRouter);
app.use('/api/production', productionRouter);
app.use('/api',            indexRouter);
app.use('/api',            apiRouter);

// FIX 4: Global error handler — catches any unhandled throw in routes
// Without this, Express hands the error to Vercel which returns HTML
app.use((err, req, res, next) => {
  console.error('Unhandled route error:', err?.message ?? err);
  if (res.headersSent) return next(err);
  res.status(500).json({
    success: false,
    message: err?.message || 'Internal server error',
  });
});

export default app;