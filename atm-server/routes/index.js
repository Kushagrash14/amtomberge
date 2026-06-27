import express from 'express';

const router = express.Router();

router.get('/index', (req, res) => {
  res.send('Hello from the index route!');
});

export default router;