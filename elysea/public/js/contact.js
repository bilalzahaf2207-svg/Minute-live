const form = document.querySelector('[data-contact-form]');
const status = form.querySelector('[data-form-status]');
const E = window.ELYSEA;
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  status.className = 'form-status';
  form.querySelectorAll('.has-error').forEach((x) => x.classList.remove('has-error'));
  const f = form.elements;
  const bad = [];
  if (!f.name.value.trim()) bad.push(f.name);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.value.trim())) bad.push(f.email);
  if (f.message.value.trim().length < 5) bad.push(f.message);
  if (!f.consent.checked) bad.push(f.consent);
  if (bad.length) { bad.forEach((x) => (x.closest('.field') || x.closest('.check')).classList.add('has-error')); bad[0].focus(); status.textContent = E.i18n['contact.form.error']; status.classList.add('err'); return; }
  const btn = form.querySelector('button[type=submit]');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = E.i18n['contact.form.sending'];
  try {
    const r = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: E.lang, name: f.name.value, email: f.email.value, subject: f.subject.options[f.subject.selectedIndex].text, order: f.order.value, message: f.message.value, website: f.website.value, consent: f.consent.checked }) });
    if (!r.ok) throw new Error();
    form.reset();
    status.textContent = E.i18n['contact.form.success']; status.classList.add('ok');
  } catch (_) {
    status.textContent = E.i18n['contact.form.error']; status.classList.add('err');
  } finally { btn.disabled = false; btn.textContent = label; }
});
