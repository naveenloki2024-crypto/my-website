#!/usr/bin/env node
/* ============================================
   Seed script: import the existing storefront products into the database.

   Idempotent — run it as many times as you like:
     - First run  creates products that do not exist yet   (reported as "inserted")
     - Later runs  update any product whose fields changed (reported as "updated")
     - Products that already match exactly are skipped     (reported as "skipped")

   Products are matched by their unique `slug` so nothing is ever duplicated.

   Usage:
     node scripts/seed-products.js
   ============================================ */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const prisma = require('../config/prisma');

const IMAGES_DIR = path.join(__dirname, '..', 'public', 'images');

/* Every product currently listed on the customer-facing website.
   Prices are in rupees here; they are stored in paise in the database
   to stay consistent with the rest of the checkout/order system. */
const PRODUCTS = [
    {
        name: 'Vibrant Yellow Streetwear Hoodie',
        description: 'Bold yellow oversized hoodie with premium heavyweight fleece and a relaxed street fit.',
        priceRupees: 350,
        image: 'images/hoodie_product.png',
        category: 'Hoodies',
        stock: 10
    },
    {
        name: 'Stylish Orange Streetwear Jacket',
        description: 'Eye-catching orange jacket with a cropped streetwear silhouette and clean zipper lines.',
        priceRupees: 350,
        image: 'images/sweatshirt_product.png',
        category: 'Jackets',
        stock: 10
    },
    {
        name: 'Maroon Oversized T-Shirt',
        description: 'Comfortable maroon oversized tee cut for an easy, relaxed everyday look.',
        priceRupees: 350,
        image: 'images/product-3.jpg',
        category: 'T-Shirts',
        stock: 10
    },
    {
        name: 'Beige Cargo Joggers',
        description: 'Versatile beige cargo joggers with utility pockets and a tapered street fit.',
        priceRupees: 550,
        image: 'images/product-four.png',
        category: 'Joggers',
        stock: 10
    },
    {
        name: 'Mint Green Oversized T-Shirt',
        description: 'Fresh mint green oversized t-shirt with a soft hand-feel and modern boxy cut.',
        priceRupees: 250,
        image: 'images/mint_green_tshirt.png',
        category: 'T-Shirts',
        stock: 10
    },
    {
        name: 'Black Distressed Denim Jacket',
        description: 'Rugged black denim jacket with a distressed finish for an edgy streetwear staple.',
        priceRupees: 500,
        image: 'images/black_denim_jacket.png',
        category: 'Jackets',
        stock: 10
    },
    {
        name: 'Neon Color-Block Windbreaker',
        description: 'High-energy neon color-block windbreaker designed to stand out on any street.',
        priceRupees: 450,
        image: 'images/color_block_windbreaker.png',
        category: 'Jackets',
        stock: 10
    },
    {
        name: 'White Minimalist Cotton Hoodie',
        description: 'Clean white minimalist cotton hoodie that goes with everything.',
        priceRupees: 500,
        image: 'images/white_minimalist_hoodie.png',
        category: 'Hoodies',
        stock: 10
    },
    {
        name: 'Olive Slim-Fit Cargo Pants',
        description: 'Olive slim-fit cargo pants with sleek utility pockets and a sharp tapered leg.',
        priceRupees: 600,
        image: 'images/olive_cargo_pants.png',
        category: 'Pants',
        stock: 10
    },
    {
        name: 'Mustard Chunky Knit Sweater',
        description: 'Warm mustard chunky knit sweater with a cozy oversized texture.',
        priceRupees: 300,
        image: 'images/mustard_chunky_sweater.png',
        category: 'Sweaters',
        stock: 10
    },
    {
        name: 'Sleek Black Bomber Jacket',
        description: 'Timeless sleek black bomber jacket with a modern tailored streetwear cut.',
        priceRupees: 600,
        image: 'images/black_bomber_jacket.png',
        category: 'Jackets',
        stock: 10
    },
    {
        name: 'Retro 90s Graphic Sweatshirt',
        description: 'Vintage-inspired retro 90s graphic sweatshirt with a playful, nostalgic print.',
        priceRupees: 300,
        image: 'images/retro_graphic_sweatshirt.png',
        category: 'Sweatshirts',
        stock: 10
    }
];

function slugify(name) {
    return String(name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function toPaise(rupees) {
    return Math.round((parseFloat(rupees) || 0) * 100);
}

function imageExists(imagePath) {
    if (!imagePath) return false;
    const safeName = path.basename(String(imagePath));
    return fs.existsSync(path.join(IMAGES_DIR, safeName));
}

async function main() {
    const existing = await prisma.product.findMany({ select: { id: true, slug: true } });
    const existingBySlug = new Map(existing.map(p => [p.slug, p.id]));

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let missingImages = [];

    for (const product of PRODUCTS) {
        const slug = slugify(product.name);

        if (!imageExists(product.image)) {
            missingImages.push(`${product.name} -> ${product.image}`);
            continue;
        }

        const data = {
            name: product.name,
            slug,
            description: product.description || null,
            price: toPaise(product.priceRupees),
            image: product.image,
            category: product.category || null,
            stock: Number.isInteger(product.stock) ? product.stock : 0
        };

        if (existingBySlug.has(slug)) {
            const id = existingBySlug.get(slug);
            const current = await prisma.product.findUnique({ where: { id } });

            const same =
                current &&
                current.name === data.name &&
                (current.description || null) === data.description &&
                current.price === data.price &&
                (current.image || null) === data.image &&
                (current.category || null) === data.category &&
                current.stock === data.stock;

            if (same) {
                skipped += 1;
            } else {
                await prisma.product.update({ where: { id }, data });
                updated += 1;
            }
        } else {
            await prisma.product.create({ data });
            inserted += 1;
        }
    }

    console.log('Product import complete.');
    console.log(`  Inserted: ${inserted}`);
    console.log(`  Updated:  ${updated}`);
    console.log(`  Skipped:  ${skipped}`);
    console.log(`  Total:    ${PRODUCTS.length} products processed`);

    if (missingImages.length) {
        console.warn(`\nWARNING: ${missingImages.length} product(s) reference a missing image and were NOT imported:`);
        missingImages.forEach(line => console.warn(`  - ${line}`));
    } else {
        console.log('\nAll product image paths verified in public/images.');
    }
}

main()
    .catch(error => {
        console.error('Could not seed products:', error.message);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });