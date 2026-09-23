// ARBITRAGE DOCUMENTÉ (voir README §Sécurité — module 15) : Postgres publiquement accessible,
// Lambda HORS VPC. Le choix "propre" (module 02) serait Lambda + RDS dans un VPC privé, sans
// exposition publique — mais ça exige soit un NAT Gateway (~30 €/mois, en continu, hors budget
// d'un lab), soit des VPC endpoints par service. Pour UN geste transverse à petite échelle,
// détruit après usage, l'exposition publique + mot de passe fort généré + TLS imposé est un
// compromis assumé, pas une négligence — le module 02 (VPC) enseigne la version correcte.
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "random_password" "db_master" {
  length  = 24
  special = false # évite les caractères qui cassent une chaîne de connexion mal échappée
}

resource "aws_db_subnet_group" "tribuzen" {
  name       = "${var.project_name}-${var.environment}"
  subnet_ids = data.aws_subnets.default.ids
  tags       = local.tags
}

resource "aws_security_group" "rds" {
  name        = "${var.project_name}-${var.environment}-rds"
  description = "Postgres RDS TribuZen - port 5432 uniquement"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "Postgres - lab expose publiquement, voir README section Securite"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

resource "aws_db_instance" "tribuzen" {
  identifier     = "${var.project_name}-${var.environment}"
  engine         = "postgres"
  engine_version = "16.4"
  instance_class = "db.t4g.micro" # éligible free tier / crédits (module 00 §2.6)

  allocated_storage = 20
  storage_type      = "gp3"

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db_master.result

  db_subnet_group_name   = aws_db_subnet_group.tribuzen.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = true

  backup_retention_period = 0
  skip_final_snapshot     = true
  deletion_protection     = false
  apply_immediately       = true

  tags = local.tags
}
