# WhatsApp Bulk Messaging Service

## Features
- Send bulk WhatsApp messages (with optional media)
- All messages stored in MongoDB as chat conversations (import-ready)
- Robust phone number validation (international)

## Project Structure
- `controllers/` - Business logic
- `models/` - Mongoose models
- `routes/` - Express routes
- `utils/` - Utilities (validation, helpers)
- `config/` - DB and env config

## Setup
1. Copy `.env.example` to `.env` and set your MongoDB URI and port.
2. Run `npm install` (requires `libphonenumber-js`)
3. Start the server: `node server.js`

## API
- `POST /send-bulk-messages` - Send messages to multiple numbers

## Message Storage Format
Each chat document in MongoDB:
```
{
  contactNumber: "+1234567890",
  messages: [
    {
      direction: "incoming" | "outgoing",
      body: "Hello!",
      media: null,
      mimeType: null,
      timestamp: "2025-04-24T17:57:47.000Z",
      ack: 2
    },
    ...
  ]
}
```

## Notes
- Phone numbers must be in international format (e.g., `+1234567890`).
- All messages (sent and received) are stored in a chat-friendly structure.
