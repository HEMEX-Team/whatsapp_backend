const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  phoneNumber: {
    type: String,
    sparse: true,
    unique: true,
    trim: true
  },
  name: {
    type: String,
    trim: true
  },
  needsName: {
    type: Boolean,
    default: false
  },
  pairingError: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'initializing'],
    default: 'initializing'
  },
  qrCode: {
    type: String
  },
  lastConnected: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

clientSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const Client = mongoose.model('Client', clientSchema);

module.exports = Client;
