const path = require('path');
// Force dotenv to look in the parent directory of 'src'
require('dotenv').config({ path: path.join(__dirname, '../.env') }); 

// Logging every request (hundreds per photo grid) slows things down; set LOG_LEVEL=info to see them
const fastify = require('fastify')({ logger: { level: process.env.LOG_LEVEL || 'warn' } });

// Plugins
fastify.register(require('@fastify/cors'));

// Serve the static frontend SPA
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, '../frontend'),
  prefix: '/',
});

// Register API Routes
fastify.register(require('./modules/auth'));
fastify.register(require('./modules/admin'));
fastify.register(require('./modules/files'));
fastify.register(require('./modules/albums'));
fastify.register(require('./modules/chat'));
fastify.register(require('./modules/music'));
fastify.register(require('./modules/library'));
// Start Server
const start = async () => {
  try {
    const port = process.env.PORT || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`AkulavBox is active on http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();