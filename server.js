require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const {
  initializeAllClients,
  destroyAllClients,
  getConnectionStatus,
} = require("./services/clientManager");
const { initializeDeviceSocket } = require("./services/deviceSocket");
const { initializeDBConnection } = require("./config/db");
const authMiddleware = require("./middlewares/auth");
const clientSelector = require("./middlewares/clientSelector");
const messageRoutes = require("./routes/messageRoutes");
const exposedMessagesRoute = require("./routes/exposedMessagesRoute");
const chatRoutes = require("./routes/chatRoutes");
const labelRoutes = require("./routes/labelRoutes");
const authRoutes = require("./routes/authRoutes");
const clientRoutes = require("./routes/clientRoutes");

const app = express();
app.use('/uploads', express.static(require('path').join(__dirname, 'uploads')));

app.use(
  cors({
    origin: "*",
    methods: ["POST", "GET", "PUT", "PATCH", "DELETE"],
    credentials: true,
  })
);

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ limit: "15mb", extended: true }));

app.use("/auth", authRoutes);

app.get("/whatsapp/status", async (req, res) => {
  try {
    const status = await getConnectionStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ connected: false, error: error.message });
  }
});

app.use("/exposed", clientSelector, exposedMessagesRoute);

app.use(authMiddleware);

app.use("/clients", clientRoutes);
app.use("/messages", clientSelector, messageRoutes);
app.use("/chats", clientSelector, chatRoutes);
app.use("/labels", clientSelector, labelRoutes);

const server = http.createServer(app);
initializeDeviceSocket(server);

(async () => {
  try {
    await initializeDBConnection();
    console.log("DB initialized");

    console.log('Initializing WhatsApp clients...');
    await initializeAllClients();
    console.log('WhatsApp clients initialized');
  } catch (error) {
    console.error('Error initializing services:', error);
    process.exit(1);
  }
})();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close();
  await destroyAllClients();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
