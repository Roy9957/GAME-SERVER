require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const firebaseAdmin = require('firebase-admin');

// Initialize Express
const app = express();

// Error handling right at the start
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

// Initialize Firebase with environment variables
firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = firebaseAdmin.database();
db.goOnline(); // Explicit connection

// Enhanced CORS configuration
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:7700',
    'https://game-server-five.vercel.app',
    'https://www.mobe-game.rf.gd'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later'
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Server state - simplified for serverless
const serverState = {
  playersConnected: 0,
  gameSessions: {}
};

// Constants
const MATCH_CONFIRMATION_TIMEOUT = 15000; // 15 seconds
const PLAYER_TIMEOUT = 300000; // 5 minutes

// Health endpoints
app.get('/', (req, res) => {
  res.status(200).send('MOBE Game Server - Healthy');
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    playersConnected: serverState.playersConnected,
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

// Player connection endpoints
app.post('/api/connect', async (req, res) => {
  try {
    const { playerId, clientInfo } = req.body;
    
    if (!playerId) {
      return res.status(400).json({ error: 'Player ID is required' });
    }

    serverState.playersConnected++;
    
    serverState.gameSessions[playerId] = {
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      clientInfo: clientInfo || {},
      status: 'connected'
    };

    res.json({
      status: 'connected',
      sessionId: playerId,
      serverTime: Date.now(),
      heartbeatInterval: 30000
    });
  } catch (error) {
    console.error('Connection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Matchmaking endpoints
app.post('/api/matchmaking/join', async (req, res) => {
  try {
    const { playerId, playerData } = req.body;
    
    if (!playerId) {
      return res.status(400).json({ error: 'Player ID is required' });
    }

    await db.ref(`matchmaking/${playerId}`).set({
      ...playerData,
      status: 'waiting',
      timestamp: firebaseAdmin.database.ServerValue.TIMESTAMP
    });
    
    res.json({ status: 'in_queue' });
  } catch (error) {
    console.error('Matchmaking join error:', error);
    res.status(500).json({ error: 'Failed to join matchmaking' });
  }
});

// Simplified matchmaking status check
app.post('/api/matchmaking/status', async (req, res) => {
  try {
    const { playerId } = req.body;
    const snapshot = await db.ref(`matches/${playerId}`).once('value');
    
    if (snapshot.exists()) {
      res.json({ status: 'match_found', match: snapshot.val() });
    } else {
      res.json({ status: 'waiting' });
    }
  } catch (error) {
    console.error('Matchmaking status error:', error);
    res.status(500).json({ error: 'Failed to check match status' });
  }
});

// Game session endpoints
app.post('/api/game/state', async (req, res) => {
  try {
    const { matchId, playerId } = req.body;
    const snapshot = await db.ref(`gameSessions/${matchId}`).once('value');
    
    if (snapshot.exists()) {
      res.json({
        gameState: snapshot.val(),
        serverTime: Date.now()
      });
    } else {
      res.status(404).json({ error: 'Game session not found' });
    }
  } catch (error) {
    console.error('Game state error:', error);
    res.status(500).json({ error: 'Failed to get game state' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Server initialization
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Serverless-friendly cleanup
if (process.env.NODE_ENV === 'production') {
  process.on('SIGTERM', () => {
    console.log('SIGTERM received. Closing server...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
}

module.exports = app;
