-- AlterTable: add a stable, unique slug used for idempotent seeding and future
-- product URLs. The Product table was empty at migration time, so the temporary
-- default is safe and is dropped immediately afterwards.
ALTER TABLE `Product` ADD COLUMN `slug` VARCHAR(191) NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX `Product_slug_key` ON `Product`(`slug`);

-- AlterTable: drop the temporary default so the column matches the Prisma model.
ALTER TABLE `Product` ALTER COLUMN `slug` DROP DEFAULT;

-- AlterTable: inventory counter managed from the Admin Dashboard.
ALTER TABLE `Product` ADD COLUMN `stock` INTEGER NOT NULL DEFAULT 0;