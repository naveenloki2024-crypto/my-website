#!/usr/bin/env node
/* ============================================
   E2E check for the Stripe sandbox flow (dev only).

   Simulates the full path the browser follows, except the GUI card form:
     1. GET /api/stripe-test            -> keys are test-mode & reachable
     2. Seed products                   -> products exist for stock checks
     3. GET /api/products               -> catalog reachable
     4. POST /api/customers             -> save shipping address (User row)
     5. POST /api/create-checkout-session -> Stripe Checkout Session (draft order)
     6. Confirm the session's PaymentIntent with card 4242 (tok_visa)
     7. GET /api/verify-payment?session_id=... -> order finalized+PAID
     8. GET /api/orders?email=...       -> order present in database

   Usage:
     node scripts/test-stripe-flow.js
   ============================================ */

require('dotenv').config();
const { execFileSync } = require('child_process');
const path = require('path');
const { disconnectDB } = require('../config/db');

const ORIGIN = process.env.TEST_ORIGIN || 'http://127.0.0.1:3000';

function seedProducts() {
    execFileSync(process.execPath, [path.join(__dirname, 'seed-products.js')], {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit'
    });
}

async function httpJson(method, path, body) {
    const res = await fetch(`${ORIGIN}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
    return { status: res.status, data };
}

function assert(cond, label, extra) {
    if (!cond) {
        console.error(`\nFAILED: ${label}${extra ? ' | ' + extra : ''}`);
        process.exitCode = 1;
        throw new Error(`Assertion failed: ${label}`);
    }
    console.log(`ok:      ${label}`);
}

async function main() {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    console.log('== 1. STRIPE TEST CONFIG ==');
    const cfg = await httpJson('GET', '/api/stripe-test');
    assert(cfg.status === 200 && cfg.data.stripe === 'test mode', 'GET /api/stripe-test returns test mode', JSON.stringify(cfg));

    console.log('\n== 2. SEED PRODUCTS ==');
    seedProducts();

    console.log('\n== 3. CATALOG ==');
    const cat = await httpJson('GET', '/api/products');
    assert(cat.status === 200 && Array.isArray(cat.data.products) && cat.data.products.length > 0,
        'GET /api/products returns products', JSON.stringify(cat).slice(0, 200));
    const product = cat.data.products.find(p => Number(p.stock) > 0);
    assert(!!product, 'at least one in-stock product exists');

    console.log('\n== 4. SAVE SHIPPING ADDRESS ==');
    const email = `stripe-e2e-${Date.now()}@example.com`;
    const address = {
        name: 'Stripe E2E Tester',
        phone: '+91 98765 43210',
        line1: '1 Test Street',
        city: 'Salem',
        state: 'Tamil Nadu',
        pincode: '636015',
        country: 'India'
    };
    const cust = await httpJson('POST', '/api/customers', { email, name: address.name, phone: address.phone, shippingAddress: address });
    assert(cust.status === 200 && cust.data.customer && cust.data.customer.email === email,
        'POST /api/customers saves address', JSON.stringify(cust));

    console.log('\n== 5. CREATE CHECKOUT SESSION ==');
    const items = [{ id: product.id, name: product.name, price: Number(product.price) / 100, qty: 1, image: product.image || null }];
    const ses = await httpJson('POST', '/api/create-checkout-session', {
        items,
        customerEmail: email,
        customerName: address.name,
        customerPhone: address.phone,
        shippingAddress: address
    });
    assert(ses.status === 200 && ses.data.url, 'POST /api/create-checkout-session returns checkout url', JSON.stringify(ses).slice(0, 300));
    const sessionId = /cs_test_[a-zA-Z0-9_-]+/.exec(ses.data.url);
    assert(!!sessionId, 'url contains a cs_test_ session id', ses.data.url);

    console.log('\n== 6. STRIPE TEST PAYMENT (card 4242) ==');
    const full = await stripe.checkout.sessions.retrieve(sessionId[0]);
    assert(full.payment_intent, 'session has a payment_intent');
    const pm = await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_visa' } });
    assert(pm.card.last4 === '4242', 'payment method maps to test card 4242', pm.card && pm.card.last4);
    const confirmed = await stripe.paymentIntents.confirm(full.payment_intent, { payment_method: pm.id });
    console.log(`info:    payment_intent status=${confirmed.status} | brand=${pm.card.brand} **** ${pm.card.last4}`);
    assert(confirmed.status === 'succeeded', 'sandbox charge with 4242 succeeded');

    console.log('\n== 7. VERIFY PAYMENT (success page path) ==');
    const verified = await httpJson('GET', `/api/verify-payment?session_id=${encodeURIComponent(sessionId[0])}`);
    assert(verified.status === 200 && verified.data.success === true,
        'GET /api/verify-payment confirms payment', JSON.stringify(verified));
    assert(verified.data.order_saved === true, 'order saved in database', JSON.stringify(verified).slice(0, 200));

    console.log('\n== 8. ORDER EXISTS IN DB ==');
    const orders = await httpJson('GET', `/api/orders?email=${encodeURIComponent(email)}`);
    assert(orders.status === 200 && orders.data.length === 1, 'order visible in /api/orders', JSON.stringify(orders).slice(0, 200));
    const order = orders.data[0];
    assert(order.paymentStatus === 'PAID' && order.status === 'CONFIRMED', 'order is PAID + CONFIRMED', `${order.status}/${order.paymentStatus}`);
    assert(order.totalAmount > 0, 'order has totalAmount', String(order.totalAmount));

    console.log('\n==========================================');
    console.log(`E2E STRIPE FLOW PASSED. order=${order.orderNumber} | session=${sessionId[0]}`);
    console.log('==========================================');
}

main()
    .catch(err => console.error('\nE2E FLOW FAILED:', err.message))
    .finally(() => disconnectDB());