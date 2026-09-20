/* ============================================
   RARE HABIT Admin UI — login, dashboard, orders, order details
   Talks only to the EXISTING backend admin APIs plus the
   admin-only order management endpoints.
   ============================================ */

(function () {
    'use strict';

    var CURRENCY = 'INR';

    var LOW_STOCK_THRESHOLD = 5;
    var IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
    var ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
    var ALLOWED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

    var ALLOWED_STATUS = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];

    var STATUS_LABELS = {
        PENDING: 'Pending',
        CONFIRMED: 'Confirmed',
        PROCESSING: 'Processing',
        SHIPPED: 'Shipped',
        OUT_FOR_DELIVERY: 'Out for Delivery',
        DELIVERED: 'Delivered',
        CANCELLED: 'Cancelled'
    };

    var BADGE_STATUSES = {
        PENDING: 'PENDING',
        CONFIRMED: 'CONFIRMED',
        PROCESSING: 'PROCESSING',
        SHIPPED: 'SHIPPED',
        OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
        DELIVERED: 'DELIVERED',
        CANCELLED: 'CANCELLED'
    };

    var BADGE_PAYMENTS = {
        UNPAID: 'UNPAID',
        PAID: 'PAID',
        REFUNDED: 'REFUNDED',
        FAILED: 'FAILED'
    };

    function formatCurrency(paise) {
        var amount = Number(paise) || 0;
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: CURRENCY,
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount / 100);
    }

    function formatDate(value) {
        if (!value) return '-';

        var d = new Date(value);

        if (isNaN(d.getTime())) return value;

        return d.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        }) + ' ' + d.toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit'
        });
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

    function statusLabel(status) {
        return STATUS_LABELS[status] || escapeHtml(status || '-');
    }

    function statusBadge(status) {
        var safe = BADGE_STATUSES[status] ? status : 'PENDING';
        return '<span class="badge badge-' + safe + '">' + escapeHtml(status || '-') + '</span>';
    }

    function paymentBadge(paymentStatus) {
        var safe = BADGE_PAYMENTS[paymentStatus] ? paymentStatus : 'UNPAID';
        return '<span class="badge badge-' + safe + '">' + escapeHtml(paymentStatus || '-') + '</span>';
    }

    function formatAddress(addr) {
        if (!addr || typeof addr !== 'object') return 'Not provided';

        var lines = [
            addr.name,
            addr.phone,
            addr.email,
            addr.line1,
            addr.line2,
            addr.area,
            [addr.city, addr.area ? null : ''].filter(Boolean).join(''),
            addr.district,
            addr.state,
            addr.pincode || addr.postal_code,
            addr.country
        ].filter(function (v) { return v !== null && v !== undefined && String(v).trim() !== ''; });

        return lines.length ? lines.join(', ') : 'Not provided';
    }

    function formatAddressHtml(addr) {
        if (!addr || typeof addr !== 'object') {
            return '<div class="empty-state">No delivery address recorded.</div>';
        }

        var keys = [
            ['name', 'Name'],
            ['phone', 'Phone'],
            ['email', 'Email'],
            ['line1', 'Address line 1'],
            ['line2', 'Address line 2'],
            ['area', 'Area'],
            ['city', 'City'],
            ['district', 'District'],
            ['state', 'State'],
            ['pincode', 'Pincode'],
            ['postal_code', 'Postal code'],
            ['country', 'Country']
        ];

        var html = '';

        keys.forEach(function (pair) {
            var value = addr[pair[0]];
            if (value === null || value === undefined || String(value).trim() === '') return;
            html += '<div class="info-row"><span class="info-label">' + pair[1] + '</span><span class="info-value">' + escapeHtml(value) + '</span></div>';
        });

        return html || '<div class="empty-state">No delivery address recorded.</div>';
    }

    function apiRequest(url, options) {
        var opts = options || {};
        var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };

        if (opts.body) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(opts.body);
        }

        if (opts.headers) {
            Object.assign(init.headers, opts.headers);
        }

        return fetch(url, init).then(function (res) {
            return res.json().then(function (data) {
                return { ok: res.ok, status: res.status, data: data };
            }).catch(function () {
                return { ok: res.ok, status: res.status, data: {} };
            });
        });
    }

    function parseApiError(res) {
        var error = res && res.data && res.data.error;
        if (typeof error === 'string' && error) return error;
        return 'Something went wrong. Please try again.';
    }

    function getInitials(name) {
        if (!name) return 'A';
        var parts = String(name).trim().split(/\s+/).filter(Boolean);
        if (parts.length === 0) return 'A';
        return parts.slice(0, 2).map(function (p) { return p[0].toUpperCase(); }).join('');
    }

    /* ============================================
       SHARED SHELL (sidebar, admin identity, logout)
       ============================================ */

    function initShell() {
        var logoutBtn = document.getElementById('logoutBtn');
        var sidebar = document.getElementById('sidebar');
        var sidebarBackdrop = document.getElementById('sidebarBackdrop');
        var sidebarToggle = document.getElementById('sidebarToggle');
        var adminNameEl = document.getElementById('adminName');
        var adminAvatar = document.getElementById('adminAvatar');
        var adminRole = document.getElementById('adminRole');
        var todayLabel = document.getElementById('todayLabel');

        if (todayLabel) {
            todayLabel.textContent = new Date().toLocaleDateString('en-IN', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });
        }

        function setAdminInfo(admin) {
            if (!admin) return;
            var name = admin.name || admin.email || 'Administrator';
            var role = (admin.role === 'ADMIN') ? 'Admin' : 'Staff';
            if (adminNameEl) adminNameEl.textContent = name;
            if (adminAvatar) adminAvatar.textContent = getInitials(name);
            if (adminRole) adminRole.textContent = role;
        }

        function redirectToLogin() {
            window.location.href = '/admin/login.html';
        }

        function loadAdmin() {
            return apiRequest('/api/admin/me').then(function (res) {
                if (res.ok) {
                    setAdminInfo(res.data.admin);
                    return res.data.admin;
                }
                if (res.status === 401) {
                    redirectToLogin();
                    return null;
                }
                throw new Error(parseApiError(res));
            });
        }

        if (logoutBtn) {
            logoutBtn.addEventListener('click', function () {
                logoutBtn.disabled = true;
                logoutBtn.textContent = 'Signing out...';
                apiRequest('/api/admin/logout', { method: 'POST' })
                    .then(function () { window.location.href = '/admin/login.html'; })
                    .catch(function () { window.location.href = '/admin/login.html'; });
            });
        }

        if (sidebarToggle) {
            sidebarToggle.addEventListener('click', function () {
                sidebar.classList.toggle('open');
                sidebarBackdrop.classList.toggle('show');
            });
        }

        if (sidebarBackdrop) {
            sidebarBackdrop.addEventListener('click', function () {
                sidebar.classList.remove('open');
                sidebarBackdrop.classList.remove('show');
            });
        }

        return {
            loadAdmin: loadAdmin,
            redirectToLogin: redirectToLogin
        };
    }

    /* ============================================
       LOGIN PAGE
       ============================================ */

    function initLoginPage() {
        var form = document.getElementById('loginForm');
        var emailInput = document.getElementById('email');
        var passwordInput = document.getElementById('password');
        var btn = document.getElementById('loginBtn');
        var btnText = document.getElementById('loginBtnText');
        var spinner = document.getElementById('loginSpinner');
        var alertBox = document.getElementById('loginError');

        function showError(message) {
            alertBox.textContent = message || 'Something went wrong. Please try again.';
            alertBox.classList.add('show');
        }

        function clearError() {
            alertBox.textContent = '';
            alertBox.classList.remove('show');
        }

        function setLoading(isLoading) {
            btn.disabled = isLoading;
            btnText.textContent = isLoading ? 'Signing in...' : 'Sign In';
            spinner.classList.toggle('hidden', !isLoading);
        }

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            clearError();

            var email = emailInput.value.trim();
            var password = passwordInput.value;

            if (!email || !password) {
                showError('Please enter both email and password.');
                return;
            }

            setLoading(true);

            apiRequest('/api/admin/login', {
                method: 'POST',
                body: { email: email, password: password }
            }).then(function (res) {
                setLoading(false);

                if (res.ok) {
                    window.location.href = '/admin/dashboard.html';
                    return;
                }

                showError(parseApiError(res));
            }).catch(function () {
                setLoading(false);
                showError('Network error. Check the server connection.');
            });
        });
    }

    /* ============================================
       DASHBOARD PAGE
       ============================================ */

    function initDashboardPage() {
        var shell = initShell();

        var statsGrid = document.getElementById('statsGrid');
        var recentPanel = document.getElementById('recentPanel');
        var loadingState = document.getElementById('loadingState');
        var errorState = document.getElementById('errorState');
        var errorMessage = document.getElementById('errorMessage');
        var refreshBtn = document.getElementById('refreshBtn');
        var retryBtn = document.getElementById('retryBtn');

        function showLoading() {
            loadingState.classList.remove('hidden');
            errorState.classList.add('hidden');
            statsGrid.classList.add('hidden');
            recentPanel.classList.add('hidden');
        }

        function showError(message) {
            loadingState.classList.add('hidden');
            statsGrid.classList.add('hidden');
            recentPanel.classList.add('hidden');
            errorMessage.textContent = message;
            errorState.classList.remove('hidden');
        }

        function showDashboard() {
            loadingState.classList.add('hidden');
            errorState.classList.add('hidden');
            statsGrid.classList.remove('hidden');
            recentPanel.classList.remove('hidden');
        }

        function renderStats(stats) {
            document.getElementById('statTotalOrders').textContent = Number(stats.totalOrders) || 0;
            document.getElementById('statPendingOrders').textContent = Number(stats.pendingOrders) || 0;
            document.getElementById('statConfirmedOrders').textContent = Number(stats.confirmedOrders) || 0;
            document.getElementById('statDeliveredOrders').textContent = Number(stats.deliveredOrders) || 0;
            document.getElementById('statTotalRevenue').textContent = formatCurrency(stats.totalRevenuePaise);

            document.getElementById('statTodayOrders').textContent =
                'Today: ' + (Number(stats.todayOrders) || 0) + ' order(s)';

            document.getElementById('statTodayRevenue').textContent =
                'Today: ' + formatCurrency(stats.todayRevenuePaise);
        }

        function renderRecentOrders(orders) {
            var tbody = document.getElementById('recentOrdersBody');
            var empty = document.getElementById('recentEmpty');

            tbody.innerHTML = '';
            empty.classList.toggle('hidden', !(orders && orders.length > 0));

            if (!orders || orders.length === 0) return;

            orders.forEach(function (order) {
                var tr = document.createElement('tr');

                tr.innerHTML =
                    '<td class="order-no"><a href="/admin/order-details.html?id=' + encodeURIComponent(order.id) + '">' + escapeHtml(order.orderNumber || '-') + '</a></td>' +
                    '<td>' +
                        '<div>' + escapeHtml(order.customerName || 'Guest') + '</div>' +
                        '<div class="order-email">' + escapeHtml(order.customerEmail || '') + '</div>' +
                    '</td>' +
                    '<td>' + statusBadge(order.status) + '</td>' +
                    '<td>' + paymentBadge(order.paymentStatus) + '</td>' +
                    '<td><strong>' + formatCurrency(order.totalAmount) + '</strong></td>' +
                    '<td>' + formatDate(order.createdAt) + '</td>';

                tbody.appendChild(tr);
            });
        }

        function loadDashboard() {
            showLoading();

            shell.loadAdmin().then(function (admin) {
                if (!admin) return;

                apiRequest('/api/admin/dashboard/stats').then(function (statsRes) {
                    if (!statsRes.ok) {
                        if (statsRes.status === 401) {
                            shell.redirectToLogin();
                            return;
                        }
                        showError(parseApiError(statsRes));
                        return;
                    }

                    renderStats(statsRes.data);
                    renderRecentOrders(statsRes.data.recentOrders);
                    showDashboard();
                }).catch(function () {
                    showError('Network error. Check the server connection.');
                });
            }).catch(function (error) {
                showError(error.message || 'Could not load your session.');
            });
        }

        refreshBtn.addEventListener('click', loadDashboard);
        retryBtn.addEventListener('click', loadDashboard);

        loadDashboard();
    }

    /* ============================================
       ORDERS LIST PAGE
       ============================================ */

    function initOrdersPage() {
        var shell = initShell();

        var searchInput = document.getElementById('ordersSearch');
        var statusFilter = document.getElementById('ordersStatus');
        var sortSelect = document.getElementById('ordersSort');
        var applyBtn = document.getElementById('ordersApply');
        var resetBtn = document.getElementById('ordersReset');
        var refreshBtn = document.getElementById('refreshBtn');
        var retryBtn = document.getElementById('ordersRetry');
        var prevBtn = document.getElementById('prevBtn');
        var nextBtn = document.getElementById('nextBtn');
        var pageInfo = document.getElementById('pageInfo');
        var ordersBody = document.getElementById('ordersBody');
        var ordersEmpty = document.getElementById('ordersEmpty');
        var ordersPanel = document.getElementById('ordersPanel');
        var loadingState = document.getElementById('ordersLoading');
        var errorState = document.getElementById('ordersError');
        var errorMessage = document.getElementById('ordersErrorMessage');

        var state = { page: 1, search: '', status: 'ALL', sort: 'newest', pageSize: 10 };

        function showLoading() {
            loadingState.classList.remove('hidden');
            errorState.classList.add('hidden');
            ordersPanel.classList.add('hidden');
        }

        function showError(message) {
            loadingState.classList.add('hidden');
            ordersPanel.classList.add('hidden');
            errorMessage.textContent = message;
            errorState.classList.remove('hidden');
        }

        function showOrders() {
            loadingState.classList.add('hidden');
            errorState.classList.add('hidden');
            ordersPanel.classList.remove('hidden');
        }

        function renderRows(orders) {
            ordersBody.innerHTML = '';
            ordersEmpty.classList.toggle('hidden', !(orders && orders.length > 0));

            if (!orders || orders.length === 0) return;

            orders.forEach(function (order) {
                var tr = document.createElement('tr');
                var itemCount = (order.items || []).reduce(function (sum, item) { return sum + (item.quantity || 0); }, 0);

                tr.innerHTML =
                    '<td class="order-no"><a href="/admin/order-details.html?id=' + encodeURIComponent(order.id) + '">' + escapeHtml(order.orderNumber || '-') + '</a></td>' +
                    '<td>' +
                        '<div>' + escapeHtml(order.customerName || 'Guest') + '</div>' +
                        '<div class="order-email">' + escapeHtml(order.customerEmail || '') + '</div>' +
                    '</td>' +
                    '<td>' + (itemCount || '-') + '</td>' +
                    '<td>' + statusBadge(order.status) + '</td>' +
                    '<td>' + paymentBadge(order.paymentStatus) + '</td>' +
                    '<td><strong>' + formatCurrency(order.totalAmount) + '</strong></td>' +
                    '<td>' + formatDate(order.createdAt) + '</td>' +
                    '<td><a class="btn btn-ghost" href="/admin/order-details.html?id=' + encodeURIComponent(order.id) + '">Open</a></td>';

                ordersBody.appendChild(tr);
            });
        }

        function renderPagination(pagination) {
            pageInfo.textContent = pagination.total === 0
                ? 'No orders'
                : 'Page ' + pagination.page + ' of ' + pagination.totalPages + ' (' + pagination.total + ' orders)';

            prevBtn.disabled = pagination.page <= 1;
            nextBtn.disabled = pagination.page >= pagination.totalPages;
        }

        function buildQuery() {
            var params = 'page=' + state.page + '&pageSize=' + state.pageSize + '&sort=' + encodeURIComponent(state.sort);
            if (state.search) params += '&search=' + encodeURIComponent(state.search);
            if (state.status && state.status !== 'ALL') params += '&status=' + encodeURIComponent(state.status);
            return params;
        }

        function loadOrders() {
            showLoading();

            apiRequest('/api/admin/orders?' + buildQuery()).then(function (res) {
                if (!res.ok) {
                    if (res.status === 401) {
                        shell.redirectToLogin();
                        return;
                    }
                    showError(parseApiError(res));
                    return;
                }

                renderRows(res.data.orders);
                renderPagination(res.data.pagination);
                showOrders();
            }).catch(function () {
                showError('Network error. Check the server connection.');
            });
        }

        function applyFilters() {
            state.search = searchInput.value.trim();
            state.status = statusFilter.value;
            state.sort = sortSelect.value;
            state.page = 1;
            loadOrders();
        }

        function resetFilters() {
            searchInput.value = '';
            statusFilter.value = 'ALL';
            sortSelect.value = 'newest';
            applyFilters();
        }

        applyBtn.addEventListener('click', applyFilters);
        resetBtn.addEventListener('click', resetFilters);
        refreshBtn.addEventListener('click', loadOrders);
        retryBtn.addEventListener('click', loadOrders);

        searchInput.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') applyFilters();
        });

        prevBtn.addEventListener('click', function () {
            if (state.page > 1) { state.page -= 1; loadOrders(); }
        });

        nextBtn.addEventListener('click', function () {
            state.page += 1;
            loadOrders();
        });

        shell.loadAdmin().then(function (admin) {
            if (admin) loadOrders();
        }).catch(function () {
            showError('Could not load your session.');
        });
    }

    /* ============================================
       PRODUCTS PAGE (catalog management)
       ============================================ */

    function productThumb(product) {
        if (product && product.image) {
            return '<img class="prod-thumb" src="/' + escapeHtml(product.image) + '" alt="' + escapeHtml(product.name) + '" onerror="this.classList.add(\'prod-thumb-broken\')">';
        }
        return '<span class="prod-thumb-fallback">&#10022;</span>';
    }

    function stockStatusLabel(stock) {
        var count = Number(stock) || 0;
        if (count <= 0) return 'Out of Stock';
        if (count <= LOW_STOCK_THRESHOLD) return 'Low Stock';
        return 'In Stock';
    }

    function stockStatusBadge(stock) {
        var count = Number(stock) || 0;
        var cls = count <= 0 ? 'OUT_OF_STOCK' : (count <= LOW_STOCK_THRESHOLD ? 'LOW_STOCK' : 'IN_STOCK');
        var dot = count <= 0 ? 'dot-red' : (count <= LOW_STOCK_THRESHOLD ? 'dot-amber' : 'dot-green');
        return '<span class="badge badge-' + cls + '"><span class="dot ' + dot + '"></span> ' + escapeHtml(stockStatusLabel(stock)) + '</span>';
    }

    function categoryBadge(category) {
        if (!category) return '<span class="muted">-</span>';
        return '<span class="badge badge-category">' + escapeHtml(category) + '</span>';
    }

    function initProductsPage() {
        var shell = initShell();

        var searchInput = document.getElementById('productsSearch');
        var categorySelect = document.getElementById('productsCategory');
        var applyBtn = document.getElementById('productsApply');
        var resetBtn = document.getElementById('productsReset');
        var refreshBtn = document.getElementById('refreshBtn');
        var retryBtn = document.getElementById('productsRetry');
        var prevBtn = document.getElementById('prevBtn');
        var nextBtn = document.getElementById('nextBtn');
        var pageInfo = document.getElementById('productPageInfo');
        var productsBody = document.getElementById('productsBody');
        var productsEmpty = document.getElementById('productsEmpty');
        var productsPanel = document.getElementById('productsPanel');
        var loadingState = document.getElementById('productsLoading');
        var errorState = document.getElementById('productsError');
        var errorMessage = document.getElementById('productsErrorMessage');

        var addProductBtn = document.getElementById('addProductBtn');

        var state = { page: 1, search: '', category: '', pageSize: 10 };

        var editingProduct = null;
        var pendingDelete = null;
        var savedImageOptions = [];

        var dropzone = document.getElementById('productDropzone');
        var dropFileInput = document.getElementById('productImageFile');
        var dropzoneInner = document.getElementById('dropzoneInner');
        var dropzoneFileRow = document.getElementById('dropzoneFileRow');
        var dropzoneFilename = document.getElementById('dropzoneFilename');
        var dropzoneCurrent = document.getElementById('dropzoneCurrent');
        var dropzoneReplace = document.getElementById('dropzoneReplace');
        var dropzoneRemove = document.getElementById('dropzoneRemove');
        var dropzoneStatus = document.getElementById('dropzoneStatus');
        var dropzoneProgress = document.getElementById('dropzoneProgress');

        var currentEditImage = '';
        var uploadInProgress = false;
        var uploadHasError = false;

        function showLoading() {
            loadingState.classList.remove('hidden');
            errorState.classList.add('hidden');
            productsPanel.classList.add('hidden');
        }

        function showError(message) {
            loadingState.classList.add('hidden');
            productsPanel.classList.add('hidden');
            errorMessage.textContent = message;
            errorState.classList.remove('hidden');
        }

        function showProducts() {
            loadingState.classList.add('hidden');
            errorState.classList.add('hidden');
            productsPanel.classList.remove('hidden');
        }

        function renderRows(products) {
            productsBody.innerHTML = '';
            productsEmpty.classList.toggle('hidden', !(products && products.length > 0));

            if (!products || products.length === 0) return;

            products.forEach(function (product) {
                var tr = document.createElement('tr');

                tr.innerHTML =
                    '<td>' + productThumb(product) + '</td>' +
                    '<td>' +
                        '<div class="prod-name">' + escapeHtml(product.name) + '</div>' +
                        (product.description ? '<div class="order-email prod-desc">' + escapeHtml(product.description) + '</div>' : '') +
                    '</td>' +
                    '<td>' + categoryBadge(product.category) + '</td>' +
                    '<td><strong>' + formatCurrency(product.price) + '</strong></td>' +
                    '<td><strong>' + (Number(product.stock) || 0) + '</strong></td>' +
                    '<td>' + stockStatusBadge(product.stock) + '</td>' +
                    '<td class="prod-actions">' +
                        '<button type="button" class="btn btn-ghost btn-sm" data-action="edit" data-id="' + escapeHtml(product.id) + '">Edit</button>' +
                        '<button type="button" class="btn btn-danger btn-sm" data-action="delete" data-id="' + escapeHtml(product.id) + '">Delete</button>' +
                    '</td>';

                tr.querySelector('[data-action="edit"]').addEventListener('click', function () {
                    openProductModal(product);
                });

                tr.querySelector('[data-action="delete"]').addEventListener('click', function () {
                    openConfirmModal(product);
                });

                productsBody.appendChild(tr);
            });
        }

        function renderPagination(pagination) {
            pageInfo.textContent = pagination.total === 0
                ? 'No products'
                : 'Page ' + pagination.page + ' of ' + pagination.totalPages + ' (' + pagination.total + ' products)';

            prevBtn.disabled = pagination.page <= 1;
            nextBtn.disabled = pagination.page >= pagination.totalPages;
        }

        function buildQuery() {
            var params = 'page=' + state.page + '&pageSize=' + state.pageSize;
            if (state.search) params += '&search=' + encodeURIComponent(state.search);
            if (state.category) params += '&category=' + encodeURIComponent(state.category);
            return params;
        }

        function loadProducts() {
            showLoading();

            apiRequest('/api/admin/products?' + buildQuery()).then(function (res) {
                if (!res.ok) {
                    if (res.status === 401) {
                        shell.redirectToLogin();
                        return;
                    }
                    showError(parseApiError(res));
                    return;
                }

                renderRows(res.data.products);
                renderPagination(res.data.pagination);
                showProducts();
            }).catch(function () {
                showError('Network error. Check the server connection.');
            });
        }

        function applyFilters() {
            state.search = searchInput.value.trim();
            state.category = categorySelect.value;
            state.page = 1;
            loadProducts();
        }

        function resetFilters() {
            searchInput.value = '';
            categorySelect.value = '';
            applyFilters();
        }

        /* ---------- Categories & image options ---------- */

        function loadCategories() {
            apiRequest('/api/products').then(function (res) {
                if (!res.ok) return;

                var categories = {};
                (res.data.products || []).forEach(function (p) {
                    if (p.category) categories[p.category] = true;
                });

                var names = Object.keys(categories).sort();

                categorySelect.innerHTML = '<option value="">All categories</option>';
                names.forEach(function (name) {
                    var opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    categorySelect.appendChild(opt);
                });

                var datalist = document.getElementById('categoryOptions');
                if (datalist) {
                    var isIncluded = {};
                    names.forEach(function (name) { isIncluded[name] = true; });

                    (res.data.products || []).forEach(function (p) {
                        if (p.category && !isIncluded[p.category]) {
                            names.push(p.category);
                            isIncluded[p.category] = true;
                        }
                    });

                    datalist.innerHTML = names.map(function (name) {
                        return '<option value="' + escapeHtml(name) + '"></option>';
                    }).join('');
                }

                if (state.category && names.indexOf(state.category) === -1) {
                    categorySelect.value = state.category;
                }
            }).catch(function () { /* non-fatal */ });
        }

        function loadImageOptions() {
            apiRequest('/api/admin/products/images').then(function (res) {
                if (!res.ok) return;

                savedImageOptions = (res.data.images || []).sort();

                var select = document.getElementById('productImageSelect');
                var current = select.value;

                select.innerHTML = '<option value="">-- Select an image --</option>';
                savedImageOptions.forEach(function (src) {
                    var opt = document.createElement('option');
                    opt.value = src;
                    opt.textContent = src;
                    select.appendChild(opt);
                });

                if (current) select.value = current;
            }).catch(function () { /* non-fatal */ });
        }

        /* ---------- Add / Edit modal ---------- */

        var productModal = document.getElementById('productModal');
        var productForm = document.getElementById('productForm');

        function refreshImagePreview() {
            var pathInput = document.getElementById('productImage');
            var preview = document.getElementById('productImagePreview');
            var empty = document.getElementById('productImagePreviewEmpty');
            var value = (pathInput.value || '').trim();

            if (value) {
                preview.src = '/' + value;
                preview.classList.remove('hidden');
                empty.classList.add('hidden');
            } else {
                preview.removeAttribute('src');
                preview.classList.add('hidden');
                empty.classList.remove('hidden');
            }
        }

        function resetProductForm() {
            document.getElementById('productName').value = '';
            document.getElementById('productDescription').value = '';
            document.getElementById('productPrice').value = '';
            document.getElementById('productCategory').value = '';
            document.getElementById('productStock').value = '0';
            document.getElementById('productImage').value = '';
            document.getElementById('productImageSelect').value = '';
            hideProductAlert();
            resetDropzoneState();
            refreshImagePreview();
        }

        function openProductModal(product) {
            editingProduct = product || null;
            currentEditImage = product ? (product.image || '') : '';
            resetProductForm();
            loadImageOptions();
            renderDropzoneCurrent();
            resetDropzoneState();

            document.getElementById('productModalTitle').textContent = product ? 'Edit Product' : 'Add Product';
            document.getElementById('productSaveBtn').textContent = product ? 'Save Changes' : 'Add Product';

            if (product) {
                document.getElementById('productName').value = product.name || '';
                document.getElementById('productDescription').value = product.description || '';
                document.getElementById('productPrice').value = ((product.price || 0) / 100).toFixed(product.price % 100 === 0 ? 0 : 2);
                document.getElementById('productCategory').value = product.category || '';
                document.getElementById('productStock').value = Number(product.stock) || 0;
                document.getElementById('productImage').value = product.image || '';
                refreshImagePreview();
            }

            productModal.classList.remove('hidden');
            setTimeout(function () {
                document.getElementById('productName').focus();
            }, 50);
        }

        function closeProductModal() {
            productModal.classList.add('hidden');
            editingProduct = null;
        }

        function showProductAlert(message) {
            var alertBox = document.getElementById('productModalAlert');
            alertBox.textContent = message;
            alertBox.classList.remove('hidden');
        }

        function hideProductAlert() {
            var alertBox = document.getElementById('productModalAlert');
            alertBox.textContent = '';
            alertBox.classList.add('hidden');
        }

        /* ---------- Drag & drop image upload ---------- */

        function showDropzoneStatus(message, kind) {
            dropzoneStatus.textContent = message;
            dropzoneStatus.className = 'dropzone-status' + (kind === 'err' ? ' is-error' : ' is-ok');
            dropzoneStatus.classList.remove('hidden');
        }

        function hideDropzoneStatus() {
            dropzoneStatus.textContent = '';
            dropzoneStatus.className = 'dropzone-status';
            dropzoneStatus.classList.add('hidden');
        }

        function setDropzoneProgress(active) {
            dropzoneProgress.classList.toggle('hidden', !active);
        }

        function resetDropzoneState() {
            uploadInProgress = false;
            uploadHasError = false;
            if (dropFileInput) dropFileInput.value = '';
            dropzoneInner.classList.remove('hidden');
            dropzoneFileRow.classList.add('hidden');
            dropzone.classList.remove('is-dragover');
            hideDropzoneStatus();
            setDropzoneProgress(false);
        }

        function renderDropzoneCurrent() {
            if (currentEditImage) {
                dropzoneCurrent.textContent = 'Current: ' + currentEditImage;
                dropzoneCurrent.classList.remove('hidden');
            } else {
                dropzoneCurrent.textContent = '';
                dropzoneCurrent.classList.add('hidden');
            }
        }

        function setDropzoneFileRow(filename) {
            dropzoneInner.classList.add('hidden');
            dropzoneFileRow.classList.remove('hidden');
            dropzoneFilename.textContent = filename;
        }

        function applyDropzoneImage(path) {
            currentEditImage = path || '';
            document.getElementById('productImage').value = path || '';
            document.getElementById('productImageSelect').value = path || '';
            uploadHasError = false;
            renderDropzoneCurrent();
            refreshImagePreview();
        }

        function handleImageFile(file) {
            if (!file) return;

            var type = String(file.type || '').toLowerCase();
            var ext = '';
            var dot = file.name.lastIndexOf('.');
            if (dot !== -1) ext = file.name.slice(dot + 1).toLowerCase();
            var typeOk = ALLOWED_IMAGE_TYPES.indexOf(type) !== -1 || ALLOWED_IMAGE_EXTENSIONS.indexOf(ext) !== -1;

            if (!typeOk) {
                uploadHasError = true;
                showDropzoneStatus('Only PNG, JPG, or WEBP images are allowed.', 'err');
                return;
            }

            if (file.size > IMAGE_MAX_BYTES) {
                uploadHasError = true;
                showDropzoneStatus('Image file is too large. Maximum size is 5 MB.', 'err');
                return;
            }

            uploadHasError = false;
            hideDropzoneStatus();
            setDropzoneFileRow(file.name);

            // Local preview immediately; replaced by the server copy after upload.
            var preview = document.getElementById('productImagePreview');
            var empty = document.getElementById('productImagePreviewEmpty');
            preview.src = URL.createObjectURL(file);
            preview.classList.remove('hidden');
            empty.classList.add('hidden');
            document.getElementById('productImage').value = '';

            uploadImageFile(file);
        }

        function uploadImageFile(file) {
            uploadInProgress = true;
            setDropzoneProgress(true);

            fetch('/api/admin/products/images/upload', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': file.type || 'application/octet-stream',
                    'X-Image-Filename': encodeURIComponent(file.name)
                },
                body: file
            }).then(function (res) {
                var status = res.status;
                return res.json().then(function (data) {
                    return { ok: res.ok, status: status, data: data };
                }).catch(function () {
                    return { ok: false, status: status, data: {} };
                });
            }).then(function (res) {
                uploadInProgress = false;
                setDropzoneProgress(false);

                if (res.status === 401) {
                    shell.redirectToLogin();
                    return;
                }

                if (!res.ok) {
                    uploadHasError = true;
                    showDropzoneStatus((res.data && (res.data.error || res.data.message)) || 'Upload failed. Please try again.', 'err');
                    return;
                }

                if (!res.data || !res.data.image) {
                    uploadHasError = true;
                    showDropzoneStatus('Upload failed. The server returned an invalid response.', 'err');
                    return;
                }

                applyDropzoneImage(res.data.image);
                showDropzoneStatus('Image uploaded successfully.', 'ok');
            }).catch(function () {
                uploadInProgress = false;
                setDropzoneProgress(false);
                uploadHasError = true;
                showDropzoneStatus('Network error during upload. Check the server and try again.', 'err');
            });
        }

        function openFilePicker() {
            if (dropFileInput) dropFileInput.click();
        }

        function validateProductForm() {
            var name = (document.getElementById('productName').value || '').trim();
            var price = parseFloat(document.getElementById('productPrice').value);
            var stock = document.getElementById('productStock').value;

            if (!name) return 'Product name is required.';
            if (name.length > 191) return 'Product name must be 191 characters or fewer.';
            if (isNaN(price) || price <= 0) return 'Enter a valid price greater than zero.';
            if (stock !== '' && (!/^\d+$/.test(String(stock).trim()))) return 'Stock must be a whole number of zero or more.';

            return null;
        }

        function saveProduct(event) {
            event.preventDefault();
            hideProductAlert();

            if (uploadInProgress) {
                showProductAlert('Please wait for the image upload to finish before saving.');
                return;
            }
            if (uploadHasError) {
                showProductAlert('Your image failed to upload. Remove it or retry before saving.');
                return;
            }

            var formError = validateProductForm();
            if (formError) {
                showProductAlert(formError);
                return;
            }

            var payload = {
                name: document.getElementById('productName').value.trim(),
                description: document.getElementById('productDescription').value.trim() || '',
                price: parseFloat(document.getElementById('productPrice').value),
                category: document.getElementById('productCategory').value.trim() || '',
                stock: document.getElementById('productStock').value === '' ? 0 : parseInt(document.getElementById('productStock').value, 10),
                image: document.getElementById('productImage').value.trim() || ''
            };

            var saveBtn = document.getElementById('productSaveBtn');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';

            var method = editingProduct ? 'PATCH' : 'POST';
            var url = editingProduct
                ? '/api/admin/products/' + encodeURIComponent(editingProduct.id)
                : '/api/admin/products';

            apiRequest(url, { method: method, body: payload }).then(function (res) {
                saveBtn.disabled = false;
                saveBtn.textContent = editingProduct ? 'Save Changes' : 'Add Product';

                if (!res.ok) {
                    if (res.status === 401) {
                        shell.redirectToLogin();
                        return;
                    }
                    showProductAlert(parseApiError(res));
                    return;
                }

                closeProductModal();
                showToast(editingProduct ? 'Product updated successfully.' : 'Product added successfully.', 'ok');
                loadProducts();
                loadCategories();
            }).catch(function () {
                saveBtn.disabled = false;
                saveBtn.textContent = editingProduct ? 'Save Changes' : 'Add Product';
                showProductAlert('Network error. Check the server connection.');
            });
        }

        /* ---------- Delete confirmation modal ---------- */

        var confirmModal = document.getElementById('confirmModal');

        function openConfirmModal(product) {
            pendingDelete = product;
            document.getElementById('confirmText').textContent =
                'Are you sure you want to delete "' + (product.name || 'this product') + '"? This cannot be undone.';

            var warning = document.getElementById('confirmWarning');
            var alertBox = document.getElementById('confirmAlert');

            warning.classList.add('hidden');
            warning.textContent = '';
            alertBox.classList.add('hidden');
            alertBox.textContent = '';

            var confirmBtn = document.getElementById('confirmDeleteBtn');
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Delete';

            confirmModal.classList.remove('hidden');
        }

        function closeConfirmModal() {
            confirmModal.classList.add('hidden');
            pendingDelete = null;
        }

        function confirmDelete() {
            if (!pendingDelete) return;

            var confirmBtn = document.getElementById('confirmDeleteBtn');
            var alertBox = document.getElementById('confirmAlert');

            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Deleting...';
            alertBox.classList.add('hidden');

            apiRequest('/api/admin/products/' + encodeURIComponent(pendingDelete.id), { method: 'DELETE' }).then(function (res) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Delete';

                if (!res.ok) {
                    if (res.status === 401) {
                        shell.redirectToLogin();
                        return;
                    }
                    alertBox.textContent = parseApiError(res);
                    alertBox.classList.remove('hidden');
                    return;
                }

                var name = pendingDelete.name;
                closeConfirmModal();
                showToast('Product deleted.', 'ok');

                if (res.data && res.data.linkedOrderItems > 0) {
                    console.warn('Product "' + name + '" was in ' + res.data.linkedOrderItems + ' past order item(s). Historical orders preserve their own saved product details.');
                }

                loadProducts();
                loadCategories();
            }).catch(function () {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Delete';
                alertBox.textContent = 'Network error. Check the server connection.';
                alertBox.classList.remove('hidden');
            });
        }

        /* ---------- Toast ---------- */

        function showToast(message, kind) {
            var toast = document.getElementById('toast');
            toast.textContent = message;
            toast.className = 'toast show toast-' + (kind === 'ok' ? 'ok' : 'err');
            clearTimeout(showToast._timer);
            showToast._timer = setTimeout(function () {
                toast.className = 'toast hidden';
            }, 3200);
        }

        /* ---------- Wire up ---------- */

        applyBtn.addEventListener('click', applyFilters);
        resetBtn.addEventListener('click', resetFilters);
        refreshBtn.addEventListener('click', loadProducts);
        retryBtn.addEventListener('click', loadProducts);
        addProductBtn.addEventListener('click', function () { openProductModal(null); });

        // ---------- Dropzone wiring ----------

        dropzone.addEventListener('click', function (event) {
            if (event.target !== dropFileInput && uploadInProgress) return;
            if (event.target !== dropFileInput) openFilePicker();
        });
        dropzone.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openFilePicker();
            }
        });
        dropzone.addEventListener('dragover', function (event) {
            event.preventDefault();
            dropzone.classList.add('is-dragover');
        });
        dropzone.addEventListener('dragleave', function (event) {
            event.preventDefault();
            dropzone.classList.remove('is-dragover');
        });
        dropzone.addEventListener('drop', function (event) {
            event.preventDefault();
            dropzone.classList.remove('is-dragover');
            if (uploadInProgress) return;
            if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length > 0) {
                handleImageFile(event.dataTransfer.files[0]);
            }
        });
        dropFileInput.addEventListener('change', function () {
            if (dropFileInput.files && dropFileInput.files.length > 0) {
                handleImageFile(dropFileInput.files[0]);
            }
        });
        dropzoneReplace.addEventListener('click', function () { resetDropzoneState(); openFilePicker(); });
        dropzoneRemove.addEventListener('click', function () {
            if (uploadInProgress) return;
            currentEditImage = '';
            document.getElementById('productImage').value = '';
            document.getElementById('productImageSelect').value = '';
            uploadHasError = false;
            resetDropzoneState();
            refreshImagePreview();
        });

        function renderDropzoneState() {
            resetDropzoneState();
            renderDropzoneCurrent();
        }

        searchInput.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') applyFilters();
        });

        prevBtn.addEventListener('click', function () {
            if (state.page > 1) { state.page -= 1; loadProducts(); }
        });

        nextBtn.addEventListener('click', function () {
            state.page += 1;
            loadProducts();
        });

        productForm.addEventListener('submit', saveProduct);

        document.getElementById('productModalClose').addEventListener('click', closeProductModal);
        document.getElementById('productCancelBtn').addEventListener('click', closeProductModal);

        document.getElementById('productImage').addEventListener('input', refreshImagePreview);
        document.getElementById('productImageSelect').addEventListener('change', function () {
            document.getElementById('productImage').value = this.value;
            refreshImagePreview();
        });

        document.getElementById('confirmClose').addEventListener('click', closeConfirmModal);
        document.getElementById('confirmCancelBtn').addEventListener('click', closeConfirmModal);
        document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDelete);

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                if (!productModal.classList.contains('hidden')) closeProductModal();
                if (!confirmModal.classList.contains('hidden')) closeConfirmModal();
            }
        });

        shell.loadAdmin().then(function (admin) {
            if (admin) {
                loadCategories();
                loadProducts();
            }
        }).catch(function () {
            showError('Could not load your session.');
        });
    }

    /* ============================================
       ORDER DETAILS PAGE
       ============================================ */

    function renderStatusHistory(history) {
        var container = document.getElementById('statusHistoryList');
        container.innerHTML = '';

        if (!history || history.length === 0) {
            container.innerHTML = '<div class="empty-state">No status changes recorded yet.</div>';
            return;
        }

        history.forEach(function (entry) {
            var div = document.createElement('div');
            div.className = 'history-item';

            var note = entry.note ? '<div class="history-note">' + escapeHtml(entry.note) + '</div>' : '';

            div.innerHTML =
                '<div class="history-head">' +
                    '<span class="history-status">' + statusBadge(entry.newStatus) + '</span>' +
                    '<span class="history-time">' + formatDate(entry.createdAt) + '</span>' +
                '</div>' +
                (entry.oldStatus ? '<div class="history-sub">from ' + escapeHtml(entry.oldStatus) + '</div>' : '') +
                note;

            container.appendChild(div);
        });
    }

    function renderMessages(messages) {
        var thread = document.getElementById('messageThread');
        thread.innerHTML = '';

        if (!messages || messages.length === 0) {
            thread.innerHTML = '<div class="empty-state">No messages sent yet.</div>';
            return;
        }

        messages.forEach(function (msg, index) {
            var div = document.createElement('div');
            div.className = 'msg-item' + (index === messages.length - 1 ? ' msg-item-latest' : '');

            var sender = (msg.admin && msg.admin.name) ? msg.admin.name : 'Admin';

            div.innerHTML =
                '<div class="msg-meta">' +
                    '<span class="msg-author">' + escapeHtml(sender) + '</span>' +
                    '<span class="msg-time">' + formatDate(msg.createdAt) + '</span>' +
                '</div>' +
                '<div class="msg-text">' + escapeHtml(msg.message) + '</div>';

            thread.appendChild(div);
        });
    }

    function renderItems(items, currency) {
        var tbody = document.getElementById('itemsBody');
        var subtotal = 0;

        tbody.innerHTML = '';

        (items || []).forEach(function (item) {
            var lineTotal = (item.price || 0) * (item.quantity || 1);
            subtotal += lineTotal;

            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td>' + escapeHtml(item.name || '-') + '</td>' +
                '<td>' + (item.quantity || 0) + '</td>' +
                '<td>' + formatCurrency(item.price) + '</td>' +
                '<td><strong>' + formatCurrency(lineTotal) + '</strong></td>';

            tbody.appendChild(tr);
        });

        document.getElementById('subtotalCell').textContent = formatCurrency(subtotal);
    }

    function renderOrder(order) {
        document.getElementById('orderTitle').textContent = 'Order ' + (order.orderNumber || '');
        document.getElementById('orderMeta').textContent = 'Placed on ' + formatDate(order.createdAt);

        var badgeEl = document.getElementById('detailStatusBadge');
        badgeEl.className = 'badge';
        badgeEl.innerHTML = statusBadge(order.status);

        var statusSelect = document.getElementById('statusSelect');
        statusSelect.innerHTML = '';
        ALLOWED_STATUS.forEach(function (status) {
            var opt = document.createElement('option');
            opt.value = status;
            opt.textContent = statusLabel(status);
            if (status === order.status) opt.selected = true;
            statusSelect.appendChild(opt);
        });

        var cancelWrap = document.getElementById('cancelReasonWrap');
        var cancelReason = document.getElementById('cancelReason');

        function toggleCancelField() {
            if (statusSelect.value === 'CANCELLED') {
                cancelWrap.classList.remove('hidden');
                if (order.cancellationReason) {
                    cancelReason.value = order.cancellationReason;
                } else {
                    cancelReason.value = '';
                }
            } else {
                cancelWrap.classList.add('hidden');
            }
        }

        toggleCancelField();

        var customerInfo = document.getElementById('customerInfo');
        var customerRows = [
            ['Name', order.customerName],
            ['Email', order.customerEmail],
            ['Phone', order.customerPhone]
        ];
        customerInfo.innerHTML = customerRows.map(function (pair) {
            if (!pair[1]) return '';
            return '<div class="info-row"><span class="info-label">' + pair[0] + '</span><span class="info-value">' + escapeHtml(pair[1]) + '</span></div>';
        }).join('') || '<div class="empty-state">No customer details recorded.</div>';

        document.getElementById('deliveryAddress').innerHTML = formatAddressHtml(order.shippingAddress);

        renderItems(order.items, order.currency);

        document.getElementById('shippingCell').textContent = formatCurrency(order.shippingFee);
        document.getElementById('grandTotalCell').textContent = formatCurrency(order.totalAmount);

        var total = Number(order.totalAmount) || 0;
        var shipping = Number(order.shippingFee) || 0;
        if (shipping > 0 && total >= shipping) {
            document.getElementById('subtotalCell').textContent = formatCurrency(total - shipping);
        }

        var paymentInfo = document.getElementById('paymentInfo');
        var paid = order.paymentStatus === 'PAID';
        paymentInfo.innerHTML =
            '<div class="info-row"><span class="info-label">Payment</span><span class="info-value">' + paymentBadge(order.paymentStatus) + '</span></div>' +
            '<div class="info-row"><span class="info-label">Currency</span><span class="info-value">' + escapeHtml(order.currency || 'INR') + '</span></div>' +
            (order.stripePaymentIntent
                ? '<div class="info-row"><span class="info-label">Payment ID</span><span class="info-value payment-id">' + escapeHtml(order.stripePaymentIntent) + '</span></div>'
                : '<div class="info-row"><span class="info-label">Payment ID</span><span class="info-value">' + (paid ? 'n/a' : 'Not paid yet') + '</span></div>');

        renderStatusHistory(order.statusHistory);
        renderMessages(order.messages);

        return {
            order: order,
            statusSelect: statusSelect,
            cancelReason: cancelReason,
            toggleCancelField: toggleCancelField
        };
    }

    function initOrderDetailsPage() {
        var shell = initShell();

        var loadingState = document.getElementById('detailsLoading');
        var errorState = document.getElementById('detailsError');
        var errorMessage = document.getElementById('detailsErrorMessage');
        var detailsRoot = document.getElementById('detailsRoot');
        var refreshBtn = document.getElementById('refreshBtn');
        var retryBtn = document.getElementById('detailsRetry');
        var statusUpdateBtn = document.getElementById('statusUpdateBtn');
        var sendMessageBtn = document.getElementById('sendMessageBtn');
        var messageInput = document.getElementById('messageInput');
        var statusAlert = document.getElementById('statusAlert');
        var messageAlert = document.getElementById('messageAlert');

        var params = new URLSearchParams(window.location.search);
        var orderId = params.get('id');

        var currentView = null;

        function showLoading() {
            loadingState.classList.remove('hidden');
            errorState.classList.add('hidden');
            detailsRoot.classList.add('hidden');
        }

        function showError(message) {
            loadingState.classList.add('hidden');
            detailsRoot.classList.add('hidden');
            errorMessage.textContent = message;
            errorState.classList.remove('hidden');
        }

        function showDetails() {
            loadingState.classList.add('hidden');
            errorState.classList.add('hidden');
            detailsRoot.classList.remove('hidden');
        }

        function showAlert(el, message) {
            el.textContent = message;
            el.classList.remove('hidden');
            el.classList.add('show');
        }

        function hideAlert(el) {
            el.classList.add('hidden');
            el.classList.remove('show');
            el.textContent = '';
        }

        function loadOrder() {
            if (!orderId) {
                showError('Missing order id in the URL.');
                return;
            }

            showLoading();

            apiRequest('/api/admin/orders/' + encodeURIComponent(orderId)).then(function (res) {
                if (!res.ok) {
                    if (res.status === 401) {
                        shell.redirectToLogin();
                        return;
                    }
                    showError(parseApiError(res));
                    return;
                }

                currentView = renderOrder(res.data);
                showDetails();
            }).catch(function () {
                showError('Network error. Check the server connection.');
            });
        }

        statusUpdateBtn.addEventListener('click', function () {
            if (!currentView) return;

            var status = currentView.statusSelect.value;
            var reason = currentView.cancelReason.value.trim();
            var body = {};

            hideAlert(statusAlert);

            if (status === 'CANCELLED') {
                body.status = status;
                body.cancellationReason = reason;
            } else if (status !== currentView.order.status) {
                body.status = status;
            } else {
                showAlert(statusAlert, 'Status is unchanged. Select a different status first.');
                return;
            }

            statusUpdateBtn.disabled = true;
            statusUpdateBtn.textContent = 'Saving...';

            apiRequest('/api/admin/orders/' + encodeURIComponent(orderId) + '/status', {
                method: 'PATCH',
                body: body
            }).then(function (res) {
                statusUpdateBtn.disabled = false;
                statusUpdateBtn.textContent = 'Update Status';

                if (!res.ok) {
                    if (res.status === 401) {
                        shell.redirectToLogin();
                        return;
                    }
                    showAlert(statusAlert, parseApiError(res));
                    if (status === 'CANCELLED') currentView.toggleCancelField();
                    return;
                }

                currentView = renderOrder(res.data);
            }).catch(function () {
                statusUpdateBtn.disabled = false;
                statusUpdateBtn.textContent = 'Update Status';
                showAlert(statusAlert, 'Network error. Check the server connection.');
            });
        });

        sendMessageBtn.addEventListener('click', function () {
            var text = messageInput.value.trim();

            hideAlert(messageAlert);

            if (!text) {
                showAlert(messageAlert, 'Message cannot be empty.');
                return;
            }

            sendMessageBtn.disabled = true;
            sendMessageBtn.textContent = 'Sending...';

            apiRequest('/api/admin/orders/' + encodeURIComponent(orderId) + '/messages', {
                method: 'POST',
                body: { message: text }
            }).then(function (res) {
                sendMessageBtn.disabled = false;
                sendMessageBtn.textContent = 'Send Message';

                if (!res.ok) {
                    if (res.status === 401) {
                        shell.redirectToLogin();
                        return;
                    }
                    showAlert(messageAlert, parseApiError(res));
                    return;
                }

                messageInput.value = '';
                loadOrder();
            }).catch(function () {
                sendMessageBtn.disabled = false;
                sendMessageBtn.textContent = 'Send Message';
                showAlert(messageAlert, 'Network error. Check the server connection.');
            });
        });

        refreshBtn.addEventListener('click', loadOrder);
        retryBtn.addEventListener('click', loadOrder);

        var statusSelectEl = document.getElementById('statusSelect');
        var cancelReasonEl = document.getElementById('cancelReason');

        statusSelectEl.addEventListener('change', function () {
            if (!currentView) return;
            var wrap = document.getElementById('cancelReasonWrap');

            if (statusSelectEl.value === 'CANCELLED') {
                wrap.classList.remove('hidden');
                cancelReasonEl.value = currentView.order.cancellationReason || '';
            } else {
                wrap.classList.add('hidden');
            }
        });

        shell.loadAdmin().then(function (admin) {
            if (admin) loadOrder();
        }).catch(function () {
            showError('Could not load your session.');
        });
    }

    /* ============================================
       BOOTSTRAP — decide which page we are on
       ============================================ */

    function getPage() {
        if (document.getElementById('loginForm')) return 'login';
        if (document.getElementById('statsGrid') || document.getElementById('recentOrdersBody')) return 'dashboard';
        if (document.getElementById('ordersBody') || document.getElementById('ordersPanel')) return 'orders';
        if (document.getElementById('productsBody') || document.getElementById('productsPanel')) return 'products';
        if (document.getElementById('detailsRoot') || document.getElementById('statusSelect')) return 'order-details';
        return null;
    }

    function boot() {
        var page = getPage();

        if (page === 'login') {
            initLoginPage();
        } else if (page === 'dashboard') {
            initDashboardPage();
        } else if (page === 'orders') {
            initOrdersPage();
        } else if (page === 'products') {
            initProductsPage();
        } else if (page === 'order-details') {
            initOrderDetailsPage();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();