import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';

import indexRouter from './routes/index.js';
import authRouter from './routes/auth.route.js';
import apiRouter from './routes/api.route.js';
import connectDB from './db/config/mongoose.config.js';
import insertUser from './middleware/insertUser.js';

// Add this import
import productionRouter from './routes/production.route.js';



dotenv.config();

const app = express();
app.use(express.json());

// Local: routes at /api/*. Vercel serverless strips /api prefix before Express sees the path.
const isVercel = process.env.VERCEL === '1';

const allowedOrigins = [
  'http://localhost:5173',
  "https://amtomberge.vercel.app",
  ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',').map(origin => origin.trim()) : []),
];
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
};

app.use(cors(corsOptions));

const mountApi = (path, router) => {
  app.use(`/api${path}`, router);
  if (isVercel) app.use(path || '/', router);
};

const healthHandler = async (req, res) => {
  if (!process.env.MONGO_URI) {
    return res.status(503).json({
      success: false,
      message: 'MONGO_URI missing on server — add env vars and redeploy',
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
};

app.get('/', (req, res) => {
  res.json({ success: true, message: 'Atomberg API is running' });
});

app.get('/api/health', healthHandler);
if (isVercel) app.get('/health', healthHandler);

const dbErrorResponse = (error) => {
  if (!String(process.env.MONGO_URI || '').trim() || error?.message === 'MONGO_URI_MISSING') {
    return {
      success: false,
      message: 'MONGO_URI missing on Vercel — add env in Production and redeploy',
    };
  }
  return {
    success: false,
    message: 'Database connection failed',
    hint: 'MongoDB Atlas → Network Access → allow 0.0.0.0/0 (Allow from anywhere)',
  };
};

const skipDbPaths = new Set(['/', '/health', '/api/health']);

app.use(async (req, res, next) => {
  if (skipDbPaths.has(req.path)) return next();
  try {
    await connectDB();
    await insertUser();
    next();
  } catch (error) {
    console.error('Database middleware error:', error?.message || error);
    res.status(503).json(dbErrorResponse(error));
  }
});

mountApi('', indexRouter);
mountApi('/auth', authRouter);
mountApi('', apiRouter);
// Add this mount (alongside your existing routes)
app.use('/api/production', productionRouter);

export const startServer = async () => {
  
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
};

if (process.env.VERCEL !== '1' && process.env.NODE_ENV !== 'test') {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

export default app;
