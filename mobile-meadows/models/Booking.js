const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Guest info (if not logged in)
  guestName: String,
  guestEmail: String,
  guestPhone: String,
  serviceType: {
    type: String,
    enum: ['mobile-repair', 'roof-repair'],
    required: true
  },
  // Vehicle info
  vehicleYear: String,
  vehicleMake: String,
  vehicleModel: String,
  vehicleLength: String,
  issueDescription: String,
  // Scheduling
  slot: { type: mongoose.Schema.Types.ObjectId, ref: 'CalendarSlot' },
  requestedDate: Date,
  // Status flow: pending → confirmed → completed | cancelled
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'completed', 'cancelled'],
    default: 'pending'
  },
  adminNotes: String,
  confirmedAt: Date,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Booking', bookingSchema, 'mm.bookings');
