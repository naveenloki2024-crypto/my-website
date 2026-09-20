/* ============================================
   RARE HABIT. Order Confirmation Verification
   Shows success only after Stripe confirms the payment.
   ============================================ */

(function () {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');

    const iconEl = document.getElementById('success-icon');
    const cardEl = document.querySelector('.success-card');
    const titleEl = cardEl ? cardEl.querySelector('h2, .section-title') : null;
    const msgEl = cardEl ? cardEl.querySelector('.success-message') : null;
    const visitEl = cardEl ? cardEl.querySelector('.see-all-btn') : null;

    const CONFIRMED_TITLE = 'ORDER CONFIRMED';
    const CONFIRMED_MSG = 'Thank you for your purchase! Your order has been placed successfully. A confirmation email is on its way.';

    function setPending() {
        if (iconEl) iconEl.innerHTML = '<i class="ri-loader-4-line"></i>';
        if (titleEl) titleEl.textContent = 'VERIFYING PAYMENT';
        if (msgEl) msgEl.textContent = 'We are confirming your payment with Stripe. Please wait...';
    }

    function setSuccess(data) {
        if (iconEl) iconEl.innerHTML = '<i class="ri-check-double-line"></i>';
        if (titleEl) titleEl.textContent = CONFIRMED_TITLE;
        if (msgEl) msgEl.textContent = CONFIRMED_MSG;

        if (data && data.customer_email) {
            localStorage.setItem('sandro-email', data.customer_email);
        }
    }

    function setNotConfirmed(message) {
        if (iconEl) iconEl.innerHTML = '<i class="ri-close-circle-line"></i>';
        if (titleEl) titleEl.textContent = 'PAYMENT NOT CONFIRMED';
        if (msgEl) msgEl.textContent = message || 'We could not confirm your payment with Stripe. Check your Stripe test dashboard, then try again.';
        if (visitEl) visitEl.innerHTML = 'BACK TO SHOP';
    }

    async function verify() {
        if (!sessionId) {
            setNotConfirmed('No payment session was found. This can happen if the success page was opened directly.');
            return;
        }

        setPending();

        try {
            const response = await fetch(`/api/verify-payment?session_id=${encodeURIComponent(sessionId)}`);
            const data = await response.json();

            if (response.ok && data.success) {
                setSuccess(data);
            } else {
                setNotConfirmed(data.message || 'Payment not confirmed by Stripe.');
            }
        } catch (error) {
            setNotConfirmed('Could not reach the server to confirm your payment. Make sure the backend is running.');
        }
    }

    verify();
})();