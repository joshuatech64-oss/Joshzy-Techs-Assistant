require('dotenv').config();
const Database = require('./db');
const CommandRouter = require('./router');
const WhatsAppClient = require('./client');
const DashboardServer = require('./dashboard');

async function main() {
    console.log("Initializing database...");
    const db = new Database();

    console.log("Initializing WhatsApp client...");
    const router = new CommandRouter(db, null);
    const wa_client = new WhatsAppClient(db, router);
    router.wa_client = wa_client; // Circular dependency injection

    console.log("Starting Dashboard server...");
    const dashboard = new DashboardServer(wa_client);
    dashboard.start();

    console.log("Connecting to WhatsApp Web...");
    await wa_client.start();
}

main().catch(console.error);
