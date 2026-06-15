require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { initializeClient, destroyClient, getConnectionStatus } = require("./services/whatsApp");
const { initializeDBConnection } = require("./config/db");
const authMiddleware = require("./middlewares/auth");
const messageRoutes = require("./routes/messageRoutes");
const exposedMessagesRoute = require("./routes/exposedMessagesRoute");
const chatRoutes = require("./routes/chatRoutes");
const labelRoutes = require("./routes/labelRoutes");
const authRoutes = require("./routes/authRoutes");

const app = express();
app.use('/uploads', express.static(require('path').join(__dirname, 'uploads')));

app.use(
  cors({
    origin: "*",
    methods: ["POST", "GET", "PUT"],
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
