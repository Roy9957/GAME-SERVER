// Importing dependencies
const express = require('express');
const axios = require('axios');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Game server URL
const gameServerURL = 'http://localhost:7700';  // Replace this with your actual game server URL

// Route to load game data
app.get('/load-game', async (req, res) => {
  try {
    // Fetch data from game server
    const response = await axios.get(gameServerURL);
    res.json(response.data);  // Send the data from the game server to the client
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch data from the game server' });
  }
});

// Starting the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;  // Exporting the app for Vercel
