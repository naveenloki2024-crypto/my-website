require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const Stripe = require('stripe');
const db = require('./config/db');
const prisma = require('./config/prisma');
const adminAuth = require('./config/adminAuth');

const app = express();
const PORT = process.env.PORT || 3000;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const ALLOWED_ORDER_STATUS = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];
const ALLOWED_PAYMENT_STATUS = ['UNPAID', 'PAID', 'REFUNDED', 'FAILED'];

function parsePriceToCents(priceStr) {
    const amount = parseFloat(String(priceStr).replace(/[^0-9.]/g, ''));
    return Math.round((isNaN(amount) ? 0 : amount) * 100);
}

function generateOrderNumber() {
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `ORD-${Date.now().toString(36).toUpperCase()}${rand}`;
}

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 191);
}

async function resolveProductIds(ids) {
    const candidateIds = Array.from(new Set((ids || []).filter(Boolean))).slice(0, 100);

    if (!candidateIds.length) return {};

    const found = await prisma.product.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true }
    });

    const valid = new Set(found.map(p => p.id));
    const result = {};

    candidateIds.forEach(id => {
        result[id] = valid.has(id) ? id : undefined;
    });

    return result;
}

async function uniqueProductSlug(baseName) {
    const base = slugify(baseName);
    const existing = await prisma.product.findMany({
        where: { slug: { startsWith: base } },
        select: { slug: true }
    });

    const taken = new Set(existing.map(p => p.slug));

    if (base && !taken.has(base)) return base;

    for (let i = 0; i < 100; i += 1) {
        const candidate = `${base}-${i + 1}`;
        if (!taken.has(candidate)) return candidate;
    }

    return `${base}-${Date.now().toString(36)}`;
}

function parseProductPriceToPaise(price) {
    const num = Number(price);
    if (!Number.isFinite(num)) return null;
    return Math.round(num * 100);
}

function sanitizeProductInput(body) {
    const { name, description, price, category, stock, image } = body || {};

    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) return { error: 'Product name is required.' };
    if (cleanName.length > 191) return { error: 'Product name must be 191 characters or fewer.' };

    const amountPaise = parseProductPriceToPaise(price);
    if (amountPaise === null || amountPaise <= 0) {
        return { error: 'A valid product price greater than zero is required.' };
    }

    let cleanImage = null;
    if (typeof image === 'string' && image.trim()) {
        cleanImage = image.trim();
        if (cleanImage.length > 191) return { error: 'Image path must be 191 characters or fewer.' };
    }

    let cleanStock = 0;
    if (stock !== undefined && stock !== null && String(stock).trim() !== '') {
        cleanStock = Number(stock);
        if (!Number.isInteger(cleanStock) || cleanStock < 0) {
            return { error: 'Stock must be a whole number of zero or more.' };
        }
    }

    return {
        data: {
            name: cleanName,
            description: typeof description === 'string' && description.trim()
                ? description.trim().slice(0, 191)
                : null,
            price: amountPaise,
            category: typeof category === 'string' && category.trim()
                ? category.trim().slice(0, 191)
                : null,
            stock: cleanStock,
            image: cleanImage
        }
    };
}

function stripeAddressToJson(shippingDetails) {
    if (!shippingDetails || !shippingDetails.address) return null;

    const a = shippingDetails.address;

    return {
        name: shippingDetails.name || null,
        line1: a.line1 || null,
        line2: a.line2 || null,
        city: a.city || null,
        state: a.state || null,
        postal_code: a.postal_code || null,
        country: a.country || null
    };
}

const COUNTRY_CODES = {
    'India': 'IN',
    'Singapore': 'SG',
    'United States': 'US',
    'United Kingdom': 'GB',
    'United Arab Emirates': 'AE',
    'Canada': 'CA',
    'Australia': 'AU'
};

function countryCodeFor(country) {
    const name = String(country || '').trim();
    if (COUNTRY_CODES[name]) return COUNTRY_CODES[name];
    if (/^[A-Za-z]{2}$/.test(name)) return name.toUpperCase();
    return 'IN';
}

function stripeAddressFromSaved(saved) {
    if (!saved || typeof saved !== 'object') return null;
    if (!saved.line1 && !saved.city) return null;

    return {
        line1: saved.line1 || null,
        line2: [saved.line2, saved.area, saved.district].filter(Boolean).join(', ') || null,
        city: saved.city || null,
        state: saved.state || null,
        postal_code: saved.pincode || saved.postal_code || null,
        country: countryCodeFor(saved.country)
    };
}

function normalizeSavedAddress(input) {
    if (!input || typeof input !== 'object') return null;

    const address = {
        name: input.name || null,
        phone: input.phone || null,
        line1: input.line1 || null,
        line2: input.line2 || null,
        area: input.area || null,
        district: input.district || null,
        city: input.city || null,
        state: input.state || null,
        pincode: input.pincode || input.postal_code || null,
        country: input.country || null
    };

    const hasUsableLine = address.line1 && String(address.line1).trim().length >= 3;
    if (!hasUsableLine) return null;

    return address;
}

function handleDbError(res, error, message) {
    console.error(`[DB] ${message}`, error.message);

    if (error && error.code === 'P2002') {
        return res.status(409).json({ error: 'A record with this value already exists.' });
    }

    if (error && ['P2003', 'P2025'].includes(error.code)) {
        return res.status(404).json({ error: 'Related record not found.' });
    }

    res.status(500).json({ error: message });
}

function throwHttp(status, message) {
    const error = new Error(message);
    error.status = status;
    throw error;
}

async function applyOrderStatusUpdate(orderId, body, adminId) {
    const { status, paymentStatus, cancellationReason } = body || {};
    const hasStatus = typeof status === 'string' && String(status).trim().length > 0;
    const hasPaymentStatus = typeof paymentStatus === 'string' && String(paymentStatus).trim().length > 0;

    if (!hasStatus && !hasPaymentStatus) {
        throwHttp(400, 'Provide at least one of status or paymentStatus.');
    }

    const existing = await prisma.order.findUnique({ where: { id: orderId } });

    if (!existing) {
        throwHttp(404, 'Order not found.');
    }

    const data = {};
    let history = null;
    const reason = cancellationReason && String(cancellationReason).trim();

    if (hasStatus) {
        const newStatus = String(status).trim().toUpperCase();

        if (!ALLOWED_ORDER_STATUS.includes(newStatus)) {
            throwHttp(400, `Invalid status. Allowed: ${ALLOWED_ORDER_STATUS.join(', ')}`);
        }

        if (newStatus === 'CANCELLED' && !reason) {
            throwHttp(400, 'A cancellation reason is required when cancelling an order.');
        }

        data.status = newStatus;

        if (newStatus === 'CANCELLED') {
            data.cancellationReason = reason;
        } else if (existing.status === 'CANCELLED') {
            data.cancellationReason = null;
        }

        if (newStatus !== existing.status) {
            history = {
                orderId: existing.id,
                oldStatus: existing.status,
                newStatus,
                adminId: adminId || null,
                note: newStatus === 'CANCELLED' ? reason : null
            };
        }
    }

    if (hasPaymentStatus) {
        const newPaymentStatus = String(paymentStatus).trim().toUpperCase();

        if (!ALLOWED_PAYMENT_STATUS.includes(newPaymentStatus)) {
            throwHttp(400, `Invalid paymentStatus. Allowed: ${ALLOWED_PAYMENT_STATUS.join(', ')}`);
        }

        data.paymentStatus = newPaymentStatus;
    }

    const order = await prisma.$transaction(async (tx) => {
        if (history) {
            await tx.orderStatusHistory.create({ data: history });
        }

        return tx.order.update({
            where: { id: existing.id },
            data,
            include: { items: true }
        });
    });

    return order;
}

function handleStatusError(res, error) {
    if (error && error.status) {
        return res.status(error.status).json({ error: error.message });
    }

    return handleDbError(res, error, 'Could not update order status.');
}

// ======================= PRODUCT STOCK =======================

const LOW_STOCK_THRESHOLD = 5;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB upload limit
const IMAGE_MAGIC_BYTES = {
    png: [0x89, 0x50, 0x4e, 0x47],
    jpg: [0xff, 0xd8, 0xff]
};

function itemQuantity(item) {
    if (!item) return null;
    const raw = item.qty !== undefined ? item.qty : item.quantity;
    const qty = Number(raw);
    return Number.isInteger(qty) && qty >= 1 ? qty : null;
}

function sniffImageExt(buffer) {
    if (!buffer || buffer.length < 12) return null;
    const bytes = Array.from(buffer.subarray(0, 4));

    if (bytes.join(',') === IMAGE_MAGIC_BYTES.png.join(',')) return 'png';
    if (bytes.slice(0, 3).join(',') === IMAGE_MAGIC_BYTES.jpg.join(',')) return 'jpg';
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';

    return null;
}

function stockShortageMessage(detail) {
    if (!detail) return 'This product is no longer available in the requested quantity.';
    if (detail.invalidQuantity) return 'Quantity must be a whole number of at least 1.';
    if (detail.availableStock <= 0) return `${detail.name} is currently out of stock.`;
    return `Only ${detail.availableStock} items are available.`;
}

/**
 * Re-reads the current stock for every requested item and returns an error
 * payload describing the first problem found (oversell, invalid qty, deleted
 * product, or out-of-stock). Returns null when everything validates.
 *
 * NOTE: this is a pre-flight check. The authoritative, race-safe enforcement
 * happens inside a transaction with conditional atomic decrements.
 */
async function validateRequestedStock(items) {
    const lines = (items || []).map(item => ({
        id: (item && (item.productId || item.id)) || null,
        name: (item && item.name) || 'Item',
        requested: itemQuantity(item)
    }));

    const distinctIds = Array.from(new Set(lines.filter(l => l.id).map(l => String(l.id)))).slice(0, 100);
    const stockById = {};

    if (distinctIds.length) {
        const rows = await prisma.product.findMany({
            where: { id: { in: distinctIds } },
            select: { id: true, name: true, stock: true }
        });
        rows.forEach(p => { stockById[p.id] = p; });
    }

    const errors = [];

    for (const line of lines) {
        if (!line.id) continue;

        const product = stockById[line.id];
        if (!product) {
            errors.push({
                productId: line.id,
                name: line.name,
                requested: line.requested,
                availableStock: 0,
                outOfStock: true
            });
            continue;
        }

        if (line.requested === null) {
            errors.push({
                productId: product.id,
                name: product.name,
                requested: line.requested,
                availableStock: product.stock,
                invalidQuantity: true
            });
            continue;
        }

        if (line.requested > product.stock) {
            errors.push({
                productId: product.id,
                name: product.name,
                requested: line.requested,
                availableStock: product.stock,
                outOfStock: product.stock <= 0
            });
        }
    }

    if (!errors.length) return null;

    const first = errors[0];
    return {
        success: false,
        message: stockShortageMessage(first),
        availableStock: first.availableStock,
        productId: first.productId,
        errors
    };
}

class StockShortageError extends Error {
    constructor(details) {
        super(stockShortageMessage(details && details[0]));
        this.details = details || [];
    }
}

/**
 * Atomic per-product stock reduction, safe under concurrency.
 * updateMany with `stock: { gte: qty }` is an atomic conditional decrement:
 * it cannot push a product below zero and it serializes concurrent buyers so
 * the last remaining unit is never oversold. Called inside a transaction.
 */
async function decrementStockForItems(tx, items) {
    const shortages = [];

    for (const item of items) {
        if (!item || !item.productId) continue;
        const qty = Number(item.quantity && item.quantity >= 1 ? item.quantity : (item.qty || 1));

        const result = await tx.product.updateMany({
            where: { id: item.productId, stock: { gte: qty } },
            data: { stock: { decrement: qty } }
        });

        if (result.count === 0) {
            const product = await tx.product.findUnique({
                where: { id: item.productId },
                select: { id: true, name: true, stock: true }
            });
            shortages.push({
                productId: item.productId,
                name: (product && product.name) || item.name || 'Item',
                requested: qty,
                availableStock: (product && product.stock) || 0
            });
        }
    }

    if (shortages.length) throw new StockShortageError(shortages);
}

function sendStockError(res, payload) {
    return res.status(400).json(payload || {
        success: false,
        message: 'One or more items exceed the available stock.'
    });
}

async function finalizeStripeOrder(session) {
    if (!session || !session.id) return null;

    const logPrefix = `[Stripe] finalizeOrder ${session.id}`;

    try {
        let lineItems = [];

        try {
            const full = await stripe.checkout.sessions.retrieve(session.id, {
                expand: ['line_items.data.price.product']
            });
            lineItems = ((full.line_items && full.line_items.data) || [])
                .filter(li => li.price)
                .map(li => ({
                    name: (li.description || (li.price.product && li.price.product.name) || 'Item'),
                    price: li.price.unit_amount || 0,
                    quantity: li.quantity || 1,
                    image: null
                }));
        } catch (error) {
            console.warn(`${logPrefix} could not expand line_items: ${error.message}`);
        }

        const result = await prisma.$transaction(async (tx) => {
            const existing = await tx.order.findUnique({
                where: { stripeSessionId: session.id },
                include: { items: true }
            });

            const collectedShipping = session.shipping_details
                ? stripeAddressToJson(session.shipping_details)
                : null;

            const finalizedFields = {
                status: 'CONFIRMED',
                paymentStatus: 'PAID',
                totalAmount: session.amount_total || null,
                shippingFee: (session.shipping_cost && session.shipping_cost.amount_total) || 0,
                currency: (session.currency || 'INR').toUpperCase(),
                stripePaymentIntent: session.payment_intent || null,
                customerName: (session.customer_details && session.customer_details.name) || (existing && existing.customerName) || null,
                customerEmail: (session.customer_details && session.customer_details.email) || (existing && existing.customerEmail) || null,
                customerPhone: (session.customer_details && session.customer_details.phone) || (existing && existing.customerPhone) || null,
                shippingAddress: collectedShipping || (existing && existing.shippingAddress) || null
            };

            if (existing && existing.items && existing.items.length) {
                // Claim the order atomically: only one transaction may flip the
                // draft from UNPAID -> PAID, which makes concurrent webhook +
                // verify-payment calls safe. Stock is decremented only by the
                // transaction that wins the claim.
                const claimed = await tx.order.updateMany({
                    where: {
                        id: existing.id,
                        status: { not: 'CONFIRMED' },
                        paymentStatus: { not: 'PAID' }
                    },
                    data: { status: 'CONFIRMED', paymentStatus: 'PAID' }
                });

                if (claimed.count === 0) {
                    const current = await tx.order.findUnique({
                        where: { id: existing.id },
                        include: { items: true }
                    });
                    console.log(`${logPrefix} already finalized by another request (order ${existing.id}); stocked quantities untouched.`);
                    return { order: current, skipped: true };
                }

                await decrementStockForItems(tx, existing.items);
            }

            let order;

            if (existing) {
                order = await tx.order.update({
                    where: { id: existing.id },
                    data: finalizedFields,
                    include: { items: true }
                });
            } else {
                order = await tx.order.create({
                    data: {
                        ...finalizedFields,
                        orderNumber: generateOrderNumber(),
                        stripeSessionId: session.id,
                        items: { create: lineItems }
                    },
                    include: { items: true }
                });
            }

            console.log(
                `${logPrefix} saved: ${order.id} | status=${order.status} | ` +
                `payment_status=${order.paymentStatus} | total=${order.totalAmount} ${order.currency}`
            );

            return { order };
        });

        return result;
    } catch (error) {
        if (error instanceof StockShortageError) {
            const detail = error.details[0];
            console.warn(
                `${logPrefix} OUT OF STOCK: ${detail.name} has only ${detail.availableStock} ` +
                `available (requested ${detail.requested}). Order was NOT confirmed.`
            );
            return {
                error: 'OUT_OF_STOCK',
                message: stockShortageMessage(detail),
                availableStock: detail.availableStock,
                details: error.details
            };
        }

        console.error(`${logPrefix} failed to finalize order:`, error.message);
        return null;
    }
}

app.use(cors());

app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!secret) {
        console.warn('[Stripe][Webhook] STRIPE_WEBHOOK_SECRET is not set; event signature not verified.');
        return res.status(200).json({ received: true, verified: false });
    }

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (error) {
        console.error('[Stripe][Webhook] Signature verification failed:', error.message);
        return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object;
            console.log(
                `[Stripe][Webhook] checkout.session.completed: ${session.id} | ` +
                `payment_status=${session.payment_status} | status=${session.status} | ` +
                `payment_intent=${session.payment_intent} | amount_total=${session.amount_total} ${session.currency}`
            );
            finalizeStripeOrder(session);
            break;
        }
        default:
            console.log(`[Stripe][Webhook] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
});

app.use(express.json());

// Protect every /admin/* page (except login and static assets) — must run before express.static
app.use('/admin', adminAuth.requireAdminPage);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/admin', (req, res) => {
    res.redirect('/admin/dashboard.html');
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/products', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'products.html'));
});

app.get('/orders', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'orders.html'));
});

app.get('/checkout', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'checkout.html'));
});

app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const items = req.body.items;
        const { customerEmail, customerName, customerPhone } = req.body || {};
        const customerAddress = normalizeSavedAddress(req.body.shippingAddress);

        if (!items || items.length === 0) {
            return res.status(400).json({ error: 'Your cart is empty.' });
        }

        const outOfStock = await validateRequestedStock(items);
        if (outOfStock) {
            return res.status(400).json(outOfStock);
        }

        const lineItems = items.map(item => {
            const unitAmount = parsePriceToCents(item.price);

            return {
                price_data: {
                    currency: 'inr',
                    unit_amount: unitAmount,
                    product_data: {
                        name: item.name
                    }
                },
                quantity: item.qty
            };
        });

        // Prefill the Stripe checkout shipping form with the customer's saved
        // address (if provided). Failures here are non-fatal.
        let stripeCustomerId = null;

        if (customerEmail && customerAddress) {
            try {
                const allowedCountry = stripeAddressFromSaved(customerAddress);

                const customerData = {
                    email: String(customerEmail).trim().toLowerCase(),
                    name: customerName || null,
                    phone: customerPhone || null,
                    address: allowedCountry,
                    shipping: {
                        name: customerName || null,
                        phone: customerPhone || null,
                        address: allowedCountry
                    }
                };

                const customerList = await stripe.customers.list({ email: customerData.email, limit: 1 });

                if (customerList.data.length) {
                    await stripe.customers.update(customerList.data[0].id, customerData);
                    stripeCustomerId = customerList.data[0].id;
                } else {
                    const created = await stripe.customers.create(customerData);
                    stripeCustomerId = created.id;
                }
            } catch (error) {
                console.warn('[Stripe] Could not prefill customer address:', error.message);
            }
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            line_items: lineItems,
            customer: stripeCustomerId || undefined,
            customer_update: stripeCustomerId ? { name: 'auto', address: 'auto', shipping: 'auto' } : undefined,
            success_url: `${req.protocol}://${req.get('host')}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${req.protocol}://${req.get('host')}/`,
            shipping_address_collection: {
                allowed_countries: ['IN', 'SG', 'US', 'GB', 'AE', 'CA', 'AU']
            },
            metadata: {
                item_count: items.reduce((sum, item) => sum + item.qty, 0)
            }
        });

        console.log(
            `[Stripe] Checkout session created: ${session.id} | mode=${session.mode} | ` +
            `currency=${session.currency} | amount_total=${session.amount_total} | url=${session.url}`
        );

        const totalAmount = items.reduce((sum, item) => sum + (parsePriceToCents(item.price) * item.qty), 0);

        // Only link order items to products that actually exist in the catalog.
        const validProductIdMap = await resolveProductIds(items.map(item => item.id));

        try {
            const draft = await prisma.order.upsert({
                where: { stripeSessionId: session.id },
                update: {
                    customerEmail: customerEmail || null,
                    customerName: customerName || null,
                    customerPhone: customerPhone || null,
                    shippingAddress: customerAddress,
                    userId: req.body.userId || null,
                    totalAmount
                },
                create: {
                    orderNumber: generateOrderNumber(),
                    stripeSessionId: session.id,
                    userId: req.body.userId || null,
                    customerEmail: customerEmail || null,
                    customerName: customerName || null,
                    customerPhone: customerPhone || null,
                    shippingAddress: customerAddress,
                    currency: 'INR',
                    totalAmount,
                    status: 'PENDING',
                    paymentStatus: 'UNPAID',
                    items: {
                        create: items.map(item => ({
                            name: item.name,
                            price: parsePriceToCents(item.price),
                            quantity: item.qty,
                            image: item.image || null,
                            productId: validProductIdMap[item.id]
                        }))
                    }
                }
            });
            console.log(`[DB] Draft order saved for session ${session.id}: ${draft.id}`);
        } catch (error) {
            console.error(`[DB] Could not save draft order for session ${session.id}:`, error.message);
        }

        res.json({ id: session.id, url: session.url });
    } catch (error) {
        console.error('Stripe checkout error:', error.message);
        res.status(500).json({ error: 'Could not create checkout session.' });
    }
});

app.get('/api/verify-payment', async (req, res) => {
    const sessionId = req.query.session_id;

    if (!sessionId) {
        return res.status(400).json({ success: false, message: 'Missing session_id query parameter.' });
    }

    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        console.log(
            `[Stripe] Verify session ${session.id}: status=${session.status} | ` +
            `payment_status=${session.payment_status} | payment_intent=${session.payment_intent} | ` +
            `amount_total=${session.amount_total} ${session.currency}`
        );

        if (session.payment_status === 'paid' && session.status === 'complete') {
            const finalized = await finalizeStripeOrder(session);

            if (finalized && finalized.error === 'OUT_OF_STOCK') {
                return res.status(409).json({
                    success: false,
                    message: finalized.message,
                    availableStock: finalized.availableStock,
                    errors: finalized.details
                });
            }

            return res.json({
                success: true,
                message: 'Payment confirmed.',
                session_id: session.id,
                payment_status: session.payment_status,
                status: session.status,
                payment_intent: session.payment_intent,
                amount_total: session.amount_total,
                currency: session.currency,
                customer_email: session.customer_details && session.customer_details.email
            });
        }

        res.status(402).json({
            success: false,
            message: `Payment not confirmed. payment_status=${session.payment_status}, status=${session.status}`,
            session_id: session.id,
            payment_status: session.payment_status,
            status: session.status,
            payment_intent: session.payment_intent
        });
    } catch (error) {
        console.error('[Stripe] Session verification failed:', error.message);
        res.status(500).json({ success: false, message: 'Could not verify payment.', error: error.message });
    }
});

app.get('/api/db-test', async (req, res) => {
    try {
        const connection = await db.getConnection();
        const [rows] = await connection.query('SELECT NOW() AS now');
        connection.release();
        res.json({
            success: true,
            message: 'MySQL connection is working.',
            time: rows[0] && rows[0].now
        });
    } catch (error) {
        console.error('MySQL connection test failed:', error.message);
        res.status(500).json({
            success: false,
            message: 'MySQL connection failed.',
            error: error.message
        });
    }
});

// ======================= ORDERS API =======================

app.post('/api/orders', async (req, res) => {
    try {
        const { userId, customerEmail, customerName, customerPhone, shippingAddress, items } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Order must include at least one item.' });
        }

        const outOfStock = await validateRequestedStock(items);
        if (outOfStock) {
            return sendStockError(res, outOfStock);
        }

        const validProductIdMap = await resolveProductIds(items.map(item => item.id));

        const order = await prisma.$transaction(async (tx) => {
            const stockItems = items.map(item => ({
                productId: validProductIdMap[item.id],
                quantity: item.quantity || 1,
                name: item.name
            }));

            await decrementStockForItems(tx, stockItems);

            return tx.order.create({
                data: {
                    orderNumber: generateOrderNumber(),
                    userId: userId || null,
                    customerEmail: customerEmail || null,
                    customerName: customerName || null,
                    customerPhone: customerPhone || null,
                    shippingAddress: shippingAddress || null,
                    currency: 'INR',
                    totalAmount: items.reduce(
                        (sum, item) => sum + (parsePriceToCents(item.price) * (item.quantity || 1)),
                        0
                    ),
                    status: 'PENDING',
                    paymentStatus: 'UNPAID',
                    items: {
                        create: items.map(item => ({
                            name: item.name,
                            price: parsePriceToCents(item.price),
                            quantity: item.quantity || 1,
                            image: item.image || null,
                            productId: validProductIdMap[item.id]
                        }))
                    }
                },
                include: { items: true }
            });
        });

        res.status(201).json(order);
    } catch (error) {
        if (error instanceof StockShortageError) {
            return sendStockError(res, {
                success: false,
                message: stockShortageMessage(error.details[0]),
                availableStock: error.details[0].availableStock,
                productId: error.details[0].productId,
                errors: error.details
            });
        }
        handleDbError(res, error, 'Could not create order.');
    }
});

app.get('/api/orders', async (req, res) => {
    try {
        const { userId, email, status } = req.query;
        const where = {};

        if (userId) where.userId = userId;
        if (email) where.customerEmail = email;
        if (status) where.status = status;

        const orders = await prisma.order.findMany({
            where,
            include: {
                items: true,
                user: { select: { id: true, name: true, email: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(orders);
    } catch (error) {
        handleDbError(res, error, 'Could not fetch orders.');
    }
});

app.get('/api/orders/user/:userId', async (req, res) => {
    try {
        const orders = await prisma.order.findMany({
            where: { userId: req.params.userId },
            include: {
                items: true,
                user: { select: { id: true, name: true, email: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(orders);
    } catch (error) {
        handleDbError(res, error, 'Could not fetch user orders.');
    }
});

app.get('/api/orders/:id/timeline', async (req, res) => {
    try {
        const email = String(req.query.email || '').trim().toLowerCase();

        if (!email) {
            return res.status(400).json({ error: 'Email is required to view order tracking.' });
        }

        const order = await prisma.order.findUnique({
            where: { id: req.params.id },
            include: {
                items: true,
                statusHistory: { orderBy: { createdAt: 'asc' } },
                messages: {
                    orderBy: { createdAt: 'asc' },
                    include: { admin: { select: { id: true, name: true } } }
                }
            }
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found.' });
        }

        const orderEmail = String(order.customerEmail || '').trim().toLowerCase();

        if (!orderEmail || orderEmail !== email) {
            return res.status(403).json({ error: 'This order does not belong to the given email.' });
        }

        res.json({
            order: {
                id: order.id,
                orderNumber: order.orderNumber,
                status: order.status,
                paymentStatus: order.paymentStatus,
                totalAmount: order.totalAmount,
                shippingFee: order.shippingFee,
                currency: order.currency,
                customerName: order.customerName,
                customerEmail: order.customerEmail,
                customerPhone: order.customerPhone,
                shippingAddress: order.shippingAddress,
                cancellationReason: order.cancellationReason,
                stripePaymentIntent: order.stripePaymentIntent,
                createdAt: order.createdAt,
                updatedAt: order.updatedAt
            },
            items: order.items,
            statusHistory: order.statusHistory,
            messages: order.messages,
            latestMessage: order.messages.length ? order.messages[order.messages.length - 1] : null
        });
    } catch (error) {
        handleDbError(res, error, 'Could not load order tracking.');
    }
});

app.get('/api/orders/:id', async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.id },
            include: {
                items: true,
                user: { select: { id: true, name: true, email: true } }
            }
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found.' });
        }

        res.json(order);
    } catch (error) {
        handleDbError(res, error, 'Could not fetch order.');
    }
});

app.patch('/api/orders/:id/status', adminAuth.requireAdmin, async (req, res) => {
    try {
        const order = await applyOrderStatusUpdate(req.params.id, req.body, req.admin.sub);
        res.json(order);
    } catch (error) {
        handleStatusError(res, error);
    }
});

// ======================= PRODUCTS API (CUSTOMER-FACING) =======================

app.get('/api/products', async (req, res) => {
    try {
        const { category, search, limit } = req.query;
        const where = {};

        if (category && String(category).trim()) {
            where.category = String(category).trim();
        }

        if (search && String(search).trim()) {
            const term = String(search).trim();
            where.OR = [
                { name: { contains: term, mode: 'insensitive' } },
                { description: { contains: term, mode: 'insensitive' } },
                { category: { contains: term, mode: 'insensitive' } }
            ];
        }

        const parsedLimit = parseInt(limit, 10);

        const products = await prisma.product.findMany({
            where,
            orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
            take: Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : undefined
        });

        res.json({ products });
    } catch (error) {
        handleDbError(res, error, 'Could not fetch products.');
    }
});

app.get('/api/products/:id', async (req, res) => {
    try {
        const product = await prisma.product.findFirst({
            where: { OR: [{ id: req.params.id }, { slug: req.params.id }] }
        });

        if (!product) {
            return res.status(404).json({ error: 'Product not found.' });
        }

        res.json({ product });
    } catch (error) {
        handleDbError(res, error, 'Could not fetch product.');
    }
});

// ======================= ADMIN AUTH =======================

app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const admin = await prisma.admin.findUnique({
            where: { email: String(email).trim().toLowerCase() }
        });

        if (!admin) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const match = await bcrypt.compare(String(password), admin.passwordHash);

        if (!match) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const token = adminAuth.signAdminToken(admin);
        adminAuth.setAdminCookie(res, token);

        res.json({
            success: true,
            admin: { id: admin.id, name: admin.name, email: admin.email }
        });
    } catch (error) {
        console.error('[Admin] Login failed:', error.message);
        res.status(500).json({ error: 'Could not sign in.' });
    }
});

app.post('/api/admin/logout', adminAuth.requireAdmin, (req, res) => {
    adminAuth.clearAdminCookie(res);
    res.json({ success: true });
});

app.get('/api/admin/me', adminAuth.requireAdmin, (req, res) => {
    res.json({ success: true, admin: req.admin });
});

// ======================= ADMIN DASHBOARD =======================

app.get('/api/admin/dashboard/stats', adminAuth.requireAdmin, async (req, res) => {
    try {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const startOfTomorrow = new Date(startOfToday);
        startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

        const [totalOrders, paidSum, recentOrders, totalsByStatus, todayAgg] = await Promise.all([
            prisma.order.count(),
            prisma.order.aggregate({ _sum: { totalAmount: true }, where: { paymentStatus: 'PAID' } }),
            prisma.order.findMany({
                orderBy: { createdAt: 'desc' },
                take: 6,
                select: {
                    id: true,
                    orderNumber: true,
                    customerName: true,
                    customerEmail: true,
                    totalAmount: true,
                    shippingFee: true,
                    currency: true,
                    status: true,
                    paymentStatus: true,
                    createdAt: true,
                    items: { select: { name: true, quantity: true, price: true, image: true } }
                }
            }),
            prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
            prisma.order.aggregate({
                _count: { _all: true },
                _sum: { totalAmount: true },
                where: {
                    createdAt: { gte: startOfToday, lt: startOfTomorrow },
                    paymentStatus: 'PAID'
                }
            })
        ]);

        const countsByStatus = {};
        totalsByStatus.forEach(row => {
            countsByStatus[row.status] = row._count._all;
        });

        res.json({
            totalOrders,
            pendingOrders: countsByStatus.PENDING || 0,
            confirmedOrders: countsByStatus.CONFIRMED || 0,
            processingOrders: countsByStatus.PROCESSING || 0,
            shippedOrders: countsByStatus.SHIPPED || 0,
            deliveredOrders: countsByStatus.DELIVERED || 0,
            cancelledOrders: countsByStatus.CANCELLED || 0,
            totalRevenuePaise: paidSum._sum.totalAmount || 0,
            todayOrders: todayAgg._count._all || 0,
            todayRevenuePaise: todayAgg._sum.totalAmount || 0,
            recentOrders
        });
    } catch (error) {
        handleDbError(res, error, 'Could not fetch dashboard statistics.');
    }
});

// ======================= ADMIN ORDERS =======================

app.get('/api/admin/orders', adminAuth.requireAdmin, async (req, res) => {
    try {
        const { search, status, paymentStatus, sort, dateFrom, dateTo } = req.query;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));

        const where = {};

        if (status && status !== 'ALL') {
            if (!ALLOWED_ORDER_STATUS.includes(status)) {
                return res.status(400).json({ error: `Invalid status filter. Allowed: ${ALLOWED_ORDER_STATUS.join(', ')}` });
            }
            where.status = status;
        }

        if (paymentStatus && paymentStatus !== 'ALL') {
            if (!ALLOWED_PAYMENT_STATUS.includes(paymentStatus)) {
                return res.status(400).json({ error: `Invalid paymentStatus filter. Allowed: ${ALLOWED_PAYMENT_STATUS.join(', ')}` });
            }
            where.paymentStatus = paymentStatus;
        }

        if (search && String(search).trim()) {
            const term = String(search).trim();
            where.OR = [
                { orderNumber: { contains: term } },
                { customerEmail: { contains: term, mode: 'insensitive' } },
                { customerName: { contains: term, mode: 'insensitive' } },
                { customerPhone: { contains: term } },
                { stripeSessionId: { contains: term } }
            ];
        }

        if (dateFrom || dateTo) {
            where.createdAt = {};
            if (dateFrom) where.createdAt.gte = new Date(dateFrom);
            if (dateTo) where.createdAt.lte = new Date(dateTo);
        }

        const orderBy = sort === 'oldest'
            ? { createdAt: 'asc' }
            : { createdAt: 'desc' };

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                include: {
                    items: true,
                    user: { select: { id: true, name: true, email: true } }
                },
                orderBy,
                skip: (page - 1) * pageSize,
                take: pageSize
            }),
            prisma.order.count({ where })
        ]);

        res.json({
            orders,
            pagination: {
                page,
                pageSize,
                total,
                totalPages: Math.ceil(total / pageSize)
            }
        });
    } catch (error) {
        handleDbError(res, error, 'Could not fetch admin orders.');
    }
});

app.get('/api/admin/orders/:id', adminAuth.requireAdmin, async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.id },
            include: {
                items: true,
                user: { select: { id: true, name: true, email: true } },
                statusHistory: { orderBy: { createdAt: 'asc' } },
                messages: {
                    orderBy: { createdAt: 'asc' },
                    include: { admin: { select: { id: true, name: true, email: true } } }
                }
            }
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found.' });
        }

        res.json(order);
    } catch (error) {
        handleDbError(res, error, 'Could not fetch order.');
    }
});

app.patch('/api/admin/orders/:id/status', adminAuth.requireAdmin, async (req, res) => {
    try {
        const order = await applyOrderStatusUpdate(req.params.id, req.body, req.admin.sub);
        res.json(order);
    } catch (error) {
        handleStatusError(res, error);
    }
});

app.post('/api/admin/orders/:id/messages', adminAuth.requireAdmin, async (req, res) => {
    try {
        const { message } = req.body || {};
        const text = typeof message === 'string' ? message.trim() : '';

        if (!text) {
            return res.status(400).json({ error: 'Message cannot be empty.' });
        }

        const order = await prisma.order.findUnique({ where: { id: req.params.id } });

        if (!order) {
            return res.status(404).json({ error: 'Order not found.' });
        }

        const created = await prisma.orderMessage.create({
            data: {
                orderId: order.id,
                adminId: req.admin.sub,
                message: text
            },
            include: { admin: { select: { id: true, name: true } } }
        });

        res.status(201).json(created);
    } catch (error) {
        handleDbError(res, error, 'Could not send message.');
    }
});

// ======================= ADMIN PRODUCTS =======================

app.get('/api/admin/products', adminAuth.requireAdmin, async (req, res) => {
    try {
        const { search, category } = req.query;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));

        const where = {};

        if (category && String(category).trim()) {
            where.category = String(category).trim();
        }

        if (search && String(search).trim()) {
            const term = String(search).trim();
            where.OR = [
                { name: { contains: term, mode: 'insensitive' } },
                { description: { contains: term, mode: 'insensitive' } },
                { category: { contains: term, mode: 'insensitive' } }
            ];
        }

        const [products, total] = await Promise.all([
            prisma.product.findMany({
                where,
                orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
                skip: (page - 1) * pageSize,
                take: pageSize
            }),
            prisma.product.count({ where })
        ]);

        res.json({
            products,
            pagination: {
                page,
                pageSize,
                total,
                totalPages: Math.ceil(total / pageSize)
            }
        });
    } catch (error) {
        handleDbError(res, error, 'Could not fetch admin products.');
    }
});

app.get('/api/admin/products/images', adminAuth.requireAdmin, async (req, res) => {
    try {
        const dir = path.join(__dirname, 'public', 'images');
        const names = fs.existsSync(dir)
            ? fs.readdirSync(dir).filter(file => /\.(png|jpe?g|gif|webp|svg)$/i.test(file))
            : [];

        res.json({ images: names.map(name => `images/${name}`) });
    } catch (error) {
        console.error('[Admin] Could not list product images:', error.message);
        res.status(500).json({ error: 'Could not list product images.' });
    }
});

// Upload a new product image into the existing public images directory.
// The raw PNG/JPG/WEBP bytes are validated (magic bytes + size), written with
// a unique filename, and only the relative path is stored in the database —
// no binary data is ever persisted in MySQL.
app.post(
    '/api/admin/products/images/upload',
    adminAuth.requireAdmin,
    express.raw({ type: () => true, limit: Math.ceil(IMAGE_MAX_BYTES * 1.2) }),
    async (req, res) => {
        try {
            const buffer = req.body;

            if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
                return res.status(400).json({ success: false, error: 'No image data received.' });
            }

            if (buffer.length > IMAGE_MAX_BYTES) {
                return res.status(413).json({ success: false, error: 'Image file is too large. Maximum size is 5 MB.' });
            }

            const ext = sniffImageExt(buffer);
            if (!ext) {
                return res.status(400).json({ success: false, error: 'Invalid image. Only PNG, JPG, or WEBP images are allowed.' });
            }

            const imagesDir = path.join(__dirname, 'public', 'images');
            const filename = `product_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;

            if (!fs.existsSync(imagesDir)) {
                fs.mkdirSync(imagesDir, { recursive: true });
            }

            await fs.promises.writeFile(path.join(imagesDir, filename), buffer);

            console.log(`[Admin] Uploaded product image: ${filename} (${buffer.length} bytes)`);
            res.status(201).json({
                success: true,
                image: `images/${filename}`,
                name: filename,
                size: buffer.length
            });
        } catch (error) {
            console.error('[Admin] Could not upload product image:', error.message);
            res.status(500).json({ success: false, error: 'Could not upload the image. Please try again.' });
        }
    }
);

app.post('/api/admin/products', adminAuth.requireAdmin, async (req, res) => {
    try {
        const validated = sanitizeProductInput(req.body);

        if (validated.error) {
            return res.status(400).json({ error: validated.error });
        }

        const slug = await uniqueProductSlug(validated.data.name);

        const product = await prisma.product.create({
            data: { ...validated.data, slug }
        });

        res.status(201).json({ product });
    } catch (error) {
        handleDbError(res, error, 'Could not create product.');
    }
});

app.patch('/api/admin/products/:id', adminAuth.requireAdmin, async (req, res) => {
    try {
        const existing = await prisma.product.findUnique({ where: { id: req.params.id } });

        if (!existing) {
            return res.status(404).json({ error: 'Product not found.' });
        }

        const validated = sanitizeProductInput(req.body);

        if (validated.error) {
            return res.status(400).json({ error: validated.error });
        }

        const product = await prisma.product.update({
            where: { id: existing.id },
            data: validated.data
        });

        res.json({ product });
    } catch (error) {
        handleDbError(res, error, 'Could not update product.');
    }
});

app.delete('/api/admin/products/:id', adminAuth.requireAdmin, async (req, res) => {
    try {
        const existing = await prisma.product.findUnique({ where: { id: req.params.id } });

        if (!existing) {
            return res.status(404).json({ error: 'Product not found.' });
        }

        const linkedOrderItems = await prisma.orderItem.count({ where: { productId: existing.id } });

        /*
          Existing orders are never lost: OrderItem keeps a snapshot of the
          product (name, price, quantity, image) and its productId foreign key
          is ON DELETE SET NULL. Deleting a product therefore only unlinks the
          historical order rows; history stays fully intact.
        */
        await prisma.product.delete({ where: { id: existing.id } });

        // Image cleanup is conservative: the file is removed only when nothing
        // else references it (no other product and no historical order item).
        let imageDeleted = false;
        let imageCleanupMessage = null;
        const image = typeof existing.image === 'string' ? existing.image : null;

        if (image && (image.startsWith('images/') || image.startsWith('/images/'))) {
            const fullPath = path.join(__dirname, 'public', 'images', path.basename(image));

            if (fs.existsSync(fullPath)) {
                const [otherProducts, referencingOrderItems] = await Promise.all([
                    prisma.product.count({ where: { image, id: { not: existing.id } } }),
                    prisma.orderItem.count({ where: { image } })
                ]);

                if (otherProducts === 0 && referencingOrderItems === 0) {
                    fs.unlinkSync(fullPath);
                    imageDeleted = true;
                } else {
                    imageCleanupMessage =
                        `Image file kept because it is still referenced by ${otherProducts} other product(s) ` +
                        `and ${referencingOrderItems} past order item(s).`;
                }
            }
        }

        res.json({
            success: true,
            deleted: existing.id,
            linkedOrderItems,
            imageDeleted,
            imageCleanupMessage,
            message: linkedOrderItems > 0
                ? `Product deleted. It was referenced by ${linkedOrderItems} past order item(s); those orders are preserved with their saved product details.`
                : 'Product deleted successfully.'
        });
    } catch (error) {
        handleDbError(res, error, 'Could not delete product.');
    }
});

// ======================= CUSTOMER PROFILE (saved checkout address) =======================

app.post('/api/customers', async (req, res) => {
    try {
        const email = String((req.body || {}).email || '').trim().toLowerCase();

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'A valid email is required.' });
        }

        const name = String(req.body.name || '').trim() || null;
        const phone = String(req.body.phone || '').trim() || null;
        const shippingAddress = normalizeSavedAddress(req.body.shippingAddress);

        const customer = await prisma.user.upsert({
            where: { email },
            update: {
                name: name || undefined,
                phone: phone || undefined,
                shippingAddress: shippingAddress || undefined
            },
            create: {
                email,
                name,
                phone,
                shippingAddress
            }
        });

        res.json({
            customer: {
                id: customer.id,
                email: customer.email,
                name: customer.name,
                phone: customer.phone,
                shippingAddress: customer.shippingAddress
            }
        });
    } catch (error) {
        handleDbError(res, error, 'Could not save your information.');
    }
});

app.get('/api/customers/:email', async (req, res) => {
    try {
        const email = String(req.params.email || '').trim().toLowerCase();

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'A valid email is required.' });
        }

        const customer = await prisma.user.findUnique({ where: { email } });

        if (!customer) {
            return res.json({ customer: null });
        }

        res.json({
            customer: {
                id: customer.id,
                email: customer.email,
                name: customer.name,
                phone: customer.phone,
                shippingAddress: customer.shippingAddress
            }
        });
    } catch (error) {
        handleDbError(res, error, 'Could not load your information.');
    }
});

app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API route not found.' });
});

// JSON error responses for body-parser failures (oversized image uploads, etc.)
app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
        return res.status(413).json({ success: false, error: 'Image file is too large. Maximum size is 5 MB.' });
    }
    if (err && err.type === 'entity.parse.failed') {
        return res.status(400).json({ success: false, error: 'Could not parse the request body.' });
    }
    next(err);
});

app.get('/success', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

const stripeVersion = require('./node_modules/stripe/package.json').version;
const stripeKeyMode = (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_') ? 'LIVE MODE - REAL CHARGES!' : 'TEST (sandbox) mode';

app.listen(PORT, () => {
    console.log(`RARE HABIT server running at http://localhost:${PORT}`);
    console.log(`[Stripe] SDK v${stripeVersion} | key: ${stripeKeyMode}`);

    stripe.balance.retrieve()
        .then(bal => {
            const entries = [...bal.available, ...bal.pending];
            const summary = entries.length
                ? entries.map(e => `${(e.amount / 100).toFixed(2)} ${e.currency.toUpperCase()}`).join(', ')
                : 'no balances yet';
            console.log(`[Stripe] current balance: ${summary}`);
        })
        .catch(err => console.warn(`[Stripe] Could not fetch balance: ${err.message}`));

    stripe.account.retrieve()
        .then(account => console.log(`[Stripe] account: ${account.id} | country=${account.country} | default currency=${account.default_currency}`))
        .catch(err => console.warn(`[Stripe] Could not fetch account: ${err.message}`));
});