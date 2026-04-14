const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  return transporter;
}

async function sendBookingConfirmation(toEmail, booking) {
  try {
    const t = getTransporter();
    await t.sendMail({
      from: process.env.EMAIL_FROM || '"Mobile Meadows" <noreply@mobilemeadows.com>',
      to: toEmail,
      subject: 'Your Appointment is Confirmed — Mobile Meadows',
      html: `
        <h2>Appointment Confirmed!</h2>
        <p>Hi ${booking.guestName || 'there'},</p>
        <p>Your <strong>${booking.serviceType === 'mobile-repair' ? 'Mobile RV Repair' : 'Roof Repair'}</strong> appointment has been confirmed.</p>
        <p><strong>Date:</strong> ${new Date(booking.requestedDate).toLocaleDateString()}</p>
        ${booking.adminNotes ? `<p><strong>Note from Mobile Meadows:</strong> ${booking.adminNotes}</p>` : ''}
        <p>We may follow up with a phone call to finalize details.</p>
        <br>
        <p>— Mobile Meadows<br>Branson, MO</p>
      `
    });
    console.log(`Confirmation email sent to ${toEmail}`);
  } catch (err) {
    console.error('Email send error:', err.message);
  }
}

module.exports = { sendBookingConfirmation };
