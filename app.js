require('dotenv').config();
const debug = require('debug')('SubtitleGenerator:app');
const SubtitleApp = require('./lib/SubtitleApp');
const appRootPath = require('app-root-path').toString();

process.env.APP_ROOT_PATH = appRootPath;

async function main() {
  try {
    debug('Starting SyncScribe web application');

    const app = new SubtitleApp({
      appRootPath,
      config: {
        port: parseInt(process.env.PORT || '3000', 10),
      }
    });

    await app.init();

    console.log('SyncScribe web application started successfully');

    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);
      await app.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (error) {
    console.error('Failed to start SyncScribe:', error.message);
    debug('Full error:', error);
    process.exit(1);
  }
}

main();

process.on('uncaughtException', (exception) => {
  debug('Uncaught exception:', exception);
  console.error('Fatal error:', exception.message);
  process.exit(1);
});

process.on('unhandledRejection', (exception) => {
  debug('Unhandled rejection:', exception);
  console.error('Fatal error:', exception.message);
  process.exit(1);
});
