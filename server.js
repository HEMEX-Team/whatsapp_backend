require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { initializeClient, destroyClient, getConnectionStatus } = require("./services/whatsApp");
const { initializeDBConnection } = require("./config/db");
const { getAllClients, migrateExistingClients } = require("./services/clientManager");
const authMiddleware = require("./middlewares/auth");
const messageRoutes = require("./routes/messageRoutes");
const exposedMessagesRoute = require("./routes/exposedMessagesRoute");
const chatRoutes = require("./routes/chatRoutes");
const labelRoutes = require("./routes/labelRoutes");
const authRoutes = require("./routes/authRoutes");
const clientRoutes = require("./routes/clientRoutes");

// Handle unhandled promise rejections to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection]', reason);
  // Log the error but don't crash the app
  if (reason && reason.message && reason.message.includes('EBUSY')) {
    console.warn('[Unhandled Rejection] File lock error (can be safely ignored):', reason.message);
  } else {
    console.error('[Unhandled Rejection] Details:', reason);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[Uncaught Exception]', error);
  // Log the error but don't crash the app for file lock errors
  if (error.message && error.message.includes('EBUSY')) {
    console.warn('[Uncaught Exception] File lock error (can be safely ignored):', error.message);
    return; // Don't exit for file lock errors
  }
  // For other errors, log and continue (or exit if critical)
  console.error('[Uncaught Exception] Stack:', error.stack);
});

const app = express();
app.use('/uploads', express.static(require('path').join(__dirname, 'uploads')));

app.use(
  cors({
    origin: "*",
    methods: ["POST", "GET", "PUT", "DELETE", "PATCH"],
    credentials: true,
  })
);

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ limit: "15mb", extended: true }));

app.use("/auth", authRoutes);
app.use("/exposed", exposedMessagesRoute);

app.get("/whatsapp/status", async (req, res) => {
  try {
    const status = await getConnectionStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ connected: false, error: error.message });
  }
});

// app.use(authMiddleware);

app.use("/messages", messageRoutes);
app.use("/chats", chatRoutes);
app.use("/labels", labelRoutes);
app.use("/clients", clientRoutes);

(async () => {
  try {
    await initializeDBConnection();
    console.log("DB initialized");

    console.log('Initializing WhatsApp client...');
    await initializeClient();
    console.log('WhatsApp client initialized');
  } catch (error) {
    console.error('Error initializing services:', error);
    process.exit(1);
  }
})();

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close();
  await destroyClient();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
