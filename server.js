const express = require('express');
const cors = require('cors');
const app = express();
const rateLimit = require('express-rate-limit');

// Enhanced CORS configuration for game development
app.use(cors({
  origin: [
    'http://localhost:3000',        // Local development
    'http://localhost:7700',        // Common Vite port
    'https://game-server-five.vercel.app',         // All Vercel deployments
    'https://your-game-domain.com'  // Your production domain
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Rate limiting to prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later'
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Game server state
let serverState = {
  playersConnected: 0,
  serverLoad: 0, // 0-100
  lastPing: Date.now(),
  gameSessions: {}
};

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    playersConnected: serverState.playersConnected,
    serverLoad: serverState.serverLoad,
    uptime: process.uptime()
  });
});

// Connection handshake endpoint
app.post('/api/connect', (req, res) => {
  const { playerId, clientInfo } = req.body;
  
  if (!playerId) {
    return res.status(400).json({ error: 'Player ID is required' });
  }

  serverState.playersConnected++;
  serverState.serverLoad = Math.min(100, serverState.serverLoad + 5);
  serverState.lastPing = Date.now();
  
  // Initialize player session
  serverState.gameSessions[playerId] = {
    connectedAt: Date.now(),
    lastActivity: Date.now(),
    clientInfo: clientInfo || {}
  };

  res.json({
    status: 'connected',
    sessionId: playerId,
    serverTime: Date.now(),
    heartbeatInterval: 30000 // Request client to ping every 30s
  });
});

// Heartbeat endpoint
app.post('/api/heartbeat', (req, res) => {
  const { playerId } = req.body;
  
  if (!playerId || !serverState.gameSessions[playerId]) {
    return res.status(404).json({ error: 'Session not found' });
  }

  serverState.gameSessions[playerId].lastActivity = Date.now();
  serverState.lastPing = Date.now();
  
  res.json({
    status: 'active',
    serverTime: Date.now()
  });
});

// Disconnection endpoint
app.post('/api/disconnect', (req, res) => {
  const { playerId } = req.body;
  
  if (playerId && serverState.gameSessions[playerId]) {
    serverState.playersConnected--;
    serverState.serverLoad = Math.max(0, serverState.serverLoad - 5);
    delete serverState.gameSessions[playerId];
  }

  res.json({ status: 'disconnected' });
});

// Game data endpoint (example)
app.post('/api/game-data', (req, res) => {
  const { playerId, data } = req.body;
  
  if (!playerId || !serverState.gameSessions[playerId]) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Process game data here
  console.log(`Received data from ${playerId}:`, data);
  
  // Update last activity
  serverState.gameSessions[playerId].lastActivity = Date.now();
  
  res.json({
    status: 'received',
    serverTime: Date.now(),
    dataProcessed: true
  });
});

// Cleanup inactive sessions (runs every 5 minutes)
setInterval(() => {
  const now = Date.now();
  const timeout = 300000; // 5 minutes
  
  Object.keys(serverState.gameSessions).forEach(playerId => {
    if (now - serverState.gameSessions[playerId].lastActivity > timeout) {
      console.log(`Cleaning up inactive session: ${playerId}`);
      serverState.playersConnected--;
      delete serverState.gameSessions[playerId];
    }
  });
  
  // Adjust server load based on current connections
  serverState.serverLoad = Math.min(100, serverState.playersConnected * 2);
}, 300000);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Vercel requires module.exports
module.exports = app;

// Only listen locally if not in Vercel
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Game server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}
