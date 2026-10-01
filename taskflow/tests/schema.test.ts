import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { asService, asUser, freshDb, newUser } from "./helpers/db";

const SCHEMA = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8")
  .replace(/create extension if not exists "pgcrypto";/, "");

/**
 * `schema.sql` se aplica a mano desde el SQL Editor, y Victor lo va a volver a
 * correr cada vez que haya una columna nueva. Tiene que poder correrse sobre
 * una base con datos sin romper nada ni perder filas.
 */
describe("schema.sql", () => {
  it("se puede aplicar dos veces sin perder datos", async () => {
    const db = await freshDb();
    const uid = await newUser(db, "victor@ejemplo.com");
    await asUser(db, uid, (tx) =>
      tx.query(`insert into tasks (user_id, title, done) values ($1, 'Problem set 4', true)`, [uid]));

    await db.exec(SCHEMA);
    await db.exec(SCHEMA);

    const r = await asService(db, (tx) =>
      tx.query<{ title: string; done: boolean }>(`select title, done from tasks where user_id = $1`, [uid]));
    expect(r.rows).toEqual([{ title: "Problem set 4", done: true }]);
  });

  it("toda tabla de public tiene la RLS encendida", async () => {
    const db = await freshDb();
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`);
    expect(r.rows.length).toBeGreaterThan(5);
    for (const t of r.rows) expect(t.relrowsecurity, t.relname).toBe(true);
  });
});
