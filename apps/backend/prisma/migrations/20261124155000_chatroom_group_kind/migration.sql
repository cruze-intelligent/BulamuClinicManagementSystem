-- Add this enum value in its own migration so the next migration can safely
-- use it in constraints even on PostgreSQL versions that defer new enum values.
ALTER TYPE "ChatThreadKind" ADD VALUE 'STAFF_GROUP';
