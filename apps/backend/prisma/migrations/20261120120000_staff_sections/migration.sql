-- Parts of Bulamu an administrator leaves out of a staff member's menu and dashboard.
ALTER TABLE "User" ADD COLUMN "hiddenSections" TEXT[] DEFAULT ARRAY[]::TEXT[];
