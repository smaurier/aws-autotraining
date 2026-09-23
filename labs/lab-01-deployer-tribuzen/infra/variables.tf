variable "aws_region" {
  description = "Région AWS (module 00 §2.4 : eu-west-3, Paris, utilisateurs TribuZen européens)"
  type        = string
  default     = "eu-west-3"
}

variable "aws_profile" {
  description = "Profil CLI local (module 00, exemple 1 : un utilisateur IAM dédié, jamais le root)"
  type        = string
  default     = "tribuzen-dev"
}

variable "project_name" {
  type    = string
  default = "tribuzen"
}

variable "environment" {
  type    = string
  default = "lab"
}

variable "db_name" {
  type    = string
  default = "tribuzen"
}

variable "db_username" {
  type    = string
  default = "tribuzen_app"
}
