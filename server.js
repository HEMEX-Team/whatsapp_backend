require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { client } = require("./services/whatsApp");
const { initializeDBConnection } = require("./config/db");
const authMiddleware = require("./middlewares/auth");
const messageRoutes = require("./routes/messageRoutes");
const exposedMessagesRoute = require("./routes/exposedMessagesRoute");
const chatRoutes = require("./routes/chatRoutes");
const labelRoutes = require("./routes/labelRoutes");
const authRoutes = require("./routes/authRoutes");

const app = express();
app.use('/uploads', express.static(require('path').join(__dirname, 'uploads')));

// ✅ Register CORS middleware FIRST
app.use(
  cors({
    origin: "*",
    methods: ["POST", "GET", "PUT"],
    credentials: true,
  })
);

// ✅ Then use body parsers
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ limit: "15mb", extended: true }));

// ✅ Then register authentication routes
app.use("/auth",authRoutes);

app.use("/exposed", exposedMessagesRoute);

// ✅ Then register authentication middleware
// app.use(authMiddleware);

// ✅ Then register all the routes
app.use("/messages", messageRoutes);
app.use("/chats", chatRoutes);
app.use("/labels", labelRoutes);

// ✅ Initialize services AFTER server config
(async () => {
  try {
    await initializeDBConnection();
    console.log("DB initialized");
    
    if (!client.isInitialized) {
      console.log('Initializing WhatsApp client...');
      await client.initialize();
      console.log('WhatsApp client initialized');
    } else {
      console.log('WhatsApp client is already initialized');
    }
  } catch (error) {
    console.error('Error initializing services:', error);
    process.exit(1);
  }
})();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
