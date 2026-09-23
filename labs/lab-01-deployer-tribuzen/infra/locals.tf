locals {
  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Course      = "12-aws-cloud/lab-01-deployer-tribuzen"
  }
}
