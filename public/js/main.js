/* ============================================
   SANDRO. Streetwear E-Commerce
   Main JavaScript
   ============================================ */

// ==================== CART STATE ====================

let cartItems = [];

// Live "source of truth" stock map, refreshed from /api/products. Used to cap
// cart quantities and show availability on the product cards and cart.
const LOW_STOCK_THRESHOLD = 5;
let productCatalog = {};

// ==================== DOM ELEMENTS ====================

const cartPanel = document.getElementById('cart-panel');
const cartOverlay = document.getElementById('cart-overlay');
const cartIcon = document.getElementById('cart-icon');
const cartClose = document.getElementById('cart-close');
const cartItemsContainer = document.getElementById('cart-items');
const cartCount = document.getElementById('cart-count');
const totalPrice = document.getElementById('total-price');
const cartEmpty = document.getElementById('cart-empty');
const hamburger = document.getElementById('hamburger');
const mainNav = document.getElementById('main-nav');

// ==================== CART FUNCTIONS ====================

function itemKey(item) {
    return item.id ? 'id:' + item.id : 'name:' + item.name;
}

function addToCart(productCard) {
    // Prefer structured data attributes (database-driven cards); fall back to
    // reading the text from the DOM (legacy/static cards).
    const id = productCard.dataset.id || null;
    const name = productCard.dataset.name || productCard.querySelector('.product-name').textContent;
    const price = (productCard.dataset.price !== undefined && productCard.dataset.price !== '')
        ? productCard.dataset.price
        : productCard.querySelector('.product-price').textContent;
    const image = productCard.dataset.image || productCard.querySelector('.product-image').src;
    let stock = null;

    if (productCard.dataset.stock !== undefined && productCard.dataset.stock !== '') {
        stock = Number(productCard.dataset.stock);
    }

    // Never allow adding an out-of-stock product.
    if (stock !== null && stock <= 0) return;

    const key = itemKey({ id: id, name: name });

    // Check if item already exists
    const existingItem = cartItems.find(item => itemKey(item) === key);

    if (existingItem) {
        if (stock !== null && existingItem.qty >= stock) {
            alert(`Only ${stock} items are available.`);
            return;
        }
        existingItem.qty += 1;
    } else {
        cartItems.push({
            id: id || null,
            name: name,
            price: price,
            image: image,
            qty: 1
        });
    }

    // Flying animation
    flyToCart(productCard);

    // Update display
    updateCartDisplay();
    updateLocalStorage();

    // Pulse the cart icon
    cartIcon.style.transform = 'scale(1.2)';

    setTimeout(() => {
        cartIcon.style.transform = 'scale(1)';
    }, 300);
}

function removeItem(key) {
    cartItems = cartItems.filter(item => itemKey(item) !== key);
    updateCartDisplay();
    updateLocalStorage();
}

function stockForItem(item) {
    if (!item || !item.id) return null;
    const product = productCatalog[item.id];
    return product ? Number(product.stock) : null;
}

function changeQuantity(key, delta) {
    const item = cartItems.find(item => itemKey(item) === key);

    if (item) {
        if (delta > 0) {
            const stock = stockForItem(item);
            if (stock !== null && item.qty >= stock) {
                alert(`Only ${stock} items are available.`);
                return;
            }
        }

        item.qty += delta;

        if (item.qty <= 0) {
            removeItem(key);
            return;
        }
    }

    updateCartDisplay();
    updateLocalStorage();
}

function parsePrice(priceStr) {
    return parseFloat(priceStr.replace(/[^0-9.]/g, ''));
}

function updateCartDisplay() {
    // Update badge count
    const totalItems = cartItems.reduce((sum, item) => sum + item.qty, 0);
    cartCount.textContent = totalItems;

    // Animate badge
    if (totalItems > 0) {
        cartCount.style.transform = 'scale(1.3)';

        setTimeout(() => {
            cartCount.style.transform = 'scale(1)';
        }, 200);
    }

    // Render cart items
    if (cartItems.length === 0) {
        cartItemsContainer.innerHTML = `
            <div class="cart-empty" id="cart-empty">
                <i class="ri-shopping-bag-line"></i>
                <p>Your cart is empty</p>
            </div>
        `;

        totalPrice.textContent = '₹0';
        return;
    }

    let html = '';
    let total = 0;

    cartItems.forEach(item => {
        const itemPrice = parsePrice(item.price);
        let quantity = item.qty;
        const stock = stockForItem(item);
        const key = itemKey(item).replace(/'/g, "\\'");

        let note = '';
        let plusDisabled = '';

        if (stock !== null) {
            if (stock <= 0) {
                note = '<div class="cart-item-note cart-item-note-out">Out of stock — remove to continue</div>';
                plusDisabled = ' disabled';
            } else if (quantity > stock) {
                quantity = stock;
                item.qty = stock;
                updateLocalStorage();
                note = `<div class="cart-item-note">Only ${stock} items are available.</div>`;
                plusDisabled = quantity >= stock ? ' disabled' : '';
            } else if (quantity === stock) {
                note = `<div class="cart-item-note">Only ${stock} available.</div>`;
                plusDisabled = ' disabled';
            }
        }

        const itemTotal = itemPrice * quantity;

        total += itemTotal;

        html += `
            <div class="cart-item">
                <div class="cart-item-image">
                    <img src="${item.image}" alt="${item.name}">
                </div>

                <div class="cart-item-details">
                    <p class="cart-item-name">${item.name}</p>
                    <p class="cart-item-price">${item.price} × ${quantity}</p>

                    <div class="cart-item-controls">
                        <button class="qty-btn" onclick="changeQuantity('${key}', -1)">−</button>

                        <span class="cart-item-qty">${quantity}</span>

                        <button class="qty-btn"${plusDisabled} onclick="changeQuantity('${key}', 1)">+</button>
                    </div>

                    ${note}
                </div>

                <button class="delete-btn" onclick="removeItem('${key}')">
                    <i class="ri-delete-bin-line"></i>
                </button>
            </div>
        `;
    });

    cartItemsContainer.innerHTML = html;

    totalPrice.textContent = `₹${total.toFixed(0)}`;
}

function updateLocalStorage() {
    localStorage.setItem('sandro-cart', JSON.stringify(cartItems));
}

// ==================== FLYING ANIMATION ====================

function flyToCart(productCard) {
    const productImage = productCard.querySelector('.product-image');
    const cartIconEl = document.getElementById('cart-icon');

    if (!productImage || !cartIconEl) return;

    // Get positions
    const imgRect = productImage.getBoundingClientRect();
    const cartRect = cartIconEl.getBoundingClientRect();

    // Create flying clone
    const flyingImg = productImage.cloneNode(true);

    flyingImg.classList.add('flying-img');
    flyingImg.style.position = 'fixed';
    flyingImg.style.top = imgRect.top + 'px';
    flyingImg.style.left = imgRect.left + 'px';
    flyingImg.style.width = imgRect.width + 'px';
    flyingImg.style.height = imgRect.height + 'px';
    flyingImg.style.zIndex = '9999';
    flyingImg.style.pointerEvents = 'none';
    flyingImg.style.borderRadius = '12px';
    flyingImg.style.transition = 'all 1.2s cubic-bezier(0.19, 1, 0.22, 1)';
    flyingImg.style.boxShadow = '0 10px 30px rgba(0,0,0,0.3)';

    document.body.appendChild(flyingImg);

    // Trigger animation after a frame
    requestAnimationFrame(() => {
        flyingImg.style.top = cartRect.top + cartRect.height / 2 + 'px';
        flyingImg.style.left = cartRect.left + cartRect.width / 2 + 'px';
        flyingImg.style.width = '0px';
        flyingImg.style.height = '0px';
        flyingImg.style.opacity = '0';
        flyingImg.style.transform = 'scale(0.5)';
    });

    // Remove after animation
    setTimeout(() => {
        flyingImg.remove();
    }, 1200);
}

// ==================== CART PANEL TOGGLE ====================

function openCart() {
    refreshCatalog();
    cartPanel.classList.add('open-cart');
    cartOverlay.classList.add('open-cart');
    document.body.style.overflow = 'hidden';
}

function closeCart() {
    cartPanel.classList.remove('open-cart');
    cartOverlay.classList.remove('open-cart');
    document.body.style.overflow = '';
}

cartIcon.addEventListener('click', openCart);
cartClose.addEventListener('click', closeCart);
cartOverlay.addEventListener('click', closeCart);

// ==================== STRIPE CHECKOUT ====================

// Express/Stripe API origin. The frontend may be served from a different
// origin (e.g. VS Code Live Server on 5501), so always call the API explicitly.
const API_BASE_URL = 'http://127.0.0.1:3000';

// ==================== PRODUCTS FROM DATABASE ====================

// Populates any `.products-grid#store-grid` container (home + shop pages)
// from the public products API instead of a hardcoded list.

function escapeHtmlAttr(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatRupees(paise) {
    const rupees = (Number(paise) || 0) / 100;
    const formatted = rupees.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return formatted.endsWith('.00') ? formatted.slice(0, -3) : formatted;
}

function productCardHtml(product) {
    const image = product.image ? escapeHtmlAttr(product.image) : '';
    const name = escapeHtmlAttr(product.name);
    const priceRupees = formatRupees(product.price);
    const priceData = (Number(product.price) || 0) / 100;
    const stock = Number(product.stock) || 0;

    let stockTag = '';
    let cartBar = '<div class="add-to-cart-bar" onclick="addToCart(this.closest(\'.product-card\'))">ADD TO CART</div>';

    if (stock <= 0) {
        stockTag = '<span class="stock-tag stock-tag-out">Out of Stock</span>';
        cartBar = '<div class="add-to-cart-bar is-disabled">Out of Stock</div>';
    } else if (stock <= LOW_STOCK_THRESHOLD) {
        stockTag = `<span class="stock-tag stock-tag-low">Only ${stock} left</span>`;
    }

    return `
        <div class="product-card" data-id="${escapeHtmlAttr(product.id)}" data-name="${name}" data-price="${priceData}" data-image="${image}" data-stock="${stock}">
            <div class="product-image-wrapper">
                ${stockTag}
                <img class="product-image" src="${image}" alt="${name}" loading="lazy">
                ${cartBar}
            </div>
            <div class="product-info">
                <p class="product-name">${name}</p>
                <p class="product-price">&#8377;${priceRupees}</p>
            </div>
        </div>
    `;
}

function buildCatalog(products) {
    productCatalog = {};
    (products || []).forEach(product => {
        productCatalog[product.id] = product;
    });
}

function syncCartWithStock() {
    let changed = false;

    cartItems.forEach(item => {
        const stock = stockForItem(item);
        if (stock === null) return;
        if (stock > 0 && item.qty > stock) {
            item.qty = stock;
            changed = true;
        }
    });

    if (changed) updateLocalStorage();
    updateCartDisplay();
}

// Fetches the live catalog so the cart always reflects the latest stock.
async function refreshCatalog() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/products`);
        const data = await response.json();
        buildCatalog((data && data.products) || []);
        syncCartWithStock();
    } catch (e) {
        // Keep the most recent catalog on failure; stock caps still apply.
    }
}

function renderStoreGrid(products) {
    const grid = document.getElementById('store-grid');
    if (!grid) return;

    grid.innerHTML = (products || []).map(productCardHtml).join('');
}

function renderStoreEmpty() {
    const grid = document.getElementById('store-grid');
    if (!grid) return;
    grid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:48px 20px;color:#8b94a8;">
            <i class="ri-shopping-bag-3-line" style="font-size:32px;display:block;margin-bottom:10px;"></i>
            No products are available right now.
        </div>
    `;
}

function loadStoreProducts() {
    fetch(`${API_BASE_URL}/api/products`)
        .then(res => {
            if (!res.ok) throw new Error('Network error');
            return res.json();
        })
        .then(data => {
            const products = (data && data.products) || [];
            buildCatalog(products);
            if (products.length) {
                renderStoreGrid(products);
            } else {
                renderStoreEmpty();
            }
            syncCartWithStock();
        })
        .catch(() => {
            renderStoreEmpty();
        });
}

// The cart "CHECKOUT" button now opens the dedicated checkout page where the
// customer confirms delivery details before being forwarded to Stripe.
function handleCheckout() {
    if (cartItems.length === 0) {
        alert('Your cart is empty. Add some items before checking out.');
        return;
    }

    window.location.href = 'checkout.html';
}

document.getElementById('checkout-btn').addEventListener('click', handleCheckout);

// Close on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeCart();
    }
});

// ==================== MOBILE MENU ====================

hamburger.addEventListener('click', () => {
    mainNav.classList.toggle('nav-active');

    // Animate hamburger
    const spans = hamburger.querySelectorAll('span');

    if (mainNav.classList.contains('nav-active')) {
        spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
        spans[1].style.opacity = '0';
        spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
    } else {
        spans[0].style.transform = 'none';
        spans[1].style.opacity = '1';
        spans[2].style.transform = 'none';
    }
});

// Close mobile menu when clicking a link
mainNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
        mainNav.classList.remove('nav-active');

        const spans = hamburger.querySelectorAll('span');

        spans[0].style.transform = 'none';
        spans[1].style.opacity = '1';
        spans[2].style.transform = 'none';
    });
});

// ==================== INITIALIZE ====================

window.onload = function () {
    // Restore cart from localStorage
    const storedCart = localStorage.getItem('sandro-cart');

    if (storedCart) {
        try {
            cartItems = JSON.parse(storedCart);
            updateCartDisplay();
        } catch (e) {
            cartItems = [];
        }
    }

    // Load the product catalog from the database on home + shop pages.
    loadStoreProducts();
};