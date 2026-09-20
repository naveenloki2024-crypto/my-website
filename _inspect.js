const prisma = require('./config/prisma');

(async () => {
    try {
        const productCount = await prisma.product.count();
        const orderCount = await prisma.order.count();
        const itemWithProduct = await prisma.orderItem.count({ where: { productId: { not: null } } });
        const totalItems = await prisma.orderItem.count();
        console.log(JSON.stringify({ productCount, orderCount, totalItems, itemWithProduct }, null, 2));
        if (productCount > 0) {
            const products = await prisma.product.findMany({ orderBy: { createdAt: 'asc' } });
            console.log(JSON.stringify(products, null, 2));
        }
    } catch (e) {
        console.error('ERR', e.message);
    } finally {
        await prisma.$disconnect();
    }
})();