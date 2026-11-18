-- Other roles a staff member also works in, and who may verify lab results.
ALTER TABLE "User" ADD COLUMN "extraRoles" "Role"[] NOT NULL DEFAULT ARRAY[]::"Role"[];
ALTER TABLE "User" ADD COLUMN "canVerifyLab" BOOLEAN NOT NULL DEFAULT false;
