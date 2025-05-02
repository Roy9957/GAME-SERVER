const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration
const allowedOrigins = [
  'http://localhost:7700',
  'https://www.mobe-game.rf.gd',
  'http://localhost:5500' // Add your local dev server
];

app.use(cors({
  origin: allowedOrigins
}));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    serverTime: new Date().toISOString()
  });
});

// Game data endpoint
app.get('/load-game', async (req, res) => {
  try {
    res.json({
      status: 'success',
      gameInfo: 'Game data loaded successfully'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load game data' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
