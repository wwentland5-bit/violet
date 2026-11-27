// Show a hint when you click the page while Violet is driving.
let t;
document.addEventListener('mousedown', () => {
  const h = document.getElementById('hint');
  h.classList.add('show');
  clearTimeout(t);
  t = setTimeout(() => h.classList.remove('show'), 2200);
});
document.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
