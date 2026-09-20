/* ============================================
   RARE HABIT. Orders Page
   Loads orders for a customer from the Orders API,
   plus order tracking details (timeline, cancellation
   reason, admin messages) from the tracking API.
   ============================================ */

(function () {
    const API_BASE_URL = 'http://127.0.0.1:3000';

    const emailInput = document.getElementById('orders-email');
    const fetchBtn = document.getElementById('orders-fetch');
    const container = document.getElementById('orders-container');

    let currentEmail = (localStorage.getItem('sandro-email') || '').trim();

    const TRACK_STEPS = [
        ['PENDING', 'Order Placed'],
        ['CONFIRMED', 'Confirmed'],
        ['PROCESSING', 'Processing'],
        ['SHIPPED', 'Shipped'],
        ['OUT_FOR_DELIVERY', 'Out for Delivery'],
        ['DELIVERED', 'Delivered']
    ];

    const STATUS_LABELS = {
        PENDING: 'Pending',
        CONFIRMED: 'Confirmed',
        PROCESSING: 'Processing',
        SHIPPED: 'Shipped',
        OUT_FOR_DELIVERY: 'Out for Delivery',
        DELIVERED: 'Delivered',
        CANCELLED: 'Cancelled',
        PAID: 'Paid',
        FAILED: 'Failed',
        REFUNDED: 'Refunded'
    };

    function formatDate(iso) {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
            ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function formatMoney(amount, currency) {
        const value = ((amount || 0) / 100).toFixed(0);
        return currency === 'INR' ? '₹' + Number(value).toLocaleString('en-IN') : (currency || '').toUpperCase() + ' ' + value;
    }

    function statusLabel(status) {
        const s = String(status || '').toUpperCase();
        return STATUS_LABELS[s] || s;
    }

    function badgeKind(status) {
        const s = String(status || '').toUpperCase();
        if (s === 'CANCELLED' || s === 'FAILED' || s === 'REFUNDED') return 'bad';
        if (s === 'DELIVERED' || s === 'PAID') return 'ok';
        if (s === 'PENDING') return 'wait';
        if (s === 'CONFIRMED' || s === 'PROCESSING' || s === 'SHIPPED' || s === 'OUT_FOR_DELIVERY') return 'gold';
        return 'dark';
    }

    function badge(status) {
        return `<span class="sb sb-${badgeKind(status)}">${escapeHtml(statusLabel(status))}</span>`;
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

    /* ---------- States ---------- */

    function ocState(title, text, icon, isError) {
        return `
            <div class="oc-state${isError ? ' oc-state-error' : ''}">
                <div class="oc-state-icon"><i class="${icon}"></i></div>
                <h3 class="oc-state-title">${escapeHtml(title)}</h3>
                <p class="oc-state-text">${escapeHtml(text)}</p>
            </div>
        `;
    }

    function renderEmpty() {
        container.innerHTML = ocState(
            'No orders found',
            'We could not find any orders for this email. Paid orders placed at checkout will appear here.',
            'ri-shopping-bag-3-line');
    }

    function renderError(message) {
        container.innerHTML = ocState(
            'Could not load orders',
            message || 'Make sure the backend server is running and try again.',
            'ri-error-warning-line',
            true);
    }

    function renderLoading() {
        container.innerHTML = `
            <div class="oc-state">
                <span class="oc-loader"></span>
                <h3 class="oc-state-title">Loading your orders</h3>
                <p class="oc-state-text">Pulling your order history…</p>
            </div>
        `;
    }

    /* ---------- Helpers ---------- */

    function addressParts(address) {
        if (!address) return [];
        return [
            address.name,
            address.phone,
            address.line1,
            address.line2,
            address.area,
            address.city,
            address.district,
            address.state,
            address.pincode || address.postal_code,
            address.country
        ].filter(Boolean);
    }

    function compactAddress(address) {
        const parts = addressParts(address);
        if (!parts.length) return '';
        const name = [parts[0], parts[1]].filter(Boolean);
        const where = parts.slice(2);
        const joined = name.concat(where).join(', ');
        return joined.replace(/,\s*,/g, ',').replace(/,\s*$/, '');
    }

    function detailAddressRow(icon, value) {
        if (!value) return '';
        return `
            <div class="od-row">
                <i class="${icon}"></i>
                <span class="od-row-text">${escapeHtml(value)}</span>
            </div>
        `;
    }

    function productThumbs(items) {
        const thumbs = (items || []).slice(0, 3).map(item => {
            if (!item.image) {
                return `<span class="oc-thumb-fallback"><i class="ri-shopping-bag-3-line"></i></span>`;
            }
            return `<img class="oc-thumb" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy">`;
        }).join('');

        const extra = items.length > 3
            ? `<span class="oc-thumb-more">+${items.length - 3}</span>`
            : '';

        return `<div class="oc-thumbs">${thumbs}${extra}</div>`;
    }

    function productRows(items, currency) {
        const rows = items.slice(0, 3).map(item => `
            <div class="oc-prod">
                <span class="oc-prod-name">${escapeHtml(item.name)}</span>
                <span class="oc-prod-qty">× ${item.quantity}</span>
                <span class="oc-prod-price">${formatMoney((item.price || 0) * (item.quantity || 1), currency)}</span>
            </div>
        `).join('');

        if (items.length > 3) {
            rows += `<div class="oc-more">+${items.length - 3} more item${items.length - 3 > 1 ? 's' : ''}</div>`;
        }

        return rows;
    }

    /* ---------- Order cards ---------- */

    function renderOrders(orders) {
        if (!orders.length) {
            renderEmpty();
            return;
        }

        const list = orders.map(order => {
            const items = order.items || [];
            const currency = order.currency || 'INR';
            const ship = compactAddress(order.shippingAddress);
            const cancelled = String(order.status).toUpperCase() === 'CANCELLED';

            return `
                <article class="oc-card${cancelled ? ' cancelled' : ''}">
                    <div class="oc-head">
                        ${productThumbs(items)}
                        <div class="oc-idbox">
                            <div class="oc-id">${escapeHtml(order.orderNumber || order.id)}</div>
                            <div class="oc-date">${formatDate(order.createdAt)}</div>
                        </div>
                        <div class="oc-badges">
                            ${badge(order.status)}
                            ${badge(order.paymentStatus)}
                        </div>
                    </div>

                    <div class="oc-body">
                        <div class="oc-prods">${productRows(items, currency)}</div>
                        <div class="oc-foot">
                            <div class="oc-ship">
                                <i class="ri-map-pin-2-line"></i>
                                <span>${escapeHtml(ship || 'No delivery address on file')}</span>
                            </div>
                            <div class="oc-total">
                                <span class="oc-total-label">Total</span>
                                <span class="oc-total-value">${formatMoney(order.totalAmount, currency)}</span>
                            </div>
                        </div>
                    </div>

                    <div class="oc-actions">
                        <button type="button" class="oc-btn-track" data-order-id="${order.id}" data-email="${encodeURIComponent(currentEmail)}" aria-expanded="false">
                            <i class="ri-truck-line oc-track-icon"></i>
                            <span>VIEW &amp; TRACK ORDER</span>
                            <i class="ri-chevron-down-line oc-chevron"></i>
                        </button>
                    </div>

                    <div class="oc-detail" id="track-${order.id}" hidden></div>
                </article>
            `;
        }).join('');

        container.innerHTML = `
            <div class="oc-results">
                <span class="oc-count">${orders.length} ORDER${orders.length > 1 ? 'S' : ''}</span>
                <span class="oc-fresh">Newest first</span>
            </div>
            <div class="oc-list">${list}</div>
        `;
    }

    /* ============================================
       TRACKING DETAILS
       ============================================ */

    /*
        Completed steps are derived from the CURRENT status:
        every canonical step up to and including the current status
        counts as completed even when history is incomplete.
        Example: status DELIVERED => all 6 steps completed;
                 status SHIPPED   => PENDING..SHIPPED completed,
                                     OUT_FOR_DELIVERY/DELIVERED pending.
        Any extra events recorded in history are also honoured.
    */
    function reachedStatuses(order, history) {
        const reached = new Set(['PENDING']);
        const cur = String(order.status || '').toUpperCase();

        if (cur === 'CANCELLED') {
            (history || []).forEach(h => reached.add(h.newStatus));
            reached.add('CANCELLED');
            return reached;
        }

        for (const [status] of TRACK_STEPS) {
            reached.add(status);
            if (status === cur) break;
        }

        return reached;
    }

    function buildSteps(order, history) {
        const cur = String(order.status || '').toUpperCase();

        if (cur !== 'CANCELLED') return TRACK_STEPS.slice();

        const reached = reachedStatuses(order, history);
        let maxIndex = 0;
        TRACK_STEPS.forEach(([status], index) => {
            if (reached.has(status)) maxIndex = index;
        });

        const steps = TRACK_STEPS.slice(0, maxIndex + 1);
        steps.push(['CANCELLED', 'Order Cancelled']);
        return steps;
    }

    function statusTime(order, history, status) {
        if (status === 'CANCELLED') {
            const cancelEntry = (history || []).find(h => h.newStatus === 'CANCELLED');
            return cancelEntry ? formatDate(cancelEntry.createdAt) : formatDate(order.updatedAt);
        }

        const entry = (history || []).find(h => h.newStatus === status);
        if (entry) return formatDate(entry.createdAt);

        if (status === 'PENDING') return formatDate(order.createdAt);

        return null;
    }

    function renderTimeline(order, history) {
        const cur = String(order.status || '').toUpperCase();
        const reached = reachedStatuses(order, history);
        const steps = buildSteps(order, history).map(([status, label]) => {
            const isDone = reached.has(status) && cur !== status && !(cur === 'CANCELLED' && status === 'CANCELLED');
            const isCurrent = cur === status;
            const isCancelled = status === 'CANCELLED' && cur === 'CANCELLED';
            const time = statusTime(order, history, status);

            let stateClass = '';
            let nodeHtml = '';

            if (isCancelled) {
                stateClass = 'is-cancelled';
                nodeHtml = `<i class="ri-close-circle-fill"></i>`;
            } else if (isDone) {
                stateClass = 'is-done';
                nodeHtml = `<i class="ri-checkbox-circle-fill"></i>`;
            } else if (isCurrent) {
                stateClass = 'is-current';
                nodeHtml = `<span class="tl-dot"></span>`;
            }

            return `
                <li class="tl-step ${stateClass}">
                    <span class="tl-node">${nodeHtml}</span>
                    <div class="tl-body">
                        <span class="tl-label">${escapeHtml(label)}</span>
                        ${time ? `<span class="tl-time">${time}</span>` : ''}
                    </div>
                </li>
            `;
        });

        return `<ol class="tl">${steps.join('')}</ol>`;
    }

    function renderMessages(messages) {
        if (!messages || messages.length === 0) {
            return `<p class="od-empty">No updates from our team yet.</p>`;
        }

        const latest = messages[messages.length - 1];
        const older = messages.slice(0, -1);

        const messageBlock = (msg, extraClass) => `
            <div class="od-msg${extraClass ? ' ' + extraClass : ''}">
                <div class="od-msg-head">
                    <span class="od-msg-author">RARE HABIT TEAM</span>
                    <span class="od-msg-time">${formatDate(msg.createdAt)}</span>
                </div>
                <p class="od-msg-body">${escapeHtml(msg.message)}</p>
            </div>
        `;

        return messageBlock(latest, 'latest') + older.map(m => messageBlock(m)).join('');
    }

    function renderTracking(order, items, history, messages) {
        const currency = order.currency || 'INR';
        const subtotal = items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
        const shipping = Number(order.shippingFee) || 0;
        const shippingDisplay = order.totalAmount > 0 && shipping > 0 && subtotal > 0 ? shipping : 0;
        const address = order.shippingAddress;

        const cancelled = String(order.status).toUpperCase() === 'CANCELLED';

        const itemsHtml = items.map((item, index) => `
            <div class="od-item">
                ${item.image
                    ? `<img class="od-item-thumb" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy">`
                    : `<span class="od-item-thumb-fallback"><i class="ri-shopping-bag-3-line"></i></span>`}
                <div class="od-item-mid">
                    <div class="od-item-name">${escapeHtml(item.name)}</div>
                    <div class="od-item-meta">Qty ${item.quantity} · ${formatMoney(item.price, currency)} each</div>
                </div>
                <div class="od-item-price">${formatMoney((item.price || 0) * (item.quantity || 1), currency)}</div>
            </div>
        `).join('');

        const totalsHtml = `
            <div class="od-totals">
                <div class="od-total-row"><span>Subtotal</span><span>${formatMoney(subtotal - shippingDisplay, currency)}</span></div>
                <div class="od-total-row"><span>Shipping</span><span>${formatMoney(shippingDisplay, currency)}</span></div>
                <div class="od-total-row total"><span>Total</span><span>${formatMoney(order.totalAmount, currency)}</span></div>
            </div>
        `;

        const addressHtml = `
            <div class="od-rows">
                ${detailAddressRow('ri-user-star-line', address && address.name ? (address.name + (address.phone ? ' · ' + address.phone : '')) : '')}
                ${detailAddressRow('ri-map-pin-2-line', addressParts(address).slice(2).join(', '))}
                ${!address ? '<div class="od-empty">No delivery address on file.</div>' : ''}
            </div>
        `;

        const payHtml = `
            <div class="od-rows">
                <div class="od-row">
                    <i class="ri-wallet-3-line"></i>
                    <span class="od-row-text">Payment status</span>
                    ${badge(order.paymentStatus)}
                </div>
                <div class="od-row">
                    <i class="ri-hashtag"></i>
                    <span class="od-row-text">Order ID</span>
                    <span class="od-row-text sub">${escapeHtml(order.orderNumber || order.id)}</span>
                </div>
                <div class="od-row">
                    <i class="ri-calendar-line"></i>
                    <span class="od-row-text">Placed</span>
                    <span class="od-row-text sub">${formatDate(order.createdAt)}</span>
                </div>
            </div>
        `;

        const cancelBanner = cancelled
            ? `
                <div class="od-cancel">
                    <i class="ri-close-circle-fill od-cancel-icon"></i>
                    <div>
                        <div class="od-cancel-title">ORDER CANCELLED</div>
                        <div class="od-cancel-reason-label">Cancellation Reason</div>
                        <div class="od-cancel-reason">${escapeHtml(order.cancellationReason || 'Not provided')}</div>
                    </div>
                </div>
              `
            : '';

        return `
            <div class="od">
                <div class="od-hero">
                    <div>
                        <div class="od-hero-kicker">ORDER DETAILS</div>
                        <h3 class="od-hero-id">${escapeHtml(order.orderNumber || order.id)}</h3>
                        <p class="od-hero-meta">Placed <strong>${formatDate(order.createdAt)}</strong></p>
                    </div>
                    <div class="od-badges">
                        ${badge(order.status)}
                        ${badge(order.paymentStatus)}
                    </div>
                </div>

                <div class="od-grid">
                    <div class="od-col od-col-tl">
                        <div class="od-card">
                            <h4 class="od-card-h"><i class="ri-truck-line"></i> ORDER TRACKING</h4>
                            ${renderTimeline(order, history)}
                        </div>
                        ${cancelBanner}
                    </div>

                    <div class="od-col">
                        <div class="od-card">
                            <h4 class="od-card-h"><i class="ri-shopping-bag-3-line"></i> ITEMS</h4>
                            ${itemsHtml}
                            ${totalsHtml}
                        </div>

                        <div class="od-card">
                            <h4 class="od-card-h"><i class="ri-map-pin-2-line"></i> DELIVERY ADDRESS</h4>
                            ${addressHtml}
                        </div>

                        <div class="od-card">
                            <h4 class="od-card-h"><i class="ri-wallet-3-line"></i> PAYMENT</h4>
                            ${payHtml}
                        </div>

                        <div class="od-card">
                            <h4 class="od-card-h"><i class="ri-chat-3-line"></i> UPDATES FROM OUR TEAM</h4>
                            ${renderMessages(messages)}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    async function loadTracking(orderId, email) {
        const card = document.getElementById(`track-${orderId}`).closest('.oc-card');
        const detail = document.getElementById(`track-${orderId}`);
        if (!detail) return;

        detail.hidden = false;
        detail.innerHTML = `
            <div class="od" style="padding:26px;text-align:center">
                <span class="oc-loader"></span>
                <p style="color:#8b94a8;font-size:.85rem">Loading tracking…</p>
            </div>
        `;
        if (card && !card.classList.contains('open')) card.classList.add('open');

        try {
            const response = await fetch(
                `${API_BASE_URL}/api/orders/${encodeURIComponent(orderId)}/timeline?email=${encodeURIComponent(email)}`
            );
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Could not load tracking.');
            }

            detail.innerHTML = renderTracking(data.order, data.items, data.statusHistory, data.messages);
        } catch (error) {
            detail.innerHTML = `
                <div class="od" style="padding:26px;text-align:center">
                    <p style="color:#ef8a86;font-size:.9rem">${escapeHtml(error.message || 'Could not load tracking details.')}</p>
                </div>
            `;
            if (card) card.classList.remove('open');
        }
    }

    function onTrackClick(event) {
        const button = event.target.closest('.oc-btn-track');
        if (!button) return;

        const orderId = button.getAttribute('data-order-id');
        const card = button.closest('.oc-card');
        const detail = document.getElementById(`track-${orderId}`);
        if (!card || !detail) return;

        const opening = detail.hidden;

        if (opening) {
            button.setAttribute('aria-expanded', 'true');
            loadTracking(orderId, currentEmail);
            setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
        } else {
            button.setAttribute('aria-expanded', 'false');
            detail.hidden = true;
            card.classList.remove('open');
        }
    }

    async function loadOrders(email) {
        fetchBtn.disabled = true;
        fetchBtn.querySelector('span').textContent = 'LOADING…';
        renderLoading();

        try {
            const response = await fetch(`${API_BASE_URL}/api/orders?email=${encodeURIComponent(email)}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Could not load orders.');
            }

            renderOrders(data);
        } catch (error) {
            renderError(error.message);
        } finally {
            fetchBtn.disabled = false;
            fetchBtn.querySelector('span').textContent = 'VIEW MY ORDERS';
        }
    }

    function onViewOrders() {
        const email = (emailInput.value || '').trim();

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            renderError('Please enter a valid email address.');
            return;
        }

        currentEmail = email;
        localStorage.setItem('sandro-email', email);
        loadOrders(email);
    }

    container.addEventListener('click', onTrackClick);

    const ordersForm = document.getElementById('orders-form');
    if (ordersForm) {
        ordersForm.addEventListener('submit', (event) => {
            event.preventDefault();
            onViewOrders();
        });
    }

    if (currentEmail) {
        emailInput.value = currentEmail;
        loadOrders(currentEmail);
    }
})();