import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "./generated/prisma/client";
import { join } from "path";

const DB_PATH = join(import.meta.dir, "..", "data", "ecm.db");
const url = process.env.DATABASE_URL ?? `file:${DB_PATH}`;

const adapter = new PrismaLibSql({ url });
export const prisma = new PrismaClient({ adapter });
