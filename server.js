require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { initializeDBConnection } = require("./config/db");
const { getAllClients } = require("./services/clientManager");
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
app.use("/clients", clientRoutes);

// ✅ Initialize services AFTER server config
(async () => {
  try {
    await initializeDBConnection();
    console.log("DB initialized");
    
    // Optionally auto-initialize clients from database
    // Clients are initialized on-demand when accessed via API
    // Uncomment the following code if you want to auto-initialize all clients on startup
    /*
    try {
      const clients = await getAllClients();
      console.log(`Found ${clients.length} registered clients in database`);
      // Clients will be initialized when first accessed via API
    } catch (error) {
      console.warn('Warning: Could not fetch clients from database:', error.message);
    }
    */
    
    console.log('Client manager ready. Clients will be initialized on-demand.');
  } catch (error) {
    console.error('Error initializing services:', error);
    process.exit(1);
  }
})();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
