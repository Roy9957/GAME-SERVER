const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const firebaseAdmin = require('firebase-admin');
const serviceAccount = require('./firebase-credentials.json'); // Create this file with your Firebase credentials

// Initialize Firebase
firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert(serviceAccount),
  databaseURL: "https://artificial-intelligence-55880-default-rtdb.asia-southeast1.firebasedatabase.app"
});
const db = firebaseAdmin.database();

// Initialize Express
const app = express();

// Enhanced CORS configuration
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:7700',
    'https://game-server-five.vercel.app',
    'https://www.mobe-game.rf.gd'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests from this IP, please try again later'
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Server state
const serverState = {
  playersConnected: 0,
  serverLoad: 0,
  lastPing: Date.now(),
  gameSessions: {},
  matchmakingQueue: []
};

// Constants
const MATCH_CONFIRMATION_TIMEOUT = 15000; // 15 seconds
const PLAYER_TIMEOUT = 300000; // 5 minutes
const MATCH_EXPIRATION = 3600000; // 1 hour
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    playersConnected: serverState.playersConnected,
    serverLoad: serverState.serverLoad,
    uptime: process.uptime(),
    activeSessions: Object.keys(serverState.gameSessions).length
  });
});

// Player connection endpoints
app.post('/api/connect', (req, res) => {
  const { playerId, clientInfo } = req.body;
  
  if (!playerId) {
    return res.status(400).json({ error: 'Player ID is required' });
  }

  serverState.playersConnected++;
  serverState.serverLoad = Math.min(100, serverState.serverLoad + 5);
  serverState.lastPing = Date.now();
  
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
    heartbeatInterval: HEARTBEAT_INTERVAL
  });
});

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

app.post('/api/disconnect', (req, res) => {
  const { playerId } = req.body;
  
  if (playerId && serverState.gameSessions[playerId]) {
    cleanupPlayer(playerId);
  }

  res.json({ status: 'disconnected' });
});

// Matchmaking endpoints
app.post('/api/matchmaking/join', async (req, res) => {
  const { playerId, playerData } = req.body;
  
  try {
    // Check if player is already in queue
    const existing = await db.ref(`matchmaking/${playerId}`).once('value');
    if (existing.exists()) {
      return res.status(400).json({ error: 'Already in matchmaking queue' });
    }

    // Add to Firebase queue
    await db.ref(`matchmaking/${playerId}`).set({
      ...playerData,
      status: 'waiting',
      timestamp: firebaseAdmin.database.ServerValue.TIMESTAMP
    });
    
    // Add to in-memory queue for faster matching
    serverState.matchmakingQueue.push({
      playerId,
      ...playerData,
      timestamp: Date.now()
    });
    
    res.json({ status: 'in_queue' });
  } catch (error) {
    console.error('Matchmaking join error:', error);
    res.status(500).json({ error: 'Failed to join matchmaking' });
  }
});

app.post('/api/matchmaking/status', async (req, res) => {
  const { playerId } = req.body;
  
  try {
    // Check for match proposals
    const proposalSnapshot = await db.ref(`matchProposals/${playerId}`).once('value');
    const proposal = proposalSnapshot.val();
    
    if (proposal) {
      res.json({ status: 'match_found', match: proposal });
    } else {
      // Check if still in queue
      const queueSnapshot = await db.ref(`matchmaking/${playerId}`).once('value');
      if (queueSnapshot.exists()) {
        res.json({ status: 'waiting' });
      } else {
        res.json({ status: 'not_in_queue' });
      }
    }
  } catch (error) {
    console.error('Matchmaking status error:', error);
    res.status(500).json({ error: 'Failed to check match status' });
  }
});

app.post('/api/matchmaking/confirm', async (req, res) => {
  const { playerId, matchId, accept } = req.body;
  
  try {
    if (accept) {
      // Update match status
      await db.ref(`matches/${matchId}/players/${playerId}`).update({
        status: 'ready',
        timestamp: firebaseAdmin.database.ServerValue.TIMESTAMP
      });
      
      // Check if both players are ready
      const matchSnapshot = await db.ref(`matches/${matchId}`).once('value');
      const match = matchSnapshot.val();
      
      if (Object.values(match.players).every(p => p.status === 'ready')) {
        // Both players ready - activate match
        await db.ref(`matches/${matchId}`).update({ status: 'active' });
        
        // Create game session
        serverState.gameSessions[matchId] = {
          players: Object.keys(match.players),
          startedAt: Date.now(),
          lastUpdate: Date.now(),
          gameState: initializeGameState(Object.keys(match.players))
        };
      }
      
      res.json({ status: 'confirmed' });
    } else {
      // Reject the match
      await db.ref(`matches/${matchId}`).update({
        status: 'cancelled',
        reason: 'rejected',
        rejectedBy: playerId
      });
      
      // Clean up
      await db.ref(`matchProposals/${playerId}`).remove();
      
      // Return player to queue
      const playerData = await db.ref(`players/${playerId}`).once('value');
      if (playerData.exists()) {
        await db.ref(`matchmaking/${playerId}`).set({
          ...playerData.val(),
          status: 'waiting',
          timestamp: firebaseAdmin.database.ServerValue.TIMESTAMP
        });
      }
      
      res.json({ status: 'rejected' });
    }
  } catch (error) {
    console.error('Match confirmation error:', error);
    res.status(500).json({ error: 'Failed to confirm match' });
  }
});

// Game session endpoints
app.post('/api/game/state', async (req, res) => {
  const { matchId, playerId } = req.body;
  
  if (!serverState.gameSessions[matchId] || 
      !serverState.gameSessions[matchId].players.includes(playerId)) {
    return res.status(404).json({ error: 'Game session not found' });
  }
  
  // Update player activity
  if (serverState.gameSessions[playerId]) {
    serverState.gameSessions[playerId].lastActivity = Date.now();
  }
  
  res.json({
    gameState: serverState.gameSessions[matchId].gameState,
    players: serverState.gameSessions[matchId].players,
    serverTime: Date.now()
  });
});

app.post('/api/game/action', async (req, res) => {
  const { matchId, playerId, action } = req.body;
  
  if (!serverState.gameSessions[matchId] || 
      !serverState.gameSessions[matchId].players.includes(playerId)) {
    return res.status(404).json({ error: 'Game session not found' });
  }
  
  try {
    // Process game action
    const result = processGameAction(
      serverState.gameSessions[matchId].gameState,
      playerId,
      action
    );
    
    // Update game state
    serverState.gameSessions[matchId].gameState = result.newState;
    serverState.gameSessions[matchId].lastUpdate = Date.now();
    
    res.json({
      status: 'processed',
      gameState: result.newState,
      events: result.events,
      serverTime: Date.now()
    });
  } catch (error) {
    console.error('Game action error:', error);
    res.status(500).json({ error: 'Failed to process game action' });
  }
});

// Helper functions
function initializeGameState(players) {
  // Basic MOBE game state
  return {
    players: players.reduce((acc, id) => {
      acc[id] = {
        position: { x: Math.random() * 800, y: Math.random() * 600 },
        health: 100,
        score: 0,
        lastAction: Date.now()
      };
      return acc;
    }, {}),
    objects: {},
    terrain: generateTerrain(),
    startTime: Date.now(),
    lastUpdate: Date.now()
  };
}

function processGameAction(state, playerId, action) {
  const player = state.players[playerId];
  if (!player) return { newState: state, events: [] };

  const events = [];
  const newState = JSON.parse(JSON.stringify(state));

  // Process different action types
  switch (action.type) {
    case 'move':
      newState.players[playerId].position = action.position;
      events.push({ type: 'playerMoved', playerId, position: action.position });
      break;
      
    case 'shoot':
      events.push({ 
        type: 'projectileFired', 
        playerId,
        from: player.position,
        direction: action.direction,
        timestamp: Date.now()
      });
      break;
      
    case 'ability':
      // Handle special abilities
      break;
      
    default:
      console.warn('Unknown action type:', action.type);
  }

  newState.players[playerId].lastAction = Date.now();
  newState.lastUpdate = Date.now();

  return { newState, events };
}

function generateTerrain() {
  // Simple terrain generation
  return {
    size: { width: 1600, height: 1200 },
    obstacles: Array.from({ length: 20 }, () => ({
      x: Math.random() * 1600,
      y: Math.random() * 1200,
      width: 50 + Math.random() * 100,
      height: 50 + Math.random() * 100
    }))
  };
}

function cleanupPlayer(playerId) {
  serverState.playersConnected--;
  serverState.serverLoad = Math.max(0, serverState.serverLoad - 5);
  
  // Remove from any game sessions
  for (const matchId in serverState.gameSessions) {
    const session = serverState.gameSessions[matchId];
    const index = session.players.indexOf(playerId);
    if (index !== -1) {
      session.players.splice(index, 1);
      
      // End game session if no players left
      if (session.players.length === 0) {
        delete serverState.gameSessions[matchId];
      }
    }
  }
  
  delete serverState.gameSessions[playerId];
}

// Background tasks
setInterval(() => {
  const now = Date.now();
  
  // Cleanup inactive players
  Object.keys(serverState.gameSessions).forEach(playerId => {
    if (now - serverState.gameSessions[playerId].lastActivity > PLAYER_TIMEOUT) {
      cleanupPlayer(playerId);
    }
  });
  
  // Cleanup old game sessions
  Object.keys(serverState.gameSessions).forEach(matchId => {
    if (now - serverState.gameSessions[matchId].lastUpdate > MATCH_EXPIRATION) {
      delete serverState.gameSessions[matchId];
    }
  });
  
  // Update server load
  serverState.serverLoad = Math.min(100, serverState.playersConnected * 2);
}, 60000); // Run every minute

// Matchmaking background process
setInterval(async () => {
  try {
    // Get current queue from Firebase
    const queueSnapshot = await db.ref('matchmaking').once('value');
    const queue = queueSnapshot.val() || {};
    
    // Convert to array and sort by ping
    const players = Object.entries(queue)
      .filter(([_, player]) => player.status === 'waiting')
      .sort((a, b) => a[1].ping - b[1].ping);
    
    // Try to match players
    while (players.length >= 2) {
      const player1 = players.shift();
      const player2 = players.shift();
      
      const matchId = `match-${Date.now()}`;
      
      // Create match
      await db.ref(`matches/${matchId}`).set({
        id: matchId,
        players: {
          [player1[0]]: { status: 'pending', ...player1[1] },
          [player2[0]]: { status: 'pending', ...player2[1] }
        },
        status: 'pending',
        createdAt: firebaseAdmin.database.ServerValue.TIMESTAMP
      });
      
      // Notify players
      await db.ref(`matchProposals/${player1[0]}`).set({
        matchId,
        opponentId: player2[0],
        opponentPing: player2[1].ping,
        opponentScore: player2[1].score || 0,
        status: 'proposed'
      });
      
      await db.ref(`matchProposals/${player2[0]}`).set({
        matchId,
        opponentId: player1[0],
        opponentPing: player1[1].ping,
        opponentScore: player1[1].score || 0,
        status: 'proposed'
      });
      
      // Remove from queue
      await db.ref(`matchmaking/${player1[0]}`).remove();
      await db.ref(`matchmaking/${player2[0]}`).remove();
      
      // Set match expiration
      setTimeout(async () => {
        const matchSnapshot = await db.ref(`matches/${matchId}`).once('value');
        if (matchSnapshot.exists() && matchSnapshot.val().status === 'pending') {
          await db.ref(`matches/${matchId}`).update({
            status: 'cancelled',
            reason: 'confirmation_timeout'
          });
          
          // Return players to queue if they're still around
          const match = matchSnapshot.val();
          for (const playerId in match.players) {
            const playerRef = await db.ref(`players/${playerId}`).once('value');
            if (playerRef.exists()) {
              await db.ref(`matchmaking/${playerId}`).set({
                ...playerRef.val(),
                status: 'waiting',
                timestamp: firebaseAdmin.database.ServerValue.TIMESTAMP
              });
            }
          }
        }
      }, MATCH_CONFIRMATION_TIMEOUT);
    }
    
    // Cleanup old queue entries
    const now = Date.now();
    for (const [playerId, player] of Object.entries(queue)) {
      if (now - player.timestamp > PLAYER_TIMEOUT) {
        await db.ref(`matchmaking/${playerId}`).remove();
      }
    }
  } catch (error) {
    console.error('Matchmaking background error:', error);
  }
}, 10000); // Run every 10 seconds

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MOBE Game Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
