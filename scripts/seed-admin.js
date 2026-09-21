#!/usr/bin/env node

require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');

const ADMIN_TABLE_SQL = `CREATE TABLE IF NOT EXISTS \`Admin\` (
    \`id\` VARCHAR(191) NOT NULL,
    \`email\` VARCHAR(191) NOT NULL,
    \`name\` VARCHAR(191) NULL,
    \`passwordHash\` VARCHAR(191) NOT NULL,
    \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`updatedAt\` DATETIME(3) NOT NULL,

    UNIQUE INDEX \`Admin_email_key\`(\`email\`),
    PRIMARY KEY (\`id\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;

async function ensureAdminTable() {
    try {
        await prisma.$executeRawUnsafe(ADMIN_TABLE_SQL);
    } catch (error) {
        console.warn('Could not auto-create Admin table (DDL may be restricted).');
        console.warn('If this fails, run: npx prisma migrate deploy');
    }
}

async function main() {
    const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || '';
    const name = process.env.ADMIN_NAME || 'Administrator';

    if (!email || !password) {
        console.error('Missing ADMIN_EMAIL or ADMIN_PASSWORD in .env');
        process.exit(1);
    }

    if (password.length < 8) {
        console.error('ADMIN_PASSWORD must be at least 8 characters long.');
        process.exit(1);
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await ensureAdminTable();

    const admin = await prisma.admin.upsert({
        where: { email },
        update: { name, passwordHash },
        create: { email, name, passwordHash }
    });

    console.log(`Admin ready: ${admin.email} (name: ${admin.name})`);

    if (password.includes('change-me') || password === 'RareHabit@2026') {
        console.warn('WARNING: You are using a known default password. Change ADMIN_PASSWORD in .env and re-run this script.');
    }
}

main()
    .catch(error => {
        console.error('Could not seed admin:', error.message);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });