const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, unique: true },
    phoneNumber: { type: String, sparse: true, unique: true },
    name: { type: String },
    status: {
      type: String,
      enum: ['active', 'inactive', 'initializing'],
      default: 'initializing',
    },
    needsName: { type: Boolean, default: false },
    pairingError: { type: String, default: null },
    lastConnected: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Client', clientSchema);
