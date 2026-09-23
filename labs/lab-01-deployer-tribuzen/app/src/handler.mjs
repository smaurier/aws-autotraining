// handler.mjs — API TribuZen minimale déployée sur AWS Lambda (module 06) derrière API
// Gateway HTTP v2 (module 07), connectée à un vrai Postgres RDS (module 08). Trois routes :
// GET /health (sonde de connectivité DB), GET /families, POST /families.
//
// Pas de framework (NestJS) ici volontairement : le sujet de CE lab est l'infra AWS, pas un
// nouveau pattern applicatif — la logique métier "familles" existe déjà, testée, dans le cours
// 09-nestjs (lab-01-api-de-zero). Réutiliser NestJS-sur-Lambda est un vrai chantier à part
// (cold start, adaptateur serverless-express) — hors scope de ce geste transverse.
import pg from "pg";

const { Pool } = pg;
let pool;

function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      // RDS impose TLS ; le certificat AWS n'est pas dans le magasin de confiance par défaut
      // de Node — accepté ici pour un lab, à durcir avec le CA RDS réel en production.
      ssl: { rejectUnauthorized: false },
      max: 1, // Lambda : une exécution = une connexion, jamais un pool partagé entre invocations froides
    });
  }
  return pool;
}

function reponseJson(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function handler(event) {
  const methode = event.requestContext?.http?.method ?? event.httpMethod;
  const chemin = event.requestContext?.http?.path ?? event.rawPath ?? event.path;

  try {
    if (chemin === "/health" && methode === "GET") {
      await getPool().query("SELECT 1");
      return reponseJson(200, { status: "ok", db: "connected" });
    }

    if (chemin === "/families" && methode === "GET") {
      const { rows } = await getPool().query("SELECT id, name, created_at FROM families ORDER BY created_at DESC");
      return reponseJson(200, rows);
    }

    if (chemin === "/families" && methode === "POST") {
      const corps = JSON.parse(event.body ?? "{}");
      if (typeof corps.name !== "string" || corps.name.trim() === "") {
        return reponseJson(400, { error: "name est requis" });
      }
      const { rows } = await getPool().query(
        "INSERT INTO families (name) VALUES ($1) RETURNING id, name, created_at",
        [corps.name.trim()],
      );
      return reponseJson(201, rows[0]);
    }

    return reponseJson(404, { error: "route inconnue" });
  } catch (erreur) {
    console.error(erreur);
    return reponseJson(500, { error: "erreur serveur" });
  }
}
