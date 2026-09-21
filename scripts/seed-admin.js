#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const { connectDB, disconnectDB } = require('../config/db');
const { Admin } = require('../models');

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

    await connectDB();
    const admin = await Admin.findOneAndUpdate(
        { email },
        { $set: { name, passwordHash } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

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
    .finally(() => disconnectDB());