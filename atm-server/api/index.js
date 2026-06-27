import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';

import indexRouter from '../routes/index.js';
import authRouter from '../routes/auth.route.js';
import apiRouter from '../routes/api.route.js';
import productionRouter from '../routes/production.route.js';
import connectDB from '../db/config/sql.config.js';
import insertUser from '../middleware/insertUser.js';

dotenv.config();

const app = express();
app.use(express.json());

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://amtomberge.vercel.app',
  ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',').map(origin => origin.trim()) : []),
];

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
}));

const dbErrorResponse = (error) => {
  if (!process.env.DATABASE_URL?.trim() || error?.message === 'DATABASE_URL_MISSING') {
    return {
      success: false,
      message: 'DATABASE_URL missing - add Aiven MySQL env vars in Vercel dashboard and redeploy',
    };
  }
  return {
    success: false,
    message: 'Database connection failed',
    hint: 'Check Aiven MySQL credentials, SSL mode, and network access',
  };
};

app.get('/', (_req, res) => {
  res.json({ success: true, message: 'API is running' });
});

app.get('/api/health', async (_req, res) => {
  try {
    await connectDB();
    res.json({ success: true, message: 'Database connected' });
  } catch (error) {
    res.status(503).json(dbErrorResponse(error));
  }
});

const skipDbPaths = new Set(['/', '/api/health', '/health']);

app.use(async (req, res, next) => {
  if (skipDbPaths.has(req.path)) return next();

  try {
    await connectDB();
    if (req.path.startsWith('/api/auth') || req.path.startsWith('/api/production/users')) {
      await insertUser();
    }
    next();
  } catch (error) {
    console.error('DB middleware error:', error?.message ?? error);
    res.status(503).json(dbErrorResponse(error));
  }
});

app.use('/api/auth', authRouter);
app.use('/api/production', productionRouter);
app.use('/api', indexRouter);
app.use('/api', apiRouter);

app.use((error, _req, res, next) => {
  console.error('Unhandled route error:', error?.message ?? error);
  if (res.headersSent) return next(error);
  res.status(500).json({
    success: false,
    message: error?.message || 'Internal server error',
  });
});

export default app;
