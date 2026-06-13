/**
 * Landing Page Interactive Elements
 */

document.addEventListener('DOMContentLoaded', () => {
  initScrollAnimations();
  initParallax();
  initCounters();
  initSmoothScroll();
});

/**
 * Initialize scroll-triggered animations
 */
function initScrollAnimations() {
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -100px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, observerOptions);

  // Observe all feature cards and step cards
  document.querySelectorAll('.feature-card, .step-card, .stat-card').forEach(card => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(30px)';
    card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(card);
  });
}

/**
 * Initialize parallax effects for floating cards
 */
function initParallax() {
  const floatingCards = document.querySelectorAll('.floating-card');

  if (floatingCards.length === 0) return;

  document.addEventListener('mousemove', (e) => {
    const mouseX = e.clientX / window.innerWidth;
    const mouseY = e.clientY / window.innerHeight;

    floatingCards.forEach((card, index) => {
      const speed = (index + 1) * 20;
      const x = (mouseX - 0.5) * speed;
      const y = (mouseY - 0.5) * speed;

      card.style.transform = `translate(${x}px, ${y}px)`;
    });
  });
}

/**
 * Animated counters for stats
 */
function initCounters() {
  const statValues = document.querySelectorAll('.stat-value[data-count]');

  const observerOptions = {
    threshold: 0.5
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !entry.target.classList.contains('counted')) {
        animateCounter(entry.target);
        entry.target.classList.add('counted');
      }
    });
  }, observerOptions);

  statValues.forEach(stat => observer.observe(stat));
}

function animateCounter(element) {
  const target = element.dataset.count;

  if (target === 'unlimited') {
    return; // Already shows ∞
  }

  const targetNum = parseInt(target);
  const duration = 2000;
  const steps = 60;
  const increment = targetNum / steps;
  let current = 0;

  const timer = setInterval(() => {
    current += increment;
    if (current >= targetNum) {
      element.textContent = targetNum;
      clearInterval(timer);
    } else {
      element.textContent = Math.floor(current);
    }
  }, duration / steps);
}

/**
 * Smooth scroll for anchor links
 */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');

      if (href === '#') return;

      e.preventDefault();

      const targetId = href.substring(1);
      const target = document.getElementById(targetId);

      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });
}

/**
 * Add glowing cursor effect on hero section
 */
const heroSection = document.querySelector('.hero-section');
if (heroSection) {
  const cursor = document.createElement('div');
  cursor.className = 'custom-cursor';
  cursor.style.cssText = `
    position: fixed;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(102, 126, 234, 0.8) 0%, rgba(102, 126, 234, 0) 70%);
    pointer-events: none;
    z-index: 9999;
    transition: transform 0.1s ease;
  `;
  document.body.appendChild(cursor);

  heroSection.addEventListener('mousemove', (e) => {
    cursor.style.left = e.clientX - 10 + 'px';
    cursor.style.top = e.clientY - 10 + 'px';
  });

  heroSection.addEventListener('mouseenter', () => {
    cursor.style.opacity = '1';
  });

  heroSection.addEventListener('mouseleave', () => {
    cursor.style.opacity = '0';
  });
}
