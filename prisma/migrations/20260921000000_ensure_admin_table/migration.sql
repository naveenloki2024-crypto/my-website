-- Idempotent, additive migration that guarantees the Admin table exists.
-- The Admin model is referenced by OrderMessage.adminId and OrderStatusHistory.adminId
-- (see 20260919083100 and 20260919095108), but production databases created before
-- that migration was applied have no Admin table, so admin login fails with
-- "Invalid `prisma.admin.findUnique()` invocation ... Table `Admin` does not exist."
-- CREATE TABLE IF NOT EXISTS is safe to run on any database: it no-ops when the
-- table already exists and never modifies Product, Order, OrderItem, or User data.

CREATE TABLE IF NOT EXISTS `Admin` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Admin_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;