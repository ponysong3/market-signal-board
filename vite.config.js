import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'local-market-api',
    configureServer(server) {
      server.middlewares.use('/api/market', async (req, res) => {
        try {
          const { default: handler } = await import('./api/market.js');
          res.status = code => { res.statusCode = code; return res; };
          res.json = value => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
          await handler(req, res);
        } catch (e) {
          server.config.logger.error(e.message);
          res.statusCode = 503;
          res.end(JSON.stringify({ error: 'Local market API unavailable' }));
        }
      });
    }
  }]
});
