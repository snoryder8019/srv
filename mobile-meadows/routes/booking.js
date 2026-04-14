const router = require('express').Router();
const Booking = require('../models/Booking');
const CalendarSlot = require('../models/CalendarSlot');
const { sendBookingConfirmation } = require('../utils/mailer');

// @route  GET /booking/:slotId
// Show booking form for a specific calendar slot
router.get('/:slotId', async (req, res) => {
  try {
    const slot = await CalendarSlot.findById(req.params.slotId);
    if (!slot || !slot.isAvailable) {
      return res.redirect('/calendar');
    }
    res.render('pages/booking/form', {
      title: 'Book Appointment — Mobile Meadows',
      slot
    });
  } catch (err) {
    console.error(err);
    res.redirect('/calendar');
  }
});

// @route  POST /booking/:slotId
// Submit a booking request
router.post('/:slotId', async (req, res) => {
  try {
    const slot = await CalendarSlot.findById(req.params.slotId);
    if (!slot || !slot.isAvailable) {
      return res.redirect('/calendar');
    }

    const bookingData = {
      serviceType: slot.serviceType,
      slot: slot._id,
      requestedDate: slot.date,
      guestName: req.body.guestName,
      guestEmail: req.body.guestEmail,
      guestPhone: req.body.guestPhone,
      vehicleYear: req.body.vehicleYear,
      vehicleMake: req.body.vehicleMake,
      vehicleModel: req.body.vehicleModel,
      vehicleLength: req.body.vehicleLength,
      issueDescription: req.body.issueDescription
    };

    // Attach user if logged in
    if (req.user) {
      bookingData.user = req.user._id;
      bookingData.guestName = bookingData.guestName || req.user.displayName;
      bookingData.guestEmail = bookingData.guestEmail || req.user.email;
    }

    const booking = await Booking.create(bookingData);

    // Increment slot bookings
    slot.currentBookings += 1;
    if (slot.currentBookings >= slot.maxBookings) {
      slot.isAvailable = false;
    }
    await slot.save();

    // Notify admin via socket
    const io = req.app.get('io');
    io.emit('new-booking', { bookingId: booking._id, service: slot.serviceType });

    res.render('pages/booking/confirmation', {
      title: 'Booking Submitted — Mobile Meadows',
      booking,
      slot
    });
  } catch (err) {
    console.error(err);
    res.redirect('/calendar');
  }
});

module.exports = router;
