// Importing dependencies
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');

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
    // Simulate some game data or fetch actual data if needed
    // If you want to connect to another service, you can use axios here

    // For now, sending mock data
    res.json({
      status: 'Game data successfully loaded!',
      gameInfo: 'Sample game information'
    });
  } catch (error) {
    console.error('Error fetching game data:', error);  // Log error
    res.status(500).json({ error: 'Failed to process game data' });
  }
});

// Global Error Handling - Catch all uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  fs.appendFileSync('error.log', `${new Date()} - Uncaught Exception: ${err}\n`);
  process.exit(1); // Exit the process after logging
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  fs.appendFileSync('error.log', `${new Date()} - Unhandled Promise Rejection: ${err}\n`);
  process.exit(1); // Exit the process after logging
});

// Starting the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;  // Exporting the app for Vercel
