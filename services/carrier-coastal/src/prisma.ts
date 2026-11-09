import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "./generated/prisma/client";
import { mkdirSync } from "fs";
import { dirname, join } from "path";

const DB_PATH = join(import.meta.dir, "..", "data", "carrier-coastal.db");
const url = process.env.DATABASE_URL ?? `file:${DB_PATH}`;
if (url.startsWith("file:")) {
  mkdirSync(dirname(url.slice(5)), { recursive: true });
}

const adapter = new PrismaLibSql({ url });
export const prisma = new PrismaClient({ adapter });
