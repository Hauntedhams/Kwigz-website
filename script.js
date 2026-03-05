// === Navbar scroll effect (only on home page) ===
const navbar = document.getElementById('navbar');
if (navbar && !navbar.classList.contains('scrolled')) {
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 50);
  });
}

// === Mobile menu toggle ===
const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('navLinks');

if (hamburger && navLinks) {
  hamburger.addEventListener('click', () => {
    navLinks.classList.toggle('open');
  });

  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('open');
    });
  });
}

// === Scroll-based fade-in animations ===
const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -30px 0px'
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, observerOptions);

document.querySelectorAll(
  '.value-card, .section-header, .showcase-grid, .profit-card, .agreement-card, .credential-card, .liability-block, .contact-form, .sidebar-card, .download-content'
).forEach(el => {
  el.classList.add('fade-in');
  observer.observe(el);
});

// Stagger grid children
document.querySelectorAll('.value-grid, .credentials-grid, .agreement-grid').forEach(grid => {
  Array.from(grid.children).forEach((child, i) => {
    child.style.transitionDelay = `${i * 0.08}s`;
  });
});

// === Contact form handling ===
const contactForm = document.getElementById('contactForm');
const formSuccess = document.getElementById('formSuccess');

if (contactForm && formSuccess) {
  contactForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const formData = new FormData(contactForm);
    const data = Object.fromEntries(formData.entries());
    console.log('Form submitted:', data);

    contactForm.style.display = 'none';
    const sidebar = document.querySelector('.contact-sidebar');
    if (sidebar) sidebar.style.display = 'none';

    formSuccess.classList.add('show');
    formSuccess.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}