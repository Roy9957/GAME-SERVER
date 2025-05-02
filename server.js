// Importing dependencies
const express = require('express');
const axios = require('axios');
const cors = require('cors');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for specific domains
const allowedOrigins = [
  'http://localhost:7700',
  'https://www.mobe-game.rf.gd'
];

app.use(cors({
  origin: function(origin, callback) {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true); // Allow the origin
    } else {
      callback(new Error('Not allowed by CORS')); // Reject the origin
    }
  }
}));

// Route to load game data (fetching game server data here)
app.get('/load-game', async (req, res) => {
  try {
    // Since the game server is now this server, you can handle the game's response here
    // Example: Send some mock data or a status
    res.json({
      status: 'Game data successfully loaded!',
      gameInfo: 'Sample game information'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process game data' });
  }
});

// Starting the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;  // Exporting the app for Vercel
