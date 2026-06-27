// api/index.js  ← Vercel picks this up automatically
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';

import indexRouter from '../routes/index.js';
import authRouter from '../routes/auth.route.js';
import apiRouter from '../routes/api.route.js';
import connectDB from '../db/config/mongoose.config.js';
import insertUser from '../middleware/insertUser.js';
import productionRouter from '../routes/production.route.js';


dotenv.config();

const app = express();
app.use(express.json());

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:5173',
  'https://amtomberge.vercel.app',
  ...(process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map((o) => o.trim())
    : []),
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) callback(null, true);
      else callback(new Error('Not allowed by CORS'));
    },
  })
);

// ── Health / root ─────────────────────────────────────────────────────────────
app.get('/', (_req, res) =>
  res.json({ success: true, message: 'API is running' })
);

app.get('/api/health', async (_req, res) => {
  if (!process.env.MONGO_URI) {
    return res.status(503).json({
      success: false,
      message: 'MONGO_URI missing — add env vars and redeploy',
    });
  }
  try {
    await connectDB();
    res.json({ success: true, message: 'Database connected' });
  } catch {
    res.status(503).json({
      success: false,
      message: 'Database connection failed',
      hint: 'Check MongoDB Atlas Network Access allows 0.0.0.0/0',
    });
  }
});

// ── DB middleware (runs before every protected route) ─────────────────────────
const skipDbPaths = new Set(['/', '/api/health']);

app.use(async (req, res, next) => {
  if (skipDbPaths.has(req.path)) return next();

  if (!process.env.MONGO_URI?.trim()) {
    return res.status(503).json({
      success: false,
      message: 'MONGO_URI missing — add env vars and redeploy',
    });
  }

  try {
    await connectDB();   // Mongoose reuses the cached connection on warm invocations
    await insertUser();
    next();
  } catch (error) {
    console.error('DB middleware error:', error?.message ?? error);
    res.status(503).json({
      success: false,
      message: 'Database connection failed',
      hint: 'MongoDB Atlas → Network Access → allow 0.0.0.0/0',
    });
  }
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', indexRouter);
app.use('/api/auth', authRouter);
app.use('/api', apiRouter);
app.use('/api/production', productionRouter);

// ── Export for Vercel (no app.listen) ─────────────────────────────────────────
export default app;