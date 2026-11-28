// Rafraîchit la page tant que le paiement n'est pas confirmé (webhook Stripe asynchrone).
const el = document.querySelector('[data-confirm-status]');
if (el && el.dataset.paid !== 'true') {
  let n = 0;
  const poll = async () => {
    n++;
    try {
      const r = await fetch(`/api/order?id=${encodeURIComponent(el.dataset.order)}&t=${encodeURIComponent(el.dataset.token)}`);
      const o = await r.json();
      if (o.paid || o.status === 'payment_failed') { location.reload(); return; }
    } catch (_) {}
    if (n < 20) setTimeout(poll, 3000);
  };
  setTimeout(poll, 2000);
}
