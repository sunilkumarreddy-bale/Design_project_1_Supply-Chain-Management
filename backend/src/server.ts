import http from 'http';
import { env } from './config/env';
import { connectDB, disconnectDB } from './config/db';
import { createApp } from './app';
import { closeSockets, initSockets } from './sockets';
import { checkOverduePOs, sweepExpiry } from './services/alerts';
import { auditIdle } from './middleware/audit';
import { flushNotifications } from './services/notifications';
import { runExpiryJob } from './services/stockService';

async function main() {
  await connectDB();
  const app = createApp();
  const server = http.createServer(app);
  initSockets(server);

  let timer: NodeJS.Timeout | null = null;
  if (env.schedulerIntervalMinutes > 0) {
    const tick = async () => {
      try {
        await sweepExpiry();
        await checkOverduePOs();
        await runExpiryJob();
      } catch (e) {
        console.error('scheduled checks failed', e);
      }
    };
    timer = setInterval(tick, env.schedulerIntervalMinutes * 60 * 1000);
    setTimeout(tick, 5000);
  }

  server.listen(env.port, () => {
    console.log(`API listening on http://localhost:${env.port} (client origin ${env.clientOrigin})`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down`);
    if (timer) clearInterval(timer);
    closeSockets();
    server.close();
    await auditIdle();
    await flushNotifications();
    await disconnectDB();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error('Failed to start', e);
  process.exit(1);
});
