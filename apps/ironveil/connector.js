'use strict';
// Ironveil's tool for the AI connector (src/core/connector/tools.js): the player's progress, read
// through the app's own API. Saves themselves stay with the game.
const tools = [
  {
    name: 'ironveil_progress', write: false, title: 'Ironveil progress',
    description: 'The player’s progress in Ironveil, the automation and tower-defense game: runs played, best wave survived, kills, hours played, Legacy shards, unlocked achievements, and whether a run is saved to continue.',
    input: {},
    run: async (ctx) => ctx.call('ironveil', 'GET', '/ironveil/api/profile'),
  },
];

module.exports = { tools };
