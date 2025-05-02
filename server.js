require('dotenv').config();
const express = require('express');
const cors = require('cors');
const firebaseAdmin = require('firebase-admin');
const rateLimit = require('express-rate-limit');

// Initialize Express
const app = express();

// Initialize Firebase
firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = firebaseAdmin.database();

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://game-server-five.vercel.app',
    'https://www.mobe-game.rf.gd'
  ],
  methods: ['GET', 'POST', 'OPTIONS']
}));

app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Matchmaking endpoints
app.post('/api/matchmaking/join', async (req, res) => {
  try {
    const { playerId, playerData } = req.body;
    
    if (!playerId) {
      return res.status(400).json({ error: 'Player ID is required' });
    }

    // Check if player is already in queue
    const existingPlayer = await db.ref(`matchmaking/${playerId}`).once('value');
    if (existingPlayer.exists()) {
      return res.status(400).json({ error: 'Already in matchmaking queue' });
    }

    // Add player to matchmaking queue
    await db.ref(`matchmaking/${playerId}`).set({
      ...playerData,
      status: 'waiting',
      timestamp: firebaseAdmin.database.ServerValue.TIMESTAMP
    });

    // Check for available opponents
    const availablePlayers = await findAvailablePlayers(playerId);
    
    if (availablePlayers.length > 0) {
      // Match found with first available player
      const opponent = availablePlayers[0];
      const matchId = `match-${Date.now()}`;
      
      await createMatch(matchId, playerId, opponent.key);
      
      return res.json({ 
        status: 'match_found',
        matchId,
        opponent: opponent.val()
      });
    }

    // No current matches available
    return res.json({ 
      status: 'waiting',
      message: 'Searching for opponents...'
    });

  } catch (error) {
    console.error('Matchmaking error:', error);
    res.status(500).json({ error: 'Failed to join matchmaking' });
  }
});

// Helper function to find available players
async function findAvailablePlayers(currentPlayerId) {
  const snapshot = await db.ref('matchmaking').once('value');
  const players = [];
  
  snapshot.forEach((childSnapshot) => {
    if (childSnapshot.key !== currentPlayerId && childSnapshot.val().status === 'waiting') {
      players.push({
        key: childSnapshot.key,
        val: childSnapshot.val()
      });
    }
  });
  
  return players;
}

// Helper function to create a match
async function createMatch(matchId, player1Id, player2Id) {
  // Get player data
  const player1Data = (await db.ref(`matchmaking/${player1Id}`).once('value')).val();
  const player2Data = (await db.ref(`matchmaking/${player2Id}`).once('value')).val();
  
  // Create match record
  await db.ref(`matches/${matchId}`).set({
    players: {
      [player1Id]: { ...player1Data, status: 'matched' },
      [player2Id]: { ...player2Data, status: 'matched' }
    },
    status: 'active',
    createdAt: firebaseAdmin.database.ServerValue.TIMESTAMP
  });
  
  // Remove players from matchmaking queue
  await db.ref(`matchmaking/${player1Id}`).remove();
  await db.ref(`matchmaking/${player2Id}`).remove();
  
  // Notify players
  await db.ref(`playerMatches/${player1Id}`).set({ matchId });
  await db.ref(`playerMatches/${player2Id}`).set({ matchId });
}

// Check match status
app.post('/api/matchmaking/status', async (req, res) => {
  try {
    const { playerId } = req.body;
    
    if (!playerId) {
      return res.status(400).json({ error: 'Player ID is required' });
    }

    // Check if player has a match
    const matchSnapshot = await db.ref(`playerMatches/${playerId}`).once('value');
    if (matchSnapshot.exists()) {
      const matchId = matchSnapshot.val().matchId;
      const matchData = (await db.ref(`matches/${matchId}`).once('value')).val();
      
      return res.json({
        status: 'matched',
        matchId,
        opponent: Object.entries(matchData.players)
          .find(([id]) => id !== playerId)[1]
      });
    }

    // Still waiting
    return res.json({ 
      status: 'waiting',
      message: 'Still searching for opponents...'
    });

  } catch (error) {
    console.error('Match status error:', error);
    res.status(500).json({ error: 'Failed to check match status' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    uptime: process.uptime()
  });
});

// Cleanup old matches (runs every 5 minutes)
setInterval(async () => {
  try {
    const now = Date.now();
    const cutoff = now - 3600000; // 1 hour
    
    const matchesSnapshot = await db.ref('matches').once('value');
    matchesSnapshot.forEach(async (childSnapshot) => {
      if (childSnapshot.val().createdAt < cutoff) {
        await db.ref(`matches/${childSnapshot.key}`).remove();
      }
    });
    
    const matchmakingSnapshot = await db.ref('matchmaking').once('value');
    matchmakingSnapshot.forEach(async (childSnapshot) => {
      if (childSnapshot.val().timestamp < cutoff) {
        await db.ref(`matchmaking/${childSnapshot.key}`).remove();
      }
    });
    
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}, 300000); // 5 minutes

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MOBE Matchmaking Server running on port ${PORT}`);
});

module.exports = app;
