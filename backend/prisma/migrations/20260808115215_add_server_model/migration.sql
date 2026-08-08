-- CreateTable
CREATE TABLE "Server" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "loader" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "ramMb" INTEGER NOT NULL,
    "port" INTEGER NOT NULL,
    "rconPassword" TEXT NOT NULL,
    "containerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'creating',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Server_name_key" ON "Server"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Server_port_key" ON "Server"("port");
