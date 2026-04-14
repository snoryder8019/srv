// Admin real-time notifications via Socket.IO
const socket = io();

socket.on('new-booking', (data) => {
  const note = document.createElement('div');
  note.className = 'toast';
  note.innerHTML = `New booking request! <a href="/admin/bookings">View</a>`;
  document.body.appendChild(note);
  setTimeout(() => note.remove(), 5000);
});

socket.on('booking-confirmed', (data) => {
  console.log('Booking confirmed:', data.bookingId);
});

// Toast styles injected
const style = document.createElement('style');
style.textContent = `
  .toast {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    background: var(--primary);
    color: #fff;
    padding: 1rem 1.5rem;
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    z-index: 9999;
    animation: slideIn 0.3s ease;
  }
  .toast a { color: #fff; text-decoration: underline; margin-left: 0.5rem; }
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
`;
document.head.appendChild(style);
