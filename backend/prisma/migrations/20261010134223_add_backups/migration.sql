-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "label" TEXT,
    "path" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Backup_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BackupSchedule" (
    "serverId" TEXT NOT NULL PRIMARY KEY,
    "worldEveryMin" INTEGER,
    "fullEveryMin" INTEGER,
    "keepWorld" INTEGER NOT NULL DEFAULT 12,
    "keepFull" INTEGER NOT NULL DEFAULT 5,
    "skipWhenEmpty" BOOLEAN NOT NULL DEFAULT true,
    "chatEnabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "BackupSchedule_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Backup_serverId_kind_createdAt_idx" ON "Backup"("serverId", "kind", "createdAt");
