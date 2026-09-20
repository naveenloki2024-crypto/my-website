/* ============================================
   RARE HABIT. Checkout Page
   Delivery details -> saved address -> Stripe
   ============================================ */

(function () {
    // NOTE: this IIFE keeps its own constants so it cannot collide with the
    // top-level `API_BASE_URL` declared by main.js in the same page.
    const API_ORIGIN = 'http://127.0.0.1:3000';

    const CART_KEY = 'sandro-cart';
    const EMAIL_KEY = 'sandro-email';

    const COUNTRIES = [
        ['India', 'India'],
        ['Singapore', 'Singapore'],
        ['United States', 'United States'],
        ['United Kingdom', 'United Kingdom'],
        ['United Arab Emirates', 'United Arab Emirates'],
        ['Canada', 'Canada'],
        ['Australia', 'Australia']
    ];

    const state = {
        email: null,
        address: null,
        mode: 'loading'
    };

    const mainEl = document.getElementById('co-main');
    const emptyEl = document.getElementById('co-empty');
    const addressBody = document.getElementById('co-address-body');
    const payBtn = document.getElementById('co-pay-btn');
    const payAlert = document.getElementById('co-pay-alert');

    /* ---------- Helpers ---------- */

    function cartItems() {
        try {
            const raw = localStorage.getItem(CART_KEY);
            const items = raw ? JSON.parse(raw) : [];
            return Array.isArray(items) ? items : [];
        } catch (e) {
            return [];
        }
    }

    function parsePrice(value) {
        return parseFloat(String(value).replace(/[^0-9.]/g, ''));
    }

    function inr(amount) {
        return '₹' + Number(amount || 0).toLocaleString('en-IN');
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function showAlert(element, kind, message) {
        element.className = 'co-alert ' + (kind === 'err' ? 'co-alert-err' : 'co-alert-ok');
        element.textContent = message;
        element.hidden = false;
    }

    function hideAlert(element) {
        element.hidden = true;
    }

    function setPayEnabled(enabled) {
        payBtn.disabled = !enabled;
    }

    /* ---------- Order summary ---------- */

    function renderSummary() {
        const items = cartItems();
        const subtotal = items.reduce((sum, item) => sum + parsePrice(item.price) * (item.qty || 1), 0);

        const itemsHtml = items.map(item => {
            const price = parsePrice(item.price);
            const thumb = item.image
                ? `<img class="co-sum-thumb" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy">`
                : `<span class="co-sum-thumb-fallback"><i class="ri-shopping-bag-3-line"></i></span>`;

            return `
                <div class="co-sum-item">
                    ${thumb}
                    <div class="co-sum-mid">
                        <div class="co-sum-name">${escapeHtml(item.name)}</div>
                        <div class="co-sum-qty">Qty × ${item.qty || 1}</div>
                    </div>
                    <span class="co-sum-price">${inr(price * (item.qty || 1))}</span>
                </div>
            `;
        }).join('');

        document.getElementById('co-summary-items').innerHTML = itemsHtml;
        document.getElementById('co-subtotal').textContent = inr(subtotal);
        document.getElementById('co-total').textContent = inr(subtotal);

        if (items.length === 0) {
            emptyEl.hidden = false;
            mainEl.hidden = true;
        } else {
            mainEl.hidden = false;
            emptyEl.hidden = true;
        }
    }

    /* ---------- Address rendering ---------- */

    function renderAddressLoading() {
        addressBody.innerHTML = `
            <div class="co-skel-wrap">
                <div class="co-skel short"></div>
                <div class="co-skel"></div>
                <div class="co-skel"></div>
            </div>
            <div class="co-loading-text"><i class="ri-loader-4-line"></i> Loading your saved address…</div>
        `;
    }

    function renderAddressForm(prefill, isEditing) {
        const values = prefill || {};

        addressBody.innerHTML = `
            <form class="co-form" id="co-address-form" novalidate>
                <div class="co-field co-full">
                    <label for="addr-email">Email <span class="req">*</span></label>
                    <input class="co-input" id="addr-email" type="email" autocomplete="email"
                           placeholder="you@example.com" value="${escapeHtml(values.email || '')}">
                </div>
                <div class="co-field">
                    <label for="addr-name">Full Name <span class="req">*</span></label>
                    <input class="co-input" id="addr-name" type="text" autocomplete="name"
                           placeholder="Lawadu" value="${escapeHtml(values.name || '')}">
                </div>
                <div class="co-field">
                    <label for="addr-phone">Phone Number <span class="req">*</span></label>
                    <input class="co-input" id="addr-phone" type="tel" inputmode="tel" autocomplete="tel"
                           placeholder="+91 98765 43210" value="${escapeHtml(values.phone || '')}">
                </div>
                <div class="co-field co-full">
                    <label for="addr-line1">Address <span class="req">*</span></label>
                    <input class="co-input" id="addr-line1" type="text" autocomplete="address-line1"
                           placeholder="Street address, house number" value="${escapeHtml(values.line1 || '')}">
                </div>
                <div class="co-field co-full">
                    <label for="addr-line2">Apartment / Area (Optional)</label>
                    <input class="co-input" id="addr-line2" type="text" autocomplete="address-line2"
                           placeholder="Apartment, suite, area or landmark" value="${escapeHtml(values.line2 || '')}">
                </div>
                <div class="co-field">
                    <label for="addr-city">City <span class="req">*</span></label>
                    <input class="co-input" id="addr-city" type="text" autocomplete="address-level2"
                           placeholder="Salem" value="${escapeHtml(values.city || '')}">
                </div>
                <div class="co-field">
                    <label for="addr-state">State <span class="req">*</span></label>
                    <input class="co-input" id="addr-state" type="text" autocomplete="address-level1"
                           placeholder="Tamil Nadu" value="${escapeHtml(values.state || '')}">
                </div>
                <div class="co-field">
                    <label for="addr-pincode">Pincode <span class="req">*</span></label>
                    <input class="co-input" id="addr-pincode" type="text" inputmode="numeric" autocomplete="postal-code"
                           placeholder="636015" value="${escapeHtml(values.pincode || '')}">
                </div>
                <div class="co-field">
                    <label for="addr-country">Country <span class="req">*</span></label>
                    <select class="co-select" id="addr-country">
                        ${COUNTRIES.map(([value]) => `
                            <option value="${value}" ${(values.country || 'India') === value ? 'selected' : ''}>${escapeHtml(value)}</option>
                        `).join('')}
                    </select>
                </div>
                <div class="co-form-err" id="co-form-err" hidden></div>
                <button type="submit" class="co-btn" id="co-addr-save">
                    <i class="ri-check-line"></i>
                    <span>${isEditing ? 'SAVE CHANGES' : 'SAVE ADDRESS &amp; CONTINUE'}</span>
                </button>
            </form>
        `;

        addressBody.querySelector('#co-address-form').addEventListener('submit', function (event) {
            event.preventDefault();
            saveAddressFromForm(isEditing);
        });
    }

    function renderSavedAddress(address) {
        const lines = [
            address && address.line1,
            address && address.line2,
            address && (address.city ? (address.city + (address.state ? ', ' + address.state : '') + (address.pincode ? ' - ' + address.pincode : '')) : ''),
            address && address.country
        ].filter(Boolean);

        addressBody.innerHTML = `
            <div class="co-saved">
                <span class="co-saved-chip"><i class="ri-checkbox-circle-fill"></i> Saved Address</span>
                <div class="co-saved-name">${escapeHtml(address && address.name ? address.name : '')}</div>
                ${address && address.phone ? `<div class="co-saved-line">${escapeHtml(address.phone)}</div>` : ''}
                ${lines.map(line => `<div class="co-saved-line">${escapeHtml(line)}</div>`).join('')}
                <div class="co-saved-actions">
                    <button type="button" class="co-btn-edit" id="co-edit-address">
                        <i class="ri-edit-2-line"></i> Edit Address
                    </button>
                </div>
            </div>
        `;

        document.getElementById('co-edit-address').addEventListener('click', function () {
            state.mode = 'editing';
            renderAddressForm({
                email: state.email,
                name: address.name,
                phone: address.phone,
                line1: address.line1,
                line2: address.line2,
                city: address.city,
                state: address.state,
                pincode: address.pincode,
                country: address.country
            }, true);
        });
    }

    /* ---------- Address save / load ---------- */

    function validateForm() {
        const fields = ['email', 'name', 'phone', 'line1', 'city', 'state', 'pincode', 'country'];
        const values = {};
        const errors = [];

        fields.forEach(key => {
            const el = document.getElementById('addr-' + key);
            values[key] = el ? el.value.trim() : '';
        });

        const isIndia = values.country === 'India';

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
            errors.push('Enter a valid email address.');
        }
        if (values.name.length < 2) {
            errors.push('Enter your full name.');
        }
        if (!/^\+?[0-9()\-\s]{7,15}$/.test(values.phone)) {
            errors.push('Enter a valid phone number.');
        }
        if (values.line1.length < 3) {
            errors.push('Enter your street address.');
        }
        if (values.city.length < 2) {
            errors.push('Enter your city.');
        }
        if (values.state.length < 2) {
            errors.push('Enter your state.');
        }
        if (isIndia ? !/^\d{6}$/.test(values.pincode) : values.pincode.length < 3) {
            errors.push(isIndia ? 'Enter a 6-digit Indian pincode.' : 'Enter a valid pincode / postal code.');
        }

        return { values, errors };
    }

    function markInvalid(inputId, invalid) {
        const el = document.getElementById(inputId);
        if (el) el.classList.toggle('invalid', invalid);
    }

    async function saveAddressFromForm(isEditing) {
        const formError = document.getElementById('co-form-err');
        hideAlert(formError);

        const { values, errors } = validateForm();
        const ids = ['email', 'name', 'phone', 'line1', 'line2', 'city', 'state', 'pincode', 'country'];

        ids.forEach(id => markInvalid('addr-' + id, false));

        if (errors.length) {
            errors.forEach(function (msg, index) {
                const map = [
                    'addr-email', 'addr-name', 'addr-phone', 'addr-line1', null,
                    'addr-city', 'addr-state', 'addr-pincode', null
                ];
                const id = map[index];
                if (id) markInvalid(id, true);
            });
            formError.textContent = errors.join(' ');
            formError.hidden = false;
            return;
        }

        const saveBtn = document.getElementById('co-addr-save');
        saveBtn.disabled = true;
        saveBtn.querySelector('span').textContent = isEditing ? 'SAVING…' : 'SAVING…';

        const address = {
            name: values.name,
            phone: values.phone,
            line1: values.line1,
            line2: values.line2,
            city: values.city,
            state: values.state,
            pincode: values.pincode,
            country: values.country
        };

        try {
            const response = await fetch(`${API_ORIGIN}/api/customers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: values.email,
                    name: values.name,
                    phone: values.phone,
                    shippingAddress: address
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Could not save your address.');
            }

            localStorage.setItem(EMAIL_KEY, values.email);
            state.email = values.email;
            state.address = address;
            state.mode = 'saved';

            renderSavedAddress(address);
            setPayEnabled(true);
            showAlert(payAlert, 'ok', '✓ Address saved. Review your order and proceed to payment.');
        } catch (error) {
            formError.textContent = (error && error.message) || 'Could not save your address. Check the server and try again.';
            formError.hidden = false;
            saveBtn.disabled = false;
            saveBtn.querySelector('span').textContent = isEditing ? 'SAVE CHANGES' : 'SAVE ADDRESS &amp; CONTINUE';
        }
    }

    async function loadSavedAddress() {
        renderAddressLoading();

        const email = (localStorage.getItem(EMAIL_KEY) || '').trim();

        if (!email) {
            state.mode = 'form';
            renderAddressForm({}, false);
            return;
        }

        try {
            const response = await fetch(`${API_ORIGIN}/api/customers/${encodeURIComponent(email)}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Could not load saved address.');
            }

            const customer = data && data.customer;

            if (customer && customer.shippingAddress) {
                state.email = customer.email;
                state.address = customer.shippingAddress;
                state.mode = 'saved';
                renderSavedAddress(customer.shippingAddress);
                setPayEnabled(true);
            } else {
                state.email = email;
                state.mode = 'form';
                renderAddressForm({
                    email: customer ? customer.email : email,
                    name: customer ? customer.name : '',
                    phone: customer ? customer.phone : ''
                }, false);
            }
        } catch (error) {
            state.email = email;
            state.mode = 'form';
            renderAddressForm({ email: email }, false);
            showAlert(payAlert, 'err', 'Could not load a saved address. Enter your details below.');
        }
    }

    /* ---------- Stock revalidation ---------- */

    // Checks the cart quantity of every database-backed item against the
    // latest stock before the customer is sent to Stripe. Quantities found to
    // exceed stock are clamped (the cart is updated so the customer sees the
    // corrected amount) and the checkout is blocked until every line is valid.
    async function revalidateStock() {
        let stockById = {};

        try {
            const res = await fetch(`${API_ORIGIN}/api/products`);
            const data = await res.json();
            (data.products || []).forEach(p => { stockById[p.id] = Number(p.stock); });
        } catch (e) {
            return {
                blocked: true,
                message: 'Could not verify product availability. Please check the server and try again.'
            };
        }

        const items = cartItems();
        const messages = [];
        let adjusted = false;

        items.forEach(ci => {
            const stock = ci.id ? stockById[ci.id] : undefined;
            if (stock === undefined) return;

            if (stock <= 0) {
                messages.push(`"${ci.name}" is out of stock. Remove it from your cart to continue.`);
            } else if (ci.qty > stock) {
                ci.qty = stock;
                adjusted = true;
                messages.push(`Only ${stock} of "${ci.name}" are available. Your quantity was adjusted.`);
            }
        });

        if (adjusted) {
            localStorage.setItem(CART_KEY, JSON.stringify(items));
            renderSummary();
        }

        if (messages.length > 0) {
            return { blocked: true, message: messages.join(' ') };
        }

        return { blocked: false, message: '' };
    }

    /* ---------- Stripe payment ---------- */

    function setPayLoading(loading) {
        payBtn.disabled = true;
        payBtn.querySelector('span').textContent = loading ? 'REDIRECTING TO STRIPE…' : 'PROCEED TO PAYMENT';
    }

    async function proceedToPayment() {
        hideAlert(payAlert);

        if (!state.email || !state.address) {
            showAlert(payAlert, 'err', 'Please save your delivery address first.');
            return;
        }

        setPayLoading(true);

        try {
            const stockCheck = await revalidateStock();
            if (stockCheck.blocked) {
                showAlert(payAlert, 'err', stockCheck.message);
                setPayLoading(false);
                return;
            }

            const response = await fetch(`${API_ORIGIN}/api/create-checkout-session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: cartItems(),
                    customerEmail: state.email,
                    customerName: state.address.name,
                    customerPhone: state.address.phone,
                    shippingAddress: state.address
                })
            });

            let data = {};
            try {
                const text = await response.text();
                data = text ? JSON.parse(text) : {};
            } catch (e) {
                throw new Error('The server returned an invalid response.');
            }

            if (!response.ok) {
                throw new Error(data.error || 'Could not start the payment.');
            }

            if (!data.url) {
                throw new Error('No checkout URL returned.');
            }

            localStorage.removeItem(CART_KEY);
            window.location.href = data.url;
        } catch (error) {
            console.error(error);
            let message = error && error.message;
            if (!message || error instanceof TypeError) {
                message = 'Could not reach the payment server. Make sure the backend is running and try again.';
            }
            showAlert(payAlert, 'err', message);
            setPayLoading(false);
        }
    }

    /* ---------- Init ---------- */

    payBtn.addEventListener('click', proceedToPayment);

    const items = cartItems();

    if (items.length === 0) {
        emptyEl.hidden = false;
        mainEl.hidden = true;
    } else {
        renderSummary();
        hideAlert(payAlert);
        setPayEnabled(false);
        loadSavedAddress();
    }
})();