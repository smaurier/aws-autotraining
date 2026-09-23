output "api_endpoint" {
  description = "URL de base de l'API (API Gateway HTTP)"
  value       = aws_apigatewayv2_api.api.api_endpoint
}

output "cloudfront_domain" {
  description = "Domaine CloudFront servant la page statique"
  value       = aws_cloudfront_distribution.cdn.domain_name
}

output "rds_endpoint" {
  description = "Endpoint Postgres — utilisé pour exécuter schema.sql une première fois (psql)"
  value       = aws_db_instance.tribuzen.address
}

output "db_master_password" {
  description = "Mot de passe généré pour l'utilisateur applicatif — jamais loggé en clair ailleurs"
  value       = random_password.db_master.result
  sensitive   = true
}
