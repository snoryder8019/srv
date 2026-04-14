const mongoose = require('mongoose');

const calendarSlotSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  startTime: { type: String, required: true }, // "09:00"
  endTime: { type: String, required: true },   // "10:00"
  serviceType: {
    type: String,
    enum: ['mobile-repair', 'roof-repair'],
    required: true
  },
  // For mobile-repair: live location info
  location: {
    label: String,       // "Branson Landing Area"
    address: String,
    lat: Number,
    lng: Number
  },
  maxBookings: { type: Number, default: 1 },
  currentBookings: { type: Number, default: 0 },
  isAvailable: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('CalendarSlot', calendarSlotSchema, 'mm.calendarSlots');
