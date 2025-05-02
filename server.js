require('dotenv').config();
const express = require('express');
const cors = require('cors');
const firebaseAdmin = require('firebase-admin');

// Initialize Express
const app = express();

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

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:7700',
    'https://game-server-five.vercel.app',
    'https://www.mobe-game.rf.gd'
  ],
  methods: ['GET', 'POST', 'OPTIONS']
}));

app.use(express.json());

// Health Check
app.get('/', (req, res) => {
  res.send('MOBE Server is Running');
});

// Matchmaking Endpoint (Example)
app.post('/api/matchmaking', async (req, res) => {
  try {
    const { playerId } = req.body;
    await db.ref(`players/${playerId}`).set({
      connectedAt: Date.now()
    });
    res.json({ status: 'searching' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
