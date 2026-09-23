-- schema.sql — à exécuter UNE FOIS après le premier `terraform apply`, une fois l'endpoint
-- RDS connu (`terraform output rds_endpoint`). Pas encore automatisé (module 17-cicd, plus
-- tard) : pour ce premier geste, une commande manuelle documentée dans README.md.
CREATE TABLE IF NOT EXISTS families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
