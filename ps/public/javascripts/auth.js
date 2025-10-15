// Login form handler
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const response = await fetch('/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (response.ok) {
      alert('Login successful!');
      window.location.href = '/';
    } else {
      alert(data.error || 'Login failed');
    }
  } catch (err) {
    console.error('Login error:', err);
    alert('Login failed. Please try again.');
  }
});

// Register form handler
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('registerUsername').value;
  const email = document.getElementById('registerEmail').value;
  const password = document.getElementById('registerPassword').value;

  try {
    const response = await fetch('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, email, password })
    });

    const data = await response.json();

    if (response.ok) {
      alert('Registration successful! Please login.');
      document.getElementById('registerForm').reset();
    } else {
      alert(data.error || 'Registration failed');
    }
  } catch (err) {
    console.error('Registration error:', err);
    alert('Registration failed. Please try again.');
  }
});
